// ─── THE FRAME KIT — the design system every frame wears (frames plan, laws 2 + 3) ───────────
// Pilot feedback was "ideally we have some stunning visuals", and the generations were plain
// default cards and bare numbers. The answer is NOT a better adjective in the prompt: beauty
// becomes DETERMINISTIC by giving every frame a design system WE author, and injecting it BY
// CODE — exactly like the CSP meta. The model stops hand-rolling visuals and COMPOSES with the
// kit; a generation can never ship without it, and the model can never corrupt it.
//
// The three properties that make this a floor rather than a suggestion:
//   • INJECTED, NOT REQUESTED — injectFrameKit() runs after generation and before validation,
//     on the first pass AND the repair pass. A model that ignores the contract still gets the
//     tokens, the type scale and the layout primitives.
//   • IDEMPOTENT — one marker comment guards double-injection (a repaired document is injected
//     into twice by construction).
//   • ITSELF LOCKED — the kit is bound by law 2 like everything else: zero egress, no network
//     API, no external font, no remote image. Charts are hand-built inline SVG. Gate K1 runs the
//     kit through validateFrameHtml itself, so this file can never become the leak.
//
// Bump FRAME_KIT_VERSION on any change to the CSS/JS: it rides in the marker, so a kit bump is
// visible in the produced bytes (and therefore in a diff of two generations).

/** The kit's own version — rides in the injection marker so a bump is visible in the bytes. */
export const FRAME_KIT_VERSION = 1;

