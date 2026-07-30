// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE BRAIN — REGISTRY RECONCILIATION. Memory hygiene, reasoned (no string rules).
//
// Recognition judges items one at a time, cold-starting a chronological replay with no candidates in view.
// That imperfection leaves the registry with entries that are not durable bodies of work: a 1:1/sync
// founded as a "project" (a bare "<person> x <owner>" channel title), an email subject or meeting title
// used as a name, a mis-categorised vendor account. Downstream (the brief) then RESTATES those names.
//
// A human fixes this the way they'd tidy their own memory: look at each remembered thing WITH its evidence
// and ask "is this actually a distinct body of work, and what is its real name?" This pass does exactly that
// — ONE reasoned call per entity over its people + summary + linked item titles → a verdict:
//   • keep    — a genuine body of work; give it a clean CANONICAL name (never "X x Y", never a raw subject)
//               and the right category.
//   • archive — merely a channel (a 1:1 / recurring sync / one meeting) advancing no distinct ongoing work.
//               Archived, not deleted: its linked items simply fall loose (never destroyed).
// Duplicates are left to REFLECTION (reflect.ts), which has the structural keeper/absorb logic. This pass is
// naming + validity + category. Idempotent, agnostic (no per-user literals), dry-run supported.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import { aiCall } from '@/lib/ai/call';
import { embedText } from '@/lib/knowledge/indexer';
import { entityEmbedText } from './recognize';

export type ReconcileVerdict = {
  entityId: string;
  currentName: string;
  action: 'keep' | 'archive';
  canonicalName: string;                 // the clean name (== currentName when unchanged)
  category: 'client' | 'internal' | 'personal' | 'admin' | null;
  renamed: boolean;
  reason: string;
};

const CATS = ['client', 'internal', 'personal', 'admin'];

type EntEvidence = {
  id: string; name: string; summary: string | null; people: string[];
  itemTitles: string[]; commitments: string[]; meetings: string[];
  linkCount: number;                     // total links across ALL kinds — the "is there work here" signal
  category: string | null; embedding: number[] | null;
};

/** One reasoned verdict for a single entity — pure (no writes). Exposed so a maintenance hook can reuse it.
 *  CONSERVATIVE by design: naming/category is the main job; archiving is the RARE exception, reserved for
 *  entries that are plainly not work at all. When uncertain, KEEP — never risk archiving a real deal. */
export async function judgeRegistryEntity(
  supabase: SupabaseClient, userId: string, e: EntEvidence, ownerName?: string | null,
): Promise<Omit<ReconcileVerdict, 'entityId' | 'currentName' | 'renamed'>> {
  const evidence = [
    ...e.itemTitles.map((t) => `email: ${t.slice(0, 90)}`),
    ...e.commitments.map((t) => `commitment: ${t.slice(0, 90)}`),
    ...e.meetings.map((t) => `meeting: ${t.slice(0, 90)}`),
  ].slice(0, 12);
  const owner = (ownerName || '').trim();
  const prompt =
    `You are tidying a person's MEMORY of the DISTINCT BODIES OF WORK in their life — deals, client ` +
    `engagements, programs, hires, recurring operations, personal projects, and accounts they actively ` +
    `manage. One remembered entry is below. Your PRIMARY job is to give it a clean, RECOGNISABLE canonical ` +
    `NAME and the right CATEGORY. Only very rarely should you archive it.\n\n` +
    (owner ? `The person whose memory this is: ${owner} (the "owner"). They are on everything, so their own ` +
      `name is NOISE in a title — drop it.\n\n` : '') +
    `THE ENTRY:\n` +
    `  current name: "${e.name}"\n` +
    (e.summary ? `  summary: ${e.summary}\n` : '') +
    (e.people.length ? `  people: ${e.people.slice(0, 8).join(', ')}\n` : '') +
    `  linked activity: ${e.linkCount} item(s)\n` +
    `  evidence:\n${evidence.map((t) => `   - ${t}`).join('\n') || '   (evidence not loaded — assume it exists)'}\n\n` +
    `NAME — the one rule that matters: the reader must recognise WHO/WHAT it is AT A GLANCE. KEEP the identity ` +
    `anchor — the client or company involved, or, when it is a relationship/1:1 with no company, the KEY ` +
    `person it is with; a single anchoring name is good. DROP only the channel scaffolding: the owner's own ` +
    `name${owner ? ` (${owner})` : ''}, the "x" between two parties, and conduit words (chat, meeting, 1:1, ` +
    `sync, call). Never reduce a title to a generic phrase that erases who it is with, and never a raw email ` +
    `subject or task phrase. ≤5 words. If the current name is already clean and recognisable, return it unchanged.\n` +
    `CATEGORY: "client" = an external client/customer/deal/prospect you do business work with. "internal" = ` +
    `the person's OWN organisation/team/hiring/operations. "personal" = personal life (property, education, a ` +
    `service you personally consume) even if a company provides it. "admin" = a vendor/tool/SaaS/subscription/` +
    `utility/automated account with no real human counterpart.\n\n` +
    `ARCHIVE is the RARE exception — choose it ONLY when the entry is plainly NOT a body of work at all: a ` +
    `one-off transaction or receipt, a single purchase, a lone security alert or notification, a newsletter. ` +
    `A real deal/engagement/program/hire/project/account — anything with an ongoing matter, multiple people, ` +
    `or any linked commitments/meetings — is ALWAYS "keep", even if the evidence list is short or its name is ` +
    `messy (rename it instead). WHEN IN DOUBT, KEEP. Do not archive merely because evidence looks sparse.\n\n` +
    `Return ONLY JSON: {"action":"keep|archive","canonical_name":"<clean name or the unchanged name>","category":"client|internal|personal|admin","reason":"<=14 words"}`;

  const res = await aiCall<{ action?: string; canonical_name?: string; category?: string; reason?: string }>({
    userId, supabase, shape: { output: 'json' }, prompt, temperature: 0, maxTokens: 160, source: 'brain_synthesis',
  });
  const p = res.json ?? {};
  // Safety rail (structural, not a name rule): NEVER archive an entity that carries real accrued work —
  // linked commitments/meetings or ≥2 links mean it's a body of work regardless of the model's read.
  const hasAccruedWork = e.commitments.length > 0 || e.meetings.length > 0 || e.linkCount >= 2;
  const action = (p.action === 'archive' && !hasAccruedWork) ? 'archive' : 'keep';
  const canonicalName = (String(p.canonical_name || '').trim() || e.name).slice(0, 80);
  const category = CATS.includes(String(p.category)) ? (p.category as ReconcileVerdict['category']) : (e.category as ReconcileVerdict['category']) ?? null;
  return { action, canonicalName, category, reason: String(p.reason || '').slice(0, 140) };
}

