-- Audit Logs Table
-- L2 Collaboration 审计日志，持久化记录所有协同操作
-- checkout / commit / rollback / conflict 事件

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,

    -- 时间
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 操作类型: checkout | commit | rollback | conflict
    action TEXT NOT NULL,

    -- 目标节点
    node_id UUID NOT NULL,

    -- 版本信息
    old_version INT,
    new_version INT,

    -- 操作者
    operator_type TEXT NOT NULL DEFAULT 'user',  -- user | agent | system | sync
    operator_id TEXT,

    -- commit 专用字段
    status TEXT,       -- clean | merged | lww
    strategy TEXT,     -- direct | json_key_merge | text_line_merge | lww

    -- conflict 专用字段
    conflict_details TEXT,

    -- 其他元数据
    metadata JSONB
);

-- 按时间倒序查询（最常用）
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs (created_at DESC);

-- 按节点查询审计历史
CREATE INDEX IF NOT EXISTS idx_audit_logs_node_id
    ON audit_logs (node_id, created_at DESC);

-- 按操作者查询
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator
    ON audit_logs (operator_type, operator_id, created_at DESC);

-- 按操作类型筛选
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
    ON audit_logs (action, created_at DESC);
