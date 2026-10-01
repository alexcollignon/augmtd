import { describe, it, expect } from 'vitest';
import { snapToVocabulary, snapSegments, phoneticKey } from '@/lib/integrations/meeting-bot/vocabulary-snap';

const DECOYS = ['Umbrella Partners', 'Northwind', 'Q3 Launch', 'Jordan Vale'];
const snap = (t: string, v: string[]) => snapToVocabulary(t, v).text;

describe('vocabulary snap', () => {
  it('snaps near-miss spellings of a vocabulary term (EN/PT/DE/FR)', () => {
    expect(snap('This is Sam from Akme.', ['Acme', 'Sam'])).toBe('This is Sam from Acme.');
    expect(snap('Trabalho na Akme há três anos.', ['Acme'])).toBe('Trabalho na Acme há três anos.');
    expect(snap('Bitte schicken Sie den Vertrag an Globax.', ['Globex'])).toBe('Bitte schicken Sie den Vertrag an Globex.');
    expect(snap("Merci d'envoyer le contrat à Initek avant vendredi.", ['Initech'])).toBe("Merci d'envoyer le contrat à Initech avant vendredi.");
    expect(snap("Ici Sam, de chez d'Akme.", ['Acme'])).toBe("Ici Sam, de chez d'Acme.");
  });
  it('fixes casing and word splits only on a proper-noun signal', () => {
    expect(snap('Por favor enviem a proposta ao SAM.', ['Sam'])).toBe('Por favor enviem a proposta ao Sam.');
    expect(snap('We met the North Wind team.', ['Northwind'])).toBe('We met the Northwind team.');
    expect(snap('Call Jordan Vail today.', ['Jordan Vale'])).toBe('Call Jordan Vale today.');
    expect(snap('the north wind was cold', ['Northwind'])).toBe('the north wind was cold');
  });
  it('never introduces a decoy the transcript does not nearly say', () => {
    const t = 'Bom dia a todos. Fala Ana, Datme. O orçamento aprovado é de 12.600€. Por favor enviem a proposta ao Sam até sexta-feira.';
    const r = snapToVocabulary(t, ['Acme', 'Ana', 'Sam', ...DECOYS]);
    for (const d of DECOYS) expect(r.text).not.toContain(d);
    expect(r.text).toBe(t); // "Datme" is two edits + a different skeleton from "Acme" — left alone
    expect(r.snaps).toEqual([]);
  });
  it('leaves common words alone, even capitalised at a sentence start', () => {
    expect(snap('Same time tomorrow? Some came late.', ['Sam', 'Somme', 'Came'])).toBe('Same time tomorrow? Some came late.');
    expect(snap('Will you send it? Mark the date.', ['Will', 'Mark'])).toBe('Will you send it? Mark the date.');
    expect(snap('Name the file. Acne is common.', ['Acme', 'Nam'])).toBe('Name the file. Acne is common.');
    expect(snap('das ist gut', ['Dass'])).toBe('das ist gut');
  });
  it('is strict on short terms, digits and ambiguity', () => {
    expect(snap('Ask Lea about it.', ['Lee'])).toBe('Ask Lea about it.'); // 3 letters: exact fold only
    expect(snap('The Q4 Launch slipped.', ['Q3 Launch'])).toBe('The Q4 Launch slipped.');
    expect(snap('Talk to Karla.', ['Carla', 'Karlo'])).toBe('Talk to Karla.'); // two near terms → ambiguous
    expect(snap('Talk to Northwind and Acme.', ['Acme', 'Akme'])).toBe('Talk to Northwind and Acme.'); // verbatim term kept
  });
  it('is the identity on correctly transcribed multilingual text, whatever the vocabulary', () => {
    const vocab = ['Acme', 'Sam', 'Lee', 'Ana', 'Globex', 'Initech', 'Mara Quint', 'Larkwell', ...DECOYS];
    for (const t of [
      'Good morning everyone. This is Sam from Acme. Please send the signed contract to Lee before Friday, and call the Globex office.',
      'Bom dia a todos. Fala a Ana, da Acme. A reunião de orçamento é no dia 9 de fevereiro. Por favor enviem a proposta ao Sam até sexta-feira.',
      'Guten Tag zusammen. Hier spricht Lee von Acme. Bitte schicken Sie den Vertrag bis Freitag an Globex. Das Wetter ist gut.',
      "Bonjour à tous. Ici Sam, de chez Acme. Merci d'envoyer le contrat signé à Initech avant vendredi. Nous avons parlé hier.",
      'Hola a todos. El presupuesto es de 7500 euros. Mañana hablamos con el equipo de ventas.',
    ]) expect(snapToVocabulary(t, vocab)).toEqual({ text: t, snaps: [] });
  });
  it('never swallows a neighbouring word into a fuzzy match', () => {
    expect(snap('le contrat à Initek', ['Initech'])).toBe('le contrat à Initech');
    expect(snap('call Glo Bex now', ['Globex'])).toBe('call Globex now');
    expect(snap('call Ak me now', ['Acme'])).toBe('call Ak me now'); // "me" is a common word
  });
  it('reports every snap and keeps segments immutable', () => {
    const segs = [{ text: 'From Akme.', timestamp: 0 }, { text: 'Hello.', timestamp: 3 }];
    const r = snapSegments(segs, ['Acme']);
    expect(r.snaps).toEqual([{ from: 'Akme', to: 'Acme' }]);
    expect(r.segments[0].text).toBe('From Acme.');
    expect(r.segments[1]).toBe(segs[1]);
    expect(segs[0].text).toBe('From Akme.');
  });
  it('phonetic key merges cross-language spellings', () => {
    expect(phoneticKey('Acme')).toBe(phoneticKey('Akme'));
    expect(phoneticKey('Philips')).toBe(phoneticKey('Filips'));
    expect(phoneticKey('Acme')).not.toBe(phoneticKey('Datme'));
  });
});
