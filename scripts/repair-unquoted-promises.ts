// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNQUOTED-PROMISE REPAIR (W15.4 · A PROMISE IS QUOTED OR IT ISN'T A PROMISE). GUARDED; DRY-RUN
// BY DEFAULT.
//
// Since W9.4 every user-authored message is extracted, and before W15.4 nothing asked the extraction
// to QUOTE the promise — so a pitch in the user's own sent reply could mint "you owe". The write door
// now runs THE QUOTE FLOOR (lib/commitments/extract.ts `promiseQuoteFloor`). This repair heals the rows
// minted before it: OPEN you_owe commitments extracted from USER-AUTHORED mail since --since
// (default 2026-09-23, the W9.4 deploy).
//
//   DRY RUN (default, zero AI, zero writes — a write-refusing guarded client):
//     a census per user + a ZERO-AI PROXY: does a first-person commitment phrase exist in the source
//     message's OWN words (topMessageOf)? The proxy is a multilingual phrase list — a CENSUS SIGNAL
//     ONLY, never the law (the law is reasoned: the model quotes, code verifies). Plus a cost estimate.
//   --judge          re-check each row with THE NEW RULE via ONE cheap classification-tier call
//                    (the model quotes the promise + judges explicit_promise; code runs the SAME
//                    promiseQuoteFloor). Reports only — no commitment writes.
//   --judge --apply --yes   dismiss ONLY the rows that fail — a conditional flip (still open, still
//                    you_owe), resolved_reason 'unquoted_promise', a REVERSIBLE commitment_dismissed
//                    activity row (/api/restore reopens it); a row that passes gets its verified quote
//                    stored (when the source_quote column has landed). A failed call keeps the row.
//
//   npx tsx scripts/repair-unquoted-promises.ts --user <id-prefix> | --all [--since YYYY-MM-DD] [--limit N] [--show]
//
// Output is MASKED (titles as first word + length) unless --show. NO SILENT CAPS: listings page
// through fetchAllRows; --limit reports what it left behind.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { topMessageOf } from '../lib/inbox/top-message';
import { promiseQuoteFloor, COMMITMENT_EXTRACTION_VERSION, type QuoteFloorVerdict } from '../lib/commitments/extract';
import { clipForPrompt, EXCERPT_RULE } from '../lib/utils/clip-for-prompt';
import { foldAccents } from '../lib/projects/identity';

/** The dismissal reason this repair stamps (the restore door reads it back). */
export const UNQUOTED_PROMISE_REASON = 'unquoted_promise';
/** €/call — classification tier (gpt-5-mini class): ~1.2k tokens in, ~0.4k out incl. reasoning. */
export const EST_EUR_PER_CALL = 0.002;
/** The message words one judge call reads (clipped by THE ONE CLIPPER, the cut declared). */
const JUDGE_MESSAGE_CHARS = 2500;

/**
 * THE ZERO-AI CENSUS PROXY — never a production gate. Does the message's own words hold a first-person
 * commitment phrase (EN · PT · ES · FR · DE)? "let me know" / "happy to" / "feel free" are NOT
 * promises and are not listed. Pure.
 */
