import { describe, it, expect } from 'vitest';
import { normalizeTriggers } from '@/lib/workflows/trigger-sources';

describe('normalizeTriggers — THE ONE READER', () => {
  it('null/undefined input → manual primary, no doors', () => {
    expect(normalizeTriggers(null)).toEqual({ primary: { type: 'manual' }, doors: [] });
    expect(normalizeTriggers(undefined)).toEqual({ primary: { type: 'manual' }, doors: [] });
  });

  it('a schedule trigger preserves cron/timezone/label verbatim', () => {
    const wf = { trigger: { type: 'schedule', cron: '0 8 * * 1', timezone: 'Europe/Lisbon', label: 'Mon 8am' } };
    expect(normalizeTriggers(wf)).toEqual({
      primary: { type: 'schedule', cron: '0 8 * * 1', timezone: 'Europe/Lisbon', label: 'Mon 8am' },
      doors: [],
    });
  });

  it('LEGACY FOLD: a pre-W1 reaction trigger becomes manual primary + ONE mail door', () => {
    const wf = { trigger: { type: 'reaction', when: 'a proposal arrives', label: 'proposal' } };
    expect(normalizeTriggers(wf)).toEqual({
      primary: { type: 'manual' },
      doors: [{ type: 'reaction', source: 'mail', when: 'a proposal arrives', label: 'proposal' }],
    });
  });

  it('a schedule-shaped entry inside triggers[] is NOT promoted (law 6: one schedule, on `trigger`)', () => {
    const wf = { trigger: { type: 'manual' }, triggers: [{ source: 'mail', when: 'x' }, { source: 'schedule' }] };
    const out = normalizeTriggers(wf);
    expect(out.primary).toEqual({ type: 'manual' });
    expect(out.doors).toEqual([{ type: 'reaction', source: 'mail', when: 'x' }]);
  });

  it('unknown source keys are DROPPED, not invented', () => {
    const wf = { triggers: [{ source: 'bogus' }] };
    expect(normalizeTriggers(wf).doors).toEqual([]);
  });

  it('identical doors (same source/when/workflow_id/filters) dedupe to one', () => {
    const wf = { triggers: [{ source: 'mail', when: 'x' }, { source: 'mail', when: 'x' }] };
    expect(normalizeTriggers(wf).doors).toHaveLength(1);
  });

  it('filters are PART OF a door\'s identity — a filtered and unfiltered mail door with the same ' +
     '`when` are two different doors, not one', () => {
    const wf = {
      triggers: [
        { source: 'mail', when: 'x', filters: [{ field: 'from_address', op: 'domain_is', value: 'acme.test' }] },
        { source: 'mail', when: 'x' },
      ],
    };
    expect(normalizeTriggers(wf).doors).toHaveLength(2);
  });

  it('an invalid filter (unknown op for the field) is dropped, never invented — the door itself survives', () => {
    const wf = { triggers: [{ source: 'mail', when: 'x', filters: [{ field: 'from_address', op: 'contains', value: 'acme.test' }] }] };
    const out = normalizeTriggers(wf);
    expect(out.doors).toEqual([{ type: 'reaction', source: 'mail', when: 'x' }]);
  });

  it('a legacy reaction fold + an authored identical copy in triggers[] dedupe to one', () => {
    const wf = { trigger: { type: 'reaction', when: 'x' }, triggers: [{ source: 'mail', when: 'x' }] };
    expect(normalizeTriggers(wf).doors).toHaveLength(1);
  });

  it('the `workflow` source binds by workflow_id, needs no `when`', () => {
    const wf = { triggers: [{ source: 'workflow', workflow_id: 'wf-123' }] };
    expect(normalizeTriggers(wf).doors).toEqual([{ type: 'reaction', source: 'workflow', workflow_id: 'wf-123' }]);
  });

  it('a bare `type: "reaction"` trigger with no when/label still folds to a plain mail door', () => {
    expect(normalizeTriggers({ trigger: { type: 'reaction' } })).toEqual({
      primary: { type: 'manual' },
      doors: [{ type: 'reaction', source: 'mail' }],
    });
  });

  it('a manual trigger with a label preserves it (label is dropped for the reaction-type branch only)', () => {
    const out = normalizeTriggers({ trigger: { type: 'manual', label: 'Kick off' } });
    expect(out.primary).toEqual({ type: 'manual', label: 'Kick off' });
  });

  it('garbage `triggers` (not an array) is tolerated — treated as empty', () => {
    expect(normalizeTriggers({ triggers: 'not-an-array' }).doors).toEqual([]);
    expect(normalizeTriggers({ triggers: { source: 'mail' } }).doors).toEqual([]);
  });
});
