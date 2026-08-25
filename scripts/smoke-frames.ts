// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FRAMES SUITE (permanent — THE FRAMES ARC Phase 1, docs/frames-plan.md law 8).
// The arc's laws become gates in the same release (laws-need-gates): a frame that can reach the
// network, a second renderer with a looser sandbox, a provenance chip claimed from prose, or a
// serving door that turns into an existence oracle are all one commit away without a floor here.
//
// V — THE VALIDATOR TABLE (pure: no database, no AI, no probe):
//   V1  a clean self-contained frame is ACCEPTED and carries the no-egress CSP meta exactly once;
//       re-validating the returned html is idempotent (never a second meta).
//   V2  ONE CHECK PER VECTOR — 24 poisoned documents, each carrying exactly ONE hole, each
//       rejected with exactly the reason that names it (external <script src> · protocol-relative
//       href · <link> · <iframe> · <object> · <base> (the review hole: relative URLs pass, a base
//       re-points them) · external formaction= · external ping= · css url(https…) · @import ·
//       fetch( · XMLHttpRequest · WebSocket · EventSource · sendBeacon · import( · ES import ·
//       location.href assignment · location.replace( · window.open( · <form action> ·
//       <meta refresh> · oversize · not-a-document).
//   V3  THE FALSE-POSITIVE FLOOR — five innocents that must PASS (data-location= · reading
//       location.hash · a myLocation variable · url(data:…) · sort((a,b)=>…)). A blunt validator
//       that rejects honest frames burns a repair pass on every generation.
//   V4  ALL REASONS ARE COLLECTED — three vectors in one document return ≥3 reasons (a repair
//       pass fed one hole per round trip never converges).
//
// L — THE LANE (live, ONE real generation on the probe host):
//   L1  materializeDocument(forceType 'frame', csv + a dashboard request) → tier/type 'frame',
//       ext html, mime text/html; the produced BYTES re-validate through validateFrameHtml (the
//       no-egress sweep IS the assertion — no external URL survived).
//   L2  THE STRUCTURAL STAMP — the provenance rides BOTH on Materialized.provenance AND inside
//       content.provenance, with the same computed bit. content is what every caller persists,
//       so this is the zero-caller-edit seam the serving route reads back (law 3).
//   L3  THE FALL-THROUGH FLOOR — with the AI unreachable the door still returns a deliverable.
//       Shipped as a CHILD PROCESS (execSync + npx tsx) with poisoned provider keys: a monkeypatch
//       in-process would be defeated by the module cache, and the lane imports its client lazily.
//   L4  TRIGGER HONESTY — no frame word, no forceType, no csv → the frame lane is never entered
//       (the deterministic template tier answers). No AI involved.
//
// TF — THE THIN-INPUT FLOOR (severity-1 repair, Aug 25 — pure table + one zero-AI door probe):
//   a frame is a VIEW OF WORK. Found live: a run ending at an approval gate handed the door the
//   gate's one-line marker and the lane AUTHORED a ranked dashboard of eight fabricated people,
//   share-linkable. isThinFrameSource refuses in CODE before any spend (marker SHAPE, not
//   wording; csv/computed facts count as substance), the door falls through to a plain honest
//   document, and the prompt carries THE CONTENT FLOOR + HONEST ABSENCE. The other half of this
//   repair — the deliverable picker skipping gate steps — is gated in smoke-processes P7l.
//
// S — THE SOURCE FLOORS (comment-stripped where counting — a sentence about a call site is not a
//     call site):
//   S1  ONE RENDERER, ONE SANDBOX — `sandbox=` for frames exists in exactly ONE component file and
//       its value is exactly "allow-scripts"; `allow-same-origin` appears in NO code under
//       components/ or app/.
//   S2  SRCDOC ONLY — the renderer mounts srcDoc and never src="/api/frames/… (a navigated frame
//       would be same-origin with the app).
//   S3  JSON ONLY — the serving route never answers text/html.
//   S4  ONE VALIDATOR — the generate lane imports validateFrameHtml, the route imports its cap,
//       and the CSP literal + the attribute net exist in exactly one file each (no second opinion
//       about what egress is).
//   S5  THE FRAMES TAB IS A FILTER — type === 'frame' over the runs payload, SHOW_FRAMES on.
//   S6  ONE 404 SHAPE — a single NOT_FOUND body serves unknown / foreign / not-a-frame alike, and
//       the route never answers 403 (no existence oracle).
//   S7  THE TRIGGER SET — FRAME_WORDS is exactly the spec's set and the lane is gated on
//       !revise && !templateFile (an office-file operation is never a frame).
//   S8  THE SERVING AUTHZ (the A gate, as a source floor) — ownership is the RLS client's WHERE
//       clause (.eq('user_id', user.id)) and it runs BEFORE the admin client exists. An HTTP-session
//       test would need a signed-in browser session; the scaffolding costs more than it proves,
//       so the ordering is pinned in source instead — said plainly rather than skipped silently.
//
// SH — THE SHARE LINK (Phase 3, law 6 — SHARING A FRAME IS SHARING THE DATA):
//   SH1 TOKEN ENTROPY — crypto.randomBytes→base64url, no Math.random, and no share file logs a token.
//   SH2 THE LIVE TRUTH TABLE on the probe (a real thread artifact + a real storage object, the REAL
//       public route handler invoked — it needs no session, so it is exercised end to end): owner
//       shares → the public door serves the tagged bytes + the structural stamp · re-sharing returns
//       the SAME link (one live share per artifact) · revoke → the same link 404s on the very next
//       view and the ROW IS GONE · an unknown token 404s byte-identically · a SECOND user resolves
//       nothing on the owner's artifact (their share POST is that same 404).
//   SH3 THE SOVEREIGN FLOOR — features.email === false refuses with a SPOKEN 403 (policy, not
//       secrecy) BEFORE any row is written, ownership proved on the caller's own session first.
//       A source gate: flipping a live workspace's features mid-suite is too invasive, said plainly.
//   SH4 THE PUBLIC PAGE — the endpoint prop, the ONE renderer, no auth import, no /login redirect,
//       outside (main), and middleware's protectedRoutes genuinely has no /frames.
//   SH5 NO-STORE on the served payload AND on the 404 (a cached answer outlives a revocation).
//
// LB — THE LIVING BINDING (Phase 2, law 4 — THE BINDING IS THE LIFE):
//   LB1 THE STAMP, RE-POINTED to THE ONE WRITER (THE FRAME SERIES, Aug 20) — `lib/frames/series.ts`
//       binds every head it writes {workflowId, refresh:'on_run'}, and the run loop builds NO
//       binding literal of its own any more (both sides asserted: the one-writer floor is that the
//       stamp exists THERE and nowhere else). Comment-stripped: a sentence about a stamp is not one.
//   LB2 THE LIVING SHARE, live on the probe — two generations of ONE bound series (older + newer,
//       different tagged bytes) → the OLDER is shared → the public door serves the NEWER bytes and
//       says `live: true`. Then revoke: a living link dies just as fast as a frozen one.
//   LB3 THE UNBOUND FLOOR — an artifact with NO binding serves EXACTLY its own bytes and makes no
//       live claim. A chat-born one-shot never mutates under a link someone already holds.
//   LB4 THE EXACT ADDRESS — the authed resolution on the OLDER id still yields the OLDER artifact:
//       a version is a record, and only the SHARE resolves forward.
//   LB5 FALL-BACK HONESTY — a bound artifact with no newer sibling serves its OWN bytes (the
//       identity case: living means "newest if there is one", never "gone").
//
// FR — NEW FRAME FROM AN OUTPUT (the deep-dive gallery's production door):
//   FR1 THE DEED, live on the probe — a real succeeded run's text through THE ONE PRODUCTION DOOR:
//       the frame lands on THE RUN'S OWN thread, typed 'frame' with a storage path, BOUND
//       {workflowId, refresh:'on_run'} (run-born is bound — law 4), and the stored bytes re-validate
//       through the ONE validator. Tested as a MODULE (`lib/frames/from-run.ts`), which is why the
//       route is a translation layer — pinned as a source floor.
//   FR2 AUTHZ — a foreign caller, an unknown workflow and an unknown run all refuse with the SAME
//       not_found; the route answers exactly one 404 body, never a 403, and a DECLINED frame lane
//       says so (502) instead of shipping a document wearing the word "frame".
//   FR3 THE CLAIMS FLOOR — the explainer states the living binding, never invites the reader to ask
//       for changes (revision is not built), and carries no view counter (no store behind one).
//   FR4 VISIBILITY HONESTY — "Anyone with link" renders only off `sharedFrameIds`, which the runs
//       route derives from LIVE frame_share rows (revoked = absent = Private).
//
// SR — THE FRAME SERIES (Aug 20 — one identity per series, versions behind it):
//   SR1 THE HEART, live on the probe — two rounds through the ONE writer (`upsertFrameSeries`,
//       fixture bytes, no AI) leave ONE frame artifact under ONE id: head at v2 serving round 2's
//       bytes, round 1 still addressable as v1 with both storage objects present. Then the OTHER
//       door (`createFrameFromRun`, ONE real generation) JOINS the same series as v3 — never a
//       stray sibling.
//   SR2 THE CAP — driven past FRAME_VERSION_CAP with fixture bytes: exactly 20 previous
//       generations kept (the newest), the shifted-off one's storage object GONE (polled, because
//       the removal is best-effort and un-awaited by design), the other 20 still downloadable.
//   SR3 THE ?v DOOR — the live series answers the route's own lookup (a stored version → its own
//       bytes; a dropped or unknown one → the null the route turns into its ONE 404), and the
//       route's logic is pinned in source (digits-only param, head by default, same NOT_FOUND,
//       meta always served). THE PUBLIC DOOR reads no query parameter at all — a share is a view
//       of the present, and old numbers are a retention surface a link must not widen.
//   SR4 SHARE ON THE PRESENT ONLY — both surfaces render FrameShareControl under a null-selection
//       guard, both import the ONE picker module (defined in exactly one file), both wear the same
//       versionBanner sentence.
//   SR5 THE EXPLICIT OUTPUT — artifact_type 'frame' FORCES the lane (no title lottery), a frame is
//       never built as an office attachment, generate-config authors the rule, and the
//       conversational door's enum can set it.
//   SR6 NON-FRAME PARITY — the merge dedupes by id (replace in place, else append) as a source
//       floor, and SR1's docx neighbour proves it live: carried through once, unchanged.
//
// The lane creates NO rows (materializeDocument returns bytes; persistence belongs to its callers).
// The one thing it CAN write is ai_usage_events — computeDataFacts runs through aiCall, which logs
// usage; its generated script is contract-bound to write no files, so no knowledge_files/storage
// rows appear. Both are swept in `finally` and ZERO LEFTOVERS is asserted.
// Run: npx tsx --env-file=.env.local scripts/smoke-frames.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import { validateFrameHtml, FRAME_CSP_META, FRAME_MAX_BYTES } from '@/lib/frames/validate-frame';
import { injectFrameKit, FRAME_KIT_CSS, FRAME_KIT_JS, FRAME_KIT_VERSION } from '@/lib/frames/kit';

/** The suite may be run bare — load .env.local ourselves so the header command is the whole one. */
async function loadEnv() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = await (await import('node:fs/promises')).readFile('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch { /* the client construction below will say what is missing */ }
}

// ── FIXTURE DOCUMENTS ──────────────────────────────────────────────────────────────────────────
/** A complete document around a body fragment — every fixture is a real HTML document so the
 *  not-a-document check never fires as a side effect of the vector under test. */
const doc = (body: string, head = '') =>
  `<html><head><title>Pipeline</title>${head}</head><body>${body}</body></html>`;

/** The clean frame V1 accepts: inline style, inline script, a data: image, a #fragment tab link,
 *  a mailto, and hand-rolled inline SVG — everything a tier-1 frame is allowed to be. */
const CLEAN_FRAME = doc(
  `<h1>Hiring pipeline</h1>
   <p>Prepared for Acme — questions to <a href="mailto:sam@example.com">Sam</a>.</p>
   <nav><a href="#stages">Stages</a> <a href="#roles">Roles</a></nav>
   <img alt="dot" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
   <svg viewBox="0 0 100 40"><rect x="0" y="10" width="60" height="20" fill="#4F46E5"></rect>
     <use xlink:href="#legend"></use></svg>
   <table id="rows"><tr><td>Design</td><td>4</td></tr><tr><td>Engineering</td><td>9</td></tr></table>
   <script>
     const DATA = [{"stage":"Design","n":4},{"stage":"Engineering","n":9}];
     const rows = DATA.slice().sort((a, b) => b.n - a.n);
     document.querySelectorAll('nav a').forEach((el) => el.addEventListener('click', () => {
       document.getElementById('rows').setAttribute('data-active', rows[0].stage);
     }));
   </script>`,
  `<style>body{font-family:system-ui}h1{color:#4F46E5}.bar{background:url(data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)}</style>`,
);

/** The reason FRAGMENT each vector must produce — asserted as the ONLY reason. */
const R = {
  attr: 'external URL appears in a src/href/action/poster/srcset attribute',
  cssUrl: 'CSS url() points at an external address',
  atImport: '@import loads an external stylesheet',
  base: '<base> tag is present',
  link: '<link> tag is present',
  embed: 'may not embed another document',
  refresh: 'never navigates or reloads itself',
  form: 'carries an action attribute',
  fetch: 'Script calls fetch()',
  xhr: 'references XMLHttpRequest',
  ws: 'references WebSocket',
  es: 'references EventSource',
  beacon: 'navigator.sendBeacon',
  dynImport: 'dynamic import()',
  esImport: 'ES import statement',
  locAssign: 'assigns to location/location.href',
  locReplace: 'location.replace()/location.assign()',
  open: 'window.open()',
  size: 'larger than',
  notDoc: 'not one complete HTML document',
};

