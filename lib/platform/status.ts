// ─── THE PLATFORM STATUS BOARD (superadmin, Sep 1 2026) ─────────────────────────────────────────
// One page of truth about the machine's own dependencies. Motivated by a season of SILENT
// failures found late by humans tripping over symptoms: Anthropic credits dry (Aug 11, platform-
// wide), OpenAI key dry (Aug 25, found mid-demo-prep), a scheduled workflow dead for a MONTH
// (Together 402 + null next_run_at, July), the Supabase global storage limit at 50MB while the
// dashboard showed 500MB unsaved (Aug 5). Three bands:
//   1. AI matrix — every distinct endpoint the self-operated tiers route to, LIVE-probed through
//      the real factory transport (getEndpointClient → buildClient, param floor included).
//   2. Services — Supabase DB/storage, the Hetzner four, Nango, Resend, Tavily.
//   3. Silent-death detectors — last-seen-OK per usage channel, burn rates, schedule health.
// Honesty rules: a probe that costs money is tiny and tagged in ai_usage_events-adjacent logs by
// its caller; things we CANNOT know (provider credit balances, whisper behind the docker bridge,
// Tavily with no free ping) are said out loud, never faked as green.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelEndpoint, TierType, TaskType } from '@/lib/ai/types';
import { TIER_DEFAULTS } from '@/lib/ai/defaults';
import { getEndpointClient, aiCreate } from '@/lib/ai/factory';

// ── Types ───────────────────────────────────────────────────────────────────────────────────────

export interface ProbeResult {
  name: string;
  ok: boolean | null;        // null = not probed (stated in detail), never a fake green
  latencyMs: number | null;
  detail: string;
}

export interface AIEndpointProbe extends ProbeResult {
  provider: string;
  model: string;
  usedBy: Array<{ tier: TierType; tasks: TaskType[] }>;
}

export interface StatusWarning {
  severity: 'red' | 'amber';
  text: string;
}

export interface ChannelHeartbeat {
  channel: string;           // "<tier> · <task_type or source>"
  lastSeen: string;          // ISO
  quiet: boolean;            // active in the window but silent past the threshold
}

export interface PlatformStatus {
  generatedAt: string;
  tookMs: number;
  ai: AIEndpointProbe[];
  services: ProbeResult[];
  heartbeats: ChannelHeartbeat[];
  burn: Array<{ provider: string; eur7d: number; eurPrev7d: number }>;
  spendByWorkspace: Array<{ name: string; tier: string | null; members: number; eur7d: number; eurPrev7d: number }>;
  scheduleHealth: Array<{ id: string; name: string; nextRunAt: string | null; problem: string }>;
  storageBuckets: Array<{ name: string; fileSizeLimit: number | null }>;
  emailsToday: number;
  warnings: StatusWarning[];
}

// ── Small helpers ───────────────────────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label}: timed out after ${ms / 1000}s`)), ms)),
  ]);
}

