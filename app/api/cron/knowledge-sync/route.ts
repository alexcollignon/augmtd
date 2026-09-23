import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { indexSource } from '@/lib/knowledge/indexer';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { fetchAllRows } from '@/lib/utils/fetch-all';

export const maxDuration = 800; // Pro+Fluid — one Drive/OneDrive source can take minutes (extract → summarize → embed)

// SCHEDULE: NOT SCHEDULED — deliberately absent from vercel.json (W9.5, Sep 23). The reason, found
// in code before scheduling it daily at 02:15 (the orchestrator's decision, made conditional on the
// route being SAFE):
//
//   UNSAFE-1 · THE UNCHANGED-FILE SKIP NEVER FIRES. lib/knowledge/indexer.ts `indexSource` skips a
//     file when `existingMap.get(file.id) === modifiedAt` — a STRING compare between the stored
//     `knowledge_files.last_modified_at` (TIMESTAMPTZ, served by PostgREST as `…+00:00`) and the
//     provider's stamp (Drive `modifiedTime` / Graph `lastModifiedDateTime`, `…Z` / `….000Z`). The
//     two spellings of the same instant never compare equal, so EVERY file of EVERY source is
//     re-downloaded, re-OCR'd, re-summarized (one AI call per chunk batch) and re-embedded on every
//     run, and its chunks are deleted and re-inserted (search loses the file mid-run). A daily
//     schedule would re-pay the whole Drive corpus every night. The fix is an instant compare
//     (Date.parse on both sides) in lib/knowledge/indexer.ts — outside this wave's fence.
//   UNSAFE-2 · THE 300-FILE CAP IS SILENT to the caller: `indexSource` slices to MAX_FILES_PER_SYNC
//     and only console.warns; its result carries no left-behind count (invariant 10).
//
// What IS safe, and fixed here so the route is ready the day the indexer is: embeddings go through
// the factory on the SOURCE OWNER's tier (`getAIClient(source.user_id, 'embeddings')` — tier-
// private, one Bedrock-EU space); the file upsert is keyed (idempotent); and this dispatcher now
//   • reads ONLY provider-backed sources (google_drive / onedrive). The old read also matched the
//     per-user 'upload' and 'augmtd' sources (no connection, never `last_synced_at`) and
//     `indexSource` would have flipped each of them to status 'error' — a user-visible lie;
//   • pages the read (no PostgREST 1000-row cap) and walks it LEAST-RECENTLY-SYNCED FIRST;
//   • skips a source already `indexing`/`pending` in the last 30 min (a user-triggered sync in
//     flight — two indexers on one source race the chunk delete/insert);
//   • stops STARTING sources at a wall clock and reports `leftBehind` (never a silent tail).
// TO SCHEDULE IT (after UNSAFE-1/2 are fixed in lib/knowledge): add
//   { "path": "/api/cron/knowledge-sync", "schedule": "15 2 * * *" }
// to vercel.json, change this SCHEDULE line to that expression, and update docs/ARCHITECTURE.md §6.
// scripts/smoke-clocks.ts holds both halves: unscheduled ⇔ this documented reason.

const PROVIDER_SOURCES = ['google_drive', 'onedrive'] as const;
const IN_FLIGHT_GRACE_MS = 30 * 60_000;
const START_DEADLINE_MS = 540_000; // stop STARTING a source here — one source can still run minutes
const STALE_AFTER_MS = 24 * 60 * 60_000;

type SourceRow = { id: string; status: string | null; last_synced_at: string | null; updated_at: string | null };

export async function GET(request: NextRequest) {
  if (!hasBearer(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Stale = provider-backed and not synced in 24h, never synced, or in error.
  const staleThreshold = new Date(t0 - STALE_AFTER_MS).toISOString();
  let loadError: string | null = null;
  const stale = await fetchAllRows<SourceRow>(async (from, to) => {
    const res = await adminClient
      .from('knowledge_sources')
      .select('id, status, last_synced_at, updated_at')
      .in('provider', [...PROVIDER_SOURCES])
      .or(`last_synced_at.lt.${staleThreshold},last_synced_at.is.null,status.eq.error`)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (res.error) loadError = res.error.message;
    return res as { data: SourceRow[] | null; error: unknown };
  });

  if (loadError && !stale.length) {
    console.error('[KnowledgeCron] Error fetching stale sources:', loadError);
    return NextResponse.json({ error: loadError }, { status: 500 });
  }

  // A source a user-triggered sync is indexing right now is not ours to touch this run.
  const inFlightCutoff = t0 - IN_FLIGHT_GRACE_MS;
  const inFlight = stale.filter((s) => (s.status === 'indexing' || s.status === 'pending')
    && s.updated_at && Date.parse(s.updated_at) > inFlightCutoff);
  const inFlightIds = new Set(inFlight.map((s) => s.id));
  const queue = stale.filter((s) => !inFlightIds.has(s.id));

  if (!queue.length) {
    return NextResponse.json({ success: true, processed: 0, skippedInFlight: inFlight.length, leftBehind: 0, stale: stale.length });
  }

  console.log(`[KnowledgeCron] Re-indexing up to ${queue.length} stale source(s), least-recently-synced first`);

  let processed = 0, totalIndexed = 0, totalErrors = 0, leftBehind = 0;
  for (const source of queue) {
    if (Date.now() - t0 > START_DEADLINE_MS) { leftBehind++; continue; }
    const result = await indexSource(source.id, adminClient);
    processed++;
    totalIndexed += result.indexed;
    totalErrors += result.errors;
  }

  if (leftBehind > 0) console.log(`[KnowledgeCron] route budget spent: ${leftBehind} source(s) lead the next run (least-recently-synced)`);

  return NextResponse.json({
    success: true,
    processed,
    totalIndexed,
    totalErrors,
    skippedInFlight: inFlight.length,
    leftBehind,
    stale: stale.length,
    loadError: loadError ?? undefined,
  });
}
