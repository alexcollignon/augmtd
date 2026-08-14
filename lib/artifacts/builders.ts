import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, convertInchesToTwip,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Header, Footer, ImageRun, TabStopType,
} from 'docx';
import type { DeliverableType, DocContent, PptxContent, XlsxContent, ArtifactContent } from '@/lib/types/inbox';
import type { DocTheme } from '@/lib/documents/theme';

// Detect lines that are bullet items (start with "- ", "• ", "* ")
function isBulletLine(line: string): boolean {
  return /^[-•*]\s/.test(line.trim());
}

// Numbered items ("1. " / "2) ") — rendered with a REAL ordered list, not fake bullets
// (THE DOCUMENT HANDS slice 1, Aug 11 — the fill-in-a-form bar pilots measure against).
function isNumberedLine(line: string): boolean {
  return /^\d+[.)]\s/.test(line.trim());
}
function stripNumberPrefix(line: string): string {
  return line.trim().replace(/^\d+[.)]\s+/, '');
}
// A markdown table block: consecutive |-delimited lines (with an optional |---| separator).
function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 2;
}
function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}
function parseTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function stripBulletPrefix(line: string): string {
  return line.trim().replace(/^[-•*]\s+/, '');
}

function markdownToRuns(text: string, size: number, color: string): TextRun[] {
  const runs: TextRun[] = [];
  // [CONFIRM: …] slots render DISTINCT (bold italic, amber) — a filled form must show at a
  // glance which facts still need the human (the marked-slot-beats-dropped-question law).
  const re = /\[CONFIRM:?[^\]]*\]|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), size, font: 'Arial', color }));
    if (m[0].startsWith('[CONFIRM')) runs.push(new TextRun({ text: m[0], bold: true, italics: true, size, font: 'Arial', color: 'B45309' }));
    else if (m[1]) runs.push(new TextRun({ text: m[1], bold: true, italics: true, size, font: 'Arial', color }));
    else if (m[2]) runs.push(new TextRun({ text: m[2], bold: true, size, font: 'Arial', color }));
    else if (m[3]) runs.push(new TextRun({ text: m[3], italics: true, size, font: 'Arial', color }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size, font: 'Arial', color }));
  return runs.length ? runs : [new TextRun({ text, size, font: 'Arial', color })];
}

// One markdown table block → a real docx Table (header row bold on a light fill; full width).
function buildTable(lines: string[]): Table {
  const rows = lines.filter((l) => !isTableSeparator(l)).map(parseTableCells);
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((cells, ri) => new TableRow({
      children: Array.from({ length: colCount }, (_, ci) => new TableCell({
        borders: { top: border, bottom: border, left: border, right: border },
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'F3F4F6' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          children: ri === 0
            ? [new TextRun({ text: cells[ci] ?? '', bold: true, size: 22, font: 'Arial', color: '111827' })]
            : markdownToRuns(cells[ci] ?? '', 22, '1F2937'),
        })],
      })),
    })),
  });
}

