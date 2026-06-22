-- Audit + rate-limit log for coworker emails (Resend, team.augmtd.ai). One row per send
-- attempt; powers the per-account daily cap and abuse monitoring on the shared domain.
--
-- Apply manually in the Supabase SQL editor.

create table if not exists email_sends (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  agent_id   uuid references custom_agents(id) on delete set null,
  to_count   int  not null default 0,
  subject    text,
  status     text not null default 'sent',   -- 'sent' | 'failed'
  created_at timestamptz not null default now()
);

create index if not exists email_sends_user_created_idx on email_sends(user_id, created_at desc);

alter table email_sends enable row level security;

-- Owner can read their own send log; writes happen via the service role (server only).
drop policy if exists email_sends_owner_select on email_sends;
create policy email_sends_owner_select on email_sends
  for select using (auth.uid() = user_id);
