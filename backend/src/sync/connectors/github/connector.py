"""
GitHub Connector - Process GitHub repository imports.

Design (single-node mode):
- Download repo as ZIP
- Extract text files
- Upload to S3 directory (preserving structure)
- Create single github_repo node with metadata

Also provides preview functionality for repos, issues, PRs, and projects.
"""

import asyncio
import base64
import hashlib
import json
from urllib.parse import urlparse

import httpx

from src.content_node.service import ContentNodeService
from src.oauth.github_service import GithubOAuthService
from src.s3.service import S3Service
from src.sync.connectors._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    FetchResult,
    Credentials,
    ConfigField,
)


class GithubConnector(BaseConnector):
    """Connector for GitHub repository imports."""

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="github",
            display_name="GitHub",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="json",
            auth=AuthRequirement.OAUTH,
            oauth_type="github",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="import_once",
            config_fields=(
                ConfigField(key="source_url", label="GitHub repository URL", type="url", required=True, placeholder="https://github.com/org/repo"),
            ),
        )

    def __init__(
        self,
        node_service: ContentNodeService,
        github_service: GithubOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.github_service = github_service
        self.s3_service = s3_service

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Pull repo metadata, README, and file tree as JSON summary."""
        access_token = credentials.access_token
        source_url = config.get("source_url", "")

        parsed = urlparse(source_url)
        path = parsed.path.strip("/")
        parts = path.split("/")
        if len(parts) < 2:
            raise ValueError(f"Invalid GitHub URL: {source_url}")
        owner, repo = parts[0], parts[1]

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            repo_resp, readme_resp = await asyncio.gather(
                client.get(f"https://api.github.com/repos/{owner}/{repo}", headers=headers),
                client.get(f"https://api.github.com/repos/{owner}/{repo}/readme", headers=headers),
                return_exceptions=True,
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

            # Fetch file tree (default branch, recursive)
            default_branch = repo_data.get("default_branch", "main")
            tree_resp = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/git/trees/{default_branch}",
                headers=headers,
                params={"recursive": "1"},
            )

            file_paths = []
            if tree_resp.status_code == 200:
                tree_data = tree_resp.json()
                file_paths = [
                    item["path"]
                    for item in tree_data.get("tree", [])
                    if item.get("type") == "blob"
                ]

        content = {
            "source_type": "github_repo",
            "owner": owner,
            "repo": repo,
            "full_name": repo_data.get("full_name"),
            "description": repo_data.get("description"),
            "stars": repo_data.get("stargazers_count"),
            "forks": repo_data.get("forks_count"),
            "language": repo_data.get("language"),
            "default_branch": default_branch,
            "open_issues": repo_data.get("open_issues_count"),
            "html_url": repo_data.get("html_url"),
            "topics": repo_data.get("topics", []),
            "readme": readme_content,
            "file_tree": file_paths,
            "file_count": len(file_paths),
        }
        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=repo,
            summary=f"GitHub repo '{owner}/{repo}' — {len(file_paths)} files, {repo_data.get('stargazers_count', 0)} stars",
        )
