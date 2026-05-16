// ─── Browser fetch tool ───────────────────────────────────────────────────────
// Fetches JS-rendered pages using a headless Chromium browser.
// Use when fetch_url returns empty/useless content because the page requires
// JavaScript to load its data (SPAs, AJAX-driven tables, etc.)
//
// Optional: set intercept_url to capture an AJAX response instead of page HTML.

const MAX_CONTENT_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 30_000;

const PRIVATE_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|metadata\.google\.internal|100\.100\.100\.100|\[::1\]|::1$)/i;

function isValidBrowserUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (PRIVATE_HOST_RE.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function executeBrowserFetch(config: Record<string, unknown>): Promise<string> {
  const url = typeof config.url === 'string' ? config.url.trim() : null;
  if (!url || !isValidBrowserUrl(url)) return '[browser_fetch] Invalid or disallowed URL.';

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

    // Intercept mode: capture matching AJAX response before page content is extracted
    if (interceptUrl) {
      // Use a promise that resolves when the target response arrives
      const captured = await Promise.race([
        new Promise<string>(resolve => {
          page.on('response', async res => {
            if (!res.url().includes(interceptUrl) || res.status() !== 200) return;
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
