-- Fix Auth RLS Initialization Plan warnings across all tables.
-- auth.uid() called bare is re-evaluated per row; (select auth.uid()) is evaluated
-- once per query as a stable subquery — dramatically reduces disk IO on large tables.
--
-- Apply in Supabase dashboard SQL editor.

-- ── agent_knowledge_sources ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "agent_knowledge_sources: owner full access" ON agent_knowledge_sources;
CREATE POLICY "agent_knowledge_sources: owner full access" ON agent_knowledge_sources FOR ALL
  USING  (EXISTS (SELECT 1 FROM custom_agents WHERE custom_agents.id = agent_knowledge_sources.agent_id AND custom_agents.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM custom_agents WHERE custom_agents.id = agent_knowledge_sources.agent_id AND custom_agents.user_id = (select auth.uid())));

-- ── agent_memories ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "agent_memories_owner" ON agent_memories;
CREATE POLICY "agent_memories_owner" ON agent_memories FOR ALL
  USING ((select auth.uid()) = user_id);

-- ── audit_logs ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "audit_logs_service_write" ON audit_logs;
CREATE POLICY "audit_logs_service_write" ON audit_logs FOR ALL
  USING ((select auth.role()) = 'service_role');

DROP POLICY IF EXISTS "audit_logs_superadmin_read" ON audit_logs;
CREATE POLICY "audit_logs_superadmin_read" ON audit_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (select auth.uid()) AND profiles.is_super_admin = true));

-- ── calendar_events ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can delete own calendar events" ON calendar_events;
CREATE POLICY "Users can delete own calendar events" ON calendar_events FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own calendar events" ON calendar_events;
CREATE POLICY "Users can insert own calendar events" ON calendar_events FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own calendar events" ON calendar_events;
CREATE POLICY "Users can read own calendar events" ON calendar_events FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own calendar events" ON calendar_events;
CREATE POLICY "Users can update own calendar events" ON calendar_events FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── communication_embeddings ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own embeddings" ON communication_embeddings;
CREATE POLICY "Users can insert own embeddings" ON communication_embeddings FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own embeddings" ON communication_embeddings;
CREATE POLICY "Users can read own embeddings" ON communication_embeddings FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ── companies ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "company_admins_update" ON companies;
CREATE POLICY "company_admins_update" ON companies FOR UPDATE
  USING (EXISTS (SELECT 1 FROM company_members cm WHERE cm.company_id = companies.id AND cm.user_id = (select auth.uid()) AND cm.role = ANY (ARRAY['owner'::company_role, 'admin'::company_role]) AND cm.status = 'active'));

DROP POLICY IF EXISTS "company_members_read" ON companies;
CREATE POLICY "company_members_read" ON companies FOR SELECT
  USING (EXISTS (SELECT 1 FROM company_members cm WHERE cm.company_id = companies.id AND cm.user_id = (select auth.uid()) AND cm.status = 'active'));

DROP POLICY IF EXISTS "service_role_insert_company" ON companies;
CREATE POLICY "service_role_insert_company" ON companies FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

-- ── company_invitations ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_read_invitations" ON company_invitations;
CREATE POLICY "admin_read_invitations" ON company_invitations FOR SELECT
  USING (EXISTS (SELECT 1 FROM company_members cm WHERE cm.company_id = company_invitations.company_id AND cm.user_id = (select auth.uid()) AND cm.role = ANY (ARRAY['owner'::company_role, 'admin'::company_role]) AND cm.status = 'active'));

DROP POLICY IF EXISTS "service_role_write_invitations" ON company_invitations;
CREATE POLICY "service_role_write_invitations" ON company_invitations FOR ALL
  USING ((select auth.role()) = 'service_role');

-- ── company_members ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "members_read_own" ON company_members;
CREATE POLICY "members_read_own" ON company_members FOR SELECT
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "service_role_write_members" ON company_members;
CREATE POLICY "service_role_write_members" ON company_members FOR ALL
  USING ((select auth.role()) = 'service_role');

