// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE STALE-STAGING REPAIR (W13 — A STAGED FILE IS THE DELIVERABLE, OR IT ISN'T STAGED). GUARDED;
// DRY-RUN BY DEFAULT. W13.2: an OPTIONAL ACCELERATOR — the platform heals itself without it (every
// `require:` row carries the staging-law version it was verified under; THE RESOLVER re-verifies an
// older/unstamped row on its next touch: the prepare pass, the judge's serving edge, the draft doors).
// `--apply --yes` only makes that happen NOW, through THE SAME function
// (lib/prepare/requirements `reverifyItemStaging` → `reverifyStaleStaging` → `resolveRequirements`).
//
// Before W13 the staging law checked provenance and topic, never TIME and never KIND: a you_owe ask to
// ADD work to a report ("provide details on slides 7&8 … in the interim report") staged the report the
// client already had as the deliverable, and the draft riding it said the report "now includes" the new
// slides. This script CENSUSES every staged file (zero AI) and, applied, re-verifies each item holding
// an older-law row through the platform's own self-heal — whose demotions go through THE ONE unstage
// writer (`unstageRequirement` — the pointer row goes; the user's file is never touched; the reason is
// recorded; a new-work base stays as CONTEXT under `base:<label>`). Drafts that ride an unstaged base
// are then withdrawn by THE ONE READER (stampTruth: `baseAsAnswer`) — the script writes nothing to any
// draft; it re-reads them to count.
//
//   WHAT IT READS (always — service role, bounded, zero AI):
//     · resolver-staged requirement rows (`require:*`, source requirement_resolution, a file attached)
//     · pass doc-send drafts carrying a file (commitment `prepare-pass-docsend`, unsent)
//     · inbox prepared drafts carrying a file (`source_data.draft.attachment`, pending items)
//   and for each: the request's date + words (`requestFactsOf`), the file's own date (`kbFileAt`), the
//   stamped kind (rows staged under W13 carry it), then `stagedRowVerdict`:
//     violation — a judged new-work ask satisfied by a file from on/before the request, or an older
//                 file the request never names (decisive, zero AI)
//     suspect   — an older file the request DOES name, staged before the kind existed: the base of new
//                 work, or the very document asked for — only the reasoned kind can tell
//     ok        — nothing to do
//     stale     — (orthogonal) the row was verified under an OLDER staging law (or never stamped): the
//                 platform re-verifies it on its next touch; `--apply --yes` does it now.
//   --apply --yes: for every item holding a stale row, THE SAME self-heal the pass runs (the cached
//     judgment + the reasoned pick that carries the kind; est. < €0.02 per item — the dry run prints the
//     item count first). AI failure never unstages (the row stays stale, retried on the next touch).
//   (--judge is accepted for compatibility and ignored: the kind now always rides the re-verify.)
//
//   npx tsx scripts/repair-stale-staging.ts [--user email | --all] [--apply --yes] [--verbose]
//
// No real names are printed — ids (truncated) and counts only.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import {
  requestFactsOf, requestNamesFile, stagedRowVerdict, kindOf, effectiveFileAt, stagingLawStale, reverifyItemStaging, standingRequireRows,
  STAGING_LAW_VERSION, type RequirementKind,
} from '../lib/prepare/requirements';
import { kbFileAt, emailAttachmentDates } from '../lib/knowledge/resolve';

const argv = process.argv;
const APPLY = argv.includes('--apply');
const YES = argv.includes('--yes');
const VERBOSE = argv.includes('--verbose');
const userArg = argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null;

type Att = { fileId?: string; filename?: string; source?: string };
type Staged = {
  userId: string; itemKind: 'inbox' | 'commitment'; itemId: string; lane: 'require' | 'docsend' | 'inbox_draft';
  label: string; att: Att; kind: RequirementKind | null; stampedFileAt: string | null;
  /** W13.2 · verified under an older staging law (or never stamped) — the self-heal's target. */
  stale: boolean;
};

const short = (id: string) => id.slice(0, 8);

