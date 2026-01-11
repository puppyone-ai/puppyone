"""Linear provider for parsing Linear issue and project URLs."""

from typing import Dict, Optional
from urllib.parse import urlparse

import httpx

from src.connect.data_provider import DataProvider, DataProviderResult
from src.connect.exceptions import AuthenticationError
from src.oauth.linear_service import LinearOAuthService
from src.utils.logger import log_error


class LinearProvider(DataProvider):
    """Provider for Linear data sources."""

    LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"

    def __init__(
        self, user_id: str, linear_service: Optional[LinearOAuthService] = None
    ):
        self.user_id = user_id
        self.linear_service = linear_service or LinearOAuthService()
        self.client = httpx.AsyncClient()

    async def can_handle(self, url: str) -> bool:
        """Check if the URL is a Linear URL."""
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        return "linear.app" in domain

    async def fetch_data(self, url: str) -> DataProviderResult:
        """Fetch data from Linear URL."""
        # Check if user has Linear connection
        connection = await self.linear_service.get_connection(self.user_id)
        if not connection:
            raise AuthenticationError(
                "Not connected to Linear. Please authorize your Linear account first.",
                provider="linear",
                requires_auth=True,
            )

        # Check if token is expired and refresh if needed
        if await self.linear_service.is_token_expired(self.user_id):
            connection = await self.linear_service.refresh_token_if_needed(self.user_id)
            if not connection:
                raise AuthenticationError(
                    "Linear authorization expired. Please reconnect your Linear account.",
                    provider="linear",
                    requires_auth=True,
                )

        # Parse URL to determine resource type
        resource_type, resource_id = self._parse_linear_url(url)

        if not resource_type:
            raise ValueError(f"Unsupported Linear URL format: {url}")

        token = connection.access_token
        headers = {"Authorization": f"Bearer {token}"}

        try:
            if resource_type == "issue":
                return await self._fetch_issue(resource_id, headers)
            elif resource_type == "project":
                return await self._fetch_project(resource_id, headers)
            else:
                raise ValueError(f"Unsupported Linear resource type: {resource_type}")

        except httpx.HTTPStatusError as e:
            if e.response.status_code in [401, 403]:
                raise AuthenticationError(
                    "Linear access denied. Please reconnect your Linear account.",
                    provider="linear",
                    requires_auth=True,
                )
            log_error(f"Linear API error: {e.response.status_code} - {e.response.text}")
            raise ValueError(f"Failed to fetch Linear data: {e.response.status_code}")
        except Exception as e:
            log_error(f"Failed to fetch Linear data: {e}")
            raise

    async def _fetch_issue(
        self, issue_id: str, headers: Dict[str, str]
    ) -> DataProviderResult:
        """Fetch Linear issue data."""
        query = """
        query Issue($id: String!) {
            issue(id: $id) {
                id
                identifier
                title
                description
                state {
                    name
                    type
                }
                assignee {
                    name
                    email
                }
                creator {
                    name
                    email
                }
                labels {
                    nodes {
                        name
                    }
                }
                priority
                estimate
                createdAt
                updatedAt
                completedAt
                dueDate
                url
                project {
                    name
                }
                team {
                    name
                }
            }
        }
        """

        response = await self.client.post(
            self.LINEAR_GRAPHQL_URL,
            json={"query": query, "variables": {"id": issue_id}},
            headers=headers,
        )
        response.raise_for_status()

        data = response.json()
        if "errors" in data:
            raise ValueError(f"Linear GraphQL error: {data['errors']}")

        issue = data.get("data", {}).get("issue")
        if not issue:
            raise ValueError(f"Issue not found: {issue_id}")

        # Extract labels
        labels = issue.get("labels", {}).get("nodes", [])
        labels_str = ", ".join([label.get("name", "") for label in labels])

        structured_data = [
            {
                "type": "issue",
                "id": issue.get("id"),
                "identifier": issue.get("identifier"),
                "title": issue.get("title"),
                "description": issue.get("description"),
                "state": issue.get("state", {}).get("name"),
                "state_type": issue.get("state", {}).get("type"),
                "assignee": issue.get("assignee", {}).get("name")
                if issue.get("assignee")
                else None,
                "assignee_email": issue.get("assignee", {}).get("email")
                if issue.get("assignee")
                else None,
                "creator": issue.get("creator", {}).get("name")
                if issue.get("creator")
                else None,
                "labels": labels_str,
                "priority": issue.get("priority"),
                "estimate": issue.get("estimate"),
                "team": issue.get("team", {}).get("name")
                if issue.get("team")
                else None,
                "project": issue.get("project", {}).get("name")
                if issue.get("project")
                else None,
                "created_at": issue.get("createdAt"),
                "updated_at": issue.get("updatedAt"),
                "completed_at": issue.get("completedAt"),
                "due_date": issue.get("dueDate"),
                "url": issue.get("url"),
            }
        ]

        field_definitions = [
            {"name": "identifier", "type": "string"},
            {"name": "title", "type": "string"},
            {"name": "description", "type": "text"},
            {"name": "state", "type": "string"},
            {"name": "assignee", "type": "string"},
            {"name": "labels", "type": "string"},
            {"name": "priority", "type": "number"},
            {"name": "created_at", "type": "datetime"},
        ]

        return DataProviderResult(
            source_type="linear_issue",
            title=f"Linear Issue: {issue.get('identifier')} - {issue.get('title')}",
            description="Issue in Linear",
            data=structured_data,
            fields=field_definitions,
            structure_info={
                "type": "issue",
                "identifier": issue.get("identifier"),
                "state": issue.get("state", {}).get("name"),
            },
        )

    async def _fetch_project(
        self, project_id: str, headers: Dict[str, str]
    ) -> DataProviderResult:
        """Fetch Linear project data."""
        query = """
        query Project($id: String!) {
            project(id: $id) {
                id
                name
                description
                state
                progress
                targetDate
                startedAt
                completedAt
                createdAt
                updatedAt
                url
                lead {
                    name
                    email
                }
                issues {
                    nodes {
                        id
                        identifier
                        title
                        state {
                            name
                        }
                        assignee {
                            name
                        }
                        priority
                    }
                }
            }
        }
        """

        response = await self.client.post(
            self.LINEAR_GRAPHQL_URL,
            json={"query": query, "variables": {"id": project_id}},
            headers=headers,
        )
        response.raise_for_status()

        data = response.json()
        if "errors" in data:
            raise ValueError(f"Linear GraphQL error: {data['errors']}")

        project = data.get("data", {}).get("project")
        if not project:
            raise ValueError(f"Project not found: {project_id}")

        # Extract issues
        issues = project.get("issues", {}).get("nodes", [])
        issues_data = [
            {
                "identifier": issue.get("identifier"),
                "title": issue.get("title"),
                "state": issue.get("state", {}).get("name"),
                "assignee": issue.get("assignee", {}).get("name")
                if issue.get("assignee")
                else None,
                "priority": issue.get("priority"),
            }
            for issue in issues
        ]

        structured_data = [
            {
                "type": "project",
                "id": project.get("id"),
                "name": project.get("name"),
                "description": project.get("description"),
                "state": project.get("state"),
                "progress": project.get("progress"),
                "lead": project.get("lead", {}).get("name")
                if project.get("lead")
                else None,
                "lead_email": project.get("lead", {}).get("email")
                if project.get("lead")
                else None,
                "target_date": project.get("targetDate"),
                "started_at": project.get("startedAt"),
                "completed_at": project.get("completedAt"),
                "created_at": project.get("createdAt"),
                "updated_at": project.get("updatedAt"),
                "url": project.get("url"),
                "issues": issues_data,
                "issues_count": len(issues),
            }
        ]

        field_definitions = [
            {"name": "name", "type": "string"},
            {"name": "description", "type": "text"},
            {"name": "state", "type": "string"},
            {"name": "progress", "type": "number"},
            {"name": "lead", "type": "string"},
            {"name": "issues", "type": "list"},
        ]

        return DataProviderResult(
            source_type="linear_project",
            title=f"Linear Project: {project.get('name')}",
            description="Project in Linear",
            data=structured_data,
            fields=field_definitions,
            structure_info={
                "type": "project",
                "state": project.get("state"),
                "issues_count": len(issues),
            },
        )

    def _parse_linear_url(self, url: str) -> tuple[Optional[str], Optional[str]]:
        """Parse Linear URL to determine resource type and ID."""
        # Pattern: https://linear.app/{workspace}/issue/{issueKey}
        # Pattern: https://linear.app/{workspace}/project/{projectSlug}

        parsed = urlparse(url)
        path = parsed.path.strip("/")
        parts = path.split("/")

        if len(parts) >= 3:
            resource_type = parts[1]  # 'issue' or 'project'
            resource_id = parts[2]  # issue key or project slug

            if resource_type == "issue":
                return ("issue", resource_id)
            elif resource_type == "project":
                return ("project", resource_id)

        return (None, None)

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
        if self.linear_service:
            await self.linear_service.close()
