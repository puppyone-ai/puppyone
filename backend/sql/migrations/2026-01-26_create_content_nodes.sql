-- Content Nodes 表
-- 统一的树形内容存储，支持文件夹、JSON、Markdown 等多种类型

CREATE TABLE IF NOT EXISTS public.content_nodes (
    -- 主键
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    
    -- 所属用户
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- 树形结构
    parent_id TEXT REFERENCES public.content_nodes(id) ON DELETE CASCADE,
    
    -- 基本信息
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('folder', 'json', 'markdown', 'image', 'pdf', 'video', 'file')),
    path TEXT NOT NULL,  -- 物化路径，如 /项目A/文档/readme.md
    
    -- 内容存储（二选一）
    content JSONB,       -- JSON 内容（type='json' 时使用）
    s3_key TEXT,         -- S3 对象 key（非 JSON 时使用）
    
    -- 元信息
    mime_type TEXT,
    size_bytes BIGINT DEFAULT 0,
    
    -- 权限
    permissions JSONB DEFAULT '{"inherit": true}'::jsonb,
    
    -- 时间戳
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_content_nodes_user_id ON public.content_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_parent_id ON public.content_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_path ON public.content_nodes(path);
CREATE INDEX IF NOT EXISTS idx_content_nodes_type ON public.content_nodes(type);

-- 唯一约束：同一父节点下名称不能重复
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_nodes_unique_name 
ON public.content_nodes(user_id, COALESCE(parent_id, ''), name);

-- 更新 updated_at 的触发器
CREATE OR REPLACE FUNCTION update_content_nodes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_content_nodes_updated_at ON public.content_nodes;
CREATE TRIGGER trigger_content_nodes_updated_at
    BEFORE UPDATE ON public.content_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_content_nodes_updated_at();

-- RLS (Row Level Security) 策略
ALTER TABLE public.content_nodes ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的内容
CREATE POLICY "Users can access own content" ON public.content_nodes
    FOR ALL
    USING (auth.uid() = user_id);

-- 添加注释
COMMENT ON TABLE public.content_nodes IS '统一的内容节点表，支持树形结构和多种内容类型';
COMMENT ON COLUMN public.content_nodes.type IS '节点类型: folder, json, markdown, image, pdf, video, file';
COMMENT ON COLUMN public.content_nodes.path IS '物化路径，用于快速按路径查找';
COMMENT ON COLUMN public.content_nodes.content IS 'JSON 内容，仅 type=json 时有值';
COMMENT ON COLUMN public.content_nodes.s3_key IS 'S3 对象 key，仅非 JSON 类型时有值';
COMMENT ON COLUMN public.content_nodes.permissions IS '权限配置，支持继承';

