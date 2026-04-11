import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * Returns the authenticated user for the current request.
 * Wrapped in React's cache() so the Supabase auth call is deduped across
 * layout + page server components in the same render pass.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
