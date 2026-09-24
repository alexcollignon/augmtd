// TEMP — fidelity proof for AN ITEM'S OWN DOCUMENT IS THE ITEM'S OWN CONTEXT (Sep 10). Never committed.
// Guarded: ONE hardcoded item, ONE hardcoded user. Runs the real extraction seam and the REAL
// generateReplyDraft, and prints the grounding block + the draft. Writes nothing except the
// fill-if-empty extractedText cache the seam itself owns.
//   npx tsx --env-file=.env.local scripts/tmp-attachment-fidelity.ts
import { createClient } from '@supabase/supabase-js';

const ITEM = '176a8995-6a41-420f-851a-5e02f2583d95';
const USER = '08fe4449-e5eb-431d-9156-02e9324e5903';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: item } = await sb.from('inbox_items').select('id, user_id, work_title, source_data').eq('id', ITEM).maybeSingle();
  if (!item || item.user_id !== USER) { console.log('GUARD: item/user mismatch — refusing.'); return; }
  const sd = (item.source_data ?? {}) as Record<string, unknown>;

  const { readItemAttachments, renderAttachedDocumentsBlock, attachmentFactBlock } =
    await import('../lib/inbox/attachment-context');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atts = await readItemAttachments(sb as any, USER, sd, ITEM);
  console.log('=== ATTACHMENTS RESOLVED ===');
  for (const a of atts) console.log(`- ${a.filename} (${a.mimeType}, ${a.size} bytes) text=${a.text ? `${a.text.length} chars` : 'NONE'}`);

  console.log('\n=== ATTACHED DOCUMENTS BLOCK (the drafter\'s grounding) ===');
  console.log(renderAttachedDocumentsBlock(atts));

  console.log('\n=== THE TIGHT FORM (judge / board) ===');
  console.log(attachmentFactBlock(atts, String(sd.from_name ?? sd.from_address ?? '')));

  const { generateReplyDraft } = await import('../lib/inbox/draft-reply');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draft = await generateReplyDraft(USER, sd as any, sb as any, null);
  console.log('\n=== THE REGENERATED DRAFT ===');
  console.log(draft);

  const lie = /não\s+recebi|not\s+received|didn'?t\s+receive|reenviar|resend|em\s+falta|missing\s+attachment/i.test(draft);
  console.log(`\nDENIAL CHECK: ${lie ? 'FAILED — the draft still claims the document is missing' : 'clean — no missing-attachment claim'}`);
}
main();
