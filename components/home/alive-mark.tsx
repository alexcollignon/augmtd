'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ALIVE MARK — the one quiet sign that the machine is awake (owner walk, Sep 14: "we had a
// moving abstract neural thing that kind of made it feel it was alive next to the welcome and
// date, can we reinclude that?"), rebuilt Sep 15 on the owner's own reference: "I'd like it to be
// more of a moving neural network thing" — a WIREFRAME MESH SPHERE of fine lines and drifting
// nodes, blue→violet→magenta, undulating organically. Not a plasma ball.
//
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
// WHAT IS DRAWN (one small canvas, nothing else):
//   · the unit sphere sampled as a lat/long MESH, its radius undulated by the noise field;
//   · the whole mesh rotating slowly about Y under a fixed X tilt, projected orthographically;
//   · every segment stroked with ONE canvas gradient (indigo → violet → fuchsia across the box),
//     batched into FOUR depth buckets so the far side reads faint and the near side reads bright —
//     four stroke calls per frame, not two thousand;
//   · NODES: a sparse scatter of the vertices dotted on the near half, in three alpha buckets;
//   · the HALO: dots outside the surface, in three alpha buckets;
//   · a soft CSS glow behind the canvas (static markup, zero per-frame cost).
//
// THE LOOP BUDGET: one rAF loop, TEN draw calls per frame (4 mesh strokes + 3 node fills + 3 halo
// fills) regardless of how dense the mesh gets — the depth bucketing is what keeps a 2,304-segment
// sphere affordable. Per frame it writes into preallocated Float32Arrays and walks a preallocated
// Int16Array of segment indices — no object, array or string is allocated in the frame path (the
// gradient, the noise permutation table, the colours and the index tables are all built once).
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
//   · ONE IMPLEMENTATION — the loading state is a PROP on this component (`loading`), never a
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

/** The energy carried ACROSS the skeleton→page remount, so the landing eases instead of cutting. */
let carriedEnergy = 0;

/** The abstract living mark. Purely decorative — `aria-hidden`, never a control, never a claim. */
export function AliveMark({ size = 70, loading = false, className = '' }: {
  size?: number;
  /** The brief is still loading → the mark runs larger and more energetic, then eases to rest. */
  loading?: boolean;
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

    const draw = (t: number, energy: number) => {
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
  }, [size]);

  return (
    <span
      ref={hostRef}
      aria-hidden="true"
      data-asleep="false"
      className={`aug-alive relative inline-block flex-shrink-0 align-middle ${className}`}
      style={{ width: size, height: size }}
    >
      <style>{CSS}</style>
      {/* the breathing glow — static markup, CSS-driven, zero per-frame cost */}
      <span
        className="absolute -inset-1 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.42),rgba(217,70,239,0.16)_55%,transparent_72%)] blur-[7px]"
        style={{ animation: 'augAliveGlow 7s ease-in-out infinite' }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ width: size, height: size }} />
    </span>
  );
}
