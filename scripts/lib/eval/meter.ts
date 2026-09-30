// W22.C — THE TRANSPORT METER. Every NON-Bedrock factory-built client (lib/ai/factory.ts buildClient) is an
// OpenAI SDK instance whose `chat.completions.create` resolves through Completions.prototype at the
// moment the client is built (the param floor binds it). Installing this patch BEFORE the first
// getAIClient call therefore sees every chat completion the Home chat makes — the classifier, the
// agent loop, answerHomeQuestion, background calls it spawns — without touching the core.
// Attribution rides AsyncLocalStorage, so a fire-and-forget call a turn started is still billed to
// that turn even if it lands after the answer returns.
// Bedrock endpoints are a duck-typed adapter instead — see meterAdapterClient below.
// Optional STUB mode replaces the network call with a canned completion (the zero-AI self-check).
import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';

export type MeterCall = { model: string; promptTokens: number; completionTokens: number; metered: boolean; /** W24 — tokens estimated (~4 chars/token), not reported */ estimated?: boolean; ms: number; /** W26 — reasoning/thinking tokens the provider reported (subset of completionTokens) */ reasoningTokens?: number; /** W27.C — the effort the request carried (the lever's stamp, else the provider field sent; absent = none stated) */ effort?: string };
export type MeterBucket = { calls: MeterCall[]; /** no-persist guard: writes refused while this bucket was current */ blocked?: string[] };
export type StubFn = (params: Record<string, unknown>) => { content: string; promptTokens?: number; completionTokens?: number };

const als = new AsyncLocalStorage<MeterBucket>();
let installed = false;
let stub: StubFn | null = null;
const orphan: MeterBucket = { calls: [] };

/** W26 — THE CALL GATE (optional): every metered completion (OpenAI SDK prototype + Bedrock adapters)
 *  runs through it, keyed by model — the engine installs per-provider concurrency caps here so a
 *  concurrent run never floods one provider. The gate wraps ONE create() call (a 429 back-off in
 *  aiCreate happens outside it, so a waiting retry never holds a slot). null = no gate. */
export type CallGate = <T>(model: string, fn: () => Promise<T>) => Promise<T>;
let gate: CallGate | null = null;
export function setCallGate(g: CallGate | null): void { gate = g; }
const gated = <T>(model: string, fn: () => Promise<T>): Promise<T> => (gate ? gate(model, fn) : fn());

type CreateFn = (this: unknown, params: Record<string, unknown>, opts?: unknown) => Promise<unknown>;

/** W27.C — the effort a request was SENT with: the effort lever's stamp (lib/ai/effort.ts, a Symbol —
 *  never serialised), else the provider field the caller wrote (`reasoning_effort` / thinking budget).
 *  The OpenAI prototype patch sees params AFTER the param floor, so a floor default reads as itself. */
const EFFORT_KEY = Symbol.for('augmtd.ai.effort');
export function sentEffort(params: Record<string | symbol, unknown> | null | undefined): string | undefined {
  if (!params) return undefined;
  if (EFFORT_KEY in params) { const v = params[EFFORT_KEY]; return typeof v === 'string' ? v : 'n/a'; }
  if (typeof params.reasoning_effort === 'string') return params.reasoning_effort;
  const t = params.thinking as { type?: string; budget_tokens?: number } | undefined;
  if (t?.type === 'enabled') return `thinking:${t.budget_tokens}`;
  return undefined;
}
const reasoningOf = (usage: unknown): number | undefined => {
  const r = (usage as { completion_tokens_details?: { reasoning_tokens?: number } } | null | undefined)?.completion_tokens_details?.reasoning_tokens;
  return typeof r === 'number' ? r : undefined;
};
const effortField = (params: Record<string, unknown>) => { const e = sentEffort(params); return e ? { effort: e } : {}; };

