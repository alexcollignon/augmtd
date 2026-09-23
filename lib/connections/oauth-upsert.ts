// ════════════════════════════════════════════════════════════════════════════════════════════════
// A SIGN-IN IS NOT A NEW MAILBOX (W11.3 · WHAT THE SCREEN SAYS IS TRUE — owner walk Sep 23:
// Settings → Email → Connections said "Never synced" for a Gmail that had synced at 20:00).
//
// The root cause was not the card. Both OAuth callbacks (sign-in with Google/Microsoft, and the
// in-app reconnect) UPSERTED the connection row with `last_sync: null, sync_status: 'pending'` and a
// WHOLE-OBJECT `metadata` — so every sign-in silently (a) erased the sync cursor (the card then
// truthfully printed "Never synced", the next sync re-ran as a FIRST sync), and (b) dropped every
// metadata key the platform had earned on the row (first_look_at, push watch shape, calendar
// cursor). The card was reading the right column; the column was being wiped.
//
// THE LAW: an OAuth round-trip refreshes the row's IDENTITY and TOKENS and re-activates it. It never
// resets the sync cursor or the platform's own metadata on a row that already exists. A brand-new
// row starts with no cursor and `pending`, as before. Pure merge + one IO wrapper; zero AI.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';

export type OAuthIdentity = {
  user_id: string;
  provider: 'gmail' | 'outlook';
  provider_account_id: string;
  /** Identity keys the provider just told us (email, name, picture …) — they refresh. */
  identity: Record<string, unknown>;
  /** The freshly encrypted token blob. */
  tokens: string;
};

export type ExistingConnection = { id: string; metadata: Record<string, unknown> | null } | null;

/** PURE — the row an OAuth round-trip writes. Existing row: identity + tokens refresh, status
 *  re-activates, every other metadata key survives and the cursor columns are NOT in the payload
 *  (so they cannot be touched). New row: no cursor, `pending`. */
export function oauthConnectionWrite(existing: ExistingConnection, inc: OAuthIdentity): Record<string, unknown> {
  const metadata = { ...(existing?.metadata ?? {}), ...inc.identity, tokens: inc.tokens };
  if (existing) return { status: 'active', metadata };
  return {
    user_id: inc.user_id, provider: inc.provider, provider_account_id: inc.provider_account_id,
    status: 'active', metadata, last_sync: null, sync_status: 'pending',
  };
}

/** The one write both callbacks use. Returns the Supabase error, if any (callers check it). */
export async function upsertOAuthConnection(admin: SupabaseClient, inc: OAuthIdentity): Promise<{ error: { message: string } | null }> {
  const { data: existing, error: readErr } = await admin.from('connections')
    .select('id, metadata')
    .eq('user_id', inc.user_id).eq('provider', inc.provider).eq('provider_account_id', inc.provider_account_id)
    .maybeSingle();
  if (readErr) return { error: readErr };
  const row = oauthConnectionWrite((existing as ExistingConnection) ?? null, inc);
  if (existing) {
    const { error } = await admin.from('connections').update(row).eq('id', (existing as { id: string }).id);
    return { error };
  }
  const { error } = await admin.from('connections').upsert(row, { onConflict: 'user_id,provider,provider_account_id' });
  return { error };
}
