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
//   • THE SIZE FLOOR (Sep 1, found live on a ~25k-char table-heavy report): the contract makes
//     the model inline the material as a JSON literal AND render it as markup — table-heavy
//     source roughly DOUBLES on the way out, so the output hit the token cap, arrived without
//     its </html>, and the validator rejected it as "not one complete HTML document". The old
//     repair pass then re-sent the SAME material at the SAME cap and truncated identically.
//     Now the cap is READ (finish_reason 'length', or a body with no closing tag) and answered
//     with a COMPACTION retry: same contract, an explicit size instruction, and a structurally
//     reduced material (tables and headings kept verbatim, prose compressed) — never the same
//     ask twice. A retry that truncates again is an honest `too_large`.
//   • THE HONEST CAUSE — every exit says WHY, in the log and to the caller (FrameDiagnostics).
//     Four different failures used to collapse into one client sentence that named none of
//     them ("try a run with more tabular/structured output" — said to a run that was ALL
//     tables). Content shape is never guessed at; the recorded reason is the observed one.
//   • THE FRAME KIT — beauty is not an adjective in a prompt. Every generation is dressed BY
//     CODE with the house design system (lib/frames/kit.ts) at the ONE place a generation is
//     produced (`ask`), so the first pass and the repair pass are covered by construction and
//     nothing the model does can ship a frame without it. The prompt documents the kit's API so
//     the model COMPOSES with it instead of hand-rolling visuals.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocTheme } from '@/lib/documents/theme';
import { validateFrameHtml } from '@/lib/frames/validate-frame';
import { injectFrameKit, FRAME_KIT_REFERENCE } from '@/lib/frames/kit';

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

/** WHY a frame did not exist — the caller's honest error copy is derived from this, never from
 *  a guess about the material's shape. `null` return + no diagnostics = an unexpected path. */
export type FrameDeclineReason =
  /** No work to view (the thin-input floor) — refused before any AI spend. */
  | 'thin'
  /** The layout exceeded the output budget twice, compaction included. */
  | 'too_large'
  /** A complete document that the no-egress validator refused, repair included. */
  | 'validator'
  /** An outage, an empty completion, a thrown error — transient by nature. */
  | 'error';

export type FrameDiagnostics = { reason?: FrameDeclineReason; detail?: string };

const MAX_CONTENT = 24_000;
const MAX_CSV = 40_000;

/** THE OUTPUT BUDGET. Deliberately unchanged at the family's existing ceiling: the generation
 *  tier is Haiku 4.5 (lib/ai/defaults.ts — anthropic direct + eu.anthropic on Bedrock), whose
 *  model ceiling is far higher, but this is a NON-STREAMED call and every other in-repo site on
 *  this family sits well below it (execute-step's reasoning step 12k, meeting insights 8k, the
 *  Bedrock adapter's own default 4096) — 16k is already the highest cap we run non-streamed.
 *  Buying headroom by raising it trades a truncation risk for a request-timeout risk on a lane
 *  that already spends 60–150s across two passes. The size problem is answered by asking for
 *  LESS (the compaction retry), not by asking for more. */
const MAX_OUTPUT_TOKENS = 16_000;

/** Above this, a compaction retry also SHRINKS the material — a body that big is what pushed
 *  the first pass over the cap, so re-sending it whole would truncate identically. */
const COMPACT_SOURCE_OVER = 14_000;

/** THE THIN-INPUT FLOOR (severity-1 repair, Aug 25). A frame is a VIEW OF WORK; with no work to
 *  view, a generative lane fills the emptiness with invention — found live: an approval step's
 *  one-line marker became a ranked dashboard of eight fabricated people. This is CODE, not a
 *  prompt rule (the v3–v5 guardrails lesson: prompt-only enforcement of a floor coin-flips).
 *
 *  Substance is anything a frame could honestly render: tabular rows, code-computed facts, or a
 *  written deliverable of real length. 200 collapsed chars ≈ two or three sentences — the floor
 *  below which nothing that could carry a KPI tile, a series, or a table has been written, so a
 *  generation would necessarily be authored rather than presented.
 *  MARKER-SHAPED is structural too: one single line fully wrapped in brackets is the engine's own
 *  gate/marker grammar ("[Approved by the user — …]", "[Approved]"). The SHAPE is matched, never
 *  the wording — copy changes, the grammar does not. */
