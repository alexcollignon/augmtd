// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE VERSIONS REGISTRY (stabilization W2.5 DEPENDENCY-KEYED CACHES, R4).
//
// Every `*_VERSION` constant in lib/ is re-exported HERE, from its home (never moved — the constant
// lives beside the prompt/law it versions, where the person editing the prompt sees it). One place
// answers "which caches exist, and what invalidates each one"; `scripts/smoke-sigs.ts` fails when a
// new `*_VERSION` appears in lib/ without a line below.
//
// THE RULE: bump a version when the INSTRUCTIONS (prompt text, law, output shape) change; a new
// FACT an AI step reads rides its cache sig as a dep instead (`sigOf` in lib/core/sig.ts) and needs
// no bump. SERVER-ONLY: this module re-exports from server modules — never import it client-side.
//
// Documented exceptions (not re-exportable, listed in the gate's allowlist with the reason):
//   • DIRECTIONS_VERSION — app/api/items/reply-directions/route.ts (lib/ never imports from app/).
//   • DB_VERSION — lib/recording/vault.ts: an IndexedDB schema version, not a cache key.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The one work judgment's prompt/law (judge.ts) — the version slot of every `judgment` sig. */
export { JUDGE_VERSION } from '@/lib/work/surface-registry';
/** The item-plan classifier + capability map — stale `item_plans.version` rows regenerate. */
export { PLAN_VERSION } from '@/lib/work/surface-registry';
/** The room's one-voice opening (brief + MOVE + offers) — `room_brief` cache. */
export { ROOM_BRIEF_VERSION } from '@/lib/room/brief';
/** Entity state synthesis (summary/momentum/whoOwes/next_move/priority) — `work_entities.sig`. */
export { STATE_PROMPT_VERSION } from '@/lib/entities/state';
/** The Home's reasoned briefing composer — the briefing daySig. */
export { BRIEFING_PROMPT_VERSION } from '@/lib/briefing/compose';
/** The fulfillment law (delivered|promised|unclear) — `fulfillment` verdict cache. */
export { FULFILLMENT_LAW_VERSION } from '@/lib/commitments/fulfillment';
/** The commitment expiry law (the scheduled-slot rule) — `expiry` verdict cache. */
export { EXPIRY_LAW_VERSION } from '@/lib/commitments/expiry';
/** The reply drafter's attachment/direction law — stored drafts re-draft on a bump. */
export { DRAFT_LAW_VERSION } from '@/lib/inbox/attachment-context';
/** The staging law a `require:` row was verified under (`metadata.stagingLaw`) — older rows re-verify. */
export { STAGING_LAW_VERSION } from '@/lib/prepare/staging-law';
/** The workflow verify gate (verdict sentinel, rules, retry-then-hold). */
export { VERIFY_GATE_VERSION } from '@/lib/workflows/execute-step';
/** Entity-pair reflection (merge/separate) — re-judges prior 'separate' verdicts on a bump. */
export { REFLECT_PROMPT_VERSION } from '@/lib/entities/reflect';
/** The Strategy tab's goal recommendations — `alignment_cache` sig. */
export { ALIGNMENT_PROMPT_VERSION } from '@/lib/company/synthesize-alignment';
/** LAW 4 one-conversation pairing — `conversation_pair` / `judgment_nomination` records. */
export { CONVERSATION_IDENTITY_VERSION } from '@/lib/inbox/conversation-identity';
/** The per-item understanding's schema (`_v` on source_data.understanding) — detect/backfill. */
export { UNDERSTANDING_VERSION } from '@/lib/inbox/item-understanding';
/** Outbound recipient/intent resolution — forces re-classification on a bump. */
export { OUTBOUND_VERSION } from '@/lib/outbound/resolve';
/** LAW 7 outcome-facts aggregation — `outcome_facts` per-user-per-day cache. */
export { OUTCOME_FACTS_VERSION } from '@/lib/prepare/outcome-facts';
/** The two-way outcome ledger rows' grammar (`ledger_v` stamp) — outcome-facts reads only current rows. */
export { OUTCOME_LEDGER_VERSION } from '@/lib/prepare/outcome';
/** The user's outbound-campaign signature (the echo floor) — `campaign_signature` cache. */
export { CAMPAIGN_SIGNATURE_VERSION } from '@/lib/inbox/campaign-echo';
/** The frames kit's injected CSS/JS — rides the injection marker so a bump shows in the bytes. */
export { FRAME_KIT_VERSION } from '@/lib/frames/kit';
/** The matcher's per-workflow seen-set (`match_seen`) shape. */
export { MATCH_SEEN_VERSION } from '@/lib/matching/match-profiles';
/** The match-items fence (codes, never words) a source emits for the matcher. */
export { MATCH_ITEMS_VERSION } from '@/lib/matching/items';
/** The profile manifest (folder → force-included profile keys) shape. */
export { PROFILE_MANIFEST_VERSION } from '@/lib/matching/manifest';
/** Tender member website-enrichment records. */
export { MEMBER_ENRICHMENT_VERSION } from '@/lib/tenders/enrich-members';
/** The member-directory manifest the sync driver writes. */
export { MEMBER_MANIFEST_VERSION } from '@/lib/tenders/member-directory';
/** The shared day-state headline block (`day_state` cache). */
export { DAY_STATE_VERSION } from '@/lib/home/day-state';
/** The anticipation pass's meeting-prep prompt (stamped on the meeting fire record). */
export { ANTICIPATION_BRIEF_VERSION } from '@/lib/home/anticipation';
/** The Home brief synthesis (synthesizeBrief) — the version slot of `home_brief.sig`. */
export { SYNTH_BRIEF_VERSION } from '@/lib/home/synthesize-brief';
/** The Home bundle-naming pass — the version slot of `home_brief.bundleNames.sig`. */
export { BUNDLE_NAMES_VERSION } from '@/lib/home/name-bundles';
/** The conversation delta (W8.2) — its prompt + validation floors; stamped on every settle's activity row. */
export { CONVERSATION_DELTA_VERSION } from '@/lib/work/conversation-delta';
/** The working circle's inference rule (W11.2) — the version slot of the `working_circle` cache (a bump re-infers). */
export { CIRCLE_VERSION } from '@/lib/evidence/circle';
