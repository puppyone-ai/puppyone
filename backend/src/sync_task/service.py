"""
Sync Task Service

Business logic for sync tasks, including background job execution.
"""

import asyncio
import io
import os
import tempfile
import zipfile
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from src.connect.providers.github_provider import GithubProvider
from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_error, log_info

from .models import SyncTask, SyncTaskStatus, SyncTaskType
from .repository import SyncTaskRepository


# Progress callback type
ProgressCallback = Callable[[int, str, Optional[SyncTaskStatus]], None]


class SyncTaskService:
    """Service for managing sync tasks."""

    def __init__(
        self,
        repository: SyncTaskRepository,
        node_service: ContentNodeService,
        s3_service: S3Service,
        github_service: Optional[GithubOAuthService] = None,
    ):
        self.repository = repository
        self.node_service = node_service
        self.s3_service = s3_service
        self.github_service = github_service or GithubOAuthService()

    def detect_task_type(self, url: str) -> Optional[SyncTaskType]:
        """Detect task type from URL."""
        parsed = urlparse(url)
        host = parsed.netloc.lower()

        if host == "github.com" or host.endswith(".github.com"):
            return SyncTaskType.GITHUB_REPO
        if "notion.so" in host or "notion.site" in host:
            return SyncTaskType.NOTION_DATABASE
        if "airtable.com" in host:
            return SyncTaskType.AIRTABLE_BASE
        if "docs.google.com" in host and "spreadsheets" in url:
            return SyncTaskType.GOOGLE_SHEET
        if "linear.app" in host:
            return SyncTaskType.LINEAR_PROJECT

        return None

    async def create_task(
        self,
        user_id: str,
        project_id: str,
        url: str,
        task_type: Optional[SyncTaskType] = None,
    ) -> SyncTask:
        """Create a new sync task."""
        if task_type is None:
            task_type = self.detect_task_type(url)
            if task_type is None:
                raise ValueError(f"Cannot detect task type from URL: {url}")

        task = SyncTask(
            user_id=user_id,
            project_id=project_id,
            task_type=task_type,
            source_url=url,
            status=SyncTaskStatus.PENDING,
        )

        return await self.repository.create(task)

    async def get_task(self, task_id: int) -> Optional[SyncTask]:
        """Get a task by ID."""
        return await self.repository.get_by_id(task_id)

    async def get_user_tasks(
        self, user_id: str, include_completed: bool = True
    ) -> list[SyncTask]:
        """Get all tasks for a user."""
        return await self.repository.get_by_user(
            user_id, include_completed=include_completed
        )

    async def get_active_tasks(self, user_id: str) -> list[SyncTask]:
        """Get all active (non-terminal) tasks for a user."""
        return await self.repository.get_active_tasks(user_id)

    async def cancel_task(self, task_id: int, reason: Optional[str] = None) -> bool:
        """Cancel a task."""
        task = await self.repository.get_by_id(task_id)
        if task is None:
            return False
        if task.status.is_terminal():
            return False

        task.mark_cancelled(reason)
        await self.repository.update(task)
        return True

    async def execute_task(self, task_id: int) -> SyncTask:
        """Execute a sync task."""
        task = await self.repository.get_by_id(task_id)
        if task is None:
            raise ValueError(f"Task {task_id} not found")

        if task.status != SyncTaskStatus.PENDING:
            raise ValueError(f"Task {task_id} is not pending (status: {task.status})")

        try:
            if task.task_type == SyncTaskType.GITHUB_REPO:
                return await self._execute_github_import(task)
            else:
                raise ValueError(f"Unsupported task type: {task.task_type}")
        except Exception as e:
            log_error(f"Task {task_id} failed: {e}", exc_info=True)
            await self.repository.mark_failed(task_id, str(e))
            raise

    async def _execute_github_import(self, task: SyncTask) -> SyncTask:
        """Execute GitHub repository import with streaming download."""
        task_id = task.id

        # Update status to downloading
        await self.repository.update_progress(
            task_id, 0, "Starting download...", SyncTaskStatus.DOWNLOADING
        )

        provider = GithubProvider(task.user_id, self.github_service)
        
        try:
            # Parse URL to get repo info
            parsed = urlparse(task.source_url)
            path = parsed.path.strip("/")
            parts = path.split("/")
            if len(parts) < 2:
                raise ValueError(f"Invalid GitHub URL: {task.source_url}")
            owner, repo = parts[0], parts[1]

            # Get connection
            connection = await self.github_service.get_connection(task.user_id)
            if not connection:
                raise ValueError("Not connected to GitHub")

            token = connection.access_token
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            }

            # Get repo info
            async with httpx.AsyncClient(timeout=30.0) as client:
                repo_resp = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo}",
                    headers=headers,
                )
                repo_resp.raise_for_status()
                repo_data = repo_resp.json()
                default_branch = repo_data.get("default_branch", "main")

            # Stream download ZIP to temp file
            zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball/{default_branch}"
            files = await self._stream_download_and_extract(
                task_id, zip_url, headers
            )

            # Update status to uploading
            await self.repository.update_progress(
                task_id, 40, "Uploading files...", SyncTaskStatus.UPLOADING
            )

            # Create root node
            root_node = await self.node_service.create_synced_node(
                user_id=task.user_id,
                project_id=task.project_id,
                name=repo,
                sync_type="github_repo",
                sync_url=task.source_url,
                content=None,
                parent_id=None,
                sync_id=f"{owner}/{repo}",
            )
            root_node_id = root_node.id

            # Build folder structure and upload files
            total_files = len(files)
            await self.repository.update_progress(
                task_id, 40, f"Uploading... 0/{total_files} files",
                files_total=total_files, files_processed=0
            )

            # Track created folders
            folder_cache: Dict[str, str] = {}  # path -> node_id
            
            # Progress update interval (every N files)
            progress_interval = max(1, total_files // 20)  # Update ~20 times total
            last_progress_update = 0

            for i, file_info in enumerate(files):
                file_path = file_info["path"]
                file_name = file_info["name"]
                content = file_info["content"]

                # Create parent folders if needed
                parent_id = root_node_id
                path_parts = file_path.split("/")[:-1]  # Exclude filename
                current_path = ""

                for folder_name in path_parts:
                    current_path = f"{current_path}/{folder_name}" if current_path else folder_name
                    
                    if current_path not in folder_cache:
                        folder_node = self.node_service.create_folder(
                            user_id=task.user_id,
                            project_id=task.project_id,
                            name=folder_name,
                            parent_id=parent_id,
                        )
                        folder_cache[current_path] = folder_node.id
                    
                    parent_id = folder_cache[current_path]

                # Create file node
                await self.node_service.create_markdown_node(
                    user_id=task.user_id,
                    project_id=task.project_id,
                    name=file_name,
                    content=content,
                    parent_id=parent_id,
                )

                # Update progress less frequently to reduce DB calls
                if (i + 1) - last_progress_update >= progress_interval or (i + 1) == total_files:
                    last_progress_update = i + 1
                    progress = 40 + int(((i + 1) / total_files) * 50)
                    await self.repository.update_progress(
                        task_id, progress, f"Uploading... {i + 1}/{total_files} files",
                        files_processed=i + 1, files_total=total_files
                    )
                    log_info(f"Task {task_id}: Uploaded {i + 1}/{total_files} files")

            # Mark completed
            await self.repository.mark_completed(task_id, root_node_id)

            return await self.repository.get_by_id(task_id)

        finally:
            await provider.close()

    async def _stream_download_and_extract(
        self,
        task_id: int,
        url: str,
        headers: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        """Stream download ZIP and extract files."""
        files = []

        # 文本文件扩展名
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

        # 要跳过的模式
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

        # Create temp file for streaming download
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
                                if total_size > 0:
                                    progress = int((downloaded / total_size) * 30)
                                else:
                                    progress = min(25, downloaded // (1024 * 1024))

                                await self.repository.update_progress(
                                    task_id,
                                    progress,
                                    f"Downloading... {downloaded / 1024 / 1024:.1f}MB"
                                    + (f" / {total_size / 1024 / 1024:.1f}MB" if total_size else ""),
                                    bytes_downloaded=downloaded,
                                    bytes_total=total_size,
                                )

                log_info(f"Downloaded {downloaded} bytes to {tmp_path}")

                # Update status to extracting
                await self.repository.update_progress(
                    task_id, 32, "Extracting files...", SyncTaskStatus.EXTRACTING
                )

                # Extract files
                with zipfile.ZipFile(tmp_path, 'r') as zf:
                    for file_info in zf.infolist():
                        if file_info.is_dir():
                            continue

                        # Get relative path
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
                            log_error(f"Failed to read file {relative_path}: {e}")
                            continue

                log_info(f"Extracted {len(files)} text files from ZIP")

            finally:
                # Clean up temp file
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        return files

