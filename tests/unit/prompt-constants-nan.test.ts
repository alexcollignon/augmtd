import { describe, it, expect } from 'vitest';
import { GROUND_EVIDENCE_RULE } from '@/lib/room/ground-evidence';
import { EXCERPT_RULE } from '@/lib/utils/clip-for-prompt';

// W23 · a stray unary `+` before a constant in a concatenated prompt turns it into the text "NaN"
// (found in GROUND_EVIDENCE_RULE, which every chat system prompt carried). Prompt constants are text.
describe('prompt constants are text, never NaN', () => {
  it('GROUND_EVIDENCE_RULE carries the excerpt rule, not NaN', () => {
    expect(GROUND_EVIDENCE_RULE).not.toContain('NaN');
    expect(GROUND_EVIDENCE_RULE.endsWith(EXCERPT_RULE)).toBe(true);
  });
});
