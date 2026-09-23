// ─── THE SAFE FETCH (W0.3 — UNTRUSTED INPUT IS DATA: SSRF) ──────────────────────────────────
// Every server-side fetch of a URL that a model, a feed, or an inbound message chose goes through
// here. The old guards were a string-prefix regex on the RAW url — `http://2130706433/`,
// `http://[::1]/`, a public hostname resolving to 10.x, or a public page 302-ing to
// 169.254.169.254 all walked straight past them.
//
// The law, in three places that cannot drift:
//   1. `classifyUrl` — scheme is http/https; the WHATWG URL parser normalizes decimal/octal/hex IP
//      tricks first, then any IP literal is checked against the forbidden ranges (v4 AND v6,
//      incl. v4-mapped/NAT64/6to4 embeddings); `localhost`/`.localhost`/`.local`/`.internal` refuse.
//   2. `pinnedLookup` — the connect-time DNS lookup: EVERY resolved address must be public, and the
//      socket connects to exactly the address we checked (no rebinding between check and connect).
//   3. manual redirects (max 5) — every hop re-enters (1) and (2).
// Plus a wall-clock timeout across all hops and a byte cap on the body.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

// ── Address law (pure) ──────────────────────────────────────────────────────────────────────

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function inV4(n: number, base: string, bits: number): boolean {
  const b = v4ToInt(base)!;
  const size = 2 ** (32 - bits);
  return Math.floor(n / size) === Math.floor(b / size);
}

const V4_FORBIDDEN: Array<[string, number]> = [
  ['0.0.0.0', 8],        // "this network" / unspecified
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local (cloud metadata)
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.88.99.0', 24],   // 6to4 relay anycast
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved + broadcast
];

function isForbiddenV4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return true;
  return V4_FORBIDDEN.some(([base, bits]) => inV4(n, base, bits));
}

/** Expand an IPv6 literal (no brackets, no zone) to 8 hextets; null when malformed. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  // A trailing dotted quad (::ffff:1.2.3.4) becomes two hextets.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const n = v4ToInt(tail);
    if (n === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(Math.floor(n / 65536)).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const all = [...head, ...Array(fill).fill('0'), ...rest];
  if (all.length !== 8) return null;
  const out: number[] = [];
  for (const h of all) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  return out;
}

function v4FromHextets(hi: number, lo: number): string {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

function isForbiddenV6(ip: string): boolean {
  const h = expandV6(ip);
  if (!h) return true;
  const zeroPrefix = (k: number) => h.slice(0, k).every(x => x === 0);
  if (h.every(x => x === 0)) return true;                                   // :: unspecified
  if (zeroPrefix(7) && h[7] === 1) return true;                             // ::1 loopback
  if (zeroPrefix(5) && h[5] === 0xffff) return isForbiddenV4(v4FromHextets(h[6], h[7])); // ::ffff:v4 mapped
  if (zeroPrefix(6)) return true;                                           // ::v4 compatible (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every(x => x === 0)) {
    return isForbiddenV4(v4FromHextets(h[6], h[7]));                        // 64:ff9b::/96 NAT64
  }
  if (h[0] === 0x2002) return isForbiddenV4(v4FromHextets(h[1], h[2]));     // 6to4 embeds a v4
  if ((h[0] & 0xfe00) === 0xfc00) return true;                              // fc00::/7 unique-local
  if ((h[0] & 0xffc0) === 0xfe80) return true;                              // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true;                              // fec0::/10 site-local
  if ((h[0] & 0xff00) === 0xff00) return true;                              // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;                      // documentation
  if (h[0] === 0x2001 && h[1] === 0x0000) return true;                      // Teredo (embeds v4)
  if (h[0] === 0x0100 && h.slice(1, 4).every(x => x === 0)) return true;    // 100::/64 discard
  return false;
}

/** True when an IP address (v4 or v6 literal) must never be fetched. A non-IP string is forbidden. */
export function isForbiddenAddress(ip: string): boolean {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const kind = isIP(bare.split('%')[0]);
  if (kind === 4) return isForbiddenV4(bare);
  if (kind === 6) return isForbiddenV6(bare);
  return true;
}

const FORBIDDEN_NAME_RE = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

export type UrlVerdict =
  | { ok: true; url: URL; needsDns: boolean }
  | { ok: false; reason: string };

