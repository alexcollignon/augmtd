import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { buildEntityContext } from '@/lib/context/entity-context';

export const maxDuration = 20;

const emailOf = (s?: string | null): string | null =>
  String(s || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || null;

// GET /api/items/[id]/context?kind=email — the RELATIONSHIP dossier for reading this item like a human:
// who the sender/thread people are, the deal, open commitments with them, last/next meeting, related
// threads. Same assembly as classification (lib/context/entity-context), served to the deep-dive rail.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const kind = new URL(request.url).searchParams.get('kind') || 'email';

    // Resolve the item's participants + names. Email/followup are inbox items (from + to + cc); a commitment
    // uses its counterparty; a meeting isn't handled here (it has its own attendee-based context surface).
    let emails: (string | null)[] = [];
    let names: (string | null)[] = [];
    let threadId: string | null = null;

    if (kind === 'email' || kind === 'followup') {
      const { data: item } = await supabase.from('inbox_items').select('source_data').eq('id', id).eq('user_id', user.id).maybeSingle();
      const sd = (item?.source_data ?? {}) as Record<string, unknown>;
      emails = [(sd.from_address as string) || (sd.from as string), ...(((sd.to as string[]) ?? [])), ...(((sd.cc as string[]) ?? []))];
      names = [(sd.from_name as string) || null];
      threadId = (sd.thread_id as string) || null;
    } else if (kind === 'commitment') {
      const { data: c } = await supabase.from('commitments').select('counterparty').eq('id', id).eq('user_id', user.id).maybeSingle();
      const cp = (c?.counterparty as string) || '';
      if (emailOf(cp)) emails = [cp]; else names = [cp];
    } else {
      return NextResponse.json({ context: null });
    }

    // Exclude the user's OWN addresses (login + every connected mailbox) so we don't assemble context for self.
    const own = new Set<string>();
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const [{ data: conns }, { data: prof }] = await Promise.all([
      admin.from('connections').select('metadata, provider_account_id').eq('user_id', user.id),
      supabase.from('profiles').select('email').eq('id', user.id).maybeSingle(),
    ]);
    for (const c of (conns ?? []) as Array<{ metadata: { email?: string } | null; provider_account_id?: string | null }>) {
      const e = emailOf(c.metadata?.email || c.provider_account_id || ''); if (e) own.add(e);
    }
    const pe = emailOf((prof as { email?: string } | null)?.email || ''); if (pe) own.add(pe);
    const ue = emailOf(user.email || ''); if (ue) own.add(ue);

    const participantEmails = emails.map(emailOf).filter((e): e is string => !!e && !own.has(e));
    if (!participantEmails.length && !names.filter(Boolean).length) return NextResponse.json({ context: null });

    const context = await buildEntityContext(supabase, user.id, {
      emails: participantEmails.length ? participantEmails : emails,
      names, threadId, excludeItemId: kind === 'commitment' ? null : id,
    });
    return NextResponse.json({ context });
  } catch (e) {
    console.error('[items/context] error:', e);
    return NextResponse.json({ context: null });
  }
}
