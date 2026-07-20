// PHASE 0 — READ-ONLY labeling diagnostic (no writes). Measures the TWO failure modes of initiative labeling
// against real content, across users, to baseline the content-vs-person fix:
//   • OVER-MERGE  (the complaint): one label lumps ≥2 DISTINCT topics. Flags whether the lumped items are all
//                 from ONE contact — the exact "same person → same label" bug.
//   • UNDER-MERGE (the guardrail): one contact carries ≥2 labels that are actually the SAME deal (synonyms).
// Cheap `classification`-tier judgments, bounded per user. Prints rates + examples.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '../lib/ai/factory';
import { parseModelJSON } from '../lib/ai/parse-json';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const emailOf = (s?: string | null) => String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;
const unfence = (s: string) => { let t = (s || '').trim(); const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) t = f[1].trim(); const a = t.indexOf('{'), b = t.lastIndexOf('}'); return a >= 0 && b > a ? t.slice(a, b + 1) : t; };

const LABELS_PER_USER = 12, CONTACTS_PER_USER = 12;

(async () => {
  const { data: usersRaw } = await sb.from('person_state').select('user_id').limit(20000);
  const userIds = [...new Set((usersRaw ?? []).map((r: any) => r.user_id))];

  let totLabels = 0, totOver = 0, totOverSingleContact = 0, totContacts = 0, totUnder = 0, shownO = 0, shownU = 0;

  for (const uid of userIds) {
    const { data: items } = await sb.from('inbox_items').select('work_title, source_data').eq('user_id', uid).eq('source', 'email').order('created_at', { ascending: false }).limit(1500);
    const byLabel = new Map<string, { subjects: Set<string>; contacts: Set<string> }>();
    const byContact = new Map<string, Map<string, string>>(); // contact → label → sample subject
    for (const it of (items ?? []) as any[]) {
      const sd = it.source_data ?? {};
      const label = sd.understanding?.initiative; if (!label || typeof label !== 'string') continue;
      const subj = String(it.work_title || sd.subject || '').slice(0, 90); if (!subj) continue;
      const contact = emailOf(sd.from_address || sd.from) || (sd.from_name || '').toLowerCase(); if (!contact) continue;
      if (!byLabel.has(label)) byLabel.set(label, { subjects: new Set(), contacts: new Set() });
      byLabel.get(label)!.subjects.add(subj); byLabel.get(label)!.contacts.add(contact);
      if (!byContact.has(contact)) byContact.set(contact, new Map());
      if (!byContact.get(contact)!.has(label)) byContact.get(contact)!.set(label, subj);
    }
    const { client, model } = await getAIClient(uid, 'classification', sb);

    // ── OVER-MERGE: labels with ≥3 distinct subjects — do they lump distinct topics? ──
    const richLabels = [...byLabel.entries()].filter(([, v]) => v.subjects.size >= 3).sort((a, b) => b[1].subjects.size - a[1].subjects.size).slice(0, LABELS_PER_USER);
    for (const [label, v] of richLabels) {
      totLabels++;
      const subs = [...v.subjects].slice(0, 8);
      const content = `These email subjects are ALL labeled as one initiative/deal: "${label}".\n${subs.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nDo they all belong to ONE body of work, or does this label lump together 2+ DISTINCT topics/deals? Judge by CONTENT. JSON only: {"distinct_topics": <int>, "verdict": "one"|"lumped", "reason": "<=12 words"}`;
      const res = await aiCreate(client, { model, response_format: { type: 'json_object' as const }, max_tokens: 200, temperature: 0, messages: [{ role: 'user', content }] }).catch(() => null);
      const p = res ? parseModelJSON<any>(unfence(res.choices?.[0]?.message?.content || ''), {}) : {};
      if (p?.verdict === 'lumped' || (p?.distinct_topics ?? 1) >= 2) {
        totOver++;
        const single = v.contacts.size === 1; if (single) totOverSingleContact++;
        if (shownO < 8) { shownO++; console.log(`  OVER  "${label}" — ${p.distinct_topics ?? '?'} topics${single ? ' · SINGLE-CONTACT (person-prior bug)' : ''}: ${p.reason || ''}`); }
      }
    }

    // ── UNDER-MERGE: contacts with ≥2 labels — are any actually the same deal? ──
    const multiLabel = [...byContact.entries()].filter(([, m]) => m.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, CONTACTS_PER_USER);
    for (const [contact, m] of multiLabel) {
      totContacts++;
      const pairs = [...m.entries()].slice(0, 8);
      const content = `One person (${contact}) appears under these initiative labels, each with a sample subject:\n${pairs.map(([l, s], i) => `${i + 1}. label "${l}" — e.g. "${s}"`).join('\n')}\n\nGroup them: which labels are actually the SAME deal (synonyms of one body of work) vs genuinely SEPARATE? Judge by CONTENT, not just that it's the same person. JSON only: {"same_deal_groups": [["label","label"], ...]}  (only include groups with 2+ labels that should merge; empty if all separate).`;
      const res = await aiCreate(client, { model, response_format: { type: 'json_object' as const }, max_tokens: 260, temperature: 0, messages: [{ role: 'user', content }] }).catch(() => null);
      const p = res ? parseModelJSON<any>(unfence(res.choices?.[0]?.message?.content || ''), {}) : {};
      const groups = (p?.same_deal_groups ?? []).filter((g: any) => Array.isArray(g) && g.length >= 2);
      if (groups.length) {
        totUnder++;
        if (shownU < 6) { shownU++; console.log(`  UNDER ${contact.slice(0, 22)} — should merge: ${groups.map((g: string[]) => g.join(' = ')).join(' ; ')}`); }
      }
    }
    console.log(`user ${uid.slice(0, 8)} — labels tested:${richLabels.length} · multi-label contacts:${multiLabel.length}`);
  }

  console.log('\n════ PHASE 0 BASELINE ════');
  console.log(`OVER-MERGE:  ${totOver}/${totLabels} multi-item labels lump ≥2 distinct topics (${totLabels ? Math.round(100*totOver/totLabels) : 0}%)  ·  of those, ${totOverSingleContact} are SINGLE-CONTACT (the "same person → same label" bug)`);
  console.log(`UNDER-MERGE: ${totUnder}/${totContacts} multi-label contacts carry synonym labels that should merge (${totContacts ? Math.round(100*totUnder/totContacts) : 0}%)`);
})();
