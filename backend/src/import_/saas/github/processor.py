"""
GitHub Repository Processor

Core logic for processing GitHub repository imports.

设计原则（单节点模式）：
- 整个 GitHub repo 在数据库中只有一个节点
- 所有文件存储在 S3 目录下，保持目录结构
- 节点的 content 字段存储 repo 元信息（文件列表、统计等）
- 用户只能看到 repo 的基本信息，不暴露内部文件结构
- Agent 使用时从 S3 下载整个目录到 sandbox
"""

from __future__ import annotations

import logging
import os
import tempfile
import zipfile
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.sync_task.models import SyncTask, SyncTaskStatus
from src.sync_task.repository import SyncTaskRepository
from src.s3.service import S3Service

from ..models import SyncPhase, SyncRuntimeState
from ..state_repository import SyncStateRepositoryRedis

logger = logging.getLogger(__name__)


# Text file extensions to include
TEXT_EXTENSIONS = {
    '.md', '.txt', '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml',
    '.toml', '.cfg', '.ini', '.sh', '.bash', '.zsh', '.fish',
    '.html', '.css', '.scss', '.less', '.xml', '.svg',
    '.sql', '.graphql', '.gql',
    '.rs', '.go', '.java', '.kt', '.scala', '.rb', '.php', '.c', '.cpp', '.h', '.hpp',
    '.swift', '.m', '.mm', '.cs', '.fs', '.vb',
    '.r', '.R', '.jl', '.lua', '.pl', '.pm',
    '.dockerfile', '.gitignore', '.gitattributes', '.editorconfig',
    '.env', '.env.example', '.env.local',
    '.prettierrc', '.eslintrc', '.babelrc',
    'Makefile', 'Dockerfile', 'Procfile', 'Gemfile', 'Rakefile',
    '.lock', '.sum',
}

# Patterns to skip
SKIP_PATTERNS = {
    'node_modules/', '.git/', '__pycache__/', '.venv/', 'venv/',
    '.idea/', '.vscode/', '.DS_Store', 'Thumbs.db',
    '.pyc', '.pyo', '.so', '.dylib', '.dll', '.exe',
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp',
    '.mp3', '.mp4', '.wav', '.avi', '.mov',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
}


