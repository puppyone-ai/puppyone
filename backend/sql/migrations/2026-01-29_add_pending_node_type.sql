-- 添加 pending 节点类型支持
-- pending 类型用于文件夹上传时需要 ETL 处理的文件占位符

-- 更新类型约束，添加 pending
ALTER TABLE public.content_nodes 
DROP CONSTRAINT IF EXISTS content_nodes_type_check;

ALTER TABLE public.content_nodes 
ADD CONSTRAINT content_nodes_type_check 
CHECK (type IN ('folder', 'json', 'markdown', 'image', 'pdf', 'video', 'file', 'pending'));

-- 添加注释
COMMENT ON COLUMN public.content_nodes.type IS '节点类型: folder, json, markdown, image, pdf, video, file, pending (ETL处理中)';

