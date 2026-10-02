// ONE COMPONENT, ONE BEHAVIOUR (law `one-component-one-behaviour` — lib/present/behaviour.ts).
// Pure: the table is total over every producer vocabulary, every row names one class + renderer +
// door, a stage verb reaches the chat as its deed's inline card, and a coworker's typed card is read
// by ONE reader for the live frame and the reload.
import { describe, expect, it } from 'vitest';
import {
  BEHAVIOUR_KINDS, BEHAVIOUR_TABLE, ONE_VIEWER, PREPARED_KIND_BEHAVIOUR, CARD_KEY_BEHAVIOUR,
  CARD_ARTIFACT_BEHAVIOUR, ITEM_ARTIFACT_BEHAVIOUR, STAGE_VERB_BEHAVIOUR, artifactKindOfType, isDeed, isArtifact,
} from '@/lib/present/behaviour';
import { CARD_COMPONENT_KEY, chatCardsOfPayload, postsOfCardArtifacts } from '@/lib/present/turn-card';
import { WIDGET_OF_ARTIFACT } from '@/components/thread/item-page';
import type { PreparedKind } from '@/lib/prepare/read';

describe('the behaviour table', () => {
  it('has exactly one row per kind, each with a class, a renderer and a door', () => {
    for (const k of BEHAVIOUR_KINDS) {
      const row = BEHAVIOUR_TABLE[k];
      expect(row.kind).toBe(k);
      expect(['deed', 'artifact']).toContain(row.class);
      expect(row.renderer).toMatch(/^components\/.+\.tsx#\w+$/);
      expect(row.door.length).toBeGreaterThan(3);
    }
    expect(Object.keys(BEHAVIOUR_TABLE).sort()).toEqual([...BEHAVIOUR_KINDS].sort());
  });

  it('every artifact opens THE ONE VIEWER; no deed does', () => {
    for (const k of BEHAVIOUR_KINDS) {
      if (isArtifact(k)) expect(BEHAVIOUR_TABLE[k].renderer).toBe(ONE_VIEWER);
      if (isDeed(k)) expect(BEHAVIOUR_TABLE[k].renderer).not.toBe(ONE_VIEWER);
    }
  });

  it('is total over THE ONE READER\'s prepared kinds', () => {
    const kinds: PreparedKind[] = ['reply_draft', 'nudge_draft', 'deliverable', 'invite', 'forward', 'paste_pack'];
    for (const k of kinds) expect(BEHAVIOUR_KINDS).toContain(PREPARED_KIND_BEHAVIOUR[k]);
  });

  it('is total over the durable chat card keys', () => {
    for (const key of Object.values(CARD_COMPONENT_KEY)) expect(BEHAVIOUR_KINDS).toContain(CARD_KEY_BEHAVIOUR[key]);
  });

  it('is total over the item page\'s artifact kinds', () => {
    for (const k of Object.keys(WIDGET_OF_ARTIFACT)) expect(BEHAVIOUR_KINDS).toContain(ITEM_ARTIFACT_BEHAVIOUR[k]);
  });

  it('classes the deeds and artifacts the owner named', () => {
    for (const k of ['reply_draft', 'nudge_draft', 'compose_email', 'invite', 'forward', 'decision', 'ask', 'approval_gate', 'input_station', 'linkedin_post', 'paste_pack', 'collection', 'workflow_draft', 'event', 'bulk_deed', 'change'] as const) {
      expect(isDeed(k)).toBe(true);
    }
    for (const k of ['document', 'frame', 'spreadsheet', 'deck', 'meeting_notes', 'email_thread'] as const) {
      expect(isArtifact(k)).toBe(true);
    }
    expect(CARD_ARTIFACT_BEHAVIOUR.linkedin_post).toBe('linkedin_post');
    expect(STAGE_VERB_BEHAVIOUR).toEqual({ reply: 'reply_draft', forward: 'forward', invite: 'invite' });
    expect(artifactKindOfType('frame')).toBe('frame');
    expect(artifactKindOfType('xlsx')).toBe('spreadsheet');
    expect(artifactKindOfType('pptx')).toBe('deck');
    expect(artifactKindOfType('docx')).toBe('document');
  });
});

describe('the chat reaches each deed as its inline card', () => {
  it('a stage verb becomes the deed card on the turn (never a navigation)', () => {
    expect(chatCardsOfPayload({ openStage: { stage: 'forward', itemId: 'i1' } }).stageDeeds)
      .toEqual([{ stage: 'forward', itemKind: 'email', itemId: 'i1' }]);
    expect(chatCardsOfPayload({ openStage: { stage: 'nonsense', itemId: 'i1' } }).stageDeeds).toBeUndefined();
    expect(chatCardsOfPayload({ openStage: { stage: 'reply' } }).stageDeeds).toBeUndefined();
  });

  it('a LinkedIn post is read by one reader, live and reloaded', () => {
    const live = { type: 'linkedin_post', variants: [{ text: 'Post A', hashtags: ['ops'] }, { text: '  ' }] };
    expect(postsOfCardArtifacts(live, 'Luca')).toEqual([{ variants: [{ text: 'Post A', hashtags: ['ops'] }], by: 'Luca' }]);
    expect(postsOfCardArtifacts([live, { type: 'other' }])).toHaveLength(1);
    expect(postsOfCardArtifacts(undefined)).toEqual([]);
    expect(postsOfCardArtifacts({ type: 'linkedin_post', variants: [] })).toEqual([]);
  });
});
