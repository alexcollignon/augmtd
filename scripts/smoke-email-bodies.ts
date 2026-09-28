/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SMOKE — THE PLAIN BODY IS PLAIN + A DOCUMENT IS NEVER A LOGO (W18.B · owner walk, Sep 25).
 *
 * ZERO-AI, ZERO-DB, deterministic. The walk: an invoice mail's text/plain part carried the whole
 * HTML document; the sync stored it verbatim and the card showed "<html><head><meta…". Its invoice
 * PDF was never stored: the parser skipped ANY part with a Content-ID, and that mailer gave every
 * part one.
 *
 *   H · the one converter (lib/core/text.ts): looksLikeHtml · htmlToText · plainBody
 *   P · parse time: Gmail (text/plain carrying HTML · HTML-only) and Outlook (html body, <style>)
 *   R · read time: the thread tail and the thread route convert stored rows (no data write)
 *   T · attachments: a Content-ID / inline DOCUMENT is kept; an embedded IMAGE is still skipped
 *   S · the private strippers consolidated onto the one converter
 *
 * Run: npx tsx scripts/smoke-email-bodies.ts
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { looksLikeHtml, htmlToText, plainBody } from '../lib/core/text';
import { parseGmailMessage, type GmailMessage } from '../lib/google/gmail';
import { parseOutlookMessage } from '../lib/microsoft/outlook';
import { threadTail } from '../lib/triage/words';
import { skipEmbeddedPart, isImagePart } from '../lib/email-sync/attachment-policy';

let pass = 0, fail = 0;
const gate = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

// ── fixtures (generic fakes only) ──
const INVOICE_HTML = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>td{font-family:Arial} .x{color:red}</style><title>Invoice</title></head>' +
  '<body><div>Dear customer,</div><div><br></div><p>Your invoice <b>#1042</b> from Acme Ltd is attached.</p>' +
  '<table><tr><td>Amount</td><td>&euro;120.00</td></tr><tr><td>Due</td><td>30&nbsp;Sep</td></tr></table>' +
  '<ul><li>Pay by transfer</li><li>Questions? Reply to this mail</li></ul><p>Thanks &amp; regards,<br>Acme billing</p></body></html>';

// ═══ H · THE ONE CONVERTER ═══
console.log('\nH · the one converter');
{
  gate('H1 looksLikeHtml: a document and a tag-dense fragment are HTML', looksLikeHtml(INVOICE_HTML) && looksLikeHtml('<p>Hi</p><p>there</p><br>'));
  gate('H2 looksLikeHtml: plain prose with a "<" or a single tag stays plain',
    !looksLikeHtml('If a < b and c > d then we proceed.') && !looksLikeHtml('Use the <b> tag for bold.') && !looksLikeHtml('') && !looksLikeHtml(null));
  const t = htmlToText(INVOICE_HTML);
  gate('H3 htmlToText: no markup, no head/style/title text, entities decoded once, lines kept',
    !/[<>]/.test(t) && !/font-family|color:red|Invoice\n/.test(t) && /€120\.00/.test(t) && /30 Sep/.test(t) && /Thanks & regards,\nAcme billing/.test(t)
    && /^Dear customer,/.test(t) && /- Pay by transfer\n- Questions\?/.test(t), JSON.stringify(t));
  gate('H4b htmlToText: accented Latin named entities decode (W18 walk — "Ol&aacute;" rendered raw)',
    htmlToText('<p>Ol&aacute;, aten&ccedil;&atilde;o &agrave; n&atilde;o &Eacute; &uuml;ber &oslash;</p>') === 'Olá, atenção à não É über ø');
  gate('H4 htmlToText: one pass — "&amp;lt;" stays the literal "&lt;"', htmlToText('<p>a &amp;lt; b</p>') === 'a &lt; b');
  gate('H5 plainBody: plain text passes unchanged; HTML converts', plainBody('Hi Sam,\n\n  keep  spacing') === 'Hi Sam,\n\n  keep  spacing' && plainBody(INVOICE_HTML) === t);
}

