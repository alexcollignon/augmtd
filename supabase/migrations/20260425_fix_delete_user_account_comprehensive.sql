-- Comprehensive rewrite of delete_user_account RPC.
-- Fixes:
--   1. meeting_recordings → meeting_transcripts (wrong table name in previous version)
--   2. Adds process_notifications, process_comments (were missing)
--   3. Adds workflow_notifications, workflow_runs, workflows (Studio, added Phase 126)
--   4. IF EXISTS guards for tables that may not exist in all environments
--      (relationship_graph, communication_embeddings, user_context_profiles)
--   5. Explicit work_messages delete before work_threads for clarity

CREATE OR REPLACE FUNCTION delete_user_account(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── Agents ───────────────────────────────────────────────────────────────
  DELETE FROM agent_knowledge_sources
    WHERE agent_id IN (SELECT id FROM custom_agents WHERE user_id = target_user_id);
  DELETE FROM custom_agents WHERE user_id = target_user_id;

  -- ── Knowledge / Drive ────────────────────────────────────────────────────
  DELETE FROM knowledge_chunks
    WHERE file_id IN (SELECT id FROM knowledge_files WHERE user_id = target_user_id);
  DELETE FROM knowledge_files   WHERE user_id = target_user_id;
  DELETE FROM knowledge_sources WHERE user_id = target_user_id;
  DELETE FROM drive_folders     WHERE user_id = target_user_id;  -- cascades children

  -- ── Studio Workflows ─────────────────────────────────────────────────────
  DELETE FROM workflow_notifications WHERE user_id = target_user_id;
  DELETE FROM workflow_runs          WHERE user_id = target_user_id;
  DELETE FROM workflows              WHERE user_id = target_user_id;

  -- ── Work ─────────────────────────────────────────────────────────────────
  DELETE FROM work_messages    WHERE thread_id IN (SELECT id FROM work_threads WHERE user_id = target_user_id);
  DELETE FROM work_threads     WHERE user_id = target_user_id;
  DELETE FROM saved_workflows  WHERE user_id = target_user_id;

  -- ── Processes (may not exist in all environments) ────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'process_notifications') THEN
    EXECUTE 'DELETE FROM process_notifications WHERE user_id = $1' USING target_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'process_comments') THEN
    EXECUTE 'DELETE FROM process_comments WHERE process_id IN (SELECT id FROM processes WHERE owner_id = $1)' USING target_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'process_steps') THEN
    EXECUTE 'DELETE FROM process_steps WHERE process_id IN (SELECT id FROM processes WHERE owner_id = $1)' USING target_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'processes') THEN
    EXECUTE 'DELETE FROM processes WHERE owner_id = $1' USING target_user_id;
  END IF;

  -- ── Email / Inbox ────────────────────────────────────────────────────────
  DELETE FROM emails      WHERE user_id = target_user_id;
  DELETE FROM inbox_items WHERE user_id = target_user_id;

  -- ── Calendar ─────────────────────────────────────────────────────────────
  DELETE FROM calendar_events WHERE user_id = target_user_id;

  -- ── Meetings ─────────────────────────────────────────────────────────────
  DELETE FROM meeting_transcripts WHERE user_id = target_user_id;

  -- ── Learning / Context ───────────────────────────────────────────────────
  DELETE FROM learning_signals  WHERE user_id = target_user_id;
  DELETE FROM context_profiles  WHERE user_id = target_user_id;

  -- Tables that may not exist in all environments
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_context_profiles') THEN
    EXECUTE 'DELETE FROM user_context_profiles WHERE user_id = $1' USING target_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'relationship_graph') THEN
    EXECUTE 'DELETE FROM relationship_graph WHERE user_id = $1' USING target_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'communication_embeddings') THEN
    EXECUTE 'DELETE FROM communication_embeddings WHERE user_id = $1' USING target_user_id;
  END IF;

  -- ── Connections / MCP ────────────────────────────────────────────────────
  DELETE FROM connections     WHERE user_id = target_user_id;
  DELETE FROM mcp_connections WHERE user_id = target_user_id;

  -- ── Company membership ───────────────────────────────────────────────────
  DELETE FROM company_invitations WHERE invited_by = target_user_id;
  DELETE FROM company_members     WHERE user_id    = target_user_id;

  -- ── Tenant config ────────────────────────────────────────────────────────
  DELETE FROM tenant_configs WHERE user_id = target_user_id;

  -- ── Profile ──────────────────────────────────────────────────────────────
  -- Last — other tables may reference profiles.id.
  -- auth.admin.deleteUser (called after this RPC) removes the auth.users row.
  DELETE FROM profiles WHERE id = target_user_id;

END;
$$;

GRANT EXECUTE ON FUNCTION delete_user_account(UUID) TO service_role;
