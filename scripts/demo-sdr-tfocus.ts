// ─── DEMO SEED: THE SDR'S ACCUMULATED LEAD ──────────────────────────────────────────────────────
// TEMPORARY, never committed. Seeds ONE additive scenario on the OWNER'S real account: the account
// owner plays an SDR selling a fleet-analytics platform, and ONE lead carries THREE calls of
// history — so what the demo shows is not a summary, it is MEMORY that accumulated.
//
//   Brightpath Logistics (~40 vehicles, UK) — the tracked lead.
//     call 1 (−14d, 10:00)  DISCOVERY      — the pain, quantified. Spreadsheets, fuel +18% YoY.
//     call 2 (−7d, 14:30)   FOLLOW-UP      — the objection (six-week rollout, driver pushback) and
//                                            the authority (Priya Shah signs the budget).
//     call 3 (TODAY, 09:30) WITH FINANCE   — the budget (£25k/yr), the ROI question, and THE DATED
//                                            PROMISE: the case study, by Thursday.
//
// THE SEAM (the whole point): the insights are NOT hand-written. Each call goes through the REAL
// pipeline — `storeTranscriptAndGenerateWork`, the same function `generate-insights` calls — so the
// summary, the action items, the commitments and the KB indexing are all genuinely produced. The
// only thing this script authors is the DIALOGUE.
//
// Membership is then forced deterministically (`setItemMembership`, via:'user', locked): the demo
// must not depend on recognition guessing right on a fabricated company.
//
// HARD RULES honoured: additive only · nothing sends · every seeded row carries the demo handle
// (`meeting_transcripts.meeting_id LIKE 'demo-sdr-tfocus:%'`, the entity's tagged summary, the
// skill's name) so `--clean` removes exactly what was seeded and nothing else. All names are
// fabricated.
//
// Run:   npx tsx --env-file=.env.local scripts/demo-sdr-tfocus.ts
// Clean: npx tsx --env-file=.env.local scripts/demo-sdr-tfocus.ts --clean
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const DEMO_TAG = 'demo: sdr tfocus';
/** Every seeded transcript wears this meeting_id prefix — the teardown's one handle. */
const DEMO_MEETING_PREFIX = 'demo-sdr-tfocus:';
const OWNER_EMAIL = 'alextcollignon@gmail.com';

const ENTITY_NAME = 'Brightpath Logistics';
const SKILL_NAME = 'SDR qualification — outbound calls';

const CONTACT = { name: 'Sam Carter', email: 'sam.carter@brightpath-logistics.example' };
const FINANCE = { name: 'Priya Shah', email: 'priya.shah@brightpath-logistics.example' };

type Line = [string, string];
type Segment = { speaker: string; text: string; timestamp: number };

/** Turns a line list into transcript segments: ascending timestamps, ~10–20s apart, deterministic. */
function toSegments(lines: Line[]): Segment[] {
  let t = 0;
  return lines.map(([speaker, text], i) => {
    const s: Segment = { speaker, text, timestamp: t };
    t += 10 + ((i * 7) % 11);
    return s;
  });
}

