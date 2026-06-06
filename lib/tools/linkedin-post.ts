// ─── LinkedIn post generator ──────────────────────────────────────────────────
// Generative tool step: produces 1–3 LinkedIn post drafts from previous step
// content. Config supports freeform instructions, vocabulary seeding, a
// predefined content framework, and optional tone/length/language overrides.

import { SupabaseClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';

export interface LinkedInPostConfig {
  instructions?: string;
  vocabulary?: string;
  framework?: string;
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

export const LINKEDIN_FRAMEWORKS: Array<{ id: string; name: string; description: string }> = [
  {
    id: 'contrarian_take',
    name: 'Contrarian take',
    description: 'Open with a claim most people disagree with. Build the case in 2–3 tight points. End with a direct challenge to conventional thinking — no hedge.',
  },
  {
    id: 'behind_the_scenes',
    name: 'Behind the scenes',
    description: 'Share what actually happened internally — a decision, a mistake, a process. Extract the lesson. Close with what you would do differently.',
  },
  {
    id: 'market_signal',
    name: 'Market signal',
    description: 'Spot something shifting in the market or industry. Explain what it means for practitioners right now. Name the implication others are missing.',
  },
  {
    id: 'personal_story',
    name: 'Personal story',
    description: 'Open with a specific scene or moment. Bridge it to a business or professional insight. Close with a forward-looking observation.',
  },
  {
    id: 'data_point',
    name: 'Data point',
    description: 'Lead with a surprising or counterintuitive stat. Unpack the mechanism behind it. End with the practical so-what for your audience.',
  },
  {
    id: 'build_in_public',
    name: 'Build in public',
    description: 'Share something you shipped, tested, or learned this week. Be specific and honest. No spin — just what happened and what it means.',
  },
  {
    id: 'client_proof',
    name: 'Client proof',
    description: 'Ground the post in a real outcome (anonymized if needed). Show the before/after or the decision that mattered. Extract the transferable lesson.',
  },
  {
    id: 'hot_take',
    name: 'Hot take',
    description: 'One strong opinion in the first line. Two or three sentences of supporting logic. No softening, no "it depends". Short and direct.',
  },
  {
    id: 'lesson_learned',
    name: 'Lesson learned',
    description: 'What you got wrong, what changed your mind, and what you would tell your past self. Vulnerable but grounded — not self-flagellation.',
  },
  {
    id: 'provocative_question',
    name: 'Provocative question',
    description: 'Open with a question that challenges an assumption your audience holds. Explore two sides briefly. End by inviting the reader\'s view.',
  },
];

const FRAMEWORK_MAP = Object.fromEntries(LINKEDIN_FRAMEWORKS.map(f => [f.id, f]));

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
      if (d.fullName) lines.push(`Name: ${d.fullName}`);
      if (d.role) lines.push(`Role: ${d.role}`);
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
  const framework    = typeof config.framework === 'string' && config.framework
    ? FRAMEWORK_MAP[config.framework] ?? null : null;
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

  blocks.push(
    `You are an expert LinkedIn ghostwriter. Write ${variants === 1 ? 'one LinkedIn post' : `${variants} LinkedIn post drafts`} as the author described below, in their voice.`
  );

  if (authorContext) {
    blocks.push(`AUTHOR CONTEXT — write as this person, from their perspective:\n${authorContext}`);
  }

  if (voiceExamples) {
    blocks.push(`VOICE REFERENCE — study these past posts to match the author's style, vocabulary, and rhythm:\n\n${voiceExamples}`);
  }

  if (instructions) {
    blocks.push(`INSTRUCTIONS — follow these above all else:\n${instructions}`);
  }

  if (vocabulary) {
    const terms = vocabulary.split(',').map(t => t.trim()).filter(Boolean);
    if (terms.length) {
      blocks.push(`VOCABULARY — seed these terms naturally across the post(s), don't force them:\n${terms.map(t => `- ${t}`).join('\n')}`);
    }
  }

  if (framework) {
    blocks.push(`CONTENT FRAMEWORK — structure the post using this framework:\n**${framework.name}**: ${framework.description}`);
  } else {
    blocks.push(`FORMAT: ${DEFAULT_FORMAT}`);
  }

  const params: string[] = [
    `Target length: ${LENGTH_TARGETS[length] ?? length}`,
    `Language: ${LANGUAGE_LABELS[language] ?? language}`,
  ];
  if (tone) params.push(`Tone: ${TONE_LABELS[tone] ?? tone}`);
  blocks.push(`WRITING PARAMETERS:\n${params.map(p => `- ${p}`).join('\n')}`);

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
