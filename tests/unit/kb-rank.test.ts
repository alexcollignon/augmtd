// KB search ranking + file-reading pure helpers (eval-retrieval / eval-ingestion fixes, Oct 1).
import { describe, it, expect } from 'vitest';
import { inflateSync } from 'zlib';
import {
  nameAffinity, queryIdentifiers, versionInfo, namedVersions, preferCurrentVersion, mentionsEntity, queryContentTokens,
} from '@/lib/knowledge/rank';
import { splitOversized, chunkText, CHUNK_SIZE, CHUNK_OVERLAP } from '@/lib/knowledge/indexer';
import { pptxSlideText, decodeXmlEntities, isPlainTextMime, decodeUtf8 } from '@/lib/attachments/text-extractor';
import { encodePng, crc32 } from '@/lib/attachments/png-encode';

describe('nameAffinity', () => {
  it('a name carrying the whole query scores high; one word of a long question barely counts', () => {
    expect(nameAffinity('MSA with Globex', 'MSA Globex Retail 2026.pdf')).toBeGreaterThan(0.9);
    expect(nameAffinity('who owns the Globex renewal', 'MSA Globex Retail 2026.pdf')).toBeLessThan(0.2);
  });
  it('an acronym or code the user typed lifts a name that carries it', () => {
    expect(nameAffinity('DPA', 'DPA_Acme_v3.pdf')).toBe(1);
    expect(nameAffinity('T&E policy', 'T&E Policy.md')).toBe(1);
    expect(nameAffinity('SOW-ACME-07', 'SOW-ACME-07.docx')).toBe(1);
    expect(nameAffinity('our OKRs for this half', 'OKRs 2026 H1.md')).toBeGreaterThan(0.5);
  });
  it('ignores stop words and the extension', () => {
    expect(queryContentTokens('the pdf of the board deck')).toEqual(['board', 'deck']);
    expect(nameAffinity('pdf', 'anything.pdf')).toBe(0);
  });
});

describe('versions', () => {
  it('a version marker or a year makes a family; a full date is a dated record, not a version', () => {
    expect(versionInfo('Pricing Policy v1 (2025).pdf')).toMatchObject({ family: 'pricing policy', version: 1, year: 2025 });
    expect(versionInfo('Pricing Policy v2 (2026).pdf').family).toBe('pricing policy');
    expect(versionInfo('DPA_Acme_v3.pdf')).toMatchObject({ family: 'dpa acme', version: 3 });
    expect(versionInfo('Minutes 2026-09-08.txt').family).toBe('');
    expect(versionInfo('INV-2026-0417 Northwind.pdf').family).not.toBe(versionInfo('INV-2026-0388 Northwind.pdf').family);
  });
  it('reads the versions a query names', () => {
    expect(namedVersions('pricing policy v1 from 2025')).toEqual({ versions: [1], years: [2025] });
    expect(namedVersions('current pricing')).toEqual({ versions: [], years: [] });
  });
  it('the newest member leads its family unless the query names one; others keep their places', () => {
    const items = [{ f: 'Pricing Policy v1 (2025).pdf' }, { f: 'T&E Policy.md' }, { f: 'Pricing Policy v2 (2026).pdf' }];
    const get = (x: { f: string }) => ({ filename: x.f });
    expect(preferCurrentVersion(items, 'pricing policy', get).map((x) => x.f))
      .toEqual(['Pricing Policy v2 (2026).pdf', 'Pricing Policy v1 (2025).pdf', 'T&E Policy.md']);
    expect(preferCurrentVersion(items, 'pricing policy v1', get).map((x) => x.f))
      .toEqual(['Pricing Policy v1 (2025).pdf', 'Pricing Policy v2 (2026).pdf', 'T&E Policy.md']);
    // unmarked plain duplicates are not a family
    const dup = [{ f: 'Notes.md' }, { f: 'Notes.txt' }];
    expect(preferCurrentVersion(dup, 'notes', get)).toEqual(dup);
  });
  it('falls back to the modified date when the names carry no comparable marker', () => {
    const items = [{ f: 'Price list draft.pdf', at: '2026-01-01' }, { f: 'Price list.pdf', at: '2026-06-01' }];
    expect(preferCurrentVersion(items, 'price list', (x) => ({ filename: x.f, modifiedAt: x.at }))[0].f).toBe('Price list.pdf');
  });
});

describe('queryIdentifiers', () => {
  it('numbers of 3+ digits or with decimals, and letter+digit codes — not words or small numbers', () => {
    expect(queryIdentifiers('which invoice charged 318.75 for travel, ref INV-2026-0417 and Z100 in 12 days'))
      .toEqual(['318.75', 'inv-2026-0417', 'z100']);
    expect(queryIdentifiers('invoice 4417')).toEqual(['4417']);
    expect(queryIdentifiers('the pricing policy')).toEqual([]);
  });
});

describe('mentionsEntity', () => {
  it('verbatim, or an acronym spelled out by consecutive initials', () => {
    expect(mentionsEntity('Multi-factor authentication is mandatory', 'MFA')).toBe(true);
    expect(mentionsEntity('Run the Know Your Customer check', 'KYC')).toBe(true);
    expect(mentionsEntity('ISO27001 certificate', 'ISO27001')).toBe(true);
    expect(mentionsEntity('nothing relevant here', 'Z100')).toBe(false);
    expect(mentionsEntity('nothing relevant here', 'XQZ')).toBe(false);
  });
});

describe('chunking floor', () => {
  it('splits an oversized paragraph at line / sentence / word boundaries', () => {
    const para = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} says something useful.`).join(' ');
    const parts = splitOversized(para, 1000);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(para);
    expect(parts.every((p) => p.endsWith('.'))).toBe(true);
  });
  it('a one-line document no longer becomes one giant chunk', () => {
    const doc = Array.from({ length: 400 }, (_, i) => `Clause ${i} applies.`).join(' ');
    const chunks = chunkText(doc, 'x.pdf');
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((c) => c.content.length))).toBeLessThanOrEqual(CHUNK_SIZE + CHUNK_OVERLAP + 4);
  });
});

describe('file-reading helpers', () => {
  it('pptx: one line per paragraph, table rows as a | b, entities decoded', () => {
    const xml = '<p:sld><a:p><a:r><a:t>R&amp;D </a:t></a:r><a:r><a:t>roadmap</a:t></a:r></a:p>'
      + '<a:p><a:r><a:t>Acme &lt;pilot&gt;</a:t></a:r><a:br/><a:r><a:t>line two</a:t></a:r></a:p>'
      + '<a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Q1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>1,250</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:sld>';
    expect(pptxSlideText(xml)).toBe('R&D roadmap\nAcme <pilot>\nline two\nQ1 | 1,250');
    expect(decodeXmlEntities('&#233;&#x20AC;&amp;lt;')).toBe('é€&lt;');
  });
  it('plain-text family: markdown, JSON, CSV read; HTML does not; octet-stream by extension', () => {
    expect(isPlainTextMime('text/markdown', 'a.md')).toBe(true);
    expect(isPlainTextMime('application/json', 'a.json')).toBe(true);
    expect(isPlainTextMime('text/html', 'a.html')).toBe(false);
    expect(isPlainTextMime('application/octet-stream', 'notes.md')).toBe(true);
    expect(isPlainTextMime('application/octet-stream', 'x.bin')).toBe(false);
    expect(decodeUtf8(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });
  it('encodes raw pixels as a valid PNG (1-bpp gray and RGB)', () => {
    expect(crc32(Buffer.from('IEND'))).toBe(0xae426082);
    const rgb = encodePng({ width: 2, height: 1, kind: 2, data: new Uint8Array([255, 0, 0, 0, 0, 255]) })!;
    expect(rgb.subarray(1, 4).toString()).toBe('PNG');
    const idat = rgb.indexOf('IDAT');
    const len = rgb.readUInt32BE(idat - 4);
    expect([...inflateSync(rgb.subarray(idat + 4, idat + 4 + len))]).toEqual([0, 255, 0, 0, 0, 0, 255]);
    const gray = encodePng({ width: 3, height: 1, kind: 1, data: new Uint8Array([0b10100000]) })!;
    const gi = gray.indexOf('IDAT');
    expect([...inflateSync(gray.subarray(gi + 4, gi + 4 + gray.readUInt32BE(gi - 4)))]).toEqual([0, 255, 0, 255]);
    expect(encodePng({ width: 1, height: 1, kind: 9, data: new Uint8Array([0]) })).toBeNull();
  });
});
