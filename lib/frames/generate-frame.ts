// ─── THE FRAME LANE (frames plan Phase 1, laws 2 + 3) ────────────────────────────────────────
// A frame is a deliverable you can look INTO: one self-contained interactive HTML view over real
// data. This module is the lane THE ONE PRODUCTION DOOR calls — it owns codegen + the floors,
// never storage, never artifact rows (the door's callers own identity).
//
// The floors it carries, in the door's own grammar:
//   • THE FACTS FLOOR — tabular material without precomputed facts gets computeDataFacts HERE,
//     exactly as the compiler tier does. `provenance.computed` is STRUCTURAL: true only when
//     computed facts actually rode the generation. Nobody claims it from prose.
//   • THE CONTENT FLOOR — the author's written deliverable + the computed facts ARE the data.
//     The model lays out, filters and charts; it never invents or recalculates a figure.
//   • THE LOCKED FRAME — validateFrameHtml decides whether the output may exist. One repair
//     pass carrying the reasons verbatim, then an HONEST NULL: the door falls through to its
//     lower tiers and the user still gets a deliverable (fail soft down the ladder).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocTheme } from '@/lib/documents/theme';
import { validateFrameHtml } from '@/lib/frames/validate-frame';

export type GenerateFrameArgs = {
  title: string;
  /** THE CONTENT FLOOR: the author's written deliverable — the frame's prose/source of truth. */
  content: string;
  /** The user's own words for the work — what the view is FOR. */
  request?: string | null;
  /** Tabular material the frame is over. */
  csvText?: string | null;
  /** Pre-computed sandbox facts (a caller's pre-pass); absent + csvText → computed here. */
  computedFacts?: string | null;
  /** Accent only ever travels as a hex — a logo URL would be egress. */
  theme?: DocTheme | null;
};

export type GeneratedFrame = { html: string; provenance: { computed: boolean } };

const MAX_CONTENT = 24_000;
const MAX_CSV = 40_000;

/** The whole no-egress contract, said to the model in the same words the validator enforces. */
const FRAME_CONTRACT = [
  'THE OUTPUT: ONE complete, self-contained HTML document and nothing else — start at <html>, end at </html>. No prose, no explanation, no markdown fence.',
  '',
  'ZERO EGRESS (this is validated by code — a violation is rejected and the frame never exists):',
  '· No external URL anywhere: no http:, https:, protocol-relative //, ws:, wss: in any src/href/action/poster/srcset, in CSS url(), or in @import.',
  '· No <link>, no <iframe>/<object>/<embed>, no <meta http-equiv="refresh">, no <form action>.',
  '· No fetch(), XMLHttpRequest, WebSocket, EventSource, sendBeacon, import()/import statements.',
  '· No navigation: never assign to location, never call location.replace() or window.open().',
  '· No chart library, no CDN, no web font, no remote image. Draw charts as hand-rolled inline SVG (bars, lines, donuts) — plain <svg> elements sized in the document. System font stack only.',
  '',
  'THE DATA (the truth floor): the material below IS the data. Inline it verbatim — as a JSON literal in an inline <script> and/or as rendered values. Never invent a number, never recompute a figure, never round or extrapolate. If a number is not in the material, it does not appear in the frame. When computed facts are given, they are AUTHORITATIVE — use them exactly as stated.',
  '',
  'INTERACTIVITY (read-only, over the inlined data only): tabs, filters, search, column sorting, chart hover/tooltips, collapsible sections. All state lives in the page. Nothing calls out, nothing writes back.',
  '',
  'CRAFT: a calm, dense, professional view — a clear title, a short lead line, KPI tiles where the data supports them, then tables/charts. Responsive with no horizontal page scroll (tables scroll inside their own container). Readable in a narrow iframe. Keep the whole file under 1.4MB.',
].join('\n');

