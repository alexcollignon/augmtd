/**
 * General, reusable cleanup for open commitments — GENERAL and DRY-RUN by default.
 *
 * For a given user it:
 *   1. Dedups near-identical open commitments (same obligation, general token-overlap — no text
 *      special-casing), keeping the OLDEST row and marking later duplicates 'dismissed'.
 *   2. Clears due_dates that can't be traced to the commitment's source (the source text does not
 *      contain a date the commitment could have come from) — i.e. fabricated deadlines → null.
 *
 * Agnostic: no hardcoded user ids, meeting ids, sender names, or descriptions. Works for any user.
 *
 * DRY-RUN by default: prints exactly what it WOULD change and touches nothing. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/dedup-commitments.ts <userId>              # dry-run (default)
 *   npx tsx scripts/dedup-commitments.ts <userId> --apply      # actually update rows
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Same near-duplicate logic as the extractor / display backstop (kept self-contained here so the
// script has no app-import coupling). Token-overlap over content words — language/text agnostic.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'by', 'from', 'up',
  'out', 'over', 'about', 'into', 'as', 'is', 'be', 'will', 'would', 'should', 'need', 'needs',
  'please', 'get', 'send', 'this', 'that', 'it', 'them', 'me', 'you', 'we', 'i', 'he', 'she', 'they',
]);
const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function tokens(s: string): Set<string> {
  return new Set(norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t)));
}
function sameObligation(a: string, b: string, threshold = 0.6): boolean {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  if (na && nb && (na.includes(nb) || nb.includes(na))) return true;
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= threshold;
}

// Does the source text plausibly STATE this due_date (or the relative form it resolves to)? We can only
// verify against the raw source text we have (meeting transcript / email body). If the exact ISO date,
// or any concrete date/deadline token, is absent from the source, the due_date is untraceable → treat
// as fabricated. Conservative: if we CANNOT load the source, we DON'T clear (never destroy on a guess).
const DATE_HINT = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}|deadline|due |by (mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|eod|cob|end of|next week|this week|end of day|end of week|noon|midnight)|by the end|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

async function loadSourceText(c: { source: string; source_id: string | null; thread_id: string | null; user_id: string }): Promise<string | null> {
  try {
    if (c.source === 'meeting' && c.source_id) {
      const { data } = await supabase.from('meeting_transcripts')
        .select('transcript, summary, title').eq('id', c.source_id).maybeSingle();
      if (!data) return null;
      return [data.title, data.summary, data.transcript].filter(Boolean).join('\n');
    }
    if (c.source === 'email') {
      // Prefer the whole thread; fall back to the single source email.
      if (c.thread_id) {
        const { data } = await supabase.from('emails')
          .select('subject, body').eq('user_id', c.user_id).eq('thread_id', c.thread_id);
        if (data?.length) return data.map((e) => `${e.subject}\n${e.body}`).join('\n');
      }
      if (c.source_id) {
        const { data } = await supabase.from('emails')
          .select('subject, body').eq('id', c.source_id).maybeSingle();
        if (data) return `${data.subject}\n${data.body}`;
      }
    }
  } catch { /* fall through — unknown source, don't clear */ }
  return null;
}

async function main() {
  const userId = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!userId) { console.error('Usage: npx tsx scripts/dedup-commitments.ts <userId> [--apply]'); process.exit(1); }

  console.log(`\n${apply ? '⚠️  APPLY MODE — rows WILL be updated' : '🔍 DRY-RUN — no changes will be written'}`);
  console.log(`User: ${userId}\n`);

  const { data: commits, error } = await supabase.from('commitments')
    .select('id, description, due_date, source, source_id, thread_id, user_id, created_at, counterparty')
    .eq('user_id', userId).eq('status', 'open')
    .order('created_at', { ascending: true }); // oldest first — the keeper in a dup group
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  if (!commits?.length) { console.log('No open commitments — nothing to do.'); return; }

  console.log(`${commits.length} open commitments.\n`);

  // ── 1. Near-duplicate detection (group by source: only collapse dups from the SAME source). ──
  const bySource = new Map<string, typeof commits>();
  for (const c of commits) {
    const key = `${c.source}:${c.source_id ?? ''}`;
    const arr = bySource.get(key) ?? [];
    arr.push(c);
    bySource.set(key, arr);
  }
  const dupIds: { keep: string; drop: string; keepDesc: string; dropDesc: string }[] = [];
  for (const group of bySource.values()) {
    const kept: typeof commits = [];
    for (const c of group) {
      const match = kept.find((k) => sameObligation(k.description, c.description));
      if (match) dupIds.push({ keep: match.id, drop: c.id, keepDesc: match.description, dropDesc: c.description });
      else kept.push(c);
    }
  }

  // ── 2. Untraceable (fabricated) due_dates. ──
  const dateClears: { id: string; desc: string; due: string; reason: string }[] = [];
  for (const c of commits) {
    if (!c.due_date) continue;
    const src = await loadSourceText(c);
    if (src == null) continue; // can't verify → never clear (conservative)
    const hasExact = src.includes(c.due_date);
    const hasAnyDate = DATE_HINT.test(src);
    if (!hasExact && !hasAnyDate) {
      dateClears.push({ id: c.id, desc: c.description, due: c.due_date, reason: 'source states no date at all' });
    } else if (!hasExact && hasAnyDate) {
      // The source mentions SOME date but not this exact ISO one — likely a mis-resolved / invented
      // absolute. Flag it (safe to clear: a stated relative deadline can be re-derived later).
      dateClears.push({ id: c.id, desc: c.description, due: c.due_date, reason: 'exact date not found in source (mentions other dates)' });
    }
  }

  // ── Report ──
  console.log(`── NEAR-DUPLICATES: ${dupIds.length} would be dismissed ──`);
  for (const d of dupIds) {
    console.log(`  drop "${d.dropDesc.slice(0, 70)}"`);
    console.log(`  keep "${d.keepDesc.slice(0, 70)}"\n`);
  }
  if (!dupIds.length) console.log('  (none)\n');

  console.log(`── FABRICATED / UNTRACEABLE DUE DATES: ${dateClears.length} would be cleared ──`);
  for (const d of dateClears) {
    console.log(`  clear ${d.due} on "${d.desc.slice(0, 70)}" — ${d.reason}`);
  }
  if (!dateClears.length) console.log('  (none)');
  console.log('');

  if (!apply) {
    console.log('DRY-RUN complete — pass --apply to write these changes.');
    return;
  }

  // ── Apply ──
  let dismissed = 0, cleared = 0;
  for (const d of dupIds) {
    const { error: e } = await supabase.from('commitments')
      .update({ status: 'dismissed' }).eq('id', d.drop);
    if (!e) dismissed++;
  }
  for (const d of dateClears) {
    const { error: e } = await supabase.from('commitments')
      .update({ due_date: null }).eq('id', d.id);
    if (!e) cleared++;
  }
  console.log(`APPLIED: ${dismissed} duplicates dismissed, ${cleared} due_dates cleared.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