export function installMeter(opts: { stub?: StubFn } = {}): void {
  stub = opts.stub ?? null;
  if (installed) return;
  installed = true;
  const proto = (OpenAI as unknown as { Chat: { Completions: { prototype: { create: CreateFn } } } }).Chat.Completions.prototype;
  const orig = proto.create;
  proto.create = async function metered(this: unknown, params: Record<string, unknown>, o?: unknown) {
    const bucket = als.getStore() ?? orphan;
    const model = typeof params?.model === 'string' ? params.model : 'unknown';
    let t0 = Date.now();
    if (stub) return gated(model, async () => stubbed(bucket, model, params));
    // t0 restarts inside the gate: a call's `ms` is its own latency, never the time it queued.
    const res = await gated(model, () => { t0 = Date.now(); return orig.call(this, params, o); }) as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
    // W24 — A STREAMED CALL IS METERED TOO (the Home chat's loop always streams: W22–W23 reports showed
    // its calls as "unmetered, €0"). The stream is wrapped; usage comes from the final chunk (the loop
    // asks for include_usage), else an ESTIMATE at ~4 chars/token from the request and the streamed text.
    if (params.stream && res && typeof (res as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      return meterStream(res as unknown as AsyncIterable<StreamChunk>, bucket, model, params, t0);
    }
    const usage = res ? res.usage : undefined;
    const reasoning = reasoningOf(usage);
    bucket.calls.push({
      model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0,
      metered: !!usage, ms: Date.now() - t0, ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}), ...effortField(params),
    });
    return res;
  };
}

type StreamChunk = { usage?: { prompt_tokens?: number; completion_tokens?: number } | null; choices?: Array<{ delta?: { content?: string | null; tool_calls?: unknown } }> };

/** The request's approximate size in characters (messages + tools) — the estimate's input side. */
function requestChars(params: Record<string, unknown>): number {
  const msgs = (params.messages ?? []) as Array<{ content?: unknown; tool_calls?: unknown }>;
  let n = 0;
  for (const m of msgs) n += (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  if (params.tools) n += JSON.stringify(params.tools).length;
  return n;
}

function meterStream(src: AsyncIterable<StreamChunk>, bucket: MeterBucket, model: string, params: Record<string, unknown>, t0: number): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      let usage: StreamChunk['usage'] = null;
      let outChars = 0;
      try {
        for await (const chunk of src) {
          if (chunk?.usage) usage = chunk.usage;
          const d = chunk?.choices?.[0]?.delta;
          if (d?.content) outChars += d.content.length;
          if (d?.tool_calls) outChars += JSON.stringify(d.tool_calls).length;
          yield chunk;
        }
      } finally {
        const reported = !!usage && ((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)) > 0;
        bucket.calls.push({
          model,
          promptTokens: reported ? usage!.prompt_tokens ?? 0 : Math.ceil(requestChars(params) / 4),
          completionTokens: reported ? usage!.completion_tokens ?? 0 : Math.ceil(outChars / 4),
          metered: true, estimated: !reported, ms: Date.now() - t0, ...effortField(params),
        });
      }
    },
  };
}