export const FRAME_MIN_CONTENT_CHARS = 200;

export function isThinFrameSource(
  args: { content?: string | null; csvText?: string | null; computedFacts?: string | null },
): boolean {
  if ((args.csvText ?? '').trim().length > 0) return false;
  if ((args.computedFacts ?? '').trim().length > 0) return false;
  const text = (args.content ?? '').trim();
  if (/^\[[^\n\]]*\]$/.test(text)) return true;            // a lone gate/marker line
  return text.replace(/\s+/g, ' ').trim().length < FRAME_MIN_CONTENT_CHARS;
}

/** The whole no-egress contract, said to the model in the same words the validator enforces. */
const FRAME_CONTRACT = [
  'THE OUTPUT: ONE complete, self-contained HTML document and nothing else — start at <html>, end at </html>. No prose, no explanation, no markdown fence.',
  '',
  'ZERO EGRESS (this is validated by code — a violation is rejected and the frame never exists):',
  '· No external URL anywhere: no http:, https:, protocol-relative //, ws:, wss: in any src/href/action/poster/srcset, in CSS url(), or in @import.',
  '· No <link>, no <iframe>/<object>/<embed>, no <meta http-equiv="refresh">, no <form action>.',
  '· No fetch(), XMLHttpRequest, WebSocket, EventSource, sendBeacon, import()/import statements.',
  '· No navigation: never assign to location, never call location.replace() or window.open().',
  '· No chart library, no CDN, no web font, no remote image. Charts are drawn by the injected kit (below) as inline SVG. System font stack only.',
  '',
  'THE CONTENT FLOOR (the one law above craft): the material below IS the content. You FORMAT and VISUALISE it — you never AUTHOR it. Every entity, name, person, organisation, date, label, category, ranking and number in the frame must appear in the material. Invent nothing: no example rows, no placeholder people, no illustrative figures, no "sample data", no filled-in blanks. If the material names one item, the frame shows one item — never a plausible list around it.',
  'HONEST ABSENCE: where the material has no value for something the layout would like, render it as plainly absent ("—", "not stated", or simply omit the tile/section). An empty section with an honest line is correct; a populated section with synthesised content is a fabrication.',
  'IF THE MATERIAL IS TOO THIN to fill a view, build the smaller, honest view it supports. Never pad.',
  'THE CHROME CARRIES NO INVENTED DATE: every date, time, year, period label, "as of" line and "last updated" stamp the frame displays — in the header, the footer, a tile, a caption or an axis — must either appear in the material or be THE PROVIDED TODAY stated below. Never derive a date, never infer one from context, never write a plausible year. When you are not sure what a date should be, omit the date entirely: a header or footer is complete without one.',
  'THE DATA (the truth floor): inline the material verbatim — as a JSON literal in an inline <script> and/or as rendered values. Never invent a number, never recompute a figure, never round or extrapolate. If a number is not in the material, it does not appear in the frame. When computed facts are given, they are AUTHORITATIVE — use them exactly as stated.',
  '',
  'INTERACTIVITY (read-only, over the inlined data only): tabs, filters, search, column sorting, chart hover/tooltips, collapsible sections. All state lives in the page. Nothing calls out, nothing writes back.',
  '',
  FRAME_KIT_REFERENCE,
  '',
  'CRAFT: a calm, dense, professional view built out of the kit — header, KPI tiles, then sections of cards, charts and dense rows. Responsive with no horizontal page scroll (tables scroll inside .k-table-wrap). Readable in a narrow iframe. Keep the whole file under 1.4MB.',
].join('\n');

