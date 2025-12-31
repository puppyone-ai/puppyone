"""GitHub provider for parsing repository-related URLs."""

from __future__ import annotations

import asyncio
import base64
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from src.connect.data_provider import DataProvider, DataProviderResult
from src.connect.exceptions import AuthenticationError
from src.oauth.github_service import GithubOAuthService
from src.utils.logger import log_info, log_error


@dataclass
class GithubResource:
    resource_type: str  # repo, issue, pull, project
    owner: str
    repo: str
    identifier: Optional[str] = None  # issue/PR number or project slug/id


class GithubProvider(DataProvider):
    """Provider to fetch GitHub repositories, issues, PRs, and projects."""

    API_BASE = "https://api.github.com"

    def __init__(self, user_id: str, github_service: Optional[GithubOAuthService] = None):
        self.user_id = user_id
        self.github_service = github_service or GithubOAuthService()
        self.client = httpx.AsyncClient(
            headers={"Accept": "application/vnd.github+json"},
            timeout=30.0,
        )

    async def can_handle(self, url: str) -> bool:
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        return host == "github.com" or host.endswith(".github.com")

    async def fetch_data(self, url: str) -> DataProviderResult:
        connection = await self.github_service.get_connection(self.user_id)
        if not connection:
            raise AuthenticationError(
                "Not connected to GitHub. Please authorize your GitHub account first.",
                provider="github",
                requires_auth=True,
            )

        if await self.github_service.is_token_expired(self.user_id):
            connection = await self.github_service.refresh_token_if_needed(self.user_id)
            if not connection:
                raise AuthenticationError(
                    "GitHub authorization expired. Please reconnect your GitHub account.",
                    provider="github",
                    requires_auth=True,
                )

        resource = self._match_resource(url)
        if not resource:
            raise ValueError(f"Unsupported GitHub URL: {url}")

        token = connection.access_token
        headers = {"Authorization": f"Bearer {token}"}

        try:
            if resource.resource_type == "repo":
                repo_data, readme = await self._fetch_repo(resource, headers)
                return self._build_repo_result(resource, repo_data, readme)
            if resource.resource_type == "issue":
                issue_data, comments = await self._fetch_issue(resource, headers)
                return self._build_issue_result(resource, issue_data, comments)
            if resource.resource_type == "pull":
                pull_data, reviews = await self._fetch_pull(resource, headers)
                return self._build_pull_result(resource, pull_data, reviews)
            if resource.resource_type == "project":
                project_data, items = await self._fetch_project(resource, headers)
                return self._build_project_result(resource, project_data, items)

            raise ValueError(f"Unsupported GitHub resource type: {resource.resource_type}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (401, 403):
                raise AuthenticationError(
                    "GitHub access denied. Please reconnect your GitHub account.",
                    provider="github",
                    requires_auth=True,
                )
            message = e.response.json().get("message") if e.response.headers.get("content-type", "").startswith("application/json") else e.response.text
            raise ValueError(f"GitHub API error ({e.response.status_code}): {message}") from e
        except Exception:
            log_error("Failed to fetch GitHub data", exc_info=True)
            raise

    def _match_resource(self, url: str) -> Optional[GithubResource]:
        path = urlparse(url).path.strip("/")
        parts = path.split("/")

        if len(parts) < 2:
            return None

        owner, repo = parts[0], parts[1]

        if len(parts) == 2:
            return GithubResource("repo", owner, repo)

        if len(parts) >= 4 and parts[2] == "issues":
            return GithubResource("issue", owner, repo, parts[3])

        if len(parts) >= 4 and parts[2] in {"pull", "pulls"}:
            return GithubResource("pull", owner, repo, parts[3])

        if len(parts) >= 3 and parts[2] == "projects":
            identifier = parts[3] if len(parts) > 3 else None
            return GithubResource("project", owner, repo, identifier)

        return GithubResource("repo", owner, repo)

    async def _fetch_repo(self, res: GithubResource, headers: Dict[str, str]) -> Tuple[Dict[str, Any], Optional[str]]:
        repo_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}"
        readme_url = f"{repo_url}/readme"
        repo_task = asyncio.create_task(self.client.get(repo_url, headers=headers))
        readme_task = asyncio.create_task(self.client.get(readme_url, headers=headers))

        repo_resp, readme_resp = await asyncio.gather(repo_task, readme_task, return_exceptions=True)

        if isinstance(repo_resp, httpx.Response):
            repo_resp.raise_for_status()
            repo_data = repo_resp.json()
        else:
            raise repo_resp  # noqa: TRY201

        readme_content = None
        if isinstance(readme_resp, httpx.Response) and readme_resp.status_code == 200:
            data = readme_resp.json()
            if data.get("encoding") == "base64" and data.get("content"):
                readme_content = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")

        return repo_data, readme_content

    async def _fetch_issue(self, res: GithubResource, headers: Dict[str, str]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        issue_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}/issues/{res.identifier}"
        comments_url = f"{issue_url}/comments"

        issue_task = asyncio.create_task(self.client.get(issue_url, headers=headers))
        comments_task = asyncio.create_task(self.client.get(comments_url, headers=headers))

        issue_resp, comments_resp = await asyncio.gather(issue_task, comments_task, return_exceptions=True)

        if isinstance(issue_resp, httpx.Response):
            issue_resp.raise_for_status()
            issue_data = issue_resp.json()
        else:
            raise issue_resp  # noqa: TRY201

        comments = []
        if isinstance(comments_resp, httpx.Response) and comments_resp.status_code == 200:
            comments = comments_resp.json()

        return issue_data, comments

    async def _fetch_pull(self, res: GithubResource, headers: Dict[str, str]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        pull_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}/pulls/{res.identifier}"
        reviews_url = f"{pull_url}/reviews"

        pull_task = asyncio.create_task(self.client.get(pull_url, headers=headers))
        reviews_task = asyncio.create_task(self.client.get(reviews_url, headers=headers))

        pull_resp, reviews_resp = await asyncio.gather(pull_task, reviews_task, return_exceptions=True)

        if isinstance(pull_resp, httpx.Response):
            pull_resp.raise_for_status()
            pull_data = pull_resp.json()
        else:
            raise pull_resp  # noqa: TRY201

        reviews = []
        if isinstance(reviews_resp, httpx.Response) and reviews_resp.status_code == 200:
            reviews = reviews_resp.json()

        return pull_data, reviews

    async def _fetch_project(self, res: GithubResource, headers: Dict[str, str]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        # Support classic repo projects via /projects
        if not res.identifier:
            raise ValueError("Project URL must include an ID or number")

        project_url = f"{self.API_BASE}/repos/{res.owner}/{res.repo}/projects/{res.identifier}"
        columns_url = f"{project_url}/columns"

        headers = headers.copy()
        headers["Accept"] = "application/vnd.github.inertia-preview+json"

        project_task = asyncio.create_task(self.client.get(project_url, headers=headers))
        columns_task = asyncio.create_task(self.client.get(columns_url, headers=headers))

        project_resp, columns_resp = await asyncio.gather(project_task, columns_task, return_exceptions=True)

        if isinstance(project_resp, httpx.Response):
            project_resp.raise_for_status()
            project_data = project_resp.json()
        else:
            raise project_resp  # noqa: TRY201

        items: List[Dict[str, Any]] = []
        if isinstance(columns_resp, httpx.Response) and columns_resp.status_code == 200:
            columns = columns_resp.json()
            for column in columns:
                column_cards_url = f"{self.API_BASE}/projects/columns/{column['id']}/cards"
                cards_resp = await self.client.get(column_cards_url, headers=headers)
                cards_resp.raise_for_status()
                cards = cards_resp.json()
                for card in cards:
                    items.append(
                        {
                            "column": column["name"],
                            "note": card.get("note"),
                            "content_url": card.get("content_url"),
                            "created_at": card.get("created_at"),
                        }
                    )

        return project_data, items

    def _build_repo_result(self, res: GithubResource, repo_data: Dict[str, Any], readme: Optional[str]) -> DataProviderResult:
        topics = repo_data.get("topics", [])
        structured = [
            {
                "type": "repo",
                "id": repo_data.get("id"),
                "name": repo_data.get("name"),
                "full_name": repo_data.get("full_name"),
                "owner": repo_data.get("owner", {}).get("login"),
                "description": repo_data.get("description"),
                "stars": repo_data.get("stargazers_count"),
                "forks": repo_data.get("forks_count"),
                "watchers": repo_data.get("watchers_count"),
                "language": repo_data.get("language"),
                "topics": ", ".join(topics),
                "visibility": repo_data.get("visibility"),
                "default_branch": repo_data.get("default_branch"),
                "license": (repo_data.get("license") or {}).get("name"),
                "open_issues": repo_data.get("open_issues_count"),
                "archived": repo_data.get("archived"),
                "allow_forking": repo_data.get("allow_forking"),
                "created_at": repo_data.get("created_at"),
                "updated_at": repo_data.get("updated_at"),
                "pushed_at": repo_data.get("pushed_at"),
                "html_url": repo_data.get("html_url"),
                "homepage": repo_data.get("homepage"),
                "readme": readme,
            }
        ]

        fields = [
            {"name": "name", "type": "string"},
            {"name": "full_name", "type": "string"},
            {"name": "description", "type": "text"},
            {"name": "stars", "type": "number"},
            {"name": "forks", "type": "number"},
            {"name": "language", "type": "string"},
            {"name": "topics", "type": "string"},
            {"name": "open_issues", "type": "number"},
            {"name": "updated_at", "type": "datetime"},
            {"name": "readme", "type": "text"},
        ]

        return DataProviderResult(
            source_type="github_repo",
            title=f"GitHub repo: {repo_data.get('full_name')}",
            description=repo_data.get("description"),
            data=structured,
            fields=fields,
            structure_info={
                "type": "repo",
                "owner": res.owner,
                "repo": res.repo,
                "topics": topics,
            },
        )

    def _build_issue_result(self, res: GithubResource, issue_data: Dict[str, Any], comments: List[Dict[str, Any]]) -> DataProviderResult:
        structured = [
            {
                "type": "issue",
                "repo": f"{res.owner}/{res.repo}",
                "number": issue_data.get("number"),
                "title": issue_data.get("title"),
                "state": issue_data.get("state"),
                "author": issue_data.get("user", {}).get("login"),
                "labels": ", ".join([lbl.get("name", "") for lbl in issue_data.get("labels", [])]),
                "assignees": ", ".join([asg.get("login", "") for asg in issue_data.get("assignees", [])]),
                "body": issue_data.get("body"),
                "comments_count": issue_data.get("comments"),
                "comments": [
                    {
                        "author": comment.get("user", {}).get("login"),
                        "body": comment.get("body"),
                        "created_at": comment.get("created_at"),
                    }
                    for comment in comments
                ],
                "html_url": issue_data.get("html_url"),
                "created_at": issue_data.get("created_at"),
                "updated_at": issue_data.get("updated_at"),
                "closed_at": issue_data.get("closed_at"),
            }
        ]

        fields = [
            {"name": "number", "type": "number"},
            {"name": "title", "type": "string"},
            {"name": "state", "type": "string"},
            {"name": "labels", "type": "string"},
            {"name": "body", "type": "text"},
            {"name": "comments", "type": "list"},
        ]

        return DataProviderResult(
            source_type="github_issue",
            title=f"Issue #{issue_data.get('number')}: {issue_data.get('title')}",
            description=f"Issue in {res.owner}/{res.repo}",
            data=structured,
            fields=fields,
            structure_info={
                "type": "issue",
                "number": issue_data.get("number"),
                "state": issue_data.get("state"),
                "comments": len(comments),
            },
        )

    def _build_pull_result(self, res: GithubResource, pull_data: Dict[str, Any], reviews: List[Dict[str, Any]]) -> DataProviderResult:
        structured = [
            {
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
                "changed_files": pull_data.get("changed_files"),
                "body": pull_data.get("body"),
                "reviews": [
                    {
                        "reviewer": review.get("user", {}).get("login"),
                        "state": review.get("state"),
                        "body": review.get("body"),
                        "submitted_at": review.get("submitted_at"),
                    }
                    for review in reviews
                ],
                "html_url": pull_data.get("html_url"),
                "merged": pull_data.get("merged"),
                "merged_at": pull_data.get("merged_at"),
            }
        ]

        fields = [
            {"name": "number", "type": "number"},
            {"name": "title", "type": "string"},
            {"name": "state", "type": "string"},
            {"name": "base_branch", "type": "string"},
            {"name": "head_branch", "type": "string"},
            {"name": "additions", "type": "number"},
            {"name": "deletions", "type": "number"},
            {"name": "reviews", "type": "list"},
        ]

        return DataProviderResult(
            source_type="github_pull",
            title=f"PR #{pull_data.get('number')}: {pull_data.get('title')}",
            description=f"PR in {res.owner}/{res.repo}",
            data=structured,
            fields=fields,
            structure_info={
                "type": "pull",
                "number": pull_data.get('number'),
                "state": pull_data.get('state'),
                "merged": pull_data.get('merged'),
                "reviews": len(reviews),
            },
        )

    def _build_project_result(self, res: GithubResource, project_data: Dict[str, Any], items: List[Dict[str, Any]]) -> DataProviderResult:
        structured = [
            {
                "name": project_data.get("name"),
                "body": project_data.get("body"),
                "state": project_data.get("state"),
                "creator": project_data.get("creator", {}).get("login"),
                "columns": project_data.get("columns_url"),
                "items": items,
                "html_url": project_data.get("html_url"),
                "created_at": project_data.get("created_at"),
                "updated_at": project_data.get("updated_at"),
            }
        ]

        fields = [
            {"name": "name", "type": "string"},
            {"name": "state", "type": "string"},
            {"name": "creator", "type": "string"},
            {"name": "items", "type": "list"},
        ]

        return DataProviderResult(
            source_type="github_project",
            title=f"GitHub Project: {project_data.get('name')}",
            description=f"Project in {res.owner}/{res.repo}",
            data=structured,
            fields=fields,
            structure_info={
                "type": "project",
                "id": project_data.get("id"),
                "state": project_data.get("state"),
                "items": len(items),
            },
        )

    async def close(self):
        await self.client.aclose()

