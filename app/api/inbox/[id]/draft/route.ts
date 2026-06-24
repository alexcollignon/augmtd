import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { buildVoiceBlock, buildMeetingFollowupContext } from '@/lib/context/voice-context';

export const maxDuration = 30;

// POST /api/inbox/[id]/draft — generate a voice-grounded reply draft for one inbox item, ON DEMAND
// (so AI is spent only on replies you actually open). Non-streaming; returns the body text.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: item } = await supabase.from('inbox_items')
    .select('source_data').eq('id', id).eq('user_id', user.id).single();
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (item.source_data ?? {}) as Record<string, any>;
  const from = String(sd.from || sd.from_address || '');
  const subject = String(sd.subject || '');
  const body = String(sd.body || '');

  const [voiceBlock, meetingFollowup] = await Promise.all([
    buildVoiceBlock(user.id, from, supabase).catch(() => ''),
    buildMeetingFollowupContext(user.id, from, supabase).catch(() => ''),
  ]);

  try {
    const { client, model } = await getAIClient(user.id, 'conversation', supabase);
    const res = await aiCreate(client, {
      model, max_tokens: 600, temperature: 0.6,
      messages: [{ role: 'user', content: `${voiceBlock ? voiceBlock + '\n\n' : ''}${meetingFollowup ? meetingFollowup + '\n\n' : ''}Write a reply to the email below, in the user's voice. Return ONLY the reply body — no subject line, no preamble, no surrounding quotes. Keep it appropriately concise and ready to send.\n\nFrom: ${from}\nSubject: ${subject}\n\n${body.slice(0, 3000)}` }],
    });
    const draft = res.choices?.[0]?.message?.content?.trim() || '';
    return NextResponse.json({ draft });
  } catch {
    return NextResponse.json({ error: 'Could not draft a reply.' }, { status: 500 });
  }
}
