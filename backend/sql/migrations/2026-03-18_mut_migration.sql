-- ============================================================
-- PuppyOne — Mut 内核迁移：数据库变更
--
-- 背景：
--   PuppyOne 从自建版本管理迁移到 Mut 框架。
--   Mut repo (ObjectStore + Merkle tree) 成为内容和树结构的 source of truth。
--   content_nodes 表转变为 read-side index。
--
-- 改动清单：
--   1. CREATE mut_commits          — Mut 版本历史（替代 file_versions 的角色）
--   2. ALTER content_nodes         — 加 mut_path 列（Mut 树路径映射）
--   3. ALTER projects              — 加 Mut 状态列（root_hash + version）
--   4. ALTER audit_logs            — 适配 Mut 审计事件
--
-- 不删除任何现有表或列。旧表 (file_versions, folder_snapshots) 在迁移
-- 过渡期结束后通过单独的 DDL 删除。
--
-- 设计文档: docs/mut-migration-roadmap.md
-- ============================================================


-- ============================================================
-- PART 1: CREATE mut_commits — Mut 版本历史
-- ============================================================
--
-- 与 file_versions 的区别：
--   - per-project 全局版本号（不是 per-node）
--   - 存变更集元数据（不是完整内容快照，内容在 S3 ObjectStore 中）
--   - root_hash 记录 Merkle tree 根哈希（整棵树的完整性校验）
--
-- 类比 Git:
--   mut_commits ≈ git log (commit metadata)
--   ObjectStore (S3) ≈ .git/objects (content-addressable blobs + trees)

CREATE TABLE IF NOT EXISTS mut_commits (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- 关联到项目（一个 project = 一个 Mut repo）
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- 全局递增版本号（每个 project 内唯一）
    version         INT NOT NULL,

    -- Merkle tree root hash（SHA-256，代表整棵树的状态）
    root_hash       TEXT NOT NULL DEFAULT '',

    -- 哪个 scope 发起的变更（空字符串 = 全局）
    scope_path      TEXT NOT NULL DEFAULT '',

    -- 操作者标识: "user:<uuid>" / "agent:<uuid>" / "sync:<provider>" / "system"
    who             TEXT NOT NULL,

    -- commit message
    message         TEXT NOT NULL DEFAULT '',

    -- 变更集: [{"path": "docs/a.md", "op": "added"}, {"path": "data/b.json", "op": "modified"}, ...]
    -- op 值: "added" | "modified" | "deleted"
    changes         JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- 合并冲突记录（如有）
    -- [{"path": "x.json", "strategy": "lww", "detail": "...", "kept": "theirs"}, ...]
    conflicts       JSONB,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 同一 project 内版本号唯一
    UNIQUE(project_id, version)
);

-- 按 project 查版本历史（最常用）
CREATE INDEX IF NOT EXISTS idx_mut_commits_project_version
    ON mut_commits (project_id, version DESC);

-- 按时间查询（全局审计）
CREATE INDEX IF NOT EXISTS idx_mut_commits_created_at
    ON mut_commits (created_at DESC);

-- 按操作者查询
CREATE INDEX IF NOT EXISTS idx_mut_commits_who
    ON mut_commits (who, created_at DESC);

-- RLS
ALTER TABLE mut_commits ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all_mut_commits
    ON mut_commits FOR ALL TO service_role
    USING (true) WITH CHECK (true);


-- ============================================================
-- PART 2: ALTER content_nodes — 加 Mut 路径映射
-- ============================================================
--
-- mut_path: 节点在 Mut 树中的人类可读路径
-- 例: "docs/meeting-notes.md", "data/users.json"
--
-- 用途：
--   1. UUID (content_nodes.id) 与 Mut 路径之间的映射
--   2. Index Sync 时按路径查找对应的 content_nodes 行
--   3. 前端通过 UUID 访问，Mut 通过路径操作，此列是桥梁

ALTER TABLE content_nodes
    ADD COLUMN IF NOT EXISTS mut_path TEXT;

-- 按 project + mut_path 查询（Index Sync 用）
CREATE INDEX IF NOT EXISTS idx_content_nodes_mut_path
    ON content_nodes (project_id, mut_path)
    WHERE mut_path IS NOT NULL;


-- ============================================================
-- PART 3: ALTER projects — 加 Mut 状态列
-- ============================================================
--
-- 每个 project 对应一个 Mut repo，需要记录：
--   mut_root_hash: 当前 Merkle tree 根哈希（整棵树的指纹）
--   mut_version:   当前最新版本号

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS mut_root_hash TEXT DEFAULT '';

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS mut_version INT DEFAULT 0;


-- ============================================================
-- PART 4: ALTER audit_logs — 适配 Mut 审计事件
-- ============================================================
--
-- 变更：
--   1. 加 project_id 列（Mut 审计事件需要 project 维度）
--   2. node_id 改为可空（Mut 有些事件不针对特定 node，如 clone/push/pull）
--
-- 现有数据完全兼容，不做数据迁移。

ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS project_id TEXT;

-- node_id 放宽为可空（原来是 NOT NULL）
-- Mut clone/push/pull 事件是 project 级别的，没有特定 node
ALTER TABLE audit_logs
    ALTER COLUMN node_id DROP NOT NULL;

-- 给 project_id 加索引（按 project 查审计日志）
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id
    ON audit_logs (project_id, created_at DESC)
    WHERE project_id IS NOT NULL;


-- ============================================================
-- 完成！
--
-- 变更总结：
--   [CREATE] mut_commits              — Mut 版本历史
--   [ALTER]  content_nodes            + mut_path
--   [ALTER]  projects                 + mut_root_hash, mut_version
--   [ALTER]  audit_logs               + project_id, node_id DROP NOT NULL
--
-- 未删除任何表或列。
-- 旧表 (file_versions, folder_snapshots) 保留，
-- 待迁移过渡期结束后通过单独的 DDL 删除。
--
-- 存储分布：
--   Mut ObjectStore (blobs + trees) → S3 (prefix: mut/{project_id}/objects/)
--   Mut History                     → mut_commits 表 (PostgreSQL)
--   Mut Audit                      → audit_logs 表 (PostgreSQL, 复用)
--   Mut Scopes                     → connections.config JSONB (复用, 零 DDL)
--   Mut Locks                      → Redis (复用 ARQ 的 Redis 实例)
-- ============================================================