export function buildDocx(content: DocContent, options?: { pageSize?: 'letter' | 'a4'; theme?: DocTheme | null }): Promise<Buffer> {
  // THE BRANDED KIT (DH4): the workspace theme brands every document — logo in the header,
  // footer line, accent on the title. No theme → the house look, unchanged.
  const theme = options?.theme ?? null;
  const accent = theme?.accent ?? '111827';
  const isA4 = options?.pageSize === 'a4';
  const NUMBERING_REF = 'bullet-list';
  const ORDERED_REF = 'ordered-list';

  const numberingConfig = {
    config: [{
      reference: NUMBERING_REF,
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '\u2022',
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } },
          run: { font: 'Arial', size: 24 },
        },
      }],
    }, {
      reference: ORDERED_REF,
      levels: [{
        level: 0,
        format: LevelFormat.DECIMAL,
        text: '%1.',
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } },
          run: { font: 'Arial', size: 24 },
        },
      }],
    }],
  };

  const children: Array<Paragraph | Table> = [];

  // Title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: content.title, bold: true, size: 48, font: 'Arial', color: accent })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    })
  );

  // Subtitle
  if (content.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: content.subtitle, size: 26, color: '6B7280', font: 'Arial' })],
        spacing: { after: 480 },
      })
    );
  }

  for (const section of content.sections) {
    children.push(
      new Paragraph({
        text: section.heading,
        heading: section.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 120 },
      })
    );

    for (const para of section.paragraphs) {
      // Split on newlines in case AI packs multiple bullets into one paragraph
      const lines = para.split('\n').filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^-{3,}$/.test(line.trim())) continue; // skip horizontal rules
        // A markdown TABLE block (forms live in tables) — collect the run, emit a real Table.
        if (isTableLine(line)) {
          const block: string[] = [];
          while (i < lines.length && isTableLine(lines[i])) { block.push(lines[i]); i++; }
          i--;
          if (block.filter((l) => !isTableSeparator(l)).length >= 1 && block.length >= 2) {
            children.push(buildTable(block));
            children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
            continue;
          }
        }
        // H3 inside a section — a small bold heading (textToDocContent keeps ### lines inline).
        const h3 = line.match(/^###\s+(.+)$/);
        if (h3) {
          children.push(new Paragraph({
            children: [new TextRun({ text: h3[1].trim(), bold: true, size: 26, font: 'Arial', color: '111827' })],
            spacing: { before: 200, after: 80 },
          }));
          continue;
        }
        if (isNumberedLine(line)) {
          children.push(
            new Paragraph({
              numbering: { reference: ORDERED_REF, level: 0 },
              children: markdownToRuns(stripNumberPrefix(line), 24, '1F2937'),
              spacing: { after: 80 },
            })
          );
        } else if (isBulletLine(line)) {
          children.push(
            new Paragraph({
              numbering: { reference: NUMBERING_REF, level: 0 },
              children: markdownToRuns(stripBulletPrefix(line), 24, '1F2937'),
              spacing: { after: 80 },
            })
          );
        } else {
          children.push(
            new Paragraph({
              children: markdownToRuns(line, 24, '1F2937'),
              spacing: { after: 160 },
            })
          );
        }
      }
    }
  }

  const doc = new Document({
    numbering: numberingConfig,
    styles: {
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial', color: '111827' },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Arial', color: '374151' },
          paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: isA4
            ? { width: 11906, height: 16838 }   // A4
            : { width: 12240, height: 15840 },  // US Letter
          margin: isA4
            ? { top: 1418, right: 1418, bottom: 1418, left: 1418 }  // ~2.5cm
            : { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // ~1 inch
        },
      },
      // The letterhead: logo top-right (true aspect, ~0.35in tall), footer line bottom-left.
      // THE DUAL-LOGO COVER: a second mark (author × client) puts the primary logo LEFT and
      // the second RIGHT on the same header line (right tab stop) — the co-brand layout.
      ...(theme?.logo ? {
        headers: {
          default: new Header({
            children: [theme.logo2 ? new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
              children: [
                new ImageRun({
                  type: 'png',
                  data: Buffer.from(theme.logo.dataB64, 'base64'),
                  transformation: { height: 26, width: Math.max(26, Math.round(26 * (theme.logo.w / theme.logo.h))) },
                }),
                new TextRun({ text: '\t' }),
                new ImageRun({
                  type: 'png',
                  data: Buffer.from(theme.logo2.dataB64, 'base64'),
                  transformation: { height: 26, width: Math.max(26, Math.round(26 * (theme.logo2.w / theme.logo2.h))) },
                }),
              ],
            }) : new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new ImageRun({
                type: 'png',
                data: Buffer.from(theme.logo.dataB64, 'base64'),
                transformation: { height: 26, width: Math.max(26, Math.round(26 * (theme.logo.w / theme.logo.h))) },
              })],
            })],
          }),
        },
      } : {}),
      ...(theme?.footer || theme?.brandName ? {
        footers: {
          default: new Footer({
            children: [new Paragraph({
              children: [new TextRun({
                text: [theme?.footer, theme?.brandName].filter(Boolean).join(' · '),
                size: 16, color: '9CA3AF', font: 'Arial',
              })],
            })],
          }),
        },
      } : {}),
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// Brand colors — navy dominant (60-70%), slate supporting, indigo accent
const BRAND = {
  navy: '1e293b',      // dominant — title bg, key elements
  navyLight: '334155', // supporting
  indigo: '4f46e5',    // accent — dividers, highlights
  white: 'FFFFFF',
  lightGray: 'F8FAFC',
  textDark: '0F172A',
  textMid: '475569',
};

