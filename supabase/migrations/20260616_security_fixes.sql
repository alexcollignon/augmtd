-- Security fixes flagged by Supabase advisor.
-- Apply in Supabase dashboard SQL editor.

-- ── 1. Enable RLS on tables that were missing it ─────────────────────────────

ALTER TABLE mcp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mcp_connections_owner" ON mcp_connections
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE shared_note_receipts ENABLE ROW LEVEL SECURITY;
-- Recipients can read their own receipts + update folder assignment
CREATE POLICY "shared_note_receipts_recipient" ON shared_note_receipts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- Meeting owners can insert/delete receipts for their own meetings
CREATE POLICY "shared_note_receipts_meeting_owner" ON shared_note_receipts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM meeting_transcripts
      WHERE meeting_transcripts.id = shared_note_receipts.transcript_id
        AND meeting_transcripts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meeting_transcripts
      WHERE meeting_transcripts.id = shared_note_receipts.transcript_id
        AND meeting_transcripts.user_id = auth.uid()
    )
  );

-- ── 2. Revoke PUBLIC execute from SECURITY DEFINER functions ──────────────────
-- Unauthenticated callers should never be able to call these.

REVOKE EXECUTE ON FUNCTION delete_user_account(uuid)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_user_storage_objects(uuid)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION handle_new_user()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_company_admin(uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_company_member(uuid)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_super_admin(uuid)            FROM PUBLIC;

-- Grant back to authenticated users only
GRANT EXECUTE ON FUNCTION delete_user_account(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_storage_objects(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION is_company_admin(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION is_company_member(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION is_super_admin(uuid)            TO authenticated;
-- handle_new_user is called by trigger only — no user grant needed

-- ── 3. Fix mutable search_path on functions ───────────────────────────────────
-- Prevents search_path injection. SET search_path pins the function to public.

ALTER FUNCTION is_company_admin(uuid)                     SET search_path = public;
ALTER FUNCTION is_company_member(uuid)                    SET search_path = public;
ALTER FUNCTION is_super_admin(uuid)                       SET search_path = public;
ALTER FUNCTION update_custom_agents_updated_at()          SET search_path = public;
ALTER FUNCTION update_inbox_items_updated_at()            SET search_path = public;
ALTER FUNCTION calculate_meeting_status(timestamptz, timestamptz, text) SET search_path = public;
ALTER FUNCTION update_meeting_statuses()                  SET search_path = public;
ALTER FUNCTION auto_calculate_meeting_status()            SET search_path = public;
ALTER FUNCTION mark_completed_meetings_for_hide()         SET search_path = public;
ALTER FUNCTION generate_join_code()                       SET search_path = public;
ALTER FUNCTION calculate_visual_section(text, numeric, numeric, numeric) SET search_path = public;
ALTER FUNCTION update_visual_section()                    SET search_path = public;
ALTER FUNCTION get_user_storage_objects(uuid)             SET search_path = public;
ALTER FUNCTION update_calendar_events_updated_at()        SET search_path = public;
ALTER FUNCTION calculate_statistical_confidence(integer, integer) SET search_path = public;
ALTER FUNCTION encode_signal_pattern(text[])              SET search_path = public;
ALTER FUNCTION get_user_action_rate(uuid, text, integer)  SET search_path = public;
ALTER FUNCTION extract_identity_profile(uuid)             SET search_path = public;
ALTER FUNCTION extract_email_communication_profile(uuid)  SET search_path = public;
ALTER FUNCTION extract_domain_knowledge_profile(uuid)     SET search_path = public;
ALTER FUNCTION update_context_profiles_last_updated()     SET search_path = public;
ALTER FUNCTION update_updated_at()                        SET search_path = public;
ALTER FUNCTION update_updated_at_column()                 SET search_path = public;
ALTER FUNCTION delete_user_account(uuid)                  SET search_path = public;
ALTER FUNCTION handle_new_user()                          SET search_path = public;
