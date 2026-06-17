import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  executeListTasks, executeCreateTask, executeGetTask, executeUpdateTask,
  executeRunTask, executeDuplicateTask, executeShareTask, executeListTeamTasks,
  executeUseTask, executeDeleteTask, executeListWorkerDocuments, executeGetWorkerDocument,
} from '@/lib/tools/worker-tasks';

export const maxDuration = 60;

// ─── Internal task API for the AgentOS service ────────────────────────────────
// AgentOS (Python, Hetzner) has no user session/cookies, so its Python task
// tools call this route instead — authenticated by the shared AGENTOS_SECRET
// bearer + an explicit user_id (same trust model as the meeting bot's
// BOT_SECRET callbacks). All work runs through the service-role admin client,
// scoped by the user_id the caller passes. This wraps the SAME executors the
// native worker chat loop uses — single source of truth for task logic.

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

interface TaskRequest {
  action: string;
  user_id: string;
  agent_id?: string;
  args?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  // ── Auth — shared secret with the AgentOS box ──
  const secret = process.env.AGENTOS_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'AGENTOS_SECRET not configured' }, { status: 500 });
  }
  const provided = request.headers.get('authorization') ?? '';
  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: TaskRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, user_id, agent_id, args = {} } = body;
  if (!action || !user_id) {
    return NextResponse.json({ error: 'action and user_id are required' }, { status: 400 });
  }

  const ac = admin();
  // The executors take a "supabase" arg only for reads (tenant_configs,
  // company_members) and AI client resolution — the admin client satisfies both.
  const sb = ac as unknown as Parameters<typeof executeCreateTask>[3];

  try {
    let result: string;

    switch (action) {
      case 'list_tasks':
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        result = await executeListTasks(agent_id, user_id, ac);
        break;

      case 'create_task':
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        result = await executeCreateTask(String(args.description ?? ''), agent_id, user_id, sb, ac);
        break;

      case 'get_task':
        result = await executeGetTask(String(args.task_id ?? ''), user_id, ac);
        break;

      case 'update_task':
        result = await executeUpdateTask(String(args.task_id ?? ''), args as never, user_id, ac);
        break;

      case 'run_task':
        result = await executeRunTask(String(args.task_id ?? ''), user_id, ac, args.thread_id as string | undefined);
        break;

      case 'duplicate_task':
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        result = await executeDuplicateTask(String(args.task_id ?? ''), agent_id, user_id, args.name as string | undefined, ac);
        break;

      case 'share_task':
        result = await executeShareTask(String(args.task_id ?? ''), (args.action as 'share' | 'unshare') ?? 'share', user_id, ac);
        break;

      case 'list_team_tasks':
        result = await executeListTeamTasks(user_id, ac);
        break;

      case 'use_task':
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        result = await executeUseTask(String(args.task_id ?? ''), agent_id, user_id, ac);
        break;

      case 'delete_task':
        result = await executeDeleteTask(String(args.task_id ?? ''), user_id, ac);
        break;

      case 'list_worker_documents':
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        result = await executeListWorkerDocuments(agent_id, user_id, ac);
        break;

      case 'get_worker_document': {
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        const doc = await executeGetWorkerDocument(String(args.artifact_id ?? ''), agent_id, user_id, ac);
        result = doc.content;
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (err) {
    console.error(`[internal/agentos/tasks] ${action} failed:`, err);
    return NextResponse.json({ error: 'Task action failed' }, { status: 500 });
  }
}
