-- ================================================
-- Agent Dashboard RPC Function
-- 一次数据库调用返回所有 Dashboard 所需数据
-- ================================================

-- 删除旧版本（如果存在）
DROP FUNCTION IF EXISTS get_agent_dashboard(UUID, INT);

CREATE OR REPLACE FUNCTION get_agent_dashboard(
  p_user_id UUID,
  p_hours INT DEFAULT 24
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  time_start TIMESTAMPTZ := NOW() - (p_hours || ' hours')::INTERVAL;
BEGIN
  SELECT json_build_object(
    -- ========== 总计统计 ==========
    -- 注意：agents 表已移除 user_id 列，现在通过 project.user_id 关联
    'totalAgents', (
      SELECT COUNT(*) FROM agents a
      JOIN project p ON p.id = a.project_id
      WHERE p.user_id = p_user_id
    ),
    'totalSessions', (
      SELECT COUNT(*) FROM chat_sessions 
      WHERE user_id = p_user_id 
        AND agent_id IN (
          SELECT a.id FROM agents a
          JOIN project p ON p.id = a.project_id
          WHERE p.user_id = p_user_id
        )
    ),
    'totalBash', (
      SELECT COUNT(*) FROM agent_logs 
      WHERE user_id = p_user_id AND call_type = 'bash'
    ),
    'totalTools', (
      SELECT COUNT(*) FROM agent_logs 
      WHERE user_id = p_user_id AND call_type = 'tool'
    ),
    'totalMessages', (
      SELECT COUNT(*) FROM chat_messages WHERE user_id = p_user_id
    ),
    
    -- ========== 活跃 Agent 数（有 session 的） ==========
    'activeAgents', (
      SELECT COUNT(DISTINCT agent_id) 
      FROM chat_sessions 
      WHERE user_id = p_user_id 
        AND agent_id IN (
          SELECT a.id FROM agents a
          JOIN project p ON p.id = a.project_id
          WHERE p.user_id = p_user_id
        )
    ),
    
    -- ========== 时间范围内统计 ==========
    'bashInRange', (
      SELECT COUNT(*) FROM agent_logs 
      WHERE user_id = p_user_id AND call_type = 'bash' AND created_at >= time_start
    ),
    'toolsInRange', (
      SELECT COUNT(*) FROM agent_logs 
      WHERE user_id = p_user_id AND call_type = 'tool' AND created_at >= time_start
    ),
    'messagesInRange', (
      SELECT COUNT(*) FROM chat_messages 
      WHERE user_id = p_user_id AND created_at >= time_start
    ),
    'sessionsInRange', (
      SELECT COUNT(*) FROM chat_sessions 
      WHERE user_id = p_user_id 
        AND agent_id IN (
          SELECT a.id FROM agents a
          JOIN project p ON p.id = a.project_id
          WHERE p.user_id = p_user_id
        )
        AND created_at >= time_start
    ),
    
    -- ========== 按小时聚合：Bash ==========
    'bashPerHour', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT 
          date_trunc('hour', created_at) AS bucket,
          COUNT(*) AS count
        FROM agent_logs 
        WHERE user_id = p_user_id 
          AND call_type = 'bash'
          AND created_at >= time_start
        GROUP BY bucket
        ORDER BY bucket
      ) t
    ),
    
    -- ========== 按小时聚合：Tools ==========
    'toolsPerHour', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT 
          date_trunc('hour', created_at) AS bucket,
          COUNT(*) AS count
        FROM agent_logs 
        WHERE user_id = p_user_id 
          AND call_type = 'tool'
          AND created_at >= time_start
        GROUP BY bucket
        ORDER BY bucket
      ) t
    ),
    
    -- ========== 按小时聚合：Messages ==========
    'messagesPerHour', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT 
          date_trunc('hour', created_at) AS bucket,
          COUNT(*) AS count
        FROM chat_messages 
        WHERE user_id = p_user_id 
          AND created_at >= time_start
        GROUP BY bucket
        ORDER BY bucket
      ) t
    ),
    
    -- ========== 按小时聚合：Sessions ==========
    'sessionsPerHour', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT 
          date_trunc('hour', created_at) AS bucket,
          COUNT(*) AS count
        FROM chat_sessions 
        WHERE user_id = p_user_id 
          AND agent_id IN (
            SELECT a.id FROM agents a
            JOIN project p ON p.id = a.project_id
            WHERE p.user_id = p_user_id
          )
          AND created_at >= time_start
        GROUP BY bucket
        ORDER BY bucket
      ) t
    ),
    
    -- ========== Agent 列表（带统计） ==========
    'agents', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT 
          a.id,
          a.name,
          a.icon,
          a.type AS agent_type,
          a.created_at,
          (SELECT COUNT(*) FROM chat_sessions cs WHERE cs.agent_id = a.id) AS chat_count,
          (SELECT MAX(cs.updated_at) FROM chat_sessions cs WHERE cs.agent_id = a.id) AS last_active,
          (SELECT COUNT(*) FROM agent_logs al WHERE al.agent_id = a.id AND al.call_type = 'bash') AS bash_count,
          -- 计算 data access 数量
          COALESCE(jsonb_array_length(a.bash_accesses), 0) + COALESCE(jsonb_array_length(a.accesses), 0) AS data_access_count
        FROM agents a
        JOIN project p ON p.id = a.project_id
        WHERE p.user_id = p_user_id
        ORDER BY a.created_at DESC
      ) t
    )
    
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 授予执行权限
GRANT EXECUTE ON FUNCTION get_agent_dashboard(UUID, INT) TO authenticated;

-- ================================================
-- 使用示例（在 Supabase SQL Editor 中测试）：
-- SELECT get_agent_dashboard('your-user-uuid-here', 24);
-- ================================================

