// Voice context for the email drafter — the "sounds like me" layer.
//
// Best practice (Serif/Shortwave/Superhuman, 2026) is few-shot from the user's REAL sent
// emails, not descriptive statistics. This assembles two things the drafter should match:
//   1. the user's voice SKILL (interview-built, kind='voice') — explicit guidance
//   2. real sent-email EXEMPLARS — preferably to the same recipient, else most recent
// Returns '' when there's nothing to show (drafter falls back to the old stats block).
//
// v1 retrieval is recipient + recency (cheap, no embeddings). Slice 2 upgrades to semantic.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DBClient = any;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MAX_SAMPLE_CHARS = 700;
const MAX_SAMPLES = 3;

type SentRow = { subject: string | null; body: string | null; html_body: string | null };

function bodyOf(e: SentRow): string {
  const text = (e.body && e.body.trim()) ? e.body : stripHtml(e.html_body || '');
  const t = text.trim();
  return t.length > MAX_SAMPLE_CHARS ? t.slice(0, MAX_SAMPLE_CHARS) + '…' : t;
}

export async function buildVoiceBlock(
  userId: string,
  recipientEmail: string | null,
  client: DBClient,
): Promise<string> {
  const [skillsRes, recipientRes] = await Promise.all([
    client.from('skills').select('content').eq('user_id', userId).eq('kind', 'voice').limit(2),
    recipientEmail
      ? client.from('emails')
          .select('subject, body, html_body, received_at')
          .eq('user_id', userId).eq('is_from_user', true)
          .contains('to_addresses', [recipientEmail])
          .order('received_at', { ascending: false }).limit(MAX_SAMPLES)
      : Promise.resolve({ data: [] as SentRow[] }),
  ]);

  let exemplars: SentRow[] = (recipientRes?.data as SentRow[]) ?? [];
  // Not enough recipient-specific samples → fall back to the user's most recent sent emails.
  if (exemplars.length < 2) {
    const { data } = await client.from('emails')
      .select('subject, body, html_body, received_at')
      .eq('user_id', userId).eq('is_from_user', true)
      .order('received_at', { ascending: false }).limit(MAX_SAMPLES);
    if ((data?.length ?? 0) > exemplars.length) exemplars = (data as SentRow[]) ?? exemplars;
  }

  const parts: string[] = [];

  const skills = (skillsRes?.data as Array<{ content: string }> | null) ?? [];
  const voiceGuidance = skills.map((s) => s.content?.trim()).filter(Boolean).join('\n\n');
  if (voiceGuidance) {
    parts.push(`[YOUR VOICE — guidance you set]\n${voiceGuidance}`);
  }

  const samples = exemplars.map(bodyOf).filter(Boolean).slice(0, MAX_SAMPLES);
  if (samples.length) {
    parts.push(
      `[HOW YOU ACTUALLY WRITE — real emails this user sent. Match this voice: greeting style, sentence length, directness, warmth, and sign-off. Mirror the STYLE only — never reuse the content.]\n` +
      samples.map((s, i) => `--- Example ${i + 1} ---\n${s}`).join('\n\n'),
    );
  }

  return parts.join('\n\n');
}