/** Reconcile a user's whole active initiative registry. Loads each entity's evidence, judges, and (when
 *  `commit`) renames / re-categorises / archives. Returns the verdicts (for a dry-run review or a smoke). */
export async function reconcileRegistry(
  supabase: SupabaseClient, userId: string, opts: { commit?: boolean; limit?: number } = {},
): Promise<ReconcileVerdict[]> {
  const { data: rows } = await supabase.from('work_entities')
    .select('id, name, summary, people, aliases, state, embedding, tracked')
    .eq('user_id', userId).eq('kind', 'initiative').eq('status', 'active').limit(opts.limit ?? 500);
  // The owner's own name — noise to strip from any title (they're on everything).
  const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const ownerName = (prof?.full_name as string) || null;
  const out: ReconcileVerdict[] = [];
  for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
    // Evidence across ALL kinds — an entity's work lives in emails AND commitments AND meetings; judging
    // validity off inbox titles alone wrongly reads a commitment/meeting-heavy deal as "empty" (the
    // over-archiving bug). Total link count is the "is there work here" signal.
    const { data: allLinks, count: linkCount } = await supabase.from('entity_links')
      .select('item_id, item_kind', { count: 'exact' }).eq('user_id', userId).eq('entity_id', r.id as string).not('entity_id', 'is', null).limit(60);
    const byKind = (k: string) => (allLinks ?? []).filter((l) => l.item_kind === k).map((l) => l.item_id as string);
    const inboxIds = byKind('inbox_item').slice(0, 6), commitIds = byKind('commitment').slice(0, 6), meetIds = byKind('meeting').slice(0, 4);
    const [items, commits, meets] = await Promise.all([
      inboxIds.length ? supabase.from('inbox_items').select('work_title').in('id', inboxIds) : Promise.resolve({ data: [] as Array<{ work_title?: string }> }),
      commitIds.length ? supabase.from('commitments').select('description').in('id', commitIds) : Promise.resolve({ data: [] as Array<{ description?: string }> }),
      meetIds.length ? supabase.from('meeting_transcripts').select('title').in('id', meetIds) : Promise.resolve({ data: [] as Array<{ title?: string }> }),
    ]);
    const e: EntEvidence = {
      id: r.id as string, name: r.name as string, summary: (r.summary as string) ?? null,
      people: Array.isArray(r.people) ? (r.people as string[]) : [],
      itemTitles: ((items.data ?? []) as Array<{ work_title?: string }>).map((i) => String(i.work_title || '')).filter(Boolean),
      commitments: ((commits.data ?? []) as Array<{ description?: string }>).map((c) => String(c.description || '')).filter(Boolean),
      meetings: ((meets.data ?? []) as Array<{ title?: string }>).map((m) => String(m.title || '')).filter(Boolean),
      linkCount: linkCount ?? (allLinks ?? []).length,
      category: ((r.state ?? {}) as { category?: string }).category ?? null,
      embedding: Array.isArray(r.embedding) ? (r.embedding as number[]) : null,
    };
    const v = await judgeRegistryEntity(supabase, userId, e, ownerName);
    const renamed = v.action === 'keep' && v.canonicalName !== e.name;
    out.push({ entityId: e.id, currentName: e.name, renamed, ...v });

    if (!opts.commit) continue;
    // THE PINNING LAW (July 29): a TRACKED entity is a human decision that outranks the machine —
    // the reasoned judge may rename/re-categorise it, but never auto-archive it.
    if (v.action === 'archive') {
      if (!r.tracked) {
        await supabase.from('work_entities').update({ status: 'archived', updated_at: new Date().toISOString() })
          .eq('id', e.id).eq('user_id', userId).then(() => {}, () => {});
      }
      continue; // a tracked entity survives an archive verdict untouched (never falls into rename)
    }
    // keep: apply canonical name (+ old name → aliases + re-embed) and/or category.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (renamed) {
      const aliases = [...new Set([...(Array.isArray(r.aliases) ? (r.aliases as string[]) : []), e.name])].slice(0, 12);
      patch.name = v.canonicalName;
      patch.aliases = aliases;
      patch.embedding = await embedText(entityEmbedText(v.canonicalName, e.summary, e.people), userId, supabase);
    }
    if (v.category && v.category !== e.category) {
      patch.state = { ...((r.state ?? {}) as Record<string, unknown>), category: v.category };
    }
    if (Object.keys(patch).length > 1) {
      await supabase.from('work_entities').update(patch).eq('id', e.id).eq('user_id', userId).then(() => {}, () => {});
    }
  }
  return out;
}
