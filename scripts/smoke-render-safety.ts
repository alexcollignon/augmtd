// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE RENDER-SAFETY FLOOR (permanent, Sep 22 — stabilization W0.1, invariant 3): no untrusted or
// model-authored HTML executes or fetches remote resources before an explicit user action.
// Inbound mail rendered through a shadow root (inline handlers RAN — stored XSS from any sender) and
// drafts mounted raw (a remote <img> exfiltrated at render, before approval). Now: inbound mail →
// a sandboxed srcdoc iframe with scripts off; drafts → ONE allowlist sanitizer. Pure fixtures +
// source floors — zero AI, zero DB, runs in seconds.
// Run: npx tsx scripts/smoke-render-safety.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { sanitizeDraftHtml, sanitizeSignatureHtml } from '../lib/utils/sanitize-html';
import { emailBodyHTML } from '../lib/prepare/email-card';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// A sanitized string is INERT when nothing in it can run or fetch.
const RUNS = /<script|<svg|<iframe|<object|<embed|<form|<meta|<base|<style|<link|\son[a-z]+\s*=|javascript:/i;

console.log('THE SANITIZER (drafts — model/user-authored HTML):');
{
  const d = sanitizeDraftHtml;
  ok('<img src=x onerror> — handler gone, relative src gone',
    !/onerror/i.test(d('<img src=x onerror=alert(1)>')) && !/<img/i.test(d('<img src=x onerror=alert(1)>')), d('<img src=x onerror=alert(1)>'));
  ok('<script> removed WITH its content',
    d('<p>hi<script>alert(1)</script></p>') === '<p>hi</p>', d('<p>hi<script>alert(1)</script></p>'));
  ok('<svg onload> removed', !RUNS.test(d('<svg onload=alert(1)><circle/></svg><p>a</p>')), d('<svg onload=alert(1)><circle/></svg><p>a</p>'));
  ok('remote <img src=https://…> in a DRAFT is stripped (no fetch before approval)',
    !/<img/i.test(d('<p>x</p><img src="https://tracker.example.com/p.png">')), d('<p>x</p><img src="https://tracker.example.com/p.png">'));
  ok('protocol-relative <img src=//…> stripped', !/<img/i.test(d('<img src="//tracker.example.com/p.png">')));
  ok('style url() dropped, a plain style kept',
    !/url\(/i.test(d('<p style="background:url(https://e.example.com/x)">x</p>'))
    && /color:\s*red/.test(d('<p style="color:red">y</p>')), d('<p style="background:url(https://e.example.com/x)">x</p>'));
  ok('style expression()/@import dropped',
    !/expression|@import/i.test(d('<p style="width:expression(alert(1))">a</p><div style="@import \'x\'">b</div>')));
  ok('javascript: href removed, https href kept',
    !/javascript:/i.test(d('<a href="javascript:alert(1)">x</a>')) && /href="https:\/\/acme\.example\.com"/.test(d('<a href="https://acme.example.com">ok</a>')));
  ok('mailto: href kept', /href="mailto:sam@acme\.example\.com"/.test(d('<a href="mailto:sam@acme.example.com">Sam</a>')));
  ok('<form> + inputs removed', !/<form|<input/i.test(d('<form action="https://e.example.com"><input name=a><button>go</button></form>')));
  ok('<meta http-equiv=refresh> removed', !/<meta/i.test(d('<meta http-equiv="refresh" content="0;url=https://e.example.com"><p>a</p>')));
  ok('<iframe> removed', !/<iframe/i.test(d('<iframe src="https://e.example.com"></iframe><p>a</p>')));
  ok('<base>/<link>/<style> removed', !RUNS.test(d('<base href="https://e.example.com/"><link rel=stylesheet href="https://e.example.com/x.css"><style>p{}</style><p>a</p>')));
  ok('data: image KEPT', /<img src="data:image\/png;base64,AAAA"/.test(d('<img src="data:image/png;base64,AAAA">')));
  ok('cid: image KEPT (inline attachment ref)', /<img src="cid:logo@acme"/.test(d('<img src="cid:logo@acme">')));
  ok('formatting survives (p/b/ul/li/blockquote/table)',
    d('<p><b>Hi</b> Sam</p><ul><li>a</li></ul><blockquote>q</blockquote><table><tr><td>1</td></tr></table>').includes('<b>Hi</b>')
    && d('<ul><li>a</li></ul>').includes('<li>a</li>'));
  ok('links open in a new tab, no opener', /target="_blank"/.test(d('<a href="https://a.example.com">x</a>')) && /noopener/.test(d('<a href="https://a.example.com">x</a>')));
  ok('empty / null input → empty string', d('') === '' && d(null) === '' && d(undefined) === '');
}

console.log('\nTHE SIGNATURE PROFILE (the user\'s own signature):');
{
  const s = sanitizeSignatureHtml;
  ok('remote https logo KEPT in a signature', /<img src="https:\/\/cdn\.acme\.example\.com\/logo\.png"/.test(s('<img src="https://cdn.acme.example.com/logo.png">')));
  ok('…but http (cleartext) logo stripped', !/<img/i.test(s('<img src="http://cdn.acme.example.com/logo.png">')));
  ok('handlers/scripts still die in a signature', !RUNS.test(s('<img src="https://cdn.acme.example.com/l.png" onerror=alert(1)><script>x</script>')));
}

console.log('\nTHE ONE BODY SERIALIZATION (lib/prepare/email-card emailBodyHTML):');
{
  const hostile = '<p>Hi Sam</p><img src="https://tracker.example.com/p.png"><img src=x onerror=alert(1)><script>alert(1)</script>';
  const out = emailBodyHTML(hostile);
  ok('markup passes the draft sanitizer (no remote img, no handler, no script)',
    !/<img|onerror|<script/i.test(out) && out.includes('<p>Hi Sam</p>'), out);
  ok('plain text still becomes escaped paragraphs', emailBodyHTML('a < b\n\nc') === '<p>a &lt; b</p><p>c</p>', emailBodyHTML('a < b\n\nc'));
}

// ── SOURCE FLOORS ─────────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}
const files = [...walk('components'), ...walk('app')];

// A raw HTML sink is lawful only when its value passes a sanitizer, or the site is on this list
// WITH ITS REASON (the tier-routing allowlist idiom). Adding a sink is a deliberate act.
const SINK_ALLOW: Array<{ file: string; match: RegExp; reason: string }> = [
  { file: 'components/meetings/meeting-document.tsx', match: /__html:\s*renderInline\(/, reason: 'renderInline escapes &<> BEFORE adding its own markup' },
  { file: 'components/inbox/format-toolbar.tsx', match: /span\.innerHTML = font\.innerHTML/, reason: 'moves the editor\'s OWN already-mounted DOM' },
  { file: 'components/inbox/compose-panel.tsx', match: /el\.innerHTML = el\.innerHTML \+ existingSig/, reason: 're-appends the already-sanitized signature node' },
  { file: 'components/inbox/work-detail-inline.tsx', match: /el\.innerHTML = el\.innerHTML \+ existingSig/, reason: 're-appends the already-sanitized signature node' },
  { file: 'components/settings/connection-card.tsx', match: /editorRef\.current\.innerHTML = (sanitizeSignatureHtml\(signature \?\? ''\)|'')/, reason: 'the user\'s own signature in its own settings editor, through the signature profile (or cleared)' },
];

console.log('\nSOURCE FLOORS:');
{
  const violations: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // comments
      const sink = /shadow(Root)?\.innerHTML\s*=/.test(line)
        || /dangerouslySetInnerHTML\s*[=:]/.test(line)
        || /\.innerHTML\s*=(?!=)/.test(line);
      if (!sink) return;
      if (/sanitize(Draft|Signature)Html\(/.test(line)) return;
      if (/\.innerHTML\s*=\s*(''|""|``)\s*;?\s*$/.test(line)) return; // clearing
      if (SINK_ALLOW.some(a => f === a.file && a.match.test(line))) return;
      violations.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  ok('no raw HTML sink in components/ or app/ (sanitized or allowlisted with a reason)',
    violations.length === 0, violations.join('\n      '));
  const shadow = files.filter(f => /shadow(Root)?\.innerHTML/.test(readFileSync(f, 'utf8')));
  ok('no shadow-root email renderer survives', shadow.length === 0, shadow.join(', '));
  const emailSink = files.filter(f => /__html:\s*[\w.?]*(html_body|htmlBody)/.test(readFileSync(f, 'utf8')));
  ok('no inbound email html (html_body/htmlBody) reaches dangerouslySetInnerHTML', emailSink.length === 0, emailSink.join(', '));

  const bad: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/sandbox=\{?["'`]([^"'`]*)["'`]/g)) {
      if (/allow-scripts/.test(m[1]) && /allow-same-origin/.test(m[1])) bad.push(`${f}: ${m[1]}`);
    }
  }
  const tm = readFileSync('components/inbox/thread-messages.tsx', 'utf8');
  const sbConst = tm.match(/EMAIL_FRAME_SANDBOX\s*=\s*'([^']*)'/)?.[1] ?? '';
  ok('no sandbox anywhere grants BOTH allow-scripts and allow-same-origin', bad.length === 0, bad.join('; '));
  ok('the email frame sandbox NEVER contains allow-scripts', !!sbConst && !/allow-scripts/.test(sbConst), sbConst);
  ok('the email frame mounts that sandbox on an <iframe srcDoc>',
    /<iframe[\s\S]{0,300}srcDoc=\{srcDoc\}[\s\S]{0,120}sandbox=\{EMAIL_FRAME_SANDBOX\}/.test(tm));
  const cspConst = tm.match(/EMAIL_FRAME_CSP\s*=\s*"([^"]*)"/)?.[1] ?? '';
  ok('the srcdoc carries the CSP meta (script-src none · object-src none · form-action none · frame-src none)',
    /script-src 'none'/.test(cspConst) && /object-src 'none'/.test(cspConst) && /form-action 'none'/.test(cspConst) && /frame-src 'none'/.test(cspConst)
    && /http-equiv="Content-Security-Policy" content="\$\{EMAIL_FRAME_CSP\}"/.test(tm), cspConst);
  ok('the srcdoc carries <base target="_blank">', /<base target="_blank">/.test(tm));
  ok('tracking pixels + cid: refs stay hidden', /img\[width="1"\], img\[height="1"\], img\[src\^="cid:"\] \{ display: none !important; \}/.test(tm));
  ok('the auto-height observer is disconnected on unmount', /return \(\) => \{[\s\S]{0,200}ro\?\.disconnect\(\)/.test(tm));
  const inbox = readFileSync('app/inbox/inbox-page-client.tsx', 'utf8');
  ok('the inbox detail panes render html through IframeEmailBody',
    (inbox.match(/<IframeEmailBody html=\{email\.(html_body|htmlBody)\}/g) ?? []).length === 2);
  const cfg = readFileSync('next.config.ts', 'utf8');
  ok('CSP carries no retired provider hosts (together, fireworks)', !/together\.xyz|fireworks\.ai/.test(cfg));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
