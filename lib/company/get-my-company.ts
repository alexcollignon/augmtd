import type { SupabaseClient } from '@supabase/supabase-js';
import type { MyCompany } from '@/lib/types/company';
import { getMyWorkspace } from '@/lib/workspace/features';

/**
 * @deprecated Use `getMyWorkspace` from `lib/workspace/features` directly.
 * Kept as a thin shim for existing imports; returns the same underlying data
 * shape with the new `type` and `features` fields present.
 */
export async function getMyCompany(
  userId: string,
  supabase: SupabaseClient
): Promise<MyCompany | null> {
  const workspace = await getMyWorkspace(userId, supabase);
  if (!workspace) return null;
  return workspace as unknown as MyCompany;
}
