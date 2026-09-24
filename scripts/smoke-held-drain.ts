/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE HELD LIST DRAINS (stabilization W8.6 — docs/laws-registry.md
 * `the-list-says-only-what-was-judged` · `no-silent-caps` · `exactly-once-deeds`).
 *
 * W8.3 made the held list honest ("Not yet judged", "Archive the newest 200 of 1,223"). Two gaps:
 *   1 · nothing DRAINED "Not yet judged" — the general judgment walk only reaches the spine's
 *       actionable candidates, and those rows are held precisely because the spine skips them;
 *   2 · a bulk deed STOPPED AT 200 — honest, and still not the deed the reader asked for.
 *
 *   H · THE NOT-JUDGED LANE — exists in the sweep, kind floor FIRST (zero AI), newest first, stated
 *       caps with the remainder REPORTED, idempotent through the judge's own cache, own slice.
 *   B · THE WHOLE GROUP — archive/trash act on the whole group to a stated bound, committed in PAGES
 *       through the one door (lease + cursor compare-and-set), progress persisted per page, one
 *       activity record per deed that /api/restore reverses AS ONE (every page), label truth.
 *
 * ZERO-AI, zero DB (an in-memory fake client for the batch flip), deterministic. Exit 1 on failure.
 *   npx tsx scripts/smoke-held-drain.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  planNotJudgedLane, emptyNotJudged, NOT_JUDGED_CAP_PER_RUN, NOT_JUDGED_FLOOR_CAP_PER_RUN, NOT_JUDGED_SLICE_MS,
  type NotJudgedRow,
} from '../lib/work/judgment-sweep';
import {
  MAX_DEED_ITEMS, DEED_PAGE_SIZE, MAX_REASONED_DEED_ITEMS, deedBoundFor, deedComplete, deedProgressLine, doneReceipt,
  breakdownLines, type BulkDeed,
} from '../lib/deeds/words';
import { bulkVerbLabel, bulkScopeLine } from '../lib/deeds/held-words-bulk';
import { REVERSIBLE_TYPE_ENTITY } from '../lib/activity/restore';
import { reopenInboxItems } from '../lib/activity/reopen';

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
let pass = 0; const failures: string[] = [];
const gate = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const TODAY = '2026-09-23';
let n = 0;
const R = (over: Partial<NotJudgedRow> = {}): NotJudgedRow => {
  const id = over.id ?? `r${++n}`;
  return { key: `inbox:${id}`, kind: 'inbox', id, reasonedKind: 'customer', ownership: 'you_owe', statedDue: null,
    activityAt: `2026-09-${String(10 + (n % 10)).padStart(2, '0')}T10:00:00Z`, neverJudged: true, ...over };
};