async function httpProbe(name: string, url: string | undefined, opts?: { headers?: Record<string, string>; okBelow?: number; note?: string }): Promise<ProbeResult> {
  if (!url) return { name, ok: null, latencyMs: null, detail: 'not configured (env missing)' };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    const res = await fetch(url, { headers: opts?.headers, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const ok = res.status < (opts?.okBelow ?? 400);
    return {
      name, ok, latencyMs: Date.now() - t0,
      detail: `HTTP ${res.status}${opts?.note ? ` — ${opts.note}` : ''}`,
    };
  } catch (e) {
    return { name, ok: false, latencyMs: Date.now() - t0, detail: String((e as Error).message).slice(0, 140) };
  }
}

// ── Band 1: the AI matrix ───────────────────────────────────────────────────────────────────────
// Distinct endpoints across the SELF-OPERATED tiers only — client-endpoint tiers (professional /
// private_client / on_prem) resolve against per-tenant endpoints that don't exist platform-side,
// so probing their placeholder rows would be theater.

const SELF_OPERATED: TierType[] = ['standard', 'bedrock_private', 'bedrock_optimised'];

function distinctEndpoints(): Array<{ endpoint: ModelEndpoint; kind: 'chat' | 'embeddings'; usedBy: Map<TierType, TaskType[]> }> {
  const map = new Map<string, { endpoint: ModelEndpoint; kind: 'chat' | 'embeddings'; usedBy: Map<TierType, TaskType[]> }>();
  for (const tier of SELF_OPERATED) {
    for (const [task, endpoint] of Object.entries(TIER_DEFAULTS[tier]) as Array<[TaskType, ModelEndpoint]>) {
      const kind = task === 'embeddings' ? 'embeddings' : 'chat';
      const key = `${endpoint.provider}:${endpoint.model}:${kind}`;
      const row = map.get(key) ?? { endpoint, kind, usedBy: new Map<TierType, TaskType[]>() };
      row.usedBy.set(tier, [...(row.usedBy.get(tier) ?? []), task]);
      map.set(key, row);
    }
  }
  return [...map.values()];
}

async function probeAI(): Promise<AIEndpointProbe[]> {
  const rows = distinctEndpoints();
  return Promise.all(rows.map(async ({ endpoint, kind, usedBy }): Promise<AIEndpointProbe> => {
    const base = {
      name: `${endpoint.provider} · ${endpoint.model}`,
      provider: endpoint.provider,
      model: endpoint.model,
      usedBy: [...usedBy.entries()].map(([tier, tasks]) => ({ tier, tasks })),
    };
    const t0 = Date.now();
    try {
      const client = getEndpointClient(endpoint);
      if (kind === 'embeddings') {
        const res = await withTimeout(
          client.embeddings.create({ model: endpoint.model, input: 'status probe' }),
          PROBE_TIMEOUT_MS, base.name,
        );
        const dims = res.data?.[0]?.embedding?.length ?? 0;
        return { ...base, ok: dims > 100, latencyMs: Date.now() - t0, detail: `${dims} dims` };
      }
      const res = await withTimeout(
        aiCreate(client, {
          model: endpoint.model,
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          // Not lower: reasoning-capable models spend a few tokens in the reasoning
          // channel even at minimal effort — a 10-token probe budget false-redded
          // gpt-5-mini with finish=length on this very page's first live run.
          max_tokens: 64,
        }),
        PROBE_TIMEOUT_MS, base.name,
      );
      const text = res.choices?.[0]?.message?.content?.trim() ?? '';
      return { ...base, ok: text.length > 0, latencyMs: Date.now() - t0, detail: text.slice(0, 40) || `empty (finish=${res.choices?.[0]?.finish_reason ?? '?'})` };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      return { ...base, ok: false, latencyMs: Date.now() - t0, detail: `${err.status ?? ''} ${String(err.message ?? e).slice(0, 140)}`.trim() };
    }
  }));
}

// ── Band 2: services ────────────────────────────────────────────────────────────────────────────

async function probeServices(admin: SupabaseClient): Promise<{ services: ProbeResult[]; storageBuckets: Array<{ name: string; fileSizeLimit: number | null }> }> {
  const t0 = Date.now();
  const dbProbe: Promise<ProbeResult> = (async () => {
    const { error, count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
    return {
      name: 'Supabase · database',
      ok: !error,
      latencyMs: Date.now() - t0,
      detail: error ? error.message.slice(0, 140) : `reachable (${count ?? 0} profiles)`,
    };
  })();

  const storageProbe = admin.storage.listBuckets().then(({ data, error }) => ({
    result: {
      name: 'Supabase · storage',
      ok: !error,
      latencyMs: Date.now() - t0,
      detail: error ? error.message.slice(0, 140) : `${data?.length ?? 0} buckets`,
    } as ProbeResult,
    buckets: (data ?? []).map(b => ({ name: b.name, fileSizeLimit: (b as { file_size_limit?: number | null }).file_size_limit ?? null })),
  }));

  const [db, storage, meetingBot, agentos, compute, nango, resend] = await Promise.all([
    dbProbe,
    storageProbe,
    httpProbe('Hetzner · meeting-bot', process.env.MEETING_BOT_SERVICE_URL ? `${process.env.MEETING_BOT_SERVICE_URL}/health` : undefined),
    httpProbe('Hetzner · AgentOS', process.env.AGENTOS_SERVICE_URL ? `${process.env.AGENTOS_SERVICE_URL}/health` : undefined),
    httpProbe('Hetzner · compute sandbox', process.env.COMPUTE_SERVICE_URL ? `${process.env.COMPUTE_SERVICE_URL}/health` : undefined),
    httpProbe('Nango (integrations OAuth)', process.env.NANGO_HOST, { okBelow: 500, note: 'reachability only' }),
    httpProbe('Resend (coworker email)', process.env.RESEND_API_KEY ? 'https://api.resend.com/domains' : undefined,
      { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, note: 'key valid, domains listable' }),
  ]);

  const whisper: ProbeResult = {
    name: 'Hetzner · Whisper', ok: null, latencyMs: null,
    detail: 'not externally reachable by design (binds 127.0.0.1 + docker bridge only) — health rides meeting-bot transcription outcomes',
  };
  const tavily: ProbeResult = {
    name: 'Tavily (web research)', ok: process.env.TAVILY_API_KEY ? null : false, latencyMs: null,
    detail: process.env.TAVILY_API_KEY ? 'key present — no free health endpoint; verified only by real research calls' : 'TAVILY_API_KEY missing',
  };

  return { services: [db, storage.result, meetingBot, agentos, compute, whisper, nango, resend, tavily], storageBuckets: storage.buckets };
}

// ── Band 3: silent-death detectors (all from data we already log) ───────────────────────────────

const QUIET_AFTER_MS = 36 * 60 * 60 * 1000; // active-in-7d channel silent >36h → warn

async function usageSignals(admin: SupabaseClient): Promise<{ heartbeats: ChannelHeartbeat[]; burn: PlatformStatus['burn']; spendByWorkspace: PlatformStatus['spendByWorkspace'] }> {
  const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
  // Paginate past PostgREST's 1000-row cap — minimal columns only.
  const rows: Array<{ user_id: string; provider: string; tier: string | null; task_type: string | null; source: string; cost_eur: number; created_at: string }> = [];
  for (let page = 0; page < 60; page++) {
    const { data, error } = await admin
      .from('ai_usage_events')
      .select('user_id, provider, tier, task_type, source, cost_eur, created_at')
      .gte('created_at', since14)
      .order('created_at', { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (error || !data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }

  // user → workspace map, so spend reads per client instead of per anonymous uuid.
  const [{ data: members }, { data: companies }] = await Promise.all([
    admin.from('company_members').select('user_id, company_id').eq('status', 'active'),
    admin.from('companies').select('id, name, ai_tier'),
  ]);
  const companyById = new Map((companies ?? []).map((c: { id: string; name: string; ai_tier: string | null }) => [c.id, c]));
  const workspaceByUser = new Map<string, { id: string; name: string; tier: string | null }>();
  const memberCounts = new Map<string, number>();
  for (const m of (members ?? []) as Array<{ user_id: string; company_id: string }>) {
    const c = companyById.get(m.company_id);
    if (c && !workspaceByUser.has(m.user_id)) workspaceByUser.set(m.user_id, { id: c.id, name: c.name, tier: c.ai_tier });
    memberCounts.set(m.company_id, (memberCounts.get(m.company_id) ?? 0) + 1);
  }

  const cut7 = Date.now() - 7 * 864e5;
  const burnMap = new Map<string, { eur7d: number; eurPrev7d: number }>();
  const wsMap = new Map<string, { name: string; tier: string | null; members: number; eur7d: number; eurPrev7d: number }>();
  const lastSeen = new Map<string, number>();
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    const cost = Number(r.cost_eur) || 0;
    const recent = t >= cut7;
    const b = burnMap.get(r.provider) ?? { eur7d: 0, eurPrev7d: 0 };
    if (recent) b.eur7d += cost; else b.eurPrev7d += cost;
    burnMap.set(r.provider, b);
    const ws = workspaceByUser.get(r.user_id);
    const wsKey = ws?.id ?? '__none__';
    const w = wsMap.get(wsKey) ?? {
      name: ws?.name ?? 'No workspace', tier: ws?.tier ?? null,
      members: ws ? (memberCounts.get(ws.id) ?? 0) : 0, eur7d: 0, eurPrev7d: 0,
    };
    if (recent) w.eur7d += cost; else w.eurPrev7d += cost;
    wsMap.set(wsKey, w);
    const channel = `${r.tier ?? '?'} · ${r.task_type ?? r.source}`;
    lastSeen.set(channel, Math.max(lastSeen.get(channel) ?? 0, t));
  }

  const heartbeats = [...lastSeen.entries()]
    .map(([channel, t]) => ({ channel, lastSeen: new Date(t).toISOString(), quiet: Date.now() - t > QUIET_AFTER_MS }))
    .sort((a, b) => Number(b.quiet) - Number(a.quiet) || a.channel.localeCompare(b.channel));

  const round = (n: number) => Math.round(n * 100) / 100;
  const burn = [...burnMap.entries()]
    .map(([provider, v]) => ({ provider, eur7d: round(v.eur7d), eurPrev7d: round(v.eurPrev7d) }))
    .sort((a, b) => b.eur7d - a.eur7d);
  const spendByWorkspace = [...wsMap.values()]
    .map(w => ({ ...w, eur7d: round(w.eur7d), eurPrev7d: round(w.eurPrev7d) }))
    .sort((a, b) => b.eur7d - a.eur7d);

  return { heartbeats, burn, spendByWorkspace };
}

async function scheduleHealth(admin: SupabaseClient): Promise<PlatformStatus['scheduleHealth']> {
  const { data } = await admin
    .from('workflows')
    .select('id, name, status, trigger, triggers, next_run_at')
    .eq('status', 'active');
  const { normalizeTriggers } = await import('@/lib/workflows/trigger-sources');
  const out: PlatformStatus['scheduleHealth'] = [];
  const graceMs = 2 * 60 * 60 * 1000; // the dispatcher is hourly — 2h late is genuinely stuck
  for (const w of (data ?? []) as Array<{ id: string; name: string; trigger: unknown; triggers: unknown; next_run_at: string | null }>) {
    let hasSchedule = false;
    try {
      hasSchedule = normalizeTriggers(w as never).primary.type === 'schedule';
    } catch { /* unreadable trigger config is itself a finding */ }
    if (!hasSchedule) continue;
    if (!w.next_run_at) {
      out.push({ id: w.id, name: w.name, nextRunAt: null, problem: 'scheduled but next_run_at is NULL — the dispatcher will never fire it (the July AHK class)' });
    } else if (new Date(w.next_run_at).getTime() < Date.now() - graceMs) {
      out.push({ id: w.id, name: w.name, nextRunAt: w.next_run_at, problem: `next_run_at is ${w.next_run_at} — over 2h past due` });
    }
  }
  return out;
}

// ── Assembly ────────────────────────────────────────────────────────────────────────────────────

export async function getPlatformStatus(admin: SupabaseClient): Promise<PlatformStatus> {
  const t0 = Date.now();
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);

  const [ai, svc, usage, schedules, emailsTodayRes] = await Promise.all([
    probeAI(),
    probeServices(admin),
    usageSignals(admin),
    scheduleHealth(admin),
    admin.from('email_sends').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
  ]);

  const warnings: StatusWarning[] = [];
  for (const p of ai) if (p.ok === false) {
    warnings.push({ severity: 'red', text: `The AI model ${p.model} (${p.provider}) is not answering — ${p.detail}. This breaks the ${p.usedBy.map(u => u.tier).join(' and ')} tier${p.usedBy.length > 1 ? 's' : ''} right now.` });
  }
  for (const s of svc.services) if (s.ok === false) {
    warnings.push({ severity: 'red', text: `${s.name} is not answering — ${s.detail}.` });
  }
  for (const w of schedules) {
    warnings.push({ severity: 'red', text: `The scheduled workflow "${w.name}" will not run again on its own — ${w.nextRunAt ? `its next run was due ${w.nextRunAt.slice(0, 16).replace('T', ' ')} and never fired` : 'it has no next run scheduled'}. Reset its schedule or it stays dead silently.` });
  }
  for (const h of usage.heartbeats) if (h.quiet) {
    warnings.push({ severity: 'amber', text: `"${h.channel}" was working this fortnight but has gone quiet (last success ${h.lastSeen.slice(0, 16).replace('T', ' ')} UTC). If it normally runs daily, something upstream broke without an error reaching anyone.` });
  }
  for (const b of usage.burn) {
    if (b.eurPrev7d > 0.5 && b.eur7d > b.eurPrev7d * 1.5) {
      warnings.push({ severity: 'amber', text: `${b.provider} spend jumped: €${b.eur7d} this week vs €${b.eurPrev7d} last week. Worth topping up credits before they run out — providers give no balance warning.` });
    }
  }
  const unlimitedBuckets = svc.storageBuckets.filter(b => b.fileSizeLimit == null);
  if (unlimitedBuckets.length) {
    warnings.push({ severity: 'amber', text: `Storage buckets without their own upload size cap: ${unlimitedBuckets.map(b => b.name).join(', ')}. They inherit the project-wide cap, which once silently rejected large recordings — set an explicit cap per bucket.` });
  }

  return {
    generatedAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
    ai,
    services: svc.services,
    heartbeats: usage.heartbeats,
    burn: usage.burn,
    spendByWorkspace: usage.spendByWorkspace,
    scheduleHealth: schedules,
    storageBuckets: svc.storageBuckets,
    emailsToday: emailsTodayRes.count ?? 0,
    warnings: warnings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1)),
  };
}
