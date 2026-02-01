"""
GitHub Handler - Process GitHub repository imports.

Design (single-node mode):
- Download repo as ZIP
- Extract text files
- Upload to S3 directory (preserving structure)
- Create single github_repo node with metadata

Also provides preview functionality for repos, issues, PRs, and projects.
"""

import asyncio
import base64
import os
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.s3.service import S3Service
from src.import_.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.import_.task.models import ImportTask, ImportTaskType
from src.utils.logger import log_info, log_error, log_debug


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


class GithubHandler(BaseHandler):
    """Handler for GitHub repository imports."""

    def __init__(
        self,
        node_service: ContentNodeService,
        github_service: GithubOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.github_service = github_service
        self.s3_service = s3_service

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.GITHUB

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process GitHub repo import."""
        
        if not task.source_url:
            raise ValueError("source_url is required for GitHub import")

        # Parse URL
        parsed = urlparse(task.source_url)
        path = parsed.path.strip("/")
        parts = path.split("/")
        if len(parts) < 2:
            raise ValueError(f"Invalid GitHub URL: {task.source_url}")
        owner, repo = parts[0], parts[1]

        on_progress(5, f"Connecting to GitHub...")

        # Get OAuth connection
        connection = await self.github_service.get_connection(task.user_id)
        if not connection:
            raise ValueError("Not connected to GitHub. Please authorize first.")

        token = connection.access_token
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        }

        on_progress(10, f"Fetching repo info...")

        # Get repo info
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

        on_progress(15, f"Downloading repository...")

        # Download and extract
        zip_url = f"https://api.github.com/repos/{owner}/{repo}/zipball/{default_branch}"
        files = await self._download_and_extract(zip_url, headers, on_progress)

        on_progress(50, f"Uploading {len(files)} files to storage...")

        # Upload to S3
        s3_prefix = f"users/{task.user_id}/repos/{owner}_{repo}"
        file_manifest = []
        total_size = 0
        
        for i, file_info in enumerate(files):
            file_path = file_info["path"]
            content = file_info["content"]
            file_size = file_info["size"]

            # Sanitize and upload
            safe_path = self._sanitize_s3_key(file_path)
            s3_key = f"{s3_prefix}/{safe_path}"
            
            await self.s3_service.upload_file(
                key=s3_key,
                content=content.encode('utf-8'),
                content_type="text/plain",
            )

            file_manifest.append({
                "path": file_path,
                "name": file_info["name"],
                "size": file_size,
                "s3_key": s3_key,
            })
            total_size += file_size

            # Update progress (50-90%)
            progress = 50 + int((i + 1) / len(files) * 40)
            if (i + 1) % max(1, len(files) // 10) == 0:
                on_progress(progress, f"Uploading... {i + 1}/{len(files)} files")

        on_progress(92, "Creating content node...")

        # Create single github_repo node
        repo_metadata = {
            "owner": owner,
            "repo": repo,
            "full_name": f"{owner}/{repo}",
            "description": repo_description,
            "default_branch": default_branch,
            "html_url": repo_html_url,
            "file_count": len(files),
            "total_size_bytes": total_size,
            "s3_prefix": s3_prefix,
            "files": file_manifest,
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

        on_progress(100, "Completed")
        log_info(f"GitHub import completed: {owner}/{repo}, {len(files)} files")

        return ImportResult(
            content_node_id=root_node.id,
            items_count=len(files),
            metadata={"owner": owner, "repo": repo},
        )

    async def _download_and_extract(
        self,
        url: str,
        headers: dict[str, str],
        on_progress: ProgressCallback,
    ) -> list[dict[str, Any]]:
        """Download ZIP and extract text files."""
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

                        async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                            tmp_file.write(chunk)
                            downloaded += len(chunk)

                            # Update progress (15-35%)
                            if total_size > 0:
                                progress = 15 + int((downloaded / total_size) * 20)
                                on_progress(progress, f"Downloading... {downloaded // 1024}KB")

                on_progress(38, "Extracting files...")

                # Extract
                with zipfile.ZipFile(tmp_path, 'r') as zf:
                    for file_info in zf.infolist():
                        if file_info.is_dir():
                            continue

                        full_path = file_info.filename
                        parts = full_path.split('/', 1)
                        if len(parts) < 2:
                            continue
                        relative_path = parts[1]

                        if not relative_path:
                            continue

                        # Skip unwanted
                        if any(p in relative_path for p in SKIP_PATTERNS):
                            continue

                        # Check if text
                        file_name = relative_path.split('/')[-1]
                        file_ext = '.' + file_name.split('.')[-1].lower() if '.' in file_name else ''
                        if file_ext not in TEXT_EXTENSIONS and file_name not in TEXT_EXTENSIONS:
                            continue

                        try:
                            content = zf.read(file_info).decode('utf-8')
                            files.append({
                                "path": relative_path,
                                "name": file_name,
                                "content": content,
                                "size": file_info.file_size,
                            })
                        except UnicodeDecodeError:
                            continue

                log_info(f"Extracted {len(files)} text files")

            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        return files

    def _sanitize_s3_key(self, path: str) -> str:
        """Sanitize S3 key by replacing unsupported characters."""
        replacements = {
            '[': '_', ']': '_', '{': '_', '}': '_',
            '#': '_', '%': '_', '&': '_', '*': '_',
            '?': '_', '"': '_', "'": '_',
            '<': '_', '>': '_', '|': '_', '\\': '/',
        }
        result = path
        for old, new in replacements.items():
            result = result.replace(old, new)
        return result

    # ==================== Preview Functionality ====================

    API_BASE = "https://api.github.com"

    @dataclass
    class GithubResource:
        resource_type: str  # repo, issue, pull, project
        owner: str
        repo: str
        identifier: Optional[str] = None

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """
        Get preview data for a GitHub URL.
        
        Supports: repos, issues, PRs, projects.
        """
        connection = await self.github_service.get_connection(user_id)
        if not connection:
            raise ValueError("Not connected to GitHub. Please authorize first.")

        if await self.github_service.is_token_expired(user_id):
            connection = await self.github_service.refresh_token_if_needed(user_id)
            if not connection:
                raise ValueError("GitHub authorization expired. Please reconnect.")

        resource = self._match_resource(url)
        if not resource:
            raise ValueError(f"Unsupported GitHub URL: {url}")

        token = connection.access_token
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                if resource.resource_type == "repo":
                    return await self._preview_repo(client, resource, headers)
                if resource.resource_type == "issue":
                    return await self._preview_issue(client, resource, headers)
                if resource.resource_type == "pull":
                    return await self._preview_pull(client, resource, headers)
                if resource.resource_type == "project":
                    return await self._preview_project(client, resource, headers)

                raise ValueError(f"Unsupported GitHub resource type: {resource.resource_type}")

            except httpx.HTTPStatusError as e:
                if e.response.status_code in (401, 403):
                    raise ValueError("GitHub access denied. Please reconnect.")
                raise ValueError(f"GitHub API error ({e.response.status_code})")

    def _match_resource(self, url: str) -> Optional[GithubResource]:
        """Match URL to GitHub resource type."""
        path = urlparse(url).path.strip("/")
        parts = path.split("/")

        if len(parts) < 2:
            return None

        owner, repo = parts[0], parts[1]

        if len(parts) == 2:
            return self.GithubResource("repo", owner, repo)

        if len(parts) >= 4 and parts[2] == "issues":
            return self.GithubResource("issue", owner, repo, parts[3])

        if len(parts) >= 4 and parts[2] in {"pull", "pulls"}:
            return self.GithubResource("pull", owner, repo, parts[3])

        if len(parts) >= 3 and parts[2] == "projects":
            identifier = parts[3] if len(parts) > 3 else None
            return self.GithubResource("project", owner, repo, identifier)

        return self.GithubResource("repo", owner, repo)

    async def _preview_repo(
        self, client: httpx.AsyncClient, res: GithubResource, headers: Dict[str, str]
    ) -> PreviewResult:
        """Get preview for a repository."""
        repo_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}"
        readme_url = f"{repo_url}/readme"

        repo_resp, readme_resp = await asyncio.gather(
            client.get(repo_url, headers=headers),
            client.get(readme_url, headers=headers),
            return_exceptions=True
        )

        if isinstance(repo_resp, Exception):
            raise repo_resp
        repo_resp.raise_for_status()
        repo_data = repo_resp.json()

        readme_content = None
        if isinstance(readme_resp, httpx.Response) and readme_resp.status_code == 200:
            data = readme_resp.json()
            if data.get("encoding") == "base64" and data.get("content"):
                readme_content = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")

        topics = repo_data.get("topics", [])
        structured = [{
            "type": "repo",
            "id": repo_data.get("id"),
            "name": repo_data.get("name"),
            "full_name": repo_data.get("full_name"),
            "owner": repo_data.get("owner", {}).get("login"),
            "description": repo_data.get("description"),
            "stars": repo_data.get("stargazers_count"),
            "forks": repo_data.get("forks_count"),
            "language": repo_data.get("language"),
            "topics": ", ".join(topics),
            "default_branch": repo_data.get("default_branch"),
            "open_issues": repo_data.get("open_issues_count"),
            "html_url": repo_data.get("html_url"),
            "readme": readme_content,
        }]

        fields = [
            {"name": "name", "type": "string"},
            {"name": "full_name", "type": "string"},
            {"name": "description", "type": "text"},
            {"name": "stars", "type": "number"},
            {"name": "forks", "type": "number"},
            {"name": "language", "type": "string"},
        ]

        return PreviewResult(
            source_type="github_repo",
            title=f"GitHub repo: {repo_data.get('full_name')}",
            description=repo_data.get("description"),
            data=structured,
            fields=fields,
            total_items=1,
            structure_info={"type": "repo", "owner": res.owner, "repo": res.repo, "topics": topics},
        )

    async def _preview_issue(
        self, client: httpx.AsyncClient, res: GithubResource, headers: Dict[str, str]
    ) -> PreviewResult:
        """Get preview for an issue."""
        issue_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}/issues/{res.identifier}"
        comments_url = f"{issue_url}/comments"

        issue_resp, comments_resp = await asyncio.gather(
            client.get(issue_url, headers=headers),
            client.get(comments_url, headers=headers),
            return_exceptions=True
        )

        if isinstance(issue_resp, Exception):
            raise issue_resp
        issue_resp.raise_for_status()
        issue_data = issue_resp.json()

        comments = []
        if isinstance(comments_resp, httpx.Response) and comments_resp.status_code == 200:
            comments = comments_resp.json()

        structured = [{
            "type": "issue",
            "repo": f"{res.owner}/{res.repo}",
            "number": issue_data.get("number"),
            "title": issue_data.get("title"),
            "state": issue_data.get("state"),
            "author": issue_data.get("user", {}).get("login"),
            "labels": ", ".join([lbl.get("name", "") for lbl in issue_data.get("labels", [])]),
            "body": issue_data.get("body"),
            "comments_count": issue_data.get("comments"),
            "comments": [
                {"author": c.get("user", {}).get("login"), "body": c.get("body")}
                for c in comments[:5]
            ],
            "html_url": issue_data.get("html_url"),
        }]

        return PreviewResult(
            source_type="github_issue",
            title=f"Issue #{issue_data.get('number')}: {issue_data.get('title')}",
            description=f"Issue in {res.owner}/{res.repo}",
            data=structured,
            fields=[
                {"name": "number", "type": "number"},
                {"name": "title", "type": "string"},
                {"name": "state", "type": "string"},
            ],
            total_items=1,
            structure_info={"type": "issue", "number": issue_data.get("number"), "state": issue_data.get("state")},
        )

    async def _preview_pull(
        self, client: httpx.AsyncClient, res: GithubResource, headers: Dict[str, str]
    ) -> PreviewResult:
        """Get preview for a pull request."""
        pull_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}/pulls/{res.identifier}"
        reviews_url = f"{pull_url}/reviews"

        pull_resp, reviews_resp = await asyncio.gather(
            client.get(pull_url, headers=headers),
            client.get(reviews_url, headers=headers),
            return_exceptions=True
        )

        if isinstance(pull_resp, Exception):
            raise pull_resp
        pull_resp.raise_for_status()
        pull_data = pull_resp.json()

        reviews = []
        if isinstance(reviews_resp, httpx.Response) and reviews_resp.status_code == 200:
            reviews = reviews_resp.json()

        structured = [{
            "type": "pull",
            "repo": f"{res.owner}/{res.repo}",
            "number": pull_data.get("number"),
            "title": pull_data.get("title"),
            "state": pull_data.get("state"),
            "author": pull_data.get("user", {}).get("login"),
            "base_branch": pull_data.get("base", {}).get("ref"),
            "head_branch": pull_data.get("head", {}).get("ref"),
            "additions": pull_data.get("additions"),
            "deletions": pull_data.get("deletions"),
            "body": pull_data.get("body"),
            "merged": pull_data.get("merged"),
            "html_url": pull_data.get("html_url"),
        }]

        return PreviewResult(
            source_type="github_pull",
            title=f"PR #{pull_data.get('number')}: {pull_data.get('title')}",
            description=f"PR in {res.owner}/{res.repo}",
            data=structured,
            fields=[
                {"name": "number", "type": "number"},
                {"name": "title", "type": "string"},
                {"name": "state", "type": "string"},
                {"name": "additions", "type": "number"},
                {"name": "deletions", "type": "number"},
            ],
            total_items=1,
            structure_info={"type": "pull", "number": pull_data.get("number"), "merged": pull_data.get("merged")},
        )

    async def _preview_project(
        self, client: httpx.AsyncClient, res: GithubResource, headers: Dict[str, str]
    ) -> PreviewResult:
        """Get preview for a project."""
        if not res.identifier:
            raise ValueError("Project URL must include an ID or number")

        project_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}/projects/{res.identifier}"
        project_headers = {**headers, "Accept": "application/vnd.github.inertia-preview+json"}

        project_resp = await client.get(project_url, headers=project_headers)
        project_resp.raise_for_status()
        project_data = project_resp.json()

        structured = [{
            "name": project_data.get("name"),
            "body": project_data.get("body"),
            "state": project_data.get("state"),
            "creator": project_data.get("creator", {}).get("login"),
            "html_url": project_data.get("html_url"),
        }]

        return PreviewResult(
            source_type="github_project",
            title=f"GitHub Project: {project_data.get('name')}",
            description=f"Project in {res.owner}/{res.repo}",
            data=structured,
            fields=[
                {"name": "name", "type": "string"},
                {"name": "state", "type": "string"},
            ],
            total_items=1,
            structure_info={"type": "project", "id": project_data.get("id")},
        )

