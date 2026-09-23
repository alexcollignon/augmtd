// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE INVITE-LINK REPAIR (W7.4 — INVITES ARE EVENTS). GUARDED; DRY-RUN BY DEFAULT.
//
// Before W7.4 an invitation email was linked to a calendar row by a HEURISTIC (same organizer + the
// next confirmed future start) — found wrong live: an October invite wearing an unrelated August
// check-in. This script re-derives every open calendar-shaped item's link BY IDENTITY:
//
//   CENSUS (always, DB-only, zero provider calls):
//     · open calendar/meeting-shaped inbox items · how many carry calendar_event_id · how many of
//       those point at an event sharing NO distinctive title token with the invite (heuristic
//       suspects) · how many already carry a parsed invite (post-W7.4 rows).
//   --fetch [--limit N] (provider READS — Gmail messages.get / Graph eventMessage expand; no writes):
//     · reads each item's invite from its own calendar part, links by UID, and classifies:
//         keep (same row) · relink (a different row) · unlink (old link, no identity match)
//         · newlink (no old link, identity found) · none (no link either way) · unreadable
//   --apply (requires --fetch AND --yes): writes `source_data.invite` + `calendar_event_id`
//     (removed when no identity matches). Merge-only on source_data; nothing else is touched.
//
//   npx tsx scripts/repair-invite-links.ts [--user email | --all] [--fetch] [--linked] [--limit 50] [--apply --yes]
//   (--linked: re-derive only items that already carry a pre-W7.4 calendar_event_id)
//
// ZERO AI. No real names are printed — ids and counts only.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { distinctiveTokens } from '../lib/workflows/case-step';
import { readInviteForEmail, isCalendarAttachment } from '../lib/calendar/invite-source';
import { linkInviteToEvent, compactInvite } from '../lib/calendar/invite-link';
import type { InviteFacts } from '../lib/calendar/ics';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const argv = process.argv;
const ALL = argv.includes('--all');
const FETCH = argv.includes('--fetch');
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');
const userArg = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;
const LINKED_ONLY = argv.includes('--linked');
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 50;

type Item = { id: string; user_id: string; item_type: string | null; rule_type: string | null; source_data: Record<string, unknown> | null };

/** The title an invite subject names: provider prefixes ("Invitation:", "Updated invitation:") and
 *  the trailing "@ <when> (<who>)" are stripped for the token comparison. Census-only heuristic
 *  for FLAGGING suspects — never used to link anything. */
function subjectTitle(s: string): string {
  return String(s ?? '').replace(/^[^:]{0,40}:\s*/, '').replace(/\s@\s.*$/, '').trim();
}

