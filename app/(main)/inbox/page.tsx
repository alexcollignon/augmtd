import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/get-session-user';
import { getMyProfile } from '@/lib/workspace/features';
import { InboxPageClient } from '@/app/inbox/inbox-page-client';
import { guardFeaturePage } from '@/lib/workspace/guards';

export const dynamic = 'force-dynamic';

export default async function PreparedWorkPage() {
  await guardFeaturePage('email');

  // Cached (deduped with the layout + guard's reads in this render pass).
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [profile, { data: connections }, { data: inboxItems }] = await Promise.all([
    getMyProfile(user.id),
    supabase.from('connections').select('id').eq('user_id', user.id).in('provider', ['gmail', 'outlook']).eq('status', 'active'),
    supabase.from('inbox_items').select('*').eq('user_id', user.id).eq('status', 'pending').order('priority', { ascending: false }).order('created_at', { ascending: false }),
  ]);

  const hasConnection = (connections?.length ?? 0) > 0;

  // Folders are fetched CLIENT-SIDE (hydrated instantly from localStorage, then refreshed in the
  // background) — the page NO LONGER blocks server rendering on the slow Gmail/Outlook folder APIs
  // (`listGmail/OutlookAllFolders`, which could add seconds to first paint). `InboxPageClient` already
  // has the `fetchFolders` fallback + a default-connection effect, so passing no initial folders is
  // functionally identical, just far faster to first paint. The inbox item list still ships from SSR.
  return (
    <InboxPageClient
      initialUser={user}
      initialUserFullName={profile?.full_name ?? undefined}
      initialHasConnection={hasConnection}
      initialInboxItems={inboxItems || []}
      initialFolderSections={undefined}
    />
  );
}
