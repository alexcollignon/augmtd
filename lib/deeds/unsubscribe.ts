// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE HONEST UNSUBSCRIBE SUBSET (docs/attention-plan.md, law A7).
//
// A7's floor, stated in the constitution's own words: "one-click/mailto unsubscribes fire
// automatically, link-only ones are reported as 'need a click from you', NEVER PRETENDED."
//
// This module is the parser and the one-click sender — pure RFC reading, no Supabase, no AI. It
// exists apart from the engine so the gate can assert the law at unit level, against fixtures,
// without a mailbox anywhere near it.
//
// THE THREE OUTCOMES, and why the third is a REFUSAL rather than a best effort:
//   • one_click — RFC 8058: `List-Unsubscribe-Post: List-Unsubscribe=One-Click` present AND an
//     https URL in `List-Unsubscribe`. The sender has explicitly declared that an unauthenticated
//     POST to that URL means "unsubscribe me" and that it is safe to fire without a human. This is
//     the ONLY http lane we may act on.
//   • mailto   — RFC 2369: a `mailto:` in `List-Unsubscribe`. We send that mail AS THE USER through
//     their own connected mailbox: the sender's own list software reads the From address, so a mail
//     from anyone else unsubscribes nobody.
//   • needs_click — an http(s) URL with NO one-click declaration. WE NEVER FETCH IT. A bare GET to
//     an unknown URL is at best a tracking pixel firing on the user's behalf and at worst a
//     one-click confirmation of an address to a spammer; and the page behind it usually requires a
//     form the machine cannot honestly fill. The URL is REPORTED, with its subject, and the person
//     clicks it. Pretending this lane worked is exactly the class the law forbids.
//   • none — no List-Unsubscribe at all. Counted, never guessed at.
//
// THE RFC SHAPE: `List-Unsubscribe` is a comma-separated list of angle-bracketed URIs —
//   List-Unsubscribe: <https://x.example/u/abc>, <mailto:u@x.example?subject=unsub>
// Order in the header is NOT preference; RFC 8058 says a one-click https URI is the preferred
// automatic lane when the Post header declares it, so that is the order we read.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** The lane one message's unsubscribe falls into. There is no fifth. */
export type UnsubscribeLane = 'one_click' | 'mailto' | 'needs_click' | 'none';

export type UnsubscribeTarget = {
  lane: UnsubscribeLane;
  /** The https URL — set for `one_click` (we POST it) and `needs_click` (we REPORT it). */
  url?: string;
  /** The mailto address — set for `mailto`. */
  mailto?: string;
  /** The subject the mailto URI asked for, when it named one (RFC 2369 allows `?subject=`). */
  mailtoSubject?: string;
};

/** RFC 8058's exact declaration. Case-insensitive, whitespace-tolerant; nothing else counts. */
const ONE_CLICK_RE = /List-Unsubscribe\s*=\s*One-Click/i;

/** Every `<uri>` in the header value, in the order the sender wrote them. */
function bracketedUris(header: string): string[] {
  const out: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) out.push(m[1].trim());
  // A sender that omitted the brackets (common enough, technically malformed) still gets read —
  // but only when the whole value is a single bare URI, never by splitting on commas inside a URL.
  if (!out.length) {
    const bare = header.trim();
    if (/^(https?:\/\/|mailto:)\S+$/i.test(bare)) out.push(bare);
  }
  return out;
}

/**
 * THE PARSER — the one place the three lanes are decided.
 *
 * `post` is the raw `List-Unsubscribe-Post` header value (absent for the overwhelming majority of
 * senders). A one-click claim WITHOUT an https URI is not one-click: the declaration alone is not a
 * door, so such a message falls to `mailto` if it has one and otherwise to `none`.
 */
export function parseUnsubscribe(
  listUnsubscribe: string | null | undefined,
  listUnsubscribePost?: string | null,
): UnsubscribeTarget {
  const header = String(listUnsubscribe ?? '').trim();
  if (!header) return { lane: 'none' };

  const uris = bracketedUris(header);
  const https = uris.find((u) => /^https:\/\//i.test(u));
  const anyHttp = https ?? uris.find((u) => /^https?:\/\//i.test(u));
  const mailtoUri = uris.find((u) => /^mailto:/i.test(u));

  // 1 · ONE-CLICK — the sender declared it AND gave us an https target. https only: a one-click
  //     POST carries an opaque subscriber token, and sending it in the clear is not a courtesy we
  //     extend on the user's behalf.
  if (https && ONE_CLICK_RE.test(String(listUnsubscribePost ?? ''))) {
    return { lane: 'one_click', url: https };
  }

  // 2 · MAILTO — we can speak as the user through their own mailbox.
  if (mailtoUri) {
    const rest = mailtoUri.slice('mailto:'.length);
    const [addr, query = ''] = rest.split('?');
    const subject = new URLSearchParams(query).get('subject');
    const address = decodeURIComponent(addr).trim();
    if (address.includes('@')) {
      return { lane: 'mailto', mailto: address, mailtoSubject: subject?.trim() || undefined };
    }
  }

  // 3 · NEEDS A CLICK — reported with its URL, NEVER fetched.
  if (anyHttp) return { lane: 'needs_click', url: anyHttp };

  return { lane: 'none' };
}

/** RFC 2369's conventional body for a mailto unsubscribe. The subject the sender asked for wins. */
export const UNSUBSCRIBE_MAIL_SUBJECT = 'unsubscribe';
export const UNSUBSCRIBE_MAIL_BODY = 'unsubscribe';

/**
 * THE ONE-CLICK POST (RFC 8058 §3.1) — `List-Unsubscribe=One-Click` as an
 * application/x-www-form-urlencoded body, no credentials, no redirects followed into another
 * origin's GET, a hard timeout. Never a GET: a GET is the lane we refuse.
 *
 * Returns the honest outcome; it never throws, because one dead list server must not fail a deed
 * of thirty.
 */
export async function fireOneClickUnsubscribe(
  url: string, timeoutMs = 10_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'not an https one-click URL' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      redirect: 'follow',
      signal: ctrl.signal,
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `the list server answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'the list server could not be reached' };
  } finally {
    clearTimeout(t);
  }
}
