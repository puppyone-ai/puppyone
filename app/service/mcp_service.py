"""
负责 MCP 实例的创建、管理和 token 生成
"""
import jwt
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from app.core.config import settings
from app.schemas.mcp import McpTokenPayload
from app.repositories.base import McpInstanceRepositoryBase
from app.models.mcp import McpInstance
from app.mcp_server.manager.manager import (
    create_instance as manager_create_instance,
    delete_instance as manager_delete_instance,
    get_instance_status as manager_get_instance_status,
    update_instance_status as manager_update_instance_status,
    release_port
)
from app.utils.logger import log_info, log_error


class McpService:
    """
    MCP 实例服务
    负责 MCP 实例的创建、管理以及 JWT token 的生成和验证
    """
    
    def __init__(self, instance_repo: McpInstanceRepositoryBase):
        self.instance_repo = instance_repo

    def generate_mcp_token(self, user_id: str, project_id: str, context_id: str) -> str:
        """
        生成 MCP JWT token
        
        Args:
            user_id: 用户ID
            project_id: 项目ID
            context_id: 上下文ID
            
        Returns:
            JWT token 字符串
        """
        payload = {
            "user_id": str(user_id),
            "project_id": str(project_id),
            "context_id": str(context_id),
            "iat": datetime.now(timezone.utc),
        }
        token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
        return token
    
    def decode_mcp_token(self, token: str) -> McpTokenPayload:
        """
        解码 MCP JWT token
        
        Args:
            token: JWT token 字符串
            
        Returns:
            McpTokenPayload 对象
            
        Raises:
            ValueError: 如果 token 无效或已过期
        """
        try:
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            return McpTokenPayload(**payload)
        except jwt.ExpiredSignatureError:
            raise ValueError("Token has expired")
        except jwt.InvalidTokenError:
            raise ValueError("Invalid token")
        except Exception as e:
            raise ValueError(f"Error decoding token: {e}")

    async def create_mcp_instance(
        self,
        user_id: str,
        project_id: str,
        context_id: str,
        tools_definition: Optional[Dict[str, Any]] = None
    ) -> McpInstance:
        """
        创建 MCP 实例
        
        流程：
        1. 生成 JWT token
        2. 调用 manager 创建 MCP server 实例（确保进程启动成功）
        3. 验证进程状态
        4. 存储到 repository（只有进程启动成功后才存储）
        5. 返回实例信息
        
        Args:
            user_id: 用户ID
            project_id: 项目ID
            context_id: 上下文ID
            tools_definition: 工具定义字典（可选），key只能是get/create/update/delete
            
        Returns:
            McpInstance 对象
            
        Raises:
            RuntimeError: 如果进程启动失败，不会存储数据
        """
        try:
            # 1. 生成 JWT token（作为 API key 使用）
            jwt_token = self.generate_mcp_token(user_id, project_id, context_id)
            api_key = jwt_token  # JWT token 作为 API key
            
            # 2. 先分配端口（但不启动进程）
            from app.mcp_server.manager.manager import allocate_port
            port = allocate_port()
            
            # 3. 先保存实例到 repository（状态为 0，表示未启动）
            # 这样 MCP server 启动时就能找到实例了
            mcp_instance = self.instance_repo.create(
                api_key=api_key,
                user_id=str(user_id),
                project_id=str(project_id),
                context_id=str(context_id),
                status=0,  # 先设为 0，启动成功后再更新为 1
                port=port,
                docker_info={},  # 先为空，启动成功后再更新
                tools_definition=tools_definition
            )
            
            log_info(f"MCP instance saved to repository: {mcp_instance.mcp_instance_id}, api_key={api_key}, port={port}")
            
            # 4. 调用 manager 创建 MCP server 实例
            # 注意：如果进程启动失败，需要清理已保存的实例
            try:
                instance_info = await manager_create_instance(
                    api_key=api_key,
                    user_id=str(user_id),
                    project_id=str(project_id),
                    context_id=str(context_id),
                    port=port  # 传入已分配的端口
                )
                
                docker_info = instance_info["docker_info"]
                
                # 5. 再次验证进程状态（双重检查）
                status_info = await manager_get_instance_status(api_key)
                if not status_info.get("running", False):
                    # 进程没有运行，清理已分配的端口和已保存的实例
                    from app.mcp_server.manager.manager import release_port
                    release_port(port)
                    self.instance_repo.delete_by_api_key(api_key)
                    raise RuntimeError(f"MCP server process failed to start or exited immediately. Status: {status_info}")
                
                # 6. 进程确认运行后，更新 repository 中的状态和进程信息
                updated_instance = self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=str(user_id),
                    project_id=str(project_id),
                    context_id=str(context_id),
                    status=1,  # 更新为开启状态
                    port=port,
                    docker_info=docker_info,
                    tools_definition=tools_definition
                )
                
                log_info(f"MCP instance created and verified: {updated_instance.mcp_instance_id}, api_key={api_key}, port={port}, pid={docker_info.get('pid')}")
                
                return updated_instance
            except Exception as e:
                # 如果进程启动失败，清理已保存的实例
                log_error(f"MCP server process failed to start, cleaning up instance: {e}")
                self.instance_repo.delete_by_api_key(api_key)
                from app.mcp_server.manager.manager import release_port
                release_port(port)
                raise
            
        except Exception as e:
            log_error(f"Failed to create MCP instance: {e}")
            raise

    async def get_mcp_instance_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        """
        根据 API key 获取 MCP 实例
        
        Args:
            api_key: API key
            
        Returns:
            McpInstance 对象，如果不存在则返回 None
        """
        return self.instance_repo.get_by_api_key(api_key)

    async def get_mcp_instance_by_id(self, mcp_instance_id: str) -> Optional[McpInstance]:
        """
        根据实例ID获取 MCP 实例
        
        Args:
            mcp_instance_id: 实例ID
            
        Returns:
            McpInstance 对象，如果不存在则返回 None
        """
        return self.instance_repo.get_by_id(mcp_instance_id)

    async def get_user_mcp_instances(self, user_id: str) -> List[McpInstance]:
        """
        获取用户的所有 MCP 实例
        
        Args:
            user_id: 用户ID
            
        Returns:
            McpInstance 列表
        """
        return self.instance_repo.get_by_user_id(user_id)

    async def update_mcp_instance(
        self,
        api_key: str,
        status: Optional[int] = None,
        tools_definition: Optional[Dict[str, Any]] = None
    ) -> Optional[McpInstance]:
        """
        更新 MCP 实例
        
        Args:
            api_key: API key
            status: 状态，0表示关闭，1表示开启
            tools_definition: 工具定义字典（可选），key只能是get/create/update/delete
            
        Returns:
            更新后的 McpInstance 对象，如果不存在则返回 None
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            return None
        
        # 如果只更新 tools_definition，需要重启实例以应用新的工具定义
        if status is None and tools_definition is not None:
            old_status = instance.status
            old_port = instance.port
            
            # 如果实例当前是开启状态，需要重启以应用新的工具定义
            if old_status == 1:
                log_info(f"Restarting MCP instance {api_key} to apply new tools_definition")
                
                # 先停止实例
                await manager_update_instance_status(
                    api_key=api_key,
                    status=0,
                    port=old_port
                )
                
                # 再启动实例（使用新的 tools_definition）
                instance_info = await manager_update_instance_status(
                    api_key=api_key,
                    status=1,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    context_id=instance.context_id,
                    port=old_port  # 尝试使用原有端口
                )
                
                # 更新端口和进程信息
                new_port = instance_info.get("port", old_port)
                new_docker_info = instance_info.get("docker_info", instance.docker_info)
                
                # 更新 repository 中的状态和进程信息，以及新的 tools_definition
                updated_instance = self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    context_id=instance.context_id,
                    status=1,  # 保持开启状态
                    port=new_port,
                    docker_info=new_docker_info,
                    tools_definition=tools_definition
                )
                
                log_info(f"MCP instance {api_key} restarted successfully with new tools_definition on port {new_port}")
                return updated_instance
            else:
                # 如果实例当前是关闭状态，只需要更新 repository
                updated_instance = self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    context_id=instance.context_id,
                    status=instance.status,
                    port=instance.port,
                    docker_info=instance.docker_info,
                    tools_definition=tools_definition
                )
                log_info(f"MCP instance {api_key} tools_definition updated (instance is stopped, will apply on next start)")
                return updated_instance
        
        # 更新状态
        if status is not None:
            old_status = instance.status
            old_port = instance.port
            
            # 如果状态从关闭变为开启，需要重新启动进程
            if old_status == 0 and status == 1:
                log_info(f"Restarting MCP instance {api_key} (status change: {old_status} -> {status})")
                
                # 调用 manager 重新启动实例
                instance_info = await manager_update_instance_status(
                    api_key=api_key,
                    status=status,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    context_id=instance.context_id,
                    port=old_port  # 尝试使用原有端口，如果不可用则分配新端口
                )
                
                # 更新端口和进程信息
                new_port = instance_info.get("port", old_port)
                new_docker_info = instance_info.get("docker_info", instance.docker_info)
                
                # 更新 repository 中的状态和进程信息
                updated_instance = self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    context_id=instance.context_id,
                    status=status,
                    port=new_port,
                    docker_info=new_docker_info,
                    tools_definition=tools_definition if tools_definition is not None else instance.tools_definition
                )
                
                log_info(f"MCP instance {api_key} restarted successfully on port {new_port}")
                return updated_instance
            
            # 如果状态从开启变为关闭，停止进程
            elif old_status == 1 and status == 0:
                log_info(f"Stopping MCP instance {api_key} (status change: {old_status} -> {status})")
                
                # 调用 manager 停止实例
                await manager_update_instance_status(
                    api_key=api_key,
                    status=status,
                    port=old_port
                )
                
                # 更新 repository 中的状态（保持端口和 docker_info，但状态改为关闭）
                updated_instance = self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    context_id=instance.context_id,
                    status=status,
                    port=old_port,
                    docker_info=instance.docker_info,  # 保留原有进程信息
                    tools_definition=tools_definition if tools_definition is not None else instance.tools_definition
                )
                
                log_info(f"MCP instance {api_key} stopped successfully")
                return updated_instance
            
            # 如果状态没有变化，只更新 repository（可能用于其他字段更新）
            else:
                log_info(f"MCP instance {api_key} status unchanged ({status}), updating repository only")
                updated_instance = self.instance_repo.update_by_api_key(
                    api_key=api_key,
                    user_id=instance.user_id,
                    project_id=instance.project_id,
                    context_id=instance.context_id,
                    status=status,
                    port=instance.port,
                    docker_info=instance.docker_info,
                    tools_definition=tools_definition if tools_definition is not None else instance.tools_definition
                )
                return updated_instance
        
        return instance

    async def delete_mcp_instance(self, api_key: str) -> bool:
        """
        删除 MCP 实例
        
        Args:
            api_key: API key
            
        Returns:
            是否成功删除
        """
        try:
            # 1. 先获取实例信息（用于释放端口）
            instance = self.instance_repo.get_by_api_key(api_key)
            if not instance:
                log_error(f"MCP instance not found: api_key={api_key}")
                return False
            
            # 2. 从 manager 删除实例（停止进程）
            await manager_delete_instance(api_key)
            
            # 3. 释放端口
            release_port(instance.port)
            
            # 4. 从 repository 删除记录
            result = self.instance_repo.delete_by_api_key(api_key)
            
            if result:
                log_info(f"MCP instance deleted: api_key={api_key}, port={instance.port} released")
            else:
                log_error(f"Failed to delete MCP instance from repository: api_key={api_key}")
            
            return result
        except Exception as e:
            log_error(f"Failed to delete MCP instance {api_key}: {e}")
            return False

    async def get_mcp_instance_status(self, api_key: str) -> Dict[str, Any]:
        """
        获取 MCP 实例状态
        
        Args:
            api_key: API key
            
        Returns:
            状态信息字典
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            return {"error": "Instance not found"}
        
        # 从 manager 获取实时状态
        manager_status = await manager_get_instance_status(api_key)
        
        # 同步状态：如果进程不在运行但 repository 中状态是开启，更新状态
        is_running = manager_status.get("running", False)
        if not is_running and instance.status == 1:
            log_info(f"Instance {api_key} process is not running but status is active, updating status to inactive")
            self.instance_repo.update_by_api_key(
                api_key=api_key,
                user_id=instance.user_id,
                project_id=instance.project_id,
                context_id=instance.context_id,
                status=0,  # 更新为关闭状态
                port=instance.port,
                docker_info=instance.docker_info,
                tools_definition=instance.tools_definition
            )
            instance.status = 0
        
        return {
            "status": instance.status,
            "port": instance.port,
            "tools_definition": instance.tools_definition,
            "docker_info": instance.docker_info,
            "manager_status": manager_status,
            "synced": True
        }
    
    async def sync_all_instances_status(self) -> Dict[str, Any]:
        """
        同步所有 MCP 实例的状态
        
        检查 repository 中所有实例的进程状态，更新不一致的状态
        如果发现进程不存在但 repository 中 status=1，会尝试启动新的进程
        
        Returns:
            同步结果统计
        """
        from app.repositories.mcp_repo import McpInstanceRepositoryJSON
        from app.mcp_server.manager.manager import update_instance_status as manager_update_instance_status
        
        # 获取所有实例（这里需要添加 get_all 方法到 repository）
        # 暂时通过读取文件获取所有实例
        repo = McpInstanceRepositoryJSON()
        instances = repo._read_data()
        
        synced_count = 0
        restarted_count = 0
        stopped_count = 0
        error_count = 0
        
        for instance in instances:
            try:
                # 检查进程状态
                manager_status = await manager_get_instance_status(instance.api_key)
                is_running = manager_status.get("running", False)
                
                # 如果进程不在运行但 repository 中状态是开启，尝试启动进程
                if not is_running and instance.status == 1:
                    log_info(f"Syncing instance {instance.api_key}: process not running but status is active, attempting to restart")
                    try:
                        # 调用 manager 启动实例
                        instance_info = await manager_update_instance_status(
                            api_key=instance.api_key,
                            status=1,
                            user_id=instance.user_id,
                            project_id=instance.project_id,
                            context_id=instance.context_id,
                            port=instance.port  # 尝试使用原有端口，如果不可用则分配新端口
                        )
                        
                        # 更新 repository 中的端口和进程信息 
                        new_port = instance_info.get("port", instance.port)
                        new_docker_info = instance_info.get("docker_info", instance.docker_info)
                        
                        repo.update_by_api_key(
                            api_key=instance.api_key,
                            user_id=instance.user_id,
                            project_id=instance.project_id,
                            context_id=instance.context_id,
                            status=1,  # 保持开启状态
                            port=new_port,
                            docker_info=new_docker_info,
                            tools_definition=instance.tools_definition
                        )
                        
                        log_info(f"Instance {instance.api_key} restarted successfully on port {new_port}")
                        restarted_count += 1
                    except Exception as restart_error:
                        log_error(f"Failed to restart instance {instance.api_key}: {restart_error}")
                        # 启动失败，更新状态为关闭
                        repo.update_by_api_key(
                            api_key=instance.api_key,
                            user_id=instance.user_id,
                            project_id=instance.project_id,
                            context_id=instance.context_id,
                            status=0,
                            port=instance.port,
                            docker_info=instance.docker_info,
                            tools_definition=instance.tools_definition
                        )
                        stopped_count += 1
                elif is_running and instance.status == 0:
                    log_info(f"Syncing instance {instance.api_key}: process is running but status is inactive, updating status to active")
                    repo.update_by_api_key(
                        api_key=instance.api_key,
                        user_id=instance.user_id,
                        project_id=instance.project_id,
                        context_id=instance.context_id,
                        status=1,
                        port=instance.port,
                        docker_info=instance.docker_info,
                        tools_definition=instance.tools_definition
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
            "errors": error_count
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
        return await self.sync_all_instances_status()