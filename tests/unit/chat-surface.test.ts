// W23.A — THE CHAT SURFACE: follow-the-stream, Stop, "Worked for Xs ›", copyable blocks, chat titles.
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  distanceFromBottom, isNearBottom, nextFollowing, showJumpButton, recordStep, activityOf, durationOf,
  formatDuration, workedForLine, stepOffsets, FOLLOW_THRESHOLD_PX,
} from '@/components/home/chat-surface';
import { settleFlight } from '@/components/home/chat-flight';
import { WorkedFor } from '@/components/home/worked-for';
import { Markdown } from '@/components/thread/markdown-view';
import { codeBlockKind, splitPlaceholders, markdownToPlain } from '@/components/thread/markdown';
import { conversationName } from '@/components/one/conversation-title';

const m = (scrollTop: number, clientHeight = 400, scrollHeight = 1000) => ({ scrollTop, clientHeight, scrollHeight });
const html = (text: string) => renderToStaticMarkup(React.createElement(Markdown, { text }));

describe('follow the stream', () => {
  it('measures the distance to the bottom and the ~80px threshold', () => {
    expect(distanceFromBottom(m(600))).toBe(0);
    expect(distanceFromBottom(m(520))).toBe(80);
    expect(isNearBottom(m(520))).toBe(true);
    expect(isNearBottom(m(519))).toBe(false);
    expect(FOLLOW_THRESHOLD_PX).toBe(80);
  });

  it('follows at the bottom, lets go on any upward scroll, re-follows near the bottom going down', () => {
    expect(nextFollowing(false, { metrics: m(600), prevTop: 590 })).toBe(true);
    expect(nextFollowing(true, { metrics: m(580), prevTop: 600 })).toBe(false);
    expect(nextFollowing(false, { metrics: m(540), prevTop: 300 })).toBe(true);
    expect(nextFollowing(false, { metrics: m(300), prevTop: 200 })).toBe(false);
  });

  it('a jump glide keeps following; a shrink-clamp at the bottom keeps following', () => {
    expect(nextFollowing(true, { metrics: m(200), prevTop: 100, settling: true })).toBe(true);
    expect(nextFollowing(true, { metrics: m(400, 400, 800), prevTop: 600 })).toBe(true);
  });

  it('the jump button stands only when let go and far from the bottom', () => {
    expect(showJumpButton(false, m(100))).toBe(true);
    expect(showJumpButton(true, m(100))).toBe(false);
    expect(showJumpButton(false, m(560))).toBe(false);
  });
});

describe('stop', () => {
  it('keeps the partial as the answer, marked stopped, with no failure', () => {
    expect(settleFlight('stopped', 'Half an answer [R')).toEqual({ text: 'Half an answer', stopped: true });
  });
  it('a timeout or an error is still a failure', () => {
    expect(settleFlight('timeout', 'x')).toEqual({ text: 'x', failed: 'timeout' });
    expect(settleFlight('error', '')).toEqual({ text: '', failed: 'error' });
  });
});

describe('worked for', () => {
  it('records steps once, trimmed, skipping blanks', () => {
    let s = recordStep([], ' Checking your calendar… ', 12.4);
    s = recordStep(s, 'Checking your calendar…', 40);
    s = recordStep(s, '', 50);
    s = recordStep(s, 'Writing the reply…', 2100);
    expect(s).toEqual([{ label: 'Checking your calendar…', atMs: 12 }, { label: 'Writing the reply…', atMs: 2100 }]);
  });

  it('validates the contract fields', () => {
    expect(activityOf([{ label: 'a', atMs: 1 }, { label: 3, atMs: 1 }, null])).toEqual([{ label: 'a', atMs: 1 }]);
    expect(activityOf([])).toBeUndefined();
    expect(durationOf(1200)).toBe(1200);
    expect(durationOf(-1)).toBeUndefined();
    expect(durationOf('9')).toBeUndefined();
  });

  it('says nothing for an instant answer; the duration otherwise', () => {
    expect(workedForLine(undefined, 2500)).toBeNull();
    expect(workedForLine(undefined, 3001)).toBe('Worked for 3s');
    expect(workedForLine([{ label: 'x', atMs: 0 }, { label: 'y', atMs: 4200 }])).toBe('Worked for 4s');
    expect(workedForLine([{ label: 'x', atMs: 0 }])).toBe('Worked');
    expect(formatDuration(72_000)).toBe('1m 12s');
    expect(formatDuration(120_000)).toBe('2m');
    expect(formatDuration(100)).toBe('1s');
  });

  it('offsets epoch moments from the first step', () => {
    const t = 1_790_000_000_000;
    expect(stepOffsets([{ label: 'a', atMs: t }, { label: 'b', atMs: t + 2000 }]).map((s) => s.offsetMs)).toEqual([0, 2000]);
  });

  it('renders collapsed with the steps hidden until opened', () => {
    const out = renderToStaticMarkup(React.createElement(WorkedFor, { activity: [{ label: 'Reading the thread…', atMs: 0 }], durationMs: 8000 }));
    expect(out).toContain('Worked for 8s');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('Reading the thread…');
  });
});

describe('copyable blocks', () => {
  it('names the writing kinds and falls back to the language or "Code"', () => {
    expect(codeBlockKind('Prompt')).toEqual({ writing: true, label: 'Prompt' });
    expect(codeBlockKind('email').label).toBe('Email');
    expect(codeBlockKind('')).toEqual({ writing: false, label: 'Code' });
    expect(codeBlockKind('python')).toEqual({ writing: false, label: 'python' });
  });

  it('marks uppercase placeholders only', () => {
    expect(splitPlaceholders('[YEAR] for [CLIENT / AUDIENCE], not [E1] or [draft]').filter((r) => r.t === 'ph').map((r) => r.v))
      .toEqual(['[YEAR]', '[CLIENT / AUDIENCE]']);
  });

  it('renders a prompt block with label, Copy, Expand and pills; the text stays plain', () => {
    const out = html('```prompt\nDear [NAME], <b>hi</b>\n```');
    expect(out).toContain('data-copy-block="writing"');
    expect(out).toContain('>Prompt<');
    expect(out).toContain('>Copy<');
    expect(out).toContain('>Expand<');
    expect(out).toMatch(/data-placeholder="true"[^>]*>\[NAME\]</);
    expect(out).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(out).not.toContain('<b>');
  });

  it('copies the block text as written (the plain-text answer keeps it whole)', () => {
    expect(markdownToPlain('```email\nHi [NAME]\n```')).toBe('Hi [NAME]');
  });
});

describe('chat titles', () => {
  it('prefers the room title over the first-message fallback', () => {
    expect(conversationName({ label: 'first words', title: 'Board prep' })).toBe('Board prep');
    expect(conversationName({ label: 'first words' })).toBe('first words');
    expect(conversationName({ label: 'first words', title: '' })).toBe('first words');
  });
});