/**
 * Pure, synchronous: scheme + name + IP-literal law. `needsDns` = the host is a name whose
 * addresses still have to be checked (`checkUrl` / the pinned lookup do that).
 */
export function classifyUrl(raw: string): UrlVerdict {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, reason: 'malformed URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'only http/https' };
  if (u.username || u.password) return { ok: false, reason: 'credentials in URL' };
  // WHATWG already normalized 2130706433 / 0x7f000001 / 017700000001 → 127.0.0.1 and [::ffff:127.0.0.1]
  // → [::ffff:7f00:1]; the literal check runs on that normal form.
  const host = u.hostname.replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'no host' };
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(bare)) {
    return isForbiddenAddress(bare) ? { ok: false, reason: `forbidden address ${bare}` } : { ok: true, url: u, needsDns: false };
  }
  if (FORBIDDEN_NAME_RE.test(host) || !host.includes('.')) return { ok: false, reason: `forbidden host ${host}` };
  return { ok: true, url: u, needsDns: true };
}

/** Async: `classifyUrl` + every DNS answer must be public. */
export async function checkUrl(raw: string): Promise<UrlVerdict> {
  const v = classifyUrl(raw);
  if (!v.ok || !v.needsDns) return v;
  try {
    const addrs = await dnsLookup(v.url.hostname, { all: true, verbatim: true });
    if (!addrs.length) return { ok: false, reason: 'no DNS answer' };
    const bad = addrs.find(a => isForbiddenAddress(a.address));
    if (bad) return { ok: false, reason: `${v.url.hostname} resolves to forbidden ${bad.address}` };
    return v;
  } catch {
    return { ok: false, reason: `DNS lookup failed for ${v.url.hostname}` };
  }
}

// ── The pinned connection ─────────────────────────────────────────────────────────────────────

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

/** The connect-time lookup: resolve, refuse if ANY answer is forbidden, connect to what we checked. */
function pinnedLookup(hostname: string, options: { all?: boolean } | number | undefined, cb: LookupCb): void {
  dnsLookup(hostname, { all: true, verbatim: true })
    .then(addrs => {
      const bad = addrs.find(a => isForbiddenAddress(a.address));
      if (!addrs.length || bad) {
        const err = new Error(`safe-fetch: ${hostname} resolves to a forbidden address`) as NodeJS.ErrnoException;
        err.code = 'EFORBIDDEN';
        return cb(err, '', 0);
      }
      if (typeof options === 'object' && options?.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    })
    .catch(err => cb(err as NodeJS.ErrnoException, '', 0));
}

let agent: Agent | null = null;
function safeAgent(): Agent {
  if (!agent) agent = new Agent({ connect: { lookup: pinnedLookup as never } });
  return agent;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  /** Wall clock across every hop. */
  timeoutMs?: number;
  /** Body bytes read before the stream is cut (the rest is dropped, `truncated` says so). */
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  /** The URL that finally answered (after redirects). */
  url: string;
  headers: Headers;
  body: string;
  truncated: boolean;
}

export class SafeFetchError extends Error {}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

/** GET a URL under the SSRF law. Throws SafeFetchError on a refused hop; network errors propagate. */
export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = raw;
  for (let hop = 0; ; hop++) {
    const v = classifyUrl(current);
    if (!v.ok) throw new SafeFetchError(`refused: ${v.reason}`);
    const res = await undiciFetch(v.url.toString(), {
      headers: opts.headers,
      redirect: 'manual',
      signal,
      dispatcher: safeAgent(),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => {});
      if (hop >= maxRedirects) throw new SafeFetchError('refused: too many redirects');
      current = new URL(res.headers.get('location')!, v.url).toString();
      continue;
    }
    const { body, truncated } = await readCapped(res.body as ReadableStream<Uint8Array> | null, maxBytes);
    return { status: res.status, ok: res.ok, url: v.url.toString(), headers: res.headers as unknown as Headers, body, truncated };
  }
}

async function readCapped(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  if (!stream) return { body: '', truncated: false };
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let seen = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - seen;
    if (value.byteLength > room) {
      out += decoder.decode(value.subarray(0, room), { stream: true });
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    seen += value.byteLength;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return { body: out, truncated };
}
