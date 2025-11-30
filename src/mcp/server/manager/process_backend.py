import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Any
from src.mcp.server.manager.base_backend import MCPInstanceBackend
from src.utils.logger import log_info, log_error

class ProcessBackend(MCPInstanceBackend):
    """
    基于多进程的 MCP 实例后端实现
    通过 subprocess 启动独立的 MCP server 进程
    """
    
    def __init__(self):
        self.process_map: Dict[str, subprocess.Popen] = {}
        # 获取 backend 目录（项目根目录）
        # __file__ 是 backend/app/mcp_server/manager/process_backend.py
        # 向上4级：manager -> mcp_server -> app -> backend
        self.backend_root = Path(__file__).parent.parent.parent.parent
        # MCP server 脚本的相对路径（从 backend 目录）
        self.server_script = "app/mcp_server/server.py"

    async def start_instance(self, instance_id: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        启动一个 MCP 实例进程
        
        Args:
            instance_id: 实例ID
            config: 配置信息，包含 port, api_key 等
            
        Returns:
            包含进程信息的字典，用于存储到 docker_info 字段
        """
        port = config.get("port")
        api_key = config.get("api_key")
        register_tools = config.get("register_tools")
        
        if not port:
            raise ValueError("port is required in config")
        if not api_key:
            raise ValueError("api_key is required in config")
        
        try:
            # 检查是否可以使用 uv run
            use_uv = False
            try:
                result = subprocess.run(
                    ["uv", "--version"],
                    capture_output=True,
                    check=True,
                    timeout=2,
                    cwd=str(self.backend_root)
                )
                use_uv = True
                log_info(f"Using uv to run MCP server (uv version: {result.stdout.decode().strip()})")
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
                log_info("uv not found, using system Python interpreter")
            
            # 构建启动命令
            module_path = str(self.server_script).replace(str(self.backend_root) + "/", "").replace("/", ".").replace(".py", "")
            base_cmd = [
                "--host", "0.0.0.0",
                "--port", str(port),
                "--transport", "http",
                "--api_key", api_key
            ]
            
            # 添加 register_tools 参数（如果提供）
            if register_tools:
                # 将列表转换为逗号分隔的字符串
                register_tools_str = ",".join(register_tools)
                base_cmd.extend(["--register_tools", register_tools_str])
            
            if use_uv:
                # 使用 uv run 以模块方式运行（-m 参数确保正确的模块路径）
                cmd = [
                    "uv", "run",
                    "python", "-m", module_path
                ] + base_cmd
                command_str = f"uv run python -m {module_path} {' '.join(base_cmd)}"
            else:
                # 使用系统 Python 解释器，以模块方式运行
                cmd = [
                    sys.executable,
                    "-m", module_path
                ] + base_cmd
                command_str = f"{sys.executable} -m {module_path} {' '.join(base_cmd)}"
            
            log_info(f"Starting MCP server with command: {command_str}")
            log_info(f"Working directory: {self.backend_root}")
            
            # 创建日志文件目录
            log_dir = self.backend_root / "logs" / "mcp_instances"
            log_dir.mkdir(parents=True, exist_ok=True)
            
            # 为每个实例创建独立的日志文件
            stdout_log = log_dir / f"mcp_{instance_id[:20]}_stdout.log"
            stderr_log = log_dir / f"mcp_{instance_id[:20]}_stderr.log"
            
            # 打开日志文件（追加模式）
            stdout_file = open(stdout_log, "a")
            stderr_file = open(stderr_log, "a")
            
            try:
                # 启动 MCP server 进程
                # 每个实例通过唯一的端口号区分，避免了多实例冲突
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(self.backend_root),  # 确保在 backend 目录下运行
                    stdout=stdout_file,
                    stderr=stderr_file,
                    start_new_session=True,  # 创建新的进程组，避免父进程退出时子进程也被终止
                    bufsize=1  # 行缓冲，确保日志及时写入
                )
                
                # 等待一小段时间，检查进程是否立即退出
                time.sleep(1.0)  # 等待 1 秒，给进程更多启动时间
                
                # 检查进程状态
                returncode = proc.poll()
                if returncode is not None:
                    # 进程已经退出，读取错误信息
                    stdout_file.flush()
                    stderr_file.flush()
                    
                    # 读取日志文件内容
                    try:
                        with open(stderr_log, "r") as f:
                            stderr_output = f.read()[-2000:]  # 读取最后 2000 字符
                    except:
                        stderr_output = "Cannot read stderr log"
                    
                    try:
                        with open(stdout_log, "r") as f:
                            stdout_output = f.read()[-2000:]  # 读取最后 2000 字符
                    except:
                        stdout_output = "Cannot read stdout log"
                    
                    error_msg = f"Process exited immediately with return code {returncode}\nSTDERR (last 2000 chars):\n{stderr_output}\nSTDOUT (last 2000 chars):\n{stdout_output}"
                    log_error(f"MCP instance {instance_id} failed to start: {error_msg}")
                    log_error(f"Log files: stdout={stdout_log}, stderr={stderr_log}")
                    raise RuntimeError(f"Failed to start MCP server: {error_msg}")
                
                # 进程还在运行，保存文件句柄以便后续关闭
                # 注意：不能在这里关闭文件，因为进程还在使用它们
                # 文件会在进程退出时自动关闭，或者在 stop_instance 时处理
                
            except Exception:
                # 如果启动失败，关闭文件句柄
                stdout_file.close()
                stderr_file.close()
                raise
            
            self.process_map[instance_id] = proc
            
            log_info(f"MCP instance {instance_id} started successfully with PID {proc.pid} on port {port}")
            log_info(f"MCP instance logs: stdout={stdout_log}, stderr={stderr_log}")
            
            # 返回进程信息，用于存储到 docker_info
            return {
                "type": "process",
                "pid": proc.pid,
                "port": port,
                "api_key": api_key,
                "command": command_str,
                "working_directory": str(self.backend_root),
                "stdout_log": str(stdout_log),
                "stderr_log": str(stderr_log)
            }
        except Exception as e:
            log_error(f"Failed to start MCP instance {instance_id}: {e}")
            raise

    async def stop_instance(self, instance_id: str) -> None:
        """
        停止一个 MCP 实例进程
        """
        proc = self.process_map.get(instance_id)
        if not proc:
            log_error(f"MCP instance {instance_id} not found in process map")
            return
        
        try:
            # 尝试优雅终止
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # 如果5秒内没有终止，强制杀死
                log_info(f"Force killing MCP instance {instance_id} (PID {proc.pid})")
                proc.kill()
                proc.wait(timeout=2)
            
            del self.process_map[instance_id]
            log_info(f"MCP instance {instance_id} stopped")
        except Exception as e:
            log_error(f"Failed to stop MCP instance {instance_id}: {e}")
            # 即使出错也尝试从 map 中删除
            if instance_id in self.process_map:
                del self.process_map[instance_id]

    async def get_status(self, instance_id: str) -> Dict[str, Any]:
        """
        获取实例状态
        """
        proc = self.process_map.get(instance_id)
        if not proc:
            return {"running": False, "error": "Instance not found"}
        
        # 检查进程是否还在运行
        # poll() 返回 None 表示进程还在运行，返回其他值表示已退出
        is_running = proc.poll() is None
        
        return {
            "running": is_running,
            "pid": proc.pid,
            "returncode": proc.returncode if not is_running else None
        }
    
    async def delete_instance(self, instance_id: str) -> None:
        """
        删除实例（停止并清理资源）
        """
        await self.stop_instance(instance_id)