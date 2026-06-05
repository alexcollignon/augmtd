import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAIClient, aiCreate } from '@/lib/ai/factory';
import { renderAllProfiles } from '@/lib/context/render-memory';

const PROFILE_ORDER = ['identity', 'email_communication', 'domain_knowledge', 'relationships', 'meeting_behavior'];

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let { data: profiles } = await supabase
    .from('context_profiles')
    .select('profile_type, rendered_text, confidence_score, learned_from_count, rendered_at, last_updated, profile_data')
    .eq('user_id', user.id);

  // Render on-demand if any eligible profiles have no rendered text yet
  const needsRender = (profiles ?? []).some(
    p => p.confidence_score >= 10 && !p.rendered_text
  );
  if (needsRender) {
    await renderAllProfiles(user.id, supabase);
    const { data: fresh } = await supabase
      .from('context_profiles')
      .select('profile_type, rendered_text, confidence_score, learned_from_count, rendered_at, last_updated, profile_data')
      .eq('user_id', user.id);
    profiles = fresh;
  }

  const [{ count: contactsCount }, { data: topContacts }] = await Promise.all([
    supabase.from('relationship_graph').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('relationship_graph').select('contact_name, contact_email, relationship_type').eq('user_id', user.id).order('importance', { ascending: false }).limit(3),
  ]);

  const profileMap: Record<string, any> = {};
  for (const p of profiles ?? []) {
    profileMap[p.profile_type] = p;
  }

  // Build a readable summary for relationships from the graph data
  const relationshipsText = (() => {
    const count = contactsCount ?? 0;
    if (count === 0) return null;
    const names = (topContacts ?? []).map(c => c.contact_name || c.contact_email).filter(Boolean);
    const preview = names.length > 0 ? ` including ${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` and ${count - 2} others` : ''}` : '';
    return `${count} contact${count !== 1 ? 's' : ''} tracked${preview}.`;
  })();

  const sections = PROFILE_ORDER.map(type => {
    if (type === 'relationships') {
      return {
        profile_type: type,
        rendered_text: relationshipsText,
        confidence_score: Math.min((contactsCount ?? 0) * 10, 100),
        learned_from_count: contactsCount ?? 0,
        rendered_at: null,
      };
    }
    return {
      profile_type: type,
      rendered_text: profileMap[type]?.rendered_text ?? null,
      confidence_score: profileMap[type]?.confidence_score ?? 0,
      learned_from_count: profileMap[type]?.learned_from_count ?? 0,
      rendered_at: profileMap[type]?.rendered_at ?? null,
    };
  });

  return NextResponse.json({ sections });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { pastedText } = await request.json();
  if (!pastedText || typeof pastedText !== 'string') {
    return NextResponse.json({ error: 'pastedText required' }, { status: 400 });
  }

  // Try JSON parse first (strip markdown fences if present)
  let parsed: any = null;
  try {
    const cleaned = pastedText.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Fall back to AI extraction
    const { client, model } = await getAIClient(user.id, 'classification', supabase);
    const completion = await aiCreate(client, {
      model,
      max_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Extract structured information from the text. Return a JSON object with any of these fields you can find: name, role, expertise (array of strings), communication_style ("formal"|"casual"|"mixed"), typical_email_length ("short"|"medium"|"long"), greeting_patterns (array of strings), common_phrases (array of strings), key_contacts (array of {name, email, relationship}), domain_vocabulary (object of term→definition), meeting_preferences (string). Only include fields clearly present in the text.',
        },
        { role: 'user', content: pastedText },
      ],
    });
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
    } catch {
      return NextResponse.json({ error: 'Could not parse the pasted content' }, { status: 422 });
    }
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const imported: string[] = [];

  // Identity
  if (parsed.name || parsed.role || parsed.expertise) {
    const { data: existing } = await adminSupabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'identity')
      .maybeSingle();

    const base = existing?.profile_data ?? {};
    const updated = {
      ...base,
      ...(parsed.name ? { fullName: parsed.name } : {}),
      ...(parsed.role ? { role: parsed.role } : {}),
      ...(parsed.expertise ? { responsibilities: parsed.expertise } : {}),
      email: user.email ?? base.email ?? '',
      authority: base.authority ?? 'unknown',
    };
    await adminSupabase.from('context_profiles').upsert(
      { user_id: user.id, profile_type: 'identity', profile_data: updated, confidence_score: 15.0 },
      { onConflict: 'user_id,profile_type' },
    );
    imported.push('identity');
  }

  // Email communication
  if (parsed.communication_style || parsed.greeting_patterns || parsed.common_phrases || parsed.typical_email_length) {
    const { data: existing } = await adminSupabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'email_communication')
      .maybeSingle();

    const base = existing?.profile_data ?? {
      signature: null, greetingPatterns: [], tone: 0.5, formalityScore: 0.5,
      avgLength: 300, emojiUsage: 0, commonPhrases: [],
      responsePatterns: { avgResponseTime: 0, priorityAdjustments: {} },
    };
    const toneMap: Record<string, number> = { formal: 0.8, mixed: 0.5, casual: 0.2 };
    const updated = {
      ...base,
      ...(parsed.greeting_patterns ? { greetingPatterns: parsed.greeting_patterns } : {}),
      ...(parsed.common_phrases ? { commonPhrases: parsed.common_phrases } : {}),
      ...(parsed.communication_style ? {
        tone: toneMap[parsed.communication_style] ?? 0.5,
        formalityScore: toneMap[parsed.communication_style] ?? 0.5,
      } : {}),
    };
    await adminSupabase.from('context_profiles').upsert(
      { user_id: user.id, profile_type: 'email_communication', profile_data: updated, confidence_score: 15.0 },
      { onConflict: 'user_id,profile_type' },
    );
    imported.push('email_communication');
  }

  // Domain knowledge
  if (parsed.domain_vocabulary || parsed.expertise) {
    const { data: existing } = await adminSupabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'domain_knowledge')
      .maybeSingle();

    const base = existing?.profile_data ?? { vocabulary: {}, workflows: [], expertise: [] };
    const updated = {
      ...base,
      ...(parsed.domain_vocabulary ? { vocabulary: { ...base.vocabulary, ...parsed.domain_vocabulary } } : {}),
      ...(parsed.expertise ? { expertise: parsed.expertise } : {}),
    };
    await adminSupabase.from('context_profiles').upsert(
      { user_id: user.id, profile_type: 'domain_knowledge', profile_data: updated, confidence_score: 15.0 },
      { onConflict: 'user_id,profile_type' },
    );
    imported.push('domain_knowledge');
  }

  // Key contacts (relationship_graph)
  if (Array.isArray(parsed.key_contacts) && parsed.key_contacts.length > 0) {
    for (const contact of parsed.key_contacts) {
      if (!contact.email) continue;
      await adminSupabase.from('relationship_graph').upsert({
        user_id: user.id,
        contact_email: contact.email,
        contact_name: contact.name ?? null,
        relationship_type: contact.relationship ?? 'other',
        importance: 0.3,
        interaction_frequency: 1,
        last_interaction: new Date().toISOString(),
        typical_topics: [],
      }, { onConflict: 'user_id,contact_email' });
    }
    imported.push('relationships');
  }

  // Meeting behavior
  if (parsed.meeting_preferences) {
    const { data: existing } = await adminSupabase
      .from('context_profiles')
      .select('profile_data')
      .eq('user_id', user.id)
      .eq('profile_type', 'meeting_behavior')
      .maybeSingle();

    const base = existing?.profile_data ?? {
      preferredTimes: [], noMeetingDays: [], avgMeetingLength: 0,
      schedulingPatterns: { bufferTime: 0, backToBackTolerance: 0, advanceBookingDays: 0 },
      participationStyle: 'balanced', organizerRate: 0, acceptanceRate: 0, meetingTypes: {},
    };
    await adminSupabase.from('context_profiles').upsert(
      {
        user_id: user.id,
        profile_type: 'meeting_behavior',
        profile_data: { ...base, meetingPreferencesNote: parsed.meeting_preferences },
        confidence_score: 15.0,
      },
      { onConflict: 'user_id,profile_type' },
    );
    imported.push('meeting_behavior');
  }

  // Re-render asynchronously so the UI can refresh
  renderAllProfiles(user.id, adminSupabase).catch(err => {
    console.error('[MemoryImport] Re-render failed:', err);
  });

  return NextResponse.json({ imported });
}
