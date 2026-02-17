-- ============================================================
-- PuppyOne / ContextBase — 版本管理系统
-- 
-- 目标：为 OverlayFS + 多 Agent 协同架构打地基
-- 
-- 改动清单：
--   1. ALTER content_nodes — 加版本管理字段
--   2. ALTER agent_bash    — 细粒度权限 (readonly → permission)
--   3. CREATE file_versions     — 文件级版本历史
--   4. CREATE folder_snapshots  — 文件夹级快照（原子操作组）
--   5. 数据迁移 — 现有数据初始化为 v1
--   6. 索引、RLS、触发器
--
-- 设计原则：
--   - 文件级版本：每个文件独立版本线，存完整快照（非 delta）
--   - 文件夹级快照：记录某一时刻所有子文件的版本号组合
--   - 类似 Git 模型：file_versions ≈ blob, folder_snapshots ≈ commit
--   - 乐观锁：通过 current_version 防止并发覆盖
--   - content_hash 去重：相同内容不重复存储 S3
-- ============================================================

-- ============================================================
-- PART 1: ALTER content_nodes — 加版本管理字段
-- ============================================================

-- 当前版本号（乐观锁核心字段）
-- 每次合法修改 +1，写入时检查版本号是否匹配
ALTER TABLE content_nodes 
    ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 0;

-- 内容哈希（SHA-256）
-- 用途：1) 快速判断内容是否变化  2) S3 文件去重
ALTER TABLE content_nodes 
    ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- ============================================================
-- PART 2: ALTER agent_bash — 细粒度权限
-- ============================================================

-- 旧字段：readonly BOOLEAN (只有 true/false)
-- 新字段：permission TEXT (支持 4 级权限)
--
-- 权限级别：
--   'r'   — 只读（Read）
--   'ra'  — 只读+追加（Read + Append，可新建文件但不可改/删已有）
--   'rw-' — 读写受限（Read + Write，可读写但不可删除）
--   'rw'  — 完全读写（Read + Write + Delete）

ALTER TABLE agent_bash 
    ADD COLUMN IF NOT EXISTS permission TEXT NOT NULL DEFAULT 'r';

-- 数据迁移：readonly=true → 'r', readonly=false → 'rw'
UPDATE agent_bash SET permission = CASE 
    WHEN readonly = TRUE THEN 'r' 
    ELSE 'rw' 
END;

-- 加 CHECK 约束确保只有合法值
ALTER TABLE agent_bash 
    ADD CONSTRAINT chk_agent_bash_permission 
    CHECK (permission IN ('r', 'ra', 'rw-', 'rw'));

-- 之后可以删掉旧字段（先保留，等应用层改完再删）
-- ALTER TABLE agent_bash DROP COLUMN IF EXISTS readonly;

-- ============================================================
-- PART 3: CREATE file_versions — 文件级版本历史
-- ============================================================
-- 
-- 每个版本存完整快照（不是 delta），理由：
--   1. 回滚快：直接取历史版本，不需要从基线重放 delta
--   2. 三方合并直接用：Merge Daemon 需要 Base/A/B 三个完整版本
--   3. 实现简单：无 delta 链断裂风险
--   4. 成本可控：JSON/MD 通常 KB 级，大文件走 S3（PG 只存 key）
--
-- 内容字段（三选一，根据文件类型）：
--   content_json — JSON 文件：完整 JSONB 快照
--   content_text — Markdown/文本：完整文本快照
--   s3_key       — 大文件/二进制：S3 版本路径
--                  格式: versions/{node_id}/v{version}/{filename}
--                  S3 对象不可变，回滚只需指回旧 key

