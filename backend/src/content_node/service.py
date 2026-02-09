"""Content Node Service - 业务逻辑层"""

from datetime import datetime
from typing import Optional, List, Any
from src.content_node.models import ContentNode
from src.content_node.repository import ContentNodeRepository
from src.s3.service import S3Service
from src.exceptions import NotFoundException, BusinessException, ErrorCode


class ContentNodeService:
    """Content Node 业务逻辑"""

    def __init__(self, repo: ContentNodeRepository, s3_service: S3Service):
        self.repo = repo
        self.s3 = s3_service

    # === 查询操作 ===

    def get_by_id(self, node_id: str, project_id: str) -> ContentNode:
        """获取节点（带权限检查，基于 project_id）"""
        node = self.repo.get_by_id(node_id)
        if not node or node.project_id != project_id:
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)
        return node

    def get_by_id_unsafe(self, node_id: str) -> ContentNode:
        """获取节点（不检查权限，仅限内部使用）"""
        node = self.repo.get_by_id(node_id)
        if not node:
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)
        return node

    def get_by_id_path(self, project_id: str, id_path: str) -> ContentNode:
        """根据 id_path 获取节点"""
        node = self.repo.get_by_id_path(project_id, id_path)
        if not node:
            raise NotFoundException(f"Path not found: {id_path}", code=ErrorCode.NOT_FOUND)
        return node

    def list_children(
        self, project_id: str, parent_id: Optional[str] = None
    ) -> List[ContentNode]:
        """列出子节点（仅按 project_id 过滤）"""
        if parent_id:
            # 验证父节点存在且属于该项目
            parent = self.repo.get_by_id(parent_id)
            if not parent or parent.project_id != project_id:
                raise NotFoundException(f"Parent not found: {parent_id}", code=ErrorCode.NOT_FOUND)
        return self.repo.list_children(project_id, parent_id)

    def list_root_nodes(self, project_id: str) -> List[ContentNode]:
        """列出项目根节点"""
        return self.repo.list_children(project_id, None)

    def list_descendants(self, project_id: str, node_id: str) -> List[ContentNode]:
        """列出某节点的所有子孙（用于导出到沙盒）"""
        node = self.repo.get_by_id(node_id)
        if not node:
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)
        return self.repo.list_descendants(project_id, node.id_path)

    def list_indexable_descendants(
        self, project_id: str, node_id: str
    ) -> List[ContentNode]:
        """
        列出某节点的所有可索引子孙节点（用于 folder search）
        
        可索引的节点：
        - storage_type='json'
        - storage_type='file' 且 mime_type='text/markdown'
        - storage_type='sync' 且 mime_type='text/markdown'
        """
        all_descendants = self.list_descendants(project_id, node_id)
        return [node for node in all_descendants if node.is_indexable]

    # === 创建操作 ===

    def _build_id_path(self, project_id: str, parent_id: Optional[str], new_node_id: str) -> str:
        """构建节点的 id_path"""
        if parent_id:
            parent = self.repo.get_by_id(parent_id)
            if not parent or parent.project_id != project_id:
                raise NotFoundException(f"Parent not found: {parent_id}", code=ErrorCode.NOT_FOUND)
            return f"{parent.id_path}/{new_node_id}"
        return f"/{new_node_id}"

    def _generate_unique_name(
        self, project_id: str, parent_id: Optional[str], base_name: str
    ) -> str:
        """生成唯一名称，如 'Untitled', 'Untitled (1)', 'Untitled (2)'"""
        import re
        
        existing_names = self.repo.find_names_with_prefix(project_id, parent_id, base_name)
        
        if base_name not in existing_names:
            return base_name
        
        # 找出所有已使用的序号
        pattern = re.compile(rf"^{re.escape(base_name)} \((\d+)\)$")
        used_numbers = set()
        for name in existing_names:
            match = pattern.match(name)
            if match:
                used_numbers.add(int(match.group(1)))
        
        # 找到第一个未使用的序号
        counter = 1
        while counter in used_numbers:
            counter += 1
        
        return f"{base_name} ({counter})"

    def create_folder(
        self, project_id: str, name: str, parent_id: Optional[str] = None, created_by: Optional[str] = None
    ) -> ContentNode:
        """创建文件夹"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="folder",
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
        )

    def create_json_node(
        self, 
        project_id: str,
        name: str, 
        content: Any,
        parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> ContentNode:
        """创建 JSON 节点"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="json",
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            preview_json=content,
            preview_type="json",
            mime_type="application/json",
        )

    def create_placeholder_node(
        self,
        project_id: str,
        name: str,
        placeholder_type: str,
        parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> ContentNode:
        """
        创建占位符节点（未连接状态）
        
        用于 Onboarding 等场景，展示"可以连接但尚未连接"的数据源。
        用户点击后可以触发 OAuth 授权流程。
        
        Args:
            placeholder_type: 平台类型
        
        注意：占位符节点的 sync_oauth_user_id 为 None，授权后才会填充。
        """
        import uuid
        
        # source 映射
        SOURCE_MAP = {
            'gmail': 'gmail',
            'sheets': 'google_sheets',
            'calendar': 'google_calendar',
            'docs': 'google_docs',
            'notion': 'notion',
            'github': 'github',
        }
        
        source = SOURCE_MAP.get(placeholder_type, placeholder_type)
        
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        # 占位符的默认内容
        placeholder_content = {
            "_status": "not_connected",
            "_placeholder_type": placeholder_type,
            "_message": f"Click to connect your {placeholder_type.replace('_', ' ').title()} account",
        }
        
        # 占位符不设 sync_oauth_user_id，因为还没授权
        # 数据库约束 chk_sync_oauth_user 只要求 sync_status != 'not_connected' 时必须有
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="sync",
            source=source,
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            preview_json=placeholder_content,
            preview_type="json",
            mime_type="application/json",
            sync_status="not_connected",
        )

    async def convert_placeholder_to_synced(
        self,
        node_id: str,
        project_id: str,
        sync_oauth_user_id: str,  # 授权后必须提供
        content: Any,
        sync_url: str,
        sync_id: str,
        sync_config: Optional[dict] = None,
    ) -> ContentNode:
        """将占位符节点转换为已同步的节点"""
        node = self.get_by_id(node_id, project_id)
        
        if node.sync_status != "not_connected":
            raise BusinessException(
                f"Node is not a placeholder: {node.sync_status}",
                code=ErrorCode.BAD_REQUEST
            )
        
        # 更新同步信息，并设置 sync_oauth_user_id
        return self.repo.update_sync_info(
            node_id=node_id,
            sync_url=sync_url,
            sync_id=sync_id,
            sync_status="idle",
            sync_config=sync_config,
            last_synced_at=datetime.utcnow(),
            preview_json=content,
            preview_type="json",
            sync_oauth_user_id=sync_oauth_user_id,
        )

    async def create_synced_node(
        self,
        project_id: str,
        sync_oauth_user_id: str,  # 同步节点必须提供
        name: str,
        source: str,
        sync_url: str,
        content: Any,
        parent_id: Optional[str] = None,
        sync_id: Optional[str] = None,
        sync_config: Optional[dict] = None,
        created_by: Optional[str] = None,
    ) -> ContentNode:
        """
        创建同步节点（从 SaaS 平台导入的结构化数据）
        
        JSON 数据直接存 JSONB（preview_json 字段）。
        sync_oauth_user_id 用于标识使用哪个用户的 OAuth 凭证进行同步。
        """
        import uuid
        
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="sync",
            source=source,
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            sync_oauth_user_id=sync_oauth_user_id,
            preview_json=content,
            preview_type="json",
            mime_type="application/json",
            sync_url=sync_url,
            sync_id=sync_id,
            sync_config=sync_config,
            sync_status="idle",
            last_synced_at=datetime.utcnow(),
        )

    async def create_github_repo_node(
        self,
        project_id: str,
        sync_oauth_user_id: str,  # GitHub 同步节点必须提供
        name: str,
        sync_url: str,
        sync_id: str,
        s3_prefix: str,
        metadata: dict,
        parent_id: Optional[str] = None,
        sync_config: Optional[dict] = None,
        created_by: Optional[str] = None,
    ) -> ContentNode:
        """创建 GitHub repo 节点（单节点模式）"""
        import uuid
        
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="sync",
            source="github",
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            sync_oauth_user_id=sync_oauth_user_id,
            preview_json=metadata,
            preview_type="json",
            s3_key=s3_prefix,
            mime_type="application/x-github-repo",
            sync_url=sync_url,
            sync_id=sync_id,
            sync_config=sync_config,
            last_synced_at=datetime.utcnow(),
        )

    def create_pending_node(
        self, 
        project_id: str,
        name: str, 
        parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
        s3_key: Optional[str] = None,
        mime_type: Optional[str] = None,
        size_bytes: int = 0,
    ) -> ContentNode:
        """创建待处理节点（ETL 处理前的占位符）"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="file",  # pending 是 file 类型
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            s3_key=s3_key,
            mime_type=mime_type or "application/octet-stream",
            size_bytes=size_bytes,
        )

    def create_file_node(
        self, 
        project_id: str,
        name: str, 
        s3_key: str,
        mime_type: Optional[str] = None,
        size_bytes: int = 0,
        parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> ContentNode:
        """创建文件节点（二进制文件，存 S3，无预览）"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="file",
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            s3_key=s3_key,
            mime_type=mime_type or "application/octet-stream",
            size_bytes=size_bytes,
            # preview_type=NULL, 无预览
        )

    async def create_markdown_node(
        self, 
        project_id: str,
        name: str, 
        content: str = "",
        parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> ContentNode:
        """创建 Markdown 节点（内容直接存 preview_md，不存 S3）"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        content_bytes = content.encode('utf-8')
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="markdown",
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            preview_md=content,  # 直接存数据库
            preview_type="markdown",
            mime_type="text/markdown",
            size_bytes=len(content_bytes),
        )

    async def create_synced_markdown_node(
        self, 
        project_id: str,
        sync_oauth_user_id: str,  # 同步 Markdown 节点必须提供
        name: str, 
        content: str,
        source: str,
        sync_url: str,
        sync_id: Optional[str] = None,
        sync_config: Optional[dict] = None,
        parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> ContentNode:
        """创建同步的 Markdown 节点（如 Notion Page），内容直接存 preview_md，不存 S3"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        content_bytes = content.encode('utf-8')
        
        return self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type="sync",
            source=source,
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            sync_oauth_user_id=sync_oauth_user_id,
            preview_md=content,  # 直接存数据库
            preview_type="markdown",
            mime_type="text/markdown",
            size_bytes=len(content_bytes),
            sync_url=sync_url,
            sync_id=sync_id,
            sync_config=sync_config,
            last_synced_at=datetime.utcnow(),
        )

    async def bulk_create_nodes(
        self,
        project_id: str,
        nodes: List[dict],
        root_parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> List[dict]:
        """
        批量创建节点（用于文件夹上传）
        
        nodes 中每个节点的 type 字段：folder | json | markdown | file
        """
        import uuid
        
        temp_to_real: dict[str, str] = {}
        results: List[dict] = []
        pending_nodes = list(nodes)
        processed_temp_ids: set[str] = set()
        
        while pending_nodes:
            progress_made = False
            remaining: List[dict] = []
            
            for node in pending_nodes:
                parent_temp_id = node.get("parent_temp_id")
                
                can_create = (
                    parent_temp_id is None or 
                    parent_temp_id in processed_temp_ids
                )
                
                if can_create:
                    if parent_temp_id is None:
                        real_parent_id = root_parent_id
                    else:
                        real_parent_id = temp_to_real.get(parent_temp_id)
                    
                    new_id = str(uuid.uuid4())
                    id_path = self._build_id_path(project_id, real_parent_id, new_id)
                    
                    # node["type"]: folder | json | markdown | file
                    node_type = node["type"]
                    content = node.get("content")
                    
                    # 确定 mime_type, preview_type, preview_json, preview_md
                    mime_type = None
                    preview_type = None
                    preview_json = None
                    preview_md = None
                    size_bytes = 0
                    
                    if node_type == "folder":
                        mime_type = None
                    elif node_type == "json":
                        mime_type = "application/json"
                        preview_type = "json"
                        preview_json = content
                    elif node_type == "markdown":
                        mime_type = "text/markdown"
                        preview_type = "markdown"
                        preview_md = content if isinstance(content, str) else ""
                        # Markdown 直接存数据库，不存 S3
                        if preview_md:
                            size_bytes = len(preview_md.encode('utf-8'))
                    elif node_type == "file":
                        mime_type = "application/octet-stream"
                    
                    created = self.repo.create(
                        project_id=project_id,
                        name=node["name"],
                        node_type=node_type,
                        id_path=id_path,
                        parent_id=real_parent_id,
                        created_by=created_by,
                        preview_json=preview_json,
                        preview_md=preview_md,
                        preview_type=preview_type,
                        mime_type=mime_type,
                        size_bytes=size_bytes,
                    )
                    
                    temp_to_real[node["temp_id"]] = created.id
                    processed_temp_ids.add(node["temp_id"])
                    results.append({
                        "temp_id": node["temp_id"],
                        "node_id": created.id,
                        "name": created.name,
                        "type": created.type,
                    })
                    progress_made = True
                else:
                    remaining.append(node)
            
            pending_nodes = remaining
            
            if not progress_made and pending_nodes:
                raise BusinessException(
                    "Invalid node hierarchy: circular reference or missing parent",
                    code=ErrorCode.BAD_REQUEST
                )
        
        return results

    async def prepare_file_upload(
        self,
        project_id: str,
        name: str,
        content_type: str,
        parent_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> tuple[ContentNode, str]:
        """准备文件上传（返回节点和预签名 URL）"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(project_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        # 确定节点类型
        node_type = self._get_node_type_from_mime(content_type)
        
        # 生成 S3 key（使用 project_id）
        s3_key = f"projects/{project_id}/content/{uuid.uuid4()}"
        
        # 创建节点记录
        node = self.repo.create(
            project_id=project_id,
            name=unique_name,
            node_type=node_type,
            id_path=id_path,
            parent_id=parent_id,
            created_by=created_by,
            s3_key=s3_key,
            mime_type=content_type,
        )
        
        # 生成预签名上传 URL
        upload_url = await self.s3.generate_presigned_upload_url(
            key=s3_key,
            expires_in=3600,
            content_type=content_type,
        )
        
        return node, upload_url

    def _get_node_type_from_mime(self, mime_type: str) -> str:
        """根据 MIME 类型确定节点类型"""
        if mime_type in ("text/markdown", "text/x-markdown"):
            return "markdown"
        else:
            return "file"

    # === 更新操作 ===

    async def finalize_pending_node(
        self,
        node_id: str,
        project_id: str,
        content: str,
        new_name: Optional[str] = None,
    ) -> ContentNode:
        """
        完成 pending 节点的处理（ETL/OCR 完成后调用）
        
        type 保持 "file" 不变（它的本质就是一个文件）
        只更新 preview_type 和 preview_md，让 Agent 能看到 OCR 结果
        
        语义分离:
        - type = 节点的本质（file/markdown/json/folder/sync）
        - preview_type = Agent 看到的内容格式（markdown/json/NULL）
        """
        node = self.get_by_id(node_id, project_id)
        
        # 检查是 file 类型
        if node.type != "file":
            raise BusinessException(
                f"Node is not file type: {node.type}", 
                code=ErrorCode.BAD_REQUEST
            )
        
        content_bytes = content.encode('utf-8')
        
        # type 保持 "file"，只填充 preview
        updated = self.repo.update_with_type(
            node_id,
            # node_type 不传 → type 保持 "file"
            name=new_name,
            preview_md=content,
            preview_type="markdown",
            size_bytes=len(content_bytes),
            # mime_type 保持原始文件的 MIME（如 image/png），不改成 text/markdown
        )
        return updated

    def update_node(
        self,
        node_id: str,
        project_id: str,
        name: Optional[str] = None,
        preview_json: Optional[Any] = None,
        preview_md: Optional[str] = None,
    ) -> ContentNode:
        """更新节点（重命名只改 name，id_path 不变）"""
        self.get_by_id(node_id, project_id)

        if preview_md is not None:
            content_bytes = preview_md.encode("utf-8")
            updated = self.repo.update(
                node_id=node_id,
                name=name,
                preview_md=preview_md,
                size_bytes=len(content_bytes),
                clear_preview_json=True,
            )
        else:
            updated = self.repo.update(
                node_id=node_id,
                name=name,
                preview_json=preview_json,
            )
        
        return updated

    async def update_markdown_content(
        self,
        node_id: str,
        project_id: str,
        content: str,
    ) -> ContentNode:
        """更新 markdown 节点的内容（直接存数据库，不存 S3）"""
        import logging
        
        logger = logging.getLogger(__name__)
        node = self.get_by_id(node_id, project_id)
        
        # 检查是 markdown 文件
        if node.type != "markdown":
            raise BusinessException(
                f"Node is not markdown type: type={node.type}", 
                code=ErrorCode.BAD_REQUEST
            )
        
        content_bytes = content.encode('utf-8')
        
        # 直接更新数据库，不存 S3
        updated = self.repo.update(
            node_id=node_id,
        preview_md=content,
            preview_type="markdown",
            size_bytes=len(content_bytes),
        )
        logger.info(f"[ContentNode] Markdown saved to DB: {node_id}")
        
        return updated

    def move_node(
        self,
        node_id: str,
        project_id: str,
        new_parent_id: Optional[str],
    ) -> ContentNode:
        """移动节点"""
        node = self.get_by_id(node_id, project_id)
        old_id_path = node.id_path
        
        new_id_path = self._build_id_path(project_id, new_parent_id, node_id)
        
        updated = self.repo.update(
            node_id=node_id,
            parent_id=new_parent_id if new_parent_id else None,
            id_path=new_id_path,
        )
        
        # 如果是文件夹，更新所有子节点的 id_path
        if node.is_folder:
            self.repo.update_children_id_path_prefix(node.project_id, old_id_path, new_id_path)
        
        return updated

    # === 删除操作 ===

    async def delete_node(self, node_id: str, project_id: str) -> None:
        """删除节点（递归删除子节点和 S3 文件）"""
        node = self.get_by_id(node_id, project_id)
        await self._delete_recursive(node_id)

    async def _delete_recursive(self, node_id: str) -> None:
        """递归删除节点"""
        children_ids = self.repo.get_children_ids(node_id)
        for child_id in children_ids:
            await self._delete_recursive(child_id)
        
        node = self.repo.get_by_id(node_id)
        if node and node.s3_key:
            try:
                await self.s3.delete_file(node.s3_key)
            except Exception:
                pass
        
        self.repo.delete(node_id)

    # === 下载操作 ===

    async def get_download_url(self, node_id: str, project_id: str) -> str:
        """获取下载 URL"""
        node = self.get_by_id(node_id, project_id)
        
        if node.is_json:
            raise BusinessException("JSON nodes do not have download URL", code=ErrorCode.BAD_REQUEST)
        
        if not node.s3_key:
            raise BusinessException("Node has no S3 file", code=ErrorCode.BAD_REQUEST)
        
        return await self.s3.generate_presigned_download_url(
            key=node.s3_key,
            expires_in=3600,
        )
