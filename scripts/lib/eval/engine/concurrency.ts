// ════════════════════════════════════════════════════════════════════════════════════════════════
// W26 — CONCURRENCY PRIMITIVES (pure; no network). A counting semaphore, the model → provider map and
// the per-provider call caps the meter's gate enforces (scripts/lib/eval/meter.ts setCallGate), and
// the keyed lock the runner uses for WORLD LANES (one seeded world at a time per probe host by
// default — see runner.ts for why).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A counting semaphore (FIFO). `run` holds a slot for the duration of `fn`, always releasing. */
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(readonly limit: number) {
    if (!(limit >= 1)) throw new Error(`Semaphore limit must be ≥ 1 (got ${limit})`);
  }
  get inUse(): number { return this.active; }
  get queued(): number { return this.waiters.length; }
  async acquire(): Promise<void> {
    if (this.active < this.limit) { this.active++; return; }
    await new Promise<void>((res) => this.waiters.push(res));
    // The releaser handed its slot over (active unchanged).
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

/** Semaphores created on demand per key (e.g. one world lane per probe host). */
export class KeyedLimiter {
  private sems = new Map<string, Semaphore>();
  constructor(private readonly limitFor: (key: string) => number) {}
  sem(key: string): Semaphore {
    let s = this.sems.get(key);
    if (!s) { s = new Semaphore(Math.max(1, Math.floor(this.limitFor(key)))); this.sems.set(key, s); }
    return s;
  }
  run<T>(key: string, fn: () => Promise<T>): Promise<T> { return this.sem(key).run(fn); }
}

export type Provider = 'anthropic' | 'openai' | 'openai-mini' | 'bedrock' | 'other';

/** The provider a model id bills against (rate limits are per provider account). Pure. */
export function providerOf(model: string): Provider {
  const m = String(model ?? '').toLowerCase();
  if (/^(eu|us|apac|global)\.|^(anthropic|cohere|amazon|meta|mistral|moonshot)\./.test(m)) return 'bedrock';
  if (/^gpt-(5|4o|4\.1)-(mini|nano)/.test(m)) return 'openai-mini';
  if (/^(gpt|o\d|chatgpt)/.test(m)) return 'openai';
  if (/^claude/.test(m)) return 'anthropic';
  return 'other';
}

/** In-flight model calls allowed per provider (owner brief, Sep 29). Override with --provider-caps. */
export const DEFAULT_PROVIDER_CAPS: Record<Provider, number> = { anthropic: 4, openai: 4, 'openai-mini': 6, bedrock: 3, other: 4 };

/** `anthropic=4,openai=2` → caps (unknown keys refused — a typo must not silently uncap). */
export function parseProviderCaps(spec: string | null | undefined, base: Record<Provider, number> = DEFAULT_PROVIDER_CAPS): Record<Provider, number> {
  const out = { ...base };
  for (const kv of String(spec ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!(k in out)) throw new Error(`--provider-caps: unknown provider "${k}" (have ${Object.keys(out).join(', ')})`);
    const n = Math.floor(Number(v));
    if (!(n >= 1)) throw new Error(`--provider-caps: ${k} must be ≥ 1`);
    out[k as Provider] = n;
  }
  return out;
}

/** The meter gate: each model call holds one slot of its provider's semaphore. Also reports the peak
 *  in-flight count per provider (the self-check asserts the caps held). */
export function makeProviderGate(caps: Record<Provider, number>): {
  gate: <T>(model: string, fn: () => Promise<T>) => Promise<T>;
  peak: Record<Provider, number>;
} {
  const lim = new KeyedLimiter((k) => caps[k as Provider] ?? caps.other);
  const peak = { anthropic: 0, openai: 0, 'openai-mini': 0, bedrock: 0, other: 0 } as Record<Provider, number>;
  return {
    peak,
    gate: <T>(model: string, fn: () => Promise<T>) => {
      const p = providerOf(model);
      const sem = lim.sem(p);
      return sem.run(async () => {
        peak[p] = Math.max(peak[p], sem.inUse);
        return fn();
      });
    },
  };
}
