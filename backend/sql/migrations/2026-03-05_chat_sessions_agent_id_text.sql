-- ============================================================
-- Migration: chat_sessions.agent_id UUID → TEXT
-- Date: 2026-03-05
--
-- Align chat_sessions.agent_id type with connections.id (TEXT).
-- Drop old RLS policies (frontend no longer reads directly).
-- ============================================================

-- 1. Change agent_id from UUID to TEXT
ALTER TABLE chat_sessions ALTER COLUMN agent_id TYPE TEXT USING agent_id::TEXT;

-- 2. Change id from UUID to TEXT (consistent with other tables)
ALTER TABLE chat_sessions ALTER COLUMN id TYPE TEXT USING id::TEXT;
ALTER TABLE chat_messages ALTER COLUMN id TYPE TEXT USING id::TEXT;
ALTER TABLE chat_messages ALTER COLUMN session_id TYPE TEXT USING session_id::TEXT;

-- 3. Drop RLS policies (all access now goes through backend service_role)
DROP POLICY IF EXISTS chat_sessions_user_policy ON chat_sessions;
DROP POLICY IF EXISTS chat_messages_user_policy ON chat_messages;

-- Keep RLS enabled but add a service_role bypass policy
-- so the backend (using service_role key) can access everything
CREATE POLICY chat_sessions_service_role ON chat_sessions
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY chat_messages_service_role ON chat_messages
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);