export function firstPersonPromiseProxy(ownWords: string): boolean {
  const t = foldAccents(String(ownWords ?? '')).toLowerCase().replace(/[’‘`´]/g, "'");
  return [
    /\b(i'?ll|i will|i shall|i'?m going to|i am going to|we'?ll|we will|we'?re going to|we are going to)\s+(\w+\s+){0,3}?(send|share|get|come back|revert|follow|prepare|draft|check|call|book|schedule|set up|put together|forward|circulate|review|update|confirm|deliver|provide|write|look|reach|introduce|arrange|have|do|make|finish|complete|come|join|attend|meet|be there)\b/,
    /\blet me (send|share|get back|come back|check|prepare|draft|put together|forward|follow up|look into|find out|confirm)\b/,
    /\b(vou|vamos|irei|iremos)\s+(\w+\s+){0,2}?(enviar|mandar|partilhar|compartilhar|preparar|verificar|ver|confirmar|marcar|agendar|tratar|responder|voltar|fazer|rever|reencaminhar)\b/,
    /\b(envio|enviarei|mando|mandarei|partilho|confirmo|preparo)\s+(-?lhe|-?te|-?vos|ainda|hoje|amanha|ate|na|no|a|o)\b/,
    /\b(voy a|vamos a)\s+(\w+\s+){0,2}?(enviar|mandar|compartir|preparar|revisar|confirmar|agendar|llamar|volver)\b|\b(te|le|les) (envio|enviare|mando|mandare)\b/,
    /\b(je vais|nous allons|on va)\s+(\w+\s+){0,2}?(envoyer|partager|preparer|verifier|confirmer|revenir|appeler|organiser|faire)\b|\bje (vous|te) (envoie|enverrai|reviens|confirme)\b|\bje reviens vers\b/,
    /\b(ich werde|wir werden)\b|\bich (schicke|sende|melde mich|kummere mich|bereite)\b|\b(schick|schicke|sende|mach|mache) ich\b/,
  ].some((re) => re.test(t));
}

/** The one judge prompt (the new rule, as the write door's extraction now states it). Pure. */
export function buildPromiseJudgePrompt(title: string, ownWords: string, subject: string | null): string {
  return `The user SENT this email. A task was recorded from it: "you owe: ${clipForPrompt(title, 200)}".\n` +
    `THE PROMISE LAW: the task stands ONLY if the user's email contains an EXPLICIT FIRST-PERSON COMMITMENT to a deliverable or an action ` +
    `("I'll send the deck on Monday", "I will get back to you by Friday", "vou enviar a proposta amanhã"). A pitch, a description of what a product ` +
    `or team can do, an offer or invitation ("happy to show you…", "we can set up…", "let me know if…"), a pleasantry, or a plan stated ` +
    `without committing to it is NOT a promise.\n` +
    `Quote the EXACT words (copied verbatim from the message below, one sentence or clause) that make the promise, or null.\n` +
    `${EXCERPT_RULE}\n\n` +
    `THE USER'S OWN WORDS (quoted reply history removed):\n"""${subject ? `Subject: ${clipForPrompt(subject, 160)}\n` : ''}${clipForPrompt(ownWords, JUDGE_MESSAGE_CHARS)}"""\n\n` +
    `JSON only: {"quote":"… or null","explicit_promise":true|false}`;
}

/** Parse the judge's answer and run THE SAME floor the write door runs. Unparseable → null (keep). Pure. */
export function judgeVerdict(raw: string, ownWords: string): QuoteFloorVerdict | null {
  try {
    const m = String(raw ?? '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]) as { quote?: unknown; explicit_promise?: unknown };
    return promiseQuoteFloor({ direction: 'you_owe', quote: p.quote ?? null, explicit_promise: p.explicit_promise === true }, { ownWords, authoredByUser: true });
  } catch { return null; }
}

// ── a write-refusing client for every non-apply run (any write throws and is recorded) ──
const WRITES = new Set(['insert', 'update', 'delete', 'upsert']);
export function guardClient<T extends object>(raw: T, refused: string[]): T {
  return new Proxy(raw, {
    get(t, p, r) {
      if (p === 'from') {
        return (table: string) => new Proxy((t as unknown as { from: (x: string) => object }).from(table), {
          get(q, k, rr) {
            if (typeof k === 'string' && WRITES.has(k)) return () => { refused.push(`${k}:${table}`); throw new Error(`READ-ONLY GUARD: ${k} on ${table}`); };
            const v = Reflect.get(q, k, rr); return typeof v === 'function' ? v.bind(q) : v;
          },
        });
      }
      if (p === 'rpc') return () => { refused.push('rpc'); throw new Error('READ-ONLY GUARD: rpc'); };
      return Reflect.get(t, p, r);
    },
  });
}

type Row = { id: string; user_id: string; description: string; direction: string | null; status: string; source_id: string | null; created_at: string | null };
type Mail = { id: string; is_from_user: boolean | null; subject: string | null; body: string | null };

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f: string) => argv.includes(f);
  const val = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] ?? null : null);
  const APPLY = flag('--apply'), YES = flag('--yes'), JUDGE = flag('--judge'), ALL = flag('--all'), SHOW = flag('--show');
  const USER = val('--user');
  const SINCE = val('--since') ?? '2026-09-23';
  const LIMIT = val('--limit') != null && Number.isFinite(Number(val('--limit'))) ? Math.max(0, Number(val('--limit'))) : Infinity;
  if (!USER && !ALL) { console.log('usage: --user <id-prefix> | --all [--since YYYY-MM-DD] [--limit N] [--judge] [--judge --apply --yes] [--show]'); process.exit(1); }
  if (APPLY && !JUDGE) { console.log('--apply needs --judge (a row is dismissed only by THE NEW RULE, never by the zero-AI proxy)'); process.exit(1); }
  if (APPLY && !YES) { console.log('--apply needs --yes (owner-gated write)'); process.exit(1); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) { console.log('--since must be YYYY-MM-DD'); process.exit(1); }

  const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const refused: string[] = [];
  // Every read goes through the guard unless --apply; the AI factory (--judge) gets the real client
  // only for its own usage ledger — no commitment write is reachable without --apply.
  const sb = APPLY ? raw : guardClient(raw, refused);
  const mask = (s: string | null | undefined) => { const t = String(s ?? '').trim(); return SHOW ? JSON.stringify(t) : (t ? `${t.split(/\s+/)[0]}…(${t.length}ch)` : '∅'); };

  const rows = await fetchAllRows<Row>((from, to) => sb.from('commitments')
    .select('id, user_id, description, direction, status, source_id, created_at')
    .eq('status', 'open').eq('direction', 'you_owe').eq('source', 'email').gte('created_at', `${SINCE}T00:00:00Z`)
    .order('id', { ascending: true }).range(from, to), { maxRows: 50_000 });
  const users = [...new Set(rows.map((r) => r.user_id))].filter((u) => ALL || (USER && u.startsWith(USER)));
  if (!users.length) { console.log(`no user with open you_owe email commitments since ${SINCE} matches`); return; }

  const tot = { scanned: 0, authored: 0, noSource: 0, proxyPass: 0, proxyFail: 0, judged: 0, pass: 0, fail: 0, failedCalls: 0, dismissed: 0, quoted: 0, leftByLimit: 0 };
  const why: Record<string, number> = {};
  let quoteColumn: boolean | null = null;

  for (const uid of users) {
    const mine = rows.filter((r) => r.user_id === uid);
    tot.scanned += mine.length;
    const ids = [...new Set(mine.map((r) => r.source_id).filter(Boolean) as string[])];
    const mail = new Map<string, Mail>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await sb.from('emails').select('id, is_from_user, subject, body').eq('user_id', uid).in('id', ids.slice(i, i + 100));
      if (error) { console.log(`  ✗ emails read: ${error.message}`); continue; }
      for (const m of (data ?? []) as Mail[]) mail.set(m.id, m);
    }
    const authored = mine.filter((r) => r.source_id && mail.get(r.source_id)?.is_from_user === true);
    tot.noSource += mine.filter((r) => !r.source_id || !mail.has(r.source_id)).length;
    tot.authored += authored.length;
    let uPass = 0, uFail = 0;
    const walk = authored.slice(0, Number.isFinite(LIMIT) ? LIMIT : authored.length);
    tot.leftByLimit += authored.length - walk.length;
    for (const r of walk) {
      const m = mail.get(r.source_id!)!;
      const own = topMessageOf(String(m.body ?? '')) || String(m.body ?? '');
      const proxy = firstPersonPromiseProxy(own);
      if (proxy) { tot.proxyPass++; uPass++; } else { tot.proxyFail++; uFail++; }
      let line = `  ${proxy ? 'proxy✓' : 'proxy✗'} ${mask(r.description)}`;
      if (JUDGE) {
        tot.judged++;
        let v: QuoteFloorVerdict | null = null;
        try {
          const { getAIClient, aiCreate } = await import('../lib/ai/factory');
          const { client: ai, model } = await getAIClient(uid, 'classification', raw as never);
          const res = await aiCreate(ai, { model, max_tokens: 400, temperature: 0, messages: [{ role: 'user', content: buildPromiseJudgePrompt(r.description, own, m.subject) }] });
          v = judgeVerdict(res.choices?.[0]?.message?.content ?? '', own);
        } catch { v = null; }
        if (!v) { tot.failedCalls++; line += ' · judge failed → kept'; console.log(line); continue; }
        if (v.keep) {
          tot.pass++; line += ` · PASS${SHOW ? ` quote=${JSON.stringify(v.quote)}` : ''}`;
          if (APPLY && quoteColumn !== false) {
            const { error } = await sb.from('commitments').update({ source_quote: v.quote })
              .eq('id', r.id).eq('user_id', uid).eq('status', 'open').select('id');
            if (error && /source_quote/.test(error.message)) quoteColumn = false; else if (!error) { quoteColumn = true; tot.quoted++; }
          }
        } else {
          tot.fail++; why[v.reason] = (why[v.reason] ?? 0) + 1; line += ` · FAIL (${v.reason})`;
          if (APPLY) {
            const nowIso = new Date().toISOString();
            const { data, error } = await sb.from('commitments')
              .update({ status: 'dismissed', resolved_reason: UNQUOTED_PROMISE_REASON, resolved_at: nowIso, updated_at: nowIso })
              .eq('id', r.id).eq('user_id', uid).eq('status', 'open').eq('direction', 'you_owe').select('id');
            if (error) line += ` ✗ ${error.message}`;
            else if (data?.length) {
              tot.dismissed++; line += ' → dismissed';
              // UNDOABLE: commitment_dismissed is a REVERSIBLE type — /api/restore reopens the row.
              const { logActivity } = await import('../lib/activity/log');
              await logActivity(raw, uid, {
                type: 'commitment_dismissed', title: `Not a promise (no first-person commitment in your email): ${r.description}`,
                entityType: 'commitment', entityId: r.id,
                metadata: { reason: UNQUOTED_PROMISE_REASON, floor: v.reason, auto: true, via: 'repair-unquoted-promises', version: COMMITMENT_EXTRACTION_VERSION, message: `email:${r.source_id}` },
              });
              await import('../lib/room/turns').then(({ settleAsksForItem }) => settleAsksForItem(raw as never, uid, 'commitment', r.id)).catch(() => 0);
              await import('../lib/home/bust-brief').then(({ softBustBrief }) => softBustBrief(raw as never, uid)).catch(() => {});
            }
          }
        }
      }
      console.log(line);
    }
    console.log(`▸ user ${uid.slice(0, 8)} · open you_owe from email since ${SINCE}: ${mine.length} · user-authored: ${authored.length} · proxy pass ${uPass} / fail ${uFail}`);
  }

  console.log('\n══ SUMMARY ══');
  console.log(`scanned=${tot.scanned} open you_owe email rows since ${SINCE} · user-authored=${tot.authored} · source unreadable=${tot.noSource}${tot.leftByLimit ? ` · left by --limit=${tot.leftByLimit}` : ''}`);
  console.log(`ZERO-AI PROXY (a first-person commitment phrase in the message's own words — a census signal, not the rule): pass=${tot.proxyPass} · fail=${tot.proxyFail}`);
  if (JUDGE) {
    console.log(`NEW RULE (judged): pass=${tot.pass} · fail=${tot.fail} ${JSON.stringify(why)} · failed calls (kept)=${tot.failedCalls}`);
    console.log(APPLY ? `dismissed=${tot.dismissed} (reversible, resolved_reason '${UNQUOTED_PROMISE_REASON}') · quotes stored=${tot.quoted}${quoteColumn === false ? ' (source_quote column not migrated yet — quotes skipped)' : ''}` : '(judged dry — pass --apply --yes to dismiss the failures)');
  } else {
    const calls = tot.authored - tot.leftByLimit;
    console.log(`AI part not run. --judge on this scope: ${calls} classification call(s) ≈ €${(calls * EST_EUR_PER_CALL).toFixed(3)} (€${EST_EUR_PER_CALL}/call).`);
  }
  if (refused.length) console.log(`guard refused ${refused.length} write(s): ${[...new Set(refused)].join(', ')}`);
}

if (/repair-unquoted-promises\.ts$/.test(process.argv[1] ?? '')) main().catch((e) => { console.error(e); process.exit(1); });
