// W28 · THE SIGN-OFF IS THE USER'S, IN CODE. A drafted message the user sends is signed with the user's own
// name (their profile). Found by the W28 eval: drafts signed "Clara" (the drafting coworker), "Me", or a
// literal "[Your Name]". Only a closing line that is one of those WRONG identities is rewritten — a real
// signature the user wrote (or a name we do not know to be wrong) is never touched. Pure.
export function enforceUserSignOff(body: string, userName: string | null | undefined, wrongNames: string[] = []): string {
  const name = String(userName ?? '').trim();
  if (!name || /^me$/i.test(name)) return body;
  const first = name.split(/\s+/)[0];
  const wrong = new Set(['me', '[your name]', 'your name', '[name]', ...wrongNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
    ...wrongNames.map((n) => n.trim().split(/\s+/)[0].toLowerCase()).filter(Boolean)]);
  const lines = String(body ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    const bare = l.replace(/[*_]/g, '');
    // W42: a name PLACEHOLDER in any language ("[Ihr Name]", "[Votre nom]", "[o meu nome]", "[Su nombre]") is wrong too.
    const placeholder = /^\[[^\]]{0,24}\b(name|nom|nome|nombre|vorname)\b[^\]]{0,12}\]$/i.test(bare);
    if (wrong.has(bare.toLowerCase()) || placeholder) lines[i] = lines[i].replace(l, first);
    break;
  }
  return lines.join('\n');
}
