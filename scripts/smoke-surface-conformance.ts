// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SURFACE-CONFORMANCE FLOOR (Sep 22 — stabilization W4.1 slice A). Source floors only — zero AI,
// zero DB, runs in seconds.
//   · THE ADDRESS LAW (invariant 11; ADDRESS beats THE FRESH FLOOR): an opened Home conversation keeps
//     `/home?chat=<key>`; only the deliberate return to bare Home drops it.
//   · ONE COMMIT LINE (threads-plan; experience-spec law 7): no second Send on the Home deck.
//   · THE AVATAR STATUS GRAMMAR: no spinner-dots / ring spinners / tool narration in the chat surfaces.
//   · SPEECH IS COMPOSED: no first-person template under a coworker's face; role vocab lives once.
//   · THE COMPOSER: no lying Mention/Attach doors; IME-safe Enter; an aria-label; height resets.
//   · ONE THREAD COMPONENT (W4.1b): the three legacy chat panels render through ThreadTimeline +
//     ThreadComposer — no bespoke bubbles, no second Send, no spinner.
// Run: npx tsx scripts/smoke-surface-conformance.ts
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const src = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
/** Code only — comments stripped, so a law's own prose can name what it outlaws. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const ask = src('components/home/home-ask.tsx');
const askC = code(ask);
const view = src('components/home/home-view.tsx');
const viewC = code(view);

console.log('THE ADDRESS LAW (an opened conversation keeps its URL):');
{
  ok('no Home chat door rewrites the address to bare /home',
    !/replaceState\([^)]*['"]\/home['"]\s*\)/.test(askC));
  ok('ONE writer (writeChatAddress) — sets ?chat=<key>, deletes it only on a null key',
    /function writeChatAddress\(key: string \| null\)/.test(ask)
    && /searchParams\.set\('chat', key\)/.test(ask) && /searchParams\.delete\('chat'\)/.test(ask));
  ok('opening a chief chat asserts its address (loadRoom)',
    /const loadRoom = \(key: string\) => \{[\s\S]{0,700}writeChatAddress\(key\)/.test(ask));
  ok('opening a coworker DM asserts its address (loadWorkerRoom)',
    /const loadWorkerRoom = async \(key: string\) => \{[\s\S]{0,500}writeChatAddress\(key\)/.test(ask));
  ok('a new chat earns its address once its first turn persists (persistTurn)',
    /fetch\('\/api\/room\/turns'[\s\S]{0,1400}writeChatAddress\(roomKey\)/.test(ask));
  ok('the sidebar Home reset (bare Home) drops the address',
    /const onHomeReset = \(\) => \{[\s\S]{0,900}writeChatAddress\(null\)/.test(ask));
  ok('New chat drops the address until its first turn',
    /const onNew = \(\) => \{[^\n]*writeChatAddress\(null\)/.test(ask));
  ok('THE FRESH FLOOR still governs bare /home (the stale key clears on a bare landing)',
    /THE FRESH FLOOR[\s\S]{0,900}localStorage\.removeItem\(CHAT_KEY_LS\)/.test(ask));
}

console.log('ONE COMMIT LINE (no second Send on the Home deck):');
{
  const m = view.match(/function FollowUpItem\([\s\S]*?\n\}\n/);
  const fu = m ? m[0] : '';
  ok('FollowUpItem exists', !!fu);
  ok('FollowUpItem carries no textarea and no Send — "Follow up" opens the deep-dive stage',
    !!fu && !/<textarea/.test(fu) && !/>\s*\{?sending \? 'Sending…' : 'Send'\}?\s*</.test(fu) && !/method: 'PATCH'/.test(fu)
    && /router\.push\(`\/item\/\$\{f\.id\}\?kind=followup`\)/.test(fu));
}

console.log('THE AVATAR STATUS GRAMMAR (no spinners / dots / narration in the stream):');
{
  ok('the Home working bubble has no pulsing dot and no in-stream stage line',
    !/h-1\.5 w-1\.5 animate-pulse rounded-full/.test(askC) && !/\}\{stage \?\? 'Thinking…'\}/.test(askC));
  ok('the stage rides the working face’s hover hint', /statusHint: stage \?\? 'Thinking…'/.test(ask));
  ok('before the first token the bubble carries no body (the face is the status)',
    /cards: liveText \? \[/.test(ask));
  ok('the Home "Syncing your inbox" state has no ring spinner',
    /Syncing your inbox/.test(view) && !/animate-spin/.test(viewC));
  for (const f of ['components/shared/ai-chat-panel.tsx', 'components/meetings/meeting-chat-sidebar.tsx', 'components/shared/chat-sidebar.tsx']) {
    const s = code(src(f));
    ok(`${f}: no bouncing dots, no spin spinners, no sparkles glyph`,
      !!s && !/animate-bounce/.test(s) && !/animate-spin/.test(s) && !/SparklesIcon/.test(s));
    // ⟲ RE-POINTED (W4.1b): the face used to be a <SeatAvatar> the panel drew beside its own bubble.
    // The panels now render THROUGH the kit, so the seat reaches the face as the actor bubble's
    // actorId/actorName (the kit's AvatarStatus draws it) — the law (the ONE seat hook's face, never a
    // glyph) is unchanged; its seam moved.
    ok(`${f}: the assistant wears the seat's face (useCosSeat → the kit's actor bubble)`,
      /useCosSeat\(\)/.test(s) && /actorId = seat\?\.agentId \?\? 'cos'/.test(s) && /type: 'actor_bubble'/.test(s));
  }
}

console.log('ONE THREAD COMPONENT (W4.1b — the legacy chat panels render through the kit):');
{
  for (const f of ['components/shared/ai-chat-panel.tsx', 'components/meetings/meeting-chat-sidebar.tsx', 'components/shared/chat-sidebar.tsx']) {
    const raw = src(f);
    const s = code(raw);
    ok(`${f}: messages render through <ThreadTimeline items={…}>`, /<ThreadTimeline items=\{items\} \/>/.test(s) && /const items: ThreadItem\[\]/.test(s));
    ok(`${f}: the box is the kit's <ThreadComposer> — no bespoke <textarea>`, /<ThreadComposer\b/.test(s) && !/<textarea\b/.test(s));
    ok(`${f}: user turns are the kit's user bubble`, /type: 'user_bubble'/.test(s));
    ok(`${f}: no bespoke bubble markup (rounded-br-sm / bg-neutral-100 bubble / justify-end row)`,
      !/rounded-br-sm/.test(s) && !/justify-end/.test(s) && !/px-3(\.5)? py-2 bg-neutral-100/.test(s));
    ok(`${f}: the wait is the face's working status, never dots or a spinner`,
      /'working'/.test(s) && !/animate-(bounce|spin|pulse)/.test(s));
    ok(`${f}: no second send button (the kit's composer owns Send)`, !/PaperAirplaneIcon className="w-3\.5 h-3\.5 text-white"/.test(s));
  }
  const ai = code(src('components/shared/ai-chat-panel.tsx'));
  ok('ai-chat-panel: MessageContent (action/compose/workflow buttons) mounts as a `custom` kit card',
    /kind: 'custom' as const/.test(ai) && /<MessageContent/.test(ai));
  ok('ai-chat-panel: the live answer keeps its own id (MessageContent mount-once effects stay honest)',
    /id: 'live'/.test(ai) && /id: `h:\$\{i\}`/.test(ai));
  ok('ai-chat-panel: file chips + attach + sources ride the composer slots; the parent ref still focuses',
    /attachmentsSlot=\{/.test(ai) && /attachSlot=\{/.test(ai) && /trailingSlot=\{/.test(ai) && /inputRef=\{chatInputRef\}/.test(ai));
  const mt = code(src('components/meetings/meeting-chat-sidebar.tsx'));
  ok('meeting-chat-sidebar: MessageContent mounts as a `custom` card; quick prompts are utterance chips',
    /kind: 'custom'/.test(mt) && /chips=\{isEmpty \? QUICK_PROMPTS\.map/.test(mt));
  const comp = src('components/thread/thread-composer.tsx');
  ok('the kit composer offers the ports their seams (attachmentsSlot · inputRef · controlled height reset)',
    /attachmentsSlot\?: React\.ReactNode/.test(comp) && /useImperativeHandle\(inputRef/.test(comp)
    && /if \(text === '' && ref\.current\) ref\.current\.style\.height = 'auto'/.test(comp));
}

console.log('SPEECH IS COMPOSED (no template under a face):');
{
  ok('no first-person "Hi — I\'m" template in the Home/DM panel', !/Hi — I'm/.test(askC));
  ok('no second name-keyed specialty/intro map (workerIntroFor / specialty[…] dead)',
    !/workerIntroFor/.test(askC) && !/const specialty: Record<string, string>/.test(askC));
  ok('the first contact is CHROME (faceless event line), excluded from the brain’s history',
    /chrome: true/.test(ask) && /if \(t\.chrome\) \{[\s\S]{0,300}type: 'event_line'/.test(ask)
    && /turns\.filter\(\(t\) => !t\.chrome\)/.test(ask));
  const roles = src('lib/workers/roles.ts');
  ok('role vocabulary lives ONCE in lib/workers/roles (ROLE_SPECIALTIES · ROLE_STARTERS)',
    /export const ROLE_SPECIALTIES/.test(roles) && /export const ROLE_STARTERS/.test(roles) && /ROLE_SPECIALTIES\[role\]/.test(ask));
  ok('the intake is keyed by ROLE, never a first name',
    /features\.email === false && role === 'personal_assistant'/.test(ask) && !/first\.toLowerCase\(\) === 'clara'/.test(askC));
  ok('the mentions door serves the role key', /role: a\.worker_role/.test(src('app/api/workers/mentions/route.ts')));
}

console.log('THE COMPOSER (no lying doors · IME · a11y):');
{
  const comp = src('components/thread/thread-composer.tsx');
  const compC = code(comp);
  ok('no Mention/Attach label renders without a host slot', !/mentionSlot \?\?/.test(compC) && !/attachSlot \?\?/.test(compC) && !/>Mention</.test(compC) && !/>Attach</.test(compC));
  ok('Enter ignores IME composition (thread-composer)', /e\.nativeEvent\.isComposing/.test(compC));
  ok('Enter ignores IME composition (ask-rows)', /e\.nativeEvent\.isComposing/.test(code(src('components/thread/ask-rows.tsx'))));
  ok('the textarea carries an aria-label', /aria-label=\{placeholder \|\| 'Message'\}/.test(comp));
  ok('an uncontrolled send resets the grown height', /if \(!controlled\) \{[\s\S]{0,200}style\.height = 'auto'/.test(comp));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
