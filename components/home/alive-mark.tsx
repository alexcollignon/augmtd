'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ALIVE MARK — the one quiet sign that the machine is awake (owner walk, Sep 14: "we had a
// moving abstract neural thing that kind of made it feel it was alive next to the welcome and
// date, can we reinclude that?").
//
// ── v4 · THE SOFT BODY (owner walk, Sep 18 — THE CURRENT RENDER) ────────────────────────────────
// "feels like a disco ball… I just want something that feels or conveys 'it's alive'." The v3 mesh
// (kept below, reachable only by `variant="v3"`) was a GEODESIC read: a lat/long wireframe plus a
// scatter of glinting dots is, structurally, a mirror ball — the eye counts facets and reads a
// rotating object, not a living one. Rotation is the cheapest possible animation and the least
// alive; so is glitter.
//
// v4 keeps nothing of that geometry. It draws a SOFT-BODIED LUMINOUS FORM:
//   · THE MORPH IS THE LIFE — the silhouette is a closed blob whose radius is displaced by THREE
//     octaves of the same 3D value-noise field (reused verbatim — one noise implementation in this
//     file), sampled ON THE CIRCLE so the wrap is seamless and drifting through its own third
//     dimension in time. Nothing rotates. What the eye reads as movement is the body reshaping.
//   · THE LIGHT IS LAYERED, NOT DRAWN — no strokes, no nodes, no grid, no specks. A feathered body
//     gradient carries the silhouette, and TWO aurora fields plus a bright core drift slowly inside
//     it, composited ADDITIVELY ('lighter'), so the colour inside the form is never still even when
//     the shape is calm. Indigo → violet → a pale core (#6366f1 · #8b5cf6 · #c7d2fe).
//   · THE EDGE FEATHERS — every layer is painted through a canvas blur sized as a fraction of the
//     mark, so the rim is soft in every direction. There is no rim line to catch a highlight on,
//     which is exactly what a disco ball is made of.
//   · IT BREATHES — a slow global swell (~5.2s, ±3.5% of radius, with the brightness riding along).
//   · MICRO-LIFE — six barely-visible motes drift inward and are ABSORBED at the surface (their
//     alpha rises and returns to zero as they arrive). Subtle enough to miss; never glitter: they
//     are soft, additive, and they die at the skin rather than twinkling on it.
//
// v3 is preserved below, whole, behind `variant="v3"` — reverting the owner's call is a one-word
// change at the seat, and nothing about the lifecycle differs between the two.
//
// ── v3 · THE HISTORY THAT LED HERE (kept so the retired renderer still explains itself) ─────────
// THE MOTION IS THE SHAPE (third owner pass, Sep 15: "I'd like the animation to be more like
// shapeshifting and not so much just turning. also make it slightly bigger as well"). A spin is
// the cheapest possible way to look animated and the least alive: at rest the rotation is now a
// near-still drift (~0.045 rad/s — a revolution takes over two minutes) and the motion the eye
// actually reads is the SURFACE morphing, on three noise octaves whose amplitude itself breathes.
// The spin returns under loading energy, where "turning something over" is the right read. The
// default size went 56 → 70: slightly over the date+greeting column, which is what the owner asked
// for, and the bounded-halo arithmetic below was re-checked against it.
//
// DENSIFIED Sep 15 (second owner pass: "a bit more dense neural"): at 56px the old 7×16 grid read
// as a countable wireframe beach ball, and a single two-axis sine made a regular, mechanical
// swell. Both corrected in kind, not in degree:
//   · the mesh is now 24×48 (1152 vertices, 2304 segments) with hairline strokes, so the surface
//     reads as fine TEXTURE rather than a grid you can count;
//   · the swell is a real 3D VALUE-NOISE field (inlined below — no dependency; three.js is ~150KB
//     for a 56px mark), sampled at two octaves on the sphere normal and drifting slowly through
//     its own third dimension, so the silhouette is lumpy and irregular and never repeats on a
//     beat the eye can catch;
//   · a HALO of scattered dots sits OUTSIDE the surface on noise-jittered shells, orbiting slowly.
//
// WHAT v3 DRAWS (one small canvas, nothing else) — the retired disco read, kept for the revert:
//   · the unit sphere sampled as a lat/long MESH, its radius undulated by the noise field;
//   · the whole mesh rotating slowly about Y under a fixed X tilt, projected orthographically;
//   · every segment stroked with ONE canvas gradient (indigo → violet → fuchsia across the box),
//     batched into FOUR depth buckets so the far side reads faint and the near side reads bright —
//     four stroke calls per frame, not two thousand;
//   · NODES: a sparse scatter of the vertices dotted on the near half, in three alpha buckets;
//   · the HALO: dots outside the surface, in three alpha buckets;
//   · a soft CSS glow behind the canvas (static markup, zero per-frame cost).
//
// THE LOOP BUDGET — measured the way this file has always measured: by counting what the frame
// path does, and by timing the frame path itself against a recording stub (scripts/tmp-mark-perf.ts,
// Node, 20k frames at size 70).
//   · v4 · TEN draw calls per frame — 1 body fill, 2 aurora fills, 1 core fill, 6 mote fills — over
//     one 96-sample silhouette path. MEASURED JS COST: 0.0037 ms/frame (median of five runs; 3
//     noise octaves × 96 samples). v3 also ran ten draw calls, but over a 2,304-segment mesh:
//     MEASURED 0.062 ms/frame. v4 is ~17× cheaper on the JS half and far inside the ~0.1 ms/frame
//     budget this file has always held; what is left is ten small gradient fills in a 70px box.
//   · Both write into preallocated Float32Arrays only. No object, array or string is allocated in
//     the frame path: the gradients, the blur strings, the noise permutation table, the colours and
//     the index tables are all built ONCE (per variant, at effect scope or module scope).
// Device pixel ratio is CAPPED AT 2, so a 3× display never pays 9× the fill.
//
// FOUR FLOORS, all structural:
//   · NO LAYOUT SHIFT — a fixed-size box (w/h pinned, flex-shrink-0); the canvas fills it
//     absolutely, so nothing the mark does can move a word beside it.
//   · MOTION IS A REQUEST — `prefers-reduced-motion: reduce` draws exactly ONE STATIC FRAME and
//     never starts the loop at all (the mark stays, perfectly still: a reader who asked for less
//     motion still gets the brand, never a jitter). The CSS glow is stopped by the scoped rule.
//   · IT SLEEPS WHEN UNWATCHED — the loop runs only while the tab is VISIBLE and the mark is
//     actually IN VIEW (visibilitychange + IntersectionObserver); otherwise the rAF is cancelled
//     outright, so a backgrounded or scrolled-past Home costs nothing.
//   · ONE IMPLEMENTATION — the renderer is a PROP (`variant`, default 'v4'), never a second
//     component: one mount, one canvas, one rAF clock, one lifecycle, whichever form is drawn.
//     The loading state is a PROP on this component (`loading`), never a
//     second orb. While the brief loads the mark runs a little larger and more energetic; when
//     content lands it EASES back to rest (the energy is carried across the skeleton→page remount
//     at module level, so the landing is a smooth settle rather than a cut).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';

