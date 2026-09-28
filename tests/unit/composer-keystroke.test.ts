// THE ONE COMPOSER NEVER SETS STATE PER KEYSTROKE FROM AN EFFECT (Sep 28 — the fast-typing crash).
//
// components/workers/worker-mention-input.tsx is the composer of the project room, the item page and
// the Home floor. Its dropdown-anchor effect ran `setRect(null)` on every keystroke (and the mention
// effect `setMode('items')` on every keystroke of an @-query). A setState in a passive effect after a
// keystroke commit lands in React's Default lane; under a fast burst the browser runs input tasks ahead
// of React's scheduler task, so that update stays pending across every keystroke commit and React
// counts each commit as a nested update — ~50 keys in, `setValue` threw "Maximum update depth
// exceeded" and the character was lost ("reproduce" → "rproduce").
//
// The repo has no DOM test environment (vitest runs in `node`, no jsdom), so this is a STRUCTURAL
// gate over the effects: an effect that re-runs on every keystroke (`value` in its deps) must return
// early while the menu is closed and set state only on a real change; the menu page is derived, never
// kept in step by an effect; and an effect's reset never mints a fresh array.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.resolve(__dirname, '../../components/workers/worker-mention-input.tsx'), 'utf8');

/** Every `useEffect(() => { … }, [deps])` as { body, deps } — brace-matched, comments left in. */
function effects(src: string): Array<{ body: string; deps: string[] }> {
  const out: Array<{ body: string; deps: string[] }> = [];
  let at = 0;
  for (;;) {
    const i = src.indexOf('useEffect(', at);
    if (i < 0) break;
    const open = src.indexOf('{', i);
    let depth = 0; let j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(open + 1, j);
    const depsMatch = src.slice(j, j + 200).match(/^\}\s*,\s*\[([^\]]*)\]/);
    out.push({ body, deps: depsMatch ? depsMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : [] });
    at = j;
  }
  return out;
}

const SETTER = /\bset[A-Z]\w*\(/;

describe('the composer sets no state per keystroke from an effect', () => {
  const all = effects(SRC);

  it('finds the effects it gates', () => {
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  it('a per-keystroke effect (value in deps) returns before any setter while the menu is closed, and sets only on change', () => {
    const perKey = all.filter((e) => e.deps.includes('value'));
    expect(perKey.length).toBeGreaterThan(0);
    for (const e of perKey) {
      if (!SETTER.test(e.body)) continue;               // a DOM-only effect (auto-resize) is fine
      const firstSetter = e.body.search(SETTER);
      const guard = e.body.search(/if\s*\(\s*mq === null[^)]*\)\s*return;/);
      expect(guard, 'the effect must bail out while the menu is closed').toBeGreaterThanOrEqual(0);
      expect(guard).toBeLessThan(firstSetter);
      // No unconditional reset on the closed path (the literal regression).
      expect(e.body).not.toMatch(/setRect\(null\)/);
      // The set is behind an unchanged-bail.
      expect(e.body.slice(0, firstSetter)).toMatch(/if\s*\(\s*prev\b[\s\S]*\)\s*return;/);
    }
  });

  it('the menu page is derived, never state an effect keeps in step', () => {
    expect(SRC).not.toMatch(/\bsetMode\(/);
    expect(SRC).toMatch(/const mode:[^=]*=\s*mq === null/);
  });

  it('an effect resetting results reuses one stable empty list', () => {
    for (const e of all) expect(e.body).not.toMatch(/setResults\(\[\]\)/);
  });
});