/** A canned completion (stub mode), recorded in `bucket`; streamed callers get a one-delta stream. */
function stubbed(bucket: MeterBucket, model: string, params: Record<string, unknown>): unknown {
  const s = stub!(params);
  const promptTokens = s.promptTokens ?? 100, completionTokens = s.completionTokens ?? 20;
  bucket.calls.push({ model, promptTokens, completionTokens, metered: true, ms: 0, ...effortField(params) });
  if (params.stream) {
    return { async *[Symbol.asyncIterator]() { yield { choices: [{ index: 0, delta: { content: s.content } }] }; } };
  }
  return {
    id: 'stub', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: s.content, refusal: null } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

/** THE ADAPTER METER. A Bedrock endpoint's factory client is NOT an OpenAI SDK instance — it is the
 *  duck-typed adapter (lib/ai/bedrock-adapter.ts), one cached object per provider — so the prototype
 *  patch above never sees it. Wrapping that instance's `chat.completions.create` once meters every
 *  Bedrock call the process makes (every task on the tier shares it). OpenAI SDK instances are left
 *  alone (the prototype patch already counts them — wrapping would double-bill). Streams are metered
 *  from the final chunk's `usage`, which the adapter carries through. Returns true when it wrapped. */
export function meterAdapterClient(client: unknown): boolean {
  if (!installed) throw new Error('installMeter() must run before meterAdapterClient()');
  // W27.C: a slot-bound effort view (lib/ai/factory.ts bindEffort) delegates to the cached adapter —
  // meter THAT, once, or a bound slot and an unbound slot would bill one call twice.
  client = (client as Record<symbol, unknown> | null)?.[Symbol.for('augmtd.ai.baseClient')] ?? client;
  const comp = (client as { chat?: { completions?: { create?: CreateFn; __evalMetered?: boolean } } } | null)?.chat?.completions;
  if (!comp || typeof comp.create !== 'function' || comp.__evalMetered) return false;
  const CompletionsClass = (OpenAI as unknown as { Chat: { Completions: new (...a: unknown[]) => unknown } }).Chat.Completions;
  if (comp instanceof CompletionsClass) return false;
  const orig = comp.create.bind(comp);
  comp.create = async function meteredAdapter(params: Record<string, unknown>, o?: unknown) {
    const bucket = als.getStore() ?? orphan;
    const model = typeof params?.model === 'string' ? params.model : 'unknown';
    if (stub) return gated(model, async () => stubbed(bucket, model, params));
    let t0 = Date.now();
    const res = await gated(model, () => { t0 = Date.now(); return orig(params, o); });
    if (params.stream && res && typeof (res as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      const src = res as AsyncIterable<{ usage?: { prompt_tokens?: number; completion_tokens?: number } }>;
      return {
        async *[Symbol.asyncIterator]() {
          let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
          try {
            for await (const chunk of src) { if (chunk?.usage) usage = chunk.usage; yield chunk; }
          } finally {
            bucket.calls.push({ model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, metered: !!usage, ms: Date.now() - t0, ...effortField(params) });
          }
        },
      };
    }
    const usage = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
    const reasoning = reasoningOf(usage);
    bucket.calls.push({ model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, metered: !!usage, ms: Date.now() - t0, ...(typeof reasoning === 'number' ? { reasoningTokens: reasoning } : {}), ...effortField(params) });
    return res;
  };
  comp.__evalMetered = true;
  return true;
}

/** The bucket of the turn currently running (or the orphan bucket) — the no-persist guard files
 *  refused writes here so they are attributed to the turn that attempted them. */
export function currentBucket(): MeterBucket { return als.getStore() ?? orphan; }

/** Run `fn` inside a fresh meter bucket; returns its result and every call it (or its spawn) made. */
export async function metered<T>(fn: () => Promise<T>): Promise<{ result: T; bucket: MeterBucket }> {
  const bucket: MeterBucket = { calls: [] };
  const result = await als.run(bucket, fn);
  return { result, bucket };
}

/** Calls made outside any bucket (should stay empty; reported so nothing is silently unbilled). */
export function orphanCalls(): MeterCall[] { return orphan.calls; }

/** W24 — eval-only rates (€/1M) for models the product's pricing table does not carry because no
 *  tier routes to them (the reference system and the judge). $4/$20 per 1M converted like the table. */
export const EVAL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number; cachedInputPer1M?: number }> = {
  'claude-opus-5-5': { inputPer1M: 3.7, outputPer1M: 18.4 },
  'claude-opus-5': { inputPer1M: 4.6, outputPer1M: 23.0 },
  // W26 — the plain comparison columns (owner decision, Sep 29). Same $→€ conversion as the table
  // ($2 → €1.85, $10 → €9.20, $12 → €11.10). Cached input is listed for the record; the meter does
  // not see cache hits, so every input token is billed at the full rate (conservative).
  'claude-sonnet-5-5': { inputPer1M: 1.85, outputPer1M: 9.2 },
  'gpt-5.6-terra': { inputPer1M: 1.85, outputPer1M: 11.1, cachedInputPer1M: 0.185 },
};
