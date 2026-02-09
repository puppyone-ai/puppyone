-- Chat Sessions & Messages
-- 用于保存 ChatSidebar 的对话历史

-- 会话表（按 agent 分开存储）
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  agent_id UUID,                 -- 关联的 Agent（可为空表示 playground 模式）
  
  title TEXT,                    -- 会话标题（自动从第一条消息生成）
  mode TEXT DEFAULT 'agent',     -- 'agent' | 'ask'
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 消息表
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT,                  -- 纯文本内容（方便搜索/复制）
  parts JSONB,                   -- 结构化内容（tool 调用记录等）
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent ON chat_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_agent ON chat_sessions(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- 自动更新 updated_at 的触发器
CREATE OR REPLACE FUNCTION update_chat_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER trigger_chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_sessions_updated_at();

-- 当有新消息时，更新 session 的 updated_at
CREATE OR REPLACE FUNCTION update_session_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_session_on_message ON chat_messages;
CREATE TRIGGER trigger_update_session_on_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_session_on_message();

-- RLS 策略（Row Level Security）
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的会话
DROP POLICY IF EXISTS chat_sessions_user_policy ON chat_sessions;
CREATE POLICY chat_sessions_user_policy ON chat_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 用户只能访问自己会话中的消息
DROP POLICY IF EXISTS chat_messages_user_policy ON chat_messages;
CREATE POLICY chat_messages_user_policy ON chat_messages
  FOR ALL
  USING (session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid()));

