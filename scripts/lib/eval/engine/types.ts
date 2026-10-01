// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — THE QUALITY ENGINE · the contract. Every AI output the product serves is measured through
// ONE engine: a SurfaceAdapter per output, the SAME columns (AUGMTD · same-model plain · Sonnet 5.5
// plain · GPT-5.6-terra plain), the SAME repeats / judge / labelled metrics / report / parity verdict.
//
// ADDING A SURFACE (a new component, a new integration's output) = one adapter file under
// scripts/lib/eval/engine/adapters/ + its cases (scripts/lib/eval/engine/fixtures/, written to
// FIXTURES.md) + one line in registry.ts + its coverage entry (coverage.ts). Nothing else changes:
// the runner, the columns, the metrics, the report and the coverage gate are generic.
//
// THE FAIRNESS RULES the contract encodes (docs: the W26 plan §2.0):
//   · AUGMTD runs its REAL producer in-process over a seeded fixture WORLD (fresh ids per repeat, so
//     no producer cache can serve a stale verdict) and is measured on the SERVED output.
//   · Every plain column receives the SAME raw records through ONE neutral renderer (neutral.ts) —
//     never AUGMTD's derived state — plus the adapter's plain-words task, under the system prompt
//     "You are a helpful assistant.".
//   · Labelled surfaces score against truth (no judge); written surfaces are judged blind + checked
//     by the product's own pure truth functions, identically on every column.
// Pure types — no runtime imports (client-safe by construction; the unit tests import freely).
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { World, SeededWorld, WorldCtx } from './world';

/** The columns every surface is measured in. `augmtd` is the product; the rest are PLAIN model calls. */
export type ColumnId = 'augmtd' | 'same' | 'sonnet55' | 'gpt56';
export const COLUMN_IDS: ColumnId[] = ['augmtd', 'same', 'sonnet55', 'gpt56'];
export const PLAIN_COLUMNS: ColumnId[] = ['same', 'sonnet55', 'gpt56'];

export type Tier = 'standard' | 'eu';
/** The TaskType slot a producer resolves (lib/ai/types.ts) — the same-model column resolves it too. */
export type Slot = 'classification' | 'conversation' | 'generation' | 'summarization' | 'planning';

export type Family = 'judgment' | 'extraction' | 'artifact' | 'narration' | 'conversation' | 'rendered';

// ── labels (judgment / extraction families) ─────────────────────────────────────────────────────

/** One labelled field of an output. `enum` fields score exact match through a cost matrix; `set`
 *  fields (e.g. extracted obligations) score precision/recall through the adapter's matcher. */
export type LabelField =
  | {
      kind: 'enum';
      name: string;
      /** The closed label vocabulary, each with the neutral one-line gloss every plain column sees. */
      labels: Record<string, string>;
      /** Cost of predicting `pred` when the truth is `truth` (default 1 on a mismatch, 0 on a match).
       *  Keys: truth → pred → cost; '*' matches any label. The most specific entry wins. */
      costs?: Record<string, Record<string, number>>;
      /** The label that means "nothing to do / say" — a WITHHELD AUGMTD output reads as this label
       *  (silence is correct when the truth says so), and it is never the costly class. */
      silence?: string;
      /** The class whose recall/precision the report leads with (e.g. `reply` — a missed reply). */
      costly?: string;
      /** Field weight in the case score (default 1). */
      weight?: number;
      /** Only scored when this predicate holds on the TRUTH (e.g. a slot is scored only when an invite is owed). */
      when?: (truth: Record<string, unknown>) => boolean;
    }
  | {
      kind: 'set';
      name: string;
      /** One line explaining the item shape to the plain columns (appended to the answer schema). */
      gloss: string;
      /** Deterministic matcher: which predicted items match which truth items (one-to-one). */
      match: (pred: unknown[], truth: unknown[]) => SetMatch;
      weight?: number;
      when?: (truth: Record<string, unknown>) => boolean;
    };

export type SetMatch = { tp: number; fp: number; fn: number; /** named error counters (e.g. hallucinatedDue) */ flags?: Record<string, number> };

export type LabelScoring = {
  kind: 'labelled';
  fields: LabelField[];
  /** The surface's primary metric (the parity verdict compares it). */
  primary: { field: string; metric: 'accuracy' | 'macro_f1' | 'costly_recall' | 'costly_precision' | 'cost_weighted' | 'set_f1' };
};

// ── judge (artifact / narration / conversation / rendered families) ─────────────────────────────

/** One rubric dimension, scored 1-5. `anchors` pin what 1 / 3 / 5 look like (detailed rubrics grade
 *  more reliably than a bare label — the eval guidance). */
export type RubricDim = { id: string; label: string; gloss: string; anchors?: { 1?: string; 3?: string; 5?: string } };

export type JudgeScoring = {
  kind: 'judged';
  dims: RubricDim[];
  /** HARD pass/fail conditions for every case of the surface (e.g. "invents a date, price or name not in
   *  the source", "claims something was sent"). Any violation FAILS the run (score 1), whatever the dims
   *  say. A case adds its own through `EvalCase.hardConditions`. */
  hardConditions?: string[];
};

