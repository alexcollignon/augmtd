import { SupabaseClient } from '@supabase/supabase-js';
import { synthesizeVoiceProfile } from './voice-profile';

/**
 * Loads all populated context profiles for a user and formats them into
 * a single prompt-ready block. Called by planning, generation, and inbox chat routes.
 * Gracefully omits any section that has no meaningful data.
 */
export async function buildUserContextBlock(
  userId: string,
  supabase: SupabaseClient
): Promise<string> {
  const { data: profiles } = await supabase
    .from('context_profiles')
    .select('profile_type, profile_data')
    .eq('user_id', userId)
    .in('profile_type', ['identity', 'email_communication', 'meeting_behavior', 'work_patterns']);

  if (!profiles?.length) return '';

  const byType: Record<string, any> = {};
  for (const p of profiles) byType[p.profile_type] = p.profile_data;

  const sections: string[] = [];

  // ── IDENTITY ────────────────────────────────────────────────────────────────
  const id = byType.identity;
  if (id) {
    const lines: string[] = ['ABOUT YOU:'];
    if (id.fullName) lines.push(`Name: ${id.fullName}`);
    const role = id.role || id.jobRole;
    const roleLine = [role, id.department].filter(Boolean).join(' | ');
    if (roleLine) lines.push(`Role: ${roleLine}`);
    if (id.authority && id.authority !== 'unknown') {
      lines.push(`Authority: ${id.authority.charAt(0).toUpperCase() + id.authority.slice(1)}`);
    }
    if (id.responsibilities?.length) {
      lines.push(`Responsibilities: ${id.responsibilities.join(', ')}`);
    }
    sections.push(lines.join('\n'));
  }

  // ── EMAIL STYLE ──────────────────────────────────────────────────────────────
  const email = byType.email_communication;
  // Prefer the durable, example-grounded voice (synthesized from real sent emails / interview)
  // over the legacy keyword stats. Lazily build it the first time it's missing.
  if (email?.voice_description) {
    sections.push(`HOW YOU WRITE EMAIL (match this voice):\n${email.voice_description}`);
  } else {
    // Lazily build the durable voice from sent emails — at most once (guarded by attempt marker).
    if (email && !email.voice_synth_attempted_at) void synthesizeVoiceProfile(userId, supabase).catch(() => {});
    if (email) {
    const lines: string[] = ['EMAIL STYLE (learned from sent emails):'];
    const score = email.formalityScore ?? email.tone;
    if (score != null) {
      const label = score >= 0.7 ? 'formal' : score <= 0.4 ? 'casual' : 'balanced';
      lines.push(`Tone: ${label} (${Math.round(score * 100)}%)`);
    }
    if (email.avgLength) lines.push(`Avg length: ~${email.avgLength} words`);
    if (email.signature) {
      lines.push(`Signature: "${email.signature.replace(/\n/g, ', ')}"`);
    }
    // Extract base greeting words (e.g. "Hello Alex," → "Hello", "Dear Sam," → "Dear")
    const baseGreetings = [...new Set(
      (email.greetingPatterns || [])
        .map((g: string) => g.split(' ')[0].replace(/[,.]$/, ''))
        .filter(Boolean)
    )].slice(0, 3) as string[];
    if (baseGreetings.length) lines.push(`Greetings: ${baseGreetings.join(', ')}`);
    if (lines.length > 1) sections.push(lines.join('\n'));
    }
  }

  // ── SCHEDULING PREFERENCES ───────────────────────────────────────────────────
  const meeting = byType.meeting_behavior;
  if (meeting) {
    const lines: string[] = ['SCHEDULING PREFERENCES (learned from calendar):'];
    if (meeting.preferredTimes?.length) {
      lines.push(`Preferred times: ${meeting.preferredTimes.join(', ')}`);
    }
    if (meeting.noMeetingDays?.length) {
      lines.push(`Avoid: ${meeting.noMeetingDays.join(', ')}`);
    }
    if (meeting.avgMeetingLength) {
      lines.push(`Avg meeting length: ${meeting.avgMeetingLength} min`);
    }
    if (meeting.schedulingPatterns?.bufferTime) {
      lines.push(`Buffer between meetings: ${meeting.schedulingPatterns.bufferTime} min`);
    }
    if (meeting.acceptanceRate != null) {
      lines.push(`Acceptance rate: ${Math.round(meeting.acceptanceRate * 100)}%`);
    }
    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  // ── WORK PATTERNS ────────────────────────────────────────────────────────────
  const work = byType.work_patterns;
  if (work) {
    const lines: string[] = ['WORK PATTERNS:'];
    if (work.deliverableTypes && Object.keys(work.deliverableTypes).length) {
      const summary = Object.entries(work.deliverableTypes as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type} (${count}x)`)
        .join(', ');
      lines.push(`Common deliverables: ${summary}`);
    }
    if (work.commonSkills?.length) {
      lines.push(`Top tools: ${(work.commonSkills as string[]).slice(0, 5).join(', ')}`);
    }
    if (work.recentWorkflows?.length) {
      const recent = (work.recentWorkflows as Array<{ purpose?: string }>).slice(0, 3);
      const purposes = recent.map(w => w.purpose).filter(Boolean);
      if (purposes.length) {
        lines.push(`Recent focus: ${purposes.slice(0, 2).join('; ')}`);
      }
    }
    if (lines.length > 1) sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
