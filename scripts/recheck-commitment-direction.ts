// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DIRECTION RE-CHECK (W43 · existing wrong-direction tasks). GUARDED; DRY-RUN BY DEFAULT.
//
// Commitments written before the W42 direction fix (THE QUOTE NAMES ITS ACTOR · THE BILL HAS ONE
// PAYER) keep the direction the older extraction gave them — e.g. "Arrange payment transfer with
// <colleague>" filed as the user's own debt when the sender's side pays. This census re-reads every
// OPEN commitment's stored source quote (and, for mail, the source message's OWN words) through the
// CURRENT write-time rules, in the write door's order (lib/commitments/extract.ts):
//   1 · THE DIRECTION FLOOR (lib/commitments/direction.ts directionFloor — object position / doer)
//   2 · THE QUOTE DIRECTION FLOOR (quote-actor quoteDirectionFloor — only when the quote is verifiably
//       in the message's own words; a suggestion / a request between others → not the user's at all)
//   3 · THE PAYER FLOOR (quote-actor payerFloor — mail only)
// and lists the rows whose direction would change, or which are nobody's task for the user.
//
//   npx tsx scripts/recheck-commitment-direction.ts [--user <id-prefix>] [--apply --yes]
//
// ZERO AI. Prints ids + counts + a masked shape only (no names, no quote text).
// --apply --yes: a flip is a conditional update (still open, still the old direction); a "not the
// user's" row is dismissed with resolved_reason 'direction_recheck' + a REVERSIBLE commitment_dismissed
// activity row (/api/restore reopens it). Every write is journaled (previous values) to
// scratchpad/recheck-direction-<ts>.json so it can be undone. --apply is OWNER-GATED.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { directionFloor } from '../lib/commitments/direction';
import { quoteDirectionFloor, payerFloor } from '../lib/commitments/quote-actor';
import { quoteInText } from '../lib/work/conversation-delta';
import { topMessageOf } from '../lib/inbox/top-message';
import { plainBody } from '../lib/core/text';
import { denotesUser, type UserForms } from '../lib/commitments/extraction-truth';

export const RECHECK_REASON = 'direction_recheck';

export type RecheckInput = {
  direction: string | null;
  description: string;
  counterparty: string | null;
  quote: string | null;
  source: string | null;
  /** The source message, for mail-born rows (null when unreadable or not mail). */
  email: { isFromUser: boolean; ownWords: string; otherParty: string | null } | null;
};

export type RecheckVerdict =
  | { change: 'none' }
  | { change: 'flip'; to: 'you_owe' | 'awaiting'; basis: 'direction-floor' | 'quote-actor' | 'payer' }
  | { change: 'not_users'; basis: 'quote-actor'; actor: string };

/**
 * THE ONE DECISION (pure): what the current write-time direction rules say about a stored row.
 * Applies the floors in the write door's order and returns the first change from the STORED direction.
 */
export function recheckDirection(r: RecheckInput, user: UserForms): RecheckVerdict {
  const stored: 'you_owe' | 'awaiting' = r.direction === 'awaiting' ? 'awaiting' : 'you_owe';
  const other = r.email?.otherParty && !denotesUser(r.email.otherParty, user) ? r.email.otherParty : null;
  let dir = stored;
  let basis: 'direction-floor' | 'quote-actor' | 'payer' | null = null;
  // 1 · THE DIRECTION FLOOR (legacy rows carry no doer — the object position decides, else as stored).
  const f = directionFloor({ direction: dir, description: r.description, counterparty: r.counterparty ?? other }, user, other);
  if (f.direction !== dir) { dir = f.direction; basis = 'direction-floor'; }
  // 2 · THE QUOTE NAMES ITS ACTOR — only on a quote verifiably inside the message's own words.
  const own = r.email?.ownWords ?? '';
  if (r.source === 'email' && r.email && r.quote && quoteInText(r.quote, own)) {
    const v = quoteDirectionFloor({ direction: dir, quote: r.quote, counterparty: r.counterparty }, { authoredByUser: r.email.isFromUser, user, other, ownWords: own });
    if (v.kind === 'drop') return { change: 'not_users', basis: 'quote-actor', actor: v.actor };
    if (v.kind === 'direction' && v.direction !== dir) { dir = v.direction; basis = 'quote-actor'; }
  }
  // 3 · THE BILL HAS ONE PAYER — mail only.
  if (r.source === 'email' && r.email && own) {
    const paid = payerFloor({ direction: dir, description: r.description }, { ownWords: own, user, others: [r.counterparty, other], authoredByUser: r.email.isFromUser });
    if (paid && paid !== dir) { dir = paid; basis = 'payer'; }
  }
  return dir === stored || !basis ? { change: 'none' } : { change: 'flip', to: dir, basis };
}

