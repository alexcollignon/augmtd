import OpenAI from 'openai';

export interface LineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
}

// Extracted fields are keyed by the label string the user requested (e.g. "VAT ID", "Vendor")
export interface InvoiceData {
  raw_filename: string;
  line_items: LineItem[];
  extracted: Record<string, string | number | null>;
}

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// "File" is a reserved label handled by the pipeline, not extracted from the invoice
const RESERVED_LABELS = new Set(['File']);

function buildExtractionPrompt(fields: string[]): string {
  const extractable = fields.filter((f) => !RESERVED_LABELS.has(f));
  const fieldList = extractable.map((f) => `- ${f}`).join('\n');
  const keyList = JSON.stringify(extractable);

  return `You are an invoice data extractor. Extract the following fields from the invoice and return them as a JSON object.

Fields to extract:
${fieldList}
Also always extract: line_items (array of {description, quantity, unit_price, total}).

Rules:
- For each field, first ask: is this value literally present on the invoice, or does it require reasoning?
  - If it can be read directly (a name, number, date, ID, code): extract exactly as shown. Return null only if genuinely absent.
  - If it requires interpretation, classification, or judgement: reason from everything you can see and always provide a concrete value — never return null for these.
- Date fields: YYYY-MM-DD format or null
- Amount/price fields: number without currency symbols or null
- Currency fields: 3-letter ISO code (e.g. EUR, USD)

Return JSON with exactly these keys: ${keyList}, "line_items"`;
}

function nullInvoice(raw_filename: string, fields: string[]): InvoiceData {
  return {
    raw_filename,
    line_items: [],
    extracted: Object.fromEntries(
      fields.filter((f) => !RESERVED_LABELS.has(f)).map((f) => [f, null])
    ),
  };
}

export async function extractInvoiceData(
  filename: string,
  buffer: Buffer,
  mimeType: string,
  fields: string[]
): Promise<InvoiceData> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = buildExtractionPrompt(fields);

  try {
    let messages: OpenAI.Chat.ChatCompletionMessageParam[];

    if (IMAGE_MIME_TYPES.includes(mimeType)) {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;
      messages = [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: 'Extract the requested fields from this invoice.' },
          ],
        },
      ];
    } else {
      const imported = await import('pdf-parse');
      const PDFParse = (imported as any).PDFParse ?? (imported as any).default?.PDFParse;
      let text = '';
      try {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        text = result.text || '';
      } catch {
        text = '';
      }
      messages = [
        {
          role: 'user',
          content: `Extract the requested fields from the following invoice text.\n\n${text.slice(0, 4000)}`,
        },
      ];
    }

    const model = IMAGE_MIME_TYPES.includes(mimeType) ? 'gpt-4o' : 'gpt-4o-mini';
    const completion = await openai.chat.completions.create({
      model,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const { line_items, ...rest } = parsed;

    return {
      raw_filename: filename,
      line_items: Array.isArray(line_items) ? line_items : [],
      extracted: rest,
    };
  } catch (err) {
    console.error(`[InvoiceExtractor] Failed to extract ${filename}:`, err);
    return nullInvoice(filename, fields);
  }
}

export async function extractInvoicesFromFiles(
  files: Array<{ filename: string; buffer: Buffer; mimeType: string }>,
  fields: string[]
): Promise<InvoiceData[]> {
  const results: InvoiceData[] = [];
  for (const file of files) {
    const data = await extractInvoiceData(file.filename, file.buffer, file.mimeType, fields);
    results.push(data);
  }
  return results;
}