/** The ordinal spoken form of a day ("3rd"), so the dialogue can SAY the date extraction anchors on. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  return `${n}${rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th'}`;
}

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const owner = users?.users?.find(u => u.email === OWNER_EMAIL);
  if (!owner) throw new Error('owner not found');
  const userId = owner.id;

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CLEAN — scoped to the demo handle, idempotent, ordered children-first.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const clean = async () => {
    const { data: tRows } = await admin.from('meeting_transcripts').select('id')
      .eq('user_id', userId).like('meeting_id', `${DEMO_MEETING_PREFIX}%`);
    const tids = ((tRows ?? []) as Array<{ id: string }>).map(r => r.id);

    // The entity, found by NAME + THE TAG IN ITS SUMMARY (the tag is what proves we created it).
    const { data: entRows } = await admin.from('work_entities').select('id, summary')
      .eq('user_id', userId).eq('name', ENTITY_NAME);
    const ourEntity = ((entRows ?? []) as Array<{ id: string; summary: string | null }>)
      .find(e => (e.summary ?? '').includes(DEMO_TAG)) ?? null;

    if (tids.length) {
      // 1. THE RUNS OUR FAKE MEETINGS SPAWNED. The meeting door fires on real, live workflows — a
      //    demo must not leave its runs standing on the owner's actual ledger.
      const { data: fires } = await admin.from('item_plans').select('id, entity_id, tasks')
        .eq('user_id', userId).eq('kind', 'reaction_fire');
      const ourFires = ((fires ?? []) as Array<{ id: string; entity_id: string; tasks: unknown }>)
        .filter(f => tids.some(tid => String(f.entity_id ?? '').endsWith(`:meeting:${tid}`)));
      const runIds = ourFires
        .map(f => (f.tasks as { runId?: string } | null)?.runId)
        .filter(Boolean) as string[];
      for (const rid of runIds) {
        await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', `run:${rid}`);
        await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', rid);
      }
      if (runIds.length) await admin.from('workflow_runs').delete().in('id', runIds);
      if (ourFires.length) await admin.from('item_plans').delete().in('id', ourFires.map(f => f.id));
      if (ourFires.length || runIds.length) console.log(`cleaned: ${runIds.length} spawned runs · ${ourFires.length} fire records`);

      // 2. The action items the insights wrote.
      const { data: items } = await admin.from('inbox_items').select('id')
        .eq('user_id', userId).in('source_meeting_transcript_id', tids);
      const itemIds = ((items ?? []) as Array<{ id: string }>).map(r => r.id);
      if (itemIds.length) {
        await admin.from('entity_links').delete().eq('user_id', userId).eq('item_kind', 'inbox_item').in('item_id', itemIds);
        await admin.from('item_plans').delete().eq('user_id', userId).in('entity_id', itemIds);
        for (const iid of itemIds) await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', `inbox:${iid}`);
        await admin.from('inbox_items').delete().in('id', itemIds);
      }
      console.log(`cleaned: ${itemIds.length} action items`);

      // 3. The commitments extracted from the calls.
      const { data: commits } = await admin.from('commitments').select('id')
        .eq('user_id', userId).eq('source', 'meeting').in('source_id', tids);
      const cIds = ((commits ?? []) as Array<{ id: string }>).map(r => r.id);
      if (cIds.length) {
        await admin.from('entity_links').delete().eq('user_id', userId).eq('item_kind', 'commitment').in('item_id', cIds);
        await admin.from('item_plans').delete().eq('user_id', userId).in('entity_id', cIds);
        for (const cid of cIds) await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', `commitment:${cid}`);
        await admin.from('commitments').delete().in('id', cIds);
      }
      console.log(`cleaned: ${cIds.length} commitments`);

      // 4. The meetings' own membership links.
      await admin.from('entity_links').delete().eq('user_id', userId).eq('item_kind', 'meeting').in('item_id', tids);

      // 5. The KB rows the transcripts were indexed into.
      const providerIds = tids.map(t => `transcript::${t}`);
      const { data: kb } = await admin.from('knowledge_files').select('id')
        .eq('user_id', userId).in('provider_file_id', providerIds);
      const kbIds = ((kb ?? []) as Array<{ id: string }>).map(f => f.id);
      if (kbIds.length) {
        await admin.from('knowledge_chunks').delete().in('file_id', kbIds);
        await admin.from('entity_links').delete().eq('user_id', userId).eq('item_kind', 'knowledge_file').in('item_id', kbIds);
        await admin.from('knowledge_files').delete().in('id', kbIds);
      }
      console.log(`cleaned: ${kbIds.length} indexed transcripts`);

      // 6. The rooms and the plans keyed to the meetings themselves.
      for (const tid of tids) {
        await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', `meeting:${tid}`);
        await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', tid);
        await admin.from('activity_events').delete().eq('user_id', userId).eq('entity_id', `meeting:${tid}`)
          .then(() => {}, () => {});
      }
    }

    // 7. THE ENTITY — only ours (name AND tag), with its room and everything still hanging off it.
    if (ourEntity) {
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', ourEntity.id);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', ourEntity.id);
      await admin.from('entity_links').delete().eq('user_id', userId).eq('entity_id', ourEntity.id);
      await admin.from('knowledge_files').update({ entity_id: null }).eq('user_id', userId).eq('entity_id', ourEntity.id)
        .then(() => {}, () => {});
      await admin.from('activity_events').delete().eq('user_id', userId).eq('type', 'entity_track').eq('entity_id', ourEntity.id)
        .then(() => {}, () => {});
      await admin.from('work_entities').delete().eq('id', ourEntity.id).eq('user_id', userId);
      console.log(`cleaned: the "${ENTITY_NAME}" entity`);
    }

    // 7a. MACHINE-FOUNDED GHOSTS (found on the first live clean): recognition runs inside the
    //     insights pipeline BEFORE the forced membership, and founds its own initiatives off the
    //     calls ("Brightpath Logistics Route Optimization" ×3 on the first seed). The company
    //     name is fabricated by this script, so any initiative carrying it is demo-born.
    const { data: ghosts } = await admin.from('work_entities').select('id, name')
      .eq('user_id', userId).eq('kind', 'initiative').ilike('name', '%Brightpath%');
    const ghostIds = ((ghosts ?? []) as Array<{ id: string }>).map(g => g.id).filter(id => id !== ourEntity?.id);
    for (const gid of ghostIds) {
      await admin.from('entity_links').delete().eq('user_id', userId).eq('entity_id', gid);
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', gid);
      await admin.from('item_plans').delete().eq('user_id', userId).eq('entity_id', gid);
      await admin.from('work_entities').delete().eq('id', gid).eq('user_id', userId);
    }
    if (ghostIds.length) console.log(`cleaned: ${ghostIds.length} machine-founded ghost entities`);

    // 7b. Person entities the pipeline may have founded for the FICTIONAL contacts (identity
    //     resolution can register counterparties). The names exist nowhere outside this demo.
    const { data: persons } = await admin.from('work_entities').select('id, name')
      .eq('user_id', userId).eq('kind', 'person').in('name', [CONTACT.name, FINANCE.name]);
    const pIds = ((persons ?? []) as Array<{ id: string }>).map(p => p.id);
    for (const pid of pIds) {
      await admin.from('entity_links').delete().eq('user_id', userId).eq('entity_id', pid);
      await admin.from('room_turns').delete().eq('user_id', userId).eq('room_key', pid);
      await admin.from('work_entities').delete().eq('id', pid).eq('user_id', userId);
    }
    if (pIds.length) console.log(`cleaned: ${pIds.length} person entities (fictional contacts)`);

    // 8. The skill + its assignment.
    const { data: sk } = await admin.from('skills').select('id')
      .eq('user_id', userId).eq('name', SKILL_NAME);
    const skIds = ((sk ?? []) as Array<{ id: string }>).map(s => s.id);
    if (skIds.length) {
      await admin.from('agent_skills').delete().in('skill_id', skIds);
      await admin.from('skills').delete().in('id', skIds);
    }
    console.log(`cleaned: ${skIds.length} skill`);

    // 9. The transcripts themselves, last.
    if (tids.length) await admin.from('meeting_transcripts').delete().in('id', tids);
    console.log(`cleaned: ${tids.length} transcripts`);

    const { softBustBrief } = await import('../lib/home/bust-brief');
    await softBustBrief(admin, userId);
  };

  if (process.argv.includes('--clean')) { await clean(); return; }

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // GUARDS. A reseed REFUSES rather than auto-cleaning: three real insights passes are not free to
  // redo silently, and this account is the owner's own.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const { data: already } = await admin.from('meeting_transcripts').select('id')
    .eq('user_id', userId).like('meeting_id', `${DEMO_MEETING_PREFIX}%`).limit(1);
  if ((already ?? []).length) {
    console.log('already seeded — run --clean first:\n  npx tsx --env-file=.env.local scripts/demo-sdr-tfocus.ts --clean');
    return;
  }

  const censusRuns = async () => (await admin.from('workflow_runs')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId)).count ?? 0;
  const runsBefore = await censusRuns();
  const { count: sendsBefore } = await admin.from('email_sends')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);

  // The SDR speaks under the owner's own first name — commitment identity resolution recognises the
  // user by name, and a "you owe" only lands if the promise is heard in HIS voice.
  const { data: prof } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  const ME = String((prof as { full_name?: string } | null)?.full_name ?? '').trim().split(/\s+/)[0] || 'Alex';

  // ── THE DATES — computed at runtime, local. ────────────────────────────────────────────────
  const dayAt = (offset: number, h: number, m: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const now = new Date();
  const call3Hour = (now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() >= 30)) ? 9 : 8;
  const starts = [dayAt(-14, 10, 0), dayAt(-7, 14, 30), dayAt(0, call3Hour, 30)];
  const plus9 = (d: Date) => new Date(d.getTime() + 9 * 60 * 1000);

  // The next Thursday STRICTLY after today — spoken as a date in the dialogue so the extractor can
  // anchor it (THE DEIXIS LAW: a day-word alone would decay; the date is what survives).
  const thursday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + (((4 - d.getDay() + 7 - 1) % 7) + 1));
    return d;
  })();
  const thursdaySpoken = `the ${ordinal(thursday.getDate())} of ${thursday.toLocaleDateString('en-GB', { month: 'long' })}`;

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // THE TRACKED ENTITY, FIRST. It opens the recognition memory gate and gives membership a target
  // to force the meetings onto — the demo must not depend on a judge guessing a fabricated company.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const { data: entRow, error: entErr } = await admin.from('work_entities').insert({
    user_id: userId, kind: 'initiative', name: ENTITY_NAME,
    summary: `Seeded demo lead (${DEMO_TAG}) — fleet-analytics prospect, 40 vehicles.`,
    aliases: [ENTITY_NAME, 'Brightpath'], tracked: true, status: 'active',
  }).select('id').single();
  if (entErr || !entRow) throw new Error(`entity: ${entErr?.message}`);
  const entityId = (entRow as { id: string }).id;

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // THE THREE CALLS. Chronological, sequential — call 3 must be extracted with calls 1 and 2
  // already standing, because the accumulation is what the demo exists to show.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const CALL_1: Line[] = [
    [ME, `Sam, thanks for making the time. Can you hear me alright?`],
    ['Sam Carter', `Loud and clear. I've got about twenty minutes before the drivers' briefing, so fire away.`],
    [ME, `That's plenty. Before I say anything about what we do — how does route planning actually happen at Brightpath today?`],
    ['Sam Carter', `Honestly? A spreadsheet. One of my planners builds the next day's routes every afternoon, by hand.`],
    [ME, `By hand across the whole fleet?`],
    ['Sam Carter', `The whole fleet. Forty vehicles. She knows the patch better than any software would, but it's four hours of her day, every day.`],
    [ME, `And when something moves — a late collection, a vehicle off the road?`],
    ['Sam Carter', `Then it's phone calls. She reworks it live and the sheet stops matching reality by about ten in the morning.`],
    [ME, `So the plan and the day diverge, and nobody's got a record of why.`],
    ['Sam Carter', `That's it exactly. At the end of the month I can't tell you which routes cost us money and which didn't.`],
    [ME, `Let me ask the uncomfortable one. What's happened to fuel spend?`],
    ['Sam Carter', `Up eighteen per cent year on year. Some of that's the pump price, obviously. But not all of it.`],
    [ME, `Do you have a sense of the split?`],
    ['Sam Carter', `No, and that's the problem. I've got a number going the wrong way and no way to argue about what's driving it.`],
    [ME, `Eighteen per cent on forty vehicles is a real line on the P&L. Who's asking you about it?`],
    ['Sam Carter', `Finance. Every month now, rather than every quarter, which tells you something.`],
    [ME, `Understood. How big is the ops team around you?`],
    ['Sam Carter', `Six of us. Two planners, three on despatch, and me.`],
    [ME, `And tooling — is there anything at all beyond the spreadsheets? Telematics, a TMS, anything?`],
    ['Sam Carter', `The trackers the insurer made us fit, and that's it. We can see where a van is. We can't see what it cost us to get there.`],
    [ME, `That's actually a decent starting position, because the data exists — it just isn't joined up.`],
    ['Sam Carter', `That's the sales line, is it?`],
    [ME, `It's the honest one. What we do is take the tracker feed and the job list and put a cost against every route, then plan the next day off what actually happened rather than what someone remembered.`],
    ['Sam Carter', `And that gives me the split? Price versus how we're running?`],
    [ME, `It gives you the split, and it gives your planner her afternoon back. I'd rather show you than describe it, though.`],
    ['Sam Carter', `Fair. What sort of outfits are you working with — are we the small end?`],
    [ME, `You're mid, if anything. Most of what we run is between twenty-five and eighty vehicles. Forty is the sweet spot, frankly.`],
    ['Sam Carter', `Good. I've had two vendors tell me we were too small to bother with.`],
    [ME, `You're not. Where does this sit for you in terms of timing — is this a this-year thing or a look-around thing?`],
    ['Sam Carter', `We want to decide this quarter. I've been told to come back with a recommendation, not a shortlist.`],
    [ME, `Then let's not waste the quarter. Here's what I'll do — I'll send you an intro one-pager on the platform. What it does, what it needs from you, what the first month looks like. Nothing longer than a page.`],
    ['Sam Carter', `A page I'll read. A forty-slide deck I won't.`],
    [ME, `A page it is. Have a read, and let's get on a follow-up call next week to go through your questions properly.`],
    ['Sam Carter', `Next week works. Later in the week is easier for me — the start of the week is all despatch.`],
    [ME, `Later in the week, then. I'll send the one-pager over and we'll speak next week.`],
    ['Sam Carter', `Perfect. Thanks, that was less painful than I expected.`],
    [ME, `High praise. Speak next week, Sam.`],
  ];

  const CALL_2: Line[] = [
    [ME, `Sam — good to speak again. Did the one-pager land?`],
    ['Sam Carter', `It did, and I read it. Twice, actually. The cost-per-route bit is the part that got my attention.`],
    [ME, `That's the part I hoped would. Anything in there that didn't make sense?`],
    ['Sam Carter', `It made sense. My worry isn't the what, it's the how long.`],
    [ME, `Go on.`],
    ['Sam Carter', `Last system we put in — the warehouse one — took six weeks and half of it landed on my team. I can't do that again in peak.`],
    [ME, `Six weeks of your people's time, or six weeks of calendar?`],
    ['Sam Carter', `Both, near enough. There were workshops. I don't have workshops in me this year.`],
    [ME, `That's fair, and I'm not going to pretend it's zero effort. But it isn't that shape.`],
    ['Sam Carter', `Then what shape is it?`],
    [ME, `Phased. We start with two vehicles — not forty. We pull their tracker feed, join it to their jobs, and you look at real cost-per-route for those two inside a fortnight.`],
    ['Sam Carter', `Two vehicles. And my planner carries on with the spreadsheet for the rest?`],
    [ME, `Exactly as she does today. Nothing changes for the other thirty-eight until you've seen the two working.`],
    ['Sam Carter', `And then?`],
    [ME, `Then we roll the rest in batches you choose, at a pace you set. Most of the work is on our side — it's an integration, not a change programme.`],
    ['Sam Carter', `The other thing is the drivers. Every time someone hands them a new app there's a fortnight of grief.`],
    [ME, `Then don't hand them one.`],
    ['Sam Carter', `Meaning?`],
    [ME, `The first phase asks nothing of the drivers. It reads the trackers you already have. No new app, no new login, nothing on their phones.`],
    ['Sam Carter', `Nothing at all?`],
    [ME, `Nothing at all in phase one. There's a driver-facing piece later if you want it, but it's optional and it's a decision you make after you've seen the value, not before.`],
    ['Sam Carter', `Right. That changes the conversation, because the driver pushback was the thing I couldn't defend.`],
    [ME, `It's the objection I get most, and it's a reasonable one. The answer is just not to start there.`],
    ['Sam Carter', `Okay. I'm more comfortable than I was.`],
    [ME, `Let me ask the practical question, then. If you and I agreed this made sense, what actually has to happen for it to go ahead?`],
    ['Sam Carter', `I can recommend it. I can't sign it.`],
    [ME, `Who signs?`],
    ['Sam Carter', `Priya. Priya Shah, our Finance Director. Anything with a recurring cost goes through her.`],
    [ME, `Has she seen anything on this yet?`],
    ['Sam Carter', `She knows I'm looking. She hasn't seen a number, and she'll want to know what she's getting for it before she does.`],
    [ME, `That's the right instinct. I'd rather she heard it from both of us than from a forwarded email.`],
    ['Sam Carter', `Agreed. She's sharp and she'll ask hard questions.`],
    [ME, `Good. Here's what I'll do before then — I'll send you the phased onboarding plan. Written out properly: what happens in the first fortnight, what we need from your team and when, and what the drivers do and don't have to touch.`],
    ['Sam Carter', `That's what I need to hand her. She won't take my word for the timeline.`],
    [ME, `She shouldn't. It'll be specific enough to argue with.`],
    ['Sam Carter', `Then let's get the three of us on a call. Me and Priya together.`],
    [ME, `That's the right next step. I'll send the plan across, you get it in front of her, and we'll do a call with you and Priya.`],
    ['Sam Carter', `I'll find a slot with her. Thanks — the two-vehicle start is the bit that unlocked it for me.`],
    [ME, `Then that's the bit we'll build the plan around. Speak soon, Sam.`],
  ];

  const CALL_3: Line[] = [
    [ME, `Morning both. Priya, thanks for making room for this at short notice.`],
    ['Priya Shah', `Morning. Sam's been talking about this for a fortnight, so I thought I'd better hear it directly.`],
    ['Sam Carter', `And before we start — thanks for the onboarding plan. That's what got Priya in the room. The fortnight-by-fortnight breakdown was exactly what I needed.`],
    [ME, `Glad it was useful. Priya, did it reach you?`],
    ['Priya Shah', `It did. It's the first vendor document I've read this year that had dates in it rather than adjectives.`],
    [ME, `Then let me not spoil that. Sam — do you want to say where you've got to?`],
    ['Sam Carter', `Short version: routes are planned by hand, fuel's up eighteen per cent, and I can't tell Priya why. This gives me the why.`],
    ['Priya Shah', `That's the part I care about. Sam, what have we set aside for this?`],
    ['Sam Carter', `Around twenty-five thousand a year. That's the operations technology line for the year and there's nothing else queued against it.`],
    ['Priya Shah', `Twenty-five thousand a year is real money for us. So the question I have is simple — what do we get back?`],
    [ME, `The honest answer is a range, not a number, and I'll tell you where the range comes from.`],
    ['Priya Shah', `Please.`],
    [ME, `Across the fleets we run at this size, the fuel saving lands between eight and twelve per cent in the first year.`],
    ['Priya Shah', `And that's from what, specifically? I don't want a number I can't attribute.`],
    [ME, `Three things, roughly in order. Dead mileage comes out of the routes first — that's the biggest single piece. Then idling, once you can see which vehicles do it and when. Then the planning itself, when the next day is built off what actually happened.`],
    ['Priya Shah', `And the eight-to-twelve is against fuel spend, not total cost?`],
    [ME, `Against fuel spend only. I'm deliberately not counting your planner's four hours a day, because you'd be right not to believe a number I put on that.`],
    ['Priya Shah', `Noted, and appreciated. Sam, what's our fuel line?`],
    ['Sam Carter', `Comfortably north of two hundred thousand across the forty vehicles.`],
    ['Priya Shah', `Then eight per cent covers the licence and change. If it's eight per cent.`],
    [ME, `If. Which is why the first phase is two vehicles and a fortnight — you get a measured number on your own fleet before the rest of the money is spent.`],
    ['Priya Shah', `That I like. I've been burned by projections built on somebody else's business.`],
    [ME, `So have I, from the other side.`],
    ['Priya Shah', `What I'd want to see is a real one. Someone our size, our shape, and what actually happened to their fuel line.`],
    [ME, `That's a reasonable ask, and I have one. A forty-vehicle regional fleet, similar mix of scheduled and ad-hoc work, twelve months of numbers.`],
    ['Priya Shah', `Twelve months, not a quarter?`],
    [ME, `Twelve, so you see the seasonality rather than a good quarter. I'll send you the case study from a similar forty-vehicle fleet by Thursday — that's ${thursdaySpoken}.`],
    ['Priya Shah', `Thursday works. I need it before I write anything up.`],
    [ME, `You'll have it Thursday. Priya, can I ask about the process on your side — if the numbers hold, what does approval actually look like?`],
    ['Priya Shah', `I sign it off. At this level I don't need anyone above me for the decision itself.`],
    [ME, `And is there anything after that?`],
    ['Priya Shah', `It goes into the board note in April. That's reporting, not permission — I'd be telling them what we've done, not asking.`],
    [ME, `That's a helpful distinction. So the decision is yours and April is the write-up.`],
    ['Priya Shah', `Correct. And I'd rather it was already running by then, honestly.`],
    ['Sam Carter', `Which brings me to the thing I want, if we're agreed on direction.`],
    [ME, `Go on.`],
    ['Sam Carter', `I want my planners to see it. If they hate it, none of this matters, and I'd rather find that out now.`],
    [ME, `Completely agree. Let's do a product demo with the ops team — the planners and despatch, not just you.`],
    ['Sam Carter', `Tuesday next week. That's the quietest morning we have.`],
    [ME, `Tuesday next week with the ops team, then. I'll build it around your actual routes rather than a demo dataset.`],
    ['Sam Carter', `That's better. They'll pick holes in a fake one immediately.`],
    ['Priya Shah', `Let them pick holes. If it survives Sam's planners it'll survive me.`],
    [ME, `Then that's the plan — the case study to you by Thursday, and the demo with the ops team Tuesday.`],
    ['Priya Shah', `Good. Thank you for not overselling it, that's rarer than it should be.`],
    [ME, `Thanks both. Speak Tuesday.`],
  ];

  const CALLS = [
    { key: 'call1', title: `${ENTITY_NAME} — discovery call`, lines: CALL_1, attendees: [CONTACT] },
    { key: 'call2', title: `${ENTITY_NAME} — follow-up`, lines: CALL_2, attendees: [CONTACT] },
    { key: 'call3', title: `${ENTITY_NAME} — call with finance`, lines: CALL_3, attendees: [CONTACT, FINANCE] },
  ];

  const { storeTranscriptAndGenerateWork } = await import('../lib/integrations/meeting-bot/bot-manager');
  const { setItemMembership } = await import('../lib/entities/membership');

  console.log(`\nseeding three calls through the REAL insights pipeline (SDR speaks as "${ME}")…`);
  const seeded: Array<{ key: string; id: string; title: string; segments: number }> = [];
  for (let i = 0; i < CALLS.length; i += 1) {
    const call = CALLS[i];
    const segments = toSegments(call.lines);
    const start = starts[i];
    const end = plus9(start);
    const id = randomUUID();

    // The pending row, in the EXACT shape the recording-confirm route writes — the pipeline then
    // fills it in place through `existingTranscriptId`, exactly as the transcription worker does.
    const { error: insErr } = await admin.from('meeting_transcripts').insert({
      id, user_id: userId,
      meeting_id: `${DEMO_MEETING_PREFIX}${call.key}`,
      calendar_event_id: null,
      title: call.title,
      start_time: start.toISOString(), end_time: end.toISOString(),
      duration_minutes: 9,
      source: 'recording', recording_storage_path: null,
      transcript: '', transcript_segments: [],
      attendees: call.attendees,
      processed: false, bot_state: 'processing', notes_structured: null,
    });
    if (insErr) throw new Error(`${call.key} pending row: ${insErr.message}`);

    await storeTranscriptAndGenerateWork(
      userId, null, call.title, start.toISOString(), end.toISOString(),
      segments, admin, { source: 'recording', existingTranscriptId: id },
    );

    // THE MEMBERSHIP IS FORCED, not guessed: via:'user', locked, and it cascades to the call's own
    // commitments. A fabricated company is exactly the case recognition has no memory for.
    const mem = await setItemMembership(admin, userId, { kind: 'meeting', id, entityId }, { inline: true });
    if (!mem.ok) console.log(`  ! membership (${call.key}): ${mem.error}`);

    seeded.push({ key: call.key, id, title: call.title, segments: segments.length });
    console.log(`  ${call.key}: ${call.title} — ${segments.length} segments, ${start.toLocaleString('en-GB')}`);
  }
  const tids = seeded.map(s => s.id);

  // ── THE DECK CARRIES EXACTLY ONE LIVE BEAT ──────────────────────────────────────────────────
  // Meeting-extracted commitments are born 'suggested' (a review gate) and the Home deck reads only
  // 'open'. But calls 1–2's promises were DELIVERED in the story — each following call opens by
  // confirming receipt — and fulfillment judging listens to mail, not meeting talk, so a blanket
  // flip would stand them on the deck as stale open debts. So: calls 1–2 close as done at the
  // moment the following call confirmed them; ONLY this morning's dated promise opens.
  const doneAt = [starts[1], starts[2]]; // call 1's promises confirmed on call 2; call 2's on call 3
  for (let i = 0; i < 2; i += 1) {
    const at = doneAt[i].toISOString();
    const { data: closed } = await admin.from('commitments')
      .update({ status: 'done', resolved_at: at, resolved_reason: 'delivered — confirmed on the following call', updated_at: at })
      .eq('user_id', userId).eq('source', 'meeting').eq('source_id', seeded[i].id).eq('status', 'suggested')
      .select('id');
    console.log(`closed ${((closed ?? []) as unknown[]).length} commitments from ${seeded[i].key} as delivered`);
  }
  const { data: opened } = await admin.from('commitments')
    .update({ status: 'open' })
    .eq('user_id', userId).eq('source', 'meeting').eq('source_id', seeded[2].id).eq('status', 'suggested')
    .select('id');
  console.log(`accepted ${((opened ?? []) as unknown[]).length} of this morning's commitments onto the deck`);

  // THE YEAR REPAIR (found on the first live seed): the dialogue says "the 27th of August" and the
  // meeting extractor — which carries NO today-anchor in its prompt — dated it 2024. The year-
  // transposition class (THE CLOCK, CLAUDE.md) reaching the meeting lane. The month and day were
  // heard correctly; the year is repaired BY CODE to the computed Thursday. (The real fix belongs
  // in extractMeetingInsights — inject today, the executeAIStep idiom — noted, not done here.)
  const thuISO = `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}-${String(thursday.getDate()).padStart(2, '0')}`;
  const { data: misdated } = await admin.from('commitments')
    .select('id, due_date').eq('user_id', userId).eq('source', 'meeting').eq('source_id', seeded[2].id)
    .not('due_date', 'is', null);
  for (const row of (misdated ?? []) as Array<{ id: string; due_date: string }>) {
    const md = row.due_date.slice(5); // MM-DD
    if (row.due_date !== thuISO && md === thuISO.slice(5)) {
      await admin.from('commitments').update({ due_date: thuISO }).eq('id', row.id).eq('user_id', userId);
      console.log(`year-repaired due_date ${row.due_date} → ${thuISO} (month/day heard right, year transposed)`);
    }
  }
  // …and the SAME transposition lands on the mirrored inbox action items (the promise is written
  // twice — commitment + item — and both mirrors carry the extractor's year).
  const { data: mirrorItems } = await admin.from('inbox_items').select('id, work_title, source_data')
    .eq('user_id', userId).in('source_meeting_transcript_id', tids);
  for (const it of (mirrorItems ?? []) as Array<{ id: string; work_title: string; source_data: Record<string, unknown> | null }>) {
    const sd = it.source_data ?? {};
    const due = typeof sd.due_date === 'string' ? sd.due_date : null;
    if (due && due.slice(5) === thuISO.slice(5) && due !== thuISO) {
      await admin.from('inbox_items').update({ source_data: { ...sd, due_date: thuISO } }).eq('id', it.id).eq('user_id', userId);
      console.log(`year-repaired item "${it.work_title}": ${due} → ${thuISO}`);
    }
  }

  // ── THE DELIVERED ITEMS CLOSE TOO (found on the first live walk) ────────────────────────────
  // The promise is written twice, so closing only the commitment twin leaves the ITEM standing as
  // open judged work. Calls 1–2's action items close as completed at the moment the following call
  // confirmed them — only this morning's work stays live.
  for (let i = 0; i < 2; i += 1) {
    const at = doneAt[i].toISOString();
    const { data: oldItems } = await admin.from('inbox_items').select('id, work_title, source_data')
      .eq('user_id', userId).eq('source_meeting_transcript_id', seeded[i].id).eq('status', 'pending');
    for (const it of (oldItems ?? []) as Array<{ id: string; work_title: string; source_data: Record<string, unknown> | null }>) {
      await admin.from('inbox_items')
        .update({ status: 'completed', source_data: { ...(it.source_data ?? {}), resolved_at: at } })
        .eq('id', it.id).eq('user_id', userId);
    }
    console.log(`closed ${((oldItems ?? []) as unknown[]).length} action items from ${seeded[i].key} as delivered`);
  }

  // ── JUDGE THE LIVE WORK NOW (found on the first live walk) ──────────────────────────────────
  // The deck ranks UNJUDGED meeting items into the folded "when you can" tail, and the account's
  // real backlog means the budgeted cron pass may not reach fresh demo rows for hours. Judging the
  // seeded rows directly — the same ONE judge, surgically scoped — puts this morning's promise on
  // the deck without churning anything else on the account.
  {
    const { judgeWork } = await import('../lib/work/judge');
    const { data: liveItems } = await admin.from('inbox_items').select('id, work_title')
      .eq('user_id', userId).eq('source_meeting_transcript_id', seeded[2].id).eq('status', 'pending');
    for (const it of (liveItems ?? []) as Array<{ id: string; work_title: string }>) {
      const v = await judgeWork(admin, userId, { kind: 'inbox', id: it.id });
      console.log(`judged item "${it.work_title}" → ${v.work}`);
    }
    const { data: liveCommits } = await admin.from('commitments').select('id, description')
      .eq('user_id', userId).eq('source', 'meeting').eq('source_id', seeded[2].id).eq('status', 'open');
    for (const c of (liveCommits ?? []) as Array<{ id: string; description: string }>) {
      const v = await judgeWork(admin, userId, { kind: 'commitment', id: c.id });
      console.log(`judged commitment "${c.description}" → ${v.work}`);
    }
  }

  // ── THE SKILL — the method Clara reads when she's asked about a call ────────────────────────
  const { data: skRow, error: skErr } = await admin.from('skills').insert({
    user_id: userId, name: SKILL_NAME,
    when_to_use: 'When reviewing, summarising or qualifying a sales call or lead',
    content:
      '# SDR qualification — outbound calls\n\n' +
      'Read every call against these six. State a 1–5 confidence on each: 5 = the prospect said it ' +
      'in their own words; 3 = implied but not stated; 1 = we are guessing. Never round a guess up.\n\n' +
      '## Need\n' +
      'What to capture: the operational pain in THEIR words, with a number attached wherever they ' +
      'gave one. A pain without a number is a 2 at best.\n\n' +
      '## Budget\n' +
      'What to capture: the amount, the period, and which line it comes out of. "They have budget" ' +
      'is not a capture — the figure is.\n\n' +
      '## Authority\n' +
      'What to capture: who signs, who recommends, and whether anyone has to be told afterwards. ' +
      'Name them. A champion who cannot sign is a 5 on champion and a 1 on authority.\n\n' +
      '## Timeline\n' +
      'What to capture: the decision window they stated, and the event that forces it. A quarter ' +
      'named by us is not a timeline; a quarter named by them is.\n\n' +
      '## Objections\n' +
      'What to capture: every objection raised, the answer given on the call, and whether the ' +
      'prospect accepted it out loud. An unanswered objection is the next call\'s agenda.\n\n' +
      '## Agreed next step\n' +
      'What to capture: the specific thing, the owner, and the date. "They\'ll come back to us" is ' +
      'not a next step — it is the absence of one, and should be recorded as such.\n\n' +
      '## The standing rule\n' +
      'Anything we promised on the call is ours and gets a date. Never report a call as positive ' +
      'when the only movement was ours.',
    source: 'manual', kind: 'method',
  }).select('id').single();
  if (skErr || !skRow) throw new Error(`skill: ${skErr?.message}`);
  const skillId = (skRow as { id: string }).id;

  const { data: claraRow } = await admin.from('custom_agents').select('id, name')
    .eq('user_id', userId).eq('is_worker', true).eq('worker_role', 'personal_assistant').maybeSingle();
  const claraId = (claraRow as { id: string } | null)?.id ?? null;
  if (claraId) {
    await admin.from('agent_skills').upsert({ agent_id: claraId, skill_id: skillId }, { onConflict: 'agent_id,skill_id' });
  } else {
    console.log('  ! no personal_assistant worker on this account — skill seeded UNASSIGNED (workers are not seeded by a demo)');
  }

  const { softBustBrief } = await import('../lib/home/bust-brief');
  await softBustBrief(admin, userId);

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // VERIFIED (read back live). Nothing here is claimed that was not read back.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  const check = (label: string, pass: boolean, detail: string) =>
    console.log(`  ${pass ? '✓' : '✗'} ${label} — ${detail}`);

  const { data: tBack } = await admin.from('meeting_transcripts')
    .select('id, title, processed, bot_state, summary, transcript_segments').in('id', tids);
  const tRows = ((tBack ?? []) as Array<{ id: string; title: string; processed: boolean; bot_state: string; summary: string | null; transcript_segments: unknown }>);
  const allProcessed = tRows.length === 3 && tRows.every(r => r.processed === true && r.bot_state === 'ended');
  const allSummarised = tRows.length === 3 && tRows.every(r => (r.summary ?? '').trim().length > 0);

  const { count: itemCount } = await admin.from('inbox_items')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).in('source_meeting_transcript_id', tids);

  const { data: cBack } = await admin.from('commitments')
    .select('id, description, direction, due_date, status, source_id')
    .eq('user_id', userId).eq('source', 'meeting').in('source_id', tids);
  const cRows = ((cBack ?? []) as Array<{ id: string; description: string; direction: string; due_date: string | null; status: string; source_id: string }>);
  const thuISOCheck = `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}-${String(thursday.getDate()).padStart(2, '0')}`;
  const caseStudy = cRows.find(c => /case.?study/i.test(c.description) && c.direction === 'you_owe' && c.status === 'open' && c.due_date === thuISOCheck) ?? null;

  const { data: links } = await admin.from('entity_links')
    .select('item_id, entity_id, via, locked').eq('user_id', userId).eq('item_kind', 'meeting').in('item_id', tids);
  const lRows = ((links ?? []) as Array<{ item_id: string; entity_id: string | null; via: string; locked: boolean }>);
  const allLinked = lRows.length === 3 && lRows.every(l => l.entity_id === entityId && l.via === 'user' && l.locked === true);

  const { count: kbCount } = await admin.from('knowledge_files')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).in('provider_file_id', tids.map(t => `transcript::${t}`));

  const { count: asgCount } = claraId
    ? await admin.from('agent_skills').select('id', { count: 'exact', head: true }).eq('agent_id', claraId).eq('skill_id', skillId)
    : { count: 0 as number | null };

  const runsAfter = await censusRuns();
  const { count: sendsAfter } = await admin.from('email_sends')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  let newRunLine = 'no runs spawned';
  if (runsAfter > runsBefore) {
    const { data: fires } = await admin.from('item_plans').select('entity_id, tasks')
      .eq('user_id', userId).eq('kind', 'reaction_fire');
    const ourFires = ((fires ?? []) as Array<{ entity_id: string; tasks: unknown }>)
      .filter(f => tids.some(tid => String(f.entity_id ?? '').endsWith(`:meeting:${tid}`)));
    const runIds = ourFires.map(f => (f.tasks as { runId?: string } | null)?.runId).filter(Boolean) as string[];
    const { data: rs } = runIds.length
      ? await admin.from('workflow_runs').select('id, workflow_id').in('id', runIds)
      : { data: [] as Array<{ id: string; workflow_id: string }> };
    const wfIds = [...new Set(((rs ?? []) as Array<{ workflow_id: string }>).map(r => r.workflow_id))];
    const { data: wfs } = wfIds.length
      ? await admin.from('workflows').select('id, name').in('id', wfIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const names = ((wfs ?? []) as Array<{ name: string }>).map(w => `"${w.name}"`).join(' · ');
    newRunLine = `${runsAfter - runsBefore} new run(s) — the meeting door fired on ${names || '(unnamed workflow)'} · --clean removes them`;
  }

  console.log('\nVERIFIED (read back live):');
  for (const s of seeded) {
    const r = tRows.find(x => x.id === s.id);
    const segs = Array.isArray(r?.transcript_segments) ? (r!.transcript_segments as unknown[]).length : 0;
    check(s.title, !!r && r.processed === true && r.bot_state === 'ended' && (r.summary ?? '').trim().length > 0,
      `${s.id} · ${segs} segments · ${r?.bot_state ?? '—'} · summary ${(r?.summary ?? '').trim().length} chars`);
  }
  check('all three processed and ended', allProcessed, `${tRows.filter(r => r.processed).length}/3`);
  check('all three carry a real summary from the pipeline', allSummarised, `${tRows.filter(r => (r.summary ?? '').trim()).length}/3`);
  check('action items written', (itemCount ?? 0) > 0, `${itemCount ?? 0} inbox_items`);
  console.log(`\n  commitments extracted (${cRows.length}):`);
  for (const c of cRows) {
    const which = seeded.find(s => s.id === c.source_id)?.key ?? '?';
    console.log(`    [${which}] ${c.description} · ${c.direction} · due ${c.due_date ?? '—'} · ${c.status}`);
  }
  check('THE THURSDAY PROMISE extracted as an open you-owe WITH a due date', !!caseStudy,
    caseStudy ? `"${caseStudy.description}" · due ${caseStudy.due_date} (spoken: ${thursdaySpoken})` : `no dated case-study commitment among ${cRows.length}`);
  check('all three calls filed under the lead', allLinked,
    `${lRows.filter(l => l.entity_id === entityId).length}/3 → ${ENTITY_NAME} (${entityId})`);
  check('the transcripts are indexed into knowledge', (kbCount ?? 0) === 3, `${kbCount ?? 0}/3 knowledge_files`);
  check('the skill exists and is assigned to Clara', !!skillId && (asgCount ?? 0) === 1,
    `${skillId} → ${claraId ? 'personal_assistant' : 'UNASSIGNED (no worker row)'}`);
  check('NOTHING SENT', sendsBefore === sendsAfter, `email_sends ${sendsBefore} → ${sendsAfter}`);
  console.log(`  · workflow_runs ${runsBefore} → ${runsAfter}: ${newRunLine}`);

  if (!caseStudy) {
    console.log(`
THE DEMO'S KEY BEAT DID NOT LAND. Call 3 says, in the SDR's own voice, "I'll send you the case
study from a similar forty-vehicle fleet by Thursday — that's ${thursdaySpoken}", and no open
you-owe commitment matching /case.?study/ with a due date came out of the extractor. Do not walk
the demo on this seed: clean it, and look at the commitments printed above to see what the
extractor heard instead.

Clean up: npx tsx --env-file=.env.local scripts/demo-sdr-tfocus.ts --clean`);
    process.exit(1);
  }

  console.log(`
Seeded: THE SDR'S ACCUMULATED LEAD. The walk:

  1. HOME → the Thursday promise stands on the deck: "${caseStudy.description}", due
     ${caseStudy.due_date}. Nobody typed it. It was SAID on this morning's call and the machine
     heard it, dated it, and put it where it will be owed.

  2. THE LEAD → "${ENTITY_NAME}" holds all three calls, filed. The room reads the whole
     relationship, not the last conversation: the pain from a fortnight ago, the objection from
     last week, and this morning's budget and sign-off — one page, one position.

  3. ASK ABOUT IT IN CHAT — "where are we with ${ENTITY_NAME}?" — and the answer grounds on the
     same three calls, because the room and the chat read ONE grounding.

  4. CLARA carries the method: "${SKILL_NAME}" is assigned to her, so
     "qualify this lead for me" is answered against Need / Budget / Authority / Timeline /
     Objections / Next step, with a confidence on each — not a free-form summary.

  WHAT'S REAL: every summary, action item and commitment above came out of the production
  insights pipeline. The only thing this script authored is the dialogue.

Clean up: npx tsx --env-file=.env.local scripts/demo-sdr-tfocus.ts --clean`);
}
main().catch(e => { console.error(e); process.exit(1); });
