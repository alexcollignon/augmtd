/**
 * Quality brief for Word document generation.
 * Injected into the Claude Haiku system prompt in generate-pipeline.ts.
 * Adapted from Anthropic's docx skill: https://github.com/anthropics/skills/tree/main/skills/docx
 */
export const DOCX_SKILL = `
DOCUMENT QUALITY RULES (follow exactly):

STRUCTURE:
- Open with a concise executive summary section (2-4 sentences) that states the purpose and key finding
- Use H1 headings for major sections, H2 for sub-points — never skip levels
- 2-5 major sections maximum — do not pad with filler sections
- Each section must have at least 2 paragraphs or a substantive list

PARAGRAPHS:
- Maximum 3 sentences per paragraph — break longer thoughts into separate paragraphs
- Never copy source material verbatim — synthesize and reframe in professional language
- Active voice preferred; avoid "it should be noted that", "it is important to", etc.

LISTS (use "- item" prefix for bullet items):
- Use bullet lists for 3+ enumerable items — do not write them as run-on sentences
- Each bullet: max 15 words, starts with a verb or noun, no trailing punctuation
- Never use a single-item bullet list — write it as a sentence instead

CONTENT:
- Every heading must be followed by substantive content — never a heading with a single empty paragraph
- Numbers, dates, and proper nouns must be accurate to the source material
- Use professional vocabulary appropriate for the context (consulting, legal, finance)
- Conclude with a clear "Next Steps" or "Recommendations" section when the document calls for action
`.trim();
