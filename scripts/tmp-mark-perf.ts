// Frame-path cost of the alive mark, measured against a recording stub: the JS half of the loop
// (noise field, silhouette, transforms) plus a count of the canvas calls each frame issues.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { makeSoftBodyDraw, makeMeshDraw } from '@/components/home/alive-mark';

function stub() {
  const counts: Record<string, number> = {};
  const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
  const grad = { addColorStop() {} };
  const ctx: any = {
    counts,
    clearRect: () => bump('clearRect'),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    beginPath: () => bump('beginPath'),
    moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    arc: () => {},
    fill: () => bump('fill'),
    stroke: () => bump('stroke'),
    fillRect: () => bump('fill'),
    setTransform: () => {}, scale: () => {}, translate: () => {}, save: () => {}, restore: () => {},
    clip: () => {},
  };
  return ctx;
}

function measure(label: string, draw: (t: number, e: number) => void, ctx: any) {
  for (let i = 0; i < 2000; i++) draw(i / 60, 0); // warm
  for (const k of Object.keys(ctx.counts)) delete ctx.counts[k];
  draw(3.3, 0);
  const perFrame = { ...ctx.counts };
  const N = 20000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) draw(i / 60, i % 2 ? 1 : 0);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6 / N;
  const drawCalls = (perFrame.fill ?? 0) + (perFrame.stroke ?? 0);
  console.log(`${label}: ${ms.toFixed(4)} ms/frame JS · ${drawCalls} draw calls/frame`, perFrame);
}

const a = stub();
measure('v4 soft body ', makeSoftBodyDraw(a, 70, 2), a);
const b = stub();
measure('v3 mesh      ', makeMeshDraw(b, 70), b);
