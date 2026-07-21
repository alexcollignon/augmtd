import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  executeGetEmails, executeGetMeetingContext,
  executeWebSearch, executeFetchUrl, executeDeepResearch,
  executeSlackListChannels, executeSlackPostMessage, executeSlackReadMessages, executeSlackListMembers,
  executeFindTeamWork, executeReadTeamWork,
  executeComposeEmail,
} from '@/lib/tools';
import { buildKBContext } from '@/lib/knowledge/build-kb-context';
import { generateThreadDocument } from '@/lib/work/generate-thread-document';
import { getWorkspaceFeatures } from '@/lib/workspace/features';
import { TOOL_FEATURE } from '@/lib/workspace/tool-capabilities';

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
}

export async function POST(request: NextRequest) {
  const secret = process.env.AGENTOS_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'AGENTOS_SECRET not configured' }, { status: 500 });
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
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

      case 'slack_post_message':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeSlackPostMessage(config, user_id, agent_id, ac);
        break;

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

      case 'get_meeting_context':
        if (!user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });
        result = await executeGetMeetingContext(config, user_id, sb);
        break;

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
        result = await executeDeepResearch(config as never, '');
        break;

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

    return NextResponse.json({ result });
  } catch (err) {
    console.error(`[internal/agentos/tools] ${action} failed:`, err);
    return NextResponse.json({ error: 'Tool action failed' }, { status: 500 });
  }
}