export type Scoring = LabelScoring | JudgeScoring;

// ── cases ───────────────────────────────────────────────────────────────────────────────────────

/** One labelled/judged case. `world` is the raw material; `truth` is what a competent colleague
 *  would answer (labelled) or the truth sheet (judged). Author them per FIXTURES.md. */
export type EvalCase<T = Record<string, unknown>> = {
  id: string;
  /** The plan's case group ("clear personal ask", "newsletter in a personal tone", …). */
  group: string;
  title: string;
  world: World;
  truth: T;
  /** Zero-AI wiring canary (the self-check runs it; live runs skip it unless --canary). */
  canary?: boolean;
  /** Free-form per-surface parameters the adapter reads (e.g. which thread is "the item"). */
  params?: Record<string, unknown>;
  /** Judged surfaces: the truth sheet the judge reads (must-address, must-not-claim, silence is correct). */
  truthSheet?: string;
  /** Judged surfaces: hard pass/fail conditions specific to this case (added to the surface's). */
  hardConditions?: string[];
  /** Conversation family: the scripted user turns (turn 0 = opener). */
  turns?: string[];
};

/** A planned scenario group (the plan's list) — stubs carry these until fixtures land. */
/** The edge-case classes every scenario pack must carry (the eval guidance: mirror the real task
 *  distribution AND its edges). A unit test holds every adapter's plan to all five. */
export const EDGE_KINDS = ['missing', 'irrelevant', 'long', 'harmful', 'ambiguous'] as const;
export type EdgeKind = typeof EDGE_KINDS[number];

export type PlannedGroup = { group: string; count: number; note: string; /** the edge class this group covers */ edge?: EdgeKind };

// ── outputs ─────────────────────────────────────────────────────────────────────────────────────

