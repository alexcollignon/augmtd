import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getMyCompany } from '@/lib/company/get-my-company';
import type { ProcessListItem } from '@/lib/types/process';

// GET /api/processes — list all company processes
export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });

  const { data: processes, error: pErr } = await supabase
    .from('processes')
    .select('id, title, status, current_step, plan, owner_id, due_date, created_at, updated_at')
    .eq('company_id', company.id)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });

  if (pErr) return NextResponse.json({ error: 'Failed to fetch processes' }, { status: 500 });

  if (!processes?.length) return NextResponse.json({ processes: [] });

  const processIds = processes.map((p: any) => p.id);

  // Fetch steps for all processes to compute active step info
  const { data: steps } = await supabase
    .from('process_steps')
    .select('process_id, step_index, status, assignee_id, title')
    .in('process_id', processIds);

  // Collect all user IDs to resolve names
  const ownerIds = [...new Set(processes.map((p: any) => p.owner_id))];
  const assigneeIds = [...new Set((steps ?? []).map((s: any) => s.assignee_id).filter(Boolean))];
  const allUserIds = [...new Set([...ownerIds, ...assigneeIds])];

  // Use adminClient — profiles RLS only allows reading own row
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: profiles } = await adminClient
    .from('profiles')
    .select('id, full_name')
    .in('id', allUserIds);

  const nameMap: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameMap[p.id] = p.full_name ?? 'Unknown';
  }

  const stepsByProcess: Record<string, any[]> = {};
  for (const s of steps ?? []) {
    if (!stepsByProcess[s.process_id]) stepsByProcess[s.process_id] = [];
    stepsByProcess[s.process_id].push(s);
  }

  const result: ProcessListItem[] = processes.map((p: any) => {
    const processSteps = stepsByProcess[p.id] ?? [];
    const totalSteps = p.plan?.steps?.length ?? processSteps.length;
    const activeStep = processSteps.find((s: any) => s.status === 'in_progress');
    const on_desk_of_me = !!activeStep && activeStep.assignee_id === user.id;

    return {
      id: p.id,
      title: p.title,
      status: p.status,
      current_step: p.current_step ?? 0,
      total_steps: totalSteps,
      owner_id: p.owner_id,
      owner_name: nameMap[p.owner_id],
      due_date: p.due_date,
      on_desk_of_me,
      current_step_title: activeStep?.title,
      current_step_assignee_name: activeStep?.assignee_id ? nameMap[activeStep.assignee_id] : undefined,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  });

  return NextResponse.json({ processes: result });
}

// POST /api/processes — create draft process
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const company = await getMyCompany(user.id, supabase);
  if (!company) return NextResponse.json({ error: 'No company' }, { status: 404 });

  const { title, description } = await request.json();
  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 });

  const { data: process, error: insertErr } = await supabase
    .from('processes')
    .insert({
      company_id: company.id,
      owner_id: user.id,
      title: title.trim(),
      description: description?.trim() || null,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: 'Failed to create process' }, { status: 500 });

  return NextResponse.json({ process }, { status: 201 });
}
