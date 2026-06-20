// ─── Nango server client (self-hosted) ───────────────────────────────────────
// Thin fetch wrapper over our self-hosted Nango's REST API. Nango holds the
// OAuth tokens (encrypted, on our infra); this never sees an access token — all
// provider calls go through Nango's proxy. NANGO_SECRET_KEY stays server-side.
//
// Endpoints follow Nango's documented API; if the self-hosted version differs,
// adjust the paths here in one place.

const HOST = (process.env.NANGO_HOST ?? '').replace(/\/$/, '');
const SECRET = process.env.NANGO_SECRET_KEY ?? '';

export function isNangoConfigured(): boolean {
  return Boolean(HOST && SECRET);
}

async function nangoFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!isNangoConfigured()) throw new Error('Nango not configured (NANGO_HOST / NANGO_SECRET_KEY)');
  return fetch(`${HOST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/** Create a short-lived Connect session token for one user + one provider. */
export async function createConnectSession(userId: string, providers: string[]): Promise<string> {
  const res = await nangoFetch('/connect/sessions', {
    method: 'POST',
    body: JSON.stringify({ end_user: { id: userId }, allowed_integrations: providers }),
  });
  if (!res.ok) throw new Error(`Nango connect session failed (${res.status})`);
  const json = await res.json();
  const token = json?.data?.token ?? json?.token;
  if (!token) throw new Error('Nango connect session returned no token');
  return token as string;
}

/** Fetch a stored connection (to read metadata / verify it exists). null if none. */
export async function getConnection(providerConfigKey: string, connectionId: string): Promise<Record<string, unknown> | null> {
  const res = await nangoFetch(
    `/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(providerConfigKey)}`,
    { method: 'GET' },
  );
  if (!res.ok) return null;
  return res.json();
}

export interface NangoConnectionSummary {
  connectionId: string;
  providerConfigKey: string;
  endUserId: string | null;
  created: string;
}

/**
 * List stored connections (this environment), optionally filtered to one end-user.
 * Connect sessions assign their own connection id, so this is how the server finds
 * the connection it just created (match on the end_user id we passed = our scope key).
 */
export async function listConnections(endUserId?: string): Promise<NangoConnectionSummary[]> {
  const res = await nangoFetch('/connection', { method: 'GET' });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { connections?: Array<Record<string, unknown>> } | null;
  const out = (json?.connections ?? [])
    .map((c) => ({
      connectionId: String(c.connection_id ?? ''),
      providerConfigKey: String(c.provider_config_key ?? ''),
      endUserId:
        (c.end_user as { id?: string } | null)?.id ??
        (c.tags as { end_user_id?: string } | null)?.end_user_id ??
        null,
      created: String(c.created ?? c.created_at ?? ''),
    }))
    .filter((c) => c.connectionId);
  return endUserId ? out.filter((c) => c.endUserId === endUserId) : out;
}

/** Revoke + delete a stored connection. Best-effort. */
export async function deleteConnection(providerConfigKey: string, connectionId: string): Promise<void> {
  await nangoFetch(
    `/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(providerConfigKey)}`,
    { method: 'DELETE' },
  ).catch(() => {});
}

export interface ProxyResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Call a provider API through Nango's proxy — Nango injects the access token.
 * `endpoint` is the provider path (e.g. '/chat.postMessage', '/v1/search').
 */
export async function nangoProxy(args: {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  endpoint: string;
  providerConfigKey: string;
  connectionId: string;
  data?: unknown;
  params?: Record<string, string>;
  extraHeaders?: Record<string, string>;
}): Promise<ProxyResult> {
  const { method, endpoint, providerConfigKey, connectionId, data, params, extraHeaders } = args;
  const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const res = await nangoFetch(`/proxy${path}${qs}`, {
    method,
    headers: {
      'Provider-Config-Key': providerConfigKey,
      'Connection-Id': connectionId,
      ...(extraHeaders ?? {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}
