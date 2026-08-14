// POST /api/items/ingest — the rail's 📎 funnel (P6e). A file dropped while viewing an item lands in
// the ONE per-item deliverable pool (item_deliverables, type 'file', extracted text inline) so every
// downstream reader — step assembly, coworker delegation, the converse core's find_file — sees it with
// zero extra wiring. If the item's plan is waiting on exactly this (an awaiting_input attachment step,
// judged by the CURRENT grader), the step resolves and the deep-dive's gap line clears.
// Multipart: { file, kind, id } → { ok, filename, satisfiedStep? }.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { extractTextFromAttachment } from '@/lib/attachments/text-extractor';
import { writeDeliverable } from '@/lib/home/deliverable-pool';
import { detectAttachmentRequest, type ItemPlanKind, type ItemPlanTask } from '@/lib/home/item-plan';
import { isOpenStep } from '@/lib/home/item-gaps';

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 8000;
type IngestKind = ItemPlanKind | 'entity';
const KINDS: IngestKind[] = ['meeting', 'commitment', 'awareness', 'email', 'followup', 'entity'];

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const kind = String(formData.get('kind') ?? '') as IngestKind;
    const id = String(formData.get('id') ?? '');
    if (!file || !id || !KINDS.includes(kind)) return NextResponse.json({ error: 'file, kind and id required' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Could not read this file type — PDF, Word, Excel, PowerPoint, CSV or text work.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await extractTextFromAttachment(buffer, file.type, file.name);
    if (!extracted) return NextResponse.json({ error: 'Could not read this file type — PDF, Word, Excel, PowerPoint, CSV or text work.' }, { status: 400 });

    const content = extracted.slice(0, MAX_CHARS);
    await writeDeliverable(supabase, user.id, {
      kind, entityId: id, type: 'file',
      title: file.name, content,
      gist: content.replace(/\s+/g, ' ').slice(0, 120),
      metadata: { filename: file.name, mime: file.type, via: 'rail_attach' },
    });

    // If the plan is literally waiting for a document, this delivery satisfies the FIRST such step.
    // (Item door only — the project room has no per-item plan.)
    let satisfiedStep: string | null = null;
    try {
      if (kind === 'entity') throw new Error('skip');
      const { data: plan } = await supabase.from('item_plans').select('id, tasks')
        .eq('user_id', user.id).eq('kind', kind).eq('entity_id', id).maybeSingle();
      const tasks = Array.isArray(plan?.tasks) ? (plan!.tasks as ItemPlanTask[]) : [];
      const idx = tasks.findIndex((t) => !t.dismissed && isOpenStep(t) && t.status === 'awaiting_input' && detectAttachmentRequest(t) !== null);
      if (plan && idx >= 0) {
        const next = tasks.slice();
        next[idx] = { ...next[idx], status: 'done', done: true, result: `Received: ${file.name}` };
        await supabase.from('item_plans').update({ tasks: next, updated_at: new Date().toISOString() }).eq('id', plan.id);
        satisfiedStep = next[idx].text ?? null;
      }
    } catch { /* non-fatal — the file is in the pool regardless */ }

    // FIX 3 — an input landed: clear any outstanding ASK checklist on this item — a coworker's
    // (delegate:*) or the engine's own requirements ask (requires:*). The component strips; the
    // turn's text stays as history — the group-channel story is never erased. Clearing re-opens
    // the preparation pass, which re-resolves WITH the new pool content in view.
    try {
      const { data: asks } = await supabase.from('room_turns').select('id, author')
        .eq('user_id', user.id)
        .or(`dedupe_key.like.delegate:${id}:*,dedupe_key.eq.requires:${id}`)
        .filter('component->>key', 'eq', 'input_checklist');
      if (asks?.length) {
        // Ask-journey D4 (Aug 13) — FORWARD-MOTION LAW #5 at the supply door too: an ENGINE ask
        // ("To finish this I need…") archives WHOLE — with the affordance gone its text reads as
        // a live demand, a ghost line. A COWORKER'S ask is their speech: the component strips,
        // the words stay as history. Same split settleAsksForItem makes.
        const engineIds = asks.filter((a) => !(a.author as { name?: string } | null)?.name).map((a) => a.id);
        const coworkerIds = asks.filter((a) => !!(a.author as { name?: string } | null)?.name).map((a) => a.id);
        if (coworkerIds.length) await supabase.from('room_turns').update({ component: null }).in('id', coworkerIds);
        if (engineIds.length) {
          const arch = await supabase.from('room_turns').update({ component: null, archived_at: new Date().toISOString() }).in('id', engineIds);
          if (arch.error) await supabase.from('room_turns').update({ component: null }).in('id', engineIds); // pre-migration fallback
        }
        // A satisfied requirements-ask makes the current draft stale — the next pass re-drafts
        // with the artifact staged (dropping generated_at trips the pass's freshness check).
        if (kind !== 'entity' && kind !== 'meeting') {
          const { data: itRow } = await supabase.from('inbox_items').select('id, source_data').eq('id', id).eq('user_id', user.id).maybeSingle();
          const isd = (itRow?.source_data ?? {}) as Record<string, unknown>;
          const dr = isd.draft as Record<string, unknown> | undefined;
          if (itRow && dr?.generated_at) {
            await supabase.from('inbox_items').update({ source_data: { ...isd, draft: { ...dr, generated_at: undefined } } }).eq('id', itRow.id);
          }
        }
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, filename: file.name, ...(satisfiedStep ? { satisfiedStep } : {}) });
  } catch (err) {
    console.error('[items/ingest] error:', err);
    return NextResponse.json({ error: 'Failed to process file' }, { status: 500 });
  }
}
