// W26 · INPUT-ASK NECESSITY — "is this REALLY missing?". The input card (thread kind `input`) asks the
// user for things the work cannot go out without. A needless ask costs trust; inventing instead of
// asking loses the work. AUGMTD: the pipeline on a fresh world — understanding → judgeWork (its
// `requires` inventory) → resolveRequirements against the user's own files (world.kb) → what stays
// MISSING is the ask. Plain: the thread + the files the user has, "is there anything you'd need from
// me that isn't here?".
import { dbErr } from '../world';
import type { SurfaceAdapter, LabelField, EvalCase, RunCtx, SeededWorld } from '../types';
import { plainScaffold, parseJSON, understandAllThenJudge, matchByKeywords } from './shared';
import { CASES } from '../fixtures/input-ask';

type KbMeta = Record<string, { project?: string; origin?: 'email_attachment' | 'upload' }>;

/** Stamp the case's KB provenance (params.kbMeta) on the seeded knowledge_files rows. */
async function applyKbMeta(ctx: RunCtx, c: EvalCase, s: SeededWorld): Promise<void> {
  const meta = (c.params?.kbMeta ?? {}) as KbMeta;
  for (const [docKey, m] of Object.entries(meta)) {
    const id = s.ids[docKey];
    if (!id) throw new Error(`kbMeta names unknown kb doc "${docKey}"`);
    const patch: Record<string, unknown> = {};
    if (m.project) {
      if (!s.ids[m.project]) throw new Error(`kbMeta names unknown project "${m.project}"`);
      patch.entity_id = s.ids[m.project];
    }
    if (m.origin) patch.origin = { kind: m.origin };
    if (!Object.keys(patch).length) continue;
    const { error } = await ctx.admin.from('knowledge_files').update(patch).eq('id', id).eq('user_id', ctx.userId);
    if (error) throw new Error(`stamp kbMeta(${docKey}): ${dbErr(error)}`);
  }
}

/** The filenames the served ask names as "maybe this?" (requirements.ts suggestLine). */
async function servedSuggestions(ctx: RunCtx, itemId: string): Promise<string[]> {
  const { data, error } = await ctx.admin.from('room_turns').select('text')
    .eq('user_id', ctx.userId).eq('dedupe_key', `requires:${itemId}`).limit(1).maybeSingle();
  if (error) throw new Error(`read served ask: ${dbErr(error)}`);
  const text = String((data as { text?: string } | null)?.text ?? '');
  return [...text.matchAll(/"([^"]+)" \(maybe the /g)].map((m) => m[1]);
}

export const INPUT_ASK_FIELDS: LabelField[] = [
  {
    kind: 'enum', name: 'ask', costly: 'ask', silence: 'no_ask',
    labels: { ask: 'something only I can supply is genuinely missing, so you must ask me first', no_ask: 'nothing is missing — the work can go ahead with what is here' },
    costs: { no_ask: { ask: 2 }, ask: { no_ask: 2 } },
  },
  {
    kind: 'set', name: 'missing', weight: 0.5, when: (t) => t.ask === 'ask',
    gloss: 'the list of things you would need from me (short noun phrases), [] when nothing',
    match: (pred, truth) => matchByKeywords(pred, truth),
  },
];

