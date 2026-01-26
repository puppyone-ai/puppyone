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

    def get_by_path(self, user_id: str, path: str) -> ContentNode:
        """根据路径获取节点"""
        node = self.repo.get_by_path(user_id, path)
        if not node:
            raise NotFoundException(f"Path not found: {path}", code=ErrorCode.NOT_FOUND)
        return node

    def list_children(self, user_id: str, parent_id: Optional[str] = None) -> List[ContentNode]:
        """列出子节点"""
        if parent_id:
            # 验证父节点存在且属于用户
            parent = self.repo.get_by_id(parent_id)
            if not parent or parent.user_id != user_id:
                raise NotFoundException(f"Parent not found: {parent_id}", code=ErrorCode.NOT_FOUND)
        return self.repo.list_children(user_id, parent_id)

    def list_root_nodes(self, user_id: str) -> List[ContentNode]:
        """列出根节点"""
        return self.repo.list_children(user_id, None)

    # === 创建操作 ===

    def _build_path(self, user_id: str, parent_id: Optional[str], name: str) -> str:
        """构建节点路径"""
        if parent_id:
            parent = self.repo.get_by_id(parent_id)
            if not parent or parent.user_id != user_id:
                raise NotFoundException(f"Parent not found: {parent_id}", code=ErrorCode.NOT_FOUND)
            return f"{parent.path}/{name}"
        return f"/{name}"

    def create_folder(self, user_id: str, name: str, parent_id: Optional[str] = None) -> ContentNode:
        """创建文件夹"""
        path = self._build_path(user_id, parent_id, name)
        
        # 检查是否已存在
        existing = self.repo.get_by_path(user_id, path)
        if existing:
            raise BusinessException(f"Path already exists: {path}", code=ErrorCode.VALIDATION_ERROR)
        
        return self.repo.create(
            user_id=user_id,
            name=name,
            node_type="folder",
            path=path,
            parent_id=parent_id,
        )

    def create_json_node(
        self, 
        user_id: str, 
        name: str, 
        content: Any,
        parent_id: Optional[str] = None,
    ) -> ContentNode:
        """创建 JSON 节点"""
        path = self._build_path(user_id, parent_id, name)
        
        existing = self.repo.get_by_path(user_id, path)
        if existing:
            raise BusinessException(f"Path already exists: {path}", code=ErrorCode.VALIDATION_ERROR)
        
        return self.repo.create(
            user_id=user_id,
            name=name,
            node_type="json",
            path=path,
            parent_id=parent_id,
            content=content,
            mime_type="application/json",
        )

    async def prepare_file_upload(
        self,
        user_id: str,
        name: str,
        content_type: str,
        parent_id: Optional[str] = None,
    ) -> tuple[ContentNode, str]:
        """准备文件上传（返回节点和预签名 URL）"""
        path = self._build_path(user_id, parent_id, name)
        
        existing = self.repo.get_by_path(user_id, path)
        if existing:
            raise BusinessException(f"Path already exists: {path}", code=ErrorCode.VALIDATION_ERROR)
        
        # 确定文件类型
        node_type = self._get_node_type_from_mime(content_type)
        
        # 生成 S3 key
        import uuid
        s3_key = f"users/{user_id}/content/{uuid.uuid4()}"
        
        # 创建节点记录
        node = self.repo.create(
            user_id=user_id,
            name=name,
            node_type=node_type,
            path=path,
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

    def update_node(
        self,
        node_id: str,
        user_id: str,
        name: Optional[str] = None,
        content: Optional[Any] = None,
    ) -> ContentNode:
        """更新节点"""
        node = self.get_by_id(node_id, user_id)
        
        new_path = None
        if name and name != node.name:
            # 名称变化，需要更新路径
            if node.parent_id:
                parent = self.repo.get_by_id(node.parent_id)
                new_path = f"{parent.path}/{name}" if parent else f"/{name}"
            else:
                new_path = f"/{name}"
            
            # 检查新路径是否已存在
            existing = self.repo.get_by_path(user_id, new_path)
            if existing and existing.id != node_id:
                raise BusinessException(f"Path already exists: {new_path}", code=ErrorCode.VALIDATION_ERROR)
        
        # 更新节点
        updated = self.repo.update(
            node_id=node_id,
            name=name,
            content=content,
            path=new_path,
        )
        
        # 如果是文件夹且名称变了，更新所有子节点的路径
        if new_path and node.type == "folder":
            self.repo.update_children_path_prefix(user_id, node.path, new_path)
        
        return updated

    def move_node(
        self,
        node_id: str,
        user_id: str,
        new_parent_id: Optional[str],
    ) -> ContentNode:
        """移动节点"""
        node = self.get_by_id(node_id, user_id)
        old_path = node.path
        
        # 构建新路径
        new_path = self._build_path(user_id, new_parent_id, node.name)
        
        # 检查新路径是否已存在
        existing = self.repo.get_by_path(user_id, new_path)
        if existing and existing.id != node_id:
            raise BusinessException(f"Path already exists: {new_path}", code=ErrorCode.VALIDATION_ERROR)
        
        # 更新节点
        updated = self.repo.update(
            node_id=node_id,
            parent_id=new_parent_id if new_parent_id else None,
            path=new_path,
        )
        
        # 如果是文件夹，更新所有子节点的路径
        if node.type == "folder":
            self.repo.update_children_path_prefix(user_id, old_path, new_path)
        
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

