"""
Linear Connector - Process Linear project/issue imports.

Architecture:
- All issues are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.issues[] | select(.status == "done")'
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

import httpx

from src.content_node.service import ContentNodeService
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
from src.oauth.linear_service import LinearOAuthService
from src.s3.service import S3Service


class LinearConnector(BaseConnector):
    """Connector for Linear imports - stores all issues in single JSONB node."""

    LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="linear",
            display_name="Linear",
            capabilities=Capability.PULL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="json",
            auth=AuthRequirement.OAUTH,
            oauth_type="linear",
            supported_sync_modes=("import_once", "manual", "scheduled"),
            default_sync_mode="manual",
            config_fields=(
                ConfigField(key="source_url", label="Linear issue, project, or team URL (omit for assigned issues)", type="url", placeholder="https://linear.app/team/issue/TEAM-123"),
            ),
        )

    def __init__(
        self,
        node_service: ContentNodeService,
        linear_service: LinearOAuthService,
        s3_service: S3Service,
    ):
        self.node_service = node_service
        self.linear_service = linear_service
        self.s3_service = s3_service
        self.client = httpx.AsyncClient(timeout=60.0)

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        """Pull Linear issues based on config. Returns raw content without creating nodes."""
        access_token = credentials.access_token
        metadata = credentials.metadata or {}
        user_name = metadata.get("user", {}).get("displayName", "Linear")
        user_email = metadata.get("user", {}).get("email", "")

        source_url = config.get("source_url", "")

        if "/issue/" in source_url:
            issue_id = self._extract_issue_id(source_url)
            if issue_id:
                return await self._fetch_single_issue(access_token, issue_id)

        if "/project/" in source_url:
            project_id = self._extract_project_id(source_url)
            if project_id:
                return await self._fetch_project(access_token, project_id, config)

        return await self._fetch_assigned_issues(access_token, user_name, user_email)

    async def _fetch_single_issue(self, access_token: str, issue_id: str) -> FetchResult:
        query = """
        query Issue($id: String!) {
            issue(id: $id) {
                id identifier title description
                state { name } priority
                assignee { name email } creator { name email }
                labels { nodes { name } }
                comments { nodes { body user { name } createdAt } }
                project { name } createdAt updatedAt url
            }
        }
        """
        data = await self._graphql_query(access_token, query, {"id": issue_id})
        issue = data.get("issue")
        if not issue:
            raise ValueError(f"Issue not found: {issue_id}")

        issue_data = self._format_issue_data(issue)
        content = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": "linear",
            "import_type": "single_issue",
            "issue_count": 1,
            "issues": [issue_data],
        }
        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=f"{issue['identifier']} - {issue['title']}"[:100],
            summary=f"Linear issue {issue.get('identifier', '')}",
        )

    async def _fetch_project(self, access_token: str, project_id: str, config: dict) -> FetchResult:
        query = """
        query Project($id: String!) {
            project(id: $id) {
                id name description state startDate targetDate
                issues { nodes {
                    id identifier title description
                    state { name } priority
                    assignee { name email }
                    labels { nodes { name } }
                    createdAt updatedAt url
                } }
            }
        }
        """
        data = await self._graphql_query(access_token, query, {"id": project_id})
        project = data.get("project")
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        issues = project.get("issues", {}).get("nodes", [])
        issues_data = [self._format_issue_data(i) for i in issues]

        content = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": "linear",
            "import_type": "project",
            "project": {
                "id": project["id"],
                "name": project.get("name", ""),
                "description": project.get("description", ""),
                "state": project.get("state", ""),
                "start_date": project.get("startDate"),
                "target_date": project.get("targetDate"),
            },
            "issue_count": len(issues_data),
            "issues": issues_data,
        }
        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        node_name = config.get("name") or f"Linear - {project['name']}"
        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=node_name[:100],
            summary=f"Linear project '{project.get('name', '')}' with {len(issues_data)} issues",
        )

    async def _fetch_assigned_issues(self, access_token: str, user_name: str, user_email: str) -> FetchResult:
        query = """
        query AssignedIssues {
            viewer {
                id name email
                assignedIssues(first: 100) { nodes {
                    id identifier title description
                    state { name } priority
                    assignee { name email }
                    labels { nodes { name } }
                    project { name } createdAt updatedAt url
                } }
            }
        }
        """
        data = await self._graphql_query(access_token, query)
        viewer = data.get("viewer", {})
        issues = viewer.get("assignedIssues", {}).get("nodes", [])
        issues_data = [self._format_issue_data(i) for i in issues]

        content = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": "linear",
            "import_type": "assigned_issues",
            "user": {
                "id": viewer.get("id", ""),
                "name": viewer.get("name", user_name),
                "email": viewer.get("email", user_email),
            },
            "issue_count": len(issues_data),
            "issues": issues_data,
        }
        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type="json",
            node_name=f"Linear - {user_name}"[:100],
            summary=f"{len(issues_data)} assigned issues for {user_name}",
        )

    async def _graphql_query(self, access_token: str, query: str, variables: dict = None) -> dict:
        """Execute a GraphQL query against Linear API."""
        payload = {"query": query}
        if variables:
            payload["variables"] = variables

        response = await self.client.post(
            self.LINEAR_GRAPHQL_URL,
            json=payload,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        data = response.json()

        if "errors" in data:
            raise ValueError(f"Linear API error: {data['errors']}")

        return data.get("data", {})

    def _format_issue_data(self, issue: dict) -> dict:
        """Format issue data for JSONB storage."""
        assignee = issue.get("assignee") or {}
        labels = issue.get("labels", {}).get("nodes", [])
        comments = issue.get("comments", {}).get("nodes", [])
        project = issue.get("project") or {}

        return {
            "id": issue.get("id", ""),
            "identifier": issue.get("identifier", ""),
            "title": issue.get("title", ""),
            "description": issue.get("description", ""),
            "status": issue.get("state", {}).get("name", "Unknown"),
            "priority": issue.get("priority", 0),
            "priority_label": self._priority_label(issue.get("priority", 0)),
            "assignee": assignee.get("name", "") if assignee else "",
            "assignee_email": assignee.get("email", "") if assignee else "",
            "labels": [l.get("name", "") for l in labels],
            "project": project.get("name", "") if project else "",
            "created_at": issue.get("createdAt", ""),
            "updated_at": issue.get("updatedAt", ""),
            "url": issue.get("url", ""),
            "comments": [
                {
                    "author": c.get("user", {}).get("name", "") if c.get("user") else "",
                    "body": c.get("body", ""),
                    "created_at": c.get("createdAt", ""),
                }
                for c in (comments[:10] if comments else [])
            ],
        }

    def _extract_issue_id(self, url: str) -> Optional[str]:
        """Extract issue ID from Linear URL."""
        import re
        # https://linear.app/team/issue/TEAM-123
        match = re.search(r'/issue/([A-Z]+-\d+)', url)
        if match:
            return match.group(1)
        return None

    def _extract_project_id(self, url: str) -> Optional[str]:
        """Extract project ID from Linear URL."""
        import re
        # https://linear.app/team/project/project-name-abc123
        match = re.search(r'/project/([^/]+)', url)
        if match:
            return match.group(1)
        return None

    def _priority_label(self, priority: int) -> str:
        """Convert priority number to label."""
        labels = {
            0: "No priority",
            1: "Urgent",
            2: "High",
            3: "Medium",
            4: "Low",
        }
        return labels.get(priority, "Unknown")

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
