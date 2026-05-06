import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { error } = await admin
    .from('meeting_transcripts')
    .update({
      source: 'text',
      recording_storage_path: null,
      bot_state: null,
      processed: true,
      transcript: '- good structure\n- homework\n- large group! tech check\n- engagement structure',
      transcript_segments: [],
      notes_structured: null,
      summary: null,
      decisions: [],
      key_moments: [],
      risks: [],
      suggested_next_step: null,
    })
    .eq('id', 'acaaa1ab-186f-4f11-966b-b4e160dce264');

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  console.log('Reverted to original text note state.');
}

main().catch((err) => { console.error(err); process.exit(1); });
