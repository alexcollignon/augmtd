import { describe, it, expect } from 'vitest';
import { composeVocabulary, whisperPrompt, WHISPER_SEED_PROMPT, VOCAB_MAX_CHARS, VOCAB_MAX_TERMS } from '@/lib/integrations/meeting-bot/transcription-vocabulary';

describe('transcription vocabulary', () => {
  it('dedupes case-insensitively in priority order and drops noise', () => {
    expect(composeVocabulary([['Acme'], ['acme', 'Sam', 'sam@acme.example', 'https://x.example', '2026', 'x'], ['Globex']]))
      .toEqual(['Acme', 'Sam', 'Globex']);
  });
  it('is bounded by count and total length', () => {
    const many = Array.from({ length: 200 }, (_, i) => `Entity number ${i}`);
    const v = composeVocabulary([many]);
    expect(v.length).toBeLessThanOrEqual(VOCAB_MAX_TERMS);
    expect(v.reduce((n, t) => n + t.length + 2, 0)).toBeLessThanOrEqual(VOCAB_MAX_CHARS);
  });
  it('always leads with the punctuated seed', () => {
    expect(whisperPrompt([])).toBe(WHISPER_SEED_PROMPT);
    expect(whisperPrompt(['Acme', 'Lee'])).toBe(`${WHISPER_SEED_PROMPT} Names: Acme, Lee.`);
  });
});