const VECTORS: Array<{ name: string; html: string; reason: string }> = [
  { name: 'external <script src>', html: doc(`<script src="https://cdn.example.com/chart.js"></script>`), reason: R.attr },
  { name: 'protocol-relative href', html: doc(`<a href="//example.com/x">more</a>`), reason: R.attr },
  { name: '<link> tag', html: doc(``, `<link rel="stylesheet">`), reason: R.link },
  { name: '<iframe>', html: doc(`<iframe></iframe>`), reason: R.embed },
  { name: '<object>', html: doc(`<object></object>`), reason: R.embed },
  { name: '<base> (the review hole — relative URLs pass, base re-points them)', html: doc(``, `<base>`), reason: R.base },
  { name: 'external formaction=', html: doc(`<button formaction="https://example.com/collect">Go</button>`), reason: R.attr },
  { name: 'external ping=', html: doc(`<a ping="https://example.com/beacon">x</a>`), reason: R.attr },
  { name: 'css url(https…)', html: doc(``, `<style>body{background:url(https://example.com/bg.png)}</style>`), reason: R.cssUrl },
  { name: '@import external', html: doc(``, `<style>@import "https://example.com/a.css";</style>`), reason: R.atImport },
  { name: 'fetch(', html: doc(`<script>fetch("/api/rows").then(r=>r)</script>`), reason: R.fetch },
  { name: 'XMLHttpRequest', html: doc(`<script>var x = new XMLHttpRequest();</script>`), reason: R.xhr },
  { name: 'WebSocket', html: doc(`<script>var s = WebSocket;</script>`), reason: R.ws },
  { name: 'EventSource', html: doc(`<script>var e = EventSource;</script>`), reason: R.es },
  { name: 'sendBeacon', html: doc(`<script>navigator.sendBeacon("/x", "1");</script>`), reason: R.beacon },
  { name: 'dynamic import(', html: doc(`<script>import("./helper.js");</script>`), reason: R.dynImport },
  { name: 'ES import statement', html: doc(`<script>\nimport helper from "./helper.js";\n</script>`), reason: R.esImport },
  { name: 'location.href assignment', html: doc(`<script>window.location.href = "/next";</script>`), reason: R.locAssign },
  { name: 'location.replace(', html: doc(`<script>window.location.replace("/next");</script>`), reason: R.locReplace },
  { name: 'window.open(', html: doc(`<script>window.open("/next");</script>`), reason: R.open },
  { name: '<form action>', html: doc(`<form action="/submit"><input name="q"></form>`), reason: R.form },
  { name: '<meta refresh>', html: doc(``, `<meta http-equiv="refresh" content="0">`), reason: R.refresh },
  { name: 'oversize (>1.5MB)', html: doc(`<p>${'data '.repeat(320_000)}</p>`), reason: R.size },
  { name: 'not a document (no </html>)', html: `<html><head></head><body><p>hi</p></body>`, reason: R.notDoc },
];

const INNOCENTS: Array<{ name: string; html: string }> = [
  { name: 'data-location="x" attribute', html: doc(`<div data-location="Lisbon">HQ</div>`) },
  { name: 'reading location.hash', html: doc(`<script>var tab = location.hash.slice(1);</script>`) },
  { name: 'a variable named myLocation', html: doc(`<script>var myLocation = "Lisbon"; var n = myLocation.length;</script>`) },
  { name: 'css url(data:…)', html: doc(``, `<style>.i{background:url(data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)}</style>`) },
  { name: 'sort((a,b)=>…) — no accidental import/location hit', html: doc(`<script>var r = [3,1].sort((a,b)=>a-b);</script>`) },
];

const SMALL_CSV = [
  'stage,role,candidates,offers',
  'Screen,Engineer,42,3',
  'Screen,Designer,18,2',
  'Onsite,Engineer,12,4',
  'Onsite,Designer,6,1',
  'Offer,Engineer,5,5',
  'Offer,Designer,2,2',
].join('\n');

const FRAME_REQUEST = 'a dashboard of the hiring pipeline by stage, with the offer counts';
// RE-POINTED (Aug 25, the thin-input floor): this fixture stood at ~180 collapsed chars, just
// under FRAME_MIN_CONTENT_CHARS, so the L3 fall-through probe (which passes NO csv) would have
// been refused by the new floor before reaching the AI at all — L3 would still pass, but for the
// wrong reason. It is now a deliverable of realistic length. The floor itself is gated in TF.
const FRAME_CONTENT = [
  'Hiring pipeline — week 34.',
  'Screening carries 60 candidates across two roles; the onsite stage holds 18.',
  'Engineering converts at a visibly higher rate than Design at the offer stage.',
  'Time-to-offer lengthened by four days against week 33, concentrated in the onsite scheduling step.',
  'Two offers are outstanding and both sit past their stated decision date.',
].join('\n');

