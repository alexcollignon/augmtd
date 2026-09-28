'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE ONE CHAT MARKDOWN RENDERER (stabilization W22.B). Every chat answer — the Home chat, the
// coworker DM, the item/project room, the coworker chat page — draws its prose through this one
// component over the one parser (./markdown.ts). React elements only: there is no HTML path, so an
// answer that contains `<img onerror=…>` shows those characters and nothing executes (RENDER SAFETY).
//
// `renderText` is the host's seam for what lives INSIDE plain text runs — the Home answer resolves
// its grounding tags ([E1], [R2]) into inline source chips there, so the chips keep working inside
// bold, list items and table cells alike.
//
// Blocks and inlines are keyed by POSITION: a streamed answer only ever grows its last block, so every
// block already painted keeps its node while tokens land (the no-mutation law).
// ════════════════════════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { parseMarkdown, type MdBlock, type MdInline } from './markdown';

export type MarkdownTextRenderer = (text: string, key: string) => React.ReactNode;

const defaultText: MarkdownTextRenderer = (text) => text;

/** The streaming caret — the same quiet bar the coworker chat always used. */
export const StreamCaret = () => (
  <span aria-hidden className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-neutral-400 align-middle motion-reduce:animate-none" />
);

function Inlines({ nodes, k, renderText }: { nodes: MdInline[]; k: string; renderText: MarkdownTextRenderer }) {
  return (
    <>
      {nodes.map((n, i) => {
        const key = `${k}.${i}`;
        switch (n.t) {
          case 'text': return <React.Fragment key={key}>{renderText(n.v, key)}</React.Fragment>;
          case 'strong': return <strong key={key} className="font-semibold text-neutral-900"><Inlines nodes={n.c} k={key} renderText={renderText} /></strong>;
          case 'em': return <em key={key} className="italic"><Inlines nodes={n.c} k={key} renderText={renderText} /></em>;
          case 'del': return <del key={key} className="text-neutral-400"><Inlines nodes={n.c} k={key} renderText={renderText} /></del>;
          case 'code': return <code key={key} className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12.5px] text-neutral-800">{n.v}</code>;
          case 'link':
            // The target was vetted by `safeHref` at parse time (http(s) · mailto · app-relative).
            return n.external
              ? <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-500"><Inlines nodes={n.c} k={key} renderText={defaultText} /></a>
              : <a key={key} href={n.href} className="text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-500"><Inlines nodes={n.c} k={key} renderText={defaultText} /></a>;
        }
      })}
    </>
  );
}

const H_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'text-[16px] font-semibold text-neutral-900 leading-snug pt-1',
  2: 'text-[15px] font-semibold text-neutral-900 leading-snug pt-1',
  3: 'text-[14px] font-semibold text-neutral-900 leading-snug',
  4: 'text-[13.5px] font-semibold text-neutral-700 leading-snug',
};

function Block({ b, k, renderText, tail }: { b: MdBlock; k: string; renderText: MarkdownTextRenderer; tail?: React.ReactNode }) {
  switch (b.t) {
    case 'h': {
      const Tag = (`h${b.level + 1 > 6 ? 6 : b.level + 1}`) as 'h2' | 'h3' | 'h4' | 'h5';
      return <Tag className={H_CLASS[b.level]}><Inlines nodes={b.c} k={k} renderText={renderText} />{tail}</Tag>;
    }
    case 'p':
      return (
        <p className="text-[14px] leading-[1.65] text-neutral-700">
          {b.lines.map((ln, i) => (
            <React.Fragment key={i}>{i > 0 && <br />}<Inlines nodes={ln} k={`${k}.${i}`} renderText={renderText} /></React.Fragment>
          ))}
          {tail}
        </p>
      );
    case 'hr':
      return <><hr className="border-neutral-200" />{tail}</>;
    case 'code':
      return (
        <div>
          <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 font-mono text-[12.5px] leading-[1.55] text-neutral-800"><code>{b.v}</code></pre>
          {tail}
        </div>
      );
    case 'quote':
      return (
        <blockquote className="space-y-2 border-l-2 border-neutral-200 pl-3 text-neutral-600">
          {b.c.map((c, i) => <Block key={i} b={c} k={`${k}.${i}`} renderText={renderText} tail={i === b.c.length - 1 ? tail : undefined} />)}
        </blockquote>
      );
    case 'table':
      return (
        <div>
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-neutral-50">
                <tr>
                  {b.head.map((h, i) => (
                    <th key={i} className="border-b border-neutral-200 px-3 py-2 text-left text-[12px] font-semibold text-neutral-600" style={b.align[i] ? { textAlign: b.align[i]! } : undefined}>
                      <Inlines nodes={h} k={`${k}.h${i}`} renderText={renderText} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-neutral-100 last:border-0">
                    {r.map((c, ci) => (
                      <td key={ci} className="px-3 py-2 align-top leading-snug text-neutral-700" style={b.align[ci] ? { textAlign: b.align[ci]! } : undefined}>
                        <Inlines nodes={c} k={`${k}.${ri}.${ci}`} renderText={renderText} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tail}
        </div>
      );
    case 'list': {
      const List = b.ordered ? 'ol' : 'ul';
      return (
        <List className={b.ordered ? 'list-decimal space-y-1 pl-5 marker:text-neutral-400' : 'list-disc space-y-1 pl-5 marker:text-neutral-300'} {...(b.ordered && b.start !== 1 ? { start: b.start } : {})}>
          {b.items.map((it, i) => {
            const lastItem = i === b.items.length - 1;
            return (
              <li key={i} className="pl-0.5 text-[14px] leading-[1.6] text-neutral-700">
                {it.c.map((ln, j) => (
                  <React.Fragment key={j}>{j > 0 && <br />}<Inlines nodes={ln} k={`${k}.${i}.${j}`} renderText={renderText} /></React.Fragment>
                ))}
                {it.children.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {it.children.map((ch, ci) => <Block key={ci} b={ch} k={`${k}.${i}.c${ci}`} renderText={renderText} tail={lastItem && ci === it.children.length - 1 ? tail : undefined} />)}
                  </div>
                )}
                {lastItem && it.children.length === 0 ? tail : null}
              </li>
            );
          })}
        </List>
      );
    }
  }
}

export interface MarkdownProps {
  /** The markdown source (model-authored — treated as text, never HTML). */
  text: string;
  /** What renders inside a plain-text run (the Home answer's source chips). Default: the text. */
  renderText?: MarkdownTextRenderer;
  /** Show the streaming caret at the end of the last block. */
  cursor?: boolean;
  className?: string;
}

/** THE ONE CHAT MARKDOWN RENDERER. */
export function Markdown({ text, renderText = defaultText, cursor, className }: MarkdownProps) {
  const blocks = parseMarkdown(text);
  const tail = cursor ? <StreamCaret /> : undefined;
  return (
    <div className={className ?? 'space-y-2.5'} data-md="chat">
      {blocks.map((b, i) => <Block key={i} b={b} k={`b${i}`} renderText={renderText} tail={i === blocks.length - 1 ? tail : undefined} />)}
      {cursor && blocks.length === 0 ? <StreamCaret /> : null}
    </div>
  );
}
