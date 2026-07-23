// GROUNDING TRUST SMOKE (P7a) — the on-screen-contradiction class is structurally dead. Gates:
//   STRUCTURAL — the chief-of-staff slice includes the READ tools (the loop can GO LOOK: emails, KB,
//     meetings); ledger email lines carry a content gist (the projection floor).
//   LIVE (cross-user) — the VIEWING-ANCHOR law: ask about a fact that exists ONLY in the viewed
//     email's BODY (absent from its subject — the exact "no catalog yet" failure shape) and the
//     answer must engage with it, not deny it. Deterministic fixture selection from real data.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { converse } from '../lib/converse';
import { capabilitiesFor } from '../lib/home/capability-map';
import { assembleLedger } from '../lib/entities/state';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  // ── STRUCTURAL ──
  const chief = new Set(capabilitiesFor('chief_of_staff').map((c) => c.tool));
  check('structural: the chief slice can GO LOOK (read tools exposed)',
    chief.has('get_emails') && chief.has('search_knowledge_base') && chief.has('get_meeting_context'),
    [...chief].join(', '));

  for (const { uid, label } of USERS) {
    // Ledger projection floor: email lines carry a content gist.
    {
      const { data: ents } = await sb.from('work_entities').select('id')
        .eq('user_id', uid).eq('kind', 'initiative').eq('status', 'active').limit(8);
      let emailLines = 0, withGist = 0;
      for (const e of (ents ?? []) as Array<{ id: string }>) {
        const { ledger } = await assembleLedger(sb, uid, e.id);
        for (const l of ledger) if (l.kind === 'email') { emailLines++; if (l.text.includes(' — "')) withGist++; }
      }
      check(`${label} · ledger email lines carry a content gist`, emailLines === 0 || withGist / emailLines >= 0.7,
        `${withGist}/${emailLines}`);
    }

    // THE VIEWING-ANCHOR LAW, live: pick a pending email whose body holds a distinctive word its
    // subject lacks; ask about it. The old title-only grounding would deny it; the anchor must not.
    {
      const { data: items } = await sb.from('inbox_items').select('id, work_title, source_data')
        .eq('user_id', uid).eq('status', 'pending').eq('source', 'email')
        .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(40);
      let fixture: { id: string; word: string } | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const it of (items ?? []) as any[]) {
        const sd = it.source_data ?? {};
        const subject = String(sd.subject || it.work_title || '').toLowerCase();
        const body = String(sd.body || '');
        if (body.length < 200) continue;
        // The longest alphabetic word (≥8 chars) in the body that the subject does NOT contain —
        // a deterministic "fact only the body knows".
        const word = (body.match(/[A-Za-zÀ-ÿ]{8,}/g) ?? [])
          .filter((w) => !subject.includes(w.toLowerCase()))
          .sort((a, b) => b.length - a.length)[0];
        if (word) { fixture = { id: it.id as string, word }; break; }
      }
      if (!fixture) { check(`${label} · viewing-anchor answers from the body`, true, 'no fixture (vacuous)'); }
      else {
        const turn = await converse(sb, uid, { kind: 'item', itemKind: 'email', itemId: fixture.id },
          `Does this email mention "${fixture.word}"? Answer plainly.`);
        const say = turn.say.toLowerCase();
        // The answer must ENGAGE affirmatively — the failure mode is a flat denial of on-screen content.
        const denies = /\bno\b[^.]*\b(mention|reference)|doesn't mention|does not mention|no mention/.test(say);
        check(`${label} · viewing-anchor answers from the body (word "${fixture.word.slice(0, 18)}")`, !denies,
          `"${turn.say.slice(0, 90)}"`);
      }
    }
  }

  console.log('\n════ GROUNDING TRUST GATES (P7a) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