class GithubRepoProcessor:
    """
    Processor for GitHub repository imports.
    
    单节点模式：
    - 下载 repo ZIP
    - 提取所有文本文件
    - 上传到 S3 目录（保持目录结构）
    - 创建单个 github_repo 节点（存储元信息）
    """

    def __init__(
        self,
        *,
        task_repository: SyncTaskRepository,
        state_repository: SyncStateRepositoryRedis,
        node_service: ContentNodeService,
        github_service: GithubOAuthService,
        s3_service: S3Service,  # 新增：需要 S3 服务
    ):
        self.task_repo = task_repository
        self.state_repo = state_repository
        self.node_service = node_service
        self.github_service = github_service
        self.s3_service = s3_service

    def _sanitize_s3_key(self, path: str) -> str:
        """
        对 S3 key 中的特殊字符进行转义
        
        S3/Supabase Storage 不支持某些字符，如 [] 等
        将其替换为下划线以确保兼容性
        """
        # 替换 S3 不支持的字符
        replacements = {
            '[': '_',
            ']': '_',
            '{': '_',
            '}': '_',
            '#': '_',
            '%': '_',
            '&': '_',
            '*': '_',
            '?': '_',
            '"': '_',
            "'": '_',
            '<': '_',
            '>': '_',
            '|': '_',
            '\\': '/',  # 反斜杠转正斜杠
        }
        
        result = path
        for old, new in replacements.items():
            result = result.replace(old, new)
        
        return result

    async def process(self, task_id: int) -> Dict[str, Any]:
        """
        Process a GitHub repository sync task.
        
        Args:
            task_id: The sync task ID
            
        Returns:
            Result dict with status and details
        """
        # Load task from database
        task = await self.task_repo.get_by_id(task_id)
        if not task:
            logger.warning(f"sync_github_repo_job: task not found: {task_id}")
            return {"ok": False, "error": "task_not_found"}

        # Check for cancellation
        if task.status == SyncTaskStatus.CANCELLED:
            logger.info(f"sync_github_repo_job: task cancelled in DB: {task_id}")
            return {"ok": True, "skipped": "cancelled"}

        # Initialize or load runtime state
        state = await self.state_repo.get(task_id)
        if state is None:
            state = SyncRuntimeState(
                task_id=task_id,
                user_id=task.user_id,
                project_id=task.project_id,
                task_type=task.task_type,
                source_url=task.source_url,
            )

        if state.status == SyncTaskStatus.CANCELLED:
            logger.info(f"sync_github_repo_job: task cancelled in Redis: {task_id}")
            return {"ok": True, "skipped": "cancelled"}

        # Update state to downloading
        state.mark_downloading()
        state.attempt_count += 1
        await self.state_repo.set(state)

        try:
            # Parse URL to get repo info
            parsed = urlparse(task.source_url)
            path = parsed.path.strip("/")
            parts = path.split("/")
            if len(parts) < 2:
                raise ValueError(f"Invalid GitHub URL: {task.source_url}")
            owner, repo = parts[0], parts[1]

            # Get OAuth connection
            connection = await self.github_service.get_connection(task.user_id)
            if not connection:
                raise ValueError("Not connected to GitHub")

            token = connection.access_token
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            }

            # Get repo info for default branch and description
            async with httpx.AsyncClient(timeout=30.0) as client:
                repo_resp = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo}",
                    headers=headers,
                )
                repo_resp.raise_for_status()
                repo_data = repo_resp.json()
                default_branch = repo_data.get("default_branch", "main")
                repo_description = repo_data.get("description", "")
                repo_html_url = repo_data.get("html_url", task.source_url)

            # Download and extract ZIP
            zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball/{default_branch}"
            files = await self._download_and_extract(
                task_id, zip_url, headers, state
            )

            # Check for cancellation after download
            latest_state = await self.state_repo.get(task_id)
            if latest_state and latest_state.status == SyncTaskStatus.CANCELLED:
                return {"ok": True, "skipped": "cancelled"}

            # Update state to uploading
            state.mark_uploading()
            state.files_total = len(files)
            state.files_processed = 0
            await self.state_repo.set(state)
            await self.task_repo.update_progress(
                task_id, 40, f"Uploading... 0/{len(files)} files",
                files_total=len(files), files_processed=0
            )

            # === 单节点模式：上传所有文件到 S3 目录 ===
            s3_prefix = f"users/{task.user_id}/repos/{owner}_{repo}"
            file_manifest = []  # 记录所有文件信息
            total_size = 0
            progress_interval = max(1, len(files) // 20)

            for i, file_info in enumerate(files):
                file_path = file_info["path"]
                file_name = file_info["name"]
                content = file_info["content"]
                file_size = file_info["size"]

                # 上传到 S3，保持目录结构
                # 对特殊字符进行转义（S3 不支持 [] 等字符）
                safe_file_path = self._sanitize_s3_key(file_path)
                s3_key = f"{s3_prefix}/{safe_file_path}"
                content_bytes = content.encode('utf-8')
                
                await self.s3_service.upload_file(
                    key=s3_key,
                    content=content_bytes,
                    content_type="text/plain",
                )

                # 记录文件信息
                file_manifest.append({
                    "path": file_path,
                    "name": file_name,
                    "size": file_size,
                    "s3_key": s3_key,
                })
                total_size += file_size

                # Update progress periodically
                if (i + 1) % progress_interval == 0 or (i + 1) == len(files):
                    state.update_file_progress(i + 1, len(files))
                    await self.state_repo.set(state)
                    await self.task_repo.update_progress(
                        task_id, state.progress, state.progress_message,
                        files_processed=i + 1, files_total=len(files)
                    )

            # === 创建单个 github_repo 节点 ===
            # content 字段存储 repo 元信息
            repo_metadata = {
                "owner": owner,
                "repo": repo,
                "full_name": f"{owner}/{repo}",
                "description": repo_description,
                "default_branch": default_branch,
                "html_url": repo_html_url,
                "file_count": len(files),
                "total_size_bytes": total_size,
                "s3_prefix": s3_prefix,  # Agent 用这个前缀下载所有文件
                "files": file_manifest,  # 完整文件列表
                "synced_at": datetime.utcnow().isoformat(),
            }

            root_node = await self.node_service.create_github_repo_node(
                user_id=task.user_id,
                project_id=task.project_id,
                name=repo,
                sync_url=task.source_url,
                sync_id=f"{owner}/{repo}",
                s3_prefix=s3_prefix,
                metadata=repo_metadata,
            )
            root_node_id = root_node.id

            # Mark completed
            state.mark_completed(root_node_id)
            await self.state_repo.set_terminal(state)
            await self.task_repo.mark_completed(task_id, root_node_id)

            logger.info(f"sync_github_repo_job: completed task_id={task_id}, "
                       f"files={len(files)}, root_node={root_node_id}")

            return {
                "ok": True,
                "task_id": task_id,
                "root_node_id": root_node_id,
                "files_count": len(files),
            }

        except Exception as e:
            error_msg = str(e)
            logger.error(f"sync_github_repo_job failed task_id={task_id}: {e}", exc_info=True)

            state.mark_failed(error_msg, stage=state.phase.value if state.phase else "unknown")
            await self.state_repo.set_terminal(state)
            await self.task_repo.mark_failed(task_id, error_msg)

            return {"ok": False, "error": error_msg}

    async def _download_and_extract(
        self,
        task_id: int,
        url: str,
        headers: Dict[str, str],
        state: SyncRuntimeState,
    ) -> List[Dict[str, Any]]:
        """
        Stream download ZIP and extract text files.
        
        Args:
            task_id: Task ID for progress updates
            url: GitHub ZIP download URL
            headers: HTTP headers with auth
            state: Runtime state for progress tracking
            
        Returns:
            List of file info dicts with path, name, content, size
        """
        files = []

        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp_file:
            tmp_path = tmp_file.name

            try:
                async with httpx.AsyncClient(timeout=300.0) as client:
                    async with client.stream(
                        "GET", url, headers=headers, follow_redirects=True
                    ) as response:
                        response.raise_for_status()

                        total_size = int(response.headers.get("content-length", 0))
                        downloaded = 0
                        last_progress_update = 0

                        async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                            tmp_file.write(chunk)
                            downloaded += len(chunk)

                            # Update progress every 500KB
                            if downloaded - last_progress_update > 500 * 1024:
                                last_progress_update = downloaded
                                state.update_download_progress(downloaded, total_size)
                                await self.state_repo.set(state)
                                await self.task_repo.update_progress(
                                    task_id,
                                    state.progress,
                                    state.progress_message,
                                    bytes_downloaded=downloaded,
                                    bytes_total=total_size,
                                )

                logger.info(f"Downloaded {downloaded} bytes to {tmp_path}")

                # Update state to extracting
                state.mark_extracting()
                await self.state_repo.set(state)
                await self.task_repo.update_progress(
                    task_id, 32, "Extracting files...", SyncTaskStatus.EXTRACTING
                )

                # Extract files
                with zipfile.ZipFile(tmp_path, 'r') as zf:
                    for file_info in zf.infolist():
                        if file_info.is_dir():
                            continue

                        # Get relative path (skip root folder created by GitHub)
                        full_path = file_info.filename
                        parts = full_path.split('/', 1)
                        if len(parts) < 2:
                            continue
                        relative_path = parts[1]

                        if not relative_path:
                            continue

                        # Skip unwanted files
                        should_skip = False
                        for pattern in SKIP_PATTERNS:
                            if pattern in relative_path or relative_path.endswith(pattern):
                                should_skip = True
                                break
                        if should_skip:
                            continue

                        # Check if text file
                        file_name = relative_path.split('/')[-1]
                        file_ext = '.' + file_name.split('.')[-1].lower() if '.' in file_name else ''
                        is_text = (
                            file_ext in TEXT_EXTENSIONS or
                            file_name in TEXT_EXTENSIONS
                        )

                        if not is_text:
                            continue

                        try:
                            raw_content = zf.read(file_info)
                            content = raw_content.decode('utf-8')

                            files.append({
                                "path": relative_path,
                                "name": file_name,
                                "content": content,
                                "size": file_info.file_size,
                            })
                        except (UnicodeDecodeError, Exception) as e:
                            logger.debug(f"Skipping non-text file {relative_path}: {e}")
                            continue

                logger.info(f"Extracted {len(files)} text files from ZIP")

            finally:
                # Clean up temp file
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        return files
