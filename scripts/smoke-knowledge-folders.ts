// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE KNOWLEDGE FOLDERS SUITE (permanent — the Sep 2 folders surface).
//
// The laws this suite makes un-decayable:
//   K1  HONEST NUMBERS — every number the Knowledge panel speaks comes from a real COUNT query,
//       never from the length of a capped list. The bug it retires: the overview read `.limit(400)`
//       and reported `rows.length` as the inventory, so a 1,046-file account was told "400
//       indexed". Proven twice: against a SEEDED >PAGE fixture on the probe host, and READ-ONLY
//       against the largest real account in the database (>1,000 files today).
//   K2  A FOLDER SHOWS, EVEN EMPTY — the seed kit lands folder packs on every enterprise member;
//       a seeded folder nobody has filled yet must still render (the owner's find).
//   K3  THE KIND SPLIT IS TOTAL — meeting + attachment + upload + generated == total, and the
//       SQL half of the kind definition agrees with the row-level one (fork them and a tab lies).
//   K4  ONE FOLDER SOURCE — the panel and the Studio `read_kb_folder` picker read the SAME route,
//       so a folder created here is pickable in a workflow step immediately.
//   K5  A FILE LANDS IN ITS FOLDER AT REGISTRATION — the upload confirm door carries folderId into
//       the row AND into the indexer; the panel sends it. (Source floor — see the honesty note.)
//   K6  MOVE IS THE EXISTING DOOR — /api/drive/move `kb_file`, and the read reflects the move.
//   K7  A FOLDER DIES ONLY EMPTY — the server REFUSES a non-empty delete (409), and refuses to
//       rename or delete a system folder. Simplicity over cascade semantics.
//   K8  SEARCH SEES THE WHOLE BASE — a match that sits far past the first page is still found
//       (the old panel filtered the painted slice, so it could not have found it).
//   K9  ONE NAME, ONE FOLDER — a workflow step binds a folder BY NAME, so a duplicate name is
//       refused at creation.
//   K10 THE SUM LAW (the badge-points-at-its-rows doctrine) — for EVERY tab, the count equals the
//       rows underneath it: loose + Σ folder counts, under that kind. Asserted on the probe AND on
//       live mixed-inventory accounts. The walk found it broken (Uploads read 997 over a folder
//       holding 1,002) because `generated` overlapped `meeting` and `upload` was then derived by
//       SUBTRACTION; ONE predicate ladder now serves tab counts, folder counts and listings alike.
//   K11 THE RENAME HEAL — a folder is bound BY NAME (read_kb_folder's `folder`, match_to_profiles'
//       `profiles_folder`, the profile manifest's item_plans key), so a rename carries its pointers
//       with it or it silently unhooks live work. Proven end to end through the SAME function the
//       route calls; a duplicate-name rename is refused exactly as creation is.
//
// HONESTY NOTE — what is asserted live vs. by source floor: `buildKnowledgeOverview` /
// `listKbFiles` are called for real against the probe host and against live accounts. The HTTP
// doors (`/api/drive/upload/{presign,confirm}`, `/api/drive/move`, `/api/drive/folders*`) all
// authenticate through the cookie session, which a CLI suite has no way to mint — a full
// presign→PUT→confirm round trip is not reachable from here. Those are asserted as SOURCE FLOORS
// over the comment-stripped route code, plus a live DB proof of the state each door writes.
//
// Zero AI. Run: npx tsx --env-file=.env.local scripts/smoke-knowledge-folders.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolveProbeUser } from './probe-user';
import { buildKnowledgeOverview, listKbFiles, kindOfRow, KB_PAGE } from '../lib/knowledge/overview';
import { renameKnowledgeFolder, FOLDER_CONFIG_KEYS } from '../lib/knowledge/rename-folder';
import { PROFILE_MANIFEST_KIND } from '../lib/matching/manifest';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const note = (t: string) => console.log(`  · ${t}`);