// ═══ P · PARSE TIME ═══
console.log('\nP · parse time (Gmail + Outlook)');
const gmailMsg = (parts: unknown[], snippet = 'snippet &amp; text'): GmailMessage => ({
  id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet, internalDate: String(Date.parse('2026-09-25T10:00:00Z')),
  payload: { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Acme Billing <billing@acme.example>' }, { name: 'Subject', value: 'Invoice' }], parts },
});
const pdfPart = (headers: Array<{ name: string; value: string }>, mimeType = 'application/pdf', filename = 'invoice-1042.pdf') =>
  ({ mimeType, filename, headers, body: { attachmentId: `att-${filename}`, size: 20480 } });
{
  const p1 = parseGmailMessage(gmailMsg([
    { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: b64(INVOICE_HTML) } },
      { mimeType: 'text/html', body: { data: b64(INVOICE_HTML) } },
    ] },
  ]));
  gate('P1 Gmail: a text/plain part CARRYING the HTML document is stored as text; html_body keeps the markup',
    !/<html|<head|<meta/i.test(p1.body) && /Your invoice #1042 from Acme Ltd is attached\./.test(p1.body) && p1.html_body === INVOICE_HTML);
  const p2 = parseGmailMessage(gmailMsg([{ mimeType: 'text/html', body: { data: b64(INVOICE_HTML) } }]));
  gate('P2 Gmail: an HTML-only mail stores the HTML\'s text as body (not the escaped snippet)', /Dear customer,/.test(p2.body) && !/snippet/.test(p2.body));
  const p3 = parseGmailMessage(gmailMsg([{ mimeType: 'text/plain', body: { data: b64('Hi Sam,\n\nPlain words only.\n\nAlex') } }]));
  gate('P3 Gmail: a real plain body is untouched', p3.body === 'Hi Sam,\n\nPlain words only.\n\nAlex');
  const o1 = parseOutlookMessage({
    id: 'o1', conversationId: 'c1', subject: 'Invoice', bodyPreview: 'preview', body: { contentType: 'html', content: INVOICE_HTML },
    from: { emailAddress: { name: 'Acme Billing', address: 'billing@acme.example' } }, toRecipients: [], ccRecipients: [],
    receivedDateTime: '2026-09-25T10:00:00Z', internetMessageId: '<o1@acme.example>',
  } as never);
  gate('P4 Outlook: the html body converts through the one converter — the <style> CSS no longer leaks in as text',
    !/[<>]/.test(o1.body) && !/font-family/.test(o1.body) && /€120\.00/.test(o1.body) && o1.html_body === INVOICE_HTML);
  const o2 = parseOutlookMessage({
    id: 'o2', conversationId: 'c2', subject: 'x', bodyPreview: '', body: { contentType: 'text', content: INVOICE_HTML },
    from: { emailAddress: { name: 'A', address: 'a@acme.example' } }, toRecipients: [], ccRecipients: [], receivedDateTime: '2026-09-25T10:00:00Z',
  } as never);
  gate('P5 Outlook: a `text` body that is really markup converts too', !/<html/i.test(o2.body) && /Dear customer/.test(o2.body));
}

