// W38 — EVERY GENERATED FILE IS REAL: the pure floors and the code checker (zero AI, zero network).
// The live proof is scripts/verify-generated-files.ts; these pin the mechanisms it found broken.
import { describe, it, expect } from 'vitest';
import {
  numbersIn, unsourcedFigures, missingFigures, derivableFigures, evalFormula, guessLanguage, nonTestAddresses,
  isMidWordClip, formatConsistency, garbageHits, comparisonThresholds, withReferenceGaps, readFileView, sniffFormat, MIME_BY_EXT,
} from '../../scripts/lib/file-check';
import { downloadHeaders, safeFileStem } from '@/lib/artifacts/download-name';
import { contentFitsType, contentAsText } from '@/lib/artifacts/attachment';
import { docToSheets, docToSlides, stripCharacterArt, cellValue } from '@/lib/documents/shape-floor';
import { tabularBlock } from '@/lib/compute/tabular';
import { textHygieneProblems, officeHygieneProblems } from '@/lib/documents/office-hygiene';
import { outputMime } from '@/lib/tools/compute';
import { getOrCreateAugmtdSource } from '@/lib/knowledge/indexer';
import { scriptErrorTail, SCRIPT_PRELUDE } from '@/lib/compute/document-compiler';
import { buildArtifactFile } from '@/lib/artifacts/builders';
import { materializeDocument } from '@/lib/documents/materialize';
import type { DocContent } from '@/lib/types/inbox';

const ROWS = [[1180, 1240, 1310], [960, 1015, 990], [1420, 1380, 1505], [805, 870, 925]];

describe('file-check — numbers', () => {
  it('reads figures in every common notation', () => {
    expect(numbersIn('Total 13,600 units; Nord 3 730; East 4.305,5; mean 93,5% and 1180')).toEqual([13600, 3730, 4305.5, 93.5, 1180]);
  });
  it('a derived figure passes, an invented one is named', () => {
    const allowed = derivableFigures(ROWS);
    expect(unsourcedFigures('Q1 4,365 · Q3 4,730 · total 13,600 · East 905 above the mean · avg per quarter 4,533', allowed)).toEqual([]);
    expect(unsourcedFigures('Q1 total 9,365 units; year 29,600', allowed)).toEqual([9365, 29600]);
  });
  it('years, small counts and stated thresholds are prose, not claims', () => {
    expect(unsourcedFigures('In 2026, 4 regions; two are above 3,000 units', derivableFigures(ROWS))).toEqual([]);
    expect(comparisonThresholds('plus de 1 000 unités, below 500, at 1,234')).toEqual([1000, 500]);
  });
  it('a gap to a stated target is derived (target − mean per cell), a made-up gap is not', () => {
    const allowed = withReferenceGaps(derivableFigures(ROWS), [1400, 4200, 5600, 16800]);
    expect(unsourcedFigures('on average 267 units below target per region per quarter; South 1,235 short', allowed)).toEqual([]);
    expect(unsourcedFigures('a 777-unit gap; Q1 total 9,365', allowed)).toEqual([777, 9365]);
  });
  it('missing figures are named', () => {
    expect(missingFigures('North 3,730 and East 4 305', [3730, 4305, 2600])).toEqual([2600]);
  });
});

describe('file-check — formulas', () => {
  const cells = { B2: { v: 1180, f: null }, C2: { v: 1240, f: null }, D2: { v: 1310, f: null }, E2: { v: null, f: 'SUM(B2:D2)' }, F2: { v: null, f: 'ROUND(E2/3,1)' } };
  it('evaluates the subset documents use', () => {
    expect(evalFormula('=SUM(B2:D2)', cells)).toBe(3730);
    expect(evalFormula('F2', { ...cells, G1: { v: null, f: 'F2' } })).toBe(1243.3);
    expect(evalFormula('=AVERAGE(B2,C2)+MAX(B2:D2)-MIN(B2:D2)', cells)).toBe(1210 + 130);
  });
  it('anything else is "present", never guessed', () => {
    expect(evalFormula('=VLOOKUP(A1,B:C,2,0)', cells)).toBeNull();
  });
});

