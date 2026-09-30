// ════════════════════════════════════════════════════════════════════════════════════════════════
// W28 · RECORDS FIRST, IN CODE. A turn that names something the user's own records already hold, and
// does not ask for public information, is answered from the records — the web tools are not offered on
// that turn (found by the W28 eval: "look into Globex" came back as four unrelated public companies with
// unsourced figures, while the user's inbox held the partnership proposal the name meant; a prompt rule
// alone did not hold). Config-driven: which tools are "web", what counts as a research ask, and where the
// records are read are declared here — never a coworker name.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import type { SupabaseClient } from '@supabase/supabase-js';

/** The tools that reach the public web (withheld on a records-first turn). */
export const WEB_TOOL_NAMES = ['web_search', 'fetch_url', 'deep_research'] as const;

/** An ask for public / current information (then the web stays on). Shared with the hand-off gate. */
export const RESEARCH_ASK = /\b(research|look (it |this |them )?up online|search (the )?(web|online|internet)|google|find out (more )?(online|publicly)|latest|recent|current(ly)?|news|market|online|web|public(ly)?|competitor|benchmark|who (is|are|leads)|what'?s happening|trends?|funding|website)\b/i;

const STOP = new Set(['I', 'Can', 'Could', 'Would', 'Please', 'Look', 'Tell', 'What', 'Who', 'How', 'Why', 'When', 'Where', 'The', 'A', 'An', 'Hi', 'Hey', 'Thanks', 'Max', 'Luca', 'Clara', 'Also', 'And', 'Or', 'Do', 'Does', 'Is', 'Are', 'Give', 'Find', 'Check', 'Draft', 'Write', 'Make']);

/** Capitalised names in the user's message (not sentence-openers or common verbs). Pure. */
export function namedEntities(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? '').matchAll(/\b([A-Z][A-Za-z0-9&.'-]{2,}(?:\s+[A-Z][A-Za-z0-9&.'-]{2,}){0,2})\b/g)) {
    const words = m[1].split(/\s+/).filter((w) => !STOP.has(w));
    if (words.length) out.add(words.join(' '));
  }
  return [...out].slice(0, 5);
}

/** The decision for one turn. Pure. */
export function recordsFirstDecision(a: { userText: string; resolved: string[] }): { offerWeb: boolean; entity: string | null } {
  if (RESEARCH_ASK.test(a.userText)) return { offerWeb: true, entity: null };
  return a.resolved.length ? { offerWeb: false, entity: a.resolved[0] } : { offerWeb: true, entity: null };
}

/** Which of the names the user's own records hold (inbox subjects/senders, KB filenames). Bounded reads,
 *  explicit columns, errors read as "not resolved" (the web then stays on — the safe default). */
export async function namesInRecords(client: SupabaseClient, userId: string, names: string[]): Promise<string[]> {
  const hit: string[] = [];
  for (const n of names.slice(0, 3)) {
    const pat = `*${n.replace(/[,()*]/g, ' ').trim()}*`;
    const { data, error } = await client.from('inbox_items').select('id')
      .eq('user_id', userId)
      .or(`source_data->>subject.ilike.${pat},source_data->>from_name.ilike.${pat},source_data->>from_address.ilike.${pat.toLowerCase().replace(/\s+/g, '')}`)
      .limit(1);
    if (!error && data?.length) { hit.push(n); continue; }
    const kf = await client.from('knowledge_files').select('id').eq('user_id', userId).ilike('filename', pat.replace(/\*/g, '%')).limit(1);
    if (!kf.error && kf.data?.length) hit.push(n);
  }
  return hit;
}
