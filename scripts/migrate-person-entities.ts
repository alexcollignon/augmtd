// ONE BRAIN — PERSON ENTITIES (Phase C). Consolidates person_state (keyed per-EMAIL — the source of the
// alias-dup bug: one human = several rows = duplicate cards) into work_entities kind='person': ONE row per
// human, ALL their addresses/name-forms in `aliases`. Identity clustering is deterministic-first (same
// canonical name / same email localpart — facts); ambiguous clusters get ONE reasoned judgment ("same
// person?"). The freshest row donates state/next_touch; synthesis stays alias-aware afterwards.
// person_state remains until its consumers cut over (dies at demolition). Re-runnable (upserts by name key).
// Usage: npx tsx scripts/migrate-person-entities.ts [--apply]
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { canonicalPerson, emailLocalpart, emailDenotesName, nameTokens } from '../lib/projects/identity';
import { aiCall } from '../lib/ai/call';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

type PS = { person_key: string; display_name: string | null; emails: unknown; org: string | null; is_internal: boolean; state: unknown; next_touch: unknown; quiet_days: number | null; last_touch_at: string | null; updated_at: string };

(async () => {
  const { data: usersRaw } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((usersRaw ?? []).map((r: any) => r.user_id))];
  for (const uid of userIds) {
    const { data: rows } = await sb.from('person_state').select('*').eq('user_id', uid);
    const list = (rows ?? []) as PS[];

    // ── Deterministic clustering: same canonical display-name OR same email localpart → one candidate human.
    // Diacritic-folded ("René" ≡ "Rene" — THE deck-dup case) before canonicalizing. ──
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const clusters = new Map<string, PS[]>();
    for (const r of list) {
      const nameKey = canonicalPerson(fold(r.display_name || '')) || '';
      const localKey = (r.person_key.split('@')[0] || '').replace(/[^a-z0-9]/g, '');
      // Prefer the name as the human key (two addresses, one name → one cluster); fall back to localpart.
      const key = nameKey || localKey || r.person_key;
      (clusters.get(key) ?? clusters.set(key, []).get(key)!).push(r);
    }

    let entities = 0, merged = 0, judged = 0, vetoed = 0;
    // How strongly does a member's ADDRESS bear the cluster's name? (identity facts, tiered)
    //   2 = strong (localpart IS the name: joined / initials / first+last) — the name is theirs.
    //   1 = weak (shares one name word — could be a different human with a shared first/surname).
    //   0 = none (catarina.mascarenhas@ under "René Bohnsack" — a mislabeled contact row).
    const denoteStrength = (m: PS, name: string): 0 | 1 | 2 => {
      const local = emailLocalpart(m.person_key) || '';
      if (!local) return 1;
      const t = nameTokens(name);
      const joined = t.join(''), initials = t.map((w) => w[0]).join(''), firstLast = (t[0]?.[0] || '') + (t[t.length - 1] || '');
      if (local === joined || local === initials || local === firstLast) return 2;
      // LEADING-TOKEN CONFLICT (a fact): the address's leading name part (sofia.silva.oliveira → "sofia")
      // spells a DIFFERENT first name than the display name → this is another human, however many surname
      // tokens they share. Only fires on a real leading token (>2 chars) absent from the display name.
      const leading = (m.person_key.split('@')[0] || '').split(/[._-]/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
      if (leading.length > 2 && !t.includes(leading) && !t.some((w) => w.length > 2 && leading.startsWith(w))) return 0;
      return emailDenotesName(local, name) ? 1 : 0;
    };
    for (const [, members] of clusters) {
      const clusterName = fold(members.find((m) => m.display_name)?.display_name || '');
      // Rank: strongest address↔name match first, freshest as tiebreak — the KEEPER truly bears the name.
      const ranked = [...members].sort((a, b) =>
        denoteStrength(b, clusterName) - denoteStrength(a, clusterName) || (b.updated_at || '').localeCompare(a.updated_at || ''));
      const keep = ranked[0];
      // ── STRUCTURAL VETO (a fact): strength-0 members can never merge — they split out, named by address. ──
      let candidate = members;
      const split: PS[] = [];
      if (members.length > 1 && clusterName) {
        candidate = [];
        for (const m of members) {
          if (denoteStrength(m, clusterName) > 0) candidate.push(m);
          else { split.push(m); vetoed++; }
        }
        if (!candidate.length) { candidate = [keep]; const i = split.indexOf(keep); if (i >= 0) split.splice(i, 1); } // keep never double-migrates
      }
      let cluster = candidate;
      if (candidate.length > 1) {
        // Same denoted name from DIFFERENT domains → one reasoned check (could still be two people).
        const domains = new Set(candidate.map((m) => m.person_key.split('@')[1] || ''));
        if (domains.size > 1) {
          judged++;
          const res = await aiCall<{ same?: boolean; reason?: string }>({
            userId: uid, supabase: sb, shape: { output: 'json' }, temperature: 0, maxTokens: 160, source: 'brain_synthesis',
            prompt: `Contact records share the display name "${keep.display_name}" but use different addresses:\n` +
              candidate.map((m) => `- ${m.person_key} (${m.org || 'no org'}): ${(m.state as any)?.summary ?? ''}`).join('\n') +
              `\nAre these the SAME human (one person, multiple mailboxes) or DIFFERENT people?\n` +
              `CRITICAL: the ADDRESS's own name-parts outrank the display name — if an address clearly spells a ` +
              `DIFFERENT first or last name (kate.brear@ vs "Kate Fornadel", ahmed.alhussaini@ vs "Ahmed Moussa"), ` +
              `they are DIFFERENT people unless the summaries prove one human. A shared first name or surname ` +
              `alone NEVER makes two addresses the same person.\n` +
              `JSON only: {"same": true|false, "reason": "<=12 words"}`,
          });
          if (res.json?.same === false) { cluster = [keep]; for (const m of candidate) if (m !== keep) split.push(m); }
        }
        if (cluster.length > 1) merged += cluster.length - 1;
      }
      // Split members become their OWN entities — named by their display name only when their ADDRESS
      // actually bears it (strength 2: a genuinely-named different human); otherwise by the address
      // (strength 0/1: the display name belongs to someone else's cluster or is ambiguous).
      const toMigrate: Array<{ group: PS[]; ownName: boolean }> = [
        { group: cluster, ownName: true },
        ...split.map((m) => ({ group: [m], ownName: denoteStrength(m, fold(m.display_name || '')) === 2 })),
      ];
      for (const { group, ownName } of toMigrate) {
        const donor = [...group].sort((a, b) =>
          denoteStrength(b, clusterName) - denoteStrength(a, clusterName) || (b.updated_at || '').localeCompare(a.updated_at || ''))[0];
        const name = ownName ? (donor.display_name || donor.person_key) : donor.person_key;
        const aliases = [...new Set(group.flatMap((m) => [m.person_key, ...(Array.isArray(m.emails) ? (m.emails as string[]) : []), ...(ownName ? [m.display_name || ''] : [])]).filter(Boolean))];
        entities++;
        if (!APPLY) {
          if (group.length > 1) console.log(`  [dry] "${name}" ⇐ ${group.map((m) => m.person_key).join(' + ')}`);
          if (group.length === 1 && split.includes(donor)) console.log(`  [dry·split] "${donor.display_name}" ↛ ${donor.person_key} → own entity as "${name}"`);
          continue;
        }
        // Upsert by (user, kind, name-key): find an existing person entity with this name, else insert.
        const { data: existing } = await sb.from('work_entities').select('id').eq('user_id', uid).eq('kind', 'person').eq('name', name).maybeSingle();
        const payload = {
          user_id: uid, kind: 'person', name,
          summary: (donor.state as any)?.summary ?? null, aliases,
          state: donor.state, next_move: donor.next_touch, tracked: false, status: 'active',
          last_event_at: donor.last_touch_at, updated_at: new Date().toISOString(),
        };
        if (existing) await sb.from('work_entities').update(payload).eq('id', existing.id);
        else await sb.from('work_entities').insert(payload);
      }
    }
    console.log(`user ${uid.slice(0, 8)} — person_state rows:${list.length} → person entities:${entities} (dup rows absorbed:${merged}, name-collision judgments:${judged})`);
  }
  if (!APPLY) console.log('\nDry-run. Re-run with --apply to write.');
})();