describe('file-check — identity, language, naming, format', () => {
  it('language by stop words', () => {
    expect(guessLanguage('La note présente les ventes de la région et le total des ventes pour la direction, avec une tendance par trimestre et les actions à mener sur le terrain.')).toBe('fr');
    expect(guessLanguage('The memo presents the sales of the region and the total for the board, with the trend by quarter and the next steps for this team.')).toBe('en');
  });
  it('only reserved test domains may appear on a probe file', () => {
    expect(nonTestAddresses('sam@acme.test, ops@example.com, lead@realco.io')).toEqual(['lead@realco.io']);
  });
  it('a title cut mid-word from its request is caught', () => {
    expect(isMidWordClip('Build a spreadsheet tracker of the regional sales with a t', 'Build a spreadsheet tracker of the regional sales with a total')).toBe(true);
    expect(isMidWordClip('Build a spreadsheet tracker', 'Build a spreadsheet tracker of x')).toBe(false);
  });
  it('ext + MIME + bytes must agree', () => {
    expect(formatConsistency('xlsx', 'xlsx', 'application/octet-stream')).toHaveLength(1);
    expect(formatConsistency('html', 'xlsx', MIME_BY_EXT.xlsx)[0]).toMatch(/bytes are html/);
    expect(formatConsistency('docx', 'docx', MIME_BY_EXT.docx)).toEqual([]);
  });
  it('garbage and leaked syntax are named', () => {
    expect(garbageHits('Total: undefined · NaN · [object Object]')).toHaveLength(3);
    expect(garbageHits('**East** led\nEast : ########## (4,305)').join(' ')).toMatch(/bold[\s\S]*ASCII|ASCII[\s\S]*bold/);
    expect(garbageHits('a | b', { syntax: false })).toEqual([]);
  });
});

describe('the builders, read back by the checker', () => {
  it('a docx opens with headings, a table and every figure', async () => {
    const doc: DocContent = { title: 'Sales', sections: [{ heading: 'Figures', level: 1, paragraphs: ['| Region | Q1 |\n|---|---|\n| North | 1180 |', 'Total **13,600**.'] }] };
    const bytes = await buildArtifactFile('document', doc);
    expect(await sniffFormat(bytes)).toBe('docx');
    const v = await readFileView(bytes);
    expect(v.docx!.headings).toContain('Figures');
    expect(v.docx!.tables).toBe(1);
    expect(missingFigures(v.text, [1180, 13600])).toEqual([]);
    expect(garbageHits(v.text)).toEqual([]);
  });
  it('an xlsx keeps its numbers as numbers', async () => {
    const bytes = await buildArtifactFile('spreadsheet', { title: 'T', sheets: [{ name: 'S', headers: ['Region', 'Q1'], rows: [['North', 1180]] }] });
    const v = await readFileView(bytes);
    expect(v.xlsx!.sheets[0].cells.B2.v).toBe(1180);
  });
});

describe('THE DOWNLOAD NAME — the bytes name the file; the title keeps its letters', () => {
  it('keeps accents and non-Latin scripts, with an ASCII fallback', () => {
    const h = downloadHeaders('Note de synthèse — ventes régionales', 'document', 'u/t/a.docx');
    expect(h.filename).toBe('Note de synthèse — ventes régionales.docx');
    expect(h.disposition).toContain('filename="Note de synthese ventes regionales.docx"');
    expect(h.disposition).toContain("filename*=UTF-8''Note%20de%20synth%C3%A8se");
    expect(safeFileStem('تقرير المبيعات')).toBe('تقرير المبيعات');
  });
  it('the stored extension wins over the declared type', () => {
    expect(downloadHeaders('View', 'document', 'u/t/a.html').ext).toBe('html');
    expect(downloadHeaders('Deck', 'presentation', null)).toMatchObject({ ext: 'pptx', mime: MIME_BY_EXT.pptx });
  });
  it('strips only filesystem-illegal characters', () => {
    expect(safeFileStem('Q3: "North/South" <draft>?')).toBe('Q3 North South draft');
  });
});