// ═══ R · READ TIME ═══
console.log('\nR · read time — rows stored before the fix display correctly without a data write');
{
  const tail = threadTail([{ id: 'e1', from: 'billing@acme.example', fromName: 'Acme Billing', body: INVOICE_HTML, isFromUser: false }]);
  gate('R1 the thread tail reads a stored HTML body as text (the card no longer shows "<html><head><meta…")',
    tail.length === 1 && !/<html|<meta|<head/i.test(tail[0].body) && /Dear customer/.test(tail[0].body), JSON.stringify(tail[0]?.body?.slice(0, 80)));
  const plainTail = threadTail([{ id: 'e2', from: 'a@acme.example', body: 'It&#39;s done &amp; sent.', isFromUser: false }]);
  gate('R2 a plain escaped body still decodes as before (W5b)', plainTail[0]?.body === "It's done & sent.");
  const route = src('app/api/inbox/[id]/thread/route.ts');
  gate('R3 the thread route serves bodies through plainBody (snippet derives from it)',
    /const body: string \| null = typeof e\.body === 'string' \? plainBody\(e\.body\) : null;/.test(route) && /import \{ plainBody \} from '@\/lib\/core\/text';/.test(route));
  const dr = src('lib/inbox/draft-reply.ts');
  gate('R4 the reply drafter reads the stored body and the newest inbound as text', /let body = plainBody\(String\(sourceData\.body/.test(dr) && /const lastBody = plainBody\(/.test(dr));
}

// ═══ T · ATTACHMENTS ═══
console.log('\nT · a Content-ID / inline DOCUMENT is kept; an embedded IMAGE is skipped');
{
  const cid = [{ name: 'Content-ID', value: '<part1@acme.example>' }];
  const inline = [{ name: 'Content-Disposition', value: 'inline; filename="logo.png"' }];
  const p = parseGmailMessage(gmailMsg([
    { mimeType: 'text/plain', body: { data: b64('Please find the invoice attached.') } },
    pdfPart(cid),                                                        // the owner's case
    pdfPart([...cid, { name: 'Content-Disposition', value: 'inline' }], 'application/octet-stream', 'statement.pdf'),
    pdfPart(cid, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'breakdown.xlsx'),
    pdfPart(cid, 'image/png', 'logo.png'),                                // a signature logo
    pdfPart(inline, 'image/jpeg', 'banner.jpg'),
    pdfPart([], 'image/png', 'image001.png'),
    pdfPart([], 'image/png', 'site-photo.png'),                           // a real attached photo
  ]));
  const names = p.attachments.map((a) => a.filename).sort();
  gate('T1 Gmail keeps the Content-ID PDF, the inline octet-stream PDF and the Content-ID spreadsheet',
    names.includes('invoice-1042.pdf') && names.includes('statement.pdf') && names.includes('breakdown.xlsx'), JSON.stringify(names));
  gate('T2 Gmail still skips the cid logo, the inline banner and image001.png — and keeps a plainly attached photo',
    !names.includes('logo.png') && !names.includes('banner.jpg') && !names.includes('image001.png') && names.includes('site-photo.png'), JSON.stringify(names));
  gate('T3 the Outlook rule (isInline): an inline PDF is kept, an inline image skipped',
    !skipEmbeddedPart({ mimeType: 'application/pdf', filename: 'invoice.pdf', inline: true })
    && skipEmbeddedPart({ mimeType: 'image/png', filename: 'logo.png', inline: true })
    && !skipEmbeddedPart({ mimeType: 'image/png', filename: 'photo.png', inline: false }));
  gate('T4 isImagePart: MIME first, extension only for a generic type',
    isImagePart('image/gif', 'x.pdf') && !isImagePart('application/pdf', 'scan.png') && isImagePart('application/octet-stream', 'x.JPG') && !isImagePart(null, 'x.pdf'));
  const ol = src('lib/microsoft/outlook.ts');
  gate('T5 the Outlook attachment listing filters through the one keep rule (never a bare !isInline)',
    /\.filter\(a => !skipEmbeddedPart\(\{ mimeType: a\.contentType, filename: a\.name, inline: !!a\.isInline \}\)\)/.test(ol) && !/\.filter\(a => !a\.isInline\)/.test(ol));
}

// ═══ S · CONSOLIDATION ═══
console.log('\nS · the private strippers now call the one converter');
{
  gate('S1 voice-context: no private stripper (exemplars read through draft-language → plainBody)', !/function stripHtml/.test(src('lib/context/voice-context.ts')));
  gate('S2 voice-profile + the inbox chat route delegate to htmlToText',
    /const stripHtml = \(html: string\): string => htmlToText\(html\);/.test(src('lib/context/voice-profile.ts'))
    && /const stripHtmlForAI = \(html: string\): string => htmlToText\(html\);/.test(src('app/api/inbox/chat/route.ts')));
  gate('S3 Outlook\'s two private strippers are gone', !/\.replace\(\/<\\\/p>\/gi, '\\n\\n'\)/.test(src('lib/microsoft/outlook.ts')));
  gate('S4 lib/core/text.ts stays client-safe (no imports at all)', !/^import /m.test(src('lib/core/text.ts')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
