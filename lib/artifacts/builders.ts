import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, convertInchesToTwip,
} from 'docx';
import type { DeliverableType, DocContent, PptxContent, XlsxContent, ArtifactContent } from '@/lib/types/inbox';

// Detect lines that are bullet items (start with "- ", "• ", "* ")
function isBulletLine(line: string): boolean {
  return /^[-•*]\s/.test(line.trim());
}

function stripBulletPrefix(line: string): string {
  return line.trim().replace(/^[-•*]\s+/, '');
}

export function buildDocx(content: DocContent, options?: { pageSize?: 'letter' | 'a4' }): Promise<Buffer> {
  const isA4 = options?.pageSize === 'a4';
  const NUMBERING_REF = 'bullet-list';

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
    }],
  };

  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: content.title, bold: true, size: 48, font: 'Arial', color: '111827' })],
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

      for (const line of lines) {
        if (isBulletLine(line)) {
          children.push(
            new Paragraph({
              numbering: { reference: NUMBERING_REF, level: 0 },
              children: [new TextRun({ text: stripBulletPrefix(line), size: 24, font: 'Arial', color: '1F2937' })],
              spacing: { after: 80 },
            })
          );
        } else {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 24, font: 'Arial', color: '1F2937' })],
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

export async function buildPptx(content: PptxContent): Promise<Buffer> {
  const pptxgen = (await import('pptxgenjs')).default;
  const pres = new pptxgen();

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
        fill: { color: BRAND.indigo },
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
        fill: { color: BRAND.indigo },
        line: { color: BRAND.indigo },
      });

      // Slide title in header band
      s.addText(slide.title, {
        x: 0.3, y: 0.1, w: 9.2, h: 0.9,
        fontSize: 26, bold: true, color: BRAND.white,
        fontFace: 'Arial', align: 'left', valign: 'middle',
      });

      // Bullet content
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
          x: 0.5, y: 1.3, w: 9, h: 5.4,
          valign: 'top',
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

export async function buildArtifactFile(type: DeliverableType, content: ArtifactContent, options?: { pageSize?: 'letter' | 'a4' }): Promise<Buffer> {
  if (type === 'presentation') return buildPptx(content as PptxContent);
  if (type === 'spreadsheet') return buildXlsx(content as XlsxContent);
  return buildDocx(content as DocContent, options);
}