export async function generateFrameHtml(
  client: SupabaseClient,
  userId: string,
  args: GenerateFrameArgs,
): Promise<GeneratedFrame | null> {
  try {
    const title = (args.title || 'Frame').slice(0, 120);
    const request = (args.request ?? '').slice(0, 800);
    const csv = args.csvText ? args.csvText.slice(0, MAX_CSV) : null;

    // ── THE FACTS FLOOR — the same computation the compiler tier runs, at the same door depth. ──
    let facts = args.computedFacts ?? null;
    if (!facts && csv) {
      try {
        const { computeDataFacts } = await import('@/lib/compute/data-facts');
        facts = await computeDataFacts(client, userId, { request: request || title, csvText: csv });
      } catch { facts = null; }
    }
    const computed = !!facts;

    const accent = args.theme?.accent ? `#${args.theme.accent.replace(/^#/, '')}` : '#4F46E5';
    const brandLine = [
      `ACCENT COLOR: ${accent} (use it for emphasis, chart series, and headings — never load a logo or a font).`,
      args.theme?.brandName ? `BRAND NAME (text only): ${args.theme.brandName}` : null,
      args.theme?.footer ? `FOOTER LINE (text only): ${args.theme.footer}` : null,
    ].filter(Boolean).join('\n');

    const material = [
      `THE VIEW: ${title}`,
      request ? `WHAT THE USER ASKED FOR: ${request}` : null,
      '',
      brandLine,
      '',
      facts ? `COMPUTED FACTS (computed in code from the data — AUTHORITATIVE, use verbatim):\n${facts.slice(0, 6000)}` : null,
      csv ? `THE DATA (raw rows — inline these as the frame's JSON data block):\n${csv}` : null,
      `THE AUTHOR'S DELIVERABLE (the written work this view presents — its findings and wording are the source of truth):\n${(args.content ?? '').slice(0, MAX_CONTENT)}`,
    ].filter(Boolean).join('\n\n');

    const { getAIClient, aiCreate } = await import('@/lib/ai/factory');
    const { client: ai, model } = await getAIClient(userId, 'generation', client);

    const ask = async (repairReasons?: string[]): Promise<string | null> => {
      const res = await aiCreate(ai, {
        model, max_tokens: 16000, temperature: 0.2,
        messages: [{
          role: 'user',
          content:
            `Build an interactive FRAME — a self-contained HTML view of the material below.\n\n` +
            `${FRAME_CONTRACT}\n\n` +
            (repairReasons?.length
              ? `YOUR PREVIOUS OUTPUT WAS REJECTED BY THE NO-EGRESS VALIDATOR. Fix every one of these and return the corrected complete document:\n` +
                repairReasons.map((r) => `· ${r}`).join('\n') + '\n\n'
              : '') +
            `=== MATERIAL ===\n${material}`,
        }],
      });
      return stripFence((res.choices?.[0]?.message?.content ?? '').trim()) || null;
    };

    let html = await ask();
    if (!html) return null;
    let verdict = validateFrameHtml(html);
    if (!verdict.ok) {
      const repaired = await ask(verdict.reasons);
      if (!repaired) return null;
      verdict = validateFrameHtml(repaired);
      // Still leaking → HONEST NULL. A leaky frame is worse than a plainer deliverable.
      if (!verdict.ok) {
        console.warn('[frames] generation rejected after repair:', verdict.reasons.slice(0, 3));
        return null;
      }
    }
    return { html: verdict.html, provenance: { computed } };
  } catch (e) {
    console.warn('[frames] generation failed (falling through to the document tiers):', e);
    return null;
  }
}

/** The model occasionally wraps the document in a fence despite the contract. */
function stripFence(s: string): string {
  const m = s.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
  const body = (m ? m[1] : s).trim();
  // Anything the model said before <html> or after </html> is not part of the document.
  const start = body.search(/<(?:!doctype|html)\b/i);
  const endM = body.match(/<\/html\s*>/i);
  if (start < 0 || !endM) return body;
  return body.slice(start, (endM.index ?? 0) + endM[0].length).trim();
}
