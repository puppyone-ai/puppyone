"""
Linear Handler - Process Linear project/issue imports.

Architecture:
- All issues are stored in a SINGLE content_node as JSONB
- No S3, no separate markdown files
- Agent can query with jq: jq '.issues[] | select(.status == "done")'
"""

from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from src.content_node.service import ContentNodeService
from src.sync.handlers.base import BaseHandler, ImportResult, PreviewResult, ProgressCallback
from src.sync.task.models import ImportTask, ImportTaskType
from src.oauth.linear_service import LinearOAuthService
from src.s3.service import S3Service
from src.utils.logger import log_info, log_error


class LinearHandler(BaseHandler):
    """Handler for Linear imports - stores all issues in single JSONB node."""

    LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"

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

    def can_handle(self, task: ImportTask) -> bool:
        return task.task_type == ImportTaskType.LINEAR

    async def process(
        self,
        task: ImportTask,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Process Linear import - all data stored in single JSONB node."""
        await on_progress(5, "Checking Linear connection...")

        # Get OAuth connection
        connection = await self.linear_service.refresh_token_if_needed(task.user_id)
        if not connection:
            raise ValueError("Linear not connected. Please authorize first.")

        access_token = connection.access_token
        metadata = connection.metadata or {}
        user_name = metadata.get("user", {}).get("displayName", "Linear")
        user_email = metadata.get("user", {}).get("email", "")

        config = task.config or {}
        source_url = task.source_url or ""
        parent_id = config.get("parent_id")
        
        await on_progress(10, f"Fetching data for {user_name}...")

        # Determine what to import based on URL
        if "/issue/" in source_url:
            # Single issue - still use JSONB but with one issue
            issue_id = self._extract_issue_id(source_url)
            if issue_id:
                return await self._import_single_issue(
                    access_token, issue_id, task, config, on_progress
                )
        elif "/project/" in source_url:
            # Project with issues
            project_id = self._extract_project_id(source_url)
            if project_id:
                return await self._import_project(
                    access_token, project_id, task, config, on_progress
                )
        
        # Default: import all assigned issues
        return await self._import_assigned_issues(
            access_token, user_name, user_email, task, config, on_progress
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

    async def _import_single_issue(
        self,
        access_token: str,
        issue_id: str,
        task: ImportTask,
        config: dict,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Import a single issue as JSONB."""
        await on_progress(30, "Fetching issue details...")
        
        query = """
        query Issue($id: String!) {
            issue(id: $id) {
                id
                identifier
                title
                description
                state { name }
                priority
                assignee { name email }
                creator { name email }
                labels { nodes { name } }
                comments { nodes { body user { name } createdAt } }
                project { name }
                createdAt
                updatedAt
                url
            }
        }
        """
        
        data = await self._graphql_query(access_token, query, {"id": issue_id})
        issue = data.get("issue")
        
        if not issue:
            raise ValueError(f"Issue not found: {issue_id}")

        await on_progress(60, "Creating content node...")
        
        # Format issue data for JSONB
        issue_data = self._format_issue_data(issue)
        
        # Build JSONB content
        content = {
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "source": "linear",
            "import_type": "single_issue",
            "issue_count": 1,
            "issues": [issue_data],
        }

        # Create single JSONB node
        node = await self.node_service.create_synced_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=f"{issue['identifier']} - {issue['title']}"[:100],
            node_type="linear",
            sync_url=issue.get("url", ""),
            content=content,
            parent_id=config.get("parent_id"),
            sync_id=issue["id"],
            sync_config={"import_type": "issue", "issue_id": issue["id"]},
            created_by=task.user_id,
        )

        await on_progress(100, "Linear issue imported")
        
        return ImportResult(content_node_id=node.id, items_count=1)

    async def _import_project(
        self,
        access_token: str,
        project_id: str,
        task: ImportTask,
        config: dict,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Import a project with all its issues as single JSONB node."""
        await on_progress(20, "Fetching project details...")
        
        query = """
        query Project($id: String!) {
            project(id: $id) {
                id
                name
                description
                state
                startDate
                targetDate
                issues {
                    nodes {
                        id
                        identifier
                        title
                        description
                        state { name }
                        priority
                        assignee { name email }
                        labels { nodes { name } }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        }
        """
        
        data = await self._graphql_query(access_token, query, {"id": project_id})
        project = data.get("project")
        
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        issues = project.get("issues", {}).get("nodes", [])
        await on_progress(40, f"Processing {len(issues)} issues...")

        # Format all issues
        issues_data = []
        for idx, issue in enumerate(issues):
            progress = 40 + int((idx / max(len(issues), 1)) * 50)
            await on_progress(progress, f"Processing issue {idx + 1}/{len(issues)}...")
            issues_data.append(self._format_issue_data(issue))

        # Build JSONB content
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

        # Create single JSONB node
        node = await self.node_service.create_synced_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=config.get("name") or f"Linear - {project['name']}"[:100],
            node_type="linear",
            sync_url=f"https://linear.app/project/{project_id}",
            content=content,
            parent_id=config.get("parent_id"),
            sync_id=project_id,
            sync_config={"import_type": "project", "project_id": project_id},
            created_by=task.user_id,
        )

        await on_progress(100, "Linear project imported")

        return ImportResult(
            content_node_id=node.id,
            items_count=len(issues_data),
        )

    async def _import_assigned_issues(
        self,
        access_token: str,
        user_name: str,
        user_email: str,
        task: ImportTask,
        config: dict,
        on_progress: ProgressCallback,
    ) -> ImportResult:
        """Import all issues assigned to the user as single JSONB node."""
        await on_progress(20, "Fetching assigned issues...")
        
        query = """
        query AssignedIssues {
            viewer {
                id
                name
                email
                assignedIssues(first: 100) {
                    nodes {
                        id
                        identifier
                        title
                        description
                        state { name }
                        priority
                        assignee { name email }
                        labels { nodes { name } }
                        project { name }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        }
        """
        
        data = await self._graphql_query(access_token, query)
        viewer = data.get("viewer", {})
        issues = viewer.get("assignedIssues", {}).get("nodes", [])

        await on_progress(40, f"Processing {len(issues)} issues...")

        # Format all issues
        issues_data = []
        for idx, issue in enumerate(issues):
            progress = 40 + int((idx / max(len(issues), 1)) * 50)
            await on_progress(progress, f"Processing issue {idx + 1}/{len(issues)}...")
            issues_data.append(self._format_issue_data(issue))

        # Build JSONB content
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

        # Create single JSONB node
        node = await self.node_service.create_synced_node(
            project_id=task.project_id,
            sync_oauth_user_id=task.user_id,  # OAuth 绑定的用户
            name=config.get("name") or f"Linear - {user_name}"[:100],
            node_type="linear",
            sync_url="oauth://linear",
            content=content,
            parent_id=config.get("parent_id"),
            sync_id=user_email or viewer.get("id", ""),
            sync_config={"import_type": "assigned_issues"},
            created_by=task.user_id,
        )

        await on_progress(100, "Linear issues imported")

        return ImportResult(
            content_node_id=node.id,
            items_count=len(issues_data),
        )

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

    async def preview(self, url: str, user_id: str) -> PreviewResult:
        """Preview Linear contents."""
        connection = await self.linear_service.refresh_token_if_needed(user_id)
        if not connection:
            raise ValueError("Linear not connected. Please authorize first.")

        access_token = connection.access_token
        
        # Get assigned issues for preview
        query = """
        query Preview {
            viewer {
                name
                assignedIssues(first: 10) {
                    nodes {
                        identifier
                        title
                        state { name }
                        priority
                        url
                    }
                }
            }
        }
        """
        
        data = await self._graphql_query(access_token, query)
        viewer = data.get("viewer", {})
        issues = viewer.get("assignedIssues", {}).get("nodes", [])

        sample_data = [
            {
                "identifier": i.get("identifier"),
                "title": i.get("title"),
                "state": i.get("state", {}).get("name"),
                "priority": self._priority_label(i.get("priority", 0)),
                "url": i.get("url"),
            }
            for i in issues
        ]

        return PreviewResult(
            source_type="linear",
            title=f"Linear - {viewer.get('name', 'User')}",
            description=f"Found {len(issues)} assigned issues",
            data=sample_data,
            fields=[
                {"name": "identifier", "type": "string"},
                {"name": "title", "type": "string"},
                {"name": "state", "type": "string"},
                {"name": "priority", "type": "string"},
            ],
            total_items=len(issues),
        )

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
