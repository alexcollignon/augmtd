// W22.C — THE TRANSPORT METER. Every factory-built client (lib/ai/factory.ts buildClient) is an
// OpenAI SDK instance whose `chat.completions.create` resolves through Completions.prototype at the
// moment the client is built (the param floor binds it). Installing this patch BEFORE the first
// getAIClient call therefore sees every chat completion the Home chat makes — the classifier, the
// agent loop, answerHomeQuestion, background calls it spawns — without touching the core.
// Attribution rides AsyncLocalStorage, so a fire-and-forget call a turn started is still billed to
// that turn even if it lands after the answer returns.
// Optional STUB mode replaces the network call with a canned completion (the zero-AI self-check).
import { AsyncLocalStorage } from 'node:async_hooks';
import OpenAI from 'openai';

export type MeterCall = { model: string; promptTokens: number; completionTokens: number; metered: boolean; ms: number };
export type MeterBucket = { calls: MeterCall[] };
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
    if (stub) {
      const s = stub(params);
      const promptTokens = s.promptTokens ?? 100, completionTokens = s.completionTokens ?? 20;
      bucket.calls.push({ model, promptTokens, completionTokens, metered: true, ms: 0 });
      const completion = {
        id: 'stub', object: 'chat.completion', created: Math.floor(t0 / 1000), model,
        choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: s.content, refusal: null } }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      };
      if (params.stream) {
        // A minimal async-iterable stream (content in one delta), so a streaming caller still completes.
        return { async *[Symbol.asyncIterator]() { yield { choices: [{ index: 0, delta: { content: s.content } }] }; } };
      }
      return completion;
    }
    const res = await orig.call(this, params, o) as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
    const usage = res && !params.stream ? res.usage : undefined;
    bucket.calls.push({
      model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0,
      metered: !!usage, ms: Date.now() - t0,
    });
    return res;
  };
}

/** Run `fn` inside a fresh meter bucket; returns its result and every call it (or its spawn) made. */
export async function metered<T>(fn: () => Promise<T>): Promise<{ result: T; bucket: MeterBucket }> {
  const bucket: MeterBucket = { calls: [] };
  const result = await als.run(bucket, fn);
  return { result, bucket };
}

/** Calls made outside any bucket (should stay empty; reported so nothing is silently unbilled). */
export function orphanCalls(): MeterCall[] { return orphan.calls; }