// ═══ H · THE NOT-JUDGED LANE ═══
console.log('\nH · THE NOT-JUDGED LANE — the heartbeat judges what the list says was never judged');
{
  const sweep = code('lib/work/judgment-sweep.ts');
  gate('H1 the lane exists in the sweep and runs under its OWN slice, before the general walk',
    /export async function runNotJudgedLane\(/.test(sweep)
    && sweep.indexOf('await runNotJudgedLane(admin, userId') > 0
    && sweep.indexOf('await runNotJudgedLane(admin, userId') < sweep.indexOf('const queue = [...nominated];')
    && /deadline - Date\.now\(\) >= NOT_JUDGED_SLICE_MS \+ 15_000/.test(sweep) && NOT_JUDGED_SLICE_MS > 0);
  gate('H2 the lane runs even when the spine has no candidates (held rows are exactly those the spine skips)',
    sweep.indexOf('await runNotJudgedLane(admin, userId') < sweep.indexOf('if (!candidates.length) return out;'));
  gate('H3 its population is the held set\'s deck-eligible rows with no CURRENT verdict + never-judged spine rows',
    /f\.budgetOverflow !== true\) continue/.test(sweep) && /f\.neverJudged !== true && f\.judgedCurrent !== true && f\.judgedNone !== true/.test(sweep)
    && /judgmentCandidates\(items\)/.test(sweep) && /if \(judged\.has\(key\)\) continue;/.test(sweep));
  gate('H4 no new AI tier — the EXISTING judge + the ONE consequence door',
    /const \{ judgeWork \} = await import\('@\/lib\/work\/judge'\)/.test(sweep) && /applyVerdictConsequences\(admin, userId, input, verdict\)/.test(sweep)
    && !/getAIClient|aiCreate|getSystemClient/.test(sweep));

  // THE KIND FLOOR FIRST — outcome, not wording.
  const pitch = R({ reasonedKind: 'cold_outreach', activityAt: '2026-01-01T00:00:00Z' });
  const otp = R({ reasonedKind: 'notification', ownership: 'none', activityAt: '2026-01-02T00:00:00Z' });
  const real = R({ reasonedKind: 'customer', activityAt: '2026-09-22T00:00:00Z' });
  const older = R({ reasonedKind: 'customer', activityAt: '2026-09-01T00:00:00Z' });
  const golf = R({ statedDue: '2026-07-16', activityAt: '2026-09-21T00:00:00Z' });
  const staleVer = R({ neverJudged: false, activityAt: '2026-09-23T00:00:00Z' });
  const pastCommit = R({ key: 'commitment:c1', kind: 'commitment', id: 'c1', statedDue: '2026-08-01' });
  const plan = planNotJudgedLane([golf, real, pitch, older, otp, staleVer, pastCommit, real], { todayISO: TODAY });
  gate('H5 THE KIND FLOOR FIRST — floored rows lead the order (zero-cost disposals before any AI)',
    plan.admitted[0].key === otp.key && plan.admitted[1].key === pitch.key && plan.floored.length === 2,
    plan.admitted.map((r) => r.key).join(','));
  gate('H6 then open rows NEWEST FIRST (never-judged before stale-version), then past-dated',
    plan.admitted.slice(2).map((r) => r.key).join(',') === [real.key, older.key, staleVer.key, golf.key].join(','),
    plan.admitted.slice(2).map((r) => r.key).join(','));
  gate('H7 a past-due COMMITMENT is left to LAW 2\'s expiry lane (counted, never judged twice)',
    plan.expiryOwned === 1 && !plan.admitted.some((r) => r.kind === 'commitment'));
  gate('H8 duplicates collapse (one key, one visit)', plan.population === 7);
  gate('H9 AI-possible is counted apart from the zero-cost floor (the estimate\'s multiplicand)', plan.aiPossible === 4);

  // CAPS STATED, REMAINDER REPORTED.
  const many = Array.from({ length: NOT_JUDGED_CAP_PER_RUN + 25 }, () => R());
  const floors = Array.from({ length: NOT_JUDGED_FLOOR_CAP_PER_RUN + 5 }, () => R({ reasonedKind: 'newsletter' }));
  const capped = planNotJudgedLane([...many, ...floors], { todayISO: TODAY });
  gate('H10 the per-run caps hold (floor cap + AI cap)', capped.aiPossible === NOT_JUDGED_CAP_PER_RUN
    && capped.admitted.length === NOT_JUDGED_CAP_PER_RUN + NOT_JUDGED_FLOOR_CAP_PER_RUN);
  gate('H11 NO SILENT CAP — everything the caps left is counted in leftBehind',
    capped.leftBehind === 30 && capped.population === capped.admitted.length + capped.leftBehind + capped.expiryOwned);
  gate('H12 the slice\'s own remainder joins leftBehind, and the sweep logs + reports it',
    /out\.leftBehind \+= queue\.length;/.test(sweep) && /lead the next run \(caps/.test(sweep)
    && /notJudged: NotJudgedLaneResult;/.test(sweep));
  gate('H13 a skipped lane SAYS SO (never an empty-looking zero)',
    /skipped: 'budget too small this run'/.test(sweep) && emptyNotJudged().skipped === null);

  // IDEMPOTENT.
  gate('H14 IDEMPOTENT — plan is pure and stable (same rows → same order)',
    JSON.stringify(planNotJudgedLane([golf, real, pitch], { todayISO: TODAY }).admitted.map((r) => r.key))
      === JSON.stringify(planNotJudgedLane([pitch, golf, real], { todayISO: TODAY }).admitted.map((r) => r.key)));
  gate('H15 IDEMPOTENT — a judged row leaves the population (it has a verdict), a same-day revisit is a cache hit, a failure is never cached',
    /if \(verdict\.failed\) \{ out\.failed\+\+; return; \}/.test(sweep) && /out\.fresh\+\+; else out\.cached\+\+;/.test(sweep)
    && /if \(f\.neverJudged !== true && !staleVersion\) continue;/.test(sweep));
  gate('H16 dry-run plans without judging (apply:false returns before the judge is imported)',
    /if \(opts\.apply === false \|\| !plan\.admitted\.length\) return \{ \.\.\.out, plan \};/.test(sweep)
    && sweep.indexOf('opts.apply === false') < sweep.indexOf("await import('@/lib/work/judge');\n  const { applyVerdictConsequences } = await import('@/lib/work/apply-verdict');\n  const queue = [...plan.admitted];"));

  const route = code('app/api/cron/judgment-sweep/route.ts');
  const fan = code('lib/work/sweep-fanout.ts');
  gate('H17 the cron reports the lane\'s tally (incl. leftBehind) and the per-user record stamps it',
    /notJudged\.leftBehind \+= r\.notJudged\.leftBehind/.test(route) && /notJudged(, asks)? \},/.test(route) // ⟲ W14.2: the ask lane's tally rides beside it
    && /notJudged: \{ population: r\.notJudged\.population, visited: r\.notJudged\.visited, leftBehind: r\.notJudged\.leftBehind/.test(fan));

  const bf = src('scripts/backfill-not-judged.ts');
  gate('H18 the one-shot backfill is GUARDED (dry-run default, explicit scope for --apply, --limit, cost estimate, read-only client)',
    /REFUSED: --apply needs an explicit scope/.test(bf) && /--limit/.test(bf) && /AI COST ESTIMATE/.test(bf)
    && /EST_EUR_PER_JUDGMENT/.test(bf) && /function readOnly\(/.test(bf) && /claimSweepJob\(sb, uid, 'judgment'\)/.test(bf));
}

// ═══ B · THE WHOLE GROUP ═══
console.log('\nB · THE WHOLE GROUP — a bulk deed acts on the group, paged through the one door');
{
  const bulk = code('lib/deeds/bulk.ts');
  gate('B1 archive/trash bound = the stated safety bound; unsubscribe/expire keep one page',
    deedBoundFor('archive') === MAX_DEED_ITEMS && deedBoundFor('trash') === MAX_DEED_ITEMS && MAX_DEED_ITEMS === 5000
    && deedBoundFor('unsubscribe') === MAX_REASONED_DEED_ITEMS && deedBoundFor('expire') === MAX_REASONED_DEED_ITEMS && MAX_REASONED_DEED_ITEMS === 200);
  gate('B2 prepare takes the group to the VERB\'S bound, reads ids in chunks (never one giant in())',
    /const bound = deedBoundFor\(verb\);/.test(bulk) && /\.slice\(0, bound\)/.test(bulk) && /readByIdsChunked/.test(bulk)
    && !/\.slice\(0, MAX_DEED_ITEMS\)/.test(bulk));
  gate('B3 the preview reads ONE page of mailbox targets and REPORTS the rest (unchecked)',
    /const checked = rows\.slice\(0, DEED_PAGE_SIZE\);/.test(bulk) && /breakdown\.unchecked = rows\.length - checked\.length/.test(bulk)
    && breakdownLines({ verb: 'archive', breakdown: { total: 1223, withMailbox: 190, noMailbox: 10, unchecked: 1023 } } as BulkDeed).some((l) => /1023 more messages/.test(l)));
  gate('B4 THE COMMIT PAGES the stored member list (a slice of existing.items, DEED_PAGE_SIZE at a time)',
    /const page = existing\.items\.slice\(cursor, cursor \+ DEED_PAGE_SIZE\);/.test(bulk) && /while \(cursor < total\)/.test(bulk) && DEED_PAGE_SIZE === 200);
  gate('B5 EXACTLY-ONCE — first claim on committedAt null; a resume claims the lease AND the cursor (compare-and-set)',
    /\.filter\('tasks->>committedAt', 'is', null\)/.test(bulk)
    && /q\.filter\('tasks->>leaseUntil', 'lt', nowIso\)\.filter\('tasks->progress->>cursor', 'eq', String\(cursor\)\)/.test(bulk)
    && /q\.filter\('tasks->>leaseId', 'eq', leaseId\)/.test(bulk) && /resumed\.updated === 0/.test(bulk));
  gate('B6 progress is PERSISTED after every page (lease-guarded); a failed save stops honestly',
    bulk.indexOf('const saved = await writeDeedGuarded(') > bulk.indexOf('outcomes.push(...pageOutcomes);')
    && /a page’s record could not be saved/.test(bulk));
  gate('B7 per member: only a PENDING row is acted on; a re-walked page recognises its own finished work',
    /if \(verb !== 'unsubscribe' && item\.status && item\.status !== 'pending'\)/.test(bulk) && /sd\.resolved_at >= claimedAt/.test(bulk));
  gate('B8 a complete or undone deed never acts again', /if \(deedComplete\(existing\) \|\| existing\.undoneAt\) return \{ ok: true, deed: existing, alreadyCommitted: true \};/.test(bulk));
  gate('B9 ONE activity record per deed, updated in place as pages land; unsubscribe carries no Undo type',
    /type: existing\.verb === 'unsubscribe' \? 'bulk_unsubscribe' : 'bulk_deed',/.test(bulk)
    && /from\('activity_events'\)\.update\(\{ title: title\.slice\(0, 500\), metadata \}\)/.test(bulk)
    && /if \(!deed\.loggedAt\)/.test(bulk));
  gate('B10 /api/restore reverses the deed AS ONE (every page) — reversible map + route branch + batch flip',
    REVERSIBLE_TYPE_ENTITY.bulk_deed === 'bulk_deed' && !('bulk_unsubscribe' in REVERSIBLE_TYPE_ENTITY)
    && /entityType === 'bulk_deed'/.test(code('app/api/restore/route.ts')) && /undoBulkDeed\(supabase, user\.id, entityId\)/.test(code('app/api/restore/route.ts'))
    && /const acted = \(deed\.outcomes \?\? \[\]\)\.filter\(\(o\) => o\.status === 'done' \|\| o\.status === 'partial'\)/.test(bulk)
    && /q\.filter\('tasks->>undoneAt', 'is', null\)/.test(bulk) && /claim\.updated === 0/.test(bulk));

  // Label truth — outcome.
  gate('B11 LABEL TRUTH — "Archive all 1,223" (the whole group); past the bound it names the bound',
    bulkVerbLabel('Archive', 1223, 0, deedBoundFor('archive')) === 'Archive all 1,223'
    && bulkVerbLabel('Archive', 6200, 0, deedBoundFor('archive')) === 'Archive the newest 5,000 of 6,200'
    && bulkVerbLabel('Unsubscribe', 1815, 0, deedBoundFor('unsubscribe')) === 'Unsubscribe the newest 200 of 1,815'
    && bulkScopeLine(1223, 1223) === null);
  gate('B12 the class row composes its label through the verb\'s own bound',
    /bulkVerbLabel\(VERB_WORD\[verb\], c\.count, picked\.size, deedBoundFor\(verb\)\)/.test(code('components/home/held-quiet.tsx')));

  // Progress truth — outcome.
  const paused = { id: 'd', verb: 'archive', classKey: null, className: null, items: [], breakdown: { total: 1223 }, intro: '', undoNote: '', createdAt: '',
    committedAt: 'x', tally: { done: 400, partial: 0, skipped: 0, failed: 0, left: 823, line: '400 archived' },
    progress: { cursor: 400, total: 1223, pagesDone: 2, pagesTotal: 7, left: 823, complete: false, stoppedBecause: null } } as unknown as BulkDeed;
  gate('B13 a paused deed is NOT done, and says what was done vs left',
    !deedComplete(paused) && deedProgressLine(paused) === '400 of 1,223 done so far · 823 left' && doneReceipt(paused) === deedProgressLine(paused));
  const legacy = { ...paused, progress: undefined } as BulkDeed;
  gate('B14 a pre-W8.6 deed (no progress record) reads as complete', deedComplete(legacy));
  const card = code('components/home/bulk-deed-card.tsx');
  gate('B15 the card keeps calling THE ONE DOOR while the cursor advances, then offers "Continue" (same door)',
    /const done = deedComplete\(deed\);/.test(card) && /if \(cursor <= prevCursor\) break;/.test(card)
    && /commitLabel: paused \? 'Continue' : COMMIT_LABEL\[deed\.verb\]/.test(card) && !/itemIds/.test(card));
}

// ═══ U · THE BATCH FLIP (outcome, in-memory) ═══
console.log('\nU · THE BATCH FLIP — every member the deed resolved, and only those, reopens');
(async () => {
  type Row = { id: string; user_id: string; status: string; source_data: Record<string, unknown> };
  const rows: Row[] = Array.from({ length: 450 }, (_, i) => ({
    id: `m${i}`, user_id: 'u1', status: i === 7 ? 'pending' : 'dismissed',
    source_data: { resolved_at: 'x', resolution_reason: i === 9 ? 'dismissed' : 'bulk_archived', subject: 's' },
  }));
  const fake = {
    from: () => {
      const f: Record<string, unknown> = {}; let op = 'select'; let patch: Partial<Row> = {};
      const b: Record<string, unknown> = {
        select: () => b, update: (p: Partial<Row>) => { op = 'update'; patch = p; return b; },
        eq: (c: string, v: unknown) => { f[c] = v; return b; }, in: (c: string, v: unknown[]) => { f[`in:${c}`] = v; return b; },
        then: (res: (v: unknown) => unknown) => {
          const hit = rows.filter((r) => (!f.id || r.id === f.id) && r.user_id === f.user_id
            && (!f.status || r.status === f.status) && (!f['in:id'] || (f['in:id'] as string[]).includes(r.id)));
          if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
          return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(res);
        },
      };
      return b;
    },
  };
  const r = await reopenInboxItems(fake as never, 'u1', rows.map((x) => x.id), { onlyReasons: ['bulk_archived'] });
  gate('U1 across pages (450 members > one chunk) every member THIS deed resolved reopens',
    r.reopened === 448 && rows.filter((x) => x.status === 'pending').length === 449, JSON.stringify(r));
  gate('U2 a row the user moved since, or resolved by another door, is left alone (counted skipped)',
    r.skipped === 2 && rows[9].status === 'dismissed');
  gate('U3 the flip clears the resolution stamps (the item leaves the Day-cleared ring)',
    rows[0].source_data.resolved_at === undefined && rows[0].source_data.resolution_reason === undefined);
})().then(() => {
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
});