async function loadStaged(sb: SupabaseClient, userId: string): Promise<Staged[]> {
  const out: Staged[] = [];
  const pool = await fetchAllRows<{ id: string; kind: string; entity_id: string; task_id: string | null; type: string; metadata: Record<string, unknown> | null }>((from, to) =>
    sb.from('item_deliverables').select('id, kind, entity_id, task_id, type, metadata')
      .eq('user_id', userId).in('kind', ['email', 'commitment'])
      .or('task_id.like.require:%,task_id.eq.prepare-pass-docsend')
      .order('id').range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: unknown }>);
  for (const r of pool) {
    const m = r.metadata ?? {};
    const att = (m.attachment ?? null) as Att | null;
    if (!att?.fileId || (att.source && att.source !== 'kb')) continue;
    if (m.version_of || m.sent_at) continue;
    const itemKind = r.kind === 'commitment' ? 'commitment' as const : 'inbox' as const;
    if (String(r.task_id ?? '').startsWith('require:')) {
      if (m.source !== 'requirement_resolution' || m.via) continue; // a typed/user supply is never ours to unstage
      out.push({ userId, itemKind, itemId: r.entity_id, lane: 'require', label: String(m.requirement ?? String(r.task_id).slice(8)), att, kind: kindOf(m.requirementKind), stampedFileAt: (m.fileAt as string | null) ?? null, stale: stagingLawStale(m) });
    } else if (r.type === 'draft') {
      out.push({ userId, itemKind, itemId: r.entity_id, lane: 'docsend', label: `the updated version of "${att.filename ?? 'the document'}"`, att, kind: null, stampedFileAt: null, stale: false });
    }
  }
  const inbox = await fetchAllRows<{ id: string; draft: { attachment?: Att; sent_at?: string } | null }>((from, to) =>
    sb.from('inbox_items').select('id, draft:source_data->draft')
      .eq('user_id', userId).eq('status', 'pending').not('source_data->draft->attachment', 'is', null)
      .order('id').range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: unknown }>);
  for (const it of inbox) {
    const att = it.draft?.attachment ?? null;
    if (!att?.fileId || it.draft?.sent_at || (att.source && att.source !== 'kb')) continue;
    out.push({ userId, itemKind: 'inbox', itemId: it.id, lane: 'inbox_draft', label: `the updated version of "${att.filename ?? 'the document'}"`, att, kind: null, stampedFileAt: null, stale: false });
  }
  return out;
}

