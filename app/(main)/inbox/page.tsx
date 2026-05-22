import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InboxPageClient } from '@/app/inbox/inbox-page-client';
import { guardFeaturePage } from '@/lib/workspace/guards';
import { listGmailAllFolders } from '@/lib/google/gmail';
import { listOutlookAllFolders } from '@/lib/microsoft/outlook';
import type { ConnectionFolders } from '@/components/inbox/folder-rail';

export const dynamic = 'force-dynamic';

export default async function PreparedWorkPage() {
  await guardFeaturePage('email');

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: connections }, { data: inboxItems }] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    supabase.from('connections').select('id, provider, metadata').eq('user_id', user.id).in('provider', ['gmail', 'outlook']).eq('status', 'active'),
    supabase.from('inbox_items').select('*').eq('user_id', user.id).eq('status', 'pending').order('priority', { ascending: false }).order('created_at', { ascending: false }),
  ]);

  const hasConnection = (connections?.length ?? 0) > 0;

  // Fetch folders for each connection in parallel, server-side so they're ready on first render
  const folderSections: ConnectionFolders[] = hasConnection
    ? (await Promise.all(
        (connections ?? []).map(async (conn) => {
          try {
            let folders;
            if (conn.provider === 'gmail') {
              folders = await listGmailAllFolders(conn.metadata.tokens);
            } else {
              folders = await listOutlookAllFolders(
                conn.metadata.tokens,
                async (newTokens) => {
                  const newEncrypted = Buffer.from(JSON.stringify(newTokens)).toString('base64');
                  await supabase.from('connections').update({ metadata: { ...conn.metadata, tokens: newEncrypted } }).eq('id', conn.id);
                },
              );
            }
            return { connectionId: conn.id, provider: conn.provider as 'gmail' | 'outlook', email: (conn.metadata as any)?.email ?? '', folders };
          } catch {
            return { connectionId: conn.id, provider: conn.provider as 'gmail' | 'outlook', email: (conn.metadata as any)?.email ?? '', folders: [] };
          }
        })
      )).filter(c => c.folders.length > 0)
    : [];

  return (
    <InboxPageClient
      initialUser={user}
      initialUserFullName={profile?.full_name}
      initialHasConnection={hasConnection}
      initialInboxItems={inboxItems || []}
      initialFolderSections={folderSections}
    />
  );
}