const CSS = `
@keyframes augAliveGlow{0%,100%{opacity:.42;transform:scale(1)}50%{opacity:.2;transform:scale(1.12)}}
/* IT SLEEPS WHEN UNWATCHED — one attribute pauses the whole mark. */
.aug-alive[data-asleep="true"] * { animation-play-state: paused !important; }
/* MOTION IS A REQUEST — the mark stays, the movement stops. */
@media (prefers-reduced-motion: reduce) { .aug-alive * { animation: none !important; } }
`;

// ── THE NOISE FIELD, BUILT ONCE (inline 3D value noise — no dependency, ~30 lines) ──────────────
// A deterministic permutation table (seeded LCG, so every mark on every load is the same shape),
// trilinear interpolation of hashed lattice values with a quintic fade. This is what makes the
// surface organically lumpy instead of a clean sine swell: two octaves of it, drifting.
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 1327217885; // fixed seed — the mark's shape is the same on every load
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) | 0;
    const j = ((seed >>> 8) & 0x7fffff) % (i + 1);
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
/** Hashed lattice value in [-1, 1]. */
function lat(xi: number, yi: number, zi: number) {
  return PERM[(PERM[(PERM[xi & 255] + yi) & 255] + zi) & 255] * (2 / 255) - 1;
}
/** 3D value noise, [-1, 1]. Allocation-free: pure arithmetic over the module-scope table. */
function vnoise(x: number, y: number, z: number) {
  const fx = Math.floor(x); const fy = Math.floor(y); const fz = Math.floor(z);
  const xi = fx & 255; const yi = fy & 255; const zi = fz & 255;
  const dx = x - fx; const dy = y - fy; const dz = z - fz;
  const u = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
  const v = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
  const w = dz * dz * dz * (dz * (dz * 6 - 15) + 10);
  const c000 = lat(xi, yi, zi); const c100 = lat(xi + 1, yi, zi);
  const c010 = lat(xi, yi + 1, zi); const c110 = lat(xi + 1, yi + 1, zi);
  const c001 = lat(xi, yi, zi + 1); const c101 = lat(xi + 1, yi, zi + 1);
  const c011 = lat(xi, yi + 1, zi + 1); const c111 = lat(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u; const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u; const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v; const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// v4 · THE SOFT BODY — the current render. A living silhouette, layered light, no geometry to read.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// The silhouette is sampled at a fixed set of angles, built ONCE. 96 samples at 70px puts each
// segment under two and a half pixels of arc — a polygon the eye cannot find, and the blur that
// feathers the rim finishes the job. The cosines and sines never change, so they are a table.
const SAMPLES = 96;
const SIL_C = new Float32Array(SAMPLES);
const SIL_S = new Float32Array(SAMPLES);
for (let i = 0; i < SAMPLES; i++) {
  const a = (i / SAMPLES) * Math.PI * 2;
  SIL_C[i] = Math.cos(a);
  SIL_S[i] = Math.sin(a);
}
/** Per-frame silhouette scratch — preallocated, never reallocated. */
const SIL_X = new Float32Array(SAMPLES);
const SIL_Y = new Float32Array(SAMPLES);

// THE MOTES — six of them, each with its own angle, pace and phase, all deterministic (drawn from
// the same seeded field as everything else, so the mark is identical on every load).
const NM = 6;
const MOTE_A = new Float32Array(NM);   // the bearing it arrives on
const MOTE_SPD = new Float32Array(NM); // laps per second of its inward drift
const MOTE_PH = new Float32Array(NM);  // where in that drift it starts
const MOTE_SZ = new Float32Array(NM);
for (let i = 0; i < NM; i++) {
  MOTE_A[i] = (vnoise(i * 1.7, 4.3, 0.9) * 0.5 + 0.5) * Math.PI * 2;
  MOTE_SPD[i] = 0.075 + 0.055 * (vnoise(i * 0.83, 2.2, 5.6) * 0.5 + 0.5);
  MOTE_PH[i] = vnoise(i * 2.9, 7.7, 1.4) * 0.5 + 0.5;
  MOTE_SZ[i] = 0.55 + 0.5 * (vnoise(i * 1.13, 9.1, 3.3) * 0.5 + 0.5);
}
/** The motes are one soft colour, additive — never a palette of sparks. */
const MOTE_RGB = 'rgba(199,210,254,1)';

/** THE BREATH — one slow swell, ~5.2s, carried by both the radius and the brightness. */
const BREATH_PERIOD = 5.2;

/**
 * Build v4's frame painter for one canvas at one size. Everything that can be built once — the
 * gradients, the blur strings, the geometry constants — is built HERE, so the returned function
 * allocates nothing at all.
 */
export function makeSoftBodyDraw(ctx: CanvasRenderingContext2D, size: number, dpr: number) {
  const cx = size / 2;
  const cy = size / 2;
  // The body sits short of the box so the feather and the motes have room: the silhouette peaks at
  // baseR × (1 + amp) ≈ 0.34 × 1.26 ≈ 0.43 of the box, the motes arrive from 1.38 × baseR ≈ 0.47,
  // and the blur spreads a couple of pixels past that. It fits at every size by construction —
  // every term below is a fraction of `size`.
  const baseR = size * 0.34;

  // THE BODY — a feathered radial fill that IS the silhouette's light. Its outer stop is low
  // enough that, once blurred, the rim dissolves instead of drawing itself.
  // NOT A BULLS-EYE: the centre is only slightly lighter than the skin, so the form reads as a
  // BODY with a silhouette rather than a lamp with a halo. What varies inside it is the aurora,
  // which drifts; a fixed bright centre would be the one thing on the mark that never moves.
  const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.28);
  body.addColorStop(0, 'rgba(147,157,250,0.78)');
  body.addColorStop(0.45, 'rgba(124,90,240,0.76)');
  body.addColorStop(0.82, 'rgba(99,102,241,0.62)');
  body.addColorStop(1, 'rgba(79,70,229,0.10)');

  // THE AURORA — two colour fields, built at the ORIGIN and moved by translating the canvas, so
  // no gradient is ever constructed inside the frame path. They stay well inside the silhouette
  // (their reach plus their drift is under the body's own radius), so they never meet the rim.
  const auroraR = size * 0.28;
  const auroraA = ctx.createRadialGradient(0, 0, 0, 0, 0, auroraR);
  auroraA.addColorStop(0, 'rgba(56,96,255,0.72)');
  auroraA.addColorStop(1, 'rgba(56,96,255,0)');
  const auroraB = ctx.createRadialGradient(0, 0, 0, 0, 0, auroraR);
  auroraB.addColorStop(0, 'rgba(186,116,255,0.66)');
  auroraB.addColorStop(1, 'rgba(186,116,255,0)');
  // THE CORE — a WANDERING warm middle, not a bulb bolted to the centre: it is dim enough that the
  // silhouette keeps the eye, and it drifts, so nothing on the mark is ever pinned.
  const coreR = size * 0.15;
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
  core.addColorStop(0, 'rgba(214,223,255,0.44)');
  core.addColorStop(0.55, 'rgba(199,210,254,0.20)');
  core.addColorStop(1, 'rgba(199,210,254,0)');

  // THE FEATHER — blurs as a fraction of the mark, so a bigger mark is softer in proportion and
  // never turns crisp. Built as strings ONCE: assigning them per frame allocates nothing.
  const BLUR_BODY = `blur(${(size * 0.022).toFixed(2)}px)`;
  const BLUR_LIGHT = `blur(${(size * 0.075).toFixed(2)}px)`;
  const BLUR_MOTE = `blur(${(size * 0.022).toFixed(2)}px)`;

  /** Move the canvas origin (the gradients are built AT the origin, so this is how they drift).
   *  ONE setTransform call carrying the DPR — never a scale/translate pair, never a save/restore
   *  stack, and never a new gradient. */
  const at = (x: number, y: number) => ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);

  return function drawSoftBody(t: number, energy: number) {
    ctx.clearRect(0, 0, size, size);

    // IT BREATHES — one slow swell in the radius, and the same swell in the brightness.
    const breath = Math.sin((t / BREATH_PERIOD) * Math.PI * 2);
    const R = baseR * (1 + 0.035 * breath + 0.055 * energy);
    const gain = (0.94 + 0.06 * breath) * (1 + 0.28 * energy);

    // THE MORPH IS THE LIFE — three octaves of the noise field on the circle, each drifting through
    // its own third dimension at its own pace: slow lobes that grow and dissolve, the mid swell
    // that carries the silhouette, and a fine travelling detail. The amplitude itself breathes on a
    // slower noise, so the deformation swells and calms rather than running at one intensity —
    // the difference between alive and cyclic. Nothing rotates; the shape is the motion.
    const amp = (0.26 + 0.08 * energy) * (1 + 0.30 * vnoise(t * 0.07 + 31.7, 5.2, 12.9));
    const z1 = t * 0.155 + 11.0;
    const z2 = t * 0.235 + 3.0;
    const z3 = t * 0.085 + 21.0;
    for (let i = 0; i < SAMPLES; i++) {
      const c = SIL_C[i];
      const s = SIL_S[i];
      const n1 = vnoise(c * 1.35 + 5.1, s * 1.35 + 2.7, z1);
      const n2 = vnoise(c * 2.90 + 1.3, s * 2.90 + 8.4, z2);
      const n3 = vnoise(c * 0.70 + 14.2, s * 0.70 + 6.1, z3);
      const rr = R * (1 + amp * (0.50 * n3 + 0.36 * n1 + 0.14 * n2));
      SIL_X[i] = cx + c * rr;
      SIL_Y[i] = cy + s * rr;
    }

    // 1 · THE BODY. One path, one fill, feathered — no stroke, so there is no rim to glint on.
    ctx.filter = BLUR_BODY;
    ctx.globalAlpha = Math.min(1, gain);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(SIL_X[0], SIL_Y[0]);
    for (let i = 1; i < SAMPLES; i++) ctx.lineTo(SIL_X[i], SIL_Y[i]);
    ctx.closePath();
    ctx.fill();

    // 2 · THE AURORA + THE CORE, composited ADDITIVELY toward the middle. Each is the same gradient
    // object moved under the canvas transform — drifting light inside a body that is itself moving.
    ctx.filter = BLUR_LIGHT;
    ctx.globalCompositeOperation = 'lighter';
    const drift = 1 + 0.35 * energy;
    ctx.globalAlpha = Math.min(1, 0.85 * gain);
    ctx.fillStyle = auroraA;
    at(cx + Math.cos(t * 0.23 * drift) * R * 0.34, cy + Math.sin(t * 0.31 * drift + 1.2) * R * 0.28);
    ctx.fillRect(-auroraR, -auroraR, auroraR * 2, auroraR * 2);
    ctx.fillStyle = auroraB;
    at(cx + Math.cos(-t * 0.19 * drift + 2.4) * R * 0.37, cy + Math.sin(t * 0.26 * drift + 3.1) * R * 0.31);
    ctx.fillRect(-auroraR, -auroraR, auroraR * 2, auroraR * 2);
    ctx.globalAlpha = Math.min(1, gain);
    ctx.fillStyle = core;
    at(cx + Math.cos(t * 0.11 + 5.0) * R * 0.30, cy + Math.sin(t * 0.14 + 0.6) * R * 0.26);
    ctx.fillRect(-coreR, -coreR, coreR * 2, coreR * 2);
    at(0, 0); // back to the canvas's own origin for everything that follows

    // 3 · MICRO-LIFE — motes drift IN and are ABSORBED at the skin: the alpha rises from nothing and
    // returns to nothing exactly as they arrive, so nothing ever twinkles ON the surface.
    ctx.filter = BLUR_MOTE;
    ctx.fillStyle = MOTE_RGB;
    for (let m = 0; m < NM; m++) {
      const u = (t * MOTE_SPD[m] + MOTE_PH[m]) % 1;
      const a = MOTE_A[m] + t * 0.045;
      const rr = R * (1.40 - 0.42 * u);
      const alpha = Math.sin(Math.PI * u) * 0.42 * gain;
      if (alpha <= 0.004) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      const dot = MOTE_SZ[m] * size * 0.017;
      ctx.beginPath();
      ctx.moveTo(px + dot, py);
      ctx.arc(px, py, dot, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// v3 · THE MESH SPHERE — RETIRED as the default (the disco read). Kept whole, reachable only by an
// explicit `variant="v3"`, so restoring it is one word at the seat and nothing else.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// ── THE MESH, BUILT ONCE (module scope — every mark on the page shares these tables) ────────────
const RINGS = 24;
const SEG = 48;
// …plus the two POLES. Without them the rings stop short of the axis and the surface reads with a
// white eye punched through it at top and bottom — every longitude has to close on a point.
const NV = RINGS * SEG + 2;
const NORTH = RINGS * SEG;
const SOUTH = RINGS * SEG + 1;
const BASE_X = new Float32Array(NV);
const BASE_Y = new Float32Array(NV);
const BASE_Z = new Float32Array(NV);
for (let r = 0; r < RINGS; r++) {
  const phi = ((r + 1) / (RINGS + 1)) * Math.PI;
  for (let s = 0; s < SEG; s++) {
    const theta = (s / SEG) * Math.PI * 2;
    const i = r * SEG + s;
    BASE_X[i] = Math.sin(phi) * Math.cos(theta);
    BASE_Y[i] = Math.cos(phi);
    BASE_Z[i] = Math.sin(phi) * Math.sin(theta);
  }
}
BASE_X[NORTH] = 0; BASE_Y[NORTH] = 1; BASE_Z[NORTH] = 0;
BASE_X[SOUTH] = 0; BASE_Y[SOUTH] = -1; BASE_Z[SOUTH] = 0;
// Segment index pairs: every ring closed around, every longitude laddered pole to pole.
const SEGS: number[] = [];
for (let r = 0; r < RINGS; r++) {
  for (let s = 0; s < SEG; s++) { SEGS.push(r * SEG + s, r * SEG + ((s + 1) % SEG)); }
}
for (let s = 0; s < SEG; s++) {
  SEGS.push(NORTH, s);
  for (let r = 0; r < RINGS - 1; r++) { SEGS.push(r * SEG + s, (r + 1) * SEG + s); }
  SEGS.push((RINGS - 1) * SEG + s, SOUTH);
}
const EDGES = new Int16Array(SEGS);
const NE = EDGES.length / 2;

// NODES — a deterministic sparse scatter of the vertices (never every nth, which reads as a stripe).
const NODES: number[] = [];
for (let i = 0; i < NV; i++) { if (((PERM[i & 511] * 31 + i * 7) & 15) === 3) NODES.push(i); }
const NODE_IDX = new Int16Array(NODES);
const NN = NODE_IDX.length;

// ── THE HALO, BUILT ONCE — dots scattered OUTSIDE the surface on noise-jittered shells ──────────
const NH = 58;
const HX = new Float32Array(NH);
const HY = new Float32Array(NH);
const HZ = new Float32Array(NH);
const HSPD = new Float32Array(NH);
const HSZ = new Float32Array(NH);
{
  // Fibonacci sphere + a per-dot shell radius between 1.05 and 1.35 — a halo, never a second shell.
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < NH; i++) {
    const y = 1 - (i / (NH - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const a = ga * i;
    const jx = Math.cos(a) * rad; const jz = Math.sin(a) * rad;
    // The shell band is bounded so that even the outermost dot, at full loading energy, still
    // lands INSIDE the canvas box — a halo that clips at the edge reads as a cropped picture.
    const shell = 1.14 + 0.16 * (vnoise(jx * 3.1 + 11, y * 3.1 + 5, jz * 3.1 + 2) * 0.5 + 0.5);
    HX[i] = jx * shell; HY[i] = y * shell; HZ[i] = jz * shell;
    HSPD[i] = 0.55 + 0.9 * (vnoise(i * 0.37, 3.2, 7.1) * 0.5 + 0.5);
    HSZ[i] = 0.46 + 0.5 * (vnoise(i * 0.61, 1.4, 9.3) * 0.5 + 0.5);
  }
}

// Per-frame scratch — preallocated, never reallocated.
const PX = new Float32Array(NV);
const PY = new Float32Array(NV);
const PZ = new Float32Array(NV);
const HPX = new Float32Array(NH);
const HPY = new Float32Array(NH);
const HPZ = new Float32Array(NH);

const TILT = 0.34;
const TILT_C = Math.cos(TILT);
const TILT_S = Math.sin(TILT);
// Far → near. Denser mesh means more total ink, so each line is fainter than the coarse grid's.
const BUCKET_ALPHA = [0.07, 0.15, 0.33, 0.74];
const NODE_ALPHA = [0.32, 0.6, 0.95];
const HALO_ALPHA = [0.2, 0.42, 0.72];

/** Build v3's frame painter (the retired mesh). Same contract as v4's: everything built once here,
 *  nothing allocated in the returned function. */
export function makeMeshDraw(ctx: CanvasRenderingContext2D, size: number) {
    // ONE gradient, built once: indigo → violet → fuchsia across the box. Saturated deliberately —
    // at 56px a pastel mesh averages out to grey, so the hue has to carry at hairline weights.
    const grad = ctx.createLinearGradient(0, size, size, 0);
    grad.addColorStop(0, '#2563eb');
    grad.addColorStop(0.3, '#4f46e5');
    grad.addColorStop(0.56, '#7c3aed');
    grad.addColorStop(0.8, '#c026d3');
    grad.addColorStop(1, '#ec4899');

    const cx = size / 2;
    const cy = size / 2;
    // The sphere is deliberately short of the box: the outer band belongs to the halo. THE HALO
    // BOUND, at the default 70 and full loading energy: R = 23.1 × 1.04 = 24.0; the deformed
    // surface peaks at 1.36 R = 32.7 and the outermost halo shell at 1.30 R = 31.2, plus a ~1.1px
    // dot = 32.3 — both inside 35, half the box. It fits by construction at every size, since
    // every term here is a fraction of `size`.
    const baseR = size * 0.33;
    /** Dots are sized in the 56px design unit; they grow sub-linearly so a larger mark keeps the
     *  same fine-mesh reading instead of turning into a ball of beads. */
    const ds = Math.sqrt(size / 56);
    // Hairline strokes: at DPR 2 this lands just under one device pixel, which is what turns a
    // countable grid into texture. Never scaled with `size` — density is the point, not weight.
    const line = 0.42;

    return function drawMesh(t: number, energy: number) {
      ctx.clearRect(0, 0, size, size);
      const R = baseR * (1 + 0.04 * energy);
      // THE MOTION IS THE SHAPE, NOT THE SPIN (owner, Sep 15: "more like shapeshifting and not so
      // much just turning"). At rest the sphere turns at ~0.045 rad/s — one revolution in over two
      // minutes, barely perceptible — and everything the eye reads as movement is the SURFACE
      // morphing. Under loading energy the spin comes back, because a "working" mark should look
      // like it is turning something over.
      const rot = t * (0.045 + 0.3 * energy);
      const rc = Math.cos(rot);
      const rs = Math.sin(rot);
      // THE UNDULATION — THREE octaves of the 3D noise field, each drifting through its own third
      // dimension at its own speed: slow lobes that grow and dissolve (n3), the mid swell that
      // carries the silhouette (n1), and fast travelling detail (n2). Sampled on the sphere
      // normal, so it is seamless at the wrap and lumpy everywhere. The weights sum to 1, so `amp`
      // stays an honest bound on the radial deviation.
      // …and the amplitude itself BREATHES on a slow noise, so the deformation swells and calms
      // instead of running at one constant intensity — the difference between alive and cyclic.
      const amp = (0.2 + 0.045 * energy)
        * (1 + 0.35 * vnoise(t * 0.085 + 31.7, 5.2, 12.9));
      const d1 = t * 0.34;
      const d2 = t * -0.46;
      const d3 = t * 0.22;

      for (let i = 0; i < NV; i++) {
        const bx = BASE_X[i]; const by = BASE_Y[i]; const bz = BASE_Z[i];
        const n1 = vnoise(bx * 1.9 + 8.3, by * 1.9 + d1, bz * 1.9 + 4.7);
        const n2 = vnoise(bx * 4.3 + d2, by * 4.3 + 2.1, bz * 4.3 + 6.5);
        const n3 = vnoise(bx * 0.85 + 19.4, by * 0.85 + 3.6, bz * 0.85 + d3);
        const rr = 1 + amp * (0.5 * n1 + 0.14 * n2 + 0.46 * n3);
        const x0 = bx * rr;
        const y0 = by * rr;
        const z0 = bz * rr;
        const x1 = x0 * rc + z0 * rs;
        const z1 = -x0 * rs + z0 * rc;
        PX[i] = cx + x1 * R;
        PY[i] = cy + (y0 * TILT_C - z1 * TILT_S) * R;
        PZ[i] = y0 * TILT_S + z1 * TILT_C;
      }

      ctx.strokeStyle = grad;
      ctx.lineWidth = line;
      const gain = 0.85 + 0.35 * energy;
      // FOUR DEPTH BUCKETS, four stroke calls — the far side faint, the near side bright. This is
      // the whole frame budget: the bucketing is what lets the mesh be dense at all.
      for (let b = 0; b < 4; b++) {
        ctx.globalAlpha = Math.min(1, BUCKET_ALPHA[b] * gain);
        ctx.beginPath();
        for (let e = 0; e < NE; e++) {
          const a = EDGES[e * 2];
          const c = EDGES[e * 2 + 1];
          const d = (PZ[a] + PZ[c]) * 0.5;
          let bk = ((d + 1) * 2) | 0;
          if (bk > 3) bk = 3; else if (bk < 0) bk = 0;
          if (bk !== b) continue;
          ctx.moveTo(PX[a], PY[a]);
          ctx.lineTo(PX[c], PY[c]);
        }
        ctx.stroke();
      }

      // THE NODES — a sparse scatter on the near half, three alpha buckets, three fill calls.
      ctx.fillStyle = grad;
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = Math.min(1, NODE_ALPHA[b] * gain);
        ctx.beginPath();
        for (let n = 0; n < NN; n++) {
          const i = NODE_IDX[n];
          const z = PZ[i];
          if (z < 0.08) continue;
          let bk = (z * 3) | 0; if (bk > 2) bk = 2;
          if (bk !== b) continue;
          const rr = (0.36 + 0.44 * z) * ds;
          ctx.moveTo(PX[i] + rr, PY[i]);
          ctx.arc(PX[i], PY[i], rr, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // THE HALO — dots outside the surface, orbiting on their own shells at their own speeds.
      // Their orbit has its OWN time base, not the mesh's rotation: now that the sphere barely
      // turns at rest, a halo tied to `rot` would hang frozen in the air.
      const ha = t * 0.16;
      for (let h = 0; h < NH; h++) {
        const a = rot + ha * HSPD[h];
        const ca = Math.cos(a); const sa = Math.sin(a);
        const ox = HX[h] * ca + HZ[h] * sa;
        const oz = -HX[h] * sa + HZ[h] * ca;
        const oy = HY[h];
        HPX[h] = cx + ox * R;
        HPY[h] = cy + (oy * TILT_C - oz * TILT_S) * R;
        HPZ[h] = oy * TILT_S + oz * TILT_C;
      }
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = Math.min(1, HALO_ALPHA[b] * gain);
        ctx.beginPath();
        for (let h = 0; h < NH; h++) {
          const z = HPZ[h];
          let bk = ((z + 1.4) * 1.07) | 0; if (bk > 2) bk = 2; else if (bk < 0) bk = 0;
          if (bk !== b) continue;
          const rr = HSZ[h] * (0.7 + 0.45 * (z + 1) * 0.5) * ds;
          ctx.moveTo(HPX[h] + rr, HPY[h]);
          ctx.arc(HPX[h], HPY[h], rr, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE COMPONENT — one mount, one canvas, one rAF clock, one lifecycle, whichever form is drawn.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The renderer. 'v4' is the soft body (the owner's Sep 18 call); 'v3' is the retired mesh. */
export type AliveMarkVariant = 'v4' | 'v3';

/** The energy carried ACROSS the skeleton→page remount, so the landing eases instead of cutting. */
let carriedEnergy = 0;

/** The abstract living mark. Purely decorative — `aria-hidden`, never a control, never a claim. */
export function AliveMark({ size = 70, loading = false, variant = 'v4', className = '' }: {
  size?: number;
  /** The brief is still loading → the mark runs larger and more energetic, then eases to rest. */
  loading?: boolean;
  /** THE RENDER, by name. Defaults to the soft body; 'v3' is the retired mesh, EXPLICIT ONLY. */
  variant?: AliveMarkVariant;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // DPR CAPPED AT 2 — a 3× display never pays 9× the fill.
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);

    // ONE painter, chosen once, outside the frame path.
    const draw = variant === 'v3' ? makeMeshDraw(ctx, size) : makeSoftBodyDraw(ctx, size, dpr);

    // MOTION IS A REQUEST — one static frame, and the loop is never started.
    const reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduced) { draw(0, loadingRef.current ? 1 : 0); return; }

    let raf = 0;
    let t = 0;
    let last = 0;
    let energy = carriedEnergy;
    let visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    let onScreen = true;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      t += dt;
      const target = loadingRef.current ? 1 : 0;
      energy += (target - energy) * Math.min(1, dt * 3.2); // ease to rest on landing
      if (Math.abs(target - energy) < 0.002) energy = target;
      carriedEnergy = energy;
      draw(t, energy);
    };
    const sync = () => {
      const run = visible && onScreen;
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    };
    const onVis = () => { visible = document.visibilityState !== 'hidden'; host.dataset.asleep = visible ? 'false' : 'true'; sync(); };
    document.addEventListener('visibilitychange', onVis);
    // IT SLEEPS WHEN UNWATCHED — scrolled out of view is as quiet as a hidden tab.
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => { onScreen = entries[0]?.isIntersecting ?? true; sync(); });
      io.observe(host);
    }
    onVis();
    sync();
    draw(0, energy); // paint immediately, before the first rAF tick

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, [size, variant]);

  return (
    <span
      ref={hostRef}
      aria-hidden="true"
      data-asleep="false"
      className={`aug-alive relative inline-block flex-shrink-0 align-middle ${className}`}
      style={{ width: size, height: size }}
    >
      <style>{CSS}</style>
      {/* THE HALO — still the right chrome for a luminous body, retuned to v4's own family (the
          magenta belonged to the mesh's gradient). Static markup, CSS-driven, zero per-frame cost. */}
      <span
        className={`absolute -inset-1 rounded-full blur-[7px] ${variant === 'v3'
          ? 'bg-[radial-gradient(circle,rgba(99,102,241,0.42),rgba(217,70,239,0.16)_55%,transparent_72%)]'
          : 'bg-[radial-gradient(circle,rgba(129,140,248,0.38),rgba(139,92,246,0.18)_55%,transparent_74%)]'}`}
        style={{ animation: 'augAliveGlow 7s ease-in-out infinite' }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ width: size, height: size }} />
    </span>
  );
}
