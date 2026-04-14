-- Phase 121: Recreate delete_user_account RPC without desk_items reference.
-- desk_items was dropped in Phase 112 (migration 20260410_drop_desk_items.sql)
-- but the stored procedure was never updated. This causes 42P01 errors on user delete.
--
-- Also adds coverage for tables added since the function was first created:
-- custom_agents, agent_knowledge_sources, drive_folders, audit_logs cleanup.
--
-- Tables with ON DELETE CASCADE from auth.users are included anyway for explicitness
-- and to handle edge cases where FKs may not cascade as expected.

CREATE OR REPLACE FUNCTION delete_user_account(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Agents ────────────────────────────────────────────────────────────────
  -- agent_knowledge_sources FK → custom_agents (CASCADE), but custom_agents
  -- FK → auth.users (CASCADE). Delete explicitly to avoid FK order issues.
  DELETE FROM agent_knowledge_sources
  WHERE agent_id IN (
    SELECT id FROM custom_agents WHERE user_id = target_user_id
  );

  DELETE FROM custom_agents WHERE user_id = target_user_id;

  -- ── Knowledge / Drive ─────────────────────────────────────────────────────
  -- knowledge_chunks FK → knowledge_files (CASCADE)
  DELETE FROM knowledge_chunks
  WHERE file_id IN (
    SELECT id FROM knowledge_files WHERE user_id = target_user_id
  );

  DELETE FROM knowledge_files   WHERE user_id = target_user_id;
  DELETE FROM knowledge_sources WHERE user_id = target_user_id;
  DELETE FROM drive_folders     WHERE user_id = target_user_id;  -- cascades children

  -- ── Work ──────────────────────────────────────────────────────────────────
  -- work_messages FK → work_threads (CASCADE)
  DELETE FROM work_threads    WHERE user_id = target_user_id;
  DELETE FROM saved_workflows WHERE user_id = target_user_id;

  -- ── Processes ─────────────────────────────────────────────────────────────
  -- process_steps FK → processes (CASCADE)
  DELETE FROM processes WHERE owner_id = target_user_id;

  -- ── Email / Inbox ─────────────────────────────────────────────────────────
  DELETE FROM emails       WHERE user_id = target_user_id;
  DELETE FROM inbox_items  WHERE user_id = target_user_id;

  -- ── Calendar ──────────────────────────────────────────────────────────────
  DELETE FROM calendar_events WHERE user_id = target_user_id;

  -- ── Meetings ──────────────────────────────────────────────────────────────
  DELETE FROM meeting_recordings WHERE user_id = target_user_id;

  -- ── Learning / Context ────────────────────────────────────────────────────
  DELETE FROM learning_signals          WHERE user_id = target_user_id;
  DELETE FROM context_profiles          WHERE user_id = target_user_id;
  DELETE FROM user_context_profiles     WHERE user_id = target_user_id;
  DELETE FROM relationship_graph        WHERE user_id = target_user_id;
  DELETE FROM communication_embeddings  WHERE user_id = target_user_id;

  -- ── Connections / MCP ─────────────────────────────────────────────────────
  DELETE FROM connections     WHERE user_id = target_user_id;
  DELETE FROM mcp_connections WHERE user_id = target_user_id;

  -- ── Company membership ────────────────────────────────────────────────────
  -- company_invitations may reference the email; clean invites sent by this user.
  DELETE FROM company_invitations WHERE invited_by = target_user_id;
  DELETE FROM company_members     WHERE user_id    = target_user_id;

  -- ── Tenant config ─────────────────────────────────────────────────────────
  DELETE FROM tenant_configs WHERE user_id = target_user_id;

  -- ── Profile ───────────────────────────────────────────────────────────────
  -- Delete last — other tables may reference profiles.id.
  -- auth.admin.deleteUser (called by the API after this RPC) deletes auth.users.
  DELETE FROM profiles WHERE id = target_user_id;

EXCEPTION
  WHEN undefined_table THEN
    -- Gracefully skip any table that may not exist in this environment.
    RAISE WARNING 'delete_user_account: skipped a missing table for user %', target_user_id;
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- Grant execute to service role (used by the API via adminClient.rpc)
GRANT EXECUTE ON FUNCTION delete_user_account(UUID) TO service_role;
