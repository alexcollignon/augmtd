import { NextRequest, NextResponse } from 'next/server';
import { hasBearer } from '@/lib/utils/bearer-auth';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  executeGetEmails,
  executeWebSearch, executeFetchUrl, executeDeepResearch,
  executeSlackListChannels, executeSlackReadMessages, executeSlackListMembers,
  executeFindTeamWork, executeReadTeamWork,
  executeComposeEmail,
} from '@/lib/tools';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { generateThreadDocument } from '@/lib/work/generate-thread-document';
import { getWorkspaceFeatures } from '@/lib/workspace/features';
import { TOOL_FEATURE } from '@/lib/workspace/tool-capabilities';
// ── THE PRESENTATION SIDE-CHANNEL (W4-C, Sep 22) ──────────────────────────────
// These reads produce TWO halves (docs/component-map.md §6): `result`, which is all the model ever
// sees, and a typed spec for the kit. A tool's return string is the only channel back to the box,
// and rows must never ride a model's context — so the DATA half is written to the per-thread
// channel here and the bridge emits it as the same `{type:'collection'|'event'}` frames the native
// DM route emits. The wrappers (`execute*`) return only the text, so the present lanes below read
// through the SAME readers the native route reads — never a second query that could rank
// differently than the block the coworker was shown.
import { readCalendar } from '@/lib/tools/check-calendar';
import { readMeetingContext } from '@/lib/tools/get-meeting-context';
import { executePrepareEventAction, eventToolResult } from '@/lib/tools/prepare-event-action';
import { pushDmPresent } from '@/lib/present/dm-channel';
import type { CollectionSpec } from '@/lib/present/collection';
import type { EventSpec } from '@/lib/present/event';
import type { ChangeSpec } from '@/lib/present/change';
import { prepareSlackPostArgs } from '@/lib/tools/slack';
import { prepareBoxChange } from '@/lib/work/pending-change';

export const maxDuration = 60;

// ─── Internal data/web tool API for the AgentOS service ───────────────────────
// Same trust model as the tasks route: shared AGENTOS_SECRET bearer + explicit
// user_id, service-role admin client. Wraps the SAME executors the native chat
// loop uses (lib/tools/*) so behavior is identical. External API keys (Tavily,
// Bedrock) stay on Vercel — the box never holds them.

