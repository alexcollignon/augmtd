import { describe, it, expect } from 'vitest';
import { topMessageOf } from '@/lib/inbox/top-message';

describe('topMessageOf', () => {
  it('returns the full text when there is no quoted history', () => {
    const body = 'Hi Sam,\n\nJust checking in on the proposal. Any update?\n\nBest,\nAlex';
    expect(topMessageOf(body)).toBe(body.trim());
  });

  it('cuts at an EN "On ... wrote:" attribution line', () => {
    const body =
      'Sounds good, let\'s proceed with the plan as discussed and confirmed on the call.\n\n' +
      'On Mon, Sep 21, 2026 at 10:00 AM, Sam Reyes <sam@example.com> wrote:\n' +
      '> can we move forward with the plan?';
    const top = topMessageOf(body);
    expect(top).toContain('proceed with the plan');
    expect(top).not.toContain('can we move forward');
  });

  it('cuts at a PT "No dia ... escreveu:" attribution line', () => {
    const body =
      'Confirmado, vamos avançar com a proposta conforme combinado na reunião de ontem.\n\n' +
      'No dia 21 de set. de 2026 às 10:00, Sam Reyes <sam@example.com> escreveu:\n' +
      '> podemos avançar com a proposta?';
    const top = topMessageOf(body);
    expect(top).toContain('avançar com a proposta');
    expect(top).not.toContain('podemos avançar');
  });

  it('cuts at a DE "Am ... schrieb:" attribution line', () => {
    const body =
      'Einverstanden, wir setzen den Plan wie besprochen und in der letzten Sitzung bestätigt um.\n\n' +
      'Am Mo., 21. Sep. 2026 um 10:00 schrieb Sam Reyes <sam@example.com>:\n' +
      '> können wir mit dem Plan fortfahren?';
    const top = topMessageOf(body);
    expect(top).toContain('setzen den Plan');
    expect(top).not.toContain('können wir mit dem Plan fortfahren');
  });

  it('cuts at a FR "Le ... a écrit :" attribution line', () => {
    const body =
      'D\'accord, nous allons procéder avec le plan comme convenu lors de notre dernier appel.\n\n' +
      'Le lun. 21 sept. 2026 à 10:00, Sam Reyes <sam@example.com> a écrit :\n' +
      '> pouvons-nous avancer avec le plan ?';
    const top = topMessageOf(body);
    expect(top).toContain('procéder avec le plan');
    expect(top).not.toContain('pouvons-nous avancer');
  });

  it('cuts at an Outlook classic "-----Original Message-----" divider', () => {
    const body =
      'Thanks, this all looks correct and ready to send out to the wider distribution list today.\n\n' +
      '-----Original Message-----\n' +
      'From: Sam Reyes\nSent: Monday, September 21, 2026 10:00 AM\nTo: Alex\n\n' +
      'Please double check the numbers before sending.';
    const top = topMessageOf(body);
    expect(top).toContain('ready to send out');
    expect(top).not.toContain('double check the numbers');
  });

  it('cuts at an Outlook underscore divider', () => {
    const body =
      'Approved — go ahead and finalize the contract with legal this week as we discussed.\n\n' +
      '________________________________\n' +
      'From: Sam Reyes\nTo: Alex\nSubject: RE: Contract';
    const top = topMessageOf(body);
    expect(top).toContain('finalize the contract');
    expect(top).not.toContain('Subject: RE');
  });

  it('cuts at an inline Outlook header block (From/Sent/To, EN)', () => {
    const body =
      'Great, thanks for confirming — we will proceed as planned starting next Monday morning.\n' +
      'From: Sam Reyes\nSent: Monday, September 21, 2026 10:00 AM\nTo: Alex Collignon\n\n' +
      'Can you confirm receipt of the attached invoice?';
    const top = topMessageOf(body);
    expect(top).toContain('proceed as planned');
    expect(top).not.toContain('attached invoice');
  });

  it('cuts at an Apple Mail / new Outlook header block (From/Date/To)', () => {
    const body =
      'Understood, I will forward this to the finance team for their review by end of week.\n' +
      'From: Sam Reyes\nDate: Monday, September 21, 2026 at 10:00 AM\nTo: Alex Collignon\n\n' +
      'Here is the quarterly report you asked for.';
    const top = topMessageOf(body);
    expect(top).toContain('forward this to the finance team');
    expect(top).not.toContain('quarterly report');
  });

  it('cuts at a PT/ES inline header block (De/Enviado)', () => {
    const body =
      'Perfeito, vamos seguir com essa abordagem conforme alinhado na última reunião de equipa.\n' +
      'De: Sam Reyes\nEnviado: segunda-feira, 21 de setembro de 2026 10:00\n\n' +
      'Podemos confirmar a reunião de amanhã?';
    const top = topMessageOf(body);
    expect(top).toContain('seguir com essa abordagem');
    expect(top).not.toContain('confirmar a reunião');
  });

  it('cuts at a DE inline header block (Von/Gesendet)', () => {
    const body =
      'Perfekt, wir gehen genau so vor, wie wir es letzte Woche in der Besprechung festgelegt haben.\n' +
      'Von: Sam Reyes\nGesendet: Montag, 21. September 2026 10:00\n\n' +
      'Können wir das Meeting morgen bestätigen?';
    const top = topMessageOf(body);
    expect(top).toContain('gehen genau so vor');
    expect(top).not.toContain('Meeting morgen bestätigen');
  });

  it('cuts at a run of ≥2 ">"-quoted lines even with no attribution line', () => {
    const body =
      'Yes, that works for me, let\'s lock in that time and I will send the calendar invite shortly.\n\n' +
      '> Can we meet at 3pm?\n' +
      '> I am free all afternoon.\n';
    const top = topMessageOf(body);
    expect(top).toContain('lock in that time');
    expect(top).not.toContain('Can we meet at 3pm');
  });

  it('a single ">" line alone (not a run of ≥2) does not trigger the quote cut', () => {
    const body = 'Quick note: > this is not actually a quoted reply chain, just a stray character.';
    expect(topMessageOf(body)).toBe(body.trim());
  });

  it('the conservative floor: a near-empty top (pure forward) keeps the full text', () => {
    const body =
      'FYI\n\n' +
      'On Mon, Sep 21, 2026 at 10:00 AM, Sam Reyes <sam@example.com> wrote:\n' +
      '> the whole forwarded thread lives below this line, all of it truly relevant.';
    const top = topMessageOf(body);
    // "FYI" alone is under the 40-char floor, so the full text is kept rather than truncated to nothing.
    expect(top).toBe(body);
  });

  it('handles an empty/undefined body without throwing', () => {
    expect(topMessageOf('')).toBe('');
    // @ts-expect-error — exercising the runtime String(body ?? '') guard
    expect(topMessageOf(undefined)).toBe('');
  });
});