CREATE TABLE IF NOT EXISTS file_versions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    
    -- 关联
    node_id         TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    version         INT NOT NULL,
    
    -- 内容快照（三选一）
    content_json    JSONB,              -- JSON 文件
    content_text    TEXT,               -- Markdown/文本文件
    s3_key          TEXT,               -- 大文件/二进制（S3 版本路径）
    
    -- 元数据
    content_hash    TEXT NOT NULL,      -- SHA-256，用于去重和变更检测
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    
    -- 关联到文件夹快照（同一次操作的多个文件改动共享同一个 snapshot_id）
    snapshot_id     BIGINT,             -- → folder_snapshots(id)，延迟加 FK
    
    -- 操作者信息
    operator_type   TEXT NOT NULL,      -- 'user' / 'agent' / 'system' / 'sync'
    operator_id     TEXT,               -- user_id 或 agent_id
    session_id      TEXT,               -- 聊天会话 ID（agent 改动时关联）
    
    -- 操作类型
    operation       TEXT NOT NULL,      -- 'create' / 'update' / 'delete' / 'rollback' / 'merge'
    merge_strategy  TEXT,               -- 合并时使用的算法: 'diff3' / 'lww' / 'crdt' / 'manual'
    summary         TEXT,               -- 改动摘要（可选，可由 AI 生成）
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 唯一约束：同一文件的版本号不能重复
    UNIQUE(node_id, version)
);

-- 查询某个文件的版本历史
CREATE INDEX idx_file_versions_node_id ON file_versions(node_id);
-- 按时间查询（全局审计）
CREATE INDEX idx_file_versions_created_at ON file_versions(created_at);
-- 按 snapshot 查询（找出同一次操作的所有文件改动）
CREATE INDEX idx_file_versions_snapshot_id ON file_versions(snapshot_id);
-- 按 content_hash 查询（去重：同一文件相同内容复用 S3 对象）
CREATE INDEX idx_file_versions_content_hash ON file_versions(node_id, content_hash);
-- 按操作者查询（某个 Agent 改了什么）
CREATE INDEX idx_file_versions_operator ON file_versions(operator_type, operator_id);

-- 操作类型约束
ALTER TABLE file_versions 
    ADD CONSTRAINT chk_file_versions_operation 
    CHECK (operation IN ('create', 'update', 'delete', 'rollback', 'merge'));

ALTER TABLE file_versions 
    ADD CONSTRAINT chk_file_versions_operator_type 
    CHECK (operator_type IN ('user', 'agent', 'system', 'sync'));

-- ============================================================
-- PART 4: CREATE folder_snapshots — 文件夹级快照
-- ============================================================
--
-- 用途：
--   1. 记录某一时刻文件夹内所有文件的版本号组合
--   2. 支持文件夹级回滚（一步回滚整个工作区）
--   3. 关联"同一次操作"的多个文件改动（原子操作组）
--   4. 为 Merge Daemon 提供 Base 快照（三方合并的基准）
--
-- file_versions_map 格式：
--   {"node_id_1": 3, "node_id_2": 1, "node_id_3": 5}
--   含义：快照时刻，文件1是v3，文件2是v1，文件3是v5

