import random
import secrets
import socket
from typing import Dict, Optional, Any, List
from app.mcp_server.manager.process_backend import ProcessBackend
from app.utils.logger import log_info, log_error

# 全局后端实例
backend = ProcessBackend()

# 端口范围
PORT_MIN = 9001
PORT_MAX = 9300
# 已分配的端口集合
_allocated_ports: set[int] = set()


def allocate_port() -> int:
    """
    分配一个可用的端口号
    检查端口是否已被占用
    """
    max_attempts = 100
    for _ in range(max_attempts):
        port = random.randint(PORT_MIN, PORT_MAX)
        
        # 检查端口是否已被分配
        if port in _allocated_ports:
            continue
        
        # 检查端口是否被系统占用
        if _is_port_available(port):
            _allocated_ports.add(port)
            return port
    
    raise RuntimeError(f"无法在 {PORT_MIN}-{PORT_MAX} 范围内找到可用端口")


def _is_port_available(port: int) -> bool:
    """
    检查端口是否可用
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            result = s.connect_ex(('localhost', port))
            return result != 0  # 0 表示连接成功，端口被占用
    except Exception:
        return False


def release_port(port: int) -> None:
    """
    释放端口
    """
    _allocated_ports.discard(port)


async def create_instance(
    api_key: str,
    user_id: str,
    project_id: str,
    context_id: str,
    register_tools: Optional[List[str]] = None,
    port: Optional[int] = None
) -> Dict:
    """
    创建一个 MCP 实例
    
    Args:
        api_key: API key（由外部生成）
        user_id: 用户ID
        project_id: 项目ID
        context_id: 上下文ID
        register_tools: 需要注册的工具列表（可选）
        port: 指定端口（可选），如果提供则使用该端口，否则分配新端口
        
    Returns:
        包含实例信息的字典：port, docker_info
    """
    try:
        # 分配端口
        if port is None:
            port = allocate_port()
        else:
            # 如果提供了端口，确保它被标记为已分配
            if port not in _allocated_ports:
                _allocated_ports.add(port)
        
        log_info(f"Creating MCP instance with api_key={api_key}, port={port}")
        
        # 启动 MCP server 实例
        docker_info = await backend.start_instance(
            instance_id=api_key,  # 使用 api_key 作为 instance_id
            config={
                "port": port,
                "api_key": api_key,
                "user_id": user_id,
                "project_id": project_id,
                "context_id": context_id,
                "register_tools": register_tools
            }
        )
        
        # TODO: 添加动态路由规则
        # 这里需要根据实际的路由系统来实现
        # 例如：将 api_key 映射到对应的端口，或者设置反向代理规则
        
        return {
            "port": port,
            "docker_info": docker_info
        }
    except Exception as e:
        log_error(f"Failed to create MCP instance: {e}")
        # 如果启动失败，释放端口
        if 'port' in locals():
            release_port(port)
        raise


async def delete_instance(api_key: str) -> None:
    """
    删除一个 MCP 实例
    
    Args:
        api_key: API key（作为 instance_id）
    """
    try:
        # 停止实例
        await backend.delete_instance(api_key)
        
        # TODO: 删除动态路由规则
        
        log_info(f"MCP instance {api_key} deleted")
    except Exception as e:
        log_error(f"Failed to delete MCP instance {api_key}: {e}")
        raise


async def get_instance_status(api_key: str) -> Dict:
    """
    获取实例状态
    
    Args:
        api_key: API key（作为 instance_id）
        
    Returns:
        状态信息字典
    """
    return await backend.get_status(api_key)


async def update_instance_status(
    api_key: str,
    status: int,
    user_id: str = None,
    project_id: str = None,
    context_id: str = None,
    port: int = None,
    register_tools: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    更新实例状态（启动或停止）
    
    Args:
        api_key: API key（作为 instance_id）
        status: 状态，0表示关闭，1表示开启
        user_id: 用户ID（启动时需要）
        project_id: 项目ID（启动时需要）
        context_id: 上下文ID（启动时需要）
        port: 端口号（启动时需要，如果未提供则重新分配）
        register_tools: 需要注册的工具列表（可选，启动时需要）
        
    Returns:
        如果启动成功，返回包含 port 和 docker_info 的字典；如果停止，返回空字典
    """
    if status == 0:
        # 停止实例
        await backend.stop_instance(api_key)
        # 注意：不释放端口，因为端口信息需要保留在 repository 中
        # 端口会在实例删除时释放
        return {}
    elif status == 1:
        # 启动实例
        if not all([user_id, project_id, context_id]):
            raise ValueError("user_id, project_id, and context_id are required to start an instance")
        
        # 处理端口分配
        if port is None:
            # 未提供端口，分配新端口
            port = allocate_port()
        elif not _is_port_available(port):
            # 端口已被系统占用，分配新端口
            if port in _allocated_ports:
                # 从已分配列表中移除（可能之前分配过但进程已停止）
                release_port(port)
            port = allocate_port()
        else:
            # 端口可用，检查是否已在分配列表中
            if port not in _allocated_ports:
                # 标记为已分配
                _allocated_ports.add(port)
            # 如果已在列表中，说明是重新启动，继续使用该端口
        
        log_info(f"Restarting MCP instance with api_key={api_key}, port={port}")
        
        # 启动 MCP server 实例
        docker_info = await backend.start_instance(
            instance_id=api_key,
            config={
                "port": port,
                "api_key": api_key,
                "user_id": user_id,
                "project_id": project_id,
                "context_id": context_id,
                "register_tools": register_tools
            }
        )
        
        # 验证进程状态
        status_info = await backend.get_status(api_key)
        if not status_info.get("running", False):
            # 进程启动失败，释放端口
            release_port(port)
            raise RuntimeError(f"MCP server process failed to start. Status: {status_info}")
        
        return {
            "port": port,
            "docker_info": docker_info
        }
    else:
        raise ValueError(f"Invalid status: {status}, must be 0 or 1")