describe('THE ATTACHMENT IS THE DELIVERED FILE — shape checks', () => {
  it('a sheet content never reaches the Word builder', () => {
    const sheet = { title: 'T', sheets: [{ name: 'S', headers: ['a'], rows: [[1]] }] };
    expect(contentFitsType('document', sheet)).toBe(false);
    expect(contentFitsType('spreadsheet', sheet)).toBe(true);
    expect(contentAsText(sheet)).toContain('| 1 |');
  });
  it('(the old path) the Word builder throws on a sheet content — why the re-render had to go', async () => {
    await expect(buildArtifactFile('document', { title: 'T', sheets: [] } as never)).rejects.toThrow();
  });
});

describe('THE SHAPE FLOOR — a builder always receives the shape it reads', () => {
  const doc: DocContent = { title: 'Sales', sections: [
    { heading: 'Figures', level: 1, paragraphs: ['| Region | Q1 | Note |\n|---|---|---|\n| North | 1,180 | ok |\n| South | 960 | 40% |'] },
    { heading: 'Next steps', level: 1, paragraphs: ['- Review South\n- Share the tracker'] },
  ] };
  it('markdown tables become sheets with numeric cells', () => {
    const x = docToSheets(doc)!;
    expect(x.sheets[0]).toMatchObject({ name: 'Figures', headers: ['Region', 'Q1', 'Note'], rows: [['North', 1180, 'ok'], ['South', 960, '40%']] });
    expect(cellValue('1 240')).toBe(1240);
    expect(docToSheets({ title: 't', sections: [{ heading: 'h', level: 1, paragraphs: ['prose only'] }] })).toBeNull();
  });
  it('sections become slides', () => {
    const d = docToSlides(doc)!;
    expect(d.slides.map((s) => s.title)).toEqual(['Sales', 'Figures', 'Next steps']);
    expect(d.slides[2].bullets).toEqual(['Review South', 'Share the tracker']);
  });
  it('character art is removed, words and figures stay, typed fences are untouched', () => {
    const md = 'East : ########## (4,305)\nEast led with 4,305.\n```\n████████\n██████\n```\n```spreadsheet\n{"x":"********"}\n```';
    const out = stripCharacterArt(md);
    expect(out).not.toMatch(/#####|████/);
    expect(out).toContain('East led with 4,305.');
    expect(out).toContain('{"x":"********"}');
  });
});

describe('THE DOOR — explicit kinds and shapes (zero AI: theme null, no frame/compiler lane)', () => {
  const fence = '```spreadsheet\n{"title":"Regional tracker","sheets":[{"name":"Sales","headers":["Region","Q1"],"rows":[["North",1180]]}]}\n```';
  it('an author\'s typed sheet titled "tracker" is an xlsx, never an html frame', async () => {
    const m = await materializeDocument(null as never, 'u', { title: 'Regional tracker', content: fence, request: 'a tracker', theme: null });
    expect([m.ext, m.tier, m.type]).toEqual(['xlsx', 'typed', 'spreadsheet']);
  });
  it('a forced sheet over markdown becomes a real sheet (it used to throw)', async () => {
    const m = await materializeDocument(null as never, 'u', { title: 'Tracker', content: '## Sales\n| Region | Q1 |\n|---|---|\n| North | 1180 |', forceType: 'spreadsheet', theme: null });
    expect(m.ext).toBe('xlsx');
    const v = await readFileView(m.bytes);
    expect(v.xlsx!.sheets[0].cells.B2.v).toBe(1180);
  });
  it('a forced sheet with no table lands as an honest document', async () => {
    const m = await materializeDocument(null as never, 'u', { title: 'Notes', content: 'Just prose here.', forceType: 'spreadsheet', theme: null });
    expect([m.ext, m.type]).toEqual(['docx', 'document']);
  });
  it('deck words over markdown give real slides (it used to throw)', async () => {
    const m = await materializeDocument(null as never, 'u', { title: 'Review', content: '## Overview\n- East leads\n## Next\n- Review South', request: 'prepare the deck', theme: null });
    expect(m.ext).toBe('pptx');
    const v = await readFileView(m.bytes);
    expect(v.pptx!.slides.length).toBe(3);
  });
});

describe('THE TABLE IN THE MATERIAL', () => {
  it('finds a CSV inside prose', () => {
    expect(tabularBlock('Sales:\nregion,q1,q2\nNorth,1180,1240\nSouth,960,1015\n\nNote: target is 1,400.')).toBe('region,q1,q2\nNorth,1180,1240\nSouth,960,1015');
  });
  it('finds a markdown table (thousands separators dropped)', () => {
    expect(tabularBlock('| Region | Q1 |\n|---|---|\n| North | 1,180 |\n| South | 960 |')).toBe('Region,Q1\nNorth,1180\nSouth,960');
  });
  it('prose with commas is not a table', () => {
    expect(tabularBlock('Hello, world.\nYes, indeed, sure.\nWell, ok, fine.')).toBeNull();
  });
});

describe('THE TEXT-HYGIENE GATE + THE OUTPUT\'S TRUE TYPE', () => {
  it('names leaked syntax', () => {
    expect(textHygieneProblems('**East** led\n## Totals\n| a | b |\n|---|---|')).toHaveLength(3);
    expect(textHygieneProblems('East led with 4,305 units.')).toEqual([]);
  });
  it('a docx with markdown in its text and no heading style fails the gate', async () => {
    const bytes = await buildArtifactFile('document', { title: 'T', sections: [] });
    expect(await officeHygieneProblems(bytes, 'docx', { expectHeadings: true })).toEqual([expect.stringMatching(/heading style/)]);
  });
  it('compute outputs get their MIME from the extension when the service says octet-stream', () => {
    expect(outputMime('a.xlsx', 'application/octet-stream')).toBe(MIME_BY_EXT.xlsx);
    expect(outputMime('a.csv', '')).toBe('text/csv');
    expect(outputMime('a.bin', null)).toBe('application/octet-stream');
    expect(outputMime('a.xlsx', 'text/plain')).toBe('text/plain');
  });
});

describe('THE ERROR THE REPAIR NEEDS', () => {
  it('drops cache noise and keeps the exception at the tail', () => {
    const stderr = [...Array(8)].map(() => 'Fontconfig error: No writable cache directories').join('\n') +
      '\nTraceback (most recent call last):\n  File "/job/script.py", line 31, in <module>\n' + 'x'.repeat(2000) + '\nValueError: not a valid color';
    const t = scriptErrorTail(stderr);
    expect(t).not.toMatch(/Fontconfig/);
    expect(t.endsWith('ValueError: not a valid color')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(701);
  });
  it('the prelude is one line (traceback line numbers shift by one, not three)', () => {
    expect(SCRIPT_PRELUDE.trim().split('\n')).toHaveLength(1);
  });
});

describe('THE SNOWBALL — one AUGMTD source per user, even after a race left two', () => {
  const fake = (rows: Array<{ id: string }>, inserted: string[]) => ({
    from: () => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, order: chain,
        limit: async () => ({ data: rows, error: null }),
        insert: () => ({ select: () => ({ single: async () => { inserted.push('new'); return { data: { id: 'new' }, error: null }; } }) }),
      });
      return q;
    },
  });
  it('two existing rows → the oldest is returned, nothing is inserted', async () => {
    const inserted: string[] = [];
    expect(await getOrCreateAugmtdSource('u', fake([{ id: 'oldest' }], inserted) as never)).toBe('oldest');
    expect(inserted).toEqual([]);
  });
  it('none → exactly one insert', async () => {
    const inserted: string[] = [];
    expect(await getOrCreateAugmtdSource('u', fake([], inserted) as never)).toBe('new');
    expect(inserted).toEqual(['new']);
  });
});
