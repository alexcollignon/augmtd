import type { SupabaseClient } from '@supabase/supabase-js';

export async function isSuperAdmin(userId: string, supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('is_super_admin')
    .eq('id', userId)
    .single();
  return data?.is_super_admin === true;
}