let _admin: ReturnType<typeof createAdminClient> | null = null;
function admin() {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

interface ToolRequest {
  action: string;
  user_id?: string;
  agent_id?: string;
  thread_id?: string;
  config?: Record<string, unknown>;
  /** THE USER'S OWN WORDS (Sep 21 idiom, extended here): deeds and arming floors decided in code
   *  read the person's sentence, never the model's extraction. Absent → the floors fail closed. */
  user_text?: string;
  /** THE BRIDGE'S PER-RUN TOKEN (W4-C): stamped on anything this call leaves in the presentation
   *  side-channel, so a card can only ever be served to the turn that made it. */
  turn_id?: string;
}

export async function POST(request: NextRequest) {
  const secret = process.env.AGENTOS_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'AGENTOS_SECRET not configured' }, { status: 500 });
  }
  if (!hasBearer(request, 'AGENTOS_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ToolRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, user_id, agent_id, thread_id, config = {} } = body;
  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  const ac = admin();
  const sb = ac as unknown as Parameters<typeof executeGetEmails>[2];
  const userText = typeof body.user_text === 'string' ? body.user_text.slice(0, 4000) : '';
  const turnId = typeof body.turn_id === 'string' ? body.turn_id.slice(0, 64) : null;
  /** The DATA half this call produced, if any. Written to the channel AFTER the switch — it is an
   *  ENHANCEMENT: a failure here can never change what the model is told. */
  let present: { collection?: CollectionSpec; event?: EventSpec; change?: ChangeSpec } | null = null;

  // THE CONFIRM CARD (stabilization W0.3c — HUMAN IN THE LOOP, posts included): this lane reads
  // untrusted content (Slack, the web, mail), so a class-A tool here is PREPARED through the ONE
  // box-lane helper the tasks route uses, and applied ONLY through /api/changes/[id]/apply on the
  // user's own click. The card rides the presentation side-channel; the model gets "prepared".
  const prepare = async (tool: string, toolArgs: Record<string, unknown>): Promise<string> => {
    if (!user_id) return 'That change could not be prepared — nothing was changed.';
    const out = await prepareBoxChange(ac, user_id, { tool, args: toolArgs, agentId: agent_id ?? null, threadId: thread_id ?? null });
    if (out.spec) present = { change: out.spec };
    return out.modelText;
  };

  // Feature gate (single source: tool-capabilities map) — parity with the native loop's
  // tool filter. Off-feature tools return a short "unavailable" string so the worker adapts.
  const reqFeature = TOOL_FEATURE[action];
  if (reqFeature && user_id) {
    const features = await getWorkspaceFeatures(user_id, ac);
    if (features[reqFeature] === false) {
      return NextResponse.json({ result: `Unavailable — ${reqFeature} is turned off for this workspace.` });
    }
  }

  try {
    let result: string;

    switch (action) {
      // ── Slack (company-scoped) ──
      case 'slack_list_channels':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeSlackListChannels(user_id, ac, agent_id);
        break;

      case 'slack_post_message': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        // PREPARED, NEVER POSTED: the preflight resolves the target (no Slack write) and the card
        // is the only way to the post — the apply door runs executeSlackPostMessage on the click.
        const pre = await prepareSlackPostArgs(config, user_id, agent_id, ac);
        result = pre.ok ? await prepare('slack_post_message', pre.args) : pre.result;
        break;
      }

      case 'slack_read_messages':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeSlackReadMessages(config, user_id, ac, agent_id);
        break;

      case 'slack_list_members':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeSlackListMembers(config, user_id, ac, agent_id);
        break;

      case 'find_team_work':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeFindTeamWork(config, user_id, ac);
        break;

      case 'read_team_work':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeReadTeamWork(config, user_id, ac);
        break;

      case 'compose_email': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        const out = await executeComposeEmail(config, user_id, agent_id, ac);
        // Embed the draft as a marker the bridge parses → email_draft event (mirrors [[artifact:…]]).
        result = out.draft
          ? `${out.result}\n[[email_draft:${Buffer.from(JSON.stringify(out.draft)).toString('base64')}]]`
          : out.result;
        break;
      }

      case 'present_linkedin_post': {
        // Display-only: package the worker's post(s) into a [[card:…]] marker the bridge
        // decodes → render registry (LinkedInPostCard). No external side effects.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variants = (Array.isArray((config as any)?.variants) ? (config as any).variants : [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((v: any) => ({
            text: String(v?.text ?? '').trim(),
            hashtags: Array.isArray(v?.hashtags) ? v.hashtags.map((h: unknown) => String(h)) : [],
          }))
          .filter((v: { text: string }) => v.text);
        if (!variants.length) { result = 'No post text provided.'; break; }
        const payload = { type: 'linkedin_post', variants };
        result = `Presented the LinkedIn post${variants.length > 1 ? ` (${variants.length} variants)` : ''} to the user for review.\n[[card:${Buffer.from(JSON.stringify(payload)).toString('base64')}]]`;
        break;
      }

      // ── User-scoped data tools ──
      case 'get_emails':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeGetEmails(config, user_id, sb);
        break;

      case 'get_meeting_context': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        // ONE READ, TWO RENDERINGS (parity with the native DM loop): the block for the model AND
        // the typed rows the recordings card is built from.
        const read = await readMeetingContext(config, user_id, sb);
        result = read.text;
        try {
          const { recordingSpec } = await import('@/lib/present/build');
          present = { collection: recordingSpec(read.meetings, { since: String(config.since ?? '30d') }) };
        } catch { /* the card is an enhancement — the answer stands without it */ }
        break;
      }

      // THE COWORKER LANE REACHES THE CALENDAR (Sep 18) — the AgentOS mirror of the native case.
      // get_meeting_context reads meetings we RECORDED; this reads the CALENDAR for a date range,
      // and every busy/free line, weekday label and proposed slot in the block is code's output.
      case 'check_calendar': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        // ONE READ, TWO RENDERINGS: `readCalendar` returns that block AND the schedule window the
        // card's rows are built from — a rendered day and a printed line are one day.
        const read = await readCalendar(config, user_id, sb);
        if ('refusal' in read) { result = read.refusal; break; }
        result = read.text;
        try {
          const { calendarSpec } = await import('@/lib/present/build');
          present = { collection: calendarSpec(read.win.days, {
            hasCalendar: read.win.hasCalendar, from: read.fromDayStr, to: read.toDayStr,
          }) };
        } catch { /* the card is an enhancement — the answer stands without it */ }
        break;
      }

      // WAVE 2 ON THE BOX LANE (W4-C): ONE meeting already on the calendar, with the verbs its own
      // state permits. It PREPARES and never writes — the deed fires from the card, through
      // /api/events/[id]/deed. The model gets a description of the card, never its data.
      case 'prepare_event_action': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        const out = await executePrepareEventAction(sb, user_id, {
          which: typeof config.which === 'string' ? config.which : undefined,
          verb: typeof config.verb === 'string' ? config.verb : undefined,
          // THE ARMING FLOOR reads the USER'S own words — forwarded across the box on
          // `dependencies.user_text`. Without them nothing arms (the floor fails closed).
          userText,
        });
        result = eventToolResult(out);
        if (out.present?.spec) present = { event: out.present.spec };
        break;
      }

      case 'search_knowledge_base': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        const query = String(config.query ?? '');
        // Scope KB search to the worker's attached files, if any.
        let scopeFileIds: string[] | undefined;
        if (agent_id) {
          const { data: sources } = await ac
            .from('agent_knowledge_sources')
            .select('knowledge_file_id')
            .eq('agent_id', agent_id);
          const ids = (sources ?? [])
            .map((s: { knowledge_file_id: string | null }) => s.knowledge_file_id)
            .filter((id: string | null): id is string => Boolean(id));
          if (ids.length > 0) scopeFileIds = ids;
        }
        const kbCtx = await buildKBContext(user_id, query, ac, {
          fileLimit: 5,
          maxChunksPerFile: 3,
          threshold: 0.2,
          maxTotalChars: 8000,
          scopeFileIds,
        });
        // SINGLE-SOURCE #2: connected drives ride the same search (one shared helper).
        const { driveSupplementLine } = await import('@/lib/knowledge/resolve');
        const driveLine = await driveSupplementLine(ac, user_id, query);
        result = (kbCtx.context || 'No relevant documents found in your knowledge base.') + driveLine;
        // ONE READ, TWO RENDERINGS: the card is built from the groups THIS context was rendered
        // from — never a second search that could rank differently.
        if (kbCtx.groups?.length) {
          try {
            const { documentSpec } = await import('@/lib/present/build');
            present = { collection: documentSpec(kbCtx.groups, query) };
          } catch { /* the card is an enhancement — the answer stands without it */ }
        }
        break;
      }

      // ── Stateless web/research tools (no user context needed) ──
      case 'web_search':
        result = await executeWebSearch(config);
        break;

      case 'fetch_url':
        result = await executeFetchUrl(config);
        break;

      case 'deep_research':
        result = await executeDeepResearch(config as never, '', { userId: user_id, supabase: ac });
        break;

      // ── Sandboxed compute (the production floor reaching prod workers, Aug 8) ──
      case 'run_compute': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        const { executeRunCompute } = await import('@/lib/tools');
        result = await executeRunCompute(config as never, user_id, ac);
        break;
      }

      // ── Document generation (Op-B) ──
      case 'generate_document': {
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        if (!thread_id) return NextResponse.json({ error: 'thread_id required' }, { status: 400 });
        const gen = await generateThreadDocument({
          userId: user_id,
          threadId: thread_id,
          type: String(config.type ?? 'word'),
          instructions: String(config.instructions ?? ''),
          adminClient: ac,
          groundingContext: config.grounding ? String(config.grounding) : undefined,
        });
        // Embed a marker the bridge parses to emit artifact_ready + save metadata.
        result = gen.artifact
          ? `${gen.summary}\n[[artifact:${gen.artifact.id}|${gen.artifact.type}|${gen.artifact.title}]]`
          : gen.summary;
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // THE DATA HALF NEVER TRAVELS THROUGH THE MODEL: the spec goes to the per-thread side-channel,
    // the bridge emits it as a live card frame, and the response body carries `result` ONLY —
    // exactly what the model's `role:'tool'` message may hold (THE PRESENTATION LAW).
    if (present && user_id && thread_id) {
      await pushDmPresent(ac, user_id, thread_id, { turn: turnId, ...present });
    }
    return NextResponse.json({ result });
  } catch (err) {
    console.error(`[internal/agentos/tools] ${action} failed:`, err);
    return NextResponse.json({ error: 'Tool action failed' }, { status: 500 });
  }
}
