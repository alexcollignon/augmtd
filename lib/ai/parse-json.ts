/**
 * Robustly parses JSON from LLM output.
 * Handles common model formatting issues:
 *  - Markdown code fences (```json ... ```)
 *  - Leading/trailing text outside the JSON block
 *  - `! false` / `! true` (negation syntax some models emit)
 */
export function parseModelJSON<T = unknown>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;

  let s = text.trim();

  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

  // Extract the first complete JSON object or array
  const start = s.search(/[{[]/);
  const lastBrace = s.lastIndexOf('}');
  const lastBracket = s.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (start !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }

  // Fix `"key":! false` → `"key": false` (LLM negation quirk)
  s = s.replace(/:!\s*(true|false)/g, ': $1');

  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