(async () => {
  if (APPLY && (!FETCH || !YES)) {
    console.error('--apply requires --fetch and --yes (the repair writes source_data on real items).');
    process.exit(2);
  }
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const targets = ALL || !userArg ? users!.users : users!.users.filter((u) => u.email === userArg);

  const c = { items: 0, linked: 0, suspects: 0, parsed: 0, danglingLink: 0 };
  const f = { read: 0, keep: 0, relink: 0, unlink: 0, newlink: 0, none: 0, unreadable: 0, cancel: 0, applied: 0 };

  for (const u of targets) {
    const items = await fetchAllRows<Item>((from, to) => sb.from('inbox_items')
      .select('id, user_id, item_type, rule_type, source_data')
      .eq('user_id', u.id).eq('source', 'email').eq('status', 'pending')
      .or('item_type.eq.meeting,rule_type.eq.meeting,source_data->>calendar_event_id.not.is.null,source_data->understanding->>mailKind.eq.calendar,source_data->>kind_override.eq.calendar')
      .order('id').range(from, to) as unknown as PromiseLike<{ data: Item[] | null; error: unknown }>);
    if (!items.length) continue;
    c.items += items.length;

    const ids = [...new Set(items.map((i) => String(i.source_data?.calendar_event_id ?? '')).filter(Boolean))];
    const events = new Map<string, { title: string | null }>();
    for (let k = 0; k < ids.length; k += 200) {
      const { data } = await sb.from('calendar_events').select('id, title').in('id', ids.slice(k, k + 200));
      for (const e of (data ?? []) as Array<{ id: string; title: string | null }>) events.set(e.id, e);
    }
    for (const it of items) {
      const sd = it.source_data ?? {};
      if (sd.invite) c.parsed++;
      const eid = typeof sd.calendar_event_id === 'string' ? sd.calendar_event_id : null;
      if (!eid) continue;
      c.linked++;
      const ev = events.get(eid);
      if (!ev) { c.danglingLink++; continue; }
      const a = distinctiveTokens(subjectTitle(String(sd.subject ?? '')));
      const b = new Set(distinctiveTokens(String(ev.title ?? '')));
      if (a.length && !a.some((t) => b.has(t))) c.suspects++;
    }

    if (!FETCH) continue;
    // ── provider reads (read-only) ───────────────────────────────────────────────────────────
    const { data: conns } = await sb.from('connections').select('id, provider, metadata').eq('user_id', u.id);
    const connById = new Map(((conns ?? []) as Array<{ id: string; provider: string; metadata: { tokens?: string } | null }>).map((x) => [x.id, x]));
    for (const it of items) {
      if (f.read >= LIMIT) break;
      const sd = it.source_data ?? {};
      if (LINKED_ONLY && typeof sd.calendar_event_id !== 'string') continue;
      const emailId = String(sd.email_id ?? '');
      if (!emailId) { f.unreadable++; continue; }
      const { data: em } = await sb.from('emails').select('id, connection_id, metadata').eq('id', emailId).eq('user_id', u.id).maybeSingle();
      const conn = em ? connById.get(String((em as { connection_id: string }).connection_id)) : null;
      const tokens = conn?.metadata?.tokens;
      if (!em || !conn || !tokens) { f.unreadable++; continue; }
      f.read++;
      const meta = ((em as { metadata: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>;
      let invite: InviteFacts | null = null;
      try {
        if (conn.provider === 'gmail' && meta.gmail_id) {
          const { getGmailClient, parseGmailMessage } = await import('../lib/google/gmail');
          const gmail = await getGmailClient(tokens); // no refresh callback — an in-memory refresh writes nothing
          const msg = await gmail.users.messages.get({ userId: 'me', id: String(meta.gmail_id), format: 'full' });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed = parseGmailMessage(msg.data as any);
          const icsIds = (parsed.attachments ?? []).filter((a) => isCalendarAttachment(a)).map((a) => a.attachmentId);
          invite = await readInviteForEmail({ provider: 'gmail', encryptedTokens: tokens, parsed, calendarAttachmentIds: icsIds });
        } else if (conn.provider === 'outlook' && meta.outlook_id) {
          invite = await readInviteForEmail({
            provider: 'outlook', encryptedTokens: tokens,
            parsed: { metadata: { ...meta, odata_type: 'eventMessage' } }, calendarAttachmentIds: [],
          });
        }
      } catch { invite = null; }
      if (!invite) { f.unreadable++; continue; }
      if (invite.method === 'CANCEL') f.cancel++;
      const old = typeof sd.calendar_event_id === 'string' ? sd.calendar_event_id : null;
      const next = await linkInviteToEvent(sb, u.id, invite, { connectionId: conn.id });
      const verdict = old && next ? (old === next ? 'keep' : 'relink') : old ? 'unlink' : next ? 'newlink' : 'none';
      f[verdict]++;
      console.log(`  item ${it.id.slice(0, 8)} · ${conn.provider} · ${verdict}${invite.method ? ` · ${invite.method}` : ''}`);
      if (APPLY) {
        const merged: Record<string, unknown> = { ...sd, invite: compactInvite(invite) };
        if (next) merged.calendar_event_id = next; else delete merged.calendar_event_id;
        const { error } = await sb.from('inbox_items').update({ source_data: merged }).eq('id', it.id).eq('user_id', u.id);
        if (!error) f.applied++;
      }
    }
  }

  console.log('\nCENSUS (DB-only)');
  console.log(`  open calendar-shaped items=${c.items} · carry calendar_event_id=${c.linked} · link to a missing row=${c.danglingLink}`);
  console.log(`  heuristic suspects (linked event shares no distinctive title token)=${c.suspects} · already carry a parsed invite=${c.parsed}`);
  if (FETCH) {
    console.log(`\nIDENTITY RE-DERIVATION (provider reads, limit ${LIMIT})`);
    console.log(`  read=${f.read} · keep=${f.keep} · relink=${f.relink} · unlink=${f.unlink} · newlink=${f.newlink} · none=${f.none} · unreadable=${f.unreadable} · cancellations=${f.cancel}`);
    console.log(APPLY ? `  applied=${f.applied}` : '  (dry-run — pass --apply --yes to write)');
  } else {
    console.log('\n(census only — pass --fetch to re-derive links from each invite\'s own UID; still no writes)');
  }
})();
