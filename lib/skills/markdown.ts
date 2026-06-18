// ─── Skill ↔ Markdown interchange ─────────────────────────────────────────────
// Skills live in Postgres (the `skills` table is the system of record), but the
// content is plain markdown, so `.md` is the portable import/export format —
// matching Claude's SKILL.md convention (YAML frontmatter + markdown body).
//
//   ---
//   name: LinkedIn voice
//   description: When drafting LinkedIn posts
//   ---
//   - Open with a hook, never a greeting
//   - Conversational, no corporate jargon
//
// Mapping: frontmatter `name` → name, `description`/`when_to_use` → when_to_use,
// the body → content. Files without frontmatter degrade gracefully (a leading
// `# Heading` or the filename becomes the name; the whole text is the content).

export interface ParsedSkill {
  name: string;
  when_to_use: string;
  content: string;
}

function stripQuotes(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Parse a markdown string (optionally with YAML frontmatter) into a skill draft.
 * `fallbackName` (e.g. the filename without extension) is used when no name can
 * be derived from the content.
 */
export function parseSkillMarkdown(raw: string, fallbackName = ''): ParsedSkill {
  let text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  let name = '';
  let whenToUse = '';

  // Frontmatter block: leading `---` … `---`
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    const block = fm[1];
    for (const line of block.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = stripQuotes(m[2]);
      if (key === 'name' || key === 'title') name ||= val;
      else if (key === 'description' || key === 'when_to_use' || key === 'when-to-use' || key === 'use_when') whenToUse ||= val;
    }
    text = text.slice(fm[0].length);
  }

  text = text.trim();

  // No name from frontmatter → first markdown H1, else fallback.
  if (!name) {
    const h1 = text.match(/^#\s+(.+)$/m);
    if (h1) {
      name = h1[1].trim();
      // Drop that heading line from the body so it isn't duplicated.
      text = text.replace(/^#\s+.+$/m, '').trim();
    } else {
      name = fallbackName.trim();
    }
  }

  return { name, when_to_use: whenToUse, content: text };
}

/** Serialize a skill into a Claude-style SKILL.md string. */
export function skillToMarkdown(skill: { name: string; when_to_use?: string | null; content: string }): string {
  const lines = ['---', `name: ${skill.name}`];
  if (skill.when_to_use?.trim()) lines.push(`description: ${skill.when_to_use.trim()}`);
  lines.push('---', '', skill.content.trim(), '');
  return lines.join('\n');
}

/** Filesystem-safe filename for a skill export, e.g. "LinkedIn voice" → "linkedin-voice.md". */
export function skillFilename(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'skill'}.md`;
}
