import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadUserRules } from '@/lib/inbox/rules/load';
import { setInboxRules, classifyItem, shouldDraftReply, type ItemType } from '@/lib/inbox/classify-item';
import { LABEL_TO_TYPE } from '@/lib/inbox/rules/types';
import { generateReplyDraft } from '@/lib/inbox/draft-reply';
import { runPreparationPass } from '@/lib/prepare/pass';

export const maxDuration = 300;

// Auto-draft sweep. For every user whose master "Automatically draft replies" is ON, pre-generate a
// voice-grounded reply for each pending item that a rule with auto_draft enabled covers — and that
// doesn't already have a draft. The result is stored on source_data.draft so the inbox/Home show it
// "ready to review" (and /api/inbox/[id]/draft serves it instantly). Gating: master AND rule.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: profs } = await sb.from('profiles').select('id, email_settings');
  let drafted = 0, usersTouched = 0;

  for (const p of profs ?? []) {
    const settings = (p.email_settings ?? {}) as { auto_draft?: boolean };
    if (settings.auto_draft === false) continue; // master OFF (default ON)

    const rules = await loadUserRules(p.id, sb);
    // Which item TYPES should be drafted = the set_types of rules that have auto_draft enabled.
    const draftTypes = new Set<ItemType>(
      rules.filter(r => r.enabled && r.outcome?.auto_draft?.enabled && r.outcome.set_type)
        .map(r => LABEL_TO_TYPE[r.outcome.set_type!]).filter(Boolean),
    );
    if (!draftTypes.size) continue;
    const instructions = rules.find(r => r.enabled && r.outcome?.auto_draft?.enabled)?.outcome.auto_draft?.instructions ?? null;

    setInboxRules(rules); // so classifyItem uses this user's rules
    // Fetch the actionable candidates, not just the most recent — needs_reply items can sit well
    // below a wall of newsletters. rule_type set OR an action work_state covers them; classifyItem
    // makes the final call. (Plain fyi/noise are excluded by both conditions.)
    const { data: items } = await sb.from('inbox_items')
      .select('id, source_data, work_state, rule_type, type_override, status, source')
      .eq('user_id', p.id).eq('status', 'pending')
      .or('rule_type.not.is.null,work_state.in.(work_prepared,decision_required,action_required)')
      .order('created_at', { ascending: false }).limit(200);

    let any = false;
    for (const it of items ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sd = (it.source_data ?? {}) as Record<string, any>;
      if (sd.draft?.body) continue;                       // already drafted
      if (!sd.from && !sd.from_address) continue;          // not a real email item
      // Only draft a reply when the item GENUINELY owes one — never for FYI/`noted` mail (a newsletter
      // must never get an auto-draft). Gates on the item's own work_state + classifyItem, not keywords.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!shouldDraftReply(it as any)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!draftTypes.has(classifyItem(it as any))) continue;
      try {
        // THE ONE GATE (promise law — this legacy rule loop was the LAST ungated path to a draft;
        // the "vendor reminder re-drafted itself" class): the judged verdict must say the work
        // is a reply. Cached on the item — a read on repeat sweeps.
        const { judgeWork } = await import('@/lib/work/judge');
        const verdict = await judgeWork(sb, p.id, { kind: 'inbox', id: it.id as string });
        if (verdict.work !== 'reply' && verdict.work !== 'send_file') continue;
        const body = await generateReplyDraft(p.id, sd, sb, instructions);
        if (body) {
          await sb.from('inbox_items')
            .update({ source_data: { ...sd, draft: { body, generated_at: new Date().toISOString() } } })
            .eq('id', it.id);
          drafted++; any = true;
        }
      } catch { /* skip this item */ }
    }
    if (any) usersTouched++;
    // THE PREPARATION PASS (Phase C slice 1) — beyond rule-covered drafts: the deck's TOP items get
    // reply drafts + waiting-on nudges ambiently (idempotent, drafts only — nothing ever sends).
    try { await runPreparationPass(sb, p.id); } catch { /* non-fatal per user */ }
    // ONE BRAIN catch-all (P0): the sig-gated entity-state sweep lives HERE (2-hourly), not in the
    // Home brief's after() tail — per-entity refresh already fires where ledgers actually change
    // (noteItemAction, reconcileEntities, the sync/insights hooks); this sweep only catches strays.
    try {
      const { refreshEntityStates } = await import('@/lib/entities/state');
      await refreshEntityStates(sb, p.id);
    } catch { /* non-fatal per user */ }
    // ONE BRAIN memory MAINTENANCE (P1.5a — the anti-fragmentation cadence). Order matters:
    //   1. fingerprints — recompute people tokens (multi-form: name + email + @domain) so recall and
    //      reflection see identity, not just whichever form happened to arrive first;
    //   2. calendar — recognize new/upcoming events (idempotent; the sync tail also fires this, this
    //      is the guarantee when calendar changes arrive without an email sync);
    //   3. reflection — merge entities remembered twice (sig-gated pair memory keeps it cheap; the
    //      conservative judge + 'separate' verdicts protect distinct deals);
    //   4. orphans — archive long-empty untracked entities (ghost founders).
    try {
      const { refreshPeopleFingerprints, archiveOrphanEntities } = await import('@/lib/entities/reconcile');
      const { shadowRecognizeCalendar } = await import('@/lib/entities/hooks');
      const { reflectEntities } = await import('@/lib/entities/reflect');
      await refreshPeopleFingerprints(sb, p.id).catch(() => {});
      await shadowRecognizeCalendar(sb, p.id).catch(() => null);
      await reflectEntities(sb, p.id, { commit: true }).catch(() => []);
      await archiveOrphanEntities(sb, p.id).catch(() => 0);
    } catch { /* non-fatal per user */ }
  }

  return NextResponse.json({ drafted, usersTouched });
}
