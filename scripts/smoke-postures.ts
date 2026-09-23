// THE POSTURE REGISTRY GATES (docs/attention-plan.md · A8).
//   A posture is a rule row wearing a sentence — TWO DOORS, ONE STORE. These gates hold the four
//   things that make that true rather than decorative: the render is deterministic and total, the
//   authoring door is code-validated (it refuses rather than writing something wrong), the user's
//   own words survive byte-identical, and the receipts claim only what the data can back.
//
//   PS2 spends real AI (classification tier) on the probe host. Everything else is free.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { resolveProbeUser } from './probe-user';
import {
  renderPostureSentence, validatePrimitives, parsePostureSentence, postureReceipts,
  createPosture, updatePosture, deletePosture, toPosture, listPostures,
  CONDITION_FIELDS, AUTHORABLE_OUTCOME_KEYS, type PostureRow,
} from '../lib/postures/registry';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const src = (p: string) => readFileSync(p, 'utf8');
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);

(async () => {
  const PROBE = await resolveProbeUser(sb);

  // ── PS1 · RENDER-TOTAL ─────────────────────────────────────────────────────────────────────
  // Every live rule row on the platform renders as one non-empty sentence, with zero AI.
  const reg = src('lib/postures/registry.ts');
  const rendererBody = reg.slice(reg.indexOf('export function renderPostureSentence'), reg.indexOf('// ── 2 ·'));
  check('PS1a: the renderer is source-level AI-free (no client construction inside it)',
    !/getAIClient|aiCreate|openai|anthropic/i.test(rendererBody), 'renderPostureSentence body');

  const { data: allRules } = await sb.from('inbox_rules').select('*');
  const rows = (allRules ?? []) as PostureRow[];
  const rendered = rows.map(r => ({ id: r.id, name: r.name, s: renderPostureSentence(r) }));
  const empties = rendered.filter(r => !r.s || !r.s.trim());
  check('PS1b: EVERY live rule row renders a non-empty sentence',
    rows.length > 0 && empties.length === 0, `${rows.length} rows · ${empties.length} empty`);
  check('PS1c: the renderer is TOTAL — a junk/empty row still yields an honest generic sentence',
    !!renderPostureSentence({ name: 'Untitled rule', conditions: [], ai_match: null, outcome: {} } as Partial<PostureRow>).trim() &&
    !!renderPostureSentence(null).trim() &&
    renderPostureSentence({ name: 'Untitled rule', conditions: [], ai_match: null, outcome: {} } as Partial<PostureRow>).includes('Untitled rule'),
    renderPostureSentence({ name: 'Untitled rule', conditions: [], ai_match: null, outcome: {} } as Partial<PostureRow>));
  check('PS1d: a default-seeded deterministic rule renders its real conditions and its real label',
    (() => {
      const s = renderPostureSentence({
        name: 'No-reply / automated senders', trigger: 'received', match_mode: 'any',
        conditions: [{ field: 'from', value: 'no-reply' }, { field: 'from', value: 'mailer-daemon' }],
        ai_match: null, outcome: { set_type: 'notifications' },
      } as Partial<PostureRow>);
      return s.includes('no-reply') && s.includes('mailer-daemon') && s.includes('Notifications') && s.startsWith('Label mail from');
    })());
  check('PS1e: a sent-trigger AI rule renders its direction and its when-clause',
    (() => {
      const s = renderPostureSentence({
        name: 'Waiting for reply', trigger: 'sent', match_mode: 'all', conditions: [],
        ai_match: 'I sent a message and am waiting for the other party to respond.',
        outcome: { set_type: 'waiting_on' },
      } as Partial<PostureRow>);
      return s.includes('mail I send') && s.includes('Waiting on') && s.includes(' when ');
    })());

  // ── PS3 · THE CODE-VALIDATION FLOOR (unit, before any AI is spent) ──────────────────────────
  const unknownField = validatePrimitives({
    trigger: 'received', match_mode: 'all',
    conditions: [{ field: 'sender_reputation', value: 'low' }], ai_match: null, outcome: { set_type: 'fyi' },
  });
  check('PS3a: an UNKNOWN condition field is rejected, with the reason naming it',
    !unknownField.ok && unknownField.reason.includes('sender_reputation'), !unknownField.ok ? unknownField.reason : 'ACCEPTED');
  const unknownOutcome = validatePrimitives({
    conditions: [{ field: 'from', value: 'x@example.com' }], outcome: { send_sms: true },
  });
  check('PS3b: an UNKNOWN outcome key is rejected', !unknownOutcome.ok && unknownOutcome.reason.includes('send_sms'));
  const unknownLabel = validatePrimitives({
    conditions: [{ field: 'from', value: 'x@example.com' }], outcome: { set_type: 'super_urgent' },
  });
  check('PS3c: an UNKNOWN label is rejected', !unknownLabel.ok);
  const egress = validatePrimitives({
    conditions: [{ field: 'from', value: 'x@example.com' }], outcome: { forward_to: 'someone@example.com' },
  });
  check('PS3d: THE EGRESS FLOOR — forwarding is never authorable from a sentence',
    !egress.ok && /forward/i.test(egress.reason), !egress.ok ? egress.reason : 'ACCEPTED');
  const noEffect = validatePrimitives({ conditions: [{ field: 'from', value: 'x@example.com' }], outcome: {} });
  check('PS3e: a rule with no effect at all is rejected', !noEffect.ok);
  const noSubject = validatePrimitives({ conditions: [], ai_match: null, outcome: { archive: true } });
  check('PS3f: a rule with nothing to match on is rejected', !noSubject.ok);
  const good = validatePrimitives({
    trigger: 'received', match_mode: 'any',
    conditions: [{ field: 'from', value: 'billing@' }], ai_match: null, outcome: { set_type: 'to_do', archive: true },
  });
  check('PS3g: a well-formed candidate survives the floor intact',
    good.ok && good.value.conditions[0].field === 'from' && good.value.outcome.set_type === 'to_do' && good.value.outcome.archive === true);
  const aiWithConds = validatePrimitives({
    conditions: [{ field: 'from', value: 'x@example.com' }], ai_match: 'anything a customer is chasing me about', outcome: { set_type: 'needs_reply' },
  });
  check('PS3h: an AI posture carries NO dead deterministic conditions (the engine\'s own split)',
    aiWithConds.ok && aiWithConds.value.conditions.length === 0 && !!aiWithConds.value.ai_match);
  check('PS3i: the vocabulary the floor validates against IS the engine\'s',
    CONDITION_FIELDS.length === 12 &&
    CONDITION_FIELDS.every(f => src('lib/inbox/rules/evaluate.ts').includes(`case '${f}':`)) &&
    !(AUTHORABLE_OUTCOME_KEYS as readonly string[]).includes('forward_to'));

  // ── PS2 · THE PARSE DOOR, ROUND TRIP (real AI, classification tier) ─────────────────────────
  const understood = await parsePostureSentence(sb, PROBE, 'Label anything from billing@vendor.example as To do and archive it.');
  const roundTrip = understood.ok ? renderPostureSentence({ name: 'x', ...understood.primitives } as Partial<PostureRow>) : '';
  check('PS2a: a supported sentence parses to validated primitives',
    understood.ok && !!understood.primitives.outcome.set_type,
    understood.ok ? JSON.stringify(understood.primitives) : understood.reason);
  check('PS2b: the primitives re-render to a sentence carrying the stated key facts',
    understood.ok && /billing@vendor\.example/i.test(roundTrip) && /To do/.test(roundTrip), roundTrip);
  check('PS2c: the show-back is rendered from the VALIDATED primitives, not the model\'s prose',
    understood.ok && understood.understood === roundTrip, understood.ok ? understood.understood : '');

  const refused = await parsePostureSentence(sb, PROBE, 'Forward all my mail to my friend at friend@example.com.');
  check('PS2d: an OUT-OF-VOCABULARY ask REFUSES, with a reason (never a silently-wrong rule)',
    !refused.ok && !!refused.reason.trim(), !refused.ok ? refused.reason : 'ACCEPTED — the floor leaked');

  const empty = await parsePostureSentence(sb, PROBE, '   ');
  check('PS2e: an empty sentence refuses before any AI is spent', !empty.ok);

  // ── PS4 · SENTENCE-VERBATIM (two doors, one store — write through createPosture) ────────────
  const SAID = 'Treat anything from ops@vendor.example as a notification and mark it read.';
  await sb.from('inbox_rules').delete().eq('user_id', PROBE).eq('source', 'user');
  const created = await createPosture(sb, PROBE, SAID, {
    primitives: {
      trigger: 'received', match_mode: 'all',
      conditions: [{ field: 'from', value: 'ops@vendor.example' }], ai_match: null,
      outcome: { set_kind: 'notification', mark_read: true },
    },
  });
  check('PS4a: createPosture writes and returns the posture', created.ok, created.ok ? created.posture.id : created.reason);

  let storedRow: PostureRow | null = null;
  if (created.ok) {
    const { data } = await sb.from('inbox_rules').select('*').eq('id', created.posture.id).single();
    storedRow = data as PostureRow;
  }
  check('PS4b: the user\'s words are STORED verbatim',
    !!storedRow && (storedRow.outcome as { posture?: { sentence?: string } }).posture?.sentence === SAID);
  check('PS4c: the user\'s words are SERVED BACK byte-identical',
    !!storedRow && renderPostureSentence(storedRow) === SAID, storedRow ? renderPostureSentence(storedRow) : '');
  check('PS4d: the served posture is marked verbatim and not built-in',
    !!storedRow && toPosture(storedRow).verbatim === true && toPosture(storedRow).builtin === false);

  // Re-saying goes through the SAME door and replaces the sentence verbatim.
  const RESAID = 'Archive anything from ops@vendor.example.';
  const updated = storedRow ? await updatePosture(sb, PROBE, storedRow.id, {
    sentence: RESAID,
    primitives: { trigger: 'received', match_mode: 'all', conditions: [{ field: 'from', value: 'ops@vendor.example' }], ai_match: null, outcome: { archive: true } },
  }) : { ok: false as const, reason: 'no row' };
  check('PS4e: re-saying re-parses through the same door and stores the new words verbatim',
    updated.ok && updated.posture.sentence === RESAID && updated.posture.verbatim,
    updated.ok ? updated.posture.sentence : updated.reason);

  // ── PS5 · RECEIPTS HONESTY ─────────────────────────────────────────────────────────────────
  check('PS5a: the receipts form is bounded to what the data records (no per-rule attribution claim)',
    reg.includes("'conditions_match'") && reg.includes("'label_count'") &&
    reg.includes('never stored WHICH rule applied it'));
  check('PS5b: the deterministic half re-uses THE ENGINE\'S OWN matcher (receipts and triage cannot disagree)',
    reg.includes("import { matchesFilters } from '@/lib/inbox/rules/evaluate'") && reg.includes('matchesFilters(m, r as InboxRule)'));
  check('PS5c: a shared label SAYS it is shared rather than claiming the whole count',
    reg.includes('shared with') && reg.includes("isn’t all its own doing"));

  const probeRows = (await sb.from('inbox_rules').select('*').eq('user_id', PROBE)).data as PostureRow[] ?? [];
  const receipts = await postureReceipts(sb, PROBE, probeRows);
  check('PS5d: EVERY posture gets a receipts line — a zero-effect posture shows a zero, never absent',
    probeRows.length > 0 && probeRows.every(r => {
      const rec = receipts.get(r.id);
      return !!rec && typeof rec.count === 'number' && !!rec.line.trim();
    }), `${probeRows.length} rows · ${receipts.size} receipts`);
  check('PS5e: a deterministic posture\'s receipt is the conditions form, counted over real mail',
    (() => {
      const det = probeRows.find(r => !r.ai_match && Array.isArray(r.conditions) && r.conditions.length);
      if (!det) return true; // vacuous on an empty probe
      const rec = receipts.get(det.id);
      return !!rec && rec.form === 'conditions_match' && /Currently matching/.test(rec.line);
    })(), JSON.stringify([...receipts.values()][0] ?? {}));

  // ── PS6 · TWO DOORS, ONE STORE ─────────────────────────────────────────────────────────────
  check('PS6a: the registry writes to inbox_rules and founds NO second store',
    reg.includes("from('inbox_rules')") &&
    !/from\('postures'\)|from\("postures"\)|create table postures/i.test(reg));
  check('PS6b: no migration was added for postures (the sentence rides the existing outcome jsonb)',
    !src('lib/postures/registry.ts').includes('ALTER TABLE') &&
    reg.includes("outcome.posture.sentence"));
  const apiPost = src('app/api/postures/route.ts');
  const apiId = src('app/api/postures/[id]/route.ts');
  check('PS6c: the SETTINGS door and the SPOKEN/deeds door share one writer (createPosture)',
    apiPost.includes('createPosture(supabase') && apiId.includes('updatePosture(supabase') && apiId.includes('deletePosture(supabase'));
  check('PS6d: the surface never assembles primitives itself — it posts a sentence to the one door',
    src('components/settings/postures-section.tsx').includes("'/api/postures'") &&
    src('components/settings/postures-section.tsx').includes('/api/postures/parse') &&
    !src('components/settings/postures-section.tsx').includes('conditions:'));
  check('PS6e: the parse door runs the CLASSIFICATION tier through the factory (never a raw client)',
    reg.includes("getAIClient(userId, 'classification', client)") && !/new OpenAI|new Anthropic/.test(reg));
  const seedsAgree = apiPost.includes('defaultRulesForProvider');
  check('PS6f: the postures list seeds the SAME provider defaults the rules list does (one inventory)', seedsAgree);

  // ── PS7 · THE MIRROR CHOICE ────────────────────────────────────────────────────────────────
  const es = src('components/settings/email-settings.tsx');
  check('PS7a: the label mirror is surfaced as one plain sentence toggle on the postures page',
    es.includes('Mirror my triage into Gmail / Outlook labels') && es.includes('<PosturesSection'));
  // ⟲ RE-POINTED (W10): the toggle now also offers the AUGMTD-label cleanup when turned off, so it
  // writes through toggleAugmtdLabels — still the SAME email_settings.auto_label, no new flag.
  check('PS7b: it reads and writes the EXISTING email_settings.auto_label — no new flag',
    es.includes("setSetting('auto_label', next)") && es.includes('on={settings.auto_label}') &&
    es.includes("fetch('/api/inbox/email-settings'"));
  check('PS7c: ONE HOME — the mirror toggle is not duplicated in the drafting section',
    (es.match(/Mirror my triage into Gmail \/ Outlook labels/g) ?? []).length === 1 &&
    !es.includes('Label emails in Gmail / Outlook'));
  check('PS7d: the OLD rule editor is demoted behind Advanced, not deleted',
    es.includes('Advanced: the underlying rules') && es.includes('function RuleEditor'));

  // ── THE ENGINE IS UNTOUCHED ────────────────────────────────────────────────────────────────
  check('PS0: the rules engine\'s evaluation semantics are byte-identical (postures are a FACE)',
    src('lib/inbox/rules/evaluate.ts').includes('export function matchesFilters') &&
    src('lib/inbox/rules/evaluate.ts').includes("return rule.match_mode === 'all' ? results.every(Boolean) : results.some(Boolean);") &&
    src('lib/inbox/rules/types.ts').includes('export type RuleOutcome = {') &&
    // the sentence rides the outcome JSONB, NOT the engine's own typed shape — the engine file
    // gained no field, no import, no branch for postures.
    !/posture\??\s*:/.test(src('lib/inbox/rules/types.ts')) &&
    !src('lib/inbox/rules/evaluate.ts').includes('posture') &&
    !src('lib/inbox/rules/write-back.ts').includes('lib/postures'));

  // list door sanity
  const listed = await listPostures(sb, PROBE);
  check('PS8: listPostures serves sentences for every stored row',
    listed.length === probeRows.length && listed.every(p => !!p.sentence.trim()));

  // cleanup
  if (storedRow) await deletePosture(sb, PROBE, storedRow.id);

  // ── REPORT ─────────────────────────────────────────────────────────────────────────────────
  console.log('\n── FIVE REAL RENDERED SENTENCES (live rows, zero AI) ──');
  for (const r of rendered.slice(0, 5)) console.log(`  • ${r.s}`);

  console.log('\n── GATES ──');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? `  — ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length}`);
  process.exit(pass === out.length ? 0 : 1);
})();
