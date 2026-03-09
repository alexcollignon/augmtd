/**
 * Quality brief for PowerPoint presentation generation.
 * Injected into the Claude Haiku system prompt in generate-pipeline.ts.
 * Adapted from Anthropic's pptx skill: https://github.com/anthropics/skills/tree/main/skills/pptx
 */
export const PPTX_SKILL = `
PRESENTATION QUALITY RULES (follow exactly):

SLIDE COUNT & STRUCTURE:
- 5-8 slides total — never over-generate
- Slide 1: title layout only — presentation title + subtitle. No bullets.
- Slide 2: context or situation slide — 3-4 bullets framing the problem/opportunity
- Middle slides: one clear idea per slide — depth over breadth
- Last slide: "Next Steps" or "Key Takeaways" — 3-5 actionable bullets

CONTENT PER SLIDE:
- Title: 5-8 words maximum — specific and informative, not generic ("Revenue Declined 23% in Q3" not "Financial Overview")
- Bullets: 3-5 per slide maximum, 6-8 words each — no filler words, no "we will", "this slide shows"
- Every bullet must carry a distinct idea — never pad with restatements
- Numbers and specifics beat vague claims ("Reduced costs by 40%" not "Significant savings")

VARIETY — do not repeat the same slide pattern:
- Mix informational slides with data-driven slides (stats, comparisons, timelines)
- At least one slide should present a key metric or data point prominently (can be expressed as a bullet with the number leading)
- Vary what each slide is about — introduction, evidence, insight, implication, action

LANGUAGE:
- Bullets start with a verb or a key number — not "The" or "Our"
- No filler: cut "in order to", "it is important to note", "as previously mentioned"
- Present tense for current state, future tense for recommendations
- Never use special characters or double quotes inside bullet text

WHAT TO AVOID:
- Do not put a subtitle on every content slide — it is redundant
- Do not write bullets that restate the slide title
- Do not include a "Thank You" or "Questions?" slide
- Do not leave any slide with fewer than 3 bullets (except the title slide)
`.trim();