CREATE TABLE IF NOT EXISTS folder_snapshots (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    
    -- 关联到文件夹节点
    folder_node_id  TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
    
    -- 快照内容：{node_id: version_number, ...}
    file_versions_map   JSONB NOT NULL,
    
    -- 文件变更摘要（快速查看这次快照改了什么）
    changed_files       JSONB,          -- ["node_id_1", "node_id_3"]（本次改动的文件列表）
    files_count         INT NOT NULL DEFAULT 0,     -- 快照中总文件数
    changed_count       INT NOT NULL DEFAULT 0,     -- 本次改动文件数
    
    -- 操作者信息
    operator_type   TEXT NOT NULL,      -- 'user' / 'agent' / 'system' / 'sync'
    operator_id     TEXT,               -- user_id 或 agent_id
    session_id      TEXT,               -- 聊天会话 ID
    
    -- 操作类型
    operation       TEXT NOT NULL,      -- 'agent_merge' / 'user_save' / 'rollback' / 'sync' / 'import'
    summary         TEXT,               -- "Agent A modified 3 files: a.json, b.md, c.pdf"

    -- 用于 OverlayFS Merge Daemon
    -- base_snapshot_id 记录"这次 Agent 操作基于哪个快照"
    -- 三方合并时：Base = base_snapshot, Ours = 当前最新, Theirs = Agent 的改动
    base_snapshot_id    BIGINT REFERENCES folder_snapshots(id) ON DELETE SET NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 查询某个文件夹的快照历史
CREATE INDEX idx_folder_snapshots_folder ON folder_snapshots(folder_node_id);
-- 按时间查询
CREATE INDEX idx_folder_snapshots_created_at ON folder_snapshots(created_at);
-- 按操作者查询
CREATE INDEX idx_folder_snapshots_operator ON folder_snapshots(operator_type, operator_id);

-- 现在可以安全加 FK（file_versions.snapshot_id → folder_snapshots.id）
ALTER TABLE file_versions 
    ADD CONSTRAINT fk_file_versions_snapshot 
    FOREIGN KEY (snapshot_id) REFERENCES folder_snapshots(id) ON DELETE SET NULL;

-- ============================================================
-- PART 5: 数据迁移 — 现有数据初始化
-- ============================================================

-- 5a. 为所有现有 content_nodes 计算 content_hash
-- （先设为空字符串占位，应用层后续写入时会计算真实 hash）
UPDATE content_nodes 
SET current_version = 1, 
    content_hash = '' 
WHERE current_version = 0;

-- 5b. 为所有现有非空 content_nodes 创建 v1 版本记录
INSERT INTO file_versions (node_id, version, content_json, content_text, s3_key, content_hash, size_bytes, operator_type, operation, summary)
SELECT 
    id,
    1,
    preview_json,
    preview_md,
    s3_key,
    COALESCE(content_hash, ''),
    size_bytes,
    'system',
    'create',
    'Initial version (migrated from existing data)'
FROM content_nodes
WHERE preview_json IS NOT NULL 
   OR preview_md IS NOT NULL 
   OR s3_key IS NOT NULL;

-- ============================================================
-- PART 6: RLS 策略
-- ============================================================

ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_snapshots ENABLE ROW LEVEL SECURITY;

-- service_role 全权访问
CREATE POLICY service_role_all_file_versions 
    ON file_versions FOR ALL TO service_role 
    USING (true) WITH CHECK (true);

CREATE POLICY service_role_all_folder_snapshots 
    ON folder_snapshots FOR ALL TO service_role 
    USING (true) WITH CHECK (true);

-- ============================================================
-- PART 7: 辅助函数
-- ============================================================

-- 获取下一个版本号（原子操作，避免并发冲突）
CREATE OR REPLACE FUNCTION next_version(p_node_id TEXT)
RETURNS INT AS $$
DECLARE
    v INT;
BEGIN
    UPDATE content_nodes 
    SET current_version = current_version + 1,
        updated_at = NOW()
    WHERE id = p_node_id
    RETURNING current_version INTO v;
    
    IF v IS NULL THEN
        RAISE EXCEPTION 'Node % not found', p_node_id;
    END IF;
    
    RETURN v;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 完成！
-- 
-- 新增/修改清单：
--   [ALTER]  content_nodes     + current_version, content_hash
--   [ALTER]  agent_bash        + permission (替代 readonly)
--   [CREATE] file_versions     文件级版本历史
--   [CREATE] folder_snapshots  文件夹级快照
--   [CREATE] next_version()    原子版本号递增函数
--
-- 表关系图：
--
--   content_nodes (1) ←──── (N) file_versions
--        │                        │
--        │                        │ snapshot_id
--        │                        ▼
--        └──────────── (1) ←── folder_snapshots
--                              (folder_node_id)
--                                │
--                                │ base_snapshot_id (自引用)
--                                ▼
--                              folder_snapshots (上一个快照)
--
-- ============================================================