export const inputAskAdapter: SurfaceAdapter = {
  id: 'judgment.input-ask',
  family: 'judgment',
  title: 'Input ask — is this really missing?',
  stage: '1a',
  producer: { file: 'lib/prepare/requirements.ts', fn: 'judgeWork → resolveRequirements', slot: 'classification', effortKey: 'work.judge' },
  tiers: ['standard', 'eu'],
  status: 'ready',
  planned: [
    { group: 'file-in-kb', count: 5, note: 'the asked-for file exists in world.kb → no_ask (it is attached, not asked)' },
    { group: 'file-not-anywhere', count: 5, note: 'the asked-for file exists nowhere → ask for it' },
    { group: 'answer-not-artifact', count: 3, note: '"confirm the Thursday time" — an answer, not a thing to attach → no_ask' },
    { group: 'our-own-artifact', count: 3, note: 'the "missing" thing is ours to produce (a summary, a deck draft) → no_ask' },
    { group: 'only-user-knows', count: 4, note: 'bank details / a signature / a decision only the user holds → ask' },
    { group: 'partially-available', count: 3, note: 'two of three documents in the KB → ask for exactly the third' },
    { group: 'project-linked', count: 2, note: 'the file lives with the same project (world.projects) → no_ask' },
    { group: 'answer-in-thread', count: 4, note: 'the fact was already given earlier in the same thread → no_ask (asking again is wrong)' },
    { group: 'answer-in-attachment', count: 2, note: 'what is asked is already attached to a message in the thread → no_ask' },
    { group: 'edge-missing', count: 2, note: 'the ask names nothing concrete ("send the stuff")', edge: 'missing' },
    { group: 'edge-irrelevant', count: 2, note: 'world.kb holds a similarly-named file for ANOTHER client → still ask', edge: 'irrelevant' },
    { group: 'edge-long', count: 2, note: 'a long RFP listing 7 required documents, 4 of them in world.kb', edge: 'long' },
    { group: 'edge-harmful', count: 2, note: 'the thread asks for the user\'s password / bank login → never an input to send on', edge: 'harmful' },
    { group: 'edge-ambiguous', count: 2, note: '"send the latest version" with two versions in world.kb', edge: 'ambiguous' },
  ],
  cases: () => CASES as EvalCase[],
  scoring: { kind: 'labelled', fields: INPUT_ASK_FIELDS, primary: { field: 'ask', metric: 'cost_weighted' } },
  estimate: () => ({ augmtd: { calls: 4, inTok: 9000, outTok: 900 }, plainIn: 2200, plainOut: 200 }),

  async produce(ctx, c, s) {
    const key = String(c.params?.item ?? s.resolved.threads[0]?.itemKey);
    // W26 LOSS DIAGNOSIS (H · world context): a KB file a real account holds WITH its body of work
    // (knowledge_files.entity_id — Phase A links a deal's attachments/documents to the deal) is
    // expressed per case as params.kbMeta { <docKey>: { project?, origin? } } and stamped here on the
    // seeded rows (ledgered → torn down with the world). world.ts cannot express it (shared file).
    await applyKbMeta(ctx, c, s);
    const v = await understandAllThenJudge(ctx, s, key);
    if ((v as { failed?: boolean }).failed) return { text: `(judge failed: ${v.reason})`, value: null };
    const requires = v.requires ?? [];
    if (!requires.length || v.work === 'none') {
      const value = inputAskAdapter.servedView!({ ask: 'no_ask', missing: [], work: v.work, options: ((v as { options?: Array<{ label: string }> }).options ?? []).map((o) => o.label) }, c, ctx.now);
      return { text: `no requirement (${v.work}) — ${v.reason}`, value };
    }
    const { resolveRequirements } = await import('../../../../../lib/prepare/requirements');
    const isCommit = s.resolved.commitments.some((x) => x.key === key);
    const t = s.resolved.threads.find((x) => x.itemKey === key);
    // W26 LOSS DIAGNOSIS (H · adapter): every product caller passes the item's entity
    // (lib/prepare/pass.ts:271/520/1323 `w.entity?.id`, app/api/items/judge/route.ts:55 reads
    // entity_links) — the staging law's provenance floor (requirements.ts stageEligible) keys on it.
    // The first cut passed none, so a same-project file could never stage. Read it the judge route's way.
    const { data: link, error: linkErr } = await ctx.admin.from('entity_links').select('entity_id')
      .eq('user_id', ctx.userId).eq('item_kind', isCommit ? 'commitment' : 'inbox_item').eq('item_id', s.ids[key])
      .not('entity_id', 'is', null).limit(1).maybeSingle();
    if (linkErr) throw new Error(`read entity link: ${dbErr(linkErr)}`);
    const r = await resolveRequirements(ctx.admin, ctx.userId, {
      itemKind: isCommit ? 'commitment' : 'inbox', itemId: s.ids[key], itemTitle: t?.subject ?? key,
      entityId: (link as { entity_id?: string } | null)?.entity_id ?? null,
      requires: requires.map((q) => ({ label: q.label, kind: q.kind ?? null })), work: v.work,
    });
    const missing = r.missing.map((m) => m.label);
    // W26 LOSS DIAGNOSIS (H · served output): the SERVED ask is the room's input_checklist turn — it
    // names unstageable-but-plausible KB hits ("I did find "X" (maybe the …)"). Captured so the report
    // tells a blind ask from a confirm-this-file ask (scored the same: both ask the user).
    const suggested = await servedSuggestions(ctx, s.ids[key]);
    return {
      text: `${v.work} · requires ${requires.map((q) => q.label).join('; ')} · have ${r.have.map((h) => h.label).join('; ') || '—'} · missing ${missing.join('; ') || '—'}${suggested.length ? ` · suggested ${suggested.join('; ')}` : ''}`,
      value: inputAskAdapter.servedView!({ ask: missing.length ? 'ask' : 'no_ask', missing, work: v.work, suggested }, c, ctx.now),
    };
  },

  /** W26 LOSS DIAGNOSIS (H · vocabulary): the product never routes a DECISION through the input
   *  checklist — the judge's `decide` verb mounts the DECISION card (componentForWork('decide') =
   *  'decision', lib/work/surface-registry.ts:64), whose whole content is "only you can make this call"
   *  = the eval's `ask` (the user must supply the choice). Mapped here; idempotent; a saved value
   *  without `work` is unchanged. */
  servedView(value0, _c, _now, text) {
    // A saved value that predates `work` recovers it from the saved produce() text
    // ("no requirement (<work>) — …" / "<work> · requires …") so --recheck alone reproduces the fix.
    let value = value0;
    if (!('work' in value) && text) {
      const m = /^no requirement \((\w+)\)/.exec(text) ?? /^(\w+) · requires /.exec(text);
      if (m) value = { ...value, work: m[1] };
    }
    if (value.work !== 'decide' || value.ask === 'ask') return value;
    const opts = Array.isArray(value.options) && value.options.length ? `: ${(value.options as string[]).join(' / ')}` : '';
    return { ...value, ask: 'ask', missing: [`decision between the options${opts}`] };
  },

  plainPrompt(c, now) {
    const key = String(c.params?.item ?? c.world.threads?.[0]?.key);
    const subj = (c.world.threads ?? []).find((t) => t.key === key)?.subject ?? '';
    return {
      user: plainScaffold(c, now,
        `I need to handle the thread "${subj}". Before you prepare my response: is there anything you would need me to provide that is NOT already in the emails or my files above? Only list what is genuinely missing.`,
        INPUT_ASK_FIELDS),
    };
  },
  parse(text) {
    const v = parseJSON(text);
    if (!v) return null;
    return { ...v, missing: Array.isArray(v.missing) ? v.missing : [] };
  },
  stubAnswer: (c) => JSON.stringify({ ask: c.truth.ask, missing: ((c.truth.missing as Array<{ keywords: string[] }>) ?? []).map((m) => m.keywords.map((k) => k.split('|')[0]).join(' ')) }),
};
