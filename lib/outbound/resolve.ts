// Cached resolver for outbound-awaiting — the single entry point the surfaces (Timeline / Home / Projects)
// call. Finds cold outbound candidates deterministically, then attaches the reasoned {awaiting, initiative}
// verdicts, running the AI classifier ONLY when the candidate set changes (cached in profiles.outbound_cache
// by a signature of recipients + last-sent dates). Returns just the awaiting items, initiative attached.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOutboundCandidates } from './sent-threads';
import { classifyOutbound, type OutboundVerdict } from './classify-outbound';

const OUTBOUND_VERSION = 1; // bump to force re-classification (e.g. prompt/model change)

export type OutboundItem = {
  recipient: string;
  who: string | null;
  subject: string;
  lastSentAt: string;
  ageDays: number;
  count: number;
  initiative: string | null;
};

export async function resolveOutboundAwaiting(
  supabase: SupabaseClient,
  userId: string,
  todayStr: string,
  opts: { windowDays?: number } = {},
): Promise<OutboundItem[]> {
  const candidates = await getOutboundCandidates(supabase, userId, todayStr, opts);
  if (!candidates.length) return [];

  const sig = `v${OUTBOUND_VERSION}|` + candidates.map((c) => `${c.recipient}:${c.lastSentAt.slice(0, 10)}`).sort().join('|');

  let verdicts: Record<string, OutboundVerdict> | null = null;
  try {
    const { data } = await supabase.from('profiles').select('outbound_cache').eq('id', userId).maybeSingle();
    const cache = (data?.outbound_cache ?? null) as { sig?: string; verdicts?: Record<string, OutboundVerdict> } | null;
    if (cache?.sig === sig && cache.verdicts) verdicts = cache.verdicts;
  } catch { /* non-fatal: fall through to recompute */ }

  if (!verdicts) {
    const map = await classifyOutbound(supabase, userId, candidates);
    verdicts = Object.fromEntries(map);
    try {
      await supabase.from('profiles').update({ outbound_cache: { sig, verdicts, generated_at: `${todayStr}T00:00:00Z` } }).eq('id', userId);
    } catch { /* non-fatal: caching is best-effort */ }
  }

  const out: OutboundItem[] = [];
  for (const c of candidates) {
    const v = verdicts[c.recipient];
    if (!v?.awaiting) continue;
    out.push({ recipient: c.recipient, who: c.who, subject: c.subject, lastSentAt: c.lastSentAt, ageDays: c.ageDays, count: c.count, initiative: v.initiative ?? null });
  }
  return out;
}
