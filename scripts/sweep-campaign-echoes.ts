// ════════════════════════════════════════════════════════════════════════════════════════════════
// RETRO-REPAIR BY LAW — THE ECHO FLOOR (LAW 5, docs/proactive-reach-plan.md).
//
// The law repairs the future. This sweep applies the SAME law to the standing backlog: every item,
// entity and commitment born from the user's own outbound sequence echoing back. Nothing is
// hand-picked — the signature is DERIVED from the user's own sent corpus by the same module the
// live floor consults (lib/inbox/campaign-echo), so this script names no token, sender or vendor.
//
// GUARDED: dry-run by default, --apply to write, --user <uid-or-prefix> to scope.
//   npx tsx --env-file=.env.local scripts/sweep-campaign-echoes.ts --user <uid> [--apply]
//
// WHAT IT DOES, and what it deliberately does NOT:
//   • ITEMS  — stamps `source_data.campaign_echo = true`. That is a POSTURE flip, not a hiding:
//     classifyItem reads the stamp and files the item in the awareness lane, where it stays
//     visible on demand. The user's own re-type (`type_override`) outranks the stamp permanently
//     — the precedence chain, so the repair is reversible by the person it serves.
//   • ENTITIES — archives (soft status flip, reversible from the portfolio's Archived tab) only a
//     machine-founded, UNTRACKED entity whose entire inbox membership is echoes and which carries
//     no meeting/commitment/calendar work. THE PINNING LAW: a tracked entity is a human decision
//     and is NEVER auto-archived, at any door.
//   • COMMITMENTS — dismisses open commitments minted from an echo email, through the SAME
//     undoable door as every other machine closure (`commitment_dismissed` is reversible via
//     /api/restore), with an auditable resolved_reason. Never deleted.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAllRows } from '../lib/utils/fetch-all';
import { logActivity } from '../lib/activity/log';
import {
  getCampaignSignature, matchSubject, signatureIsEmpty, type CampaignSignature,
} from '../lib/inbox/campaign-echo';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const subjectOf = (it: Row) => String((it.source_data ?? {}).subject ?? it.work_title ?? '');

