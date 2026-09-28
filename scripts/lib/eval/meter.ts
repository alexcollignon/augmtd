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

export type MeterCall = { model: string; promptTokens: number; completionTokens: number; metered: boolean; /** W24 — tokens estimated (~4 chars/token), not reported */ estimated?: boolean; ms: number };
export type MeterBucket = { calls: MeterCall[]; /** no-persist guard: writes refused while this bucket was current */ blocked?: string[] };
export type StubFn = (params: Record<string, unknown>) => { content: string; promptTokens?: number; completionTokens?: number };

const als = new AsyncLocalStorage<MeterBucket>();
let installed = false;
let stub: StubFn | null = null;
const orphan: MeterBucket = { calls: [] };

type CreateFn = (this: unknown, params: Record<string, unknown>, opts?: unknown) => Promise<unknown>;

export function installMeter(opts: { stub?: StubFn } = {}): void {
  stub = opts.stub ?? null;
  if (installed) return;
  installed = true;
  const proto = (OpenAI as unknown as { Chat: { Completions: { prototype: { create: CreateFn } } } }).Chat.Completions.prototype;
  const orig = proto.create;
  proto.create = async function metered(this: unknown, params: Record<string, unknown>, o?: unknown) {
    const bucket = als.getStore() ?? orphan;
    const model = typeof params?.model === 'string' ? params.model : 'unknown';
    const t0 = Date.now();
    if (stub) return stubbed(bucket, model, params);
    const res = await orig.call(this, params, o) as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
    // W24 — A STREAMED CALL IS METERED TOO (the Home chat's loop always streams: W22–W23 reports showed
    // its calls as "unmetered, €0"). The stream is wrapped; usage comes from the final chunk (the loop
    // asks for include_usage), else an ESTIMATE at ~4 chars/token from the request and the streamed text.
    if (params.stream && res && typeof (res as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      return meterStream(res as unknown as AsyncIterable<StreamChunk>, bucket, model, params, t0);
    }
    const usage = res ? res.usage : undefined;
    bucket.calls.push({
      model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0,
      metered: !!usage, ms: Date.now() - t0,
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
          metered: true, estimated: !reported, ms: Date.now() - t0,
        });
      }
    },
  };
}

/** A canned completion (stub mode), recorded in `bucket`; streamed callers get a one-delta stream. */
function stubbed(bucket: MeterBucket, model: string, params: Record<string, unknown>): unknown {
  const s = stub!(params);
  const promptTokens = s.promptTokens ?? 100, completionTokens = s.completionTokens ?? 20;
  bucket.calls.push({ model, promptTokens, completionTokens, metered: true, ms: 0 });
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
  const comp = (client as { chat?: { completions?: { create?: CreateFn; __evalMetered?: boolean } } } | null)?.chat?.completions;
  if (!comp || typeof comp.create !== 'function' || comp.__evalMetered) return false;
  const CompletionsClass = (OpenAI as unknown as { Chat: { Completions: new (...a: unknown[]) => unknown } }).Chat.Completions;
  if (comp instanceof CompletionsClass) return false;
  const orig = comp.create.bind(comp);
  comp.create = async function meteredAdapter(params: Record<string, unknown>, o?: unknown) {
    const bucket = als.getStore() ?? orphan;
    const model = typeof params?.model === 'string' ? params.model : 'unknown';
    if (stub) return stubbed(bucket, model, params);
    const t0 = Date.now();
    const res = await orig(params, o);
    if (params.stream && res && typeof (res as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      const src = res as AsyncIterable<{ usage?: { prompt_tokens?: number; completion_tokens?: number } }>;
      return {
        async *[Symbol.asyncIterator]() {
          let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
          try {
            for await (const chunk of src) { if (chunk?.usage) usage = chunk.usage; yield chunk; }
          } finally {
            bucket.calls.push({ model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, metered: !!usage, ms: Date.now() - t0 });
          }
        },
      };
    }
    const usage = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
    bucket.calls.push({ model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, metered: !!usage, ms: Date.now() - t0 });
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
export const EVAL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-opus-5-5': { inputPer1M: 3.7, outputPer1M: 18.4 },
  'claude-opus-5': { inputPer1M: 4.6, outputPer1M: 23.0 },
};