/** THE CLOCK REACHES FRAME CHROME (Aug 25, found live): a generated frame's footer read
 *  "Updated 2024" — a year no material stated and nobody supplied, standing on a share-linkable
 *  surface. THE DATED-SOURCE LAW, in the same idiom executeAIStep's clock uses: A MODEL NEVER
 *  DERIVES A DATE. The date is code-supplied or it does not appear — the content floor held for
 *  candidate facts and leaked in decorative chrome, so the clock travels with the contract. */
function frameDateLine(now: Date = new Date()): string {
  return (
    `TODAY: ${now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}, ` +
    `${now.toISOString().slice(0, 10)} (UTC). This is the ONLY date you may write that is not ` +
    `already stated in the material.`
  );
}

/** THE COMPACTION ASK — said only on the retry that follows a truncated pass. It keeps THE
 *  CONTENT FLOOR intact (nothing may be invented to fill the space it frees): figures and tables
 *  survive verbatim, only prose is compressed. */
const COMPACTION_RULE = [
  'YOUR PREVIOUS OUTPUT EXCEEDED THE SIZE BUDGET and was cut off mid-document, so it could not be used.',
  'Produce the SAME view, smaller:',
  '· Keep every table row and every figure VERBATIM — they are the substance, and the content floor still forbids inventing or altering any of them.',
  '· Compress prose: turn long written sections into short summaries or a few bullet lines; drop repetition and restatement.',
  '· Prefer ONE data block inlined once over values repeated in both a script literal and the markup.',
  '· Keep the markup lean: fewer wrapper elements, no decorative sections, no long inline comments.',
  'Target well under the budget — a complete, smaller document is the only acceptable output; a richer one that stops mid-tag is worthless.',
].join('\n');

/** THE EGRESS REPAIR — the no-egress law outranks link preservation, said explicitly because the
 *  bare validator reasons ("inline every asset as a data: URI") left a model with real source
 *  URLs no legal move, and it kept re-emitting them (found live: a report carrying live links). */
const EGRESS_REPAIR_RULE = [
  'ABOUT THE LINKS: external URLs do not belong in a frame at all. Do NOT try to inline or replace them —',
  'render each link as PLAIN TEXT: keep the visible text exactly as it reads and drop the href entirely',
  '(<a href="https://…">Q3 report</a> becomes simply Q3 report). If a URL is itself the visible text, keep',
  'the text and make it non-linking. Losing a link is correct; a frame that can reach the network is not.',
].join(' ');

const LINKY = /(url|link|external|href|@import|egress|iframe|src\/href)/i;

