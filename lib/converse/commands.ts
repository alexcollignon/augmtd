// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMMAND FAST PATH (W22 — THE HOME CHAT IS ONE ASSISTANT).
//
// Before W22 every message paid a model ROUTER that sorted it into five lanes (command · question ·
// delegate · open · synthesis), and every lane had its own limits: the question lane answered only
// from records, in 1-3 plain sentences, and served "I don't have anything on that yet" to a workshop
// asking it to facilitate. The lanes are gone — every non-command message is ONE tool-using
// conversation (lib/converse/index.ts `agentLoop`).
//
// What survives the router is only what must stay INSTANT and needs no judgment: an EXACT registry
// command in the user's own words ("dismiss this", "mark it done", "send it", "find the pricing deck",
// "what workflows do I have", "pause the weekly report task"). Deterministic, zero AI, conservative —
// anything unsure returns null and the conversation answers it (the loop holds every one of these
// verbs as a tool, so a miss here is only slower, never wrong).
//
// Pure; exported for the gates (tests/unit/one-assistant.test.ts, scripts/smoke-one-assistant.ts).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { isListingAsk } from '@/lib/present/listing-ask';

export type CommandScope =
  | { kind: 'item'; itemKind: 'email' | 'followup' | 'commitment' | 'meeting' | 'awareness'; itemId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'global' };

export type RegistryCommand = { tool: string; args: Record<string, unknown> };

const END = String.raw`\s*[.!]?\s*$`;
const PLEASE = String.raw`^\s*(?:(?:ok(?:ay)?|great|thanks?|perfect)[,!.]?\s+)?(?:please\s+)?`;
const DISMISS = new RegExp(`${PLEASE}(?:dismiss|ignore|archive|drop|skip)\\s+(?:this|it|this one)${END}`, 'i');
const DONE = new RegExp(`${PLEASE}(?:mark\\s+(?:this|it)\\s+(?:as\\s+)?(?:done|handled|complete|completed|resolved)|(?:it'?s\\s+|that'?s\\s+)?(?:done|handled))${END}`, 'i');
const SEND = new RegExp(`${PLEASE}send(?:\\s+it|\\s+the\\s+(?:reply|draft|email|message))?(?:\\s+now)?${END}`, 'i');
const FIND_FILE = /^\s*(?:please\s+)?(?:find|pull up|get|open)\s+(?:me\s+)?(?:the\s+|my\s+|our\s+)?([^?!.\n]{1,80}?\b(?:deck|document|doc|file|report|spreadsheet|sheet|slides|pdf|presentation|proposal|contract))s?\s*[?.!]?\s*$/i;
const TASK_STATUS = /^\s*(?:please\s+)?(pause|resume|unpause)\s+(?:(all)\s+(?:of\s+)?(?:my\s+|the\s+)?(?:workflows|tasks|automations)|(?:the\s+|my\s+)?(.{2,80}?)\s+(?:workflow|task|automation))\s*[.!]?\s*$/i;
const TASK_NOUN = /\b(workflows?|automations?|automated tasks?|standing tasks?|scheduled tasks?)\b/i;
const RECORDING_NOUN = /\b(recordings?|recorded|transcripts?)\b/i;

/** The recording window a listing names (the card's framing states it). */
function recordingWindow(text: string): string {
  if (/\btoday\b/i.test(text)) return '1d';
  if (/\b(this|last|past)\s+week\b|\b7\s*days\b/i.test(text)) return '7d';
  return '30d';
}

/**
 * The exact registry command this message IS, or null. Null is the common answer: only a message
 * whose whole shape is one of these commands takes the fast path.
 */
export function matchRegistryCommand(text: string, scope: CommandScope): RegistryCommand | null {
  const t = String(text ?? '').trim();
  if (!t || t.length > 160 || t.includes('\n')) return null;
  const onItem = scope.kind === 'item';
  const commitmentItem = onItem && (scope.itemKind === 'commitment' || scope.itemKind === 'followup');
  const inboxItem = onItem && !commitmentItem && scope.itemKind !== 'meeting';

  // The open item's own verbs — only where the item IS the object (never "dismiss this" on Home).
  if (inboxItem && DISMISS.test(t)) return { tool: 'resolve_inbox_item', args: { resolution: 'dismiss' } };
  if (inboxItem && DONE.test(t)) return { tool: 'resolve_inbox_item', args: { resolution: 'complete' } };
  if (commitmentItem && DISMISS.test(t)) return { tool: 'resolve_commitment', args: { resolution: 'dismissed' } };
  if (commitmentItem && DONE.test(t)) return { tool: 'resolve_commitment', args: { resolution: 'done' } };
  // The send door keeps its own explicit-send floor inside the dispatcher.
  if (scope.kind !== 'global' && SEND.test(t)) return { tool: 'send_prepared_reply', args: {} };

  const status = TASK_STATUS.exec(t);
  if (status) {
    const verb = status[1].toLowerCase() === 'pause' ? 'paused' : 'active';
    return status[2]
      ? { tool: 'set_tasks_status', args: { status: verb, scope: 'all' } }
      : { tool: 'set_tasks_status', args: { status: verb, scope: 'named', names: [status[3].trim()] } };
  }

  const file = FIND_FILE.exec(t);
  if (file) return { tool: 'find_file', args: { query: file[1].trim() } };

  // A plain LISTING ask whose object has a card (the collection answers it without a model).
  if (isListingAsk(t)) {
    if (TASK_NOUN.test(t)) return { tool: 'list_tasks', args: {} };
    if (RECORDING_NOUN.test(t)) return { tool: 'get_meeting_context', args: { since: recordingWindow(t) } };
  }
  return null;
}