(async () => {
  if (APPLY && !YES) { console.error('--apply requires --yes (the repair removes staged pointer rows on real items).'); process.exit(2); }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const users: Array<{ id: string; email?: string }> = [];
  for (let page = 1; page <= 20; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    users.push(...(data?.users ?? []));
    if (!data?.users?.length || data.users.length < 200) break;
  }
  const targets = userArg ? users.filter((u) => u.email === userArg) : users;

  const c = {
    accounts: 0, staged: 0, byLane: { require: 0, docsend: 0, inbox_draft: 0 } as Record<string, number>,
    ok: 0, violation: 0, suspect: 0, unknownDates: 0, violationNewWork: 0, violationUnnamed: 0,
    staleRows: 0, staleItems: 0, reverified: 0, stillStale: 0, draftsWithdrawn: 0,
  };
  for (const u of targets) {
    const rows = await loadStaged(sb, u.id);
    if (!rows.length) continue;
    c.accounts++;
    // The files' own dates — one bounded read per account.
    const fileIds = [...new Set(rows.map((r) => String(r.att.fileId)))];
    const files = new Map<string, { filename: string; origin: { kind?: string; ref?: string } | null; last_modified_at: string | null; indexed_at: string | null; extracted_text?: string | null }>();
    for (let k = 0; k < fileIds.length; k += 200) {
      const { data, error } = await sb.from('knowledge_files').select('id, filename, origin, last_modified_at, indexed_at').in('id', fileIds.slice(k, k + 200));
      if (error) { console.error('knowledge_files read failed:', error.message); process.exit(1); }
      for (const f of (data ?? []) as Array<{ id: string; filename: string; origin: never; last_modified_at: string | null; indexed_at: string | null }>) files.set(f.id, f);
    }
    const attachedAt = await emailAttachmentDates(sb, u.id, [...files.values()]);
    const requestMemo = new Map<string, Awaited<ReturnType<typeof requestFactsOf>>>();
    const touched = new Set<string>();
    const staleItems = new Set<string>();
    for (const r of rows) {
      c.staged++; c.byLane[r.lane]++;
      const key = `${r.itemKind}:${r.itemId}`;
      if (!requestMemo.has(key)) requestMemo.set(key, await requestFactsOf(sb, u.id, { kind: r.itemKind, id: r.itemId }));
      const req = requestMemo.get(key)!;
      const f = files.get(String(r.att.fileId));
      const fileAt = effectiveFileAt({ fileAt: r.stampedFileAt ?? kbFileAt(f, attachedAt), filename: String(r.att.filename ?? f?.filename ?? '') });
      if (!fileAt || !req.requestAt) c.unknownDates++;
      const named = requestNamesFile(String(r.att.filename ?? f?.filename ?? ''), `${r.lane === 'require' ? r.label : ''}\n${req.requestText}`);
      const kind = r.kind;
      const verdict = stagedRowVerdict({ kind, fileAt, requestAt: req.requestAt, namedByRequest: named });
      c[verdict]++;
      if (verdict === 'violation') { if (kind === 'new_work') c.violationNewWork++; else c.violationUnnamed++; }
      if (r.stale) { c.staleRows++; staleItems.add(key); }
      if (VERBOSE && (verdict !== 'ok' || r.stale)) console.log(`  ${verdict.padEnd(9)} ${r.lane.padEnd(11)} ${r.itemKind}:${short(r.itemId)} kind=${kind ?? '—'} file=${fileAt?.slice(0, 10) ?? '?'} request=${req.requestAt?.slice(0, 10) ?? '?'} named=${named}${r.stale ? ' STALE-LAW' : ''}`);
    }
    c.staleItems += staleItems.size;
    // W13.2 · APPLY = THE PLATFORM'S OWN SELF-HEAL, now: the same function the pass and the serving
    // edge reach (never a second unstage path here).
    if (APPLY) {
      for (const key of staleItems) {
        const [kind, id] = key.split(':') as ['inbox' | 'commitment', string];
        const rv = await reverifyItemStaging(sb, u.id, { kind, id });
        if (rv.ran) { c.reverified++; touched.add(key); }
        const after = await standingRequireRows(sb, u.id, { itemKind: kind, itemId: id, labels: rows.filter((x) => `${x.itemKind}:${x.itemId}` === key && x.lane === 'require').map((x) => x.label) });
        c.stillStale += after.filter((x) => stagingLawStale(x.metadata)).length;
      }
    }
    // Drafts withdrawn — re-read through THE ONE READER (never written here).
    if (APPLY && touched.size) {
      const { preparedState } = await import('../lib/prepare/read');
      for (const key of touched) {
        const [kind, id] = key.split(':');
        const st = await preparedState(sb, u.id, { kind: kind === 'commitment' ? 'commitment' : 'inbox_item', id });
        c.draftsWithdrawn += st.all.filter((a) => a.baseAsAnswer || (a.falseClaim && a.attachment)).length;
      }
    }
  }
  console.log(`\nSTALE STAGING — ${APPLY ? 'APPLIED' : 'DRY RUN (read-only, zero AI)'}${userArg ? ' · one account' : ''}`);
  console.log(`  accounts with staged files ....... ${c.accounts}`);
  console.log(`  staged files ...................... ${c.staged}  (require rows ${c.byLane.require} · doc-send drafts ${c.byLane.docsend} · inbox drafts ${c.byLane.inbox_draft})`);
  console.log(`  ok ................................ ${c.ok}`);
  console.log(`  violation (decisive) .............. ${c.violation}  (new-work satisfied by an older file ${c.violationNewWork} · older file the request never names ${c.violationUnnamed})`);
  console.log(`  suspect (older file the request names, kind unjudged) ... ${c.suspect}`);
  console.log(`  rows with an unknown date (left as they are) ........... ${c.unknownDates}`);
  console.log(`  rows verified under an older staging law (< v${STAGING_LAW_VERSION}) ... ${c.staleRows} on ${c.staleItems} item(s) — the platform re-verifies these on its next touch`);
  if (APPLY) console.log(`  re-verified now ${c.reverified} item(s) · rows still stale (AI unavailable / verdict moved — retried on the next touch) ${c.stillStale} · drafts now withdrawn by the reader ${c.draftsWithdrawn}`);
  else console.log(`  (dry run — nothing written; --apply --yes runs the platform's own re-verify on the ${c.staleItems} item(s) now, est. < €0.02 each)`);
})().catch((e) => { console.error(e); process.exit(1); });