const MARKER = `<!-- augmtd-frame-kit v${FRAME_KIT_VERSION} -->`;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE CSS — hand-authored, no framework, print-safe, one committed light look.
//
// A frame is shared out (law 6), so it does not follow the reader's theme: it is a document.
// Warm neutral greys (stone, not slate) under an indigo accent, dark ink on a near-white ground.
// Motion is ≤150ms and only on hover — nothing animates on load, nothing moves while reading.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const FRAME_KIT_CSS = `
:root{
  --k-accent:#4F46E5;
  --k-accent-ink:#3730a3;
  --k-tint:rgba(79,70,229,.08);
  --k-tint-2:rgba(79,70,229,.16);
  --k-ink:#1c1917; --k-ink-2:#57534e; --k-ink-3:#8b857e;
  --k-line:#e7e5e0; --k-line-2:#f1efec;
  --k-bg:#fcfcfb; --k-card:#ffffff;
  --k-good:#15803d; --k-good-bg:#eefaf1;
  --k-warn:#b45309; --k-warn-bg:#fdf6e9;
  --k-danger:#be123c; --k-danger-bg:#fdf0f3;
  --k-s1:var(--k-accent); --k-s2:#0D9488; --k-s3:#D97706;
  --k-s4:#DB2777; --k-s5:#0284C7; --k-s6:#65A30D;
  --k-radius:12px;
  --k-shadow:0 1px 2px rgba(28,25,23,.04);
  --k-font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --k-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@supports (color:color-mix(in srgb,#000 10%,#fff)){
  :root{
    --k-tint:color-mix(in srgb,var(--k-accent) 8%,#ffffff);
    --k-tint-2:color-mix(in srgb,var(--k-accent) 18%,#ffffff);
    --k-accent-ink:color-mix(in srgb,var(--k-accent) 78%,#111111);
  }
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  /* The 3px accent band is a BACKGROUND LAYER, not a fixed element: a position:fixed strip
     repaints badly while scrolling inside an iframe (observed), and a frame is always in one. */
  margin:0; color:var(--k-ink);
  background:var(--k-bg) linear-gradient(90deg,var(--k-accent),var(--k-s2) 62%,var(--k-s3)) no-repeat top left;
  background-size:100% 3px;
  font-family:var(--k-font); font-size:13px; line-height:1.55;
  -webkit-font-smoothing:antialiased; font-variant-numeric:tabular-nums;
}
h1,h2,h3,h4,p,ul,ol,figure{margin:0}
ul,ol{padding:0;list-style:none}
table{border-collapse:collapse;width:100%}

/* ── LAYOUT ─────────────────────────────────────────────────────────────────────────────── */
.k-page{
  max-width:1080px; margin:0 auto; padding:34px 30px 56px; position:relative;
}
.k-header{
  display:flex; align-items:flex-end; justify-content:space-between; gap:24px;
  padding-bottom:18px; margin-bottom:26px; border-bottom:1px solid var(--k-line);
}
.k-header-main{min-width:0}
.k-eyebrow{
  font-size:11px; font-weight:600; letter-spacing:.09em; text-transform:uppercase;
  color:var(--k-accent-ink); margin-bottom:7px;
}
.k-title{font-size:25px; line-height:1.2; font-weight:640; letter-spacing:-.017em; color:var(--k-ink)}
.k-sub{margin-top:7px; font-size:13.5px; color:var(--k-ink-2); max-width:62ch}
.k-meta{
  flex:0 0 auto; text-align:right; font-size:11.5px; color:var(--k-ink-3); line-height:1.5;
}
.k-meta strong{display:block; font-size:13px; font-weight:600; color:var(--k-ink-2)}

.k-section{margin:30px 0 0}
.k-section > .k-h{
  display:flex; align-items:center; gap:9px; margin-bottom:13px;
  font-size:11px; font-weight:660; letter-spacing:.09em; text-transform:uppercase; color:var(--k-ink-2);
}
.k-section > .k-h::before{
  content:""; width:3px; height:13px; border-radius:2px; background:var(--k-accent); flex:0 0 auto;
}
.k-section > .k-h .k-h-note{
  margin-left:auto; font-weight:500; letter-spacing:0; text-transform:none;
  font-size:11.5px; color:var(--k-ink-3);
}
.k-lead{font-size:14px; color:var(--k-ink-2); max-width:74ch; margin-bottom:14px}

.k-grid{display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.k-grid-2{display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.k-split{display:grid; gap:14px; grid-template-columns:minmax(0,1.55fr) minmax(0,1fr)}
@media (max-width:760px){ .k-split{grid-template-columns:minmax(0,1fr)} .k-page{padding:24px 16px 44px} }

/* ── CARDS ──────────────────────────────────────────────────────────────────────────────── */
.k-card{
  background:var(--k-card); border:1px solid var(--k-line); border-radius:var(--k-radius);
  padding:16px 17px; box-shadow:var(--k-shadow); min-width:0;
  transition:border-color .14s ease, box-shadow .14s ease;
}
.k-card:hover{border-color:#dcd9d3; box-shadow:0 2px 8px rgba(28,25,23,.06)}
.k-card-h{
  display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:12px;
}
.k-card-t{font-size:13.5px; font-weight:620; color:var(--k-ink); letter-spacing:-.005em}
.k-card-n{font-size:11.5px; color:var(--k-ink-3)}
.k-card-flush{padding:16px 0 8px}
.k-card-flush > .k-card-h{padding:0 17px}
/* A chart in a flush card still needs breathing room, or its right-aligned values touch the
   border. The holder is padded (never the svg), so the chart simply draws narrower. */
.k-card-flush .k-chart{padding:0 14px}

/* ── KPI — A NUMBER NEVER STANDS ALONE ──────────────────────────────────────────────────── */
.k-kpi{
  background:var(--k-card); border:1px solid var(--k-line); border-radius:var(--k-radius);
  padding:14px 16px 15px; box-shadow:var(--k-shadow); position:relative; overflow:hidden;
  transition:border-color .14s ease, box-shadow .14s ease;
}
.k-kpi::before{
  content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--k-accent);
  opacity:.85;
}
.k-kpi:hover{border-color:#dcd9d3; box-shadow:0 2px 8px rgba(28,25,23,.06)}
.k-kpi .k-label{
  font-size:11px; font-weight:600; letter-spacing:.075em; text-transform:uppercase;
  color:var(--k-ink-3); display:block; margin-bottom:6px;
}
.k-kpi .k-value{
  font-size:29px; line-height:1.08; font-weight:640; letter-spacing:-.024em; color:var(--k-ink);
  font-variant-numeric:tabular-nums; display:inline-block; vertical-align:baseline;
}
.k-kpi .k-unit{font-size:14px; font-weight:600; color:var(--k-ink-2); margin-left:3px}
.k-kpi .k-ctx{
  display:block; margin-top:7px; font-size:11.5px; color:var(--k-ink-2); line-height:1.45;
}
.k-kpi .k-spark{display:block; margin-top:9px; height:30px}
.k-kpi-row{display:flex; align-items:baseline; gap:8px; flex-wrap:wrap}

.k-delta{
  display:inline-flex; align-items:center; gap:3px; font-size:11.5px; font-weight:620;
  padding:2px 7px; border-radius:999px; letter-spacing:-.005em; white-space:nowrap;
}
.k-delta-up{color:var(--k-good); background:var(--k-good-bg)}
.k-delta-down{color:var(--k-danger); background:var(--k-danger-bg)}
.k-delta-flat{color:var(--k-ink-2); background:var(--k-line-2)}

/* ── CHIPS ──────────────────────────────────────────────────────────────────────────────── */
.k-chip{
  display:inline-flex; align-items:center; gap:5px; padding:2px 9px; border-radius:999px;
  font-size:11.5px; font-weight:580; line-height:1.6; white-space:nowrap;
  background:var(--k-line-2); color:var(--k-ink-2); border:1px solid transparent;
}
.k-chip-accent{background:var(--k-tint); color:var(--k-accent-ink)}
.k-chip-good{background:var(--k-good-bg); color:var(--k-good)}
.k-chip-warn{background:var(--k-warn-bg); color:var(--k-warn)}
.k-chip-danger{background:var(--k-danger-bg); color:var(--k-danger)}
.k-chip-quiet{background:transparent; border-color:var(--k-line); color:var(--k-ink-3)}
.k-dot{width:7px; height:7px; border-radius:50%; background:currentColor; flex:0 0 auto; opacity:.85}

/* ── ROWS & LISTS ───────────────────────────────────────────────────────────────────────── */
.k-list{display:flex; flex-direction:column}
.k-row{
  display:flex; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--k-line-2);
  min-width:0;
}
.k-list > .k-row:first-child{border-top:0}
.k-row-main{min-width:0; flex:1 1 auto}
.k-row-t{
  font-size:13px; color:var(--k-ink); font-weight:520;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.k-row-m{font-size:11.5px; color:var(--k-ink-3); margin-top:2px}
.k-row-v{
  font-size:13px; font-weight:620; color:var(--k-ink); font-variant-numeric:tabular-nums;
  flex:0 0 auto; text-align:right;
}
.k-row-side{flex:0 0 auto; display:flex; align-items:center; gap:8px}

.k-table-wrap{overflow-x:auto; -webkit-overflow-scrolling:touch}
.k-table{font-size:12.5px; min-width:100%}
.k-table th{
  text-align:left; font-size:10.5px; font-weight:640; letter-spacing:.075em; text-transform:uppercase;
  color:var(--k-ink-3); padding:0 12px 8px 0; border-bottom:1px solid var(--k-line); white-space:nowrap;
}
.k-table td{padding:9px 12px 9px 0; border-bottom:1px solid var(--k-line-2); vertical-align:top}
.k-table tr:last-child td{border-bottom:0}
.k-table .k-num{text-align:right; font-variant-numeric:tabular-nums; padding-right:0}
.k-table th.k-num{padding-right:0}
.k-table tbody tr{transition:background-color .12s ease}
.k-table tbody tr:hover{background:var(--k-line-2)}

.k-bar-track{height:6px; border-radius:999px; background:var(--k-line-2); overflow:hidden; min-width:60px}
.k-bar-fill{height:100%; border-radius:999px; background:var(--k-accent)}

/* ── DISCLOSURE (tier-1 interactivity: a count carries its list) ────────────────────────── */
.k-exp-h{cursor:pointer; user-select:none; display:flex; align-items:center; gap:7px}
.k-exp-h:hover{color:var(--k-accent-ink)}
.k-caret{
  flex:0 0 auto; width:8px; height:8px; border-right:1.6px solid currentColor;
  border-bottom:1.6px solid currentColor; transform:rotate(-45deg); opacity:.55;
  transition:transform .14s ease; margin-bottom:2px;
}
.k-exp-open > .k-caret{transform:rotate(45deg)}
.k-exp-b[hidden]{display:none}
.k-exp-b{padding-top:8px}

/* ── CHARTS ─────────────────────────────────────────────────────────────────────────────── */
.k-chart{position:relative; width:100%}
.k-chart svg{display:block; width:100%; height:auto; overflow:visible}
.k-ax{font-size:10px; fill:var(--k-ink-3); font-family:var(--k-font)}
.k-vl{font-size:10.5px; fill:var(--k-ink-2); font-weight:600; font-family:var(--k-font); font-variant-numeric:tabular-nums}
.k-gl{stroke:var(--k-line); stroke-width:1; shape-rendering:crispEdges}
.k-hit{fill:transparent; cursor:default}
.k-mark{transition:opacity .12s ease}
.k-chart.k-dim .k-mark:not(.k-on){opacity:.38}
.k-tip{
  position:absolute; pointer-events:none; z-index:9; opacity:0; transform:translate(-50%,-118%);
  background:#1c1917; color:#fafaf9; font-size:11.5px; line-height:1.45; padding:6px 9px;
  border-radius:7px; white-space:nowrap; box-shadow:0 4px 14px rgba(28,25,23,.22);
  transition:opacity .1s ease;
}
.k-tip.k-on{opacity:1}
.k-tip b{font-weight:640; font-variant-numeric:tabular-nums}
.k-legend{display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:12px}
.k-legend-i{display:flex; align-items:center; gap:7px; font-size:11.5px; color:var(--k-ink-2); min-width:0}
.k-legend-s{width:9px; height:9px; border-radius:3px; flex:0 0 auto}
.k-legend-v{margin-left:auto; font-weight:620; color:var(--k-ink); font-variant-numeric:tabular-nums}
.k-legend-col{display:flex; flex-direction:column; gap:8px; margin-top:0}
.k-legend-col .k-legend-i{width:100%}
.k-donut-wrap{display:flex; align-items:center; gap:18px; flex-wrap:wrap}
.k-donut-wrap .k-chart{flex:0 0 168px; max-width:168px}
.k-donut-wrap .k-legend-col{flex:1 1 190px; min-width:0}
.k-donut-c{font-weight:640; letter-spacing:-.02em; fill:var(--k-ink)}
.k-donut-l{font-size:10px; letter-spacing:.07em; text-transform:uppercase; fill:var(--k-ink-3)}

/* ── EMPTY & FOOT ───────────────────────────────────────────────────────────────────────── */
.k-empty{
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px;
  padding:26px 18px; border:1px dashed var(--k-line); border-radius:10px;
  background:repeating-linear-gradient(135deg,transparent,transparent 7px,var(--k-line-2) 7px,var(--k-line-2) 8px);
  text-align:center; min-height:96px;
}
.k-empty b{font-size:12.5px; font-weight:600; color:var(--k-ink-2)}
.k-empty span{font-size:11.5px; color:var(--k-ink-3); max-width:44ch}
.k-foot{
  margin-top:34px; padding-top:14px; border-top:1px solid var(--k-line);
  display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap;
  font-size:11.5px; color:var(--k-ink-3);
}
.k-muted{color:var(--k-ink-3)}
.k-strong{font-weight:620; color:var(--k-ink)}
.k-num-f{font-variant-numeric:tabular-nums}
.k-mono{font-family:var(--k-mono); font-size:11.5px}

@media print{
  body{background:#fff}
  .k-page{max-width:none; padding:0}
  body{background-image:none}
  .k-card,.k-kpi{box-shadow:none; break-inside:avoid}
  .k-section{break-inside:avoid}
  .k-tip{display:none}
}
@media (prefers-reduced-motion:reduce){
  *{transition:none !important}
}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE JS — window.Kit. Dependency-free SVG builders the model CALLS with data.
//
// The craft lives HERE, not in the model's head: axis labels 10px muted, hairline gridlines,
// the accent leads and further series step through the validated categorical order, values
// formatted with thousands separators, a hover tooltip on every mark, and an honest .k-empty
// whenever the data is empty. The model supplies numbers; the kit decides how they look.
//
// LAW 2 INSIDE THE KIT: zero network anything. SVG is built as markup and mounted with
// innerHTML (HTML parsing namespaces <svg> correctly), so not even a namespace URL appears.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export const FRAME_KIT_JS = `
(function(){
  "use strict";
  var PAL = ['var(--k-s1)','var(--k-s2)','var(--k-s3)','var(--k-s4)','var(--k-s5)','var(--k-s6)'];

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function node(el){
    if (!el) return null;
    if (typeof el === 'string') return document.querySelector(el);
    return el.nodeType === 1 ? el : null;
  }
  function num(v){ var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; }
  function nice(n){
    if (!isFinite(n)) return '—';
    var abs = Math.abs(n);
    var d = abs >= 100 || n % 1 === 0 ? 0 : (abs >= 10 ? 1 : 2);
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmt(v, f){
    if (typeof f === 'function') { try { return String(f(v)); } catch (e) { return nice(num(v)); } }
    var n = num(v);
    if (f === 'pct') return nice(n) + '%';
    if (f === 'int') return Math.round(n).toLocaleString('en-US');
    if (f === 'k') return Math.abs(n) >= 1000 ? nice(n / 1000) + 'k' : nice(n);
    if (typeof f === 'string' && f) {
      // A short currency/unit token: "€" or "$" prefixes, anything else suffixes.
      if (f === '€' || f === '$' || f === '£') return f + nice(n);
      return nice(n) + ' ' + f;
    }
    return nice(n);
  }
  function empty(el, line){
    if (!el) return;
    el.innerHTML = '<div class="k-empty"><b>Nothing to chart yet</b><span>' +
      esc(line || 'No data was available for this view.') + '</span></div>';
  }
  /** THE CRAFT REASON THIS EXISTS: a fixed 640-unit viewBox scaled into a 300px card shrinks every
   *  axis label to ~5px. Charts are therefore drawn at the container's REAL pixel width (1 unit =
   *  1px), and re-drawn when the width changes — text stays at the size the kit chose. */
  var CHARTS = [];
  function widthOf(el, min){
    var w = Math.round(el.clientWidth || (el.getBoundingClientRect ? el.getBoundingClientRect().width : 0));
    if (!w) w = 640;
    var pad = 0;
    try {
      var cs = getComputedStyle(el);
      pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    } catch (e) { pad = 0; }
    return Math.max(w - pad, min || 260);
  }
  function remember(el, f, o){
    el.__kf = f; el.__ko = o;
    if (CHARTS.indexOf(el) < 0) CHARTS.push(el);
  }
  var redrawT = null;
  function redraw(){
    for (var i = 0; i < CHARTS.length; i++) {
      var el = CHARTS[i];
      if (!el.__kf || !document.body.contains(el)) continue;
      try { window.Kit[el.__kf](el, el.__ko); } catch (e) {}
    }
  }
  window.addEventListener('resize', function(){
    if (redrawT) clearTimeout(redrawT);
    redrawT = setTimeout(redraw, 160);
  });

  function mount(el, svg){
    el.classList.add('k-chart');
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.innerHTML = svg + '<div class="k-tip"></div>';
    wireTips(el);
  }
  function wireTips(el){
    var tip = el.querySelector('.k-tip');
    if (!tip) return;
    var hits = el.querySelectorAll('[data-k-tip]');
    for (var i = 0; i < hits.length; i++) {
      (function(h){
        h.addEventListener('mouseenter', function(){
          tip.innerHTML = h.getAttribute('data-k-tip');
          tip.classList.add('k-on');
          var box = el.getBoundingClientRect(), hb = h.getBoundingClientRect();
          tip.style.left = (hb.left - box.left + hb.width / 2) + 'px';
          tip.style.top = (hb.top - box.top + (h.hasAttribute('data-k-top') ? 0 : hb.height / 2)) + 'px';
          var on = h.getAttribute('data-k-mark');
          if (on) {
            el.classList.add('k-dim');
            var m = el.querySelector('[data-k-id="' + on + '"]');
            if (m) m.classList.add('k-on');
          }
        });
        h.addEventListener('mouseleave', function(){
          tip.classList.remove('k-on');
          el.classList.remove('k-dim');
          var on = el.querySelectorAll('.k-mark.k-on');
          for (var j = 0; j < on.length; j++) on[j].classList.remove('k-on');
        });
      })(hits[i]);
    }
  }
  /** A bar rounded only at its data end — the baseline end stays square (marks-and-anatomy). */
  function barUp(x, y, w, h, r){
    r = Math.min(r, w / 2, Math.max(h, 0));
    if (h <= 0.5) return 'M' + x + ' ' + (y + h) + 'h' + w;
    return 'M' + x + ' ' + (y + h) + 'V' + (y + r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + (-r) +
      'h' + (w - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'V' + (y + h) + 'Z';
  }
  function barRight(x, y, w, h, r){
    r = Math.min(r, h / 2, Math.max(w, 0));
    if (w <= 0.5) return 'M' + x + ' ' + y + 'v' + h;
    return 'M' + x + ' ' + y + 'h' + (w - r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r +
      'v' + (h - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + (-r) + ' ' + r + 'H' + x + 'Z';
  }
  /** A calm axis: 3–5 gridlines on ROUND steps. The step is chosen first and the top follows it,
   *  so every label is a number a reader recognises (0 · 2 · 4 · 6 · 8), never max/4. */
  function axis(max){
    if (!(max > 0)) return { top: 1, n: 1 };
    var mag = Math.pow(10, Math.floor(Math.log(max) / Math.LN10) - 1), best = null;
    for (var p = 0; p < 6; p++) {
      var m = mag * Math.pow(10, p);
      var steps = [m, m * 2, m * 5];
      for (var i = 0; i < steps.length; i++) {
        var n = Math.ceil(max / steps[i]);
        if (n >= 3 && n <= 5 && (!best || steps[i] * n < best.top)) best = { top: steps[i] * n, n: n };
      }
    }
    return best || { top: max, n: 4 };
  }
  function thin(labels, keep){
    var every = Math.ceil(labels.length / keep), last = labels.length - 1;
    var out = labels.map(function(l, i){ return (i % every === 0 || i === last) ? l : ''; });
    // The last label is always kept, so the one before it can land right on top of it.
    for (var i = last - 1; i > 0; i--) {
      if (out[i]) { if (last - i < every) out[i] = ''; break; }
    }
    return out;
  }

  // ── BAR (vertical): few categories, magnitude. One measure, or a small grouped comparison ──
  function bar(target, o){
    var el = node(target); if (!el) return;
    o = o || {};
    var labels = (o.labels || []).map(String);
    var series = (o.series || []).filter(function(x){ return x && (x.values || []).length; });
    if (!series.length && (o.values || []).length) series = [{ name: o.name || '', values: o.values }];
    remember(el, 'bar', o);
    if (!labels.length || !series.length) return empty(el, o.emptyLine);
    var W = widthOf(el, 280), H = o.height || 240, L = 44, R = 10, T = 18, B = 30;
    var iw = W - L - R, ih = H - T - B;
    var all = [];
    series.forEach(function(sr){ (sr.values || []).forEach(function(v){ all.push(num(v)); }); });
    var ax = axis(Math.max.apply(null, all.concat([0])));
    var n = labels.length, k = series.length, slot = iw / n;
    var group = Math.min(o.barWidth ? o.barWidth * k : 52 * Math.min(k, 2), slot * 0.68);
    var bw = Math.max((group - (k - 1) * 3) / k, 2);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    for (var g = 0; g <= ax.n; g++) {
      var gy = T + ih - (ih * g / ax.n);
      s += '<line class="k-gl" x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '"/>';
      s += '<text class="k-ax" x="' + (L - 8) + '" y="' + (gy + 3.5) + '" text-anchor="end">' +
        esc(fmt(ax.top * g / ax.n, o.format)) + '</text>';
    }
    var showV = k === 1 && n <= 9;
    for (var i = 0; i < n; i++) {
      var gx = L + slot * i + (slot - group) / 2;
      for (var j = 0; j < k; j++) {
        var v = num((series[j].values || [])[i]);
        var h = ax.top ? (v / ax.top) * ih : 0, x = gx + j * (bw + 3), y = T + ih - h;
        var col = PAL[(k > 1 ? j : (o.colorByIndex ? i : 0)) % PAL.length];
        s += '<path class="k-mark" data-k-id="b' + i + '_' + j + '" d="' + barUp(x, y, bw, h, 4) +
          '" fill="' + col + '"/>';
        if (showV) s += '<text class="k-vl" x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' +
          esc(fmt(v, o.format)) + '</text>';
      }
      s += '<text class="k-ax" x="' + (L + slot * i + slot / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' +
        esc(labels[i] || '') + '</text>';
      var rows = series.map(function(sr, j2){
        return (k > 1 ? '<span style="color:' + PAL[j2 % PAL.length] + '">&#9679;</span> ' + esc(sr.name || 'Series ' + (j2 + 1)) + ' ' : '') +
          '<b>' + esc(fmt((sr.values || [])[i], o.format)) + '</b>';
      }).join('<br>');
      s += '<rect class="k-hit" data-k-tip="' + esc(labels[i] || '') + '<br>' + rows.replace(/"/g, '&quot;') +
        '" data-k-top="1" x="' + (L + slot * i) + '" y="' + T + '" width="' + slot + '" height="' + ih + '"/>';
    }
    s += '</svg>';
    if (k > 1) {
      s += '<div class="k-legend">' + series.map(function(sr, j3){
        return '<span class="k-legend-i"><i class="k-legend-s" style="background:' + PAL[j3 % PAL.length] +
          '"></i>' + esc(sr.name || 'Series ' + (j3 + 1)) + '</span>';
      }).join('') + '</div>';
    }
    mount(el, s);
  }

  // ── HBAR: labels left, values right — the right form for named categories ────────────────
  function hbar(target, o){
    var el = node(target); if (!el) return;
    o = o || {};
    var labels = (o.labels || []).map(String), values = (o.values || []).map(num);
    remember(el, 'hbar', o);
    if (!labels.length || !values.length) return empty(el, o.emptyLine);
    var n = Math.min(labels.length, values.length);
    var rowH = o.rowHeight || 30, W = widthOf(el, 280), H = n * rowH + 8;
    var L = Math.min(o.labelWidth || 168, 250), R = 66, bh = Math.min(15, rowH - 12);
    var max = Math.max.apply(null, values.concat([0])) || 1;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    for (var i = 0; i < n; i++) {
      var y = i * rowH + 6, w = Math.max((values[i] / max) * (W - L - R), values[i] > 0 ? 2 : 0);
      var col = PAL[(o.colorByIndex ? i : 0) % PAL.length];
      s += '<rect x="' + L + '" y="' + (y + (rowH - 12 - bh) / 2 + 3) + '" width="' + (W - L - R) +
        '" height="' + bh + '" rx="' + (bh / 2) + '" fill="var(--k-line-2)"/>';
      s += '<path class="k-mark" data-k-id="h' + i + '" d="' +
        barRight(L, y + (rowH - 12 - bh) / 2 + 3, w, bh, bh / 2) + '" fill="' + col + '"/>';
      s += '<text class="k-ax" x="' + (L - 10) + '" y="' + (y + bh / 2 + 7) + '" text-anchor="end" ' +
        'style="fill:var(--k-ink-2);font-size:11.5px">' + esc(labels[i]) + '</text>';
      s += '<text class="k-vl" x="' + W + '" y="' + (y + bh / 2 + 7) + '" text-anchor="end">' +
        esc(fmt(values[i], o.format)) + '</text>';
      s += '<rect class="k-hit" data-k-mark="h' + i + '" data-k-tip="' + esc(labels[i]) +
        ' &middot; <b>' + esc(fmt(values[i], o.format)) + '</b>" x="0" y="' + y + '" width="' + W +
        '" height="' + rowH + '"/>';
    }
    mount(el, s + '</svg>');
  }

  // ── LINE: time. Area gradient under the lead series, dot on the last point ───────────────
  function line(target, o){
    var el = node(target); if (!el) return;
    o = o || {};
    var labels = (o.labels || []).map(String);
    var series = (o.series || []).filter(function(x){ return x && (x.values || []).length; });
    remember(el, 'line', o);
    if (!labels.length || !series.length) return empty(el, o.emptyLine);
    var W = widthOf(el, 280), H = o.height || 240, L = 46, R = 14, T = 16, B = 28;
    var iw = W - L - R, ih = H - T - B;
    var all = [];
    series.forEach(function(sr){ (sr.values || []).forEach(function(v){ all.push(num(v)); }); });
    var ax = axis(Math.max.apply(null, all.concat([0]))), top = ax.top;
    var uid = 'g' + Math.random().toString(36).slice(2, 8);
    var xs = function(i){ return labels.length < 2 ? L + iw / 2 : L + (iw * i) / (labels.length - 1); };
    var ys = function(v){ return T + ih - (top ? (num(v) / top) * ih : 0); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    s += '<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + PAL[0] + '" stop-opacity=".20"/>' +
      '<stop offset="100%" stop-color="' + PAL[0] + '" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g <= ax.n; g++) {
      var gy = T + ih - (ih * g / ax.n);
      s += '<line class="k-gl" x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '"/>';
      s += '<text class="k-ax" x="' + (L - 8) + '" y="' + (gy + 3.5) + '" text-anchor="end">' +
        esc(fmt(top * g / ax.n, o.format)) + '</text>';
    }
    series.forEach(function(sr, si){
      var vals = sr.values || [], col = PAL[si % PAL.length], d = '';
      for (var i = 0; i < vals.length; i++) d += (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(vals[i]).toFixed(1);
      if (si === 0 && vals.length > 1) {
        s += '<path d="' + d + 'L' + xs(vals.length - 1).toFixed(1) + ' ' + (T + ih) + 'L' + xs(0).toFixed(1) +
          ' ' + (T + ih) + 'Z" fill="url(#' + uid + ')"/>';
      }
      s += '<path class="k-mark" data-k-id="s' + si + '" d="' + d + '" fill="none" stroke="' + col +
        '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      if (vals.length) {
        s += '<circle cx="' + xs(vals.length - 1).toFixed(1) + '" cy="' + ys(vals[vals.length - 1]).toFixed(1) +
          '" r="3.5" fill="' + col + '" stroke="#fff" stroke-width="1.6"/>';
      }
    });
    var xl = thin(labels, 7);
    for (var i2 = 0; i2 < labels.length; i2++) {
      if (xl[i2]) s += '<text class="k-ax" x="' + xs(i2).toFixed(1) + '" y="' + (H - 9) +
        '" text-anchor="middle">' + esc(xl[i2]) + '</text>';
      var tipRows = series.map(function(sr, si){
        return '<span style="color:' + PAL[si % PAL.length] + '">&#9679;</span> ' + esc(sr.name || 'Series ' + (si + 1)) +
          ' <b>' + esc(fmt((sr.values || [])[i2], o.format)) + '</b>';
      }).join('<br>');
      var hw = labels.length < 2 ? iw : iw / (labels.length - 1);
      s += '<rect class="k-hit" data-k-top="1" data-k-tip="' + esc(labels[i2]) + '<br>' + tipRows.replace(/"/g, '&quot;') +
        '" x="' + (xs(i2) - hw / 2).toFixed(1) + '" y="' + T + '" width="' + hw.toFixed(1) + '" height="' + ih + '"/>';
    }
    s += '</svg>';
    if (series.length > 1) {
      s += '<div class="k-legend">' + series.map(function(sr, si){
        return '<span class="k-legend-i"><i class="k-legend-s" style="background:' + PAL[si % PAL.length] +
          '"></i>' + esc(sr.name || 'Series ' + (si + 1)) + '</span>';
      }).join('') + '</div>';
    }
    mount(el, s);
  }

  // ── DONUT: parts of one whole, legend carrying value + share ─────────────────────────────
  function donut(target, o){
    var el = node(target); if (!el) return;
    o = o || {};
    var items = (o.items || []).map(function(x){ return { label: String(x.label), value: num(x.value) }; })
      .filter(function(x){ return x.value > 0; });
    if (!items.length) return empty(el, o.emptyLine);
    var total = items.reduce(function(a, b){ return a + b.value; }, 0) || 1;
    var S = 168, cx = S / 2, cy = S / 2, ro = 72, ri = 45, a = -Math.PI / 2;
    var s = '<svg viewBox="0 0 ' + S + ' ' + S + '" role="img">';
    var legend = '';
    items.forEach(function(it, i){
      var frac = it.value / total, sweep = frac * Math.PI * 2, gap = items.length > 1 ? 0.03 : 0;
      var a0 = a + gap / 2, a1 = a + sweep - gap / 2, col = PAL[i % PAL.length];
      if (a1 > a0) {
        var big = (a1 - a0) > Math.PI ? 1 : 0;
        var p = 'M' + (cx + ro * Math.cos(a0)).toFixed(2) + ' ' + (cy + ro * Math.sin(a0)).toFixed(2) +
          'A' + ro + ' ' + ro + ' 0 ' + big + ' 1 ' + (cx + ro * Math.cos(a1)).toFixed(2) + ' ' + (cy + ro * Math.sin(a1)).toFixed(2) +
          'L' + (cx + ri * Math.cos(a1)).toFixed(2) + ' ' + (cy + ri * Math.sin(a1)).toFixed(2) +
          'A' + ri + ' ' + ri + ' 0 ' + big + ' 0 ' + (cx + ri * Math.cos(a0)).toFixed(2) + ' ' + (cy + ri * Math.sin(a0)).toFixed(2) + 'Z';
        s += '<path class="k-mark" data-k-id="d' + i + '" d="' + p + '" fill="' + col + '"/>';
        s += '<path class="k-hit" data-k-mark="d' + i + '" data-k-tip="' + esc(it.label) + ' &middot; <b>' +
          esc(fmt(it.value, o.format)) + '</b> (' + (frac * 100).toFixed(frac < 0.1 ? 1 : 0) + '%)" d="' + p + '"/>';
      }
      a += sweep;
      legend += '<span class="k-legend-i"><i class="k-legend-s" style="background:' + col + '"></i>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(it.label) + '</span>' +
        '<span class="k-legend-v">' + esc(fmt(it.value, o.format)) + ' &middot; ' +
        (frac * 100).toFixed(frac < 0.1 ? 1 : 0) + '%</span></span>';
    });
    s += '<text class="k-donut-c" x="' + cx + '" y="' + (cy - 1) + '" text-anchor="middle" font-size="21">' +
      esc(o.centerValue != null ? String(o.centerValue) : fmt(total, o.format)) + '</text>';
    s += '<text class="k-donut-l" x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle">' +
      esc(o.centerLabel || 'total') + '</text></svg>';
    el.classList.add('k-donut-wrap');
    el.innerHTML = '<div class="k-chart">' + s + '<div class="k-tip"></div></div>' +
      '<div class="k-legend k-legend-col">' + legend + '</div>';
    var inner = el.querySelector('.k-chart');
    if (inner) { inner.style.position = 'relative'; wireTips(inner); }
  }

  // ── SPARK: a trend beside a number, no axes, no ceremony ─────────────────────────────────
  function spark(target, o){
    var el = node(target); if (!el) return;
    o = o || {};
    var vals = (o.values || []).map(num);
    if (vals.length < 2) { el.innerHTML = ''; return; }
    var W = 160, H = 34, P = 3;
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = (mx - mn) || 1;
    var d = '', ptx = 0, pty = 0;
    for (var i = 0; i < vals.length; i++) {
      ptx = P + ((W - 2 * P) * i) / (vals.length - 1);
      pty = P + (H - 2 * P) * (1 - (vals[i] - mn) / span);
      d += (i ? 'L' : 'M') + ptx.toFixed(1) + ' ' + pty.toFixed(1);
    }
    var col = o.color || PAL[0];
    el.classList.add('k-chart');
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + ptx.toFixed(1) + '" cy="' + pty.toFixed(1) + '" r="2.6" fill="' + col + '"/></svg>';
  }

  // ── EXPAND: the disclosure primitive — a count carries its list ──────────────────────────
  function expand(headerEl, bodyEl, opts){
    var h = node(headerEl), b = node(bodyEl);
    if (!h || !b) return;
    var open = !!(opts && opts.open);
    h.classList.add('k-exp-h');
    b.classList.add('k-exp-b');
    if (!h.querySelector('.k-caret')) {
      var c = document.createElement('i');
      c.className = 'k-caret';
      h.insertBefore(c, h.firstChild);
    }
    h.setAttribute('role', 'button');
    h.setAttribute('tabindex', '0');
    var set = function(v){
      open = v;
      b.hidden = !open;
      h.classList.toggle('k-exp-open', open);
      h.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    set(open);
    h.addEventListener('click', function(){ set(!open); });
    h.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set(!open); }
    });
  }

  window.Kit = {
    version: __KIT_VERSION__,
    palette: PAL.slice(),
    bar: bar, hbar: hbar, line: line, donut: donut, spark: spark,
    expand: expand, fmt: fmt, esc: esc, empty: empty
  };
})();
`.trim().replace('__KIT_VERSION__', String(FRAME_KIT_VERSION));

/** Only a literal hex may become the accent — anything else is ignored (an accent is a colour,
 *  never a place a URL could hide). */
function safeAccent(accent?: string | null): string | null {
  if (!accent) return null;
  const hex = String(accent).trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(hex) ? `#${hex}` : null;
}

/**
 * THE INJECTION — idempotent, by code, after generation and before validation.
 *
 * Places the marker, the kit stylesheet and the kit script as the first children of <head>
 * (after the CSP meta when the validator has already stamped one, so the policy still leads).
 * A document with no <head> gets one; a document with no <html> gets the kit prepended, which
 * the validator will then reject on its own whole-document rule — the kit never rescues a
 * malformed generation, it only dresses a real one.
 */
export function injectFrameKit(html: string, accent?: string | null): string {
  const src = typeof html === 'string' ? html : '';
  if (src.includes(MARKER) || /<!--\s*augmtd-frame-kit/i.test(src)) return src;

  const hex = safeAccent(accent);
  const override = hex ? `\n<style>:root{--k-accent:${hex}}</style>` : '';
  // A frame travels: it is served by our own route today and handed to a client's browser
  // tomorrow. Without a declared charset a viewer's default encoding turns every en dash and
  // middot into mojibake — so the kit guarantees one, exactly once.
  const charset = /<meta[^>]+charset/i.test(src) ? '' : '\n<meta charset="utf-8">';
  const block = `${charset}\n${MARKER}\n<style>\n${FRAME_KIT_CSS}\n</style>${override}\n<script>\n${FRAME_KIT_JS}\n</script>`;

  // After the CSP meta when it exists — the policy is the first thing in the document.
  const meta = src.match(/<meta[^>]+http-equiv\s*=\s*["']?\s*Content-Security-Policy[^>]*>/i);
  if (meta) {
    const at = meta.index! + meta[0].length;
    return src.slice(0, at) + block + src.slice(at);
  }
  const head = src.match(/<head\b[^>]*>/i);
  if (head) {
    const at = head.index! + head[0].length;
    return src.slice(0, at) + block + src.slice(at);
  }
  const htmlTag = src.match(/<html\b[^>]*>/i);
  if (htmlTag) {
    const at = htmlTag.index! + htmlTag[0].length;
    return src.slice(0, at) + `\n<head>${block}\n</head>` + src.slice(at);
  }
  return `<head>${block}\n</head>\n` + src;
}

/** The compact reference the codegen prompt carries — the kit's API said once, in one place,
 *  so the contract in the prompt and the code in the page can never describe different kits. */
export const FRAME_KIT_REFERENCE = [
  'THE FRAME KIT — a design system is ALREADY INJECTED into your document by code (its <style> and',
  'its <script> are added after you finish). You do NOT write it, you COMPOSE with it. Never emit',
  'your own reset, tokens, card/KPI/chart CSS, or a chart library; a small amount of extra inline',
  'CSS for a genuinely one-off layout is allowed. DO include your own <script> at the END of <body>',
  'that CALLS the kit (window.Kit) with the data.',
  '',
  'THE SKELETON (use exactly this shape):',
  '<body><div class="k-page">',
  '  <header class="k-header"><div class="k-header-main">',
  '    <div class="k-eyebrow">SHORT KICKER</div><h1 class="k-title">Title</h1>',
  '    <p class="k-sub">One line naming the data\'s scope and period.</p></div>',
  '    <div class="k-meta"><strong>Key figure</strong>what it counts</div></header>',
  '  <div class="k-grid"> …k-kpi tiles… </div>',
  '  <section class="k-section"><h2 class="k-h">Section name<span class="k-h-note">optional note</span></h2> …cards… </section>',
  '  <footer class="k-foot"><span>Updated &lt;date&gt;</span><span>source line</span></footer>',
  '</div></body>',
  '',
  'A CHART CARD: <div class="k-card k-card-flush"><div class="k-card-h"><span class="k-card-t">Name</span>',
'<span class="k-card-n">unit or period</span></div><div id="chart-1"></div></div> — then call the kit on #chart-1.',
'',
'CLASSES: .k-page .k-header/.k-header-main/.k-eyebrow/.k-title/.k-sub/.k-meta ·',
  '.k-section > h2.k-h (+ .k-h-note) · .k-lead · .k-grid (auto-fit tiles) · .k-grid-2 (wide cards) ·',
  '.k-split (main + side) · .k-card (+ .k-card-h/.k-card-t/.k-card-n; .k-card-flush for a chart card) ·',
  '.k-kpi (> .k-label, .k-kpi-row > .k-value [+ .k-unit] + .k-delta k-delta-up|down|flat, then .k-ctx,',
  'optional <div class="k-spark">) · .k-chip (+ k-chip-accent|good|warn|danger|quiet, inner <i class="k-dot">) ·',
  '.k-list > .k-row (> .k-row-main > .k-row-t + .k-row-m, .k-row-side, .k-row-v) ·',
  '.k-table-wrap > table.k-table (put .k-num on BOTH the th and the td of a figure column) ·',
  '.k-bar-track > .k-bar-fill (inline width %) ·',
  '.k-empty · .k-foot · helpers .k-muted .k-strong .k-mono.',
  '',
  'CHARTS — call the kit, never hand-roll SVG and never inline a chart library:',
  '  Kit.bar(el, {labels, values, format?, colorByIndex?, height?})        // vertical magnitude',
  '  Kit.bar(el, {labels, series:[{name, values}], format?})               // …or 2-3 measures side by side',
  '  Kit.hbar(el, {labels, values, format?, colorByIndex?, labelWidth?})   // named categories (PREFER this for few categories)',
  '  Kit.line(el, {labels, series:[{name, values}], format?, height?})     // time / trend',
  '  Kit.donut(el, {items:[{label, value}], centerLabel?, format?})        // parts of ONE whole',
  '  Kit.spark(el, {values})                                              // trend inside a KPI tile',
  '  Kit.expand(headerEl, bodyEl)                                         // disclosure: a count carries its list',
  '  Kit.fmt(value, "int"|"pct"|"k"|"€"|"$")                              // thousands separators, tabular',
  'el is a CSS selector string or an element. format tokens: "int" · "pct" · "k" · a currency symbol.',
  'Charts render their own honest empty state when the data is empty — never fake a chart.',
  '',
  'THE CRAFT RULES (these are the deliverable\'s quality bar):',
  '· A NUMBER NEVER STANDS ALONE. Every KPI carries a context line (.k-ctx) saying what it is over',
  '  or how it compares, and/or its list behind Kit.expand. A bare figure is not a finding.',
  '· PICK THE CHART BY THE DATA\'S SHAPE: few named categories → Kit.hbar · a time sequence → Kit.line ·',
  '  parts of one whole (and only then) → Kit.donut · a trend beside a figure → Kit.spark. Never a',
  '  chart for two numbers — two numbers are two KPI tiles.',
  '· 3–5 KPI tiles at most, then sections. Lead with what the reader must know.',
  '· An empty section renders .k-empty with a plainly-said line ("No offers were extended this week."),',
  '  never a hidden section and never a zero pretending to be data.',
  '· The header carries the title AND a subtitle naming the data\'s scope/date; the footer carries',
  '  "Updated <date>" using the date in the material (never today\'s date if the material has its own).',
  '· ITEM LISTS ARE .k-list > .k-row (tasks, interviews, deals): the name in .k-row-t, its owner/date in',
  '  .k-row-m, a status as a .k-chip (k-chip-danger overdue · k-chip-warn at risk · k-chip-good on track)',
  '  in .k-row-side, a figure in .k-row-v. Reach for the kit before inventing a layout of your own.',
  '· NEVER name one of your own classes with a k- prefix — that namespace is the kit\'s, and a collision',
  '  silently rewrites the design system. Use plain names (e.g. class="panel-note") for anything extra.',
  '· The accent is set for you — use var(--k-accent) and the .k-s2…6 series vars if you need a colour;',
  '  never invent a palette.',
].join('\n');
