// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORK-COMPONENT REGISTRY (judged-room J2 — the THIRD registry invariant, after the roster and
// the capability map). One row per component the plane can mount; THE JUDGE reads this list and
// picks — adding a component is ONE row here + a mount case in the plane's switch, zero
// choosing-code anywhere else. The `gate` names what the approve line protects.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type WorkComponentKey =
  | 'message_only'     // the honest none — the message + the conversation, no fake work
  | 'reply_composer'   // a reply the user owes — the prepared draft prefilled
  | 'decision'         // a yes/no/route choice — numbered options, decline always last
  | 'document'         // a produced deliverable to review (coworker output, prep briefs)
  | 'send_file'        // send an EXISTING document — composer + the resolved attachment chip
  | 'invite'           // schedule — the prepared calendar invite
  | 'forward'          // pass the thread to a named third party
  | 'chase';           // a nudge for something someone else owes

export type WorkGate = 'send' | 'book' | 'share' | null;

/** One-room R2 — the component's INTERACTION CLASS, decided once here, never per-surface:
 *  'inline' renders inside a conversation turn (resolved in a glance/tap); 'stage' is a workspace
 *  that opens in the side panel FROM its inline card. */
export type WorkSurface = 'inline' | 'stage';

export const WORK_COMPONENTS: ReadonlyArray<{ key: WorkComponentKey; gate: WorkGate; surface: WorkSurface; when: string }> = [
  { key: 'message_only', gate: null, surface: 'inline', when: 'nothing is owed by anyone — informational, the chat suffices' },
  { key: 'reply_composer', gate: 'send', surface: 'stage', when: 'a real person awaits a reply FROM the user' },
  { key: 'decision', gate: null, surface: 'inline', when: 'the real move is a CHOICE between a few concrete routes (accept/decline/redirect)' },
  { key: 'document', gate: null, surface: 'stage', when: 'a produced deliverable exists to review (research, a brief, a deck draft)' },
  { key: 'send_file', gate: 'send', surface: 'stage', when: 'an EXISTING document must be sent/shared to someone' },
  { key: 'invite', gate: 'book', surface: 'inline', when: 'the move is scheduling a real meeting/call' },
  { key: 'forward', gate: 'send', surface: 'inline', when: 'the thread should go to a NAMED third party' },
  { key: 'chase', gate: 'send', surface: 'stage', when: 'someone ELSE owes the user and a nudge is the move' },
];

/** Where a component renders — the stream renderer + the stage both read THIS, never a local map. */
export const surfaceOf = (key: WorkComponentKey): WorkSurface =>
  WORK_COMPONENTS.find((c) => c.key === key)?.surface ?? 'inline';

export const COMPONENT_KEYS: ReadonlySet<string> = new Set(WORK_COMPONENTS.map((c) => c.key));
export const gateOf = (key: WorkComponentKey): WorkGate => WORK_COMPONENTS.find((c) => c.key === key)?.gate ?? null;

/** The natural component for each work verb — STRUCTURAL coherence, not a second judgment: the
 *  model picks the WORK; when its component half drifts (e.g. "chase" + "message_only"), the
 *  registry supplies the consistent mount. `produce` maps to `document` (the deliverable to
 *  review); `none` is the only work whose component is message_only. */
export const componentForWork = (work: string): WorkComponentKey | null => (({
  none: 'message_only', reply: 'reply_composer', decide: 'decision', produce: 'document',
  send_file: 'send_file', schedule: 'invite', chase: 'chase',
} as Record<string, WorkComponentKey>)[work] ?? null);

/** Rendered for the judge's prompt — the registry IS the option list (never a hardcoded enum there). */
export const renderComponentOptions = (): string =>
  WORK_COMPONENTS.map((c) => `- "${c.key}": ${c.when}`).join('\n');

/** Bump when the verdict schema/prompt changes — cached verdicts self-invalidate. */
export const JUDGE_VERSION = 6; // 6: `requires` inventory + the tightened "answered ≠ able-to-act" rule