/** What one column produced for one case in one repeat. */
export type ColumnOutput = {
  /** The text the column emitted (plain columns) or a readable rendering of the served output (AUGMTD). */
  text: string;
  /** Conversation family: one text per scripted turn. */
  turns?: string[];
  /** The structured output scored against truth (labelled) — null = unparseable / withheld. */
  value: Record<string, unknown> | null;
  /** AUGMTD served nothing (the reader withheld it / the verdict was silence) — distinct from a failure. */
  withheld?: boolean;
  /** Cards / deeds that rode beside an AUGMTD answer (conversation family), in neutral words. */
  signals?: { cards: string[]; sideEffects: string[] }[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costEur: number;
  calls: number;
  unmeteredCalls: number;
  models: string[];
  /** Reasoning/thinking tokens the provider reported (a subset of completionTokens) — the effort ACTUALLY used. */
  reasoningTokens?: number;
  /** W27.C — the distinct efforts this output's calls were SENT with (the meter's record). */
  efforts?: string[];
  blockedWrites?: string[];
  error?: string;
};

export type CheckOutcome = { name: string; pass: boolean; detail?: string; turn?: number };

/** A deterministic check that runs on EVERY column (reuse the product's pure truth functions). */
export type EngineCheck = {
  name: string;
  appliesTo?: ColumnId[];
  run: (a: { column: ColumnId; out: ColumnOutput; kase: EvalCase }) => boolean | { pass: boolean; detail?: string };
};

export type FieldScore = { field: string; truth: string; pred: string; correct: boolean; cost: number; set?: SetMatch; skipped?: boolean };
export type LabelScore = { fields: FieldScore[]; /** weighted case score in [0,1] */ score: number; costTotal: number };

export type RubricVerdict = {
  scores: Record<string, number | null>;
  notes: string;
  failures: string[];
  /** Hard conditions the judge found violated (1-based numbers as listed in its prompt) — the run fails. */
  hardFails?: string[];
  costEur: number;
  promptTokens: number;
  completionTokens: number;
  error?: string;
};

export type ColumnRun = {
  column: ColumnId;
  repeat: number;
  out: ColumnOutput;
  checks: CheckOutcome[];
  label?: LabelScore;
  verdict?: RubricVerdict | null;
  /** Case score on the surface's scale (labelled: [0,1]; judged: 1-5 mean of dims). null = unscored. */
  score: number | null;
  skipped?: string;
  /** Copied from another tier's run (plain columns are tier-independent). */
  reusedFrom?: Tier;
  /** THE PROBE POOL (informational): the account that hosted an AUGMTD run's world, e.g. `std#2`. */
  host?: string;
};

// ── contexts ────────────────────────────────────────────────────────────────────────────────────

/** What produce()/seed() receive. `admin` is the service-role client; `session` the RLS client for
 *  producers that take the user's own client (falls back to admin, stated in the report). */
export type RunCtx = WorldCtx & {
  tier: Tier;
  repeat: number;
  /** Stubbed transport (the self-check): the producer runs for real, the model is canned. */
  stubbed: boolean;
};

export type PlainPrompt = { user: string };

// ── THE ADAPTER ─────────────────────────────────────────────────────────────────────────────────

/**
 * One measured AI output. Implement every member; `seed`/`teardown` default to the shared world
 * builder (world.ts), so most adapters only write `produce`, `plainPrompt`, `parse` and `scoring`.
 */
export interface SurfaceAdapter<T = Record<string, unknown>> {
  /** `<family>.<name>`, stable forever (reports and merges key on it). */
  id: string;
  family: Family;
  title: string;
  /** Stage in the W26 programme ('1a', '1b', '2', '3', 'chat'). `--stage` selects on it. */
  stage: string;
  /** The producer measured (report header + the coverage map). */
  producer: {
    file: string; fn: string; slot: Slot;
    /** the effort the same-model column runs at (absent = the param floor's value for the model) */ effort?: string | null;
    /** W28 · the producer key its model call names (lib/ai/effort.ts EFFORT_PRODUCERS) — the AUGMTD column's
     *  effort resolves through PRODUCER_EFFORT, and `--effort <key>=<effort>` A/Bs exactly this producer. */
    effortKey?: string;
  };
  /** Tiers the adapter can run on (both, unless a producer is tier-locked). */
  tiers: Tier[];
  /** 'ready' = fixtures authored; 'stub' = wired, awaiting fixtures (only canaries run). */
  status: 'ready' | 'stub';
  /** The plan's scenario list (what the fixture authors fill). */
  planned: PlannedGroup[];
  /** The cases (canaries included). */
  cases(): EvalCase<T>[];
  scoring: Scoring;
  checks?: EngineCheck[];
  /** Pre-run estimate, per case and column (tokens; the runner prices them). Defaults are generic. */
  estimate?: (c: EvalCase<T>) => { augmtd: { calls: number; inTok: number; outTok: number }; plainIn: number; plainOut: number };

  /** Seed the case's world on the probe host (default: world.ts seedWorld). FRESH ids every call. */
  seed?(ctx: RunCtx, c: EvalCase<T>): Promise<SeededWorld>;
  /** THE REAL PRODUCER, in-process, returning the SERVED output. Return `value: null, withheld: true`
   *  when the product serves nothing. Writes the producer makes are read back here, then torn down. */
  produce(ctx: RunCtx, c: EvalCase<T>, seeded: SeededWorld): Promise<{ text: string; value: Record<string, unknown> | null; withheld?: boolean; turns?: string[]; signals?: ColumnOutput['signals'] }>;
  /** THE SERVED VIEW (W26 loss diagnosis): a PURE, deterministic, zero-AI product step that sits
   *  between the producer's raw output and what the product actually SERVES (e.g. the needs-reply
   *  floor, the structural reply resolver). produce() applies it to AUGMTD's value; --recheck applies
   *  it to a saved run that predates it. MUST be idempotent and must call the product's own pure
   *  functions — never re-implement or improve product logic here. */
  servedView?(value: Record<string, unknown>, c: EvalCase<T>, now: Date, /** the saved served text — lets a saved run recover raw fields its value predates */ text?: string): Record<string, unknown>;
  /** Delete everything seed + produce wrote (default: world.ts teardownWorld). */
  teardown?(ctx: RunCtx, seeded: SeededWorld): Promise<void>;

  /** The plain columns' user message: neutralInput (renderWorld) + the plain task + the neutral schema. */
  plainPrompt(c: EvalCase<T>, now: Date): PlainPrompt;
  /** Plain column text → the structured value (tolerant; null = unparseable, scored as wrong). */
  parse(text: string, c: EvalCase<T>): Record<string, unknown> | null;

  /** Conversation family only: run the scripted turns through a plain column (the engine supplies `call`). */
  conversation?: {
    plainTurns(c: EvalCase<T>): string[];
    /** Build the judge prompt (blind) for a transcript; defaults to the generic rubric judge. */
    judgePrompt?(c: EvalCase<T>, transcript: Array<{ role: 'user' | 'assistant'; text: string }>, signalNotes: string[], groundTruth: string | null): { system: string; user: string };
    parseVerdict?(raw: string): Pick<RubricVerdict, 'scores' | 'notes' | 'failures'> & { error?: string };
    groundTruth?(ctx: RunCtx): Promise<string | null>;
    /** The rubric dimensions that apply to this case (default: all). */
    dimsFor?(c: EvalCase<T>): string[];
    /** Per-case deterministic checks that need turn structure (legacy harness checks). */
    runChecks?(c: EvalCase<T>, column: ColumnId, out: ColumnOutput): CheckOutcome[];
  };

  /** Resolve relative truth (a due authored as '+3d') against the run clock (default: truth as-is). */
  resolveTruth?(c: EvalCase<T>, now: Date): Record<string, unknown>;

  /** Self-check only: what a CORRECT plain answer looks like for this case (proves the scorer). */
  stubAnswer?(c: EvalCase<T>, now: Date): string;
}

export type AnyAdapter = SurfaceAdapter<Record<string, unknown>>;
export type { World, SeededWorld };
