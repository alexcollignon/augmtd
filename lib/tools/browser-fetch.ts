// ─── Browser fetch tool ───────────────────────────────────────────────────────
// Fetches JS-rendered pages using a headless Chromium browser.
// Use when fetch_url returns empty/useless content because the page requires
// JavaScript to load its data (SPAs, AJAX-driven tables, etc.)
//
// Optional: set intercept_url to capture an AJAX response instead of page HTML.

// THE SAFE FETCH (W0.3): the initial URL AND every request the page makes go through the same
// scheme + IP-literal + DNS law as fetch_url/rss_feed. `--no-sandbox` below is a container
// decision (serverless Chromium runs without a user namespace), not an egress control.
import { checkUrl } from '@/lib/utils/safe-fetch';

const MAX_CONTENT_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Non-network schemes a page may use freely; everything else must be http(s) and pass checkUrl. */
const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:']);

function makeHostGuard() {
  const cache = new Map<string, Promise<boolean>>();
  return (raw: string): Promise<boolean> => {
    let u: URL;
    try { u = new URL(raw); } catch { return Promise.resolve(false); }
    if (LOCAL_SCHEMES.has(u.protocol)) return Promise.resolve(true);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return Promise.resolve(false);
    const key = `${u.protocol}//${u.host}`;
    let hit = cache.get(key);
    if (!hit) { hit = checkUrl(raw).then(v => v.ok); cache.set(key, hit); }
    return hit;
  };
}

export async function executeBrowserFetch(config: Record<string, unknown>): Promise<string> {
  const url = typeof config.url === 'string' ? config.url.trim() : null;
  if (!url || !(await checkUrl(url)).ok) return '[browser_fetch] Invalid or disallowed URL.';

  const waitFor      = typeof config.wait_for      === 'string' ? config.wait_for      : null;
  const extract      = typeof config.extract       === 'string' ? config.extract       : 'body';
  const interceptUrl = typeof config.intercept_url === 'string' ? config.intercept_url : null;
  const timeout      = typeof config.timeout       === 'number' ? config.timeout       : DEFAULT_TIMEOUT_MS;

  let browser: import('playwright-core').Browser | null = null;

  try {
    const { chromium: pw } = await import('playwright-core');

    const isLambda = process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL;
    let launchOptions: Parameters<typeof pw.launch>[0];

    if (isLambda) {
      const chromium = (await import('@sparticuz/chromium')).default;
      launchOptions = {
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      };
    } else {
      launchOptions = { headless: true };
    }

    // Merge stealth args to avoid WAF/bot detection
    const stealthArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ];
    if (Array.isArray(launchOptions.args)) {
      launchOptions.args = [...new Set([...launchOptions.args, ...stealthArgs])];
    } else {
      launchOptions.args = stealthArgs;
    }

    browser = await pw.launch(launchOptions);
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-PT',
    });

    // Remove webdriver flag
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await ctx.newPage();

    // THE EGRESS LAW IN THE BROWSER: every first-hop request (navigation, subresource, XHR) is
    // resolved + checked before it leaves; a disallowed host is aborted. Playwright does NOT route
    // redirect hops, so a redirect INTO a disallowed host is caught on the request event and the
    // whole fetch refuses to return content (the model never reads what it answered).
    const allowed = makeHostGuard();
    let egressViolation: string | null = null;
    await ctx.route('**/*', async route => {
      const reqUrl = route.request().url();
      if (await allowed(reqUrl)) return route.continue();
      if (route.request().isNavigationRequest()) egressViolation = reqUrl;
      return route.abort('blockedbyclient');
    });
    page.on('request', req => {
      if (!req.redirectedFrom()) return;
      allowed(req.url()).then(ok => { if (!ok) egressViolation = req.url(); }).catch(() => { egressViolation = req.url(); });
    });
    const refusal = () => egressViolation
      ? `[browser_fetch] Refused: the page tried to reach a disallowed address (${new URL(egressViolation).host}).`
      : null;

    // Intercept mode: capture matching AJAX response before page content is extracted
    if (interceptUrl) {
      // Use a promise that resolves when the target response arrives
      const captured = await Promise.race([
        new Promise<string>(resolve => {
          page.on('response', async res => {
            if (!res.url().includes(interceptUrl) || res.status() !== 200) return;
            if (!(await allowed(res.url()))) return;
            const text = await res.text().catch(() => '');
            const trimmed = text.trim();
            if (trimmed.length > 0 && !trimmed.startsWith('<')) {
              resolve(trimmed);
            }
          });
          // Navigate after registering the listener so we don't miss early responses
          page.goto(url, { waitUntil: 'domcontentloaded', timeout }).catch(() => null);
        }),
        new Promise<null>(resolve => setTimeout(() => resolve(null), timeout)),
      ]);

      if (refusal()) return refusal()!;
      if (!captured) return `[browser_fetch] Page loaded but no response matched "${interceptUrl}".`;

      return formatIntercepted(url, captured);
    }

    // Default mode: extract text from page DOM
    await page.goto(url, { waitUntil: 'networkidle', timeout });

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: Math.min(timeout, 15_000) }).catch(() => null);
    }

    const text = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return '';
      return (el as HTMLElement).innerText ?? el.textContent ?? '';
    }, extract);

    if (refusal()) return refusal()!;
    if (!text?.trim()) return `[browser_fetch] Page loaded but no content at selector "${extract}".`;

    return `## ${url}\n\n${text.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_CHARS)}`;
  } catch (err) {
    return `[browser_fetch] Failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    await browser?.close().catch(() => null);
  }
}

function formatIntercepted(pageUrl: string, raw: string): string {
  // Try to parse as JSON and format nicely
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items as Record<string, unknown>[] : null;

    if (items) {
      const total = typeof data.total === 'number' ? data.total : items.length;
      const lines = items.slice(0, 25).map((item, i) => {
        const parts = Object.entries(item)
          .filter(([, v]) => v !== null && v !== false && v !== '')
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | ');
        return `${i + 1}. ${parts}`;
      });
      return `## ${pageUrl}\n\n${total} total results. Latest ${lines.length}:\n\n${lines.join('\n')}`.slice(0, MAX_CONTENT_CHARS);
    }

    return `## ${pageUrl}\n\n${JSON.stringify(data, null, 2).slice(0, MAX_CONTENT_CHARS)}`;
  } catch {
    return `## ${pageUrl}\n\n${raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_CHARS)}`;
  }
}
