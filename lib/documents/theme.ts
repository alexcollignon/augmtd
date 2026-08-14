// ─── THE BRANDED KIT (document hands DH4, Aug 11) ────────────────────────────────────────────
// ONE workspace document theme — logo (already in companies.settings.branding from the
// sovereign door) + accent color + footer line — consumed by every builder. Set once, every
// deliverable is born on letterhead: "brand it with our logo and colors" is a stored fact,
// not a per-prompt lottery. Fail-soft everywhere: no workspace / no branding / logo fetch
// failure → the house default; a theme problem never blocks a deliverable.

import type { SupabaseClient } from '@supabase/supabase-js';

export type DocTheme = {
  accent: string;                 // hex WITHOUT '#'
  footer: string | null;          // e.g. "Prepared by Acme Consulting"
  brandName: string | null;
  /** Fetched + embeddable logo (raster only), with real pixel dimensions. */
  logo: { dataB64: string; mime: string; w: number; h: number } | null;
  /** THE DUAL-LOGO COVER (the STC-benchmark ask): a SECOND mark — author × client — placed
   *  opposite the first (header right / cover right). Built when the user attaches two logos
   *  with a branding word; null everywhere else (single-logo layouts unchanged). */
  logo2?: { dataB64: string; mime: string; w: number; h: number } | null;
};

/** An embeddable logo record from raw bytes (dims read via canvas; png/jpg only). */
export async function logoFromBuffer(buf: Buffer, mime: string): Promise<NonNullable<DocTheme['logo']> | null> {
  try {
    if (mime !== 'image/png' && mime !== 'image/jpeg') return null;
    const { loadImage } = await import('canvas');
    const img = await loadImage(buf);
    if (!img.width || !img.height) return null;
    return { dataB64: buf.toString('base64'), mime, w: img.width, h: img.height };
  } catch { return null; }
}

export const HOUSE_ACCENT = '4F46E5'; // the app's indigo — the default when no theme is set

/** PNG pixel dimensions from the IHDR chunk — deterministic, no image library. */
export function pngDims(buf: Buffer): { w: number; h: number } | null {
  try {
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch { return null; }
}

const normalizeHex = (s: unknown): string | null => {
  const m = String(s ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(m) ? m.toUpperCase() : null;
};

// ── THE MOMENT THEME (owner, Aug 11 — "not a set-in-stone ask; could be for something
// specific in that moment"): a logo attached in chat + a branding word builds a theme ON THE
// SPOT for that deliverable. "Always brand…" makes it durable (per-user). Hierarchy:
// the request's own logo → the user's saved theme → the workspace theme → the house look. ──

/** Dominant SATURATED color from an image buffer (node-canvas; downscaled; grey/white/black
 *  ignored) — "our colors" comes from the logo itself, nobody types hex. */
export async function extractPaletteAccent(buf: Buffer): Promise<string | null> {
  try {
    const { createCanvas, loadImage } = await import('canvas');
    const img = await loadImage(buf);
    if (!img.width || !img.height) return null;
    const w = Math.min(64, img.width), h = Math.max(1, Math.round((img.height / img.width) * w));
    const cv = createCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (sat < 0.25 || mx < 50 || (mx > 240 && sat < 0.35)) continue; // skip grey/white/near-black
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`; // 32-step quantization
      const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      buckets.set(key, { n: cur.n + 1, r: cur.r + r, g: cur.g + g, b: cur.b + b });
    }
    const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    if (!top || top.n < 4) return null;
    const hex = (v: number) => Math.round(v / top.n).toString(16).padStart(2, '0');
    return `${hex(top.r)}${hex(top.g)}${hex(top.b)}`.toUpperCase();
  } catch { return null; }
}

/** Build a full theme from raw logo bytes (any raster canvas can read) — dims + accent in one. */
export async function themeFromLogoBuffer(buf: Buffer, mime: string, opts: { footer?: string | null; brandName?: string | null } = {}): Promise<DocTheme | null> {
  try {
    const { loadImage } = await import('canvas');
    const img = await loadImage(buf);
    if (!img.width || !img.height) return null;
    const accent = (await extractPaletteAccent(buf)) ?? HOUSE_ACCENT;
    // docx ImageRun supports png/jpg — webp logos keep the accent but skip the embedded image.
    const embeddable = mime === 'image/png' || mime === 'image/jpeg';
    return {
      accent,
      footer: opts.footer ?? null,
      brandName: opts.brandName ?? null,
      logo: embeddable ? { dataB64: buf.toString('base64'), mime, w: img.width, h: img.height } : null,
    };
  } catch { return null; }
}

const USER_THEME_KIND = 'doc_theme';

/** "Always brand our documents like this" — the durable per-user theme. */
export async function saveUserTheme(client: SupabaseClient, userId: string, theme: DocTheme | null): Promise<void> {
  if (theme === null) {
    await client.from('item_plans').delete().eq('user_id', userId).eq('kind', USER_THEME_KIND).eq('entity_id', 'me');
    return;
  }
  await client.from('item_plans').upsert({
    user_id: userId, kind: USER_THEME_KIND, entity_id: 'me', tasks: theme as never, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' });
}

export async function readUserTheme(client: SupabaseClient, userId: string): Promise<DocTheme | null> {
  try {
    const { data } = await client.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', USER_THEME_KIND).eq('entity_id', 'me').maybeSingle();
    const t = data?.tasks as DocTheme | undefined;
    return t?.accent ? t : null;
  } catch { return null; }
}

/** The one theme read — the USER's saved theme first, then workspace branding, then null.
 *  Logo fetched server-side for the workspace path (≤1MB PNG embeds with true dimensions). */
export async function getDocTheme(client: SupabaseClient, userId: string): Promise<DocTheme | null> {
  const user = await readUserTheme(client, userId);
  if (user) return user;
  try {
    const { data: mem } = await client.from('company_members').select('company_id')
      .eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
    if (!mem) return null;
    const { data: co } = await client.from('companies').select('name, settings')
      .eq('id', mem.company_id).maybeSingle();
    const branding = ((co?.settings ?? {}) as { branding?: { logo_url?: string; accent_color?: string; footer_line?: string } }).branding;
    if (!branding || (!branding.logo_url && !branding.accent_color && !branding.footer_line)) return null;

    let logo: DocTheme['logo'] = null;
    if (branding.logo_url) {
      try {
        const url = branding.logo_url.startsWith('/')
          ? `${process.env.AUGMTD_WEBHOOK_BASE_URL ?? 'https://app.augmtd.ai'}${branding.logo_url}`
          : branding.logo_url;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 0 && buf.length <= 1024 * 1024) {
            const dims = pngDims(buf);
            if (dims && dims.w > 0 && dims.h > 0) {
              logo = { dataB64: buf.toString('base64'), mime: 'image/png', w: dims.w, h: dims.h };
            }
          }
        }
      } catch { /* text branding still applies */ }
    }

    return {
      accent: normalizeHex(branding.accent_color) ?? HOUSE_ACCENT,
      footer: String(branding.footer_line ?? '').trim().slice(0, 120) || null,
      brandName: (co?.name as string) ?? null,
      logo,
    };
  } catch { return null; }
}
