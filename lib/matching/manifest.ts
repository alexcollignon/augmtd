// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROFILE MANIFEST — the OPTIONAL deterministic index over a folder of profile documents.
//
// A matcher works on a bare folder of profiles with nothing else: pure semantic recall. A manifest,
// when one exists FOR THAT FOLDER, adds the deterministic lane — join keys the source's items share
// with the profiles (a taxonomy code), a ranking hint, and display badges.
//
// It is written by whatever process builds the folder (a directory sync, a seed kit, a script) and
// is keyed by the FOLDER NAME, so a workspace can hold several profile collections at once and a
// matcher never reads another folder's index. Nothing here knows what the profiles are.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

export const PROFILE_MANIFEST_KIND = 'profile_manifest';
export const PROFILE_MANIFEST_VERSION = 1;

export interface ProfileFacts {
  /** Must equal the id the profile document's filename leads with, or the matcher cannot join the
   *  manifest row to the indexed document. */
  profileId: string;
  name: string;
  /** Deterministic join keys — the same vocabulary a source item's `meta.keys` uses. */
  keys: string[];
  /** Short display labels the report prints beside a match ("50–249 MA", a region, a tie). */
  badges: string[];
  /** WHERE THE PROFILE LIVES — the canonical page for this candidate (a portal profile, an ATS
   *  record, a CRM link). When present the report LINKS the matched name; when absent it prints the
   *  name plain. Optional by construction: a manifest-less folder, and every manifest written before
   *  this field existed, render exactly as they always did. */
  url?: string;
  /** Ranking hint within the deterministic lane, higher first. Ordering only — it never decides
   *  whether a match is claimed. */
  rank: number;
}

export interface ProfileManifest {
  version: number;
  /** The KB folder this index describes. A manifest is never read for another folder. */
  folder: string;
  syncedAt: string;
  profiles: ProfileFacts[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export function coerceProfileManifest(raw: unknown): ProfileManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.profiles)) return null;
  return {
    version: Number(r.version) || PROFILE_MANIFEST_VERSION,
    folder: str(r.folder),
    syncedAt: str(r.syncedAt),
    profiles: r.profiles.map((p) => {
      const q = (p ?? {}) as Record<string, unknown>;
      return {
        profileId: str(q.profileId).trim(),
        name: str(q.name).trim(),
        keys: Array.isArray(q.keys) ? q.keys.map(str).map((s) => s.trim()).filter(Boolean) : [],
        badges: Array.isArray(q.badges) ? q.badges.map(str).map((s) => s.trim()).filter(Boolean) : [],
        url: str(q.url).trim() || undefined,
        rank: Number(q.rank) || 0,
      };
    }).filter((p) => !!p.profileId),
  };
}

/** The folder's index, or null. A missing manifest is NOT an error — it is the pure-semantic path. */
export async function readProfileManifest(
  admin: SupabaseClient, userId: string, folder: string,
): Promise<ProfileManifest | null> {
  try {
    const { data, error } = await admin.from('item_plans').select('tasks')
      .eq('user_id', userId).eq('kind', PROFILE_MANIFEST_KIND).eq('entity_id', folder).maybeSingle();
    if (error) { console.error('[matching] profile manifest read failed:', error.message); return null; }
    const man = coerceProfileManifest(data?.tasks);
    if (!man || !man.profiles.length) return null;
    // A manifest that names a different folder is another collection's index — never borrowed.
    if (man.folder && man.folder.toLowerCase() !== folder.toLowerCase()) return null;
    return man;
  } catch { return null; }
}

/** Replace-on-sync: one manifest row per (user, folder). */
export async function writeProfileManifest(
  admin: SupabaseClient, userId: string, manifest: ProfileManifest,
): Promise<void> {
  const { error } = await admin.from('item_plans').upsert({
    user_id: userId,
    kind: PROFILE_MANIFEST_KIND,
    entity_id: manifest.folder,
    tasks: manifest as never,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,kind,entity_id' });
  if (error) throw new Error(`profile manifest write failed: ${error.message}`);
}
