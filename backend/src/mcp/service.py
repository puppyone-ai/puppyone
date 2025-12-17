"""
简化版MCP Service
移除进程管理逻辑，MCP实例退化为纯数据记录
"""

import jwt
import httpx
import os
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from src.config import settings
from src.exceptions import (
    AuthException,
    BusinessException,
    NotFoundException,
    ErrorCode,
)
from src.mcp.schemas import McpTokenPayload
from src.mcp.repository import McpInstanceRepositoryBase
from src.mcp.models import McpInstance
from src.utils.logger import log_info, log_error

# MCP Server的URL
MCP_SERVER_URL = settings.MCP_SERVER_URL
MCP_SERVER_HEALTHZ_URL = f"{MCP_SERVER_URL}/healthz"
MCP_SERVER_CACHE_INVALIDATE_URL = f"{MCP_SERVER_URL}/cache/invalidate"

class McpService:
    """
    MCP托管服务层
    - 职责:
        - 负责mcp实例的 API_KEY生成和验证。（目前使用JWT方案）
        - 负责对接数据库中的mcp实例
    """

    def __init__(self, instance_repo: McpInstanceRepositoryBase):
        # MCP Instance 存储层
        self.instance_repo = instance_repo


# ============================================================
# API_KEY生成和解析逻辑
# ============================================================

    def generate_mcp_token(
        self, user_id: str, project_id: int, table_id: int, json_pointer: str = ""
    ) -> str:
        """
        根据用户ID、项目ID、表格ID、JSON路径 生成代表MCP实例的JWT token

        Args:
            user_id: 用户ID
            project_id: 项目ID
            table_id: 表格ID
            json_pointer: JSONPath

        Returns:
            JWT token 字符串
        """
        payload = {
            "user_id": user_id,
            "project_id": project_id,
            "table_id": table_id,
            "json_pointer": json_pointer,
            "iat": datetime.now(timezone.utc),
        }
        token = jwt.encode(
            payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM
        )
        return token

    def decode_mcp_token(self, token: str) -> McpTokenPayload:
        """
        解码 MCP JWT token

        Args:
            token: JWT token 字符串

        Returns:
            McpTokenPayload 对象

        Raises:
            AuthException: 如果 token 无效或已过期
        """
        try:
            payload = jwt.decode(
                token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
            )
            return McpTokenPayload(**payload)
        except jwt.ExpiredSignatureError:
            raise AuthException("Token has expired", code=ErrorCode.TOKEN_EXPIRED)
        except jwt.InvalidTokenError:
            raise AuthException("Invalid token", code=ErrorCode.INVALID_TOKEN)
        except Exception as e:
            raise AuthException(
                f"Error decoding token: {e}", code=ErrorCode.INVALID_TOKEN
            )

# ============================================================
# 数据库中的mcp实例
# ============================================================

    async def create_mcp_instance(
        self,
        user_id: str,
        project_id: int,
        table_id: int,
        json_pointer: str = "",
        tools_definition: Optional[Dict[str, Any]] = None,
        register_tools: Optional[List[str]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        """
        创建MCP实例（仅创建数据库记录，不启动子进程）

        Args:
            user_id: 用户ID
            project_id: 项目ID
            table_id: 表格ID
            json_pointer: JSON指针路径
            tools_definition: 工具定义字典（可选）
            register_tools: 需要注册的工具列表（可选）
            preview_keys: 预览字段列表（可选）

        Returns:
            McpInstance 对象
        """
        # 1. 生成 API_KEY
        api_key = self.generate_mcp_token(user_id, project_id, table_id, json_pointer)

        # 2. 直接新增数据库记录
        try:
            # 创建数据库记录，默认开启MCP实例
            mcp_instance = self.instance_repo.create(
                api_key=api_key,
                user_id=user_id,
                project_id=project_id,
                table_id=table_id,
                json_pointer=json_pointer,
                status=1,   # 默认开启
                # 工具配置
                tools_definition=tools_definition,
                register_tools=register_tools,
                preview_keys=preview_keys,
                # 过期字段
                port=None,
                docker_info=None,
            )

            log_info(
                f"MCP实例创建成功: ID={mcp_instance.mcp_instance_id}, API_KEY: {api_key}"
            )

            return mcp_instance

        except Exception as e:
            log_error(f"MCP实例创建失败: {e}")
            # 清理资源
            try:
                if "api_key" in locals():
                    self.instance_repo.delete_by_api_key(api_key)
            except Exception as cleanup_error:
                log_error(f"清理失败: {cleanup_error}")
            raise

    async def update_mcp_instance(
        self,
        api_key: str,
        status: Optional[int] = None,
        json_pointer: Optional[str] = None,
        tools_definition: Optional[Dict[str, Any]] = None,
        register_tools: Optional[List[str]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        """
        更新 MCP 实例（仅更新数据库记录）

        Args:
            api_key: API key
            status: 状态，0表示关闭，1表示开启（可选）
            json_pointer: JSON指针路径（可选）
            tools_definition: 工具定义字典（可选）
            register_tools: 需要注册的工具列表（可选）
            preview_keys: 预览字段列表（可选）

        Returns:
            更新后的 McpInstance 对象
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        try:
            # 准备最终参数
            final_json_pointer = (
                json_pointer if json_pointer is not None else instance.json_pointer
            )
            final_register_tools = (
                register_tools
                if register_tools is not None
                else instance.register_tools
            )
            final_tools_definition = (
                tools_definition
                if tools_definition is not None
                else instance.tools_definition
            )
            final_preview_keys = (
                preview_keys if preview_keys is not None else instance.preview_keys
            )
            target_status = status if status is not None else instance.status

            # 更新数据库
            updated_instance = self.instance_repo.update_by_api_key(
                api_key=api_key,
                user_id=instance.user_id,
                project_id=instance.project_id,
                table_id=instance.table_id,
                json_pointer=final_json_pointer,
                status=target_status,
                port=instance.port,
                docker_info=instance.docker_info,
                tools_definition=final_tools_definition,
                register_tools=final_register_tools,
                preview_keys=final_preview_keys,
            )

            # 通知MCP Server缓存失效
            try:
                await self._invalidate_mcp_cache(api_key)
            except Exception as e:
                log_error(f"通知MCP Server缓存失效失败: {e}")

            log_info(f"MCP instance {api_key} updated successfully")
            return updated_instance

        except Exception as e:
            log_error(f"Failed to update MCP instance: {e}")
            raise BusinessException(
                f"Failed to update MCP instance: {e}",
                code=ErrorCode.MCP_INSTANCE_UPDATE_FAILED,
            )

    async def delete_mcp_instance(self, api_key: str) -> bool:
        """
        删除 MCP 实例（仅删除数据库记录）

        Args:
            api_key: API key

        Returns:
            是否成功删除
        """
        try:
            instance = self.instance_repo.get_by_api_key(api_key)
            if not instance:
                raise NotFoundException(
                    f"MCP instance not found: api_key={api_key}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )

            # 从数据库删除记录
            result = self.instance_repo.delete_by_api_key(api_key)

            if result:
                # 通知MCP Server缓存失效
                try:
                    await self._invalidate_mcp_cache(api_key)
                except Exception as e:
                    log_error(f"通知MCP Server缓存失效失败: {e}")

                log_info(f"MCP instance deleted: api_key={api_key}")
            else:
                raise BusinessException(
                    f"Failed to delete MCP instance from repository: api_key={api_key}",
                    code=ErrorCode.MCP_INSTANCE_DELETE_FAILED,
                )

            return True
        except NotFoundException:
            raise
        except Exception as e:
            log_error(f"Failed to delete MCP instance {api_key}: {e}")
            raise BusinessException(
                f"Failed to delete MCP instance: {e}",
                code=ErrorCode.MCP_INSTANCE_DELETE_FAILED,
            )

    async def get_mcp_instance_status(self, api_key: str) -> Dict[str, Any]:
        """
        获取 MCP 实例状态（简化版，调用MCP Server的healthz）

        Args:
            api_key: API key

        Returns:
            状态信息字典
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        # 调用MCP Server的healthz检查服务状态
        mcp_server_status = await self._check_mcp_server_health()

        return {
            "status": instance.status,
            "port": instance.port,
            "json_pointer": instance.json_pointer,
            "tools_definition": instance.tools_definition,
            "register_tools": instance.register_tools,
            "preview_keys": instance.preview_keys,
            "docker_info": instance.docker_info,
            "mcp_server_status": mcp_server_status,
            "synced": True,
        }

    ### 基础查询方法 ###

    async def get_mcp_instance_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        """根据 API key 获取 MCP 实例"""
        return self.instance_repo.get_by_api_key(api_key)

    async def get_mcp_instance_by_id(
        self, mcp_instance_id: int
    ) -> Optional[McpInstance]:
        """根据实例ID获取 MCP 实例"""
        return self.instance_repo.get_by_id(mcp_instance_id)

    async def get_user_mcp_instances(self, user_id: str) -> List[McpInstance]:
        """获取用户的所有 MCP 实例"""
        return self.instance_repo.get_by_user_id(user_id)

    async def get_mcp_instance_by_api_key_with_access_check(
        self, api_key: str, user_id: str
    ) -> McpInstance:
        """获取 MCP 实例并验证用户权限"""
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        if instance.user_id != user_id:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        return instance

    async def check_mcp_server_health(self) -> Dict[str, Any]:
        """
        对外公开：检查 MCP Server 的健康状态（调用 /healthz）

        Returns:
            健康状态字典
        """
        return await self._check_mcp_server_health()

    ### 私有辅助方法 ###

    async def _check_mcp_server_health(self) -> Dict[str, Any]:
        """
        检查MCP Server的健康状态

        Returns:
            健康状态字典
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(MCP_SERVER_HEALTHZ_URL)
                if response.status_code == 200:
                    return response.json()
                else:
                    return {"status": "unhealthy", "error": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"status": "unhealthy", "error": str(e)}

    async def _invalidate_mcp_cache(self, api_key: str) -> None:
        """
        通知MCP Server使缓存失效

        Args:
            api_key: API key
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    MCP_SERVER_CACHE_INVALIDATE_URL,
                    json={"api_key": api_key}
                )
        except Exception as e:
            log_error(f"Failed to invalidate MCP cache: {e}")
