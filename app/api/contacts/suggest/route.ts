import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ contacts: [] });

  const like = `%${q}%`;

  // Fetch senders and recipients from the user's email history
  const [sendersResult, recipientsResult] = await Promise.all([
    supabase
      .from('emails')
      .select('from_address, from_name')
      .eq('user_id', user.id)
      .ilike('from_address', like)
      .limit(50),
    supabase
      .from('emails')
      .select('to_addresses')
      .eq('user_id', user.id)
      .limit(200),
  ]);

  // Count frequency per email
  const freq: Record<string, { name?: string; count: number }> = {};

  for (const row of sendersResult.data ?? []) {
    const email = (row.from_address as string | null)?.toLowerCase();
    if (!email) continue;
    if (!freq[email]) freq[email] = { count: 0 };
    freq[email].count++;
    if (!freq[email].name && row.from_name) freq[email].name = row.from_name as string;
  }

  for (const row of recipientsResult.data ?? []) {
    const addrs = row.to_addresses as string[] | null;
    if (!addrs) continue;
    for (const addr of addrs) {
      const email = addr.toLowerCase();
      if (!email.includes(q.toLowerCase())) continue;
      if (!freq[email]) freq[email] = { count: 0 };
      freq[email].count++;
    }
  }

  const contacts = Object.entries(freq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([email, { name }]) => ({ email, name }));

  return NextResponse.json({ contacts });
}
