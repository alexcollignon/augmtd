import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} from 'docx';
import type { DeliverableType, DocContent, PptxContent, XlsxContent, ArtifactContent } from '@/lib/types/inbox';

export function buildDocx(content: DocContent): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: content.title, bold: true, size: 48, font: 'Arial' })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 240 },
    })
  );

  if (content.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: content.subtitle, size: 28, color: '666666', font: 'Arial' })],
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
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 24, font: 'Arial' })],
          spacing: { after: 160 },
        })
      );
    }
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Arial', color: '1a1a1a' },
          paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Arial', color: '333333' },
          paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

export async function buildPptx(content: PptxContent): Promise<Buffer> {
  const pptxgen = (await import('pptxgenjs')).default;
  const pres = new pptxgen();

  for (const slide of content.slides) {
    const s = pres.addSlide();

    if (slide.layout === 'title') {
      s.addText(content.title, {
        x: 0.5, y: 1.5, w: 9, h: 1.5,
        fontSize: 36, bold: true, align: 'center', color: '1a1a1a',
      });
      if (content.subtitle) {
        s.addText(content.subtitle, {
          x: 0.5, y: 3.2, w: 9, h: 0.8,
          fontSize: 18, align: 'center', color: '666666',
        });
      }
    } else {
      s.addText(slide.title, {
        x: 0.5, y: 0.3, w: 9, h: 0.8,
        fontSize: 24, bold: true, color: '1a1a1a',
      });
      if (slide.bullets && slide.bullets.length > 0) {
        const bulletText = slide.bullets.map((b) => ({ text: b, options: { bullet: true, fontSize: 16, color: '333333' } }));
        s.addText(bulletText, { x: 0.5, y: 1.3, w: 9, h: 4.5 });
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

export async function buildArtifactFile(type: DeliverableType, content: ArtifactContent): Promise<Buffer> {
  if (type === 'presentation') return buildPptx(content as PptxContent);
  if (type === 'spreadsheet') return buildXlsx(content as XlsxContent);
  return buildDocx(content as DocContent);
}
