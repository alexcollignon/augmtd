// The non-generative quality metrics (scripts/lib/eval/quality-metrics.ts) — the arithmetic behind
// scripts/eval-retrieval.ts, scripts/eval-ingestion.ts and scripts/eval-transcription.ts. Zero AI.
import { describe, it, expect } from 'vitest';
import {
  foldText, editDistance, wordErrorRate, charAccuracy, wordRecall, tokensKept, tableRowsKept,
  firstRelevantRank, scoreRetrieval, percentile,
} from '@/scripts/lib/eval/quality-metrics';

describe('foldText', () => {
  it('folds case, accents and punctuation', () => {
    expect(foldText('São João — Köln!')).toBe('sao joao koln');
  });
  it('folds a thousands separator but not a list comma or a plain space', () => {
    expect(foldText('EUR 4,318.75')).toBe(foldText('EUR 4318.75'));
    expect(foldText('182500,184250.5')).toBe('182500 184250 5');
    expect(foldText('1 318.75')).toBe('1 318 75');
  });
});

describe('edit distance / WER / char accuracy', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toBe(2);
    expect(editDistance([], ['a'])).toBe(1);
  });
  it('WER is 0 for a perfect transcript (case/punctuation-blind) and counts word errors', () => {
    expect(wordErrorRate('Hello, Acme team.', 'hello acme team')).toBe(0);
    expect(wordErrorRate('the invoice is due on Friday', 'the invoice was due Friday')).toBeCloseTo(2 / 6);
  });
  it('char accuracy is 1 for equal text and floors at 0', () => {
    expect(charAccuracy('abc', 'abc')).toBe(1);
    expect(charAccuracy('abc', 'xyzxyzxyz')).toBe(0);
  });
  it('word recall is order-free and multiset-aware', () => {
    expect(wordRecall('a b a', 'a b')).toBeCloseTo(2 / 3);
    expect(wordRecall('one two', 'two one')).toBe(1);
  });
});

describe('tokensKept', () => {
  it('finds numbers whatever their grouping, and codes whatever their punctuation', () => {
    const t = 'Total due EUR 5312.06 — ref INV 2026/0417, call +351 912 345 678 at 10:00';
    const r = tokensKept(['5,312.06', 'INV-2026-0417', '+351 912 345 678', '10:00', '99.00'], t);
    expect(r.kept).toEqual(['5,312.06', 'INV-2026-0417', '+351 912 345 678', '10:00']);
    expect(r.lost).toEqual(['99.00']);
  });
  it('a bare long number matches its grouped print', () => {
    expect(tokensKept(['12600', '48000', '4417'], 'de 12.600€ · 48 000 Euro · invoice 4417').lost).toEqual([]);
    expect(tokensKept(['12600'], 'de 126.00').lost).toEqual(['12600']);
  });
  it('respects alnum boundaries (1.30 is not found inside 11.30)', () => {
    expect(tokensKept(['1.30'], 'paid 11.30').lost).toEqual(['1.30']);
  });
});

describe('tableRowsKept', () => {
  it('needs every cell on one line in order', () => {
    const rows = [['Rent', '24000', '24600'], ['Travel', '3150', '5120.6']];
    expect(tableRowsKept(rows, 'Rent,24000,24600\nTravel,3150\n5120.6').kept).toBe(1);
  });
});

describe('retrieval scoring', () => {
  it('ranks, recall@k, MRR and wrong-version rate', () => {
    expect(firstRelevantRank(['x', 'y', 'b'], ['b', 'c'])).toBe(3);
    expect(firstRelevantRank(['x'], ['b'])).toBeNull();
    const s = scoreRetrieval([
      { ranked: ['a', 'b'], relevant: ['a'] },
      { ranked: ['old', 'new'], relevant: ['new'], wrongVersion: ['old'] },
      { ranked: ['z'], relevant: ['q'] },
    ]);
    expect(s.recall1).toBeCloseTo(1 / 3);
    expect(s.recall3).toBeCloseTo(2 / 3);
    expect(s.mrr).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(s.wrongVersionRate).toBe(1);
    expect(s.versionCases).toBe(1);
  });
  it('percentile is nearest-rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });
});
