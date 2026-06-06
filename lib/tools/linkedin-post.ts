// ─── LinkedIn post generator ──────────────────────────────────────────────────
// Generative tool step: produces 1–3 LinkedIn post drafts from previous step
// content. Config supports freeform instructions, vocabulary seeding, content
// frameworks, and optional tone/length/language overrides.

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export interface LinkedInPostFramework {
  name: string;
  description: string;
}

export interface LinkedInPostConfig {
  instructions?: string;
  vocabulary?: string;
  frameworks?: LinkedInPostFramework[];
  tone?: 'thought_leadership' | 'conversational' | 'data_driven';
  length?: 'short' | 'standard' | 'long';
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

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'German (Deutsch)',
  pt: 'Portuguese (Português)',
};

// Fallback format guide used only when no frameworks are configured
const DEFAULT_FORMAT = 'Lead with the core insight, support with 2–3 concrete points, close with implications or a question.';

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

async function fetchAuthorContext(
  userId: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data: profiles } = await supabase
    .from('context_profiles')
    .select('profile_type, profile_data, confidence_score')
    .eq('user_id', userId)
    .in('profile_type', ['identity', 'domain_knowledge'])
    .gte('confidence_score', 10);

  if (!profiles || profiles.length === 0) return null;

  const lines: string[] = [];

  for (const p of profiles) {
    const d = p.profile_data as Record<string, unknown>;
    if (p.profile_type === 'identity') {
      if (d.fullName)        lines.push(`Name: ${d.fullName}`);
      if (d.role)            lines.push(`Role: ${d.role}`);
      if (Array.isArray(d.responsibilities) && d.responsibilities.length)
        lines.push(`Responsibilities: ${(d.responsibilities as string[]).join(', ')}`);
    }
    if (p.profile_type === 'domain_knowledge') {
      if (Array.isArray(d.expertise) && d.expertise.length)
        lines.push(`Expertise: ${(d.expertise as string[]).join(', ')}`);
      if (d.vocabulary && typeof d.vocabulary === 'object') {
        const terms = Object.keys(d.vocabulary as object).slice(0, 10);
        if (terms.length) lines.push(`Domain vocabulary: ${terms.join(', ')}`);
      }
    }
  }

  return lines.length ? lines.join('\n') : null;
}

export async function executeLinkedInPost(
  config: Record<string, unknown>,
  ctx: LinkedInPostContext,
): Promise<string> {
  const instructions = typeof config.instructions === 'string' && config.instructions.trim()
    ? config.instructions.trim() : null;
  const vocabulary   = typeof config.vocabulary === 'string' && config.vocabulary.trim()
    ? config.vocabulary.trim() : null;
  const frameworks   = Array.isArray(config.frameworks)
    ? (config.frameworks as LinkedInPostFramework[]).filter(f => f.name && f.description)
    : [];
  const tone         = (config.tone as string) || null;
  const length       = (config.length as string) || 'standard';
  const language     = (config.language as string) || 'en';
  const variants     = Math.min(Math.max(Number(config.variants) || 1, 1), 3);
  const imagePrompt  = config.include_image_prompt === true;
  const voiceFileId  = typeof config.voice_kb_file_id === 'string' && config.voice_kb_file_id.trim()
    ? config.voice_kb_file_id.trim() : null;

  const [voiceExamples, authorContext] = await Promise.all([
    voiceFileId ? fetchVoiceExamples(voiceFileId, ctx.supabase).catch(() => null) : Promise.resolve(null),
    fetchAuthorContext(ctx.userId, ctx.supabase).catch(() => null),
  ]);

  const resolved = await getAIClient(ctx.userId, 'conversation', ctx.supabase);

  const blocks: (string | null)[] = [];

  // Role
  blocks.push(
    `You are an expert LinkedIn ghostwriter. Write ${variants === 1 ? 'one LinkedIn post' : `${variants} LinkedIn post drafts`} as the author described below, in their voice.`
  );

  // Author identity (auto-injected)
  if (authorContext) {
    blocks.push(`AUTHOR CONTEXT — write as this person, from their perspective:\n${authorContext}`);
  }

  // Voice reference from KB
  if (voiceExamples) {
    blocks.push(`VOICE REFERENCE — study these past posts to match the author's style, vocabulary, and rhythm:\n\n${voiceExamples}`);
  }

  // Freeform instructions (highest priority)
  if (instructions) {
    blocks.push(`INSTRUCTIONS — follow these above all else:\n${instructions}`);
  }

  // Vocabulary seeding
  if (vocabulary) {
    const terms = vocabulary.split(',').map(t => t.trim()).filter(Boolean);
    if (terms.length) {
      blocks.push(`VOCABULARY — seed these terms naturally across the post(s), don't force them:\n${terms.map(t => `- ${t}`).join('\n')}`);
    }
  }

  // Content frameworks
  if (frameworks.length > 0) {
    const frameworkBlock = frameworks.length === 1
      ? `CONTENT FRAMEWORK — structure the post using this framework:\n**${frameworks[0].name}**: ${frameworks[0].description}`
      : `CONTENT FRAMEWORKS — assign each draft to the most fitting framework:\n${frameworks.map(f => `**${f.name}**: ${f.description}`).join('\n')}`;
    blocks.push(frameworkBlock);
  } else {
    blocks.push(`FORMAT: ${DEFAULT_FORMAT}`);
  }

  // Writing parameters
  const params: string[] = [
    `Target length: ${LENGTH_TARGETS[length] ?? length}`,
    `Language: ${LANGUAGE_LABELS[language] ?? language}`,
  ];
  if (tone) params.push(`Tone: ${TONE_LABELS[tone] ?? tone}`);
  blocks.push(`WRITING PARAMETERS:\n${params.map(p => `- ${p}`).join('\n')}`);

  // Rules
  blocks.push(
    `RULES — apply to every draft:
- First line is the hook. Make the reader stop scrolling. No "I am pleased to announce", "Exciting news", or "In today's world".
- Write every word in ${LANGUAGE_LABELS[language] ?? language}.
- End with 3–5 relevant hashtags on their own line.
- No filler. No padding. No corporate boilerplate.
- Politically neutral — frame any political topic in business/economic terms only.
- If citing a specific fact or statistic, include a brief inline source reference.`
  );

  if (imagePrompt) {
    blocks.push(`IMAGE PROMPT — after each draft, add a "**Visual prompt:**" line with a specific prompt for Canva or Midjourney matching the post's theme and mood.`);
  }

  // Label frameworks in output when multiple drafts + multiple frameworks
  if (variants > 1 && frameworks.length > 0) {
    blocks.push(`Label each draft with its framework name.`);
  }

  const systemPrompt = blocks.filter(Boolean).join('\n\n');

  const userPrompt = variants === 1
    ? `Write one LinkedIn post as the author, based on the following content:\n\n${ctx.previousContent}`
    : `Write ${variants} distinct LinkedIn post drafts as the author, each approaching the topic from a different angle. Label them clearly.\n\n${ctx.previousContent}`;

  const res = await aiCreate(resolved.client, {
    model: resolved.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2500,
  });

  return res.choices[0]?.message?.content?.trim() ?? '[linkedin_post] No output generated.';
}
