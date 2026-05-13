// ─── LinkedIn post generator ──────────────────────────────────────────────────
// Generative tool step: produces 1–3 LinkedIn post drafts from previous step
// content. Config controls tone, length, format, language, and voice reference.

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export interface LinkedInPostConfig {
  tone?: 'thought_leadership' | 'conversational' | 'data_driven';
  length?: 'short' | 'standard' | 'long';
  format?: 'story' | 'insight' | 'question' | 'list';
  language?: 'en' | 'de' | 'pt';
  variants?: 1 | 2 | 3;
  include_image_prompt?: boolean;
  voice_kb_file_id?: string;
}

export interface LinkedInPostContext {
  userId: string;
  supabase: SupabaseClient;
  previousContent: string;
}

const TONE_LABELS: Record<string, string> = {
  thought_leadership: 'thought leadership — position the author as a domain expert sharing a meaningful perspective',
  conversational:     'conversational — warm, direct, written like a human talking to a peer, not a press release',
  data_driven:        'data-driven — lead with a surprising stat or concrete number, back claims with evidence',
};

const LENGTH_TARGETS: Record<string, string> = {
  short:    '80–120 words',
  standard: '180–250 words',
  long:     '300–380 words',
};

const FORMAT_GUIDES: Record<string, string> = {
  story:   'Open with a personal observation or scene, build to a business insight, close with a forward-looking thought.',
  insight: 'Lead with the core insight, support with 2–3 concrete points, close with implications or a question.',
  question: 'Open with a provocative question, explore two sides or perspectives briefly, end by inviting the reader\'s view.',
  list:    'Use a bold opener, then 3–5 short punchy bullets, close with one sentence that ties them together.',
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'German (Deutsch)',
  pt: 'Portuguese (Português)',
};

async function fetchVoiceExamples(
  fileId: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data: chunks } = await supabase
    .from('knowledge_chunks')
    .select('content, chunk_index')
    .eq('file_id', fileId)
    .order('chunk_index', { ascending: true });

  if (!chunks || chunks.length === 0) return null;

  return (chunks as Array<{ content: string; chunk_index: number }>)
    .map(c => c.content)
    .join('\n\n')
    .slice(0, 6000);
}

export async function executeLinkedInPost(
  config: Record<string, unknown>,
  ctx: LinkedInPostContext,
): Promise<string> {
  const tone       = (config.tone as string)     || 'thought_leadership';
  const length     = (config.length as string)   || 'standard';
  const format     = (config.format as string)   || 'insight';
  const language   = (config.language as string) || 'en';
  const variants   = Math.min(Math.max(Number(config.variants) || 1, 1), 3);
  const imagePrompt = config.include_image_prompt === true;
  const voiceFileId = typeof config.voice_kb_file_id === 'string' && config.voice_kb_file_id.trim()
    ? config.voice_kb_file_id.trim()
    : null;

  const voiceExamples = voiceFileId
    ? await fetchVoiceExamples(voiceFileId, ctx.supabase).catch(() => null)
    : null;

  const resolved = await getAIClient(ctx.userId, 'conversation', ctx.supabase);

  const systemPrompt = [
    `You are an expert LinkedIn copywriter. Your job is to write ${variants === 1 ? 'one LinkedIn post' : `${variants} LinkedIn post variants`} based on the source content provided.`,
    voiceExamples
      ? `VOICE REFERENCE — study these past posts to match the author's style, vocabulary, and rhythm:\n\n${voiceExamples}`
      : null,
    `WRITING PARAMETERS:
- Tone: ${TONE_LABELS[tone] ?? tone}
- Target length: ${LENGTH_TARGETS[length] ?? length}
- Format: ${FORMAT_GUIDES[format] ?? format}
- Language: ${LANGUAGE_LABELS[language] ?? language}`,
    `RULES — apply to every variant:
- First line is the hook. It must make the reader stop scrolling. No "I am pleased to announce", no "Exciting news", no "In today's world".
- Write in ${LANGUAGE_LABELS[language] ?? language}. Every word.
- End with 3–5 relevant hashtags on their own line.
- No filler. No padding. No corporate boilerplate.
- Strictly politically neutral — frame any political topic purely in business/economic terms.
- If citing a specific fact or statistic, add a brief source reference inline.`,
    imagePrompt
      ? `IMAGE PROMPT — after each variant, add a "**Visual prompt:**" line with a detailed, specific prompt for Canva or Midjourney that matches the post's theme and mood.`
      : null,
  ].filter(Boolean).join('\n\n');

  const userPrompt = variants === 1
    ? `Write one LinkedIn post based on the following content:\n\n${ctx.previousContent}`
    : `Write ${variants} distinct LinkedIn post variants based on the following content. Each variant should approach the topic from a different angle. Label them clearly.\n\n${ctx.previousContent}`;

  const res = await aiCreate(resolved.client, {
    model: resolved.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  return res.choices[0]?.message?.content?.trim() ?? '[linkedin_post] No output generated.';
}
