import { getSystemClient, aiCreate } from '@/lib/ai/factory'
import { SupabaseClient } from '@supabase/supabase-js'

type RenderableProfileType = 'identity' | 'email_communication' | 'domain_knowledge' | 'meeting_behavior' | 'work_patterns'

function buildPrompt(profileType: RenderableProfileType, profileData: any): string {
  const data = JSON.stringify(profileData, null, 2)

  switch (profileType) {
    case 'identity':
      return `Convert this identity profile into 1-2 factual sentences describing who this person is professionally. Be specific. Start directly with their name or role — no preamble.

${data}`

    case 'email_communication':
      return `Convert this email communication profile into 2-3 sentences describing how this person writes emails. Be specific about tone, length, and style. Start directly — no preamble.

${data}`

    case 'domain_knowledge':
      return `Convert this domain knowledge profile into 1-2 sentences describing the person's professional expertise and terminology. Be specific. Start directly — no preamble.

${data}`

    case 'meeting_behavior':
      return `Convert this meeting behavior profile into 2 sentences describing how this person handles meetings and scheduling. Be specific. Start directly — no preamble.

${data}`

    default:
      return `Summarize this profile in 1-2 sentences. Start directly — no preamble.\n\n${data}`
  }
}

export async function renderProfile(
  profileType: RenderableProfileType,
  profileData: any,
  confidenceScore: number,
): Promise<string | null> {
  if (confidenceScore < 10) return null
  if (!profileData || Object.keys(profileData).length === 0) return null

  // Skip work_patterns until it has real data
  if (profileType === 'work_patterns') {
    const hasData = profileData.deliverableTypes || profileData.commonSkills?.length > 0
    if (!hasData) return null
  }

  const { client, model } = getSystemClient('summarization')

  const completion = await aiCreate(client, {
    model,
    max_tokens: 200,
    messages: [
      {
        role: 'system',
        content: 'You convert structured profile data into clear, factual 1-3 sentence descriptions. No preamble, no filler phrases like "Based on the data" or "This person". Write directly.',
      },
      { role: 'user', content: buildPrompt(profileType, profileData) },
    ],
  })

  return completion.choices[0]?.message?.content?.trim() ?? null
}

export async function renderAllProfiles(userId: string, supabase: SupabaseClient): Promise<void> {
  const { data: allProfiles, error } = await supabase
    .from('context_profiles')
    .select('profile_type, profile_data, confidence_score, rendered_at, last_updated')
    .eq('user_id', userId)

  if (error) {
    console.error('[RenderMemory] Failed to fetch profiles:', error)
    return
  }

  const stale = (allProfiles ?? []).filter(p =>
    !p.rendered_at || new Date(p.last_updated) > new Date(p.rendered_at)
  )

  if (stale.length === 0) return

  await Promise.allSettled(
    stale.map(async (profile) => {
      try {
        const text = await renderProfile(
          profile.profile_type as RenderableProfileType,
          profile.profile_data,
          profile.confidence_score,
        )

        await supabase
          .from('context_profiles')
          .update({ rendered_text: text, rendered_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('profile_type', profile.profile_type)
      } catch (err) {
        console.error(`[RenderMemory] Failed to render ${profile.profile_type} for ${userId.slice(0, 8)}:`, err)
      }
    }),
  )
}