/** A file's CODE, comments removed — a floor must never be satisfied by a sentence about itself. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = async (p: string) => codeOf(await readFile(p, 'utf8'));

const SEEDED = 420;          // > KB_PAGE and > the retired 400-row cap, deliberately
const TAG = `smoke-kbf-${randomUUID().slice(0, 8)}`;

async function ensureSource(sb: SupabaseClient, userId: string): Promise<string> {
  const { data } = await sb.from('knowledge_sources').select('id')
    .eq('user_id', userId).eq('provider', 'augmtd').limit(1).maybeSingle();
  if (data) return (data as { id: string }).id;
  const { data: made, error } = await sb.from('knowledge_sources')
    .insert({ user_id: userId, provider: 'augmtd', folder_id: 'augmtd', folder_name: 'AUGMTD Files', status: 'ready' })
    .select('id').single();
  if (error || !made) throw new Error(`cannot provision a knowledge source: ${error?.message}`);
  return (made as { id: string }).id;
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const probeId = await resolveProbeUser(admin);
  console.log(`probe host ${probeId}`);

  let folderA: string | null = null, folderB: string | null = null, folderEmpty: string | null = null;

  try {
    const sourceId = await ensureSource(admin, probeId);

    // ── fixtures: two folders + one deliberately empty one, and SEEDED rows in A ───────────────
    const mkFolder = async (name: string) => {
      const { data, error } = await admin.from('drive_folders')
        .insert({ user_id: probeId, name }).select('id').single();
      if (error || !data) throw new Error(`folder fixture failed: ${error?.message}`);
      return (data as { id: string }).id;
    };
    folderA = await mkFolder(`${TAG} Role profiles`);
    folderB = await mkFolder(`${TAG} Archive`);
    folderEmpty = await mkFolder(`${TAG} Seeded but empty`);

    const rows = Array.from({ length: SEEDED }, (_, i) => ({
      user_id: probeId, source_id: sourceId,
      provider_file_id: `${TAG}/${String(i).padStart(4, '0')}.txt`,
      filename: i === SEEDED - 1 ? `${TAG}-needle-far-past-the-first-page.txt` : `${TAG} profile ${String(i).padStart(4, '0')}.txt`,
      mime_type: 'text/plain', size_bytes: 100 + i, folder_id: folderA,
      // Oldest LAST so the needle (i = SEEDED-1) sorts to the very END of the newest-first list —
      // it is unreachable by any first page, which is the whole point of K8.
      indexed_at: new Date(Date.now() - i * 60_000).toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from('knowledge_files').insert(rows.slice(i, i + 200));
      if (error) throw new Error(`fixture insert failed: ${error.message}`);
    }
    note(`seeded ${SEEDED} files into one folder, plus an empty folder`);

    // ── K1 — HONEST NUMBERS ───────────────────────────────────────────────────────────────────
    console.log('\nK1 — HONEST NUMBERS (a count is a count, never a list length):');
    const ov = await buildKnowledgeOverview(admin, probeId, { kind: 'all' });
    ok('the total counts every file, not the first page', ov.counts.total >= SEEDED, `total=${ov.counts.total}`);
    const a = ov.folders.find((f) => f.id === folderA);
    ok('the folder speaks its TRUE count', a?.count === SEEDED, `${a?.count} vs ${SEEDED}`);
    ok('…while the served rows stay a bounded page', ov.loose.files.length <= KB_PAGE, `${ov.loose.files.length}`);
    const pageA = await listKbFiles(admin, probeId, { folderId: folderA });
    ok('a folder page ships ≤ KB_PAGE rows but reports the whole count',
      pageA.files.length <= KB_PAGE && pageA.count === SEEDED, `${pageA.files.length} rows / count ${pageA.count}`);
    ok('…and says there is more', pageA.hasMore === true);
    const pageA2 = await listKbFiles(admin, probeId, { folderId: folderA, offset: KB_PAGE });
    ok('the next page is different rows (paging is real)',
      pageA2.files.length > 0 && !pageA2.files.some((f) => pageA.files.some((g) => g.id === f.id)));
    ok('indexed + pending == total (no row is unaccounted for)',
      ov.counts.indexed + ov.counts.pending === ov.counts.total,
      `${ov.counts.indexed} + ${ov.counts.pending} vs ${ov.counts.total}`);

    // THE LIVE PROOF — read-only, against the biggest real account in the database. This is the
    // account shape the retired cap lied about; the assertion is that the served number is the
    // real number, whatever it is today.
    {
      const { data: folderRows } = await admin.from('drive_folders').select('user_id').limit(500);
      const candidates = [...new Set((folderRows ?? []).map((r: { user_id: string }) => r.user_id))]
        .filter((u) => u !== probeId);
      let biggest: { id: string; n: number } | null = null;
      for (const u of candidates) {
        const { count } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true }).eq('user_id', u);
        if ((count ?? 0) > (biggest?.n ?? 0)) biggest = { id: u, n: count ?? 0 };
      }
      if (biggest && biggest.n > 400) {
        const live = await buildKnowledgeOverview(admin, biggest.id, { kind: 'all' });
        ok(`a real >400-file account reports its REAL total (${live.counts.total}), not 400`,
          live.counts.total === biggest.n && live.counts.total > 400, `${live.counts.total} vs ${biggest.n}`);
        ok('…and no served array silently carries that count',
          live.loose.files.length <= KB_PAGE && live.folders.every((f) => f.count <= live.counts.total));
        const heaviest = live.folders.slice().sort((x, y) => y.count - x.count)[0];
        if (heaviest) {
          const { count: real } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true })
            .eq('user_id', biggest.id).eq('folder_id', heaviest.id);
          ok(`its heaviest folder count is the DB truth (${heaviest.name.slice(0, 24)}: ${heaviest.count})`,
            heaviest.count === (real ?? -1), `${heaviest.count} vs ${real}`);
        }
      } else {
        note('no live account over 400 files found — the seeded fixture carries K1 alone');
      }
    }

    // ── K2 — A FOLDER SHOWS, EVEN EMPTY ───────────────────────────────────────────────────────
    console.log('\nK2 — A FOLDER SHOWS, EVEN EMPTY (the seeded-pack find):');
    ok('an empty folder is in the served list', ov.folders.some((f) => f.id === folderEmpty));
    ok('…wearing a zero, not absent', ov.folders.find((f) => f.id === folderEmpty)?.count === 0);
    ok('every folder the user owns is served (no cap on the folder list)',
      ov.folders.filter((f) => f.name.startsWith(TAG)).length === 3);

    // ── K3 — THE KIND SPLIT IS TOTAL ──────────────────────────────────────────────────────────
    console.log('\nK3 — THE KIND SPLIT IS TOTAL (the SQL half agrees with the row half):');
    ok('meeting + attachment + upload + generated == total',
      ov.counts.meeting + ov.counts.attachment + ov.counts.upload + ov.counts.generated === ov.counts.total,
      `${ov.counts.meeting}+${ov.counts.attachment}+${ov.counts.upload}+${ov.counts.generated} vs ${ov.counts.total}`);
    ok('kindOfRow is total and structural (prefix → kind, augmtd source → generated)',
      kindOfRow({ provider_file_id: 'transcript::x', source_id: null }, []) === 'meeting' &&
      kindOfRow({ provider_file_id: 'email_attachment::x', source_id: null }, []) === 'attachment' &&
      kindOfRow({ provider_file_id: 'anything', source_id: 's' }, ['s']) === 'generated' &&
      kindOfRow({ provider_file_id: 'anything', source_id: 's' }, []) === 'upload');
    // THE PRECEDENCE, both halves. A transcript that ALSO hangs off the augmtd source is a
    // MEETING and nothing else — the overlap that made `generated` and `meeting` both claim 5 rows
    // on the owner's account, which the subtraction then subtracted twice.
    ok('a transcript on the augmtd source is a meeting, NEVER also generated',
      kindOfRow({ provider_file_id: 'transcript::x', source_id: 's' }, ['s']) === 'meeting');
    ok('an attachment on the augmtd source is an attachment, NEVER also generated',
      kindOfRow({ provider_file_id: 'email_attachment::x', source_id: 's' }, ['s']) === 'attachment');
    ok('the upload count is COUNTED, never derived by subtraction',
      !/total\s*-\s*meeting\s*-\s*attachment\s*-\s*generated/.test(await read('lib/knowledge/overview.ts')) &&
      /applyKind\(q,\s*'upload'/.test(await read('lib/knowledge/overview.ts')));
    {
      // The fixtures are `generated` (they hang off the augmtd source) — the SQL filter must agree
      // with the row-level verdict on exactly the same rows.
      const gen = await buildKnowledgeOverview(admin, probeId, { kind: 'generated' });
      ok('a kind filter re-counts the FOLDER too (not just the painted rows)',
        gen.folders.find((f) => f.id === folderA)?.count === SEEDED,
        `${gen.folders.find((f) => f.id === folderA)?.count}`);
      const mt = await buildKnowledgeOverview(admin, probeId, { kind: 'meeting' });
      ok('a kind with nothing in this folder counts zero, and the folder still renders',
        mt.folders.find((f) => f.id === folderA)?.count === 0 && mt.folders.some((f) => f.id === folderA));
    }

    // ── K4 — ONE FOLDER SOURCE ────────────────────────────────────────────────────────────────
    console.log('\nK4 — ONE FOLDER SOURCE (the panel and the Studio picker read the same door):');
    const studio = await read('components/work/studio-builder.tsx');
    const panel = await read('components/knowledge/knowledge-panel.tsx');
    ok('the Studio read_kb_folder picker reads /api/drive/folders', /KbFolderPickerField[\s\S]{0,600}?['"]\/api\/drive\/folders['"]/.test(studio));
    ok('the panel creates folders through that same route',
      /['"]\/api\/drive\/folders['"][\s\S]{0,200}?method:\s*['"]POST['"]/.test(panel));
    {
      // A folder created here is visible to the picker's exact query, immediately.
      const { data: seen } = await admin.from('drive_folders')
        .select('id, name, parent_id, is_system, system_key, created_at')
        .eq('user_id', probeId).order('is_system', { ascending: false }).order('name', { ascending: true });
      ok('a folder created here is in the picker\'s own query result',
        (seen ?? []).some((f: { id: string }) => f.id === folderA));
    }
    ok('the overview module is the ONE place the numbers are computed (the route is a door)',
      /buildKnowledgeOverview/.test(await read('app/api/knowledge/overview/route.ts')) &&
      !/limit\(400\)/.test(await read('app/api/knowledge/overview/route.ts')));

    // ── K5 — A FILE LANDS IN ITS FOLDER AT REGISTRATION ───────────────────────────────────────
    console.log('\nK5 — A FILE LANDS IN ITS FOLDER AT REGISTRATION (source floor + state proof):');
    const confirm = await read('app/api/drive/upload/confirm/route.ts');
    ok('confirm accepts folderId', /folderId/.test(confirm));
    ok('…writes it on the row at registration', /folderId\s*\?\s*\{\s*folder_id:\s*folderId\s*\}/.test(confirm));
    ok('…and hands it to the indexer (so chunks land filed too)', /indexUploadedFile\([\s\S]{0,400}?folderId/.test(confirm));
    ok('the panel sends folderId with the confirm, never a post-move',
      /upload\/confirm[\s\S]{0,400}?folderId\s*\?\s*\{\s*folderId\s*\}/.test(panel));
    ok('a knowledge_files row genuinely carries folder_id (the column the door writes)',
      pageA.files.every((f) => f.folderId === folderA));
    note('a full presign→PUT→confirm round trip needs a cookie session — not reachable from a CLI suite');

    // ── K6 — MOVE IS THE EXISTING DOOR ────────────────────────────────────────────────────────
    console.log('\nK6 — MOVE IS THE EXISTING DOOR:');
    const moveSrc = await read('app/api/drive/move/route.ts');
    ok('the move door updates knowledge_files.folder_id for kb_file',
      /kb_file[\s\S]{0,400}?knowledge_files[\s\S]{0,200}?update\(\{\s*folder_id:\s*folderId/.test(moveSrc));
    ok('the panel moves through THAT route, not a new one',
      /['"]\/api\/drive\/move['"][\s\S]{0,240}?type:\s*['"]kb_file['"]/.test(panel));
    {
      const victim = pageA.files[0];
      const { error } = await admin.from('knowledge_files')
        .update({ folder_id: folderB }).eq('id', victim.id).eq('user_id', probeId);
      ok('the move writes', !error, error?.message);
      const after = await buildKnowledgeOverview(admin, probeId, { kind: 'all' });
      ok('the destination count went up', after.folders.find((f) => f.id === folderB)?.count === 1);
      ok('the source count went down', after.folders.find((f) => f.id === folderA)?.count === SEEDED - 1);
      const inB = await listKbFiles(admin, probeId, { folderId: folderB });
      ok('the read reflects the move (the file is served under its new folder)',
        inB.files.some((f) => f.id === victim.id && f.folderId === folderB));
      await admin.from('knowledge_files').update({ folder_id: folderA }).eq('id', victim.id);
    }
    {
      const loose = pageA.files[1];
      await admin.from('knowledge_files').update({ folder_id: null }).eq('id', loose.id).eq('user_id', probeId);
      const looseRead = await listKbFiles(admin, probeId, { folderId: null });
      ok('"No folder" is a real destination, not an absence',
        looseRead.files.some((f) => f.id === loose.id && f.folderId === null));
      await admin.from('knowledge_files').update({ folder_id: folderA }).eq('id', loose.id);
    }

    // ── K7 — A FOLDER DIES ONLY EMPTY ─────────────────────────────────────────────────────────
    console.log('\nK7 — A FOLDER DIES ONLY EMPTY (the server refuses, the panel just hides):');
    const folderRoute = await read('app/api/drive/folders/[id]/route.ts');
    ok('DELETE counts the folder\'s files before deleting',
      /knowledge_files[\s\S]{0,200}?count:\s*['"]exact['"][\s\S]{0,200}?eq\(['"]folder_id['"],\s*id\)/.test(folderRoute));
    ok('…and REFUSES a non-empty folder with a 409', /fileCount[\s\S]{0,300}?status:\s*409/.test(folderRoute));
    ok('…child folders are refused too (no silent cascade)', /childCount[\s\S]{0,200}?status:\s*409/.test(folderRoute));
    // The two doors guard separately now: DELETE in the route, RENAME inside the heal module the
    // route delegates to (K11 proves the rename half live as well).
    ok('a system folder cannot be DELETED (route guard)', /is_system[\s\S]{0,220}?status:\s*409/.test(folderRoute));
    ok('…nor RENAMED (the heal refuses before touching anything)',
      /is_system[\s\S]{0,160}?status:\s*409/.test(await read('lib/knowledge/rename-folder.ts')));
    ok('the panel only offers delete on a zero-count folder', /f\.count\s*===\s*0\s*&&/.test(panel));
    ok('the panel\'s folder delete is two-step (confirm, then the deed)',
      /confirmFolderDel/.test(panel) && /deleteFolder\(f\.id\)/.test(panel));
    {
      const { count } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true })
        .eq('user_id', probeId).eq('folder_id', folderA);
      ok('the guard\'s own read sees the files it must refuse over', (count ?? 0) === SEEDED, `${count}`);
      // The empty folder is genuinely deletable: prove the state the guard would allow.
      const { count: emptyCount } = await admin.from('knowledge_files').select('id', { count: 'exact', head: true })
        .eq('user_id', probeId).eq('folder_id', folderEmpty);
      ok('an empty folder reads zero, so the guard lets it go', (emptyCount ?? 0) === 0);
      const { error: delErr } = await admin.from('drive_folders').delete().eq('id', folderEmpty).eq('user_id', probeId);
      ok('…and the delete succeeds', !delErr, delErr?.message);
      folderEmpty = null;
    }

    // ── K8 — SEARCH SEES THE WHOLE BASE ───────────────────────────────────────────────────────
    console.log('\nK8 — SEARCH SEES THE WHOLE BASE (not the painted slice):');
    const needle = await listKbFiles(admin, probeId, { q: `${TAG}-needle` });
    ok('a match sitting far past the first page is found', needle.count === 1 && needle.files.length === 1,
      `count=${needle.count}`);
    ok('…and it is genuinely past the page boundary',
      !pageA.files.some((f) => f.filename.includes('-needle')));
    ok('search is server-side in the panel (it queries the files door, not the loaded rows)',
      /filesUrl\(\{\s*q:/.test(panel));
    ok('the semantic hits are hydrated through the same door (ids → files)', /ids:\s*missing\.join/.test(panel));
    {
      const scoped = await listKbFiles(admin, probeId, { q: `${TAG}-needle`, kind: 'meeting' });
      ok('a search still respects the active kind tab', scoped.count === 0);
    }

    // ── K9 — ONE NAME, ONE FOLDER ─────────────────────────────────────────────────────────────
    console.log('\nK9 — ONE NAME, ONE FOLDER (a step binds a folder by NAME):');
    const foldersRoute = await read('app/api/drive/folders/route.ts');
    ok('creation refuses a duplicate name, case-insensitively',
      /ilike\(['"]name['"],\s*name\.trim\(\)\)/.test(foldersRoute) && /status:\s*409/.test(foldersRoute));
    ok('the rename affordance STATES the heal (no longer a warning)',
      /Rename[^"']*follow the rename/.test(await readFile('components/knowledge/knowledge-panel.tsx', 'utf8')));

    // ── K11 — THE RENAME HEAL ─────────────────────────────────────────────────────────────────
    // A folder is bound BY NAME (read_kb_folder's `folder`, match_to_profiles' `profiles_folder`,
    // and the profile manifest's item_plans key), so a bare rename silently unhooks every pointer.
    // The rename must carry them with it — proven end to end through the SAME function the route
    // calls, on a throwaway workflow and manifest.
    console.log('\nK11 — THE RENAME HEAL (a rename follows its pointers):');
    {
      const before = `${TAG} Profiles before`;
      const after = `${TAG} Profiles after`;
      let wfId: string | null = null, healFolder: string | null = null;
      try {
        const { data: fRow } = await admin.from('drive_folders')
          .insert({ user_id: probeId, name: before }).select('id').single();
        healFolder = (fRow as { id: string }).id;

        const { data: wf } = await admin.from('workflows').insert({
          user_id: probeId, name: `${TAG} matcher`, status: 'draft',
          steps: [
            { type: 'tool', tool: 'get_pt_tenders', config: { structured_output: true } },
            { type: 'tool', tool: 'match_to_profiles', config: { profiles_folder: before, max_matches_per_item: 5 } },
            // A DIFFERENT folder must be left alone — a heal that re-points everything is a bug.
            { type: 'tool', tool: 'read_kb_folder', config: { folder: `${TAG} untouched` } },
          ],
        }).select('id').single();
        wfId = (wf as { id: string }).id;

        await admin.from('item_plans').upsert({
          user_id: probeId, kind: PROFILE_MANIFEST_KIND, entity_id: before,
          tasks: { version: 1, folder: before, syncedAt: new Date().toISOString(), profiles: [{ profileId: 'p1', name: 'Placeholder', keys: ['k'], badges: [], rank: 1 }] } as never,
        }, { onConflict: 'user_id,kind,entity_id' });

        const res = await renameKnowledgeFolder(admin, probeId, healFolder, after);
        ok('the rename succeeds', res.ok === true, res.ok ? '' : res.error);
        if (res.ok) {
          ok('it reports exactly ONE re-pointed step', res.repointedSteps === 1, `${res.repointedSteps}`);
          ok('…in one workflow, and says the manifest moved', res.repointedWorkflows === 1 && res.manifestMoved === true);
          ok('the folder row wears the new name', res.folder.name === after);
        }

        const { data: wfAfter } = await admin.from('workflows').select('steps').eq('id', wfId).single();
        const steps = (wfAfter as { steps: Array<{ tool?: string; config?: Record<string, unknown> }> }).steps;
        ok('the match_to_profiles step follows the rename',
          steps[1]?.config?.profiles_folder === after, String(steps[1]?.config?.profiles_folder));
        ok('…and its sibling config survives untouched', steps[1]?.config?.max_matches_per_item === 5);
        ok('a step naming a DIFFERENT folder is left alone',
          steps[2]?.config?.folder === `${TAG} untouched`, String(steps[2]?.config?.folder));
        ok('a step with no folder key is untouched', steps[0]?.config?.structured_output === true);

        const { data: manAfter } = await admin.from('item_plans').select('entity_id, tasks')
          .eq('user_id', probeId).eq('kind', PROFILE_MANIFEST_KIND).eq('entity_id', after).maybeSingle();
        ok('the manifest key moved with the folder', !!manAfter);
        ok('…and the manifest names the new folder inside itself (or the matcher disowns it)',
          (manAfter as { tasks: { folder?: string } } | null)?.tasks?.folder === after);
        const { data: manOld } = await admin.from('item_plans').select('id')
          .eq('user_id', probeId).eq('kind', PROFILE_MANIFEST_KIND).eq('entity_id', before).maybeSingle();
        ok('…leaving nothing behind at the old key', !manOld);

        // A rename onto an EXISTING folder name is refused, exactly as creation is.
        const dupe = await renameKnowledgeFolder(admin, probeId, healFolder, `${TAG} Archive`);
        ok('a rename to a duplicate name is refused with a 409',
          dupe.ok === false && dupe.status === 409, dupe.ok ? 'accepted!' : `${dupe.status}`);
        const { data: stillNamed } = await admin.from('drive_folders').select('name').eq('id', healFolder).single();
        ok('…and the refusal changed nothing', (stillNamed as { name: string }).name === after);

        ok('a system folder cannot be renamed through the heal either',
          await (async () => {
            const { data: sys } = await admin.from('drive_folders')
              .insert({ user_id: probeId, name: `${TAG} sys`, is_system: true }).select('id').single();
            const r = await renameKnowledgeFolder(admin, probeId, (sys as { id: string }).id, `${TAG} renamed sys`);
            await admin.from('drive_folders').delete().eq('id', (sys as { id: string }).id);
            return r.ok === false && r.status === 409;
          })());

        ok('the route and any script share ONE implementation (no second rename path)',
          /renameKnowledgeFolder/.test(await read('app/api/drive/folders/[id]/route.ts')) &&
          !/drive_folders[\s\S]{0,120}?update\(\{\s*name:/.test(await read('app/api/drive/folders/[id]/route.ts')));
        ok('the panel surfaces what followed the rename',
          /repointedSteps[\s\S]{0,200}?workflow step/.test(await read('components/knowledge/knowledge-panel.tsx')));
        ok('the folder-config key table covers both by-name tools',
          FOLDER_CONFIG_KEYS.read_kb_folder === 'folder' && FOLDER_CONFIG_KEYS.match_to_profiles === 'profiles_folder');
      } finally {
        if (wfId) await admin.from('workflows').delete().eq('id', wfId);
        await admin.from('item_plans').delete().eq('user_id', probeId).eq('kind', PROFILE_MANIFEST_KIND)
          .in('entity_id', [`${TAG} Profiles before`, `${TAG} Profiles after`]);
        if (healFolder) await admin.from('drive_folders').delete().eq('id', healFolder);
      }
    }

    // ── K10 — THE SUM LAW (the badge points at its rows) ──────────────────────────────────────
    // Every tab count must equal the rows underneath it: loose + Σ folders, UNDER THAT KIND. This
    // is the law the owner's walk caught broken (Uploads said 997 over a folder holding 1,002) —
    // it is enforced here, on live data, for every tab, not observed once.
    console.log('\nK10 — THE SUM LAW (tab count == loose + Σ folders, every kind, live data):');
    const KINDS = ['all', 'meeting', 'attachment', 'upload', 'generated'] as const;
    const sumLaw = async (label: string, userId: string) => {
      for (const k of KINDS) {
        const o = await buildKnowledgeOverview(admin, userId, { kind: k });
        const tab = k === 'all' ? o.counts.total : o.counts[k];
        const rows = o.loose.count + o.folders.reduce((acc, f) => acc + f.count, 0);
        ok(`${label} · ${k}: tab ${tab} == loose ${o.loose.count} + folders ${rows - o.loose.count}`,
          tab === rows, `tab ${tab} vs rows ${rows}`);
      }
      const all = await buildKnowledgeOverview(admin, userId, { kind: 'all' });
      ok(`${label} · the four kinds partition the base (no row counted twice, none dropped)`,
        all.counts.meeting + all.counts.attachment + all.counts.upload + all.counts.generated === all.counts.total,
        `${all.counts.meeting}+${all.counts.attachment}+${all.counts.upload}+${all.counts.generated} vs ${all.counts.total}`);
      ok(`${label} · the header line reconciles with All (indexed + processing == total)`,
        all.counts.indexed + all.counts.pending === all.counts.total,
        `${all.counts.indexed} + ${all.counts.pending} vs ${all.counts.total}`);
    };
    await sumLaw('probe', probeId);
    {
      // …and against every account carrying real, MIXED inventory — the probe's fixtures are all
      // one kind, so only a live account can catch a precedence overlap between two kinds.
      const { data: kinds } = await admin.from('knowledge_files')
        .select('user_id').like('provider_file_id', 'transcript::%').limit(400);
      const mixed = [...new Set((kinds ?? []).map((r: { user_id: string }) => r.user_id))].slice(0, 3);
      if (!mixed.length) note('no live account with transcripts found — the probe carries K10 alone');
      for (const u of mixed) await sumLaw(`live ${u.slice(0, 8)}`, u);
    }

  } finally {
    // ── sweep every fixture, always ───────────────────────────────────────────────────────────
    await admin.from('knowledge_files').delete().eq('user_id', probeId).like('provider_file_id', `${TAG}/%`);
    for (const f of [folderA, folderB, folderEmpty]) {
      if (f) await admin.from('drive_folders').delete().eq('id', f).eq('user_id', probeId);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