async function main() {
  await loadEnv();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, detail?: string) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const note = (t: string) => console.log(`  · ${t}`);
  const readSrc = async (p: string) => (await import('node:fs/promises')).readFile(p, 'utf8');
  /** A file's CODE, comments removed — a floor that counts occurrences must never count a
   *  sentence about them (frame-card's header EXPLAINS allow-same-origin at length). */
  const codeOf = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const walk = async (dir: string): Promise<string[]> => {
    const fs = await import('node:fs/promises');
    const ents = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of ents) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) files.push(...await walk(p));
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
    return files;
  };

  /** DOES THE STORAGE OBJECT EXIST — asked of the storage METADATA, never of `download()`.
   *  The measurement lesson (diagnosed while building SR2, and the reason this helper exists):
   *  `download()` reads through the CDN, so an object this suite already read once can keep
   *  answering with bytes AFTER it has been deleted. A retention gate that asks the cache reports
   *  a real removal as a failure — which is exactly what it did. `list(dir, {search})` is metadata
   *  truth and reflects a delete immediately. Downloads stay for BYTE assertions, where a cached
   *  copy of the right bytes is harmless. */
  const objectExists = async (path: string) => {
    const i = path.lastIndexOf('/');
    const { data } = await admin.storage.from('work-artifacts')
      .list(path.slice(0, i), { search: path.slice(i + 1), limit: 100 });
    return (data ?? []).some((o) => o.name === path.slice(i + 1));
  };

  const probeId = await resolveProbeUser(admin);
  console.log(`probe host ${probeId}`);
  const startedAt = new Date().toISOString();
  let childScript: string | null = null;
  // SH fixtures — a real thread row + a real storage object, swept in `finally`.
  let shareThreadId: string | null = null;
  let shareArtifactId: string | null = null;
  let shareStoragePath: string | null = null;
  // LB fixtures — two threads, four artifacts, four storage objects, all swept in `finally`.
  const lbThreadIds: string[] = [];
  const lbArtifactIds: string[] = [];
  const lbStoragePaths: string[] = [];
  // FR fixtures — a workflow, a succeeded run, its thread, and the frame the door makes.
  let frWorkflowId: string | null = null;
  let frRunId: string | null = null;
  let frThreadId: string | null = null;
  let frStoragePath: string | null = null;
  // SR fixtures — ONE series: a workflow, its persistent thread, a run, and every version object
  // the series ever uploaded (the cap drops some itself; the sweep asserts the rest are gone).
  let srWorkflowId: string | null = null;
  let srRunId: string | null = null;
  let srThreadId: string | null = null;
  const srStoragePaths: string[] = [];
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';

  try {
    // ══ V — THE VALIDATOR TABLE (pure) ═══════════════════════════════════════════════════════
    console.log('\nV — the validator table (pure: no database, no AI):');

    // V1 — the clean frame, and the CSP meta's idempotence.
    const v1 = validateFrameHtml(CLEAN_FRAME);
    ok('V1 a clean self-contained frame is ACCEPTED', v1.ok === true,
      v1.ok ? '' : JSON.stringify(v1.reasons));
    const countMeta = (s: string) => s.split(FRAME_CSP_META).length - 1;
    ok('V1 …and the returned html carries the no-egress CSP meta exactly once',
      v1.ok === true && countMeta(v1.html) === 1, v1.ok ? String(countMeta(v1.html)) : 'rejected');
    const v1again = v1.ok ? validateFrameHtml(v1.html) : null;
    ok('V1 …and validating the RESULT is idempotent (still one meta, still accepted)',
      !!v1again && v1again.ok === true && countMeta(v1again.html) === 1,
      v1again && !v1again.ok ? JSON.stringify(v1again.reasons) : String(v1again && v1again.ok ? countMeta(v1again.html) : '—'));
    ok('V1 …and the meta lands INSIDE <head> (a meta after the body is decorative)',
      v1.ok === true && v1.html.indexOf(FRAME_CSP_META) < v1.html.indexOf('<body'),
      v1.ok ? String(v1.html.indexOf(FRAME_CSP_META)) : 'rejected');

    // V2 — one check per vector, and the reject fires on EXACTLY that vector.
    for (const v of VECTORS) {
      const r = validateFrameHtml(v.html);
      const reasons = r.ok ? [] : r.reasons;
      ok(`V2 rejects ${v.name} — and only that`,
        r.ok === false && reasons.length === 1 && reasons[0].includes(v.reason),
        r.ok ? 'ACCEPTED' : JSON.stringify(reasons));
    }
    ok('V2 the vector table covers every documented hole (24 vectors)', VECTORS.length === 24,
      String(VECTORS.length));
    ok('V2 the oversize fixture is genuinely over the cap',
      Buffer.byteLength(VECTORS.find((v) => v.reason === R.size)!.html, 'utf8') > FRAME_MAX_BYTES);

    // V3 — the false-positive floor.
    for (const i of INNOCENTS) {
      const r = validateFrameHtml(i.html);
      ok(`V3 accepts ${i.name}`, r.ok === true, r.ok ? '' : JSON.stringify(r.reasons));
    }

    // V4 — all reasons collected, never first-only (the repair pass must converge).
    const many = validateFrameHtml(doc(
      `<script src="https://cdn.example.com/c.js"></script><script>fetch("/x")</script>`,
      `<link rel="stylesheet">`,
    ));
    ok('V4 three vectors in one document return ≥3 reasons',
      many.ok === false && many.reasons.length >= 3, many.ok ? 'ACCEPTED' : JSON.stringify(many.reasons.length));
    ok('V4 …naming each one (attribute · link · fetch)',
      many.ok === false && [R.attr, R.link, R.fetch].every((f) => many.reasons.some((x) => x.includes(f))),
      many.ok ? 'ACCEPTED' : JSON.stringify(many.reasons));

    // ══ L — THE LANE (live: ONE real generation on the probe host) ════════════════════════════
    console.log('\nL — the lane (live, one real generation on the probe host):');

    const { materializeDocument } = await import('@/lib/documents/materialize');

    // L4 first — it is deterministic and cheap, and it proves the lane has a door, not a hallway.
    const plain = await materializeDocument(admin, probeId, {
      title: 'Weekly hiring summary',
      content: 'A short written summary of the week, with no interactive ask anywhere in it.',
      request: 'write up the weekly hiring summary as a short document',
      theme: null,
    });
    ok('L4 no frame word, no forceType, no csv → the frame lane is NEVER entered',
      plain.tier === 'template' || plain.tier === 'typed', plain.tier);
    ok('L4 …and the deliverable is an honest document (never a .docx wearing type frame)',
      plain.type !== 'frame' && plain.ext !== 'html' && plain.bytes.length > 0,
      `${plain.type}/${plain.ext}/${plain.bytes.length}`);

    const frame = await materializeDocument(admin, probeId, {
      title: 'Hiring pipeline dashboard',
      content: FRAME_CONTENT,
      request: FRAME_REQUEST,
      csvText: SMALL_CSV,
      forceType: 'frame',
      theme: null,
    });

    // L1 — the shape of what the door returned.
    ok('L1 the frame lane produced the frame tier', frame.tier === 'frame', frame.tier);
    ok('L1 …typed frame / .html / text/html (never an office ext)',
      frame.type === 'frame' && frame.ext === 'html' && frame.mime === 'text/html',
      `${frame.type}/${frame.ext}/${frame.mime}`);
    const html = frame.bytes.toString('utf8');
    ok('L1 …with real bytes', html.length > 500, String(html.length));
    const reval = validateFrameHtml(html);
    ok('L1 THE NO-EGRESS SWEEP: the produced bytes re-validate clean through the ONE validator',
      reval.ok === true, reval.ok ? '' : JSON.stringify(reval.reasons));
    ok('L1 …carrying the CSP meta exactly once', countMeta(html) === 1, String(countMeta(html)));
    // …and no external address survives IN A DEREFERENCEABLE POSITION, belt and braces.
    //
    // THE FLAKE FIX (Aug 20 — this gate's own defect, twice observed): the old sweep grepped the
    // bytes for a bare `https://` ANYWHERE and so fired on whatever a real generation happened to
    // emit that day — an xmlns:xlink declaration, a w3.org identifier inside <svg><metadata>, a
    // URL mentioned in a comment or in prose. None of those is egress; the assertion was
    // generation-dependent, which is the one thing a gate may never be.
    //
    // What actually carries the law is the VALIDATOR'S OWN attribute net, so the sweep now uses
    // exactly that shape (kept literal here on purpose — a drift between this net and
    // validate-frame.ts's must be visible, and S4 already pins the net to one file). XML NAMESPACE
    // declarations are stripped first: `xmlns="http://www.w3.org/2000/svg"` is an identifier a
    // browser never dereferences, which is precisely why the validator's net excludes xmlns.
    // The whole-document law is asserted one line above, by re-running the validator itself.
    const addressable = html
      .replace(FRAME_CSP_META, '')
      .replace(/\bxmlns(?::[a-z0-9_.-]+)?\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const DEREFERENCEABLE = /(?:src|href|action|formaction|ping|poster|srcset|xlink:href)\s*=\s*["']?\s*(?:https?:|wss?:|\/\/)/i;
    const CSS_EXTERNAL = /(?:url\(\s*["']?\s*(?:https?:|wss?:|\/\/)|@import\s+["'](?:https?:|wss?:|\/\/))/i;
    ok('L1 …and holding no external address in a DEREFERENCEABLE position (attribute · css url · @import)',
      !DEREFERENCEABLE.test(addressable) && !CSS_EXTERNAL.test(addressable),
      (addressable.match(DEREFERENCEABLE) ?? addressable.match(CSS_EXTERNAL) ?? ['—'])[0]);

    // L2 — THE STRUCTURAL STAMP, on BOTH seams, with ONE bit.
    const contentProv = (frame.content as unknown as { provenance?: { computed?: boolean } }).provenance;
    ok("L2 Materialized.provenance is present (the tier's own stamp)",
      !!frame.provenance && typeof frame.provenance.computed === 'boolean', JSON.stringify(frame.provenance));
    ok('L2 …and it ALSO rides inside content.provenance (what every caller persists)',
      !!contentProv && typeof contentProv.computed === 'boolean', JSON.stringify(contentProv));
    ok('L2 …as the SAME computed bit (the zero-caller-edit seam the serving route reads back)',
      !!frame.provenance && !!contentProv && frame.provenance.computed === contentProv.computed,
      `${frame.provenance?.computed} vs ${contentProv?.computed}`);
    note(`the stamp says computed=${frame.provenance?.computed}` +
      (frame.provenance?.computed ? '' : ' (no compute service configured in this env — the bit is honest, not asserted)'));

    // L3 — THE FALL-THROUGH FLOOR, in a CHILD PROCESS. An in-process monkeypatch of the AI client
    // would be defeated by the module cache (materialize imports its lane lazily, and the lane
    // imports the factory lazily again), so the poison is applied to a fresh process's env before
    // a single app module loads.
    const { execSync } = await import('node:child_process');
    const fs = await import('node:fs/promises');
    childScript = 'scripts/.smoke-frames-fallthrough.tmp.ts';
    await fs.writeFile(childScript, [
      `// TEMPORARY child of scripts/smoke-frames.ts (L3). Deleted by the parent's finally block.`,
      // ⚠️ The factory reads AWS_BEDROCK_ACCESS_KEY / AWS_BEDROCK_SECRET_KEY — the *_ID/_SECRET_ACCESS_KEY
      // names fenced nothing (latent while probes ran on standard tier; exposed the day the probe host
      // moved to bedrock_optimised and "AI unreachable" quietly became reachable). Both sets stay fenced.
      `for (const k of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','AWS_BEDROCK_ACCESS_KEY_ID','AWS_BEDROCK_SECRET_ACCESS_KEY','AWS_BEDROCK_ACCESS_KEY','AWS_BEDROCK_SECRET_KEY','AZURE_OPENAI_API_KEY']) {`,
      `  process.env[k] = 'invalid-key-for-the-fall-through-gate';`,
      `}`,
      `// No compute service either — the whole AI half of the lane must be unreachable.`,
      `delete process.env.COMPUTE_SERVICE_URL; delete process.env.COMPUTE_SECRET;`,
      `import { createClient } from '@supabase/supabase-js';`,
      `import { materializeDocument } from '@/lib/documents/materialize';`,
      `(async () => {`,
      `  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);`,
      `  const out = await materializeDocument(admin, ${JSON.stringify(probeId)}, {`,
      `    title: 'Hiring pipeline dashboard', content: ${JSON.stringify(FRAME_CONTENT)},`,
      `    request: ${JSON.stringify(FRAME_REQUEST)}, forceType: 'frame', theme: null,`,
      `  });`,
      `  console.log('__FRAME_FALLTHROUGH__' + JSON.stringify({ tier: out.tier, type: out.type, ext: out.ext, bytes: out.bytes.length }));`,
      `})().catch((e) => { console.log('__FRAME_FALLTHROUGH__' + JSON.stringify({ threw: String(e && e.message || e) })); });`,
    ].join('\n'), 'utf8');

    let child: { tier?: string; type?: string; ext?: string; bytes?: number; threw?: string } = {};
    try {
      const raw = execSync(`npx tsx --env-file=.env.local ${childScript}`, {
        cwd: process.cwd(), encoding: 'utf8', timeout: 240_000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const line = raw.split('\n').find((l) => l.includes('__FRAME_FALLTHROUGH__'));
      child = line ? JSON.parse(line.slice(line.indexOf('__FRAME_FALLTHROUGH__') + '__FRAME_FALLTHROUGH__'.length)) : {};
    } catch (e) {
      child = { threw: `child process failed: ${(e as Error).message.slice(0, 200)}` };
    }
    ok('L3 the door RETURNS with the AI unreachable (it never throws at the caller)',
      !child.threw && typeof child.tier === 'string', child.threw ?? JSON.stringify(child));
    ok('L3 …falling THROUGH the frame tier (a failed generation is never a frame)',
      child.tier !== undefined && child.tier !== 'frame' && child.type !== 'frame', JSON.stringify(child));
    ok('L3 …and the user still gets a real deliverable (non-empty bytes)',
      (child.bytes ?? 0) > 0, String(child.bytes));

    // ══ TF — THE THIN-INPUT FLOOR (severity-1 repair, Aug 25) ════════════════════════════════
    // Found live: a workflow ending at an approval gate handed the door the gate's one-line
    // marker; the frame lane AUTHORED a ranked dashboard of eight fabricated people over it and
    // the result was share-linkable. The picker fix (smoke-processes P7l) is one half; this is
    // the other — a frame is a VIEW OF WORK, so with no work to view the lane must REFUSE. In
    // CODE, before any spend (the v3–v5 lesson: prompt-only enforcement of a floor coin-flips).
    console.log('\nTF — the thin-input floor (the content floor reaches the frame lane):');
    {
      const { isThinFrameSource, FRAME_MIN_CONTENT_CHARS } = await import('@/lib/frames/generate-frame');
      const marker = '[Approved by the user — looks good, ship it]';
      ok('TF a lone gate marker line is THIN (structural shape, never the wording)',
        isThinFrameSource({ content: marker }));
      ok('TF …the SHAPE is what is matched — a differently-worded marker is thin too',
        isThinFrameSource({ content: '[Approved]' })
        && isThinFrameSource({ content: '[Approval gate — auto-passed in test mode]' }));
      ok('TF a short sentence under the floor is THIN',
        isThinFrameSource({ content: 'Ranked the candidates.' }));
      ok('TF a real written deliverable is NOT thin',
        !isThinFrameSource({ content: 'x'.repeat(FRAME_MIN_CONTENT_CHARS + 1) }));
      ok('TF whitespace never buys length past the floor',
        isThinFrameSource({ content: 'a b'.padEnd(FRAME_MIN_CONTENT_CHARS * 3, ' \n') }));
      ok('TF tabular material is substance on its own (a thin note over real rows is a frame)',
        !isThinFrameSource({ content: marker, csvText: 'name,score\nA,1\nB,2' }));
      ok('TF code-computed facts are substance on their own',
        !isThinFrameSource({ content: marker, computedFacts: 'TOTAL ROWS: 9' }));

      // THE LIVE DOOR PROOF — zero AI: the refusal happens before the lane spends anything, so
      // a marker-shaped source can NEVER come back as a populated dashboard.
      const overGate = await materializeDocument(admin, probeId, {
        title: 'Candidate ranking dashboard',
        content: marker,
        request: 'build an interactive dashboard ranking the candidates',
        forceType: 'frame', theme: null,
      });
      ok('TF the door REFUSES to frame a marker line (falls through to the document tiers)',
        overGate.tier !== 'frame' && overGate.type !== 'frame' && overGate.ext !== 'html',
        `${overGate.tier}/${overGate.type}/${overGate.ext}`);
      ok('TF …and the user still gets an honest deliverable (non-empty bytes, no provenance claim)',
        overGate.bytes.length > 0 && overGate.provenance === undefined, String(overGate.bytes.length));
      // The lane's floor is CODE, not a sentence — and the prompt carries the content floor too.
      const laneSrc = await readSrc('lib/frames/generate-frame.ts');
      ok('TF the refusal is CODE at the top of the lane (before any AI client is built)',
        laneSrc.indexOf('if (isThinFrameSource(args))') > 0
        && laneSrc.indexOf('if (isThinFrameSource(args))') < laneSrc.indexOf("await import('@/lib/ai/factory')"));
      ok('TF the prompt states THE CONTENT FLOOR (format, never author) and HONEST ABSENCE',
        /THE CONTENT FLOOR/.test(laneSrc) && /never AUTHOR/.test(laneSrc)
        && /HONEST ABSENCE/.test(laneSrc) && /Invent nothing/.test(laneSrc));
      ok('TF …and the door documents the same floor at the frame tier',
        /isThinFrameSource/.test(await readSrc('lib/documents/materialize.ts')));
    }

    // ══ S — THE SOURCE FLOORS ════════════════════════════════════════════════════════════════
    console.log('\nS — the source floors:');

    const cardSrc = await readSrc('components/frames/frame-card.tsx');
    const cardCode = codeOf(cardSrc);
    const routeSrc = await readSrc('app/api/frames/[id]/route.ts');
    const routeCode = codeOf(routeSrc);
    const genSrc = await readSrc('lib/frames/generate-frame.ts');
    const matSrc = await readSrc('lib/documents/materialize.ts');
    const detailSrc = await readSrc('components/workflows/workflow-detail.tsx');
    const detailCode = codeOf(detailSrc);

    // S1 — ONE RENDERER, ONE SANDBOX.
    const uiFiles = [...await walk('components'), ...await walk('app')];
    const sandboxFiles: string[] = [];
    const sameOriginFiles: string[] = [];
    for (const f of uiFiles) {
      const code = codeOf(await readSrc(f));
      if (/sandbox\s*=/.test(code)) sandboxFiles.push(f);
      if (/allow-same-origin/.test(code)) sameOriginFiles.push(f);
    }
    ok('S1 exactly ONE component carries a sandbox= attribute — the one renderer',
      sandboxFiles.length === 1 && sandboxFiles[0] === 'components/frames/frame-card.tsx',
      JSON.stringify(sandboxFiles));
    const sandboxValue = cardCode.match(/sandbox\s*=\s*"([^"]*)"/)?.[1];
    ok('S1 …and its value is exactly "allow-scripts" — nothing more',
      sandboxValue === 'allow-scripts', String(sandboxValue));
    ok('S1 allow-same-origin appears in NO code under components/ or app/ (an opaque origin or nothing)',
      sameOriginFiles.length === 0, JSON.stringify(sameOriginFiles));

    // S2 — SRCDOC ONLY.
    ok('S2 the renderer mounts srcDoc', /srcDoc=\{/.test(cardCode), 'no srcDoc mount');
    ok('S2 …and never src="/api/frames (a navigated frame would be same-origin with the app)',
      !/src\s*=\s*[{"'`]?[^>]*\/api\/frames/.test(cardCode), 'a src pointing at the frames route exists');

    // S3 — JSON ONLY at the serving door.
    ok('S3 the frames route never answers text/html',
      !/text\/html/.test(routeCode), 'an html content type exists in the route');
    ok('S3 …it answers through NextResponse.json only',
      /NextResponse\.json\(\{\s*\n?\s*html:/.test(routeCode) && !/new NextResponse\(/.test(routeCode),
      'a non-json response exists');

    // S4 — ONE VALIDATOR.
    ok('S4 the generate lane imports validateFrameHtml from the one module',
      /import \{ validateFrameHtml \} from '@\/lib\/frames\/validate-frame'/.test(genSrc), 'the lane forked its own check');
    ok('S4 …and the route imports the same module\'s cap (the serving ceiling is the validator\'s)',
      /from '@\/lib\/frames\/validate-frame'/.test(routeSrc) && /FRAME_MAX_BYTES/.test(routeCode),
      'the route carries its own size number');
    const libAppFiles = [...await walk('lib'), ...await walk('app'), ...await walk('components')];
    const cspLiteralFiles: string[] = [];
    const attrNetFiles: string[] = [];
    for (const f of libAppFiles) {
      const src = await readSrc(f);
      if (/default-src 'none'; script-src 'unsafe-inline'/.test(src)) cspLiteralFiles.push(f);
      if (/src\|href\|action\|formaction\|ping\|poster\|srcset/.test(src)) attrNetFiles.push(f);
    }
    ok('S4 the CSP literal exists in exactly ONE file', cspLiteralFiles.length === 1
      && cspLiteralFiles[0] === 'lib/frames/validate-frame.ts', JSON.stringify(cspLiteralFiles));
    ok('S4 …and so does the egress attribute net (no second opinion about what egress is)',
      attrNetFiles.length === 1 && attrNetFiles[0] === 'lib/frames/validate-frame.ts', JSON.stringify(attrNetFiles));

    // S5 — THE FRAMES TAB IS A FILTER.
    // RE-POINTED (the gallery wave): FramesTab MOVED to components/frames/frames-tab.tsx. The law
    // is unchanged and asserted just as hard — it is now asserted where the code lives, while the
    // deep-dive keeps the flag, the flag-gated registration and the import of the ONE tab.
    const tabSrc = await readSrc('components/frames/frames-tab.tsx');
    const tabCode = codeOf(tabSrc);
    ok('S5 the tab is on (SHOW_FRAMES flips with Phase 1)',
      /const SHOW_FRAMES = true/.test(detailCode), 'SHOW_FRAMES is not true');
    ok('S5 …registered ONLY behind that flag, and mounted from the one tab module',
      /if \(SHOW_FRAMES\)/.test(detailCode)
      && /import \{ FramesTab \} from '@\/components\/frames\/frames-tab'/.test(detailSrc)
      && /tab === 'frames' && \(?\s*<FramesTab\b/.test(detailCode),
      'the deep-dive does not mount the one FramesTab behind its flag');
    ok('S5 …and it FILTERS the runs payload on type === frame (not a second fetch, not a feature)',
      /a\.type !== 'frame'/.test(tabCode) && /runs: FramesRunLike\[\] \| null/.test(tabCode)
      && !/fetch\(\s*[`'"][^`'"]*\/runs/.test(tabCode),
      'the tab does not filter the shared runs payload');
    ok('S5 …rendering through the ONE renderer',
      /import \{ FrameCard \} from '@\/components\/frames\/frame-card'/.test(tabSrc)
      && /<FrameCard /.test(tabCode) && !/<iframe/.test(tabCode), 'the tab renders frames itself');

    // S6 — ONE 404 SHAPE (no existence oracle).
    const notFoundDefs = (routeCode.match(/const NOT_FOUND = /g) ?? []).length;
    const four04s = (routeCode.match(/status: 404/g) ?? []).length;
    ok('S6 exactly ONE not-found body is defined', notFoundDefs === 1, String(notFoundDefs));
    ok('S6 …and it is the route\'s only 404 (unknown / foreign / not-a-frame are indistinguishable)',
      four04s === 1 && /!artifact \|\| artifact\.type !== 'frame' \|\| !artifact\.storage_path\) return NOT_FOUND\(\)/.test(routeCode),
      `${four04s} 404 sites`);
    ok('S6 …and the route never answers 403 (a refusal must not confirm an id exists)',
      !/status: 403/.test(routeCode), 'a 403 exists');

    // S7 — THE TRIGGER SET, matched against the spec's own words.
    const frameWordsLiteral = matSrc.match(/const FRAME_WORDS = (\/.+\/[a-z]*);/)?.[1] ?? '';
    ok('S7 FRAME_WORDS is a single deterministic literal in the door', !!frameWordsLiteral, 'not found');
    const body = frameWordsLiteral.slice(1, frameWordsLiteral.lastIndexOf('/'));
    const flags = frameWordsLiteral.slice(frameWordsLiteral.lastIndexOf('/') + 1);
    const re = frameWordsLiteral ? new RegExp(body, flags) : /$^/;
    const TRIGGERS = ['make me a dashboard', 'an interactive view of it', 'an interactive report',
      'a tracker for the pipeline', 'build a frame', 'a live view of the deals'];
    ok('S7 …matching every trigger the spec names (dashboard · interactive view/report · tracker · frame · live view)',
      TRIGGERS.every((t) => re.test(t)), JSON.stringify(TRIGGERS.filter((t) => !re.test(t))));
    ok('S7 …and NOTHING outside it (a plain document ask is never a frame)',
      !re.test('write the weekly summary as a short report') && !re.test('update the deck'),
      'a non-frame ask matches the trigger');
    ok('S7 the lane is gated on !revise && !templateFile (an office-file operation is never a frame)',
      /const wantsFrame = !args\.revise && !args\.templateFile/.test(matSrc), 'the office-op guard is gone');
    ok('S7 …and a declined frame lane falls through to an honest document type',
      /args\.forceType && args\.forceType !== 'frame' \? args\.forceType : null/.test(matSrc),
      "a forced 'frame' can leak into the document type");

    // S8 — THE SERVING AUTHZ, as a source floor (see the header: no HTTP-session scaffolding).
    const ownershipAt = routeCode.indexOf(`.eq('user_id', user.id)`);
    const adminAt = routeCode.indexOf('SUPABASE_SERVICE_ROLE_KEY');
    ok('S8 ownership is the RLS client\'s own WHERE clause', ownershipAt > 0, 'no user-scoped filter');
    ok('S8 …read from the caller\'s session (auth.getUser + a 401 before anything else)',
      /supabase\.auth\.getUser\(\)/.test(routeCode) && /status: 401/.test(routeCode), 'no session gate');
    ok('S8 …and it runs BEFORE the admin client exists (the proof precedes the bypass)',
      ownershipAt > 0 && adminAt > 0 && ownershipAt < adminAt, `${ownershipAt} vs ${adminAt}`);
    ok('S8 …with the admin client used ONLY to pull the bytes out of storage',
      /adminClient\.storage/.test(routeCode) && !/adminClient\s*\n?\s*\.from\(/.test(routeCode),
      'the admin client reads a table');

    // ══ SH — THE SHARE LINK (frames plan Phase 3, law 6) ═════════════════════════════════════
    console.log('\nSH — the share link (law 6: sharing a frame is sharing the data):');

    const shareLibSrc = await readSrc('lib/frames/share.ts');
    const shareLibCode = codeOf(shareLibSrc);
    const shareRouteSrc = await readSrc('app/api/frames/[id]/share/route.ts');
    const shareRouteCode = codeOf(shareRouteSrc);
    const publicRouteSrc = await readSrc('app/api/frames/shared/[token]/route.ts');
    const publicRouteCode = codeOf(publicRouteSrc);
    const publicPageSrc = await readSrc('app/frames/shared/[token]/page.tsx');
    const publicPageCode = codeOf(publicPageSrc);
    const controlSrc = await readSrc('app/(main)/frames/[id]/frame-share-control.tsx');
    const controlCode = codeOf(controlSrc);

    // SH1 — TOKEN ENTROPY. A guessable token is a public frame with extra steps.
    ok('SH1 the token is crypto randomness rendered URL-safe (randomBytes → base64url)',
      /randomBytes\(\s*(2[4-9]|[3-9]\d)\s*\)\.toString\('base64url'\)/.test(shareLibCode),
      'no crypto.randomBytes/base64url mint');
    ok('SH1 …with Math.random NOWHERE in the share files',
      ![shareLibCode, shareRouteCode, publicRouteCode, publicPageCode, controlCode]
        .some((c) => /Math\.random/.test(c)), 'Math.random reached a share file');
    ok('SH1 …and no share file ever logs a token',
      ![shareLibCode, shareRouteCode, publicRouteCode, controlCode]
        .some((c) => /console\.(log|error|warn)\([^)]*\btoken\b/.test(c)), 'a token reaches a log line');

    // SH2 — THE LIVE TRUTH TABLE, on the probe: a real artifact, a real storage object, the REAL
    // public route handler invoked (it needs no session — the token IS the credential, so the door
    // itself can be exercised end to end here, not merely described).
    const { randomUUID } = await import('node:crypto');
    const {
      findFrameArtifact, getOrCreateShare, revokeShare, mintShareToken, FRAME_SHARE_KIND,
    } = await import('@/lib/frames/share');
    const { GET: sharedGET } = await import('@/app/api/frames/shared/[token]/route');
    const callShared = async (tok: string) => {
      const res = await sharedGET(
        new Request(`http://localhost/api/frames/shared/${tok}`) as never,
        { params: Promise.resolve({ token: tok }) },
      );
      return { status: res.status, cache: res.headers.get('cache-control'), body: await res.text() };
    };

    shareArtifactId = randomUUID();
    const TAG = `SMOKE-SHARE-${shareArtifactId.slice(0, 8)}`;
    const tagged = validateFrameHtml(CLEAN_FRAME.replace('<h1>Hiring pipeline</h1>', `<h1>Hiring pipeline ${TAG}</h1>`));
    if (!tagged.ok) throw new Error('the SH fixture frame did not validate');
    shareStoragePath = `${probeId}/smoke-frames-share/${shareArtifactId}.html`;
    const up = await admin.storage.from('work-artifacts')
      .upload(shareStoragePath, Buffer.from(tagged.html, 'utf8'),
        { contentType: 'text/html', cacheControl: '0', upsert: true });
    if (up.error) throw new Error(`SH fixture upload failed: ${up.error.message}`);

    const { data: threadRow, error: threadErr } = await admin.from('work_threads').insert({
      user_id: probeId,
      title: 'Smoke — frame share fixture',
      artifacts: [{
        id: shareArtifactId, title: 'Hiring pipeline dashboard', type: 'frame',
        generated_at: new Date().toISOString(), storage_path: shareStoragePath,
        content: { provenance: { computed: true } },
      }],
    }).select('id').single();
    if (threadErr || !threadRow) throw new Error(`SH fixture thread failed: ${threadErr?.message}`);
    shareThreadId = threadRow.id as string;

    // The owner resolves it; a second user does NOT (the share door's 404 is this null).
    const asOwner = await findFrameArtifact(admin, probeId, shareArtifactId);
    const asStranger = await findFrameArtifact(admin, randomUUID(), shareArtifactId);
    ok('SH2 the owner resolves their own frame artifact', !!asOwner, 'owner cannot see it');
    ok("SH2 …and a SECOND user resolves NOTHING on the owner's artifact (their POST is a 404)",
      asStranger === null, 'a stranger resolved the frame');

    const first = await getOrCreateShare(admin, probeId, shareArtifactId);
    const second = await getOrCreateShare(admin, probeId, shareArtifactId);
    ok('SH2 sharing mints a ≥32-char URL-safe token', first.token.length >= 32
      && /^[A-Za-z0-9_-]+$/.test(first.token), first.token.length ? `len ${first.token.length}` : 'empty');
    ok('SH2 …and ONE LIVE SHARE PER ARTIFACT — re-sharing returns the SAME link, never a second',
      second.token === first.token && first.created === true && second.created === false,
      `${first.created}/${second.created}`);

    const served = await callShared(first.token);
    let servedHtml = '';
    try { servedHtml = String(JSON.parse(served.body).html ?? ''); } catch { /* asserted below */ }
    ok('SH2 the PUBLIC door serves the frame with no session at all', served.status === 200, String(served.status));
    ok('SH2 …and it is THIS frame (the tagged bytes came back)', servedHtml.includes(TAG),
      servedHtml.slice(0, 60));
    ok('SH2 …carrying the structural provenance stamp, not a guess',
      /"provenance":\{"computed":true\}/.test(served.body.replace(/\s/g, '')), 'no stamp served');

    const unknown = await callShared(mintShareToken());
    ok('SH2 an unknown token is a 404', unknown.status === 404, String(unknown.status));

    await revokeShare(admin, probeId, shareArtifactId);
    const afterRevoke = await callShared(first.token);
    ok('SH2 REVOCATION IS IMMEDIATE — the same link is a 404 on the very next view',
      afterRevoke.status === 404, String(afterRevoke.status));
    ok('SH2 …and byte-identical to the unknown-token answer (a dead link is not an oracle)',
      afterRevoke.body === unknown.body, `${afterRevoke.body} vs ${unknown.body}`);
    const { count: rowsLeft } = await admin.from('item_plans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', probeId).eq('kind', FRAME_SHARE_KIND).eq('entity_id', shareArtifactId);
    ok('SH2 …because revocation DELETED the row (nothing soft, nothing tombstoned)',
      (rowsLeft ?? 0) === 0, String(rowsLeft));

    // SH3 — THE SOVEREIGN FLOOR, as a source gate. Flipping a live company's features to prove it
    // would mutate a real workspace mid-suite; the ordering is pinned in source instead, said
    // plainly rather than skipped silently.
    // Ordering is read over the route's BODY — an import line names a helper without calling it.
    const bodyOf = (c: string) => c.split('\n').filter((l) => !/^\s*import\s/.test(l)).join('\n');
    const shareRouteBody = bodyOf(shareRouteCode);
    const featAt = shareRouteBody.indexOf('features.email === false');
    const writeAt = shareRouteBody.indexOf('getOrCreateShare');
    ok('SH3 the share door resolves workspace features',
      /getWorkspaceFeatures\(/.test(shareRouteCode), 'no feature read');
    ok("SH3 …refusing email-off workspaces with the spoken 403 (policy, not secrecy)",
      featAt > 0 && /Sharing is disabled for this workspace\./.test(shareRouteCode)
      && /status: 403/.test(shareRouteCode), 'no sovereign refusal');
    ok('SH3 …BEFORE any row is written (a sovereign workspace leaves no token behind)',
      featAt > 0 && writeAt > 0 && featAt < writeAt, `${featAt} vs ${writeAt}`);
    ok('SH3 …and ownership is proved on the CALLER\'S OWN session first (no oracle, no foreign share)',
      shareRouteBody.indexOf('supabase.auth.getUser()') > 0
      && shareRouteBody.indexOf('supabase.auth.getUser()') < shareRouteBody.indexOf('findFrameArtifact')
      && shareRouteBody.indexOf('findFrameArtifact') < featAt
      && /status: 404/.test(shareRouteCode), 'ownership is not the first gate');
    note('SH3 is a source gate — flipping a live workspace\'s features mid-suite is too invasive');

    // SH4 — THE PUBLIC PAGE FLOORS.
    ok('SH4 the public page passes the token door as FrameCard\'s endpoint',
      /endpoint=\{`\/api\/frames\/shared\/\$\{token\}`\}/.test(publicPageCode), 'no endpoint prop');
    ok('SH4 …renders through the ONE renderer and nothing else',
      /import \{ FrameCard \} from '@\/components\/frames\/frame-card'/.test(publicPageSrc)
      && /<FrameCard /.test(publicPageCode) && !/<iframe/.test(publicPageCode),
      'a second renderer exists on the public page');
    ok('SH4 …with NO auth import (the recipient is not a user of this app)',
      !/@\/lib\/supabase\//.test(publicPageCode) && !/auth\.getUser/.test(publicPageCode),
      'the public page authenticates');
    ok('SH4 …and never redirects to /login (a dead share link telling a client to log in is wrong twice)',
      !/redirect\(/.test(publicPageCode) && !/\/login/.test(publicPageCode), 'a login redirect exists');
    ok('SH4 …living OUTSIDE the (main) auth layout',
      await (await import('node:fs/promises')).stat('app/frames/shared/[token]/page.tsx').then(() => true, () => false));
    const mw = codeOf(await readSrc('middleware.ts'));
    const protectedList = mw.match(/const protectedRoutes = \[([^\]]*)\]/)?.[1] ?? '';
    ok('SH4 …and middleware does NOT protect /frames (the page must load logged-out end to end)',
      !!protectedList && !/['"]\/frames/.test(protectedList), protectedList.slice(0, 120));

    // SH5 — NO-STORE. Revocation is worthless if a cache keeps answering.
    ok('SH5 the public door sets Cache-Control: no-store on its served payload',
      served.cache === 'no-store', String(served.cache));
    ok('SH5 …and on its 404 too (a cached not-found is a link that cannot come back either)',
      afterRevoke.cache === 'no-store' && unknown.cache === 'no-store',
      `${afterRevoke.cache}/${unknown.cache}`);
    ok('SH5 …with no other cache posture anywhere in the door',
      (publicRouteCode.match(/Cache-Control/g) ?? []).length ===
      (publicRouteCode.match(/'no-store'/g) ?? []).length, 'a second cache posture exists');

    // ══ LB — THE LIVING BINDING (Phase 2, law 4) ═════════════════════════════════════════════
    console.log('\nLB — the living binding (law 4: THE BINDING IS THE LIFE):');

    // LB1 — THE STAMP, RE-POINTED (THE FRAME SERIES, Aug 20). The stamp moved OFF the run loop's
    // inline ternary and onto THE ONE WRITER: every frame any door produces goes through
    // `upsertFrameSeries`, which binds the head itself. So the floor is now two-sided — the stamp
    // must EXIST in series.ts and must NOT have been re-grown as a literal in the run loop (two
    // writers of one stamp is exactly how a binding drifts). Comment-stripped both sides: a
    // sentence about a stamp is not a stamp.
    const runLoopCode = codeOf(await readSrc('lib/workflows/run-workflow.ts'));
    const seriesCode = codeOf(await readSrc('lib/frames/series.ts'));
    ok('LB1 THE ONE WRITER stamps the binding on the series head',
      /const binding = \{ workflowId, refresh: 'on_run' as const \};/.test(seriesCode),
      'no {workflowId, refresh} stamp in lib/frames/series.ts');
    ok("LB1 …carrying refresh: 'on_run' (the derivation says WHEN it re-materializes)",
      /refresh:\s*'on_run'/.test(seriesCode), "no refresh: 'on_run' on the one writer");
    ok('LB1 …and it rides BOTH heads the writer can produce (a founded one and an updated one)',
      (seriesCode.match(/^\s*binding,\s*$/gm) ?? []).length === 2,
      String((seriesCode.match(/^\s*binding,\s*$/gm) ?? []).length));
    ok('LB1 THE ONE-WRITER FLOOR — the run loop builds NO binding literal of its own…',
      !/binding/.test(runLoopCode) && !/refresh:/.test(runLoopCode),
      'the run loop grew a second binding writer');
    ok('LB1 …because its frame branch routes through upsertFrameSeries instead',
      /if \(m\.type === 'frame'\)/.test(runLoopCode) && /upsertFrameSeries\(admin, \{/.test(runLoopCode),
      'the run loop no longer calls the one writer');
    ok('LB1 NO REFRESH AFFORDANCE anywhere (re-running a workflow is a deed, not a view refresh)',
      !/Refresh now/i.test(codeOf(await readSrc('components/frames/frame-card.tsx')))
      && !/Refresh now/i.test(codeOf(await readSrc('app/(main)/frames/[id]/frame-share-control.tsx'))),
      'a refresh button reached a frame surface');

    // LB2/LB3/LB5 — LIVE on the probe. Two threads prove the resolution scans across them, and
    // the bytes are tagged so "the newest generation" is asserted by CONTENT, never by an id.
    const {
      resolveLivingFrame, getOrCreateShare: lbShare, revokeShare: lbRevoke, findFrameArtifact: lbFind,
    } = await import('@/lib/frames/share');
    const WF_A = randomUUID();   // the living series (two generations)
    const WF_B = randomUUID();   // a bound series with exactly one generation (LB5)

    const seedFrame = async (tag: string) => {
      const id = randomUUID();
      const v = validateFrameHtml(CLEAN_FRAME.replace('<h1>Hiring pipeline</h1>', `<h1>Hiring pipeline ${tag}</h1>`));
      if (!v.ok) throw new Error(`the LB fixture ${tag} did not validate`);
      const path = `${probeId}/smoke-frames-lb/${id}.html`;
      const upl = await admin.storage.from('work-artifacts')
        .upload(path, Buffer.from(v.html, 'utf8'), { contentType: 'text/html', cacheControl: '0', upsert: true });
      if (upl.error) throw new Error(`LB fixture upload failed: ${upl.error.message}`);
      lbArtifactIds.push(id); lbStoragePaths.push(path);
      return { id, path, tag };
    };
    const artRow = (
      f: { id: string; path: string }, at: string, binding: { workflowId: string; refresh: string } | null,
    ) => ({
      id: f.id, title: 'Pipeline dashboard', type: 'frame',
      generated_at: at, storage_path: f.path,
      content: { provenance: { computed: true } },
      ...(binding ? { binding } : {}),
    });

    const OLD_TAG = 'LB-GEN-OLD', NEW_TAG = 'LB-GEN-NEW', SOLO_TAG = 'LB-SOLO', PLAIN_TAG = 'LB-UNBOUND';
    const fOld = await seedFrame(OLD_TAG);
    const fNew = await seedFrame(NEW_TAG);
    const fSolo = await seedFrame(SOLO_TAG);
    const fPlain = await seedFrame(PLAIN_TAG);

    const seedThread = async (title: string, artifacts: unknown[]) => {
      const { data, error } = await admin.from('work_threads')
        .insert({ user_id: probeId, title, artifacts }).select('id').single();
      if (error || !data) throw new Error(`LB fixture thread failed: ${error?.message}`);
      lbThreadIds.push(data.id as string);
      return data.id as string;
    };
    // Deliberately SPLIT across threads: a resolution that only looked inside the share's own
    // thread would pass a one-thread fixture and fail in life (each run may open its own thread).
    await seedThread('Smoke — LB generation 1', [
      artRow(fOld, '2026-08-01T09:00:00.000Z', { workflowId: WF_A, refresh: 'on_run' }),
      artRow(fPlain, '2026-08-01T09:05:00.000Z', null),
    ]);
    await seedThread('Smoke — LB generation 2', [
      artRow(fNew, '2026-08-18T09:00:00.000Z', { workflowId: WF_A, refresh: 'on_run' }),
      artRow(fSolo, '2026-08-02T09:00:00.000Z', { workflowId: WF_B, refresh: 'on_run' }),
    ]);

    // LB4 — THE EXACT ADDRESS. The authed resolution is version-exact; only the share moves forward.
    const addressed = await lbFind(admin, probeId, fOld.id);
    ok('LB4 THE EXACT ADDRESS — the authed resolution on the OLDER id returns the OLDER artifact',
      addressed?.id === fOld.id, String(addressed?.id));
    ok('LB4 …and the authed door never calls the living resolution (a version is a record)',
      !/resolveLivingFrame/.test(codeOf(await readSrc('app/api/frames/[id]/route.ts'))),
      'the authed door resolves forward');
    ok('LB4 …while the PUBLIC door does (the share is the one living case)',
      /resolveLivingFrame\(/.test(publicRouteCode.replace(/import[^;]+;/g, '')),
      'the public door never resolves forward');

    // LB2 — the living share: share the OLDER, receive the NEWER.
    const livingShare = await lbShare(admin, probeId, fOld.id);
    const livingServed = await callShared(livingShare.token);
    const livingBody = (() => { try { return JSON.parse(livingServed.body) as { html?: string; live?: boolean }; } catch { return {}; } })();
    ok('LB2 the public door serves a bound share', livingServed.status === 200, String(livingServed.status));
    ok('LB2 …resolving FORWARD to the newest generation (the NEW bytes came back)',
      String(livingBody.html ?? '').includes(NEW_TAG), 'the newest generation was not served');
    ok('LB2 …and never the stale one a client was handed (the OLD bytes are gone)',
      !String(livingBody.html ?? '').includes(OLD_TAG), 'the stale generation was served');
    ok('LB2 …saying so structurally (live: true)', livingBody.live === true, String(livingBody.live));
    await lbRevoke(admin, probeId, fOld.id);
    const livingDead = await callShared(livingShare.token);
    ok('LB2 REVOCATION IS STILL INSTANT on a living share', livingDead.status === 404
      && livingDead.cache === 'no-store', `${livingDead.status}/${livingDead.cache}`);

    // LB3 — THE UNBOUND FLOOR: a one-shot serves itself and claims nothing.
    const plainShare = await lbShare(admin, probeId, fPlain.id);
    const plainServed = await callShared(plainShare.token);
    const plainBody = (() => { try { return JSON.parse(plainServed.body) as { html?: string; live?: boolean }; } catch { return {}; } })();
    ok('LB3 an UNBOUND frame serves EXACTLY its own bytes',
      plainServed.status === 200 && String(plainBody.html ?? '').includes(PLAIN_TAG)
      && !String(plainBody.html ?? '').includes(NEW_TAG), 'a one-shot mutated under its link');
    ok('LB3 …and makes NO live claim (no derivation, no refresh promise — law 4)',
      plainBody.live !== true, String(plainBody.live));
    const plainResolved = await resolveLivingFrame(admin, probeId, artRow(fPlain, '2026-08-01T09:05:00.000Z', null) as never);
    ok('LB3 …because resolveLivingFrame returns an unbound artifact UNCHANGED',
      plainResolved.artifact.id === fPlain.id && plainResolved.live === false, String(plainResolved.live));

    // LB5 — FALL-BACK HONESTY: bound, but nothing newer exists.
    const soloShare = await lbShare(admin, probeId, fSolo.id);
    const soloServed = await callShared(soloShare.token);
    const soloBody = (() => { try { return JSON.parse(soloServed.body) as { html?: string; live?: boolean }; } catch { return {}; } })();
    ok('LB5 a bound frame with NO newer sibling serves its OWN bytes (never null, never empty)',
      soloServed.status === 200 && String(soloBody.html ?? '').includes(SOLO_TAG), 'the identity case broke');
    ok('LB5 …and does not borrow another series\' newest (workflowId is the key)',
      !String(soloBody.html ?? '').includes(NEW_TAG), 'two series folded into one');
    ok('LB5 …still marked live (its derivation exists — it just has one generation so far)',
      soloBody.live === true, String(soloBody.live));

    // The surfaces' quiet truth — the mark is STRUCTURAL (off the binding), never inferred.
    const cardLiveCode = codeOf(await readSrc('components/frames/frame-card.tsx'));
    ok('LB the ONE renderer wears the live mark off the STRUCTURAL binding only',
      /payload\?\.binding\?\.workflowId/.test(cardLiveCode) && /Updates with every run/.test(cardLiveCode),
      'the live mark is not structural');
    // RE-POINTED (the gallery wave): the tab lives in components/frames/frames-tab.tsx now.
    const framesTabCode = codeOf(await readSrc('components/frames/frames-tab.tsx'));
    ok('LB …and the Frames tab wears the same mark off the same stamp',
      /art\.binding\?\.workflowId/.test(framesTabCode) && /Updates with every run/.test(framesTabCode),
      'the Frames tab claims liveness some other way');
    // ══ FR — NEW FRAME FROM AN OUTPUT (the gallery's production door) ════════════════════════
    console.log('\nFR — new frame from an output (the deep-dive gallery door):');

    // FR1 — THE DEED, live on the probe: a real succeeded run with real text, laid out through
    // THE ONE PRODUCTION DOOR. The core is tested as a MODULE (no HTTP session needed) — the route
    // is a translation layer over exactly this call, pinned by the source floor below.
    const { createFrameFromRun } = await import('@/lib/frames/from-run');

    const { data: frThread, error: frThreadErr } = await admin.from('work_threads')
      .insert({ user_id: probeId, title: 'Smoke — frames from-run fixture', artifacts: [] })
      .select('id').single();
    if (frThreadErr || !frThread) throw new Error(`FR thread fixture failed: ${frThreadErr?.message}`);
    frThreadId = frThread.id as string;

    const { data: frWf, error: frWfErr } = await admin.from('workflows').insert({
      user_id: probeId, name: 'Smoke — hiring pipeline dashboard', status: 'active',
      trigger: { type: 'schedule', label: 'Weekly' },
      steps: [{ type: 'ai', label: 'write' }],
    }).select('id').single();
    if (frWfErr || !frWf) throw new Error(`FR workflow fixture failed: ${frWfErr?.message}`);
    frWorkflowId = frWf.id as string;

    const { data: frRun, error: frRunErr } = await admin.from('workflow_runs').insert({
      workflow_id: frWorkflowId, user_id: probeId, status: 'succeeded', triggered_by: 'schedule',
      thread_id: frThreadId,
      step_outputs: [{ step_type: 'ai', label: 'write', output: `${FRAME_CONTENT}\n\n${SMALL_CSV}` }],
    }).select('id').single();
    if (frRunErr || !frRun) throw new Error(`FR run fixture failed: ${frRunErr?.message}`);
    frRunId = frRun.id as string;

    const made = await createFrameFromRun(admin, admin, probeId, {
      workflowId: frWorkflowId, runId: frRunId,
    });
    ok('FR1 the door lays a delivered run out as a frame', made.ok === true,
      made.ok ? '' : made.reason);

    if (made.ok) {
      const { data: afterThread } = await admin.from('work_threads')
        .select('artifacts').eq('id', frThreadId).single();
      const arts = (((afterThread as { artifacts?: unknown[] } | null)?.artifacts) ?? []) as Array<{
        id?: string; type?: string; storage_path?: string;
        binding?: { workflowId?: string; refresh?: string } | null;
        content?: { provenance?: { computed?: boolean } } | null;
      }>;
      const born = arts.find((a) => a?.id === made.artifactId);
      frStoragePath = born?.storage_path ?? null;
      ok("FR1 …appending it to THE RUN'S OWN thread (never a new home of its own)", !!born,
        `${arts.length} artifacts on the run's thread`);
      ok('FR1 …typed frame with a storage path (the bytes exist)',
        born?.type === 'frame' && !!born?.storage_path, `${born?.type}/${born?.storage_path}`);
      ok("FR1 THE BINDING (law 4) — a run-born frame is BOUND {workflowId, refresh:'on_run'}",
        born?.binding?.workflowId === frWorkflowId && born?.binding?.refresh === 'on_run',
        JSON.stringify(born?.binding));
      if (born?.storage_path) {
        const dl = await admin.storage.from('work-artifacts').download(born.storage_path);
        const bytes = dl.data ? Buffer.from(await dl.data.arrayBuffer()) : Buffer.alloc(0);
        const reval2 = bytes.length ? validateFrameHtml(bytes.toString('utf8')) : { ok: false, reasons: ['no bytes'] } as const;
        ok('FR1 …and the stored bytes re-validate through the ONE validator (no-egress holds)',
          reval2.ok === true, reval2.ok ? '' : JSON.stringify(reval2.reasons));
      }
    }

    // FR2 — AUTHZ: one indistinguishable refusal. A foreign workflow, a foreign run and a run
    // belonging to a DIFFERENT workflow all answer the same not_found — never an existence oracle.
    const strangerId = randomUUID();
    const foreignWf = await createFrameFromRun(admin, admin, strangerId, {
      workflowId: frWorkflowId!, runId: frRunId!,
    });
    const unknownWf = await createFrameFromRun(admin, admin, probeId, {
      workflowId: randomUUID(), runId: frRunId!,
    });
    const unknownRun = await createFrameFromRun(admin, admin, probeId, {
      workflowId: frWorkflowId!, runId: randomUUID(),
    });
    ok("FR2 a SECOND user's call on the owner's run refuses", foreignWf.ok === false,
      JSON.stringify(foreignWf));
    ok('FR2 …an unknown workflow refuses', unknownWf.ok === false, JSON.stringify(unknownWf));
    ok('FR2 …an unknown run refuses', unknownRun.ok === false, JSON.stringify(unknownRun));
    ok('FR2 …ALL of them with the SAME shape (not_found — no oracle, no partial truth)',
      [foreignWf, unknownWf, unknownRun].every((r) => !r.ok && r.reason === 'not_found'),
      JSON.stringify([foreignWf, unknownWf, unknownRun]));
    const fromRunRouteCode = codeOf(await readSrc('app/api/workflows/frames/from-run/route.ts'));
    ok('FR2 …and the ROUTE is a translation over the ONE core (never a second production path)',
      /createFrameFromRun\(/.test(fromRunRouteCode)
      && !/materializeDocument/.test(fromRunRouteCode), 'the route produces on its own');
    ok('FR2 …answering exactly ONE 404 body, and never a 403',
      (fromRunRouteCode.match(/status: 404/g) ?? []).length === 1
      && !/status: 403/.test(fromRunRouteCode), 'more than one refusal shape');
    ok('FR2 …and a DECLINED frame lane says so honestly (502), never a document in a frame\'s name',
      /reason === 'declined'/.test(fromRunRouteCode) && /status: 502/.test(fromRunRouteCode)
      && /m\.type !== 'frame'\) return DECLINED/.test(codeOf(await readSrc('lib/frames/from-run.ts'))),
      'the door can ship a non-frame');

    // FR3 — THE CLAIMS FLOOR: the explainer promises only what exists today.
    const galleryCode = codeOf(await readSrc('components/frames/frames-tab.tsx'));
    // (The explainer card was removed by owner call, Aug 20 — the living claim survives on the
    // live mark's own tooltip, which is where the words belong: on the object they describe.)
    ok('FR3 the living claim rides the live mark ("updates with every run")',
      /updates with every run/i.test(galleryCode), 'the living claim is missing');
    ok('FR3 …and NEVER invites the reader to ask the agent for changes (revision is not built)',
      !/ask the agent/i.test(galleryCode), 'a revision claim reached the tab');
    ok('FR3 …with NO view counter anywhere (there is no store behind one)',
      !/\bviews\b/i.test(galleryCode) && !/viewCount|view_count/.test(galleryCode),
      'a counter reached the tab');

    // FR4 — VISIBILITY HONESTY: the shared word comes off the SERVED share rows and nothing else.
    ok('FR4 the card says "Anyone with link" only from sharedFrameIds membership',
      /shared\.has\(f\.art\.id!\)/.test(galleryCode)
      && /new Set\(sharedFrameIds \?\? \[\]\)/.test(galleryCode)
      && /isShared \? 'Anyone with link' : 'Private'/.test(galleryCode),
      'the visibility word is not served truth');
    const runsRouteCode = codeOf(await readSrc('app/api/workflows/[id]/runs/route.ts'));
    ok('FR4 …and the route derives them from LIVE frame_share rows (revoked = absent = Private)',
      /FRAME_SHARE_KIND/.test(runsRouteCode) && /sharedFrameIds/.test(runsRouteCode)
      && /\.eq\('user_id', user\.id\)/.test(runsRouteCode), 'the served list is not share-row-derived');

    // ══ SR — THE FRAME SERIES (frames plan, "THE FRAME SERIES", Aug 20) ══════════════════════
    console.log('\nSR — the frame series (one identity, versions behind it):');

    const { upsertFrameSeries, FRAME_VERSION_CAP, findSeriesHead } = await import('@/lib/frames/series');

    // ── The fixtures: ONE workflow, ONE persistent thread (exactly what the run loop reuses). The
    // thread is seeded with a NON-FRAME artifact first, so SR6's parity control is in place before
    // a single frame lands: whatever the series does to itself, the docx beside it must survive
    // untouched and must never gain a twin.
    const { data: srWf, error: srWfErr } = await admin.from('workflows').insert({
      user_id: probeId, name: 'Smoke — frame series', status: 'active',
      trigger: { type: 'schedule', label: 'Weekly' },
      steps: [{ type: 'ai', label: 'write' }],
    }).select('id').single();
    if (srWfErr || !srWf) throw new Error(`SR workflow fixture failed: ${srWfErr?.message}`);
    srWorkflowId = srWf.id as string;

    const SR_DOC_ID = randomUUID();
    const { data: srThread, error: srThreadErr } = await admin.from('work_threads').insert({
      user_id: probeId, title: 'Smoke — frame series thread',
      artifacts: [{
        id: SR_DOC_ID, title: 'Quarterly write-up', type: 'document',
        generated_at: '2026-08-01T09:00:00.000Z',
        storage_path: `${probeId}/smoke-frames-sr/${SR_DOC_ID}.docx`,
        content: { title: 'Quarterly write-up' },
      }],
    }).select('id').single();
    if (srThreadErr || !srThread) throw new Error(`SR thread fixture failed: ${srThreadErr?.message}`);
    srThreadId = srThread.id as string;

    /** One generation, with tagged bytes so "which version came back" is asserted by CONTENT. */
    const srBytes = (tag: string) => {
      const v = validateFrameHtml(CLEAN_FRAME.replace('<h1>Hiring pipeline</h1>', `<h1>Hiring pipeline ${tag}</h1>`));
      if (!v.ok) throw new Error(`the SR fixture ${tag} did not validate`);
      return Buffer.from(v.html, 'utf8');
    };
    const srContent = { provenance: { computed: true } } as never;
    const srRun = async (tag: string) => {
      const res = await upsertFrameSeries(admin, {
        userId: probeId, threadId: srThreadId!, workflowId: srWorkflowId!, runId: null,
        title: 'Pipeline dashboard', bytes: srBytes(tag), mime: 'text/html', content: srContent,
      });
      const path = (res.artifact as unknown as { storage_path?: string }).storage_path;
      if (path) srStoragePaths.push(path);
      return res;
    };
    const srHeadOf = async () => {
      const { data } = await admin.from('work_threads').select('artifacts').eq('id', srThreadId!).single();
      const arts = (((data as { artifacts?: unknown[] } | null)?.artifacts) ?? []) as Array<{
        id?: string; type?: string; storage_path?: string; version?: number;
        versions?: Array<{ v?: number; storagePath?: string; generatedAt?: string | null }>;
      }>;
      return { arts, frames: arts.filter((a) => a?.type === 'frame'), head: findSeriesHead(arts, srWorkflowId!) };
    };
    const srDownload = async (path: string) => {
      const dl = await admin.storage.from('work-artifacts').download(path);
      return dl.data ? Buffer.from(await dl.data.arrayBuffer()).toString('utf8') : '';
    };

    // ── SR1 — THE HEART: two rounds through the ONE writer are ONE artifact with two versions. ──
    const r1 = await srRun('SR-V1');
    const r2 = await srRun('SR-V2');
    const afterTwo = await srHeadOf();
    ok('SR1 two generations leave exactly ONE frame artifact on the thread',
      afterTwo.frames.length === 1, String(afterTwo.frames.length));
    ok('SR1 …under the SAME identity (the id never moves — the whole point of a series)',
      r1.artifactId === r2.artifactId && afterTwo.head?.id === r1.artifactId,
      `${r1.artifactId} vs ${r2.artifactId} vs ${afterTwo.head?.id}`);
    ok('SR1 …with the first call FOUNDING and the second landing a version',
      r1.founded === true && r2.founded === false && r1.version === 1 && r2.version === 2,
      `${r1.founded}/${r1.version} then ${r2.founded}/${r2.version}`);
    ok('SR1 …the head at version 2', afterTwo.head?.version === 2, String(afterTwo.head?.version));
    const headHtml = afterTwo.head?.storage_path ? await srDownload(afterTwo.head.storage_path) : '';
    ok("SR1 …serving ROUND 2's bytes (the head IS the present)",
      headHtml.includes('SR-V2') && !headHtml.includes('SR-V1'), headHtml.slice(0, 40) || 'no bytes');
    const stored1 = (afterTwo.head?.versions ?? []).find((e) => e?.v === 1);
    ok('SR1 …and keeping round 1 addressable as version 1',
      (afterTwo.head?.versions ?? []).length === 1 && !!stored1?.storagePath,
      JSON.stringify(afterTwo.head?.versions));
    const v1Html = stored1?.storagePath ? await srDownload(stored1.storagePath) : '';
    ok("SR1 …whose stored path still serves ROUND 1's bytes (both objects exist)",
      v1Html.includes('SR-V1') && !v1Html.includes('SR-V2'), v1Html.slice(0, 40) || 'no bytes');
    // SR6's control, asserted where it is proved: the non-frame neighbour never twins, never moves.
    ok('SR6 NON-FRAME PARITY — the docx beside the series is carried through, once, unchanged',
      afterTwo.arts.filter((a) => a?.id === SR_DOC_ID).length === 1
      && afterTwo.arts.length === 2 && afterTwo.arts[0]?.id === SR_DOC_ID,
      JSON.stringify(afterTwo.arts.map((a) => a?.id)));

    // ── SR1, the from-run leg: THE OTHER DOOR JOINS THE SAME SERIES (ONE real generation). ──
    const { data: srRunRow, error: srRunErr } = await admin.from('workflow_runs').insert({
      workflow_id: srWorkflowId, user_id: probeId, status: 'succeeded', triggered_by: 'schedule',
      thread_id: srThreadId,
      step_outputs: [{ step_type: 'ai', label: 'write', output: `${FRAME_CONTENT}\n\n${SMALL_CSV}` }],
    }).select('id').single();
    if (srRunErr || !srRunRow) throw new Error(`SR run fixture failed: ${srRunErr?.message}`);
    srRunId = srRunRow.id as string;

    const joined = await createFrameFromRun(admin, admin, probeId, {
      workflowId: srWorkflowId!, runId: srRunId!,
    });
    const afterJoin = await srHeadOf();
    if (afterJoin.head?.storage_path) srStoragePaths.push(afterJoin.head.storage_path);
    ok('SR1 THE FROM-RUN DOOR JOINS THE SERIES — it produces a frame',
      joined.ok === true, joined.ok ? '' : joined.reason);
    ok('SR1 …on the SAME identity, never a stray sibling',
      joined.ok === true && joined.artifactId === r1.artifactId
      && afterJoin.frames.length === 1, `${joined.ok && joined.artifactId} / ${afterJoin.frames.length} frames`);
    ok('SR1 …as version 3 (the series counts every door the same way)',
      afterJoin.head?.version === 3 && (afterJoin.head?.versions ?? []).length === 2,
      `v${afterJoin.head?.version} · ${(afterJoin.head?.versions ?? []).length} stored`);
    note('the from-run leg is ONE real generation (the two rounds above use fixture bytes — no AI spend)');

    // ── SR2 — THE CAP: a series keeps 20 previous generations and takes the overflow's bytes with
    // it. Fixture bytes only; the arithmetic is the assertion, not a model. ──
    const firstDropped = stored1?.storagePath ?? null;
    // The head sits at v3 with 2 stored. Push until the 21st stored generation forces a shift.
    for (let i = 4; i <= FRAME_VERSION_CAP + 2; i++) await srRun(`SR-V${i}`);
    const capped = await srHeadOf();
    const capVersions = capped.head?.versions ?? [];
    ok(`SR2 THE CAP — the series keeps exactly ${FRAME_VERSION_CAP} previous generations`,
      capVersions.length === FRAME_VERSION_CAP, String(capVersions.length));
    ok('SR2 …still ONE artifact under ONE id (a cap is not a fork)',
      capped.frames.length === 1 && capped.head?.id === r1.artifactId,
      `${capped.frames.length} frames / ${capped.head?.id}`);
    ok('SR2 …and the kept ones are the NEWEST (v1 fell off the front, the head is v22)',
      capped.head?.version === FRAME_VERSION_CAP + 2
      && Math.min(...capVersions.map((e) => e.v ?? 0)) === 2
      && Math.max(...capVersions.map((e) => e.v ?? 0)) === FRAME_VERSION_CAP + 1,
      `head v${capped.head?.version} · stored ${Math.min(...capVersions.map((e) => e.v ?? 0))}–${Math.max(...capVersions.map((e) => e.v ?? 0))}`);
    // The overflow's BYTES go too — best-effort and un-awaited by design, so poll rather than race.
    let droppedGone = false;
    if (firstDropped) {
      for (let i = 0; i < 20 && !droppedGone; i++) {
        droppedGone = !(await objectExists(firstDropped));
        if (!droppedGone) await new Promise((r) => setTimeout(r, 500));
      }
    }
    ok("SR2 …with the shifted-off generation's storage object GONE (retention is real, not a list edit)",
      droppedGone, firstDropped ? 'the dropped object is still downloadable' : 'no dropped path recorded');
    // Existence off the METADATA (a cached download would pass for an object that was wrongly
    // swept) AND real bytes behind it — both, or the row is a lying door in the picker.
    const keptOk = await Promise.all(capVersions.map(async (e) =>
      (await objectExists(e.storagePath!)) && (await srDownload(e.storagePath!)).length > 0));
    ok(`SR2 …and all ${FRAME_VERSION_CAP} kept versions still exist and download (nothing else was swept)`,
      keptOk.every(Boolean), `${keptOk.filter(Boolean).length}/${keptOk.length}`);

    // ── SR3 — THE ?v DOOR. The authed route needs a browser session (see S8), so its LOGIC is
    // pinned in source and its DATA is exercised for real: the very resolution the route performs
    // (find the stored entry, serve its path) is run here against the live series. ──
    const askFor = (v: number) => (capVersions.find((e) => e?.v === v && e.storagePath) ?? null);
    const someStored = capVersions[capVersions.length - 1];
    const servedOld = someStored?.storagePath ? await srDownload(someStored.storagePath) : '';
    ok('SR3 a stored version resolves to its OWN bytes (the same lookup the route does)',
      !!askFor(someStored.v!) && servedOld.includes(`SR-V${someStored.v}`),
      `v${someStored?.v} → ${servedOld.slice(0, 40)}`);
    ok('SR3 …and a version that was never stored resolves to NOTHING (the route\'s 404 is this null)',
      askFor(1) === null && askFor(9999) === null, 'a dropped or unknown version still resolves');
    ok('SR3 THE ROUTE reads `?v` digits-only (a junk value is ignored, never a crash or a 500)',
      /searchParams\.get\('v'\)/.test(routeCode) && /\/\^\\d\+\$\/\.test\(askedRaw\)/.test(routeCode),
      'the version param is not digits-only');
    ok('SR3 …serving the head unless another version was asked for',
      /let servePath = artifact\.storage_path;/.test(routeCode)
      && /askedVersion !== null && askedVersion !== headVersion/.test(routeCode),
      'the default serve is not the head');
    ok('SR3 …and answering an unknown version with THE SAME not-found body (no version oracle)',
      /if \(!hit\) return NOT_FOUND\(\);/.test(routeCode) && four04s === 1,
      'an unknown version has its own refusal');
    ok('SR3 …with the version META always served beside it (the picker needs no second fetch)',
      /versions: versionsMeta/.test(routeCode) && /viewing,/.test(routeCode), 'no version meta served');
    ok('SR3 THE PUBLIC DOOR IGNORES ?v — it reads no query parameter at all',
      !/searchParams/.test(publicRouteCode) && !/get\('v'\)/.test(publicRouteCode),
      'the token door reads a version param');

    // ── SR4 — SHARE ON THE PRESENT ONLY. A share link serves the current generation by law, so a
    // Share control beside an OLD version on screen would be a lie about what the link shows. ──
    const fullViewSrc = await readSrc('app/(main)/frames/[id]/frame-full-view.tsx');
    const fullViewCode = codeOf(fullViewSrc);
    ok('SR4 the full-screen address renders Share only under a null-selection guard',
      /\{!sel && <FrameShareControl/.test(fullViewCode), 'Share is offered on an old version');
    ok('SR4 …and so does the gallery panel (the two surfaces cannot disagree)',
      /\{!sel && \(/.test(tabCode) && /<FrameShareControl\b/.test(tabCode)
      && tabCode.indexOf('{!sel && (') < tabCode.indexOf('<FrameShareControl'),
      'the panel offers Share on an old version');
    const pickerFiles: string[] = [];
    for (const f of uiFiles) {
      if (/export function FrameVersionPicker/.test(await readSrc(f))) pickerFiles.push(f);
    }
    ok('SR4 THE PICKER IS ONE MODULE — it is defined in exactly one file',
      pickerFiles.length === 1 && pickerFiles[0] === 'app/(main)/frames/[id]/frame-version-picker.tsx',
      JSON.stringify(pickerFiles));
    ok('SR4 …and BOTH surfaces import it from there (one idea of what "Current" means)',
      /from '\.\/frame-version-picker'/.test(fullViewSrc)
      && /from '@\/app\/\(main\)\/frames\/\[id\]\/frame-version-picker'/.test(tabSrc),
      'a surface forked its own picker');
    ok('SR4 …with the same banner sentence on both (versionBanner, never a local string)',
      /versionBanner\(sel\)/.test(fullViewCode) && /versionBanner\(sel\)/.test(tabCode),
      'a surface writes its own version banner');

    // ── SR5 — THE EXPLICIT OUTPUT: configured, not guessed. ──
    ok('SR5 the run loop FORCES the frame lane off the configured artifact type',
      /const wantsFrame = out\.home === 'document' && artifactType === 'frame';/.test(runLoopCode)
      && /\.\.\.\(wantsFrame \? \{ forceType: 'frame' as const \} : \{\}\)/.test(runLoopCode),
      'artifact_type frame does not force the lane');
    ok('SR5 …and a frame is never mistaken for an office attachment',
      /configured === 'frame' \? 'document' : configured/.test(runLoopCode),
      'a frame can reach the attachment builder');
    const genConfigSrc = await readSrc('lib/workflows/generate-config.ts');
    ok('SR5 generate-config teaches the frame output (artifact_type "frame" on the document home)',
      /artifact_type:\s*"frame"/.test(genConfigSrc)
      && /"artifact_type": "frame"/.test(genConfigSrc)
      && /"destination": "document", "artifact_type": "frame"/.test(genConfigSrc),
      'the frame rule is missing from generate-config');
    const workerTasksSrc = await readSrc('lib/tools/worker-tasks.ts');
    ok('SR5 …and the conversational door can set it too (worker-tasks enum carries frame)',
      /enum: \['document', 'spreadsheet', 'presentation', 'email', 'frame'\]/.test(workerTasksSrc),
      'output_artifact_type cannot be set to frame from chat');

    // ── SR6 — NON-FRAME PARITY, in the merge itself. The run loop's write must REPLACE the head it
    // finds and APPEND everything else — one branch each, no third behaviour. ──
    ok('SR6 the run loop\'s merge dedupes by id: replace in place, else append',
      /const already = materialised\.artifact\.id\s*\n?\s*&& existing\.some\(\(a\) => a\?\.id === materialised\.artifact!\.id\);/.test(runLoopCode)
      && /already\s*\n?\s*\? existing\.map\(\(a\) => \(a\?\.id === materialised\.artifact!\.id \? materialised\.artifact! : a\)\)\s*\n?\s*: \[\.\.\.existing, materialised\.artifact\]/.test(runLoopCode),
      'the merge does not dedupe by id');

    ok('LB the share moment says the link stays current — for BOUND frames only',
      /live && ' This link always shows the latest version\.'/.test(codeOf(controlSrc))
      || /live &&\s*' This link always shows the latest version\.'/.test(codeOf(await readSrc('app/(main)/frames/[id]/frame-share-control.tsx'))),
      'the living disclosure is missing or unconditional');

    // ══ K — THE FRAME KIT (the visual-craft wave: beauty made deterministic) ═════════════════
    // The pilot's note was "ideally we have some stunning visuals" and the generations were plain
    // default cards and bare numbers. The answer is a design system WE author and INJECT BY CODE
    // (like the CSP meta), so the model composes instead of hand-rolling — which only holds if the
    // kit itself obeys law 2, lands exactly once, and cannot be skipped by a generation.
    console.log('\nK — the frame kit (the design system, injected by code):');

    const kitSrc = await readSrc('lib/frames/kit.ts');

    // ── K1 — THE KIT IS LOCKED LIKE EVERYTHING ELSE. It is bytes we ship inside a shared file, so
    // it is the one place a leak would be invisible: it never faces the model, only the validator. ──
    const kitOnly = injectFrameKit('<html><head></head><body></body></html>');
    const kitVerdict = validateFrameHtml(kitOnly);
    ok('K1 the kit alone passes THE ONE VALIDATOR (the design system is not the leak)',
      kitVerdict.ok === true, kitVerdict.ok ? '' : JSON.stringify(kitVerdict.reasons));
    const kitStrings = FRAME_KIT_CSS + '\n' + FRAME_KIT_JS;
    const KIT_VECTORS: Array<[string, RegExp]> = [
      ['an external address', /https?:\/\//i],
      ['a protocol-relative address', /(?:src|href|url\()\s*=?\s*["']?\/\//i],
      ['a network call', /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon/],
      ['a <link> / <base> / embedded document', /<link\b|<base\b|<(?:iframe|object|embed)\b/i],
      ['a css @import', /@import/i],
      ['a navigation', /\blocation\s*(?:\.\s*href\s*)?=(?!=)|\blocation\s*\.\s*(?:replace|assign)\s*\(|window\s*\.\s*open\s*\(/],
      ['a module load', /\bimport\s*\(|(?:^|[\n;{])\s*import\s+[^(\n]/],
    ];
    for (const [what, re] of KIT_VECTORS) {
      ok(`K1 …and the kit strings carry no ${what}`, !re.test(kitStrings),
        (kitStrings.match(re) ?? ['—'])[0]);
    }
    ok('K1 …and it is a real design system, not a token (CSS + JS, both substantial)',
      FRAME_KIT_CSS.length > 6000 && FRAME_KIT_JS.length > 4000,
      `${FRAME_KIT_CSS.length}/${FRAME_KIT_JS.length}`);
    ok('K1 …exposing the chart builders the prompt promises (bar · hbar · line · donut · spark · expand)',
      ['bar:', 'hbar:', 'line:', 'donut:', 'spark:', 'expand:'].every((k) => FRAME_KIT_JS.includes(k))
      && /window\.Kit\s*=/.test(FRAME_KIT_JS), 'a documented builder is missing from window.Kit');
    ok('K1 …and every builder renders an honest empty state (a chart never fakes data)',
      (FRAME_KIT_JS.match(/return empty\(el/g) ?? []).length >= 4 && /class="k-empty"/.test(FRAME_KIT_JS),
      String((FRAME_KIT_JS.match(/return empty\(el/g) ?? []).length));

    // ── K2 — IDEMPOTENCE + THE ACCENT. The repair pass injects into an already-dressed document by
    // construction, so a second injection must be a no-op — two kits would be two design systems. ──
    const once = injectFrameKit('<html><head></head><body></body></html>', '#0F766E');
    const twice = injectFrameKit(once, '#B91C1C');
    const markers = (s: string) => (s.match(/augmtd-frame-kit/g) ?? []).length;
    ok('K2 injection is idempotent — a second pass adds no second kit',
      markers(once) === 1 && markers(twice) === 1 && twice === once,
      `${markers(once)} then ${markers(twice)}`);
    ok('K2 …the accent lands as a custom-property override (never a rewritten stylesheet)',
      /:root\{--k-accent:#0F766E\}/.test(once) && once.indexOf('--k-accent:#0F766E') > once.indexOf(FRAME_KIT_CSS.slice(0, 40)),
      'the accent override is missing or precedes the kit');
    ok('K2 …and a non-hex accent is ignored (an accent is a colour, never a place a URL hides)',
      !/--k-accent:/.test(injectFrameKit('<html><head></head><body></body></html>',
        'url(https://example.com/x.png)').replace(FRAME_KIT_CSS, '')),
      'a non-hex accent reached the document');
    ok('K2 …the kit lands INSIDE <head>, after the CSP meta when one is already stamped',
      (() => {
        const stamped = validateFrameHtml('<html><head></head><body></body></html>');
        if (!stamped.ok) return false;
        const dressed = injectFrameKit(stamped.html);
        return dressed.indexOf(FRAME_CSP_META) < dressed.indexOf('augmtd-frame-kit')
          && dressed.indexOf('augmtd-frame-kit') < dressed.indexOf('<body');
      })(), 'the kit lands outside <head> or before the policy');

    // ── K3 — THE LIVE GENERATION WEARS IT. L1's real call is the fixture: the bytes the door
    // returned must carry the kit, compose with it, and STILL re-validate clean. ──
    ok('K3 the LIVE generated frame carries the kit marker with its version',
      html.includes(`augmtd-frame-kit v${FRAME_KIT_VERSION}`), 'no kit marker in the produced bytes');
    ok('K3 …exactly once (the injection is idempotent in life, not only in the table)',
      markers(html) === 1, String(markers(html)));
    // The kit's own strings are stripped before anything is counted: FRAME_KIT_JS is full of
    // class="k-…" markup, so counting them in the whole document would assert the kit against
    // itself and pass no matter what the model wrote.
    const ownMarkup = html.replace(FRAME_KIT_CSS, '').replace(FRAME_KIT_JS, '');
    const kClasses = new Set((ownMarkup.match(/class="([^"]*)"/g) ?? []).join(' ').match(/\bk-[a-z0-9-]+/g) ?? []);
    ok('K3 …and the model COMPOSED with it (the page the model wrote is built out of kit classes)',
      kClasses.size >= 6 && ownMarkup.includes('k-page'), `${kClasses.size} kit classes`);
    // THE NON-FLAKY HALF of "compose, don't hand-roll": whether a given generation reaches for a
    // chart at all is a judgement about its data (four numbers are four KPI tiles), so a gate that
    // DEMANDS a chart would be generation-dependent — the one thing a gate may never be. What is
    // law-shaped is the other direction: no frame may draw its OWN chart. Every <svg> in the bytes
    // must be the kit's, so the kit block is stripped and the remainder must contain none.
    const handSvg = (ownMarkup.match(/<svg\b/gi) ?? []).length;
    const kitCalls = [...new Set(html.match(/\bKit\s*\.\s*(?:bar|hbar|line|donut|spark|expand)\b/g) ?? [])];
    ok('K3 …and hand-rolls NO chart of its own (every <svg> in the frame is the kit\'s)',
      handSvg === 0, `${handSvg} hand-rolled svg`);
    ok('K3 …so whatever charting it does show came through the kit',
      handSvg === 0 && (kitCalls.length > 0 || !/class="[^"]*k-chart/.test(ownMarkup)),
      'a chart container exists with no kit call behind it');
    note(kitCalls.length
      ? `this generation called ${kitCalls.join(' · ')}`
      : 'this generation charted nothing (its data did not warrant one) — the no-hand-rolling floor still holds');
    ok('K3 …and the dressed bytes still re-validate clean through the ONE validator',
      validateFrameHtml(html).ok === true, 'the kit broke the no-egress floor in life');
    ok('K3 …with the CSP meta still exactly once (the kit never displaces the policy)',
      countMeta(html) === 1, String(countMeta(html)));

    // ── K4 — THE SOURCE FLOORS. Injection is the promise; the prompt is how the model earns it. ──
    ok('K4 the lane imports the ONE kit module',
      /import \{ injectFrameKit, FRAME_KIT_REFERENCE \} from '@\/lib\/frames\/kit'/.test(genSrc),
      'the lane does not import the kit');
    const genCode = codeOf(genSrc);
    const injectAt = genCode.indexOf('injectFrameKit(raw, accent)');
    ok('K4 injection happens AFTER generation, at the ONE place a generation exists',
      injectAt > 0 && /const raw = stripFence\(/.test(genCode) && genCode.indexOf('const raw = stripFence(') < injectAt,
      'the kit is not injected on the produced text');
    ok('K4 …so BOTH passes are dressed by construction (the repair pass re-enters the same ask)',
      (genCode.match(/injectFrameKit\(/g) ?? []).length === 1
      && /const ask = async \(repairReasons\?: string\[\]\)/.test(genCode)
      && (genCode.match(/await ask\(/g) ?? []).length === 2,
      'the repair pass does not ride the same generation site');
    ok('K4 …and BEFORE validation (the kit is swept by the validator, never exempt from it)',
      injectAt > 0 && injectAt < genCode.indexOf('validateFrameHtml('),
      'the kit is injected after the frame has already been validated');
    ok('K4 the prompt DOCUMENTS the kit API (the model composes, it does not guess)',
      /Kit\.bar\(/.test(genSrc + kitSrc) && /Kit\.hbar\(/.test(kitSrc) && /Kit\.donut\(/.test(kitSrc)
      && /FRAME_KIT_REFERENCE,/.test(genSrc), 'the contract does not carry the kit reference');
    ok('K4 …and carries A NUMBER NEVER STANDS ALONE',
      /A NUMBER NEVER STANDS ALONE/.test(kitSrc), 'the KPI law is not stated to the model');
    ok('K4 …and tells the model not to emit its own kit CSS/JS (one design system per frame)',
      /You do NOT write it, you COMPOSE with it/.test(kitSrc)
      && /Never emit/.test(kitSrc), 'the do-not-duplicate instruction is missing');
    ok('K4 FRAME_KIT_VERSION exists and the marker EMBEDS it (a kit bump is visible in the bytes)',
      FRAME_KIT_VERSION >= 1 && /augmtd-frame-kit v\$\{FRAME_KIT_VERSION\}/.test(kitSrc)
      && kitOnly.includes(`augmtd-frame-kit v${FRAME_KIT_VERSION}`),
      'the version does not ride the marker');
    ok('K4 THE KIT IS ONE MODULE — no other file defines the tokens or the builders',
      (await (async () => {
        const hits: string[] = [];
        for (const f of libAppFiles) {
          if (f === 'lib/frames/kit.ts') continue;
          const s = await readSrc(f);
          if (/--k-accent\s*:/.test(s) || /window\.Kit\s*=/.test(s)) hits.push(f);
        }
        return hits;
      })()).length === 0, 'a second file defines kit tokens or the Kit global');
  } catch (e) {
    fail++;
    console.log(`\n  ✗ SUITE THREW — ${(e as Error).message}\n${(e as Error).stack}`);
  } finally {
    console.log('\nCleanup:');
    // The lane persists nothing itself (materializeDocument returns bytes; its callers own the
    // artifact rows). The one write path it can reach is computeDataFacts → aiCall → ai_usage_events
    // on the probe; its generated script is contract-bound to write no files, so no knowledge_files
    // or storage objects appear. Both are swept and asserted anyway.
    await admin.from('ai_usage_events').delete().eq('user_id', probeId).gte('created_at', startedAt);
    const { count: usageLeft } = await admin.from('ai_usage_events')
      .select('id', { count: 'exact', head: true }).eq('user_id', probeId).gte('created_at', startedAt);
    ok('no usage rows left from this run', (usageLeft ?? 0) === 0, String(usageLeft));

    const { data: kbRows } = await admin.from('knowledge_files')
      .select('id, provider_file_id').eq('user_id', probeId).gte('created_at', startedAt);
    const strays = (kbRows ?? []).map((r) => String(r.provider_file_id));
    if (strays.length) await admin.from('knowledge_files').delete().eq('user_id', probeId).gte('created_at', startedAt);
    ok('the lane created NO knowledge-base rows (materialize returns bytes, it does not persist)',
      strays.length === 0, JSON.stringify(strays));

    // LB fixtures — shares, two threads, four storage objects. Zero leftovers, asserted.
    if (lbArtifactIds.length) {
      await admin.from('item_plans').delete()
        .eq('user_id', probeId).eq('kind', 'frame_share').in('entity_id', lbArtifactIds);
      await admin.from('work_threads').delete().in('id', lbThreadIds);
      await admin.storage.from('work-artifacts').remove(lbStoragePaths);
      const { count: lbShareLeft } = await admin.from('item_plans')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', probeId).eq('kind', 'frame_share').in('entity_id', lbArtifactIds);
      const { count: lbThreadLeft } = await admin.from('work_threads')
        .select('id', { count: 'exact', head: true }).in('id', lbThreadIds);
      ok('the LB share rows, threads and storage objects are all removed',
        (lbShareLeft ?? 0) === 0 && (lbThreadLeft ?? 0) === 0, `${lbShareLeft}/${lbThreadLeft}`);
    }

    // SH fixtures — the share section is the one part of this suite that writes rows.
    if (shareArtifactId) {
      await admin.from('item_plans').delete()
        .eq('user_id', probeId).eq('kind', 'frame_share').eq('entity_id', shareArtifactId);
    }
    if (shareThreadId) await admin.from('work_threads').delete().eq('id', shareThreadId);
    if (shareStoragePath) await admin.storage.from('work-artifacts').remove([shareStoragePath]);
    if (shareArtifactId) {
      const { count: shareLeft } = await admin.from('item_plans')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', probeId).eq('kind', 'frame_share');
      const { count: threadLeft } = await admin.from('work_threads')
        .select('id', { count: 'exact', head: true }).eq('id', shareThreadId ?? shareArtifactId);
      ok('the SH share rows, thread and storage object are all removed',
        (shareLeft ?? 0) === 0 && (threadLeft ?? 0) === 0, `${shareLeft}/${threadLeft}`);
    }

    // FR fixtures — a workflow, its run, its thread, and the frame the door produced.
    if (frWorkflowId || frThreadId) {
      if (frStoragePath) await admin.storage.from('work-artifacts').remove([frStoragePath]);
      if (frRunId) await admin.from('workflow_runs').delete().eq('id', frRunId);
      if (frWorkflowId) await admin.from('workflows').delete().eq('id', frWorkflowId);
      if (frThreadId) await admin.from('work_threads').delete().eq('id', frThreadId);
      const { count: frRunLeft } = await admin.from('workflow_runs')
        .select('id', { count: 'exact', head: true }).eq('id', frRunId ?? NIL_UUID);
      const { count: frWfLeft } = await admin.from('workflows')
        .select('id', { count: 'exact', head: true }).eq('id', frWorkflowId ?? NIL_UUID);
      const { count: frThreadLeft } = await admin.from('work_threads')
        .select('id', { count: 'exact', head: true }).eq('id', frThreadId ?? NIL_UUID);
      ok('the FR workflow, run, thread and storage object are all removed',
        (frRunLeft ?? 0) === 0 && (frWfLeft ?? 0) === 0 && (frThreadLeft ?? 0) === 0,
        `${frRunLeft}/${frWfLeft}/${frThreadLeft}`);
    }

    // SR fixtures — the series writes the most of anything here: a workflow, a run, a thread, and
    // one storage object per generation (22 of them, minus whatever the cap already removed).
    if (srWorkflowId || srThreadId) {
      if (srStoragePaths.length) await admin.storage.from('work-artifacts').remove(srStoragePaths);
      if (srRunId) await admin.from('workflow_runs').delete().eq('id', srRunId);
      if (srWorkflowId) await admin.from('workflows').delete().eq('id', srWorkflowId);
      if (srThreadId) await admin.from('work_threads').delete().eq('id', srThreadId);
      const { count: srRunLeft } = await admin.from('workflow_runs')
        .select('id', { count: 'exact', head: true }).eq('id', srRunId ?? NIL_UUID);
      const { count: srWfLeft } = await admin.from('workflows')
        .select('id', { count: 'exact', head: true }).eq('id', srWorkflowId ?? NIL_UUID);
      const { count: srThreadLeft } = await admin.from('work_threads')
        .select('id', { count: 'exact', head: true }).eq('id', srThreadId ?? NIL_UUID);
      let objectsLeft = 0;
      for (const p of srStoragePaths) if (await objectExists(p)) objectsLeft++;
      ok('the SR workflow, run, thread and EVERY version storage object are removed',
        (srRunLeft ?? 0) === 0 && (srWfLeft ?? 0) === 0 && (srThreadLeft ?? 0) === 0 && objectsLeft === 0,
        `${srRunLeft}/${srWfLeft}/${srThreadLeft} · ${objectsLeft} objects left`);
    }

    if (childScript) {
      await (await import('node:fs/promises')).unlink(childScript).catch(() => {});
      const gone = await (await import('node:fs/promises')).stat(childScript).then(() => false, () => true);
      ok('the L3 child script is removed', gone);
    }
    note('the frames LANE is byte-returning by design — only the SH share section writes fixtures');

    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