-- ── connections ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can delete own connections" ON connections;
CREATE POLICY "Users can delete own connections" ON connections FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own connections" ON connections;
CREATE POLICY "Users can insert own connections" ON connections FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own connections" ON connections;
CREATE POLICY "Users can read own connections" ON connections FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own connections" ON connections;
CREATE POLICY "Users can update own connections" ON connections FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- ── context_learning_events ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own learning events" ON context_learning_events;
CREATE POLICY "Users can insert own learning events" ON context_learning_events FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own learning events" ON context_learning_events;
CREATE POLICY "Users can read own learning events" ON context_learning_events FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ── context_profiles ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can delete own context profiles" ON context_profiles;
CREATE POLICY "Users can delete own context profiles" ON context_profiles FOR DELETE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own context profiles" ON context_profiles;
CREATE POLICY "Users can insert own context profiles" ON context_profiles FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own context profiles" ON context_profiles;
CREATE POLICY "Users can read own context profiles" ON context_profiles FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own context profiles" ON context_profiles;
CREATE POLICY "Users can update own context profiles" ON context_profiles FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- ── custom_agents ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "custom_agents_owner_all" ON custom_agents;
DROP POLICY IF EXISTS "custom_agents_company_read" ON custom_agents;
-- Merge SELECT into one policy to eliminate multiple permissive warning
CREATE POLICY "custom_agents_select" ON custom_agents FOR SELECT
  USING (user_id = (select auth.uid())
    OR (sharing_mode IS NOT NULL AND company_id IN (
      SELECT company_members.company_id FROM company_members
      WHERE company_members.user_id = (select auth.uid()) AND company_members.status = 'active'
    )));
CREATE POLICY "custom_agents_owner_write" ON custom_agents FOR INSERT
  WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "custom_agents_owner_update" ON custom_agents FOR UPDATE
  USING (user_id = (select auth.uid()));
CREATE POLICY "custom_agents_owner_delete" ON custom_agents FOR DELETE
  USING (user_id = (select auth.uid()));

-- ── drive_folders ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_own_folders" ON drive_folders;
CREATE POLICY "users_own_folders" ON drive_folders FOR ALL
  USING (user_id = (select auth.uid()));

-- ── emails ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own emails" ON emails;
CREATE POLICY "Users can insert own emails" ON emails FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own emails" ON emails;
CREATE POLICY "Users can read own emails" ON emails FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ── inbox_items ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own inbox" ON inbox_items;
CREATE POLICY "Users can insert own inbox" ON inbox_items FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own inbox" ON inbox_items;
CREATE POLICY "Users can read own inbox" ON inbox_items FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own inbox" ON inbox_items;
CREATE POLICY "Users can update own inbox" ON inbox_items FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- ── knowledge_chunks ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own knowledge_chunks" ON knowledge_chunks;
CREATE POLICY "Users manage own knowledge_chunks" ON knowledge_chunks FOR ALL
  USING ((select auth.uid()) = user_id);

-- ── knowledge_files ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own knowledge_files" ON knowledge_files;
CREATE POLICY "Users manage own knowledge_files" ON knowledge_files FOR ALL
  USING ((select auth.uid()) = user_id);

-- ── knowledge_sources ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users manage own knowledge_sources" ON knowledge_sources;
CREATE POLICY "Users manage own knowledge_sources" ON knowledge_sources FOR ALL
  USING ((select auth.uid()) = user_id);

-- ── learning_signals ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert their own learning signals" ON learning_signals;
CREATE POLICY "Users can insert their own learning signals" ON learning_signals FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own learning signals" ON learning_signals;
CREATE POLICY "Users can view their own learning signals" ON learning_signals FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ── mcp_connections ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mcp_connections_owner" ON mcp_connections;
CREATE POLICY "mcp_connections_owner" ON mcp_connections FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── meeting_folders ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users own their meeting folders" ON meeting_folders;
CREATE POLICY "Users own their meeting folders" ON meeting_folders FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── meeting_transcripts ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert their own transcripts" ON meeting_transcripts;
CREATE POLICY "Users can insert their own transcripts" ON meeting_transcripts FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own transcripts" ON meeting_transcripts;
CREATE POLICY "Users can update their own transcripts" ON meeting_transcripts FOR UPDATE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own transcripts" ON meeting_transcripts;
CREATE POLICY "Users can view their own transcripts" ON meeting_transcripts FOR SELECT
  USING ((select auth.uid()) = user_id);

-- ── profiles ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT
  WITH CHECK ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile" ON profiles FOR SELECT
  USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- ── relationship_graph ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own relationships" ON relationship_graph;
CREATE POLICY "Users can insert own relationships" ON relationship_graph FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own relationships" ON relationship_graph;
CREATE POLICY "Users can read own relationships" ON relationship_graph FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own relationships" ON relationship_graph;
CREATE POLICY "Users can update own relationships" ON relationship_graph FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- ── saved_workflows ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_own_saved_workflows" ON saved_workflows;
CREATE POLICY "users_own_saved_workflows" ON saved_workflows FOR ALL
  USING ((select auth.uid()) = user_id);

