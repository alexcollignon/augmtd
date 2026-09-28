// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HTML-BODY REPAIR (W18.B · THE PLAIN BODY IS PLAIN). GUARDED; DRY-RUN BY DEFAULT.
//
// Before W18.B the Gmail parser stored a mailer's text/plain part verbatim — and some mailers put the
// whole HTML document in it, so `emails.body` (and the inbox item's `source_data.body`) held
// "<html><head><meta…". The parsers now convert at write time (lib/core/text.ts htmlToText), and the
// READ seams (the thread route, the thread tail, the drafters) convert stored rows on the fly — so
// NO data write is needed for display. This census counts what is still stored as markup and, only
// with --apply --yes, rewrites those bodies to their text (html_body is never touched).
//
// It also reports the second W18.B trap: a document part (the invoice PDF) dropped at sync because
// it carried a Content-ID. Dropped parts were never recorded, so they CANNOT be identified from our
// data — the census lists only CANDIDATES (inbound mail with no recorded attachment whose subject or
// body speaks of one). Recovering them needs a re-fetch of those messages from the provider: the
// provider still holds the parts, and today's parser keeps them; there is no targeted re-fetch door
// yet (sync-emails.ts processAttachmentsForEmail is private) — an owner call.
//
//   npx tsx scripts/repair-html-bodies.ts [--user <email>]        census (dry run)
//   npx tsx scripts/repair-html-bodies.ts --apply --yes [--user]  rewrite markup bodies to text
//
// ZERO AI. Output is MASKED (no subjects, no bodies, no addresses).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { looksLikeHtml, htmlToText } from '../lib/core/text';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const argv = process.argv;
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');
const userArg = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;
const MAX_ROWS = 50_000;

// The server-side pre-filter (the confirm is looksLikeHtml, client-side) — markup openers only.
const HTML_OR = (col: string) => ['<html', '<!doctype', '<head', '<body', '<div', '<table', '<p>', '<br'].map((t) => `${col}.ilike.%${t}%`).join(',');
// Attachment-candidate words (a DIAGNOSTIC pre-filter for a human to review — never a product rule).
const ATTACH_OR = ['attached', 'attachment', 'invoice', 'enclosed', 'anexo', 'fatura', 'factura', 'pièce jointe', 'anhang', 'rechnung']
  .flatMap((w) => [`subject.ilike.%${w}%`, `body.ilike.%${w}%`]).join(',');

const mask = (id: string) => `${id.slice(0, 4)}…`;

(async () => {
  if (APPLY && !YES) { console.error('--apply requires --yes (the repair rewrites emails.body + inbox_items.source_data.body).'); process.exit(2); }
  // Per user (the user_id index bounds each scan; one unbounded ilike over every body times out),
  // paged, and every error REPORTED — a scan that failed is never read as "nothing found".
  type P = { id: string; email: string | null };
  const profiles = await fetchAllRows<P>((from, to) => sb.from('profiles').select('id, email').order('id', { ascending: true }).range(from, to));
  const users = userArg ? profiles.filter((p) => (p.email ?? '').toLowerCase() === userArg.toLowerCase()) : profiles;
  if (userArg && !users.length) { console.error(`no profile for ${userArg}`); process.exit(2); }
  const userId = userArg ? users[0].id : null;

  const errors: string[] = [];
  async function scan<T>(label: string, uid: string, make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; from < MAX_ROWS; from += 500) {
      const { data, error } = await make(from, from + 499);
      if (error) { errors.push(`${label} ${mask(uid)}: ${error.message ?? 'error'}`); break; }
      out.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
    return out;
  }

  type E = { id: string; user_id: string; body: string | null };
  type I = { id: string; user_id: string; source_data: Record<string, unknown> | null };
  type A = { id: string; user_id: string; metadata: Record<string, unknown> | null };
  const badEmails: E[] = [], badItems: I[] = [], candidates: A[] = [];
  for (const u of users) {
    // ── 1 · emails.body holding markup ──
    const emails = await scan<E>('emails', u.id, (from, to) => sb.from('emails').select('id, user_id, body')
      .eq('user_id', u.id).or(HTML_OR('body')).order('id', { ascending: true }).range(from, to));
    badEmails.push(...emails.filter((e) => looksLikeHtml(e.body)));
    // ── 2 · inbox_items.source_data.body holding markup ──
    const items = await scan<I>('inbox_items', u.id, (from, to) => sb.from('inbox_items').select('id, user_id, source_data')
      .eq('user_id', u.id).or(HTML_OR('source_data->>body')).order('id', { ascending: true }).range(from, to));
    badItems.push(...items.filter((i) => looksLikeHtml(String(i.source_data?.body ?? ''))));
    // ── 3 · attachment CANDIDATES (undeterminable exactly — see header) ──
    const attach = await scan<A>('attachments', u.id, (from, to) => sb.from('emails').select('id, user_id, metadata')
      .eq('user_id', u.id).eq('is_from_user', false).or(ATTACH_OR).order('id', { ascending: true }).range(from, to));
    candidates.push(...attach.filter((a) => {
      const list = (a.metadata as { attachments?: unknown } | null)?.attachments;
      return !Array.isArray(list) || !list.length;
    }));
  }

  const perUser = (rows: Array<{ user_id: string }>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.user_id, (m.get(r.user_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${mask(u)}:${n}`).join('  ') || '—';
  };
  console.log('\nTHE HTML-BODY CENSUS' + (userId ? ` (one user ${mask(userId)})` : ` (${users.length} users)`));
  console.log(`  emails whose body is markup        ${badEmails.length}   ${perUser(badEmails)}`);
  console.log(`  inbox_items whose body is markup   ${badItems.length}   ${perUser(badItems)}`);
  console.log(`  NB display is already fixed at read time (thread route · thread tail · drafters); this write is cosmetic.`);
  console.log(`\n  attachment CANDIDATES (inbound, speaks of a file, none recorded) ${candidates.length}   ${perUser(candidates)}`);
  console.log(`  NB a dropped document was never recorded, so this is a candidate list, not a finding. Recovery =`);
  console.log(`     re-fetch those messages from the provider (today's parser keeps a Content-ID document);`);
  console.log(`     no targeted re-fetch door exists yet — owner call.`);
  if (errors.length) console.log(`\n  ⚠ ${errors.length} scan(s) FAILED (counts above are incomplete):\n    ${errors.slice(0, 10).join('\n    ')}`);

  if (!APPLY) { console.log('\n(dry run — nothing written; --apply --yes rewrites the markup bodies)'); return; }

  let wroteE = 0, wroteI = 0, failed = 0;
  for (const e of badEmails) {
    const { error } = await sb.from('emails').update({ body: htmlToText(e.body) }).eq('id', e.id).eq('user_id', e.user_id);
    if (error) failed++; else wroteE++;
  }
  for (const i of badItems) {
    const sd = { ...(i.source_data ?? {}), body: htmlToText(String(i.source_data?.body ?? '')) };
    const { error } = await sb.from('inbox_items').update({ source_data: sd }).eq('id', i.id).eq('user_id', i.user_id);
    if (error) failed++; else wroteI++;
  }
  console.log(`\nAPPLIED: emails ${wroteE} · inbox_items ${wroteI} · failed ${failed}`);
})().catch((e) => { console.error(e); process.exit(1); });
