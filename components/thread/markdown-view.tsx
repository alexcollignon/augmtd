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
import { createPortal } from 'react-dom';
import { ArrowsPointingOutIcon, CheckIcon, ClipboardDocumentIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { codeBlockKind, parseMarkdown, splitPlaceholders, type MdBlock, type MdInline } from './markdown';

export type MarkdownTextRenderer = (text: string, key: string) => React.ReactNode;

const defaultText: MarkdownTextRenderer = (text) => text;

/** The streaming indicator (W23.A) — a soft pulsing dot at the end of the growing text; static under
 *  reduced motion. */
export const StreamCaret = () => (
  <span aria-hidden data-stream-caret className="ml-1 inline-block h-2 w-2 translate-y-[-1px] animate-pulse rounded-full bg-neutral-400 align-middle motion-reduce:animate-none" />
);

/** The block's text with its fill-in placeholders marked — plain strings in React spans, nothing
 *  parsed as HTML. */
function WithPlaceholders({ text }: { text: string }) {
  return (
    <>
      {splitPlaceholders(text).map((r, i) => (r.t === 'ph'
        ? <span key={i} data-placeholder className="rounded bg-amber-100/70 px-1 py-px text-amber-900">{r.v}</span>
        : <React.Fragment key={i}>{r.v}</React.Fragment>))}
    </>
  );
}

/** ── A COPYABLE BLOCK (W23.A) — a fenced block renders bordered, with its label, Copy and Expand.
 *  Writing (prompt · email · text · draft · message) reads as wrapped prose with its placeholders
 *  marked; anything else is code. Expand opens the same text full-width in a dialog. */
function CopyBlock({ lang, value, tail }: { lang: string; value: string; tail?: React.ReactNode }) {
  const kind = codeBlockKind(lang);
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard refused — nothing claimed */ }
  };
  React.useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);
  const btn = 'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300';
  const body = (big: boolean) => (kind.writing
    ? <div className={`whitespace-pre-wrap break-words px-3.5 py-3 text-neutral-800 ${big ? 'text-[15px] leading-[1.7]' : 'text-[13.5px] leading-[1.65]'}`}><WithPlaceholders text={value} /></div>
    : <pre className={`overflow-x-auto px-3.5 py-3 font-mono leading-[1.55] text-neutral-800 ${big ? 'text-[13.5px]' : 'text-[12.5px]'}`}><code>{value}</code></pre>);
  const actions = (inDialog: boolean) => (
    <span className="flex items-center gap-0.5">
      <button type="button" onClick={() => void copy()} className={btn} aria-label={`Copy ${kind.label.toLowerCase()}`}>
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {inDialog ? (
        <button type="button" onClick={() => setExpanded(false)} className={btn} aria-label="Close">
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button type="button" onClick={() => setExpanded(true)} className={btn} aria-label={`Expand ${kind.label.toLowerCase()}`}>
          <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
          <span>Expand</span>
        </button>
      )}
    </span>
  );
  const head = (inDialog: boolean) => (
    <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 py-1 pl-3.5 pr-1.5">
      <span className="text-[11.5px] font-medium text-neutral-500">{kind.label}</span>
      {actions(inDialog)}
    </div>
  );
  return (
    <div data-copy-block={kind.writing ? 'writing' : 'code'}>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {head(false)}
        {body(false)}
      </div>
      {tail}
      {expanded && typeof document !== 'undefined' && createPortal(
        <div role="dialog" aria-modal="true" aria-label={kind.label}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-900/30 p-4 sm:p-8"
          onClick={() => setExpanded(false)}>
          <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            {head(true)}
            <div className="min-h-0 flex-1 overflow-y-auto">{body(true)}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

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
      return <CopyBlock lang={b.lang} value={b.v} tail={tail} />;
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
