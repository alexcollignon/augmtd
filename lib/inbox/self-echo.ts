// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE SELF-RECOGNITION FLOOR — Q1 of THE QUALITY LAWS (docs/attention-plan.md PART III).
//
// "The machine recognizes its own voice coming back."
//
// The user's own coworkers send real email (lib/tools/coworker-email.ts — Resend, the dedicated
// team domain, one local-part per worker ROLE). That mail lands in the user's mailbox, syncs back
// in through the same door as every stranger's, and — to every classifier we own — reads as a warm
// direct ask from a named human: "Approve the Data Analyst shortlist to advance to interviews",
// ownership `you_owe`, relevance `action`. The Sep 17 audit measured the cost on the reference
// account: the deck's TOP rows were our own reminder mail, the SAME shortlist ask standing FOUR
// times (three re-sent reminders plus the commitment one of them minted), and the room opened with
// "Clara is asking you to approve…" — in Clara's own voice.
//
// THE LAW: mail from the user's own coworkers never founds a new ask, item or commitment. It is a
// POINTER to the work it reminds about; the work it points to already stands on its own surface.
//
// THE SHAPE OF THE LAW (the echo floor's own shape — lib/inbox/campaign-echo — deliberately):
//   • DERIVATION is deterministic and zero-AI, off the ADDRESS REGISTRY that produces those
//     addresses in the first place (lib/integrations/registry `EMAIL_LOCAL_BY_ROLE`). One producer,
//     one recognizer: a new coworker role gets recognized the day it can send.
//   • It is a REFINER in the precedence chain (authoritative → refine → fallback): the user's own
//     `type_override` outranks it wherever the caller applies that guard, exactly as it does for
//     every other floor.
//   • POSTURED, NOT HIDDEN. Nothing is deleted; the pointer stays findable in its lane.
//   • It never mints a commitment and never counts as a visible obligation row.
//
// ⚠️ THE LOCAL-PART IS THE KEY, NOT THE DOMAIN. The coworker domain is SHARED across tenants —
// clara@<domain> writes to every user who has a Clara — so "the sender is one of MY coworkers"
// cannot be read off the domain alone, and the domain alone would also swallow anything else that
// ever sends from it (the reference account carries a seeded applicant persona on that very
// domain, which is a real counterparty and must stay one). The floor is: the domain is ours AND
// the local-part is a coworker ROLE's local-part. `ownCoworkerLocals` narrows that further to the
// roles THIS user's roster actually holds when a client is in hand.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { COWORKER_EMAIL_DOMAIN, EMAIL_LOCAL_BY_ROLE } from '@/lib/integrations/registry';

/** Locals that BELONGED to a coworker role and no longer do. A retired role's historical mail is
 *  still our own voice — the floor must recognize it or the backlog it left keeps asking. */
const RETIRED_ROLE_LOCALS = ['sofia'] as const;

/** The default recognizer set: every role local-part the address producer can emit, its historical
 *  retirees, and the `team` fallback local `coworkerEmailForRole` uses for an unmapped role. */
export const COWORKER_EMAIL_LOCALS: ReadonlySet<string> = new Set<string>([
  ...Object.values(EMAIL_LOCAL_BY_ROLE),
  ...RETIRED_ROLE_LOCALS,
  'team',
]);

export function normalizeAddress(raw: string | null | undefined): string {
  const s = String(raw ?? '').toLowerCase();
  // Display forms arrive as `Name <local@domain>` — take the address, never the label.
  return (s.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? (s.includes('@') ? s.trim() : '')).trim();
}

/**
 * THE PREDICATE. Is this sender one of the user's OWN coworkers?
 *
 * @param address  the raw From address (display forms tolerated).
 * @param locals   optional narrowing to the roles this user's roster actually holds
 *                 (`ownCoworkerLocals`). Omitted = the full registry set.
 */
export function isOwnCoworkerSender(
  address: string | null | undefined,
  locals: ReadonlySet<string> = COWORKER_EMAIL_LOCALS,
): boolean {
  const addr = normalizeAddress(address);
  if (!addr) return false;
  const at = addr.lastIndexOf('@');
  if (at < 0) return false;
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  if (domain !== String(COWORKER_EMAIL_DOMAIN).toLowerCase()) return false;
  // Resend sub-addressing (`clara+run123@…`) is still Clara.
  const base = local.split('+')[0];
  return locals.has(base);
}

/** The item-shaped reader — ONE place that knows where an inbox row keeps its sender, so no caller
 *  re-derives it (the fromEmailOf fork class). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function itemIsSelfEcho(item: any, locals?: ReadonlySet<string>): boolean {
  const sd = (item?.source_data ?? {}) as Record<string, unknown>;
  return isOwnCoworkerSender(
    (sd.from_address as string) ?? (sd.from as string) ?? null,
    locals,
  );
}

/** THE ROSTER NARROWING (one read, compose/judge paths only — never a hot render path). The locals
 *  of the roles THIS user actually has a worker for, unioned with the registry default so a
 *  pre-seed or partly-seeded roster can never make the floor weaker than the address producer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ownCoworkerLocals(client: any, userId: string): Promise<ReadonlySet<string>> {
  try {
    const { data } = await client.from('custom_agents').select('worker_role')
      .eq('user_id', userId).eq('is_worker', true);
    const roles = ((data ?? []) as Array<{ worker_role: string | null }>).map((r) => r.worker_role ?? '');
    const mine = roles.map((r) => EMAIL_LOCAL_BY_ROLE[r]).filter(Boolean) as string[];
    return new Set<string>([...COWORKER_EMAIL_LOCALS, ...mine]);
  } catch { return COWORKER_EMAIL_LOCALS; }
}

/** The one sentence every consumer speaks about this class — so the reason a row was floored reads
 *  the same in the judge's verdict, the sweep's log and the ledger. */
export const SELF_ECHO_REASON =
  'this is our own team\'s mail coming back — a pointer to work that already stands, not a new ask';
