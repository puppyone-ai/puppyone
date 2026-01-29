"""Content Node Service - 业务逻辑层"""

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

    def get_by_id(self, node_id: str, user_id: str) -> ContentNode:
        """获取节点（带权限检查）"""
        node = self.repo.get_by_id(node_id)
        if not node or node.user_id != user_id:
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)
        return node

    def get_by_id_path(self, project_id: str, id_path: str) -> ContentNode:
        """根据 id_path 获取节点"""
        node = self.repo.get_by_id_path(project_id, id_path)
        if not node:
            raise NotFoundException(f"Path not found: {id_path}", code=ErrorCode.NOT_FOUND)
        return node

    def list_children(
        self, user_id: str, project_id: str, parent_id: Optional[str] = None
    ) -> List[ContentNode]:
        """列出子节点"""
        if parent_id:
            # 验证父节点存在且属于用户
            parent = self.repo.get_by_id(parent_id)
            if not parent or parent.user_id != user_id:
                raise NotFoundException(f"Parent not found: {parent_id}", code=ErrorCode.NOT_FOUND)
        return self.repo.list_children(user_id, project_id, parent_id)

    def list_root_nodes(self, user_id: str, project_id: str) -> List[ContentNode]:
        """列出项目根节点"""
        return self.repo.list_children(user_id, project_id, None)

    def list_descendants(self, project_id: str, node_id: str) -> List[ContentNode]:
        """列出某节点的所有子孙（用于导出到沙盒）"""
        node = self.repo.get_by_id(node_id)
        if not node:
            raise NotFoundException(f"Node not found: {node_id}", code=ErrorCode.NOT_FOUND)
        return self.repo.list_descendants(project_id, node.id_path)

    def list_indexable_descendants(
        self, project_id: str, node_id: str, indexable_types: Optional[List[str]] = None
    ) -> List[ContentNode]:
        """
        列出某节点的所有可索引子孙节点（用于 folder search）
        
        Args:
            project_id: 项目 ID
            node_id: 节点 ID（通常是 folder）
            indexable_types: 可索引的节点类型，默认为 ['json', 'markdown']
        
        Returns:
            List[ContentNode]: 可索引的子孙节点列表
        """
        if indexable_types is None:
            indexable_types = ["json", "markdown"]
        
        all_descendants = self.list_descendants(project_id, node_id)
        return [node for node in all_descendants if node.type in indexable_types]

    # === 创建操作 ===

    def _build_id_path(self, user_id: str, parent_id: Optional[str], new_node_id: str) -> str:
        """构建节点的 id_path"""
        if parent_id:
            parent = self.repo.get_by_id(parent_id)
            if not parent or parent.user_id != user_id:
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
        self, user_id: str, project_id: str, name: str, parent_id: Optional[str] = None
    ) -> ContentNode:
        """创建文件夹"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(user_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            user_id=user_id,
            project_id=project_id,
            name=unique_name,
            node_type="folder",
            id_path=id_path,
            parent_id=parent_id,
        )

    def create_json_node(
        self, 
        user_id: str,
        project_id: str,
        name: str, 
        content: Any,
        parent_id: Optional[str] = None,
    ) -> ContentNode:
        """创建 JSON 节点"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(user_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            user_id=user_id,
            project_id=project_id,
            name=unique_name,
            node_type="json",
            id_path=id_path,
            parent_id=parent_id,
            content=content,
            mime_type="application/json",
        )

    async def create_synced_node(
        self,
        user_id: str,
        project_id: str,
        name: str,
        sync_type: str,
        sync_url: str,
        content: Any,
        parent_id: Optional[str] = None,
        sync_id: Optional[str] = None,
    ) -> ContentNode:
        """
        创建同步节点（从 SaaS 平台导入的数据）
        
        JSON 数据直接存 JSONB（content 字段），不存 S3。
        JSONB 适合存储结构化数据，查询方便。
        
        Args:
            sync_type: 同步类型，如 github_repo, notion_database, airtable_base 等
            sync_url: 来源 URL
            content: 数据内容（存储到 JSONB）
            sync_id: 外部平台的资源 ID（可选）
        """
        import uuid
        from datetime import datetime
        
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(user_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        # JSON 数据直接存 JSONB，不存 S3
        return self.repo.create(
            user_id=user_id,
            project_id=project_id,
            name=unique_name,
            node_type=sync_type,  # 如 notion_database, airtable_base 等
            id_path=id_path,
            parent_id=parent_id,
            content=content,  # 直接存 JSONB
            s3_key=None,  # 不用 S3
            mime_type="application/json",
            sync_url=sync_url,
            sync_id=sync_id,
            last_synced_at=datetime.utcnow(),
        )

    def create_pending_node(
        self, 
        user_id: str,
        project_id: str,
        name: str, 
        parent_id: Optional[str] = None,
    ) -> ContentNode:
        """创建待处理节点（ETL 处理前的占位符）"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(user_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        return self.repo.create(
            user_id=user_id,
            project_id=project_id,
            name=unique_name,
            node_type="pending",
            id_path=id_path,
            parent_id=parent_id,
            mime_type="application/octet-stream",
        )

    async def create_markdown_node(
        self, 
        user_id: str,
        project_id: str,
        name: str, 
        content: str = "",
        parent_id: Optional[str] = None,
    ) -> ContentNode:
        """创建 Markdown 节点（内容存储到 S3）"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(user_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        # 生成 S3 key 并上传内容
        s3_key = f"users/{user_id}/content/{uuid.uuid4()}.md"
        content_bytes = content.encode('utf-8')
        await self.s3.upload_file(
            key=s3_key,
            content=content_bytes,
            content_type="text/markdown",
        )
        
        return self.repo.create(
            user_id=user_id,
            project_id=project_id,
            name=unique_name,
            node_type="markdown",
            id_path=id_path,
            parent_id=parent_id,
            s3_key=s3_key,
            mime_type="text/markdown",
            size_bytes=len(content_bytes),
        )

    async def bulk_create_nodes(
        self,
        user_id: str,
        project_id: str,
        nodes: List[dict],
        root_parent_id: Optional[str] = None,
    ) -> List[dict]:
        """
        批量创建节点（用于文件夹上传）
        
        Args:
            user_id: 用户 ID
            project_id: 项目 ID
            nodes: 节点列表，每个包含 temp_id, name, type, parent_temp_id, content
            root_parent_id: 整体挂载到哪个父节点下
        
        Returns:
            创建结果列表，每个包含 temp_id, node_id, name, type
        """
        import uuid
        
        # 临时ID -> 真实ID 的映射
        temp_to_real: dict[str, str] = {}
        results: List[dict] = []
        
        # 按层级顺序处理（父节点必须先创建）
        # 先处理根节点（parent_temp_id 为 None 的）
        pending_nodes = list(nodes)
        processed_temp_ids: set[str] = set()
        
        while pending_nodes:
            progress_made = False
            remaining: List[dict] = []
            
            for node in pending_nodes:
                parent_temp_id = node.get("parent_temp_id")
                
                # 如果父节点是 None，或者父节点已经被处理过，就可以创建这个节点
                can_create = (
                    parent_temp_id is None or 
                    parent_temp_id in processed_temp_ids
                )
                
                if can_create:
                    # 确定真实的 parent_id
                    if parent_temp_id is None:
                        real_parent_id = root_parent_id
                    else:
                        real_parent_id = temp_to_real.get(parent_temp_id)
                    
                    # 创建节点
                    new_id = str(uuid.uuid4())
                    id_path = self._build_id_path(user_id, real_parent_id, new_id)
                    
                    node_type = node["type"]
                    content = node.get("content")
                    
                    # 根据类型设置 mime_type
                    mime_type = None
                    if node_type == "folder":
                        mime_type = None
                    elif node_type == "json":
                        mime_type = "application/json"
                    elif node_type == "markdown":
                        mime_type = "text/markdown"
                    elif node_type == "pending":
                        mime_type = "application/octet-stream"
                    
                    # 如果是 markdown 且有内容，上传到 S3
                    s3_key = None
                    size_bytes = 0
                    if node_type == "markdown" and content:
                        s3_key = f"users/{user_id}/content/{uuid.uuid4()}.md"
                        content_bytes = content.encode('utf-8')
                        size_bytes = len(content_bytes)
                        await self.s3.upload_file(
                            key=s3_key,
                            content=content_bytes,
                            content_type="text/markdown",
                        )
                    
                    created = self.repo.create(
                        user_id=user_id,
                        project_id=project_id,
                        name=node["name"],
                        node_type=node_type,
                        id_path=id_path,
                        parent_id=real_parent_id,
                        content=content if node_type == "json" else None,
                        s3_key=s3_key,
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
            
            # 防止无限循环（如果有循环引用）
            if not progress_made and pending_nodes:
                raise BusinessException(
                    "Invalid node hierarchy: circular reference or missing parent",
                    code=ErrorCode.BAD_REQUEST
                )
        
        return results

    async def prepare_file_upload(
        self,
        user_id: str,
        project_id: str,
        name: str,
        content_type: str,
        parent_id: Optional[str] = None,
    ) -> tuple[ContentNode, str]:
        """准备文件上传（返回节点和预签名 URL）"""
        import uuid
        new_id = str(uuid.uuid4())
        id_path = self._build_id_path(user_id, parent_id, new_id)
        unique_name = self._generate_unique_name(project_id, parent_id, name)
        
        # 确定文件类型
        node_type = self._get_node_type_from_mime(content_type)
        
        # 生成 S3 key
        s3_key = f"users/{user_id}/content/{uuid.uuid4()}"
        
        # 创建节点记录
        node = self.repo.create(
            user_id=user_id,
            project_id=project_id,
            name=unique_name,
            node_type=node_type,
            id_path=id_path,
            parent_id=parent_id,
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
        if mime_type.startswith("image/"):
            return "image"
        elif mime_type == "application/pdf":
            return "pdf"
        elif mime_type.startswith("video/"):
            return "video"
        elif mime_type in ("text/markdown", "text/x-markdown"):
            return "markdown"
        else:
            return "file"

    # === 更新操作 ===

    async def finalize_pending_node(
        self,
        node_id: str,
        user_id: str,
        content: str,
        new_name: Optional[str] = None,
    ) -> ContentNode:
        """
        完成 pending 节点的处理（ETL 完成后调用）
        
        将 pending 节点转换为 markdown 节点，更新内容，可选地更新名称（如 .pdf -> .md）
        """
        import uuid
        
        node = self.get_by_id(node_id, user_id)
        
        if node.type not in ("pending", "file"):
            raise BusinessException(
                f"Node is not pending type: {node.type}", 
                code=ErrorCode.BAD_REQUEST
            )
        
        content_bytes = content.encode('utf-8')
        
        # 生成 S3 key 并上传内容
        s3_key = f"users/{user_id}/content/{uuid.uuid4()}.md"
        await self.s3.upload_file(
            key=s3_key,
            content=content_bytes,
            content_type="text/markdown",
        )
        
        # 更新节点：type -> markdown, 可选地更新名称
        update_data = {
            "type": "markdown",
            "s3_key": s3_key,
            "mime_type": "text/markdown",
            "size_bytes": len(content_bytes),
        }
        
        if new_name:
            update_data["name"] = new_name
        
        updated = self.repo.update_with_type(node_id, **update_data)
        return updated

    def update_node(
        self,
        node_id: str,
        user_id: str,
        name: Optional[str] = None,
        content: Optional[Any] = None,
    ) -> ContentNode:
        """更新节点（重命名只改 name，id_path 不变）
        
        注意：对于 markdown 类型，如果要更新内容，请使用 update_markdown_content
        """
        node = self.get_by_id(node_id, user_id)
        
        # 更新节点（id_path 不变，只改 name 或 content）
        updated = self.repo.update(
            node_id=node_id,
            name=name,
            content=content,
        )
        
        return updated

    async def update_markdown_content(
        self,
        node_id: str,
        user_id: str,
        content: str,
    ) -> ContentNode:
        """
        更新 markdown 节点的内容
        优先尝试上传到 S3，如果失败则回退到保存在 content 字段
        """
        import uuid
        import logging
        
        logger = logging.getLogger(__name__)
        node = self.get_by_id(node_id, user_id)
        
        if node.type != "markdown":
            raise BusinessException(
                f"Node is not markdown type: {node.type}", 
                code=ErrorCode.BAD_REQUEST
            )
        
        content_bytes = content.encode('utf-8')
        
        # 尝试上传到 S3
        try:
            # 如果已有 S3 key，更新内容；否则创建新的
            if node.s3_key:
                s3_key = node.s3_key
            else:
                s3_key = f"users/{user_id}/content/{uuid.uuid4()}.md"
            
            await self.s3.upload_file(
                key=s3_key,
                content=content_bytes,
                content_type="text/markdown",
            )
            
            # S3 上传成功，更新数据库记录
            updated = self.repo.update(
                node_id=node_id,
                s3_key=s3_key,
                size_bytes=len(content_bytes),
                clear_content=True,  # 清除 content 字段
            )
            logger.info(f"[ContentNode] Markdown saved to S3: {node_id}")
            
        except Exception as e:
            # S3 上传失败，回退到保存在 content 字段
            logger.warning(f"[ContentNode] S3 upload failed for {node_id}, fallback to DB: {e}")
            updated = self.repo.update(
                node_id=node_id,
                content=content,  # 直接存 string
                size_bytes=len(content_bytes),
            )
            logger.info(f"[ContentNode] Markdown saved to DB: {node_id}")
        
        return updated

    def move_node(
        self,
        node_id: str,
        user_id: str,
        new_parent_id: Optional[str],
    ) -> ContentNode:
        """移动节点"""
        node = self.get_by_id(node_id, user_id)
        old_id_path = node.id_path
        
        # 构建新 id_path
        new_id_path = self._build_id_path(user_id, new_parent_id, node_id)
        
        # 更新节点
        updated = self.repo.update(
            node_id=node_id,
            parent_id=new_parent_id if new_parent_id else None,
            id_path=new_id_path,
        )
        
        # 如果是文件夹，更新所有子节点的 id_path
        if node.type == "folder":
            self.repo.update_children_id_path_prefix(node.project_id, old_id_path, new_id_path)
        
        return updated

    # === 删除操作 ===

    async def delete_node(self, node_id: str, user_id: str) -> None:
        """删除节点（递归删除子节点和 S3 文件）"""
        node = self.get_by_id(node_id, user_id)
        
        # 递归删除子节点
        await self._delete_recursive(node_id)

    async def _delete_recursive(self, node_id: str) -> None:
        """递归删除节点"""
        # 先删除所有子节点
        children_ids = self.repo.get_children_ids(node_id)
        for child_id in children_ids:
            await self._delete_recursive(child_id)
        
        # 获取节点信息
        node = self.repo.get_by_id(node_id)
        if node and node.s3_key:
            # 删除 S3 文件
            try:
                await self.s3.delete_file(node.s3_key)
            except Exception:
                pass  # S3 删除失败不阻塞数据库删除
        
        # 删除数据库记录
        self.repo.delete(node_id)

    # === 下载操作 ===

    async def get_download_url(self, node_id: str, user_id: str) -> str:
        """获取下载 URL"""
        node = self.get_by_id(node_id, user_id)
        
        if node.type == "json":
            raise BusinessException("JSON nodes do not have download URL", code=ErrorCode.BAD_REQUEST)
        
        if not node.s3_key:
            raise BusinessException("Node has no S3 file", code=ErrorCode.BAD_REQUEST)
        
        return await self.s3.generate_presigned_download_url(
            key=node.s3_key,
            expires_in=3600,
        )

