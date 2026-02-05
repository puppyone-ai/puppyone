"""沙盒文件处理工具函数"""

import asyncio
import os
import tempfile
from typing import Any, Optional
from src.config import settings


# 大文件内存警告阈值（100MB）
LARGE_FILE_MEMORY_WARNING_THRESHOLD = 100 * 1024 * 1024


async def download_files_parallel(
    files: list,
    s3_service: Optional[Any],
    max_concurrent: Optional[int] = None
) -> list[tuple[str, Any, Optional[str]]]:
    """
    并行下载文件内容
    
    Args:
        files: SandboxFile 列表，每个包含 path, content, s3_key
        s3_service: S3 服务实例
        max_concurrent: 最大并发数，默认使用配置值
        
    Returns:
        列表 [(path, content, error), ...]
        - content: 文件内容 (str/bytes) 或 None（如果下载失败）
        - error: 错误信息或 None
    """
    if max_concurrent is None:
        max_concurrent = settings.SANDBOX_DOWNLOAD_CONCURRENCY
    
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def download_one(f) -> tuple[str, Any, Optional[str]]:
        """下载单个文件"""
        async with semaphore:
            # 支持 dict 和对象两种形式
            path = f.get("path") if isinstance(f, dict) else getattr(f, "path", None)
            content = f.get("content") if isinstance(f, dict) else getattr(f, "content", None)
            s3_key = f.get("s3_key") if isinstance(f, dict) else getattr(f, "s3_key", None)
            
            if not path:
                return ("", None, "No path specified")
            
            # 如果已有内容，直接返回
            if content is not None:
                return (path, content, None)
            
            # 从 S3 下载
            if s3_key and s3_service:
                try:
                    # 检查文件大小
                    file_size = await _get_file_size(s3_service, s3_key)
                    
                    if file_size and file_size > LARGE_FILE_MEMORY_WARNING_THRESHOLD:
                        print(f"[file_utils] Warning: downloading large file ({file_size / 1024 / 1024:.1f}MB) to memory: {s3_key}")
                    
                    if file_size and file_size > settings.SANDBOX_LARGE_FILE_THRESHOLD:
                        # 大文件：使用分块下载（减少峰值内存）
                        content = await _download_file_chunked(s3_service, s3_key)
                    else:
                        # 小文件：直接下载
                        content = await s3_service.download_file(s3_key)
                    
                    return (path, content, None)
                except Exception as e:
                    return (path, None, f"Failed to download from S3: {e}")
            
            # 没有内容也没有 S3 key
            return (path, "", None)  # 返回空字符串表示空文件
    
    # 并行下载所有文件
    results = await asyncio.gather(*[download_one(f) for f in files])
    return list(results)


async def _get_file_size(s3_service: Any, s3_key: str) -> Optional[int]:
    """获取 S3 文件大小"""
    try:
        metadata = await s3_service.get_file_metadata(s3_key)
        return metadata.size
    except Exception:
        return None


async def _download_file_chunked(s3_service: Any, s3_key: str) -> bytes:
    """
    分块下载文件
    
    注意：此方法仍会将完整文件加载到内存，但通过分块下载可以：
    1. 减少单次内存分配的峰值
    2. 允许在下载过程中释放已处理的数据
    3. 提供更好的进度可见性
    
    对于真正的大文件处理，建议使用 download_file_to_disk 直接写入磁盘
    """
    chunks = []
    total_size = 0
    async for chunk in s3_service.download_file_stream(s3_key):
        chunks.append(chunk)
        total_size += len(chunk)
        # 每 10MB 打印一次进度
        if total_size % (10 * 1024 * 1024) < len(chunk):
            print(f"[file_utils] Downloaded {total_size / 1024 / 1024:.1f}MB of {s3_key}")
    
    return b"".join(chunks)


async def download_file_to_disk(
    s3_service: Any,
    s3_key: str,
    local_path: str
) -> int:
    """
    流式下载文件到本地磁盘（不占用大量内存）
    
    Args:
        s3_service: S3 服务实例
        s3_key: S3 文件 key
        local_path: 本地文件路径
        
    Returns:
        写入的字节数
    """
    # 确保目录存在
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    
    total_size = 0
    with open(local_path, "wb") as f:
        async for chunk in s3_service.download_file_stream(s3_key):
            f.write(chunk)
            total_size += len(chunk)
    
    return total_size