export async function buildPptx(content: PptxContent, theme?: DocTheme | null): Promise<Buffer> {
  const pptxgen = (await import('pptxgenjs')).default;
  const pres = new pptxgen();

  // THE BRANDED KIT (DH4): the workspace accent drives the deck's accent elements; the logo
  // sits bottom-right of content slides; the footer line runs along the bottom. No theme →
  // the house look, unchanged.
  const ACCENT = theme?.accent ?? BRAND.indigo;
  const logoDataUrl = theme?.logo ? `data:${theme.logo.mime};base64,${theme.logo.dataB64}` : null;
  const logoH = 0.3;
  const logoW = theme?.logo ? Math.max(0.3, Math.round(100 * logoH * (theme.logo.w / theme.logo.h)) / 100) : 0;
  // THE DUAL-LOGO COVER: the second mark (client) sits TOP-RIGHT of every slide — co-brand.
  const logo2DataUrl = theme?.logo2 ? `data:${theme.logo2.mime};base64,${theme.logo2.dataB64}` : null;
  const logo2W = theme?.logo2 ? Math.max(0.3, Math.round(100 * logoH * (theme.logo2.w / theme.logo2.h)) / 100) : 0;

  pres.layout = 'LAYOUT_WIDE'; // 16:9

  for (const slide of content.slides) {
    const s = pres.addSlide();

    if (slide.layout === 'title') {
      // Full-bleed navy background
      s.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: '100%',
        fill: { color: BRAND.navy },
        line: { color: BRAND.navy },
      });

      // Indigo accent bar (left edge)
      s.addShape(pres.ShapeType.rect, {
        x: 0, y: 1.2, w: 0.08, h: 2.4,
        fill: { color: ACCENT },
        line: { color: BRAND.indigo },
      });

      // Title
      s.addText(content.title, {
        x: 0.5, y: 1.5, w: 8.5, h: 1.8,
        fontSize: 44, bold: true, color: BRAND.white,
        fontFace: 'Arial', align: 'left', valign: 'middle',
        wrap: true,
      });

      // Subtitle
      if (content.subtitle) {
        s.addText(content.subtitle, {
          x: 0.5, y: 3.4, w: 8.5, h: 0.8,
          fontSize: 18, color: '94A3B8',
          fontFace: 'Arial', align: 'left',
        });
      }

      // Footer bar
      s.addShape(pres.ShapeType.rect, {
        x: 0, y: 6.8, w: '100%', h: 0.6,
        fill: { color: BRAND.navyLight },
        line: { color: BRAND.navyLight },
      });

    } else {
      // Light background
      s.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: '100%',
        fill: { color: BRAND.lightGray },
        line: { color: BRAND.lightGray },
      });

      // Navy header band
      s.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 1.1,
        fill: { color: BRAND.navy },
        line: { color: BRAND.navy },
      });

      // Indigo accent bar (left side of header)
      s.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: 0.08, h: 1.1,
        fill: { color: ACCENT },
        line: { color: BRAND.indigo },
      });

      // Slide title in header band
      s.addText(slide.title, {
        x: 0.3, y: 0.1, w: 9.2, h: 0.9,
        fontSize: 26, bold: true, color: BRAND.white,
        fontFace: 'Arial', align: 'left', valign: 'middle',
      });

      // Bullet content — half-width when a chart shares the slide.
      const hasChart = !!slide.chart;
      if (slide.bullets && slide.bullets.length > 0) {
        const bulletItems = slide.bullets.map((b) => ({
          text: b,
          options: {
            bullet: { type: 'bullet' as const },
            fontSize: 16,
            color: BRAND.textDark,
            fontFace: 'Arial',
            paraSpaceAfter: 8,
          },
        }));

        s.addText(bulletItems, {
          x: 0.5, y: 1.3, w: hasChart ? 5.2 : 9, h: 5.4,
          valign: 'top',
        });
      }

      // NATIVE CHART (DH4 — the pptxgenjs unlock): code-validated data, accent-colored.
      if (slide.chart) {
        const c = slide.chart;
        const chartType = c.type === 'pie' ? pres.ChartType.pie : c.type === 'line' ? pres.ChartType.line : pres.ChartType.bar;
        const pos = slide.bullets?.length
          ? { x: 6.0, y: 1.3, w: 6.8, h: 5.2 }
          : { x: 0.8, y: 1.4, w: 11.7, h: 5.2 };
        s.addChart(chartType, [{ name: c.title ?? slide.title, labels: c.labels, values: c.values }], {
          ...pos,
          chartColors: c.type === 'pie' ? undefined : [ACCENT],
          showTitle: !!c.title, title: c.title, titleFontSize: 14,
          catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
          dataLabelFontSize: 10, showValue: c.type !== 'line',
        });
      }

      // The letterhead corner: logo bottom-right + footer line bottom-left; a second mark
      // (the co-brand) top-right.
      if (logoDataUrl) {
        s.addImage({ data: logoDataUrl, x: 13.33 - logoW - 0.25, y: 7.5 - logoH - 0.15, w: logoW, h: logoH });
      }
      if (logo2DataUrl) {
        s.addImage({ data: logo2DataUrl, x: 13.33 - logo2W - 0.25, y: 0.15, w: logo2W, h: logoH });
      }
      if (theme?.footer || theme?.brandName) {
        s.addText([theme?.footer, theme?.brandName].filter(Boolean).join(' · '), {
          x: 0.3, y: 7.15, w: 8, h: 0.3, fontSize: 9, color: '9CA3AF', fontFace: 'Arial', align: 'left',
        });
      }
    }

    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  }

  return await pres.write({ outputType: 'nodebuffer' } as any) as Buffer;
}