-- ── shared_note_receipts ──────────────────────────────────────────────────────
-- Merge two ALL policies into one to eliminate multiple permissive warning
DROP POLICY IF EXISTS "shared_note_receipts_recipient" ON shared_note_receipts;
DROP POLICY IF EXISTS "shared_note_receipts_meeting_owner" ON shared_note_receipts;
CREATE POLICY "shared_note_receipts_access" ON shared_note_receipts FOR ALL
  USING (
    (select auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM meeting_transcripts
      WHERE meeting_transcripts.id = shared_note_receipts.transcript_id
        AND meeting_transcripts.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM meeting_transcripts
      WHERE meeting_transcripts.id = shared_note_receipts.transcript_id
        AND meeting_transcripts.user_id = (select auth.uid())
    )
  );

-- ── tenant_configs ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role manages tenant_configs" ON tenant_configs;
DROP POLICY IF EXISTS "Users read own tenant_config" ON tenant_configs;
-- Merge SELECT to eliminate multiple permissive warning
CREATE POLICY "tenant_configs_select" ON tenant_configs FOR SELECT
  USING ((select auth.uid()) = user_id OR (select auth.role()) = 'service_role');
CREATE POLICY "tenant_configs_service_write" ON tenant_configs FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');
CREATE POLICY "tenant_configs_service_update" ON tenant_configs FOR UPDATE
  USING ((select auth.role()) = 'service_role');
CREATE POLICY "tenant_configs_service_delete" ON tenant_configs FOR DELETE
  USING ((select auth.role()) = 'service_role');

-- ── user_context_profiles ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert own context" ON user_context_profiles;
CREATE POLICY "Users can insert own context" ON user_context_profiles FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own context" ON user_context_profiles;
CREATE POLICY "Users can read own context" ON user_context_profiles FOR SELECT
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own context" ON user_context_profiles;
CREATE POLICY "Users can update own context" ON user_context_profiles FOR UPDATE
  USING ((select auth.uid()) = user_id);

-- ── work_messages ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert messages to own threads" ON work_messages;
CREATE POLICY "Users can insert messages to own threads" ON work_messages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM work_threads WHERE work_threads.id = work_messages.thread_id AND work_threads.user_id = (select auth.uid())));

DROP POLICY IF EXISTS "Users can view messages from own threads" ON work_messages;
CREATE POLICY "Users can view messages from own threads" ON work_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM work_threads WHERE work_threads.id = work_messages.thread_id AND work_threads.user_id = (select auth.uid())));

-- ── work_threads ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can manage own work threads" ON work_threads;
CREATE POLICY "Users can manage own work threads" ON work_threads FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── workflow_notifications ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "workflow_notifications_owner_read" ON workflow_notifications;
CREATE POLICY "workflow_notifications_owner_read" ON workflow_notifications FOR SELECT
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "workflow_notifications_owner_update" ON workflow_notifications;
CREATE POLICY "workflow_notifications_owner_update" ON workflow_notifications FOR UPDATE
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ── workflow_runs ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "workflow_runs_owner_insert" ON workflow_runs;
CREATE POLICY "workflow_runs_owner_insert" ON workflow_runs FOR INSERT
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "workflow_runs_owner_read" ON workflow_runs;
CREATE POLICY "workflow_runs_owner_read" ON workflow_runs FOR SELECT
  USING (user_id = (select auth.uid()));

-- ── workflows ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "workflows_owner_all" ON workflows;
DROP POLICY IF EXISTS "workflows_company_read" ON workflows;
-- Merge SELECT to eliminate multiple permissive warning
CREATE POLICY "workflows_select" ON workflows FOR SELECT
  USING (user_id = (select auth.uid())
    OR (sharing_mode IS NOT NULL AND company_id IN (
      SELECT company_members.company_id FROM company_members
      WHERE company_members.user_id = (select auth.uid()) AND company_members.status = 'active'
    )));
CREATE POLICY "workflows_owner_write" ON workflows FOR INSERT
  WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "workflows_owner_update" ON workflows FOR UPDATE
  USING (user_id = (select auth.uid()));
CREATE POLICY "workflows_owner_delete" ON workflows FOR DELETE
  USING (user_id = (select auth.uid()));