export async function generateFrameHtml(
  client: SupabaseClient,
  userId: string,
  args: GenerateFrameArgs,
  /** THE HONEST CAUSE — the caller's out-param. Stamped on every declining exit. */
  diag?: FrameDiagnostics,
): Promise<GeneratedFrame | null> {
  const decline = (reason: FrameDeclineReason, detail: string): null => {
    if (diag) { diag.reason = reason; diag.detail = detail; }
    console.warn(`[frames] declined (${reason}): ${detail}`);
    return null;
  };
  try {
    // ── THE THIN-INPUT FLOOR — refuse BEFORE any AI spend. An honest null: the door falls
    // through to its document tiers and the user gets a plain, truthful deliverable. ──
    if (isThinFrameSource(args)) {
      return decline('thin', 'the source has no work to view (thin input)');
    }
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
      `ACCENT COLOR: ${accent} — already set for you as the kit's --k-accent (never load a logo or a font; do not restate the hex, use var(--k-accent)).`,
      args.theme?.brandName ? `BRAND NAME (text only): ${args.theme.brandName}` : null,
      args.theme?.footer ? `FOOTER LINE (text only): ${args.theme.footer}` : null,
    ].filter(Boolean).join('\n');

    const content = (args.content ?? '').slice(0, MAX_CONTENT);
    const buildMaterial = (deliverable: string, rows: string | null) => [
      `THE VIEW: ${title}`,
      request ? `WHAT THE USER ASKED FOR: ${request}` : null,
      '',
      brandLine,
      '',
      facts ? `COMPUTED FACTS (computed in code from the data — AUTHORITATIVE, use verbatim):\n${facts.slice(0, 6000)}` : null,
      rows ? `THE DATA (raw rows — inline these as the frame's JSON data block):\n${rows}` : null,
      `THE AUTHOR'S DELIVERABLE (the written work this view presents — its findings and wording are the source of truth):\n${deliverable}`,
    ].filter(Boolean).join('\n\n');

    // The material actually in play: a compaction retry REPLACES it, so a repair that follows
    // asks over the same reduced body — re-sending the full one would truncate all over again.
    let material = buildMaterial(content, csv);

    const { getAIClient, aiCreate } = await import('@/lib/ai/factory');
    const { client: ai, model } = await getAIClient(userId, 'generation', client);

    type Attempt = { html: string | null; truncated: boolean; finish: string; chars: number };

    const ask = async (opts: { instructions?: string; material: string }): Promise<Attempt> => {
      const res = await aiCreate(ai, {
        model, max_tokens: MAX_OUTPUT_TOKENS, temperature: 0.2,
        messages: [{
          role: 'user',
          content:
            `Build an interactive FRAME — a self-contained HTML view of the material below.\n\n` +
            `${FRAME_CONTRACT}\n\n${frameDateLine()}\n\n` +
            (opts.instructions ? `${opts.instructions}\n\n` : '') +
            `=== MATERIAL ===\n${opts.material}`,
        }],
      });
      const choice = res.choices?.[0];
      const finish = String(choice?.finish_reason ?? 'unknown');
      const body = (choice?.message?.content ?? '').trim();
      const raw = stripFence(body);
      // THE CAP IS READ, not inferred from the wreckage: 'length' is the OpenAI-compat name for
      // it on every provider we route through (the Bedrock adapter maps 'max_tokens' → 'length').
      // A body with no closing tag is the same event seen from the other side — some endpoints
      // report 'stop' on a cut stream, so the structural check stands beside the reported one.
      const truncated = !!body && (finish === 'length' || !/<\/html\s*>/i.test(raw));
      if (!raw) return { html: null, truncated: false, finish, chars: body.length };
      // THE KIT LANDS HERE — the ONE place a generation exists, so every pass is dressed by
      // construction, and it happens BEFORE validation (the kit is bound by law 2 like everything
      // else and is swept by the very next line of the caller).
      return { html: injectFrameKit(raw, accent), truncated, finish, chars: raw.length };
    };

    let compacted = false;
    let attempt = await ask({ material });
    if (!attempt.html) {
      return decline('error', `the model returned nothing (finish_reason=${attempt.finish})`);
    }

    // ── THE COMPACTION RETRY — the answer to a cap, in place of a repair pass that would ask
    // for exactly what did not fit. Reduce the material too when the body is what overflowed. ──
    if (attempt.truncated) {
      console.warn(
        `[frames] first pass hit the size budget (finish_reason=${attempt.finish}, ${attempt.chars} chars, no </html>) — compacting.`,
      );
      if (content.length > COMPACT_SOURCE_OVER) {
        material = buildMaterial(compactSource(content, COMPACT_SOURCE_OVER), csv);
      }
      compacted = true;
      attempt = await ask({ instructions: COMPACTION_RULE, material });
      if (!attempt.html) {
        return decline('error', `the compaction pass returned nothing (finish_reason=${attempt.finish})`);
      }
      if (attempt.truncated) {
        return decline(
          'too_large',
          `still over the size budget after compaction (finish_reason=${attempt.finish}, ${attempt.chars} chars)`,
        );
      }
    }

    let verdict = validateFrameHtml(attempt.html);
    if (!verdict.ok) {
      const first = verdict.reasons;
      console.warn('[frames] first pass rejected by the validator:', first.slice(0, 3));
      // THE EGRESS REPAIR: when the rejection is about links, the flattening rule rides along —
      // the reasons alone leave a model holding real URLs with no legal move.
      const repairAsk = [
        'YOUR PREVIOUS OUTPUT WAS REJECTED BY THE NO-EGRESS VALIDATOR. Fix every one of these and return the corrected complete document:',
        ...first.map((r) => `· ${r}`),
        ...(first.some((r) => LINKY.test(r)) ? ['', EGRESS_REPAIR_RULE] : []),
        // Once compacted, stay compacted — a repair is not permission to grow back.
        ...(compacted ? ['', COMPACTION_RULE] : []),
      ].join('\n');
      const repaired = await ask({ instructions: repairAsk, material });
      if (!repaired.html) {
        return decline('error', `the repair pass returned nothing (finish_reason=${repaired.finish})`);
      }
      // A repair that ran out of room is a SIZE failure, not a leak — say the true one.
      if (repaired.truncated) {
        return decline(
          'too_large',
          `the repair pass hit the size budget (finish_reason=${repaired.finish}, ${repaired.chars} chars)`,
        );
      }
      verdict = validateFrameHtml(repaired.html);
      // Still leaking → HONEST NULL. A leaky frame is worse than a plainer deliverable.
      if (!verdict.ok) {
        return decline(
          'validator',
          `rejected after repair — first: ${first.slice(0, 2).join(' | ')} — second: ${verdict.reasons.slice(0, 2).join(' | ')}`,
        );
      }
    }
    return { html: verdict.html, provenance: { computed } };
  } catch (e) {
    return decline('error', `generation threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** THE STRUCTURAL REDUCTION — what a compaction retry sends instead of the body that overflowed.
 *  Tables and headings are the frame's substance and survive VERBATIM (the content floor forbids
 *  the model recreating a dropped row); prose is what gets dropped, from the middle outward, so
 *  the opening framing and the closing findings both survive. If the structural lines alone still
 *  exceed the budget, fall back to the head+tail middle-cut idiom (formatPreviousOutputs' lesson:
 *  never head-truncate — the tail is the most load-bearing part). */
export function compactSource(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const ELIDED = '\n…[prose sections omitted for length — every table and figure above and below is intact]…\n';
  const lines = text.split('\n');
  // Structural = a markdown table row, a heading, or a short label line ending in a colon.
  const structural = lines.map((l) => /^\s*\|/.test(l) || /^\s*#{1,6}\s/.test(l) || /^\s*[^\s].{0,60}:\s*$/.test(l));
  const kept: Array<string | null> = lines.slice();
  let size = text.length;
  // Walk outward from the middle, dropping prose first — the two ends carry the framing.
  const mid = Math.floor(lines.length / 2);
  for (let step = 0; step < lines.length && size > budget; step += 1) {
    const i = step % 2 === 0 ? mid + Math.floor(step / 2) : mid - Math.ceil(step / 2);
    if (i < 0 || i >= lines.length) continue;
    if (structural[i] || kept[i] === null) continue;
    size -= (kept[i]?.length ?? 0) + 1;
    kept[i] = null;
  }
  const dropped = kept.some((l) => l === null);
  const out = kept.filter((l): l is string => l !== null).join('\n');
  if (out.length <= budget) return dropped ? `${out}\n${ELIDED}` : out;
  // Tables alone are over budget — middle-cut, never head-cut.
  return out.slice(0, Math.floor(budget * 0.55))
    + '\n…[middle of the material truncated for length — the start and the end are intact]…\n'
    + out.slice(-Math.floor(budget * 0.45));
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
