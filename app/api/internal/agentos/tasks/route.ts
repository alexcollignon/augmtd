import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  executeListTasks, executeCreateTask, executeGetTask, executeUpdateTask,
  executeRunTask, executeDuplicateTask, executeShareTask, executeListTeamTasks,
  executeUseTask, executeDeleteTask, executeListWorkerDocuments, executeGetWorkerDocument,
  executeSupplyRunInput, executeSetTasksStatus,
} from '@/lib/tools/worker-tasks';
import { executeListSkills, executeApplySkill } from '@/lib/tools/worker-skills';

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
  /** THE USER'S OWN WORDS, carried across the box (Sep 21). A deed whose dangerous arguments are
   *  decided from what the person actually said needs the sentence, not just the model's
   *  extraction — the bridge puts it on `dependencies.user_text` and the Python `_call` forwards
   *  it. Absent (an older box, or a run with no human turn) the executor's floors FAIL CLOSED. */
  user_text?: string;
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
  const userText = typeof body.user_text === 'string' ? body.user_text.slice(0, 4000) : '';
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
        // `trigger_doors` rides through when the Python tool sends it (box redeploy pending — the
        // TS side accepts it today; update_task's door verbs already ride the `args as never` pass).
        // The INPUTS TRAY (W2) rides the same way — spoken doc names + the material flag.
        result = await executeCreateTask(
          String(args.description ?? ''), agent_id, user_id, sb, ac,
          args.skill_names as string[] | string | undefined, args.trigger_doors,
          args.input_doc_names,
          typeof args.input_accept_material === 'boolean' ? args.input_accept_material : undefined,
          // THE THROTTLE (relay canvas W3b) rides the same way — the executor clamps and says so.
          // (update_task's `daily_run_limit` already rides the `args as never` pass below.)
          args.daily_run_limit,
        );
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

      // THE BULK STATUS DEED (Sep 21) — the AgentOS half of the same verb, wrapping the SAME
      // executor. (The Python @tool ships on the next box redeploy; the TS side accepts it today,
      // exactly as `trigger_doors` and `supply_run_input` did before it.)
      // THE WORDS RIDE THROUGH: the executor's floors are decided from the user's own sentence, and
      // a door that hands them nothing gets the FAIL-CLOSED answer (named targets only, else a
      // refusal by listing) — never a bulk over everything nobody asked for.
      case 'set_tasks_status': {
        const out = await executeSetTasksStatus({
          status: args.status === 'active' ? 'active' : 'paused',
          scope: args.scope === 'all' ? 'all' : args.scope === 'named' ? 'named' : undefined,
          names: Array.isArray(args.names) ? (args.names as string[]) : undefined,
        }, agent_id ?? null, user_id, ac, userText);
        result = out.text;
        break;
      }

      // THE SAYABLE SUPPLY (THE WAVE) — the AgentOS half of the same deed. The executor holds the
      // rules; both runtimes are passthrough. (The Python tool ships on the next box redeploy; the
      // TS side accepts it today, exactly as `trigger_doors` did.)
      case 'supply_run_input':
        result = await executeSupplyRunInput({
          run_id: args.run_id as string | undefined,
          text: args.text as string | undefined,
          kb_file_name: args.kb_file_name as string | undefined,
          pin: args.pin === true,
        }, user_id, ac);
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

      case 'list_skills':
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        result = await executeListSkills(agent_id, user_id, ac);
        break;

      case 'apply_skill':
        if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
        result = await executeApplySkill(String(args.skill_name ?? ''), agent_id, user_id, ac);
        break;

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ result });
  } catch (err) {
    console.error(`[internal/agentos/tasks] ${action} failed:`, err);
    return NextResponse.json({ error: 'Task action failed' }, { status: 500 });
  }
}