async function sweepUser(uid: string): Promise<void> {
  const sig: CampaignSignature = await getCampaignSignature(sb, uid, { force: true });
  console.log(`\n══ ${uid.slice(0, 8)} — signature from ${sig.sentRead} sent rows`);
  console.log(`   tokens   : ${sig.tokens.length ? sig.tokens.join(', ') : '(none)'}`);
  console.log(`   templates: ${sig.templates.length ? sig.templates.map((t) => `"${t}"`).join(', ') : '(none)'}`);
  if (signatureIsEmpty(sig)) { console.log('   → no campaign signature; nothing to repair.'); return; }

  // ── ITEMS ──────────────────────────────────────────────────────────────────────────────────────
  const items = await fetchAllRows<Row>((f, t) => sb.from('inbox_items')
    .select('id, work_title, status, work_state, type_override, source_data, created_at')
    .eq('user_id', uid).eq('status', 'pending').order('created_at', { ascending: false }).range(f, t));
  const echoes = items.filter((it) => matchSubject(subjectOf(it), sig).hit);
  const toStamp = echoes.filter((it) => !it.type_override && (it.source_data ?? {}).campaign_echo !== true);
  const protectedByUser = echoes.filter((it) => !!it.type_override).length;

  console.log(`\n   ITEMS — ${items.length} standing · ${echoes.length} echoes · ${toStamp.length} to stamp · ${protectedByUser} protected by the user's own re-type`);
  for (const it of toStamp.slice(0, 25)) {
    console.log(`     · [${String(it.work_state).padEnd(17)}] ${subjectOf(it).slice(0, 72)}`);
  }
  if (toStamp.length > 25) console.log(`     … and ${toStamp.length - 25} more`);
  if (APPLY) {
    for (const it of toStamp) {
      const m = matchSubject(subjectOf(it), sig);
      await sb.from('inbox_items').update({
        source_data: { ...(it.source_data ?? {}), campaign_echo: true, campaign_echo_marker: m.marker, campaign_echo_via: m.via },
      }).eq('id', it.id).eq('user_id', uid);
    }
    if (toStamp.length) {
      await logActivity(sb, uid, {
        type: 'campaign_echo_marked',
        title: `Filed ${toStamp.length} sequence replies under awareness`,
        metadata: { count: toStamp.length, tokens: sig.tokens, templates: sig.templates.length },
      });
    }
  }

  // ── ENTITIES ───────────────────────────────────────────────────────────────────────────────────
  const echoItemIds = new Set(echoes.map((e) => String(e.id)));
  // Every item (any status) matching the signature — an entity founded off a since-resolved echo is
  // still an echo entity.
  const allItems = await fetchAllRows<Row>((f, t) => sb.from('inbox_items')
    .select('id, work_title, source_data').eq('user_id', uid)
    .order('created_at', { ascending: false }).range(f, t));
  for (const it of allItems) if (matchSubject(subjectOf(it), sig).hit) echoItemIds.add(String(it.id));

  const { data: ents } = await sb.from('work_entities').select('id, name, tracked, status')
    .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').limit(1000);
  const archivable: Array<{ id: string; name: string }> = [];
  let pinnedSkipped = 0;
  for (const e of (ents ?? []) as Row[]) {
    // THE PINNING LAW — a tracked entity is a human decision; never auto-archived.
    if (e.tracked === true) { pinnedSkipped++; continue; }
    const { data: links } = await sb.from('entity_links').select('item_kind, item_id')
      .eq('user_id', uid).eq('entity_id', e.id).limit(200);
    const ls = (links ?? []) as Row[];
    if (!ls.length) continue;
    // Real work around it → keep (the noise-sweep precedent).
    if (ls.some((l) => l.item_kind === 'meeting' || l.item_kind === 'commitment' || l.item_kind === 'calendar_event')) continue;
    const inbox = ls.filter((l) => l.item_kind === 'inbox_item');
    if (!inbox.length) continue;
    if (!inbox.every((l) => echoItemIds.has(String(l.item_id)))) continue;
    archivable.push({ id: String(e.id), name: String(e.name) });
  }
  console.log(`\n   ENTITIES — ${(ents ?? []).length} active · ${archivable.length} echo-only machine-founded · ${pinnedSkipped} tracked (pinning law: untouched)`);
  for (const a of archivable.slice(0, 25)) console.log(`     · ${a.name}`);
  if (APPLY) {
    for (const a of archivable) {
      await sb.from('work_entities').update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', a.id).eq('user_id', uid);
      await logActivity(sb, uid, {
        type: 'project_status', title: `Archived "${a.name}" — founded from a sequence reply`,
        entityType: 'initiative', entityId: a.id, metadata: { reason: 'campaign_echo' },
      });
    }
  }

  // ── COMMITMENTS ────────────────────────────────────────────────────────────────────────────────
  const { data: comms } = await sb.from('commitments')
    .select('id, description, status, due_date, counterparty, source, source_id')
    .eq('user_id', uid).in('status', ['open', 'pending']).limit(1000);
  const commEchoes = ((comms ?? []) as Row[]).filter((c) => c.source_id && echoItemIds.has(String(c.source_id)));
  console.log(`\n   COMMITMENTS — ${(comms ?? []).length} open · ${commEchoes.length} minted from an echo`);
  for (const c of commEchoes.slice(0, 25)) console.log(`     · ${String(c.description).slice(0, 70)} (due ${c.due_date ?? '—'})`);
  if (APPLY) {
    for (const c of commEchoes) {
      await sb.from('commitments').update({
        status: 'dismissed', resolved_reason: 'campaign_echo', resolved_at: new Date().toISOString(),
      }).eq('id', c.id).eq('user_id', uid);
      await logActivity(sb, uid, {
        type: 'commitment_dismissed', title: `Dropped "${String(c.description).slice(0, 80)}" — minted from a sequence reply`,
        entityType: 'commitment', entityId: String(c.id), metadata: { reason: 'campaign_echo' },
      });
    }
  }

  console.log(`\n   ${APPLY ? 'APPLIED' : 'DRY RUN'} — items ${toStamp.length} · entities ${archivable.length} · commitments ${commEchoes.length}`);
}

(async () => {
  let ids: string[];
  if (ONLY) {
    const { data } = await sb.from('profiles').select('id');
    ids = ((data ?? []) as Row[]).map((p) => String(p.id)).filter((id) => id === ONLY || id.startsWith(ONLY));
    if (!ids.length) { console.error(`no user matches "${ONLY}"`); process.exit(1); }
  } else {
    const { data } = await sb.from('profiles').select('id');
    ids = ((data ?? []) as Row[]).map((p) => String(p.id));
  }
  for (const uid of ids) await sweepUser(uid).catch((e) => console.error(`  ! ${uid.slice(0, 8)}:`, e?.message ?? e));
  console.log(`\n${APPLY ? '✅ applied' : 'ℹ️  dry run — re-run with --apply to write'}`);
})();
