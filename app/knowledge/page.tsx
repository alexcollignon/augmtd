import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SidebarNav from '@/components/sidebar-nav';
import KnowledgePageClient from './knowledge-page-client';

export default async function KnowledgePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: sources } = await supabase
    .from('knowledge_sources')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Pass full connection list so the client can build a per-account picker
  const { data: connections } = await supabase
    .from('connections')
    .select('id, provider, metadata')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .in('provider', ['gmail', 'outlook']);

  return (
    <div className="flex h-screen bg-gradient-to-br from-neutral-50 to-white">
      <SidebarNav userEmail={user.email} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 py-8 lg:py-12">
          <div className="mb-10">
            <h1 className="text-2xl lg:text-3xl font-bold text-neutral-900 mb-2">
              Knowledge Base
            </h1>
            <p className="text-[15px] text-neutral-600">
              Connect folders from Google Drive or OneDrive. AUGMTD indexes them so your workflows have the right context.
            </p>
          </div>

          <KnowledgePageClient
            initialSources={sources ?? []}
            connections={(connections ?? []).map((c) => ({
              id: c.id,
              provider: c.provider as 'gmail' | 'outlook',
              email: c.metadata?.email ?? '',
            }))}
          />
        </div>
      </main>
    </div>
  );
}
