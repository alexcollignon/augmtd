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
  const rcpt = recipientEmail?.toLowerCase().trim() || null;
  const [skillsRes, recipientRes, relRes] = await Promise.all([
    client.from('skills').select('content').eq('user_id', userId).eq('kind', 'voice').limit(2),
    rcpt
      ? client.from('emails')
          .select('subject, body, html_body, received_at')
          .eq('user_id', userId).eq('is_from_user', true)
          .contains('to_addresses', [rcpt])
          .order('received_at', { ascending: false }).limit(MAX_SAMPLES)
      : Promise.resolve({ data: [] as SentRow[] }),
    // Relationship signal — who this is + how much they matter, so the draft's care level
    // and rapport fit the recipient (per-recipient voice, like Superhuman).
    rcpt
      ? client.from('relationship_graph')
          .select('contact_name, importance, interaction_frequency')
          .eq('user_id', userId).eq('contact_email', rcpt).maybeSingle()
      : Promise.resolve({ data: null }),
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

  // [ABOUT THIS RECIPIENT] — relationship_graph signal (front, so it frames the draft).
  const rel = relRes?.data as { contact_name: string | null; importance: number | null; interaction_frequency: number | null } | null;
  if (rel) {
    const bits: string[] = [];
    if (rel.contact_name) bits.push(`${rel.contact_name}`);
    if (typeof rel.importance === 'number' && rel.importance >= 75) bits.push('a high-importance contact — be especially considered, precise, and warm');
    if (typeof rel.interaction_frequency === 'number' && rel.interaction_frequency >= 8) bits.push('someone you correspond with often — keep your established rapport (the examples below reflect it)');
    if (bits.length) parts.push(`[ABOUT THIS RECIPIENT]\n${bits.join('; ')}.`);
  }

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

// Meeting context for post-meeting follow-ups: if the recipient was in a recent meeting that
// has a summary, surface it as the SUBSTANCE of the draft (what was discussed/agreed). The
// transcript's own attendees list is empty on insert, so we match via the linked calendar event.
export async function buildMeetingFollowupContext(
  userId: string,
  recipientEmail: string | null,
  client: DBClient,
): Promise<string> {
  const rcpt = recipientEmail?.toLowerCase().trim();
  if (!rcpt) return '';

  const since = new Date();
  since.setDate(since.getDate() - 21);

  const { data: transcripts } = await client
    .from('meeting_transcripts')
    .select('title, summary, created_at, calendar_event_id')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString())
    .not('summary', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  const eventIds = (transcripts ?? []).map((t: { calendar_event_id: string | null }) => t.calendar_event_id).filter(Boolean);
  if (!eventIds.length) return '';

  const { data: events } = await client
    .from('calendar_events')
    .select('id, attendees')
    .in('id', eventIds);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchIds = new Set((events ?? [])
    .filter((e: any) => (e.attendees ?? []).some((a: any) => (a?.email || '').toLowerCase() === rcpt))
    .map((e: { id: string }) => e.id));
  if (!matchIds.size) return '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (transcripts ?? []).find((t: any) => matchIds.has(t.calendar_event_id)) as
    { title: string | null; summary: string | null; created_at: string } | undefined;
  if (!m?.summary) return '';

  const date = new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const summary = m.summary.length > 1200 ? m.summary.slice(0, 1200) + '…' : m.summary;
  return `[RECENT MEETING WITH THIS PERSON — "${m.title || 'meeting'}" on ${date}. Ground the follow-up in what was actually discussed/agreed here; don't invent.]\n${summary}`;
}
