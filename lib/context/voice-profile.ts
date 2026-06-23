// Durable voice profile — voice lives in Memory (context_profiles), not a deletable skill.
//
// Replaces the old keyword-stats "Communication style" with an example-grounded description of
// HOW the user writes, synthesized from their real sent emails. Stored on the
// email_communication profile as `profile_data.voice_description`, which both
// build-user-context (drafter + coworkers) and render-memory (the Memory card) prefer over the
// stats. Also written by the interview (kind='voice'). One home, used everywhere.

import { getAIClient, aiCreate } from '@/lib/ai/factory';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function readProfileData(userId: string, client: DBClient): Promise<Record<string, unknown>> {
  const { data } = await client.from('context_profiles')
    .select('profile_data').eq('user_id', userId).eq('profile_type', 'email_communication').maybeSingle();
  return (data?.profile_data as Record<string, unknown>) ?? {};
}

async function writeVoice(userId: string, prose: string, source: 'auto' | 'interview', client: DBClient): Promise<void> {
  const profile_data = { ...(await readProfileData(userId, client)), voice_description: prose, voice_source: source, voice_synth_attempted_at: new Date().toISOString() };
  await client.from('context_profiles').upsert({
    user_id: userId,
    profile_type: 'email_communication',
    profile_data,
    rendered_text: prose,
    rendered_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    confidence_score: 80,
  }, { onConflict: 'user_id,profile_type' });
}

// Record that we tried (so the lazy build fires at most once when there isn't enough mail yet).
async function markAttempt(userId: string, client: DBClient): Promise<void> {
  const profile_data = { ...(await readProfileData(userId, client)), voice_synth_attempted_at: new Date().toISOString() };
  await client.from('context_profiles').upsert({
    user_id: userId, profile_type: 'email_communication', profile_data, last_updated: new Date().toISOString(),
  }, { onConflict: 'user_id,profile_type' });
}

// Synthesize the voice from the user's real sent emails. Returns the prose, or null if there
// isn't enough sent mail to learn from. Safe to call lazily (idempotent write).
export async function synthesizeVoiceProfile(userId: string, client: DBClient): Promise<string | null> {
  const { data: sent } = await client.from('emails')
    .select('body, html_body')
    .eq('user_id', userId).eq('is_from_user', true)
    .order('received_at', { ascending: false }).limit(12);

  const samples = (sent ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => ((e.body && e.body.trim()) ? e.body : stripHtml(e.html_body || '')).trim())
    .filter(Boolean)
    .map((b: string) => (b.length > 600 ? b.slice(0, 600) : b))
    .slice(0, 10);
  if (samples.length < 3) { await markAttempt(userId, client).catch(() => {}); return null; }

  const prompt = `Below are ${samples.length} emails this person actually sent. Write a concise, concrete description of HOW they write email, addressed to them as "You". Cover: tone (formal/casual/warm/direct), typical length, greeting and sign-off habits, characteristic words/phrases they use, and anything they consistently avoid. 2–4 sentences, specific and grounded in the samples — no generic filler, no preamble.

${samples.map((s: string, i: number) => `--- Email ${i + 1} ---\n${s}`).join('\n\n')}`;

  try {
    const { client: ai, model } = await getAIClient(userId, 'summarization', client);
    const res = await aiCreate(ai, { model, messages: [{ role: 'user', content: prompt }], max_tokens: 260, temperature: 0.4 });
    const prose = res.choices?.[0]?.message?.content?.trim();
    if (!prose) return null;
    await writeVoice(userId, prose, 'auto', client);
    return prose;
  } catch {
    return null;
  }
}

// Write a voice description from the interview (kind='voice') — same durable home.
export async function setVoiceProfile(userId: string, prose: string, client: DBClient): Promise<void> {
  if (!prose?.trim()) return;
  await writeVoice(userId, prose.trim(), 'interview', client).catch(() => {});
}