async def prepare_files_for_sandbox(
    files: list,
    s3_service: Optional[Any] = None
) -> tuple[list[dict], list[dict]]:
    """
    准备沙盒文件
    
    并行下载所有文件，返回准备好的文件列表和失败列表
    
    Args:
        files: SandboxFile 列表
        s3_service: S3 服务实例
        
    Returns:
        (prepared_files, failed_files)
        - prepared_files: [{"path": str, "content": str/bytes}, ...]
        - failed_files: [{"path": str, "error": str}, ...]
    """
    results = await download_files_parallel(files, s3_service)
    
    prepared_files = []
    failed_files = []
    
    for path, content, error in results:
        if not path:
            continue
        
        if error:
            failed_files.append({"path": path, "error": error})
        else:
            prepared_files.append({"path": path, "content": content})
    
    return prepared_files, failed_files


async def prepare_files_for_docker_sandbox(
    files: list,
    workspace_dir: str,
    s3_service: Optional[Any] = None
) -> tuple[list[str], list[dict]]:
    """
    为 Docker 沙盒准备文件，大文件直接写入磁盘
    
    Args:
        files: SandboxFile 列表
        workspace_dir: 本地 workspace 目录
        s3_service: S3 服务实例
        
    Returns:
        (written_paths, failed_files)
        - written_paths: 成功写入的文件路径列表
        - failed_files: [{"path": str, "error": str}, ...]
    """
    semaphore = asyncio.Semaphore(settings.SANDBOX_DOWNLOAD_CONCURRENCY)
    
    async def process_one(f) -> tuple[Optional[str], Optional[dict]]:
        """处理单个文件"""
        async with semaphore:
            # 支持 dict 和对象两种形式
            path = f.get("path") if isinstance(f, dict) else getattr(f, "path", None)
            content = f.get("content") if isinstance(f, dict) else getattr(f, "content", None)
            s3_key = f.get("s3_key") if isinstance(f, dict) else getattr(f, "s3_key", None)
            
            if not path:
                return (None, {"path": "", "error": "No path specified"})
            
            # 计算本地路径
            relative_path = path
            if path.startswith("/workspace/"):
                relative_path = path[len("/workspace/"):]
            elif path.startswith("/"):
                relative_path = path[1:]
            
            # 安全检查
            normalized_path = os.path.normpath(relative_path)
            if normalized_path.startswith("..") or normalized_path.startswith("/"):
                return (None, {"path": path, "error": "Path traversal detected"})
            
            local_path = os.path.join(workspace_dir, normalized_path)
            
            # 二次验证
            real_local_path = os.path.realpath(local_path)
            real_workspace_dir = os.path.realpath(workspace_dir)
            if not real_local_path.startswith(real_workspace_dir + os.sep) and real_local_path != real_workspace_dir:
                return (None, {"path": path, "error": "Path traversal detected (resolved)"})
            
            # 确保目录存在
            try:
                os.makedirs(os.path.dirname(local_path), exist_ok=True)
            except Exception as e:
                return (None, {"path": path, "error": f"Failed to create directory: {e}"})
            
            try:
                # 如果已有内容，直接写入
                if content is not None:
                    if isinstance(content, bytes):
                        with open(local_path, "wb") as file:
                            file.write(content)
                    elif isinstance(content, (dict, list)):
                        import json
                        with open(local_path, "w", encoding="utf-8") as file:
                            json.dump(content, file, ensure_ascii=False, indent=2)
                    else:
                        with open(local_path, "w", encoding="utf-8") as file:
                            file.write(str(content))
                    return (local_path, None)
                
                # 从 S3 下载
                if s3_key and s3_service:
                    file_size = await _get_file_size(s3_service, s3_key)
                    
                    if file_size and file_size > settings.SANDBOX_LARGE_FILE_THRESHOLD:
                        # 大文件：直接流式写入磁盘
                        await download_file_to_disk(s3_service, s3_key, local_path)
                    else:
                        # 小文件：下载到内存再写入
                        file_content = await s3_service.download_file(s3_key)
                        with open(local_path, "wb") as file:
                            file.write(file_content)
                    return (local_path, None)
                
                # 没有内容也没有 S3 key，创建空文件
                with open(local_path, "w", encoding="utf-8") as file:
                    pass
                return (local_path, None)
                
            except Exception as e:
                return (None, {"path": path, "error": str(e)})
    
    # 并行处理所有文件
    results = await asyncio.gather(*[process_one(f) for f in files])
    
    written_paths = []
    failed_files = []
    
    for written_path, failure in results:
        if failure:
            failed_files.append(failure)
        elif written_path:
            written_paths.append(written_path)
    
    return written_paths, failed_files
