"""
负责 MCP 实例的创建、管理和 token 生成
"""

import jwt
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
from src.mcp.server_old.manager.manager import (
    create_instance as create_mcp_server,
    delete_instance as kill_mcp_server,
    get_instance_status as get_mcp_server_status,
    update_instance_status as update_and_restart_mcp_server,
    release_port as release_mcp_server_port,
    allocate_port as allocate_mcp_server_port,
    shutdown_all_instances as shutdown_all_mcp_servers,
)
from src.utils.logger import log_info, log_error


class McpService:
    """
    MCP托管服务层
    负责 MCP 实例的创建、管理以及 JWT token 的生成和验证
    """

    def __init__(self, instance_repo: McpInstanceRepositoryBase):
        # MCP Instance 存储层
        self.instance_repo = instance_repo

    ### API_KEY生成和解析逻辑 ###

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

    ### MCP实例创建和更新逻辑 ###

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
        创建MCP实例并启动一个MCP服务器

        Args:
            user_id: 用户ID
            project_id: 项目ID
            table_id: 表格ID
            json_pointer: JSON指针路径，表示该MCP实例对应的数据路径，默认为空字符串表示根路径
            tools_definition: 工具定义字典（可选），key只能是get/create/update/delete
            register_tools: 需要注册的工具列表（可选），默认为所有工具
            preview_keys: 预览字段列表（可选），用于preview_data工具过滤字段

        Returns:
            McpInstance 对象

        Raises:
            RuntimeError: 如果进程启动失败，会清理 repository 中的记录
        """
        # 1. 生成 API_KEY
        api_key = self.generate_mcp_token(user_id, project_id, table_id, json_pointer)
        port = None

        # 2. 通过子进程方式创建 MCP Server
        try:
            # 预分配端口
            port = allocate_mcp_server_port()

            # 存储临时状态(MCP Server内部所需要的数据位置的信息)
            initial_docker_info = {"status": "starting"}
            mcp_instance = self.instance_repo.create(
                api_key=api_key,
                user_id=user_id,
                project_id=project_id,
                table_id=table_id,
                json_pointer=json_pointer,
                status=1,  # 1 表示开启, 但此时还没有启动
                port=port,
                docker_info=initial_docker_info,
                tools_definition=tools_definition,
                register_tools=register_tools,
                preview_keys=preview_keys,
            )

            log_info(
                f"MCP实例启动中... ID={mcp_instance.mcp_instance_id}, API_KEY: {api_key}, 分配端口: {port}"
            )

            # 调用 manager 创建 MCP server 实例
            instance_info = await create_mcp_server(
                api_key=api_key,
                user_id=user_id,
                project_id=project_id,
                table_id=table_id,
                register_tools=register_tools,
                port=port,
            )

            # 再次验证进程状态
            status_info = await get_mcp_server_status(api_key)
            if not status_info.get("running", False):
                raise BusinessException(
                    f"MCP Server进程启动失败或立即退出. 状态: {status_info}",
                    code=ErrorCode.MCP_INSTANCE_CREATION_FAILED,
                )

            # 更新最终状态
            updated_instance = self.instance_repo.update_by_api_key(
                api_key=api_key,
                user_id=user_id,
                project_id=project_id,
                table_id=table_id,
                json_pointer=json_pointer,
                status=1,
                port=port,
                docker_info=instance_info["docker_info"],
                tools_definition=tools_definition,
                register_tools=register_tools,
                preview_keys=preview_keys,
            )

            log_info(
                f"MCP实例创建成功: ID={updated_instance.mcp_instance_id}, API_KEY: {api_key}, 分配端口: {port}, PID: {instance_info['docker_info'].get('pid')}"
            )

            return updated_instance

        except Exception as e:
            log_error(f"MCP实例创建失败: {e}")

            # 清理资源
            try:
                # 删除 MCP Instance 记录
                if "api_key" in locals():
                    self.instance_repo.delete_by_api_key(api_key)

                # 释放端口
                if port is not None:
                    release_mcp_server_port(port)

                # 停止进程
                if "api_key" in locals():
                    await kill_mcp_server(api_key)
            except Exception as cleanup_error:
                log_error(f"Error during cleanup: {cleanup_error}")

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
        更新 MCP 实例

        Args:
            api_key: API key
            status: 状态，0表示关闭，1表示开启（可选）
            json_pointer: JSON指针路径（可选）
            tools_definition: 工具定义字典（可选）
            register_tools: 需要注册的工具列表（可选）
            preview_keys: 预览字段列表（可选），用于preview_data工具过滤字段

        Returns:
            更新后的 McpInstance 对象

        Raises:
            NotFoundException: 实例不存在
            BusinessException: 更新失败
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        try:
            # 步骤1: 准备最终要使用的所有参数
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

            # 步骤2: 判断是否有配置变更（这些参数需要重启服务器才能生效）
            config_changed = (
                (json_pointer is not None and json_pointer != instance.json_pointer)
                or (
                    register_tools is not None
                    and register_tools != instance.register_tools
                )
                or (
                    tools_definition is not None
                    and tools_definition != instance.tools_definition
                )
                or (preview_keys is not None and preview_keys != instance.preview_keys)
            )

            # 步骤3: 决定服务器操作类型
            # 3.1 需要重启：目标状态是开启 且（当前是关闭 或 配置有变更）
            need_restart = target_status == 1 and (
                instance.status == 0 or config_changed
            )
            # 3.2 需要停止：目标状态是关闭 且 当前是开启
            need_stop = target_status == 0 and instance.status == 1

            # 步骤4: 执行服务器操作并获取最新的端口和进程信息
            new_port = instance.port
            new_docker_info = instance.docker_info

            if need_stop:
                # 停止服务器
                log_info(f"Stopping MCP instance {api_key}")
                await update_and_restart_mcp_server(
                    api_key=api_key, status=0, port=instance.port
                )

            elif need_restart:
                # 重启服务器以应用新配置或启动服务器
                if config_changed and instance.status == 1:
                    log_info(
                        f"Restarting MCP instance {api_key} to apply new configuration"
                    )
                else:
                    log_info(f"Starting MCP instance {api_key}")

                # 如果当前是开启状态，先停止
                if instance.status == 1:
                    await update_and_restart_mcp_server(
                        api_key=api_key, status=0, port=instance.port
                    )

                # 启动服务器
                instance_info = await update_and_restart_mcp_server(
                    api_key=api_key,
                    status=1,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    table_id=instance.table_id,
                    port=instance.port,  # 尝试使用原有端口，如果不可用则分配新端口
                    register_tools=final_register_tools,
                )

                new_port = instance_info.get("port", instance.port)
                new_docker_info = instance_info.get("docker_info", instance.docker_info)

            else:
                # 不需要服务器操作，只更新数据库
                if config_changed:
                    log_info(
                        f"MCP instance {api_key} configuration updated (instance is stopped, will apply on next start)"
                    )
                else:
                    log_info(f"MCP instance {api_key} updating repository only")

            # 步骤5: 统一更新数据库（只有一个地方）
            updated_instance = self.instance_repo.update_by_api_key(
                api_key=api_key,
                user_id=instance.user_id,
                project_id=instance.project_id,
                table_id=instance.table_id,
                json_pointer=final_json_pointer,
                status=target_status,
                port=new_port,
                docker_info=new_docker_info,
                tools_definition=final_tools_definition,
                register_tools=final_register_tools,
                preview_keys=final_preview_keys,
            )

            log_info(
                f"MCP instance {api_key} updated successfully (status={target_status}, port={new_port})"
            )
            return updated_instance

        except Exception as e:
            log_error(f"Failed to update MCP instance: {e}")
            raise BusinessException(
                f"Failed to update MCP instance: {e}",
                code=ErrorCode.MCP_INSTANCE_UPDATE_FAILED,
            )

    async def delete_mcp_instance(self, api_key: str) -> bool:
        """
        删除 MCP 实例

        Args:
            api_key: API key

        Returns:
            是否成功删除

        Raises:
            NotFoundException: 实例不存在
            BusinessException: 删除失败
        """
        try:
            # 1. 先获取实例信息（用于释放端口）
            instance = self.instance_repo.get_by_api_key(api_key)
            if not instance:
                raise NotFoundException(
                    f"MCP instance not found: api_key={api_key}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )

            # 2. 从 manager 删除实例（停止进程）
            await kill_mcp_server(api_key)

            # 3. 释放端口
            release_mcp_server_port(instance.port)

            # 4. 从 repository 删除记录
            result = self.instance_repo.delete_by_api_key(api_key)

            if result:
                log_info(
                    f"MCP instance deleted: api_key={api_key}, port={instance.port} released"
                )
            else:
                # 理论上不应该走到这里，因为前面已经检查过 instance 存在
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

    ### MCP Server运行状态相关逻辑 ###

    async def get_mcp_instance_status(self, api_key: str) -> Dict[str, Any]:
        """
        获取 MCP 实例状态

        如果发现进程不在运行但 repository 中状态是开启（status=1），
        会自动尝试重启进程以保持用户期望的状态

        Args:
            api_key: API key

        Returns:
            状态信息字典
        """
        from src.mcp.server_old.manager.manager import (
            update_instance_status as update_and_restart_mcp_server,
        )

        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        # 从 manager 获取实时状态
        manager_status = await get_mcp_server_status(api_key)

        # 检查运行状态与repo中状态的一致性
        is_running = manager_status.get("running", False)
        if not is_running and instance.status == 1:
            log_info(f"MCP实例 {api_key} 进程不在运行但状态是开启，尝试自动重启进程")
            try:
                # 调用 manager 启动实例
                instance_info = await update_and_restart_mcp_server(
                    api_key=api_key,
                    status=1,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    table_id=instance.table_id,
                    port=instance.port,  # 尝试使用原有端口，如果不可用则分配新端口
                    register_tools=instance.register_tools,
                )

                # 更新 repository 中的端口和进程信息
                new_port = instance_info.get("port", instance.port)
                new_docker_info = instance_info.get("docker_info", instance.docker_info)

                self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    table_id=instance.table_id,
                    json_pointer=instance.json_pointer,
                    status=1,  # 保持开启状态
                    port=new_port,
                    docker_info=new_docker_info,
                    tools_definition=instance.tools_definition,
                    register_tools=instance.register_tools,
                    preview_keys=instance.preview_keys,
                )

                # 更新实例对象
                instance.port = new_port
                instance.docker_info = new_docker_info
                instance.status = 1

                # 重新获取 manager 状态
                manager_status = await get_mcp_server_status(api_key)

                log_info(f"MCP实例 {api_key} 重启成功，端口: {new_port}")
            except Exception as restart_error:
                log_error(f"MCP实例 {api_key} 重启失败: {restart_error}")
                # 启动失败，更新状态为关闭
                self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    table_id=instance.table_id,
                    json_pointer=instance.json_pointer,
                    status=0,  # 更新为关闭状态
                    port=instance.port,
                    docker_info=instance.docker_info,
                    tools_definition=instance.tools_definition,
                    register_tools=instance.register_tools,
                    preview_keys=instance.preview_keys,
                )
                instance.status = 0

        return {
            "status": instance.status,
            "port": instance.port,
            "json_pointer": instance.json_pointer,
            "tools_definition": instance.tools_definition,
            "register_tools": instance.register_tools,
            "preview_keys": instance.preview_keys,
            "docker_info": instance.docker_info,
            "manager_status": manager_status,
            "synced": True,
        }

    async def _sync_all_instances_status(self) -> Dict[str, Any]:
        """
        同步所有 MCP 实例的状态

        检查 repository 中所有实例的进程状态，更新不一致的状态
        如果发现进程不存在但 repository 中 status=1，会尝试启动新的进程

        Returns:
            同步结果统计
        """
        from src.mcp.server_old.manager.manager import (
            update_instance_status as update_and_restart_mcp_server,
        )
        from src.mcp.server_old.manager.manager import (
            get_instance_status as get_mcp_server_status,
        )

        # 获取所有实例
        repo = self.instance_repo
        instances = repo.get_all()

        synced_count = 0
        restarted_count = 0
        stopped_count = 0
        error_count = 0

        for instance in instances:
            try:
                # 检查进程状态
                manager_status = await get_mcp_server_status(instance.api_key)
                is_running = manager_status.get("running", False)

                # 如果进程不在运行但 repository 中状态是开启，尝试启动进程
                if not is_running and instance.status == 1:
                    log_info(
                        f"Syncing instance {instance.api_key}: process not running but status is active, attempting to restart"
                    )
                    try:
                        # 调用 manager 启动实例
                        instance_info = await update_and_restart_mcp_server(
                            api_key=instance.api_key,
                            status=1,
                            user_id=instance.user_id,
                            project_id=instance.project_id,
                            table_id=instance.table_id,
                            port=instance.port,  # 尝试使用原有端口，如果不可用则分配新端口
                            register_tools=instance.register_tools,
                        )

                        # 更新 repository 中的端口和进程信息
                        new_port = instance_info.get("port", instance.port)
                        new_docker_info = instance_info.get(
                            "docker_info", instance.docker_info
                        )

                        repo.update_by_api_key(
                            api_key=instance.api_key,
                            user_id=instance.user_id,
                            project_id=instance.project_id,
                            table_id=instance.table_id,
                            json_pointer=instance.json_pointer,
                            status=1,  # 保持开启状态
                            port=new_port,
                            docker_info=new_docker_info,
                            tools_definition=instance.tools_definition,
                            register_tools=instance.register_tools,
                            preview_keys=instance.preview_keys,
                        )

                        log_info(
                            f"Instance {instance.api_key} restarted successfully on port {new_port}"
                        )
                        restarted_count += 1
                    except Exception as restart_error:
                        log_error(
                            f"Failed to restart instance {instance.api_key}: {restart_error}"
                        )
                        # 启动失败，更新状态为关闭
                        repo.update_by_api_key(
                            api_key=instance.api_key,
                            user_id=instance.user_id,
                            project_id=instance.project_id,
                            table_id=instance.table_id,
                            json_pointer=instance.json_pointer,
                            status=0,
                            port=instance.port,
                            docker_info=instance.docker_info,
                            tools_definition=instance.tools_definition,
                            register_tools=instance.register_tools,
                            preview_keys=instance.preview_keys,
                        )
                        stopped_count += 1
                elif is_running and instance.status == 0:
                    log_info(
                        f"Syncing instance {instance.api_key}: process is running but status is inactive, updating status to active"
                    )
                    repo.update_by_api_key(
                        api_key=instance.api_key,
                        user_id=instance.user_id,
                        project_id=instance.project_id,
                        table_id=instance.table_id,
                        json_pointer=instance.json_pointer,
                        status=1,
                        port=instance.port,
                        docker_info=instance.docker_info,
                        tools_definition=instance.tools_definition,
                        register_tools=instance.register_tools,
                        preview_keys=instance.preview_keys,
                    )
                    synced_count += 1
                else:
                    synced_count += 1
            except Exception as e:
                log_error(f"Error syncing instance {instance.api_key}: {e}")
                error_count += 1

        result = {
            "total": len(instances),
            "synced": synced_count,
            "restarted": restarted_count,
            "stopped": stopped_count,
            "errors": error_count,
        }

        log_info(f"Instance status sync completed: {result}")
        return result

    async def recover_instances_on_startup(self) -> Dict[str, Any]:
        """
        应用启动时恢复实例状态

        检查 repository 中所有标记为"开启"的实例，如果进程不存在，会尝试启动新的进程
        如果启动失败，则更新状态为"关闭"
        这个方法应该在应用启动时调用

        Returns:
            恢复结果统计（包含 synced, restarted, stopped, errors 等字段）
        """
        log_info("Starting instance recovery on application startup...")
        return await self._sync_all_instances_status()

    ### 基础查询方法 ###

    async def get_mcp_instance_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        """
        根据 API key 获取 MCP 实例

        Args:
            api_key: API key

        Returns:
            McpInstance 对象，如果不存在则返回 None
        """
        return self.instance_repo.get_by_api_key(api_key)

    async def get_mcp_instance_by_id(
        self, mcp_instance_id: int
    ) -> Optional[McpInstance]:
        """
        根据实例ID获取 MCP 实例

        Args:
            mcp_instance_id: 实例ID

        Returns:
            McpInstance 对象，如果不存在则返回 None
        """
        return self.instance_repo.get_by_id(mcp_instance_id)

    async def shutdown_all_instances(self) -> Dict[str, Any]:
        """
        关闭所有 MCP 实例（应用关闭时调用）

        停止所有正在运行的 MCP 进程,并清理资源

        Returns:
            关闭结果统计
        """
        log_info("Shutting down all MCP instances...")

        try:
            # 调用 manager 关闭所有进程
            await shutdown_all_mcp_servers()

            # 获取所有实例
            instances = self.instance_repo.get_all()

            result = {
                "total": len(instances),
                "stopped": len(instances),
                "errors": 0,
            }

            log_info(f"MCP instances shutdown completed: {result}")
            return result
        except Exception as e:
            log_error(f"Error during MCP instances shutdown: {e}")
            instances = self.instance_repo.get_all()
            return {
                "total": len(instances),
                "stopped": 0,
                "errors": len(instances),
            }

    async def get_user_mcp_instances(self, user_id: str) -> List[McpInstance]:
        """
        获取用户的所有 MCP 实例

        Args:
            user_id: 用户ID

        Returns:
            McpInstance 列表
        """
        return self.instance_repo.get_by_user_id(user_id)

    async def get_mcp_instance_by_api_key_with_access_check(
        self, api_key: str, user_id: str
    ) -> McpInstance:
        """
        获取 MCP 实例并验证用户权限

        Args:
            api_key: API key
            user_id: 用户ID

        Returns:
            已验证的 McpInstance 对象

        Raises:
            NotFoundException: 如果实例不存在或用户无权限
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        # 检查用户权限
        if instance.user_id != user_id:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        return instance
