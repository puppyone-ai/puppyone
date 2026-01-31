"""
GitHub Repository Processor

Core logic for processing GitHub repository imports.
Extracted from sync_task/service.py for reuse in ARQ jobs.
"""

from __future__ import annotations

import logging
import os
import tempfile
import zipfile
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.sync_task.models import SyncTask, SyncTaskStatus
from src.sync_task.repository import SyncTaskRepository

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
    
    Handles:
    - Downloading repository as ZIP
    - Extracting text files
    - Creating content nodes
    """

    def __init__(
        self,
        *,
        task_repository: SyncTaskRepository,
        state_repository: SyncStateRepositoryRedis,
        node_service: ContentNodeService,
        github_service: GithubOAuthService,
    ):
        self.task_repo = task_repository
        self.state_repo = state_repository
        self.node_service = node_service
        self.github_service = github_service

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

            # Get repo info for default branch
            async with httpx.AsyncClient(timeout=30.0) as client:
                repo_resp = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo}",
                    headers=headers,
                )
                repo_resp.raise_for_status()
                repo_data = repo_resp.json()
                default_branch = repo_data.get("default_branch", "main")

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
            await self.state_repo.set(state)

            # Create root synced node
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

            # Update database and Redis with progress info
            state.files_total = len(files)
            state.files_processed = 0
            await self.state_repo.set(state)
            await self.task_repo.update_progress(
                task_id, 40, f"Uploading... 0/{len(files)} files",
                files_total=len(files), files_processed=0
            )

            # Create folder structure and upload files
            folder_cache: Dict[str, str] = {}  # path -> node_id
            progress_interval = max(1, len(files) // 20)

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

                # Update progress periodically
                if (i + 1) % progress_interval == 0 or (i + 1) == len(files):
                    state.update_file_progress(i + 1, len(files))
                    await self.state_repo.set(state)
                    await self.task_repo.update_progress(
                        task_id, state.progress, state.progress_message,
                        files_processed=i + 1, files_total=len(files)
                    )

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

