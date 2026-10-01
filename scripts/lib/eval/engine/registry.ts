// W26 — THE ADAPTER REGISTRY. One line per measured surface. Adding a surface = its adapter file +
// its fixtures + one line here + its coverage entry (coverage.ts). The coverage gate
// (scripts/smoke-eval-coverage.ts) fails when a call site or a thread-kit kind maps to nothing.
import type { AnyAdapter } from './types';
import { homeChatAdapter } from './adapters/home-chat';
import { understandingAdapter } from './adapters/understanding';
import { workVerdictAdapter } from './adapters/work-verdict';
import { fulfillmentAdapter } from './adapters/fulfillment';
import { commitmentExtractionAdapter } from './adapters/commitment-extraction';
import { inputAskAdapter } from './adapters/input-ask';
import { nextMoveAdapter } from './adapters/next-move';
import { inviteAdapter } from './adapters/invite';

export const ADAPTERS: AnyAdapter[] = [
  homeChatAdapter,
  understandingAdapter,
  workVerdictAdapter,
  fulfillmentAdapter,
  commitmentExtractionAdapter,
  inputAskAdapter,
  nextMoveAdapter,
  inviteAdapter,
];

export const adapterById = (id: string): AnyAdapter | undefined => ADAPTERS.find((a) => a.id === id);

/** `--surfaces` / `--stage` selection: ids, id prefixes (`judgment.`), or a stage name. */
export function selectAdapters(opts: { surfaces?: string[] | null; stage?: string | null }): AnyAdapter[] {
  let list = ADAPTERS;
  if (opts.stage) list = list.filter((a) => a.stage === opts.stage);
  if (opts.surfaces?.length) list = list.filter((a) => opts.surfaces!.some((s) => a.id === s || (s.endsWith('.') && a.id.startsWith(s)) || a.id.endsWith(`.${s}`)));
  return list;
}
