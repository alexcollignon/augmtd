import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAIClient } from '@/lib/ai/factory';
import { parseModelJSON } from '@/lib/ai/parse-json';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { categoryName, categoryDescription } = await request.json();
  if (!categoryName || !categoryDescription) {
    return NextResponse.json({ error: 'categoryName and categoryDescription required' }, { status: 400 });
  }

  // Fetch recent inbox items that don't have a custom category yet
  const { data: items } = await supabase
    .from('inbox_items')
    .select('id, source_data')
    .eq('user_id', user.id)
    .is('custom_category', null)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!items || items.length === 0) return NextResponse.json({ updated: 0 });

  // Build a compact list for the AI — subject + sender only, no body
  const lines = items.map(item => {
    const sd = item.source_data as any;
    const from = sd?.from_name || sd?.from_address || 'Unknown';
    const subject = sd?.subject || '(no subject)';
    const snippet = (sd?.snippet || sd?.body || '').slice(0, 100);
    return `- ${item.id} | From: ${from} | Subject: ${subject}${snippet ? ` | "${snippet}"` : ''}`;
  }).join('\n');

  const prompt = `You are categorizing emails into a user-defined category.

Category: "${categoryName}"
Description: ${categoryDescription}

Review these emails and return the IDs of ones that CLEARLY match this category. Be conservative — only include strong matches, not borderline cases.

Emails:
${lines}

Respond with ONLY a JSON array of matching IDs (strings). Example: ["id1", "id2"]. Empty array if none match.`;

  try {
    const { client, model } = await getAIClient(user.id, 'planning', supabase);
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const matchingIds: string[] = parseModelJSON(response.choices[0].message.content, []);
    const validIds = matchingIds.filter(id => items.some(item => item.id === id));

    if (validIds.length > 0) {
      await supabase
        .from('inbox_items')
        .update({ custom_category: categoryName })
        .in('id', validIds);
    }

    return NextResponse.json({ updated: validIds.length });
  } catch (err) {
    console.error('[CategoryBackfill] Error:', err);
    return NextResponse.json({ error: 'Backfill failed', updated: 0 }, { status: 500 });
  }
}