type Row = { id: string; user_id: string; direction: string | null; description: string; counterparty: string | null; source: string | null; source_id: string | null; source_quote: string | null; status: string };
type Mail = { id: string; is_from_user: boolean | null; from_address: string | null; from_name: string | null; to_addresses: string[] | null; body: string | null };

const shape = (d: string) => `${String(d ?? '').trim().split(/\s+/)[0] ?? ''} … (${String(d ?? '').length}ch)`;

async function main(): Promise<void> {
  config({ path: '.env.local' });
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const argv = process.argv;
  const APPLY = argv.includes('--apply');
  const YES = argv.includes('--yes');
  const USER = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;
  if (APPLY && !YES) { console.error('--apply requires --yes (the re-check rewrites commitments).'); process.exit(2); }

  // THE COLUMN CHECK — the silent-column trap: a missing source_quote must fail loudly, never read as null.
  const probe = await sb.from('commitments').select('id, source_quote').limit(1);
  if (probe.error) { console.error(`✗ commitments.source_quote unreadable: ${probe.error.message}`); process.exit(1); }

  const rows = await fetchAllRows<Row>((from, to) => sb.from('commitments')
    .select('id, user_id, direction, description, counterparty, source, source_id, source_quote, status')
    .in('status', ['open', 'suggested']).order('id').range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>, { maxRows: 100_000 });
  const users = [...new Set(rows.map((r) => r.user_id))].filter((u) => !USER || u.startsWith(USER));
  const tot = { checked: 0, flips: 0, notUsers: 0, users: 0, mailUnread: 0, applied: 0, byBasis: {} as Record<string, number>, byFlip: {} as Record<string, number> };
  const journal: Array<Record<string, unknown>> = [];

  for (const uid of users) {
    const mine = rows.filter((r) => r.user_id === uid);
    tot.checked += mine.length;
    const [{ data: prof }, { data: conns }, { data: selfP }, authUser] = await Promise.all([
      sb.from('profiles').select('full_name, email').eq('id', uid).maybeSingle(),
      sb.from('connections').select('provider_account_id, metadata').eq('user_id', uid),
      sb.from('work_entities').select('name, aliases').eq('user_id', uid).eq('kind', 'person').filter('state->>self', 'eq', 'true').limit(1).maybeSingle(),
      sb.auth.admin.getUserById(uid).catch(() => ({ data: { user: null } })),
    ]);
    const forms: UserForms = {
      name: (prof as { full_name?: string } | null)?.full_name ?? (selfP as { name?: string } | null)?.name ?? null,
      aliases: [
        authUser.data.user?.email, (prof as { email?: string } | null)?.email,
        ...((conns ?? []) as Array<{ provider_account_id: string | null; metadata: { email?: string } | null }>).flatMap((c) => [c.provider_account_id, c.metadata?.email]),
        ...(((selfP as { aliases?: string[] } | null)?.aliases) ?? []),
      ],
    };
    const ids = [...new Set(mine.filter((r) => r.source === 'email' && r.source_id).map((r) => r.source_id!))];
    const mail = new Map<string, Mail>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await sb.from('emails').select('id, is_from_user, from_address, from_name, to_addresses, body').eq('user_id', uid).in('id', ids.slice(i, i + 100));
      if (error) { console.log(`  ✗ emails read (${uid.slice(0, 8)}): ${error.message}`); continue; }
      for (const m of (data ?? []) as Mail[]) mail.set(m.id, m);
    }
    let hit = 0;
    for (const r of mine) {
      const m = r.source === 'email' && r.source_id ? mail.get(r.source_id) ?? null : null;
      if (r.source === 'email' && !m) tot.mailUnread++;
      const email = m ? {
        isFromUser: !!m.is_from_user,
        ownWords: topMessageOf(plainBody(String(m.body ?? ''))) || plainBody(String(m.body ?? '')),
        otherParty: m.is_from_user ? (m.to_addresses?.[0] ?? null) : (m.from_name ? `${m.from_name} <${m.from_address ?? ''}>` : m.from_address),
      } : null;
      const v = recheckDirection({ direction: r.direction, description: r.description, counterparty: r.counterparty, quote: r.source_quote, source: r.source, email }, forms);
      if (v.change === 'none') continue;
      hit++;
      tot.byBasis[v.basis] = (tot.byBasis[v.basis] ?? 0) + 1;
      if (v.change === 'flip') {
        tot.flips++;
        const k = `${r.direction}→${v.to}`; tot.byFlip[k] = (tot.byFlip[k] ?? 0) + 1;
        console.log(`  ${r.id.slice(0, 8)} · ${r.source ?? '?'} · ${r.direction} → ${v.to} (${v.basis}) · "${shape(r.description)}"`);
      } else {
        tot.notUsers++;
        console.log(`  ${r.id.slice(0, 8)} · ${r.source ?? '?'} · not the user's (${v.actor}) · "${shape(r.description)}"`);
      }
      if (!APPLY) continue;
      const nowIso = new Date().toISOString();
      if (v.change === 'flip') {
        const { data, error } = await sb.from('commitments').update({ direction: v.to, updated_at: nowIso })
          .eq('id', r.id).eq('user_id', uid).eq('status', r.status).eq('direction', r.direction ?? '').select('id');
        if (!error && data?.length) { tot.applied++; journal.push({ id: r.id, user_id: uid, op: 'flip', prev: { direction: r.direction }, next: { direction: v.to }, basis: v.basis, at: nowIso }); }
      } else {
        const { data, error } = await sb.from('commitments')
          .update({ status: 'dismissed', resolved_reason: RECHECK_REASON, resolved_at: nowIso, updated_at: nowIso })
          .eq('id', r.id).eq('user_id', uid).eq('status', r.status).select('id');
        if (!error && data?.length) {
          tot.applied++;
          journal.push({ id: r.id, user_id: uid, op: 'dismiss', prev: { status: r.status }, actor: v.actor, at: nowIso });
          const { logActivity } = await import('../lib/activity/log');
          await logActivity(sb as never, uid, {
            type: 'commitment_dismissed', title: `Not your task (the source words make it someone else's): ${r.description}`,
            entityType: 'commitment', entityId: r.id,
            metadata: { reason: RECHECK_REASON, actor: v.actor, auto: true, via: 'recheck-commitment-direction' },
          }).catch(() => {});
        }
      }
    }
    if (hit) { tot.users++; console.log(`▸ user ${uid.slice(0, 8)} · open ${mine.length} · would change ${hit}`); }
  }
  console.log('\n══ SUMMARY ══');
  console.log(`checked=${tot.checked} open commitments across ${users.length} users · would flip=${tot.flips} ${JSON.stringify(tot.byFlip)} · not the user's=${tot.notUsers} · users affected=${tot.users} · mail source unreadable=${tot.mailUnread}`);
  console.log(`  by basis: ${JSON.stringify(tot.byBasis)}`);
  if (APPLY) {
    mkdirSync('scratchpad', { recursive: true });
    const path = `scratchpad/recheck-direction-${Date.now()}.json`;
    writeFileSync(path, JSON.stringify(journal, null, 1));
    console.log(`  applied=${tot.applied} · journal (previous values, for undo) → ${path}`);
  } else console.log('  (dry-run — pass --apply --yes to write; owner-gated)');
}

if (/recheck-commitment-direction\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