export async function buildXlsx(content: XlsxContent): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  for (const sheet of content.sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);

    // Auto column widths — measure max char length per column
    const allRows = [sheet.headers, ...sheet.rows];
    const colWidths = sheet.headers.map((_, colIdx) => {
      const maxLen = allRows.reduce((max, row) => {
        const cell = row[colIdx];
        const len = cell != null ? String(cell).length : 0;
        return Math.max(max, len);
      }, 10); // minimum 10 chars
      return { wch: Math.min(maxLen + 2, 60) }; // +2 padding, cap at 60
    });
    ws['!cols'] = colWidths;

    // Freeze header row
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function getFileExt(type: DeliverableType): string {
  if (type === 'presentation') return 'pptx';
  if (type === 'spreadsheet') return 'xlsx';
  return 'docx';
}

export function getMimeType(type: DeliverableType): string {
  if (type === 'presentation') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (type === 'spreadsheet') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export async function buildArtifactFile(type: DeliverableType, content: ArtifactContent, options?: { pageSize?: 'letter' | 'a4'; theme?: DocTheme | null }): Promise<Buffer> {
  if (type === 'presentation') return buildPptx(content as PptxContent, options?.theme);
  if (type === 'spreadsheet') return buildXlsx(content as XlsxContent); // xlsx styling waits for the compiler (SheetJS community writes no cell styles)
  return buildDocx(content as DocContent, options);
}
