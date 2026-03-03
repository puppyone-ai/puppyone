from typing import List, Optional

from src.mcp_endpoint.repository import McpEndpointRepository
from src.mcp_endpoint.schemas import McpAccessItem, McpToolItem


class McpEndpointService:

    def __init__(self, repository: McpEndpointRepository = None):
        self._repo = repository or McpEndpointRepository()

    def get_endpoint(self, endpoint_id: str) -> Optional[dict]:
        return self._repo.get_by_id(endpoint_id)

    def get_by_api_key(self, api_key: str) -> Optional[dict]:
        return self._repo.get_by_api_key(api_key)

    def list_endpoints(self, project_id: str) -> List[dict]:
        return self._repo.list_by_project(project_id)

    def verify_project_access(self, project_id: str, user_id: str) -> bool:
        from src.project.repository import ProjectRepositorySupabase

        project_repo = ProjectRepositorySupabase()
        return project_repo.verify_project_access(project_id, user_id) is not None

    def get_by_node(self, node_id: str) -> Optional[dict]:
        return self._repo.get_by_node_id(node_id)

    def create_endpoint(
        self,
        project_id: str,
        name: str = "MCP Endpoint",
        node_id: Optional[str] = None,
        description: Optional[str] = None,
        accesses: Optional[List[McpAccessItem]] = None,
        tools_config: Optional[List[McpToolItem]] = None,
    ) -> dict:
        return self._repo.create(
            project_id=project_id,
            name=name,
            node_id=node_id,
            description=description,
            accesses=[a.model_dump() for a in accesses] if accesses else [],
            tools_config=[t.model_dump() for t in tools_config] if tools_config else [],
        )

    def update_endpoint(self, endpoint_id: str, **kwargs) -> Optional[dict]:
        accesses = kwargs.pop("accesses", None)
        tools_config = kwargs.pop("tools_config", None)
        if accesses is not None:
            kwargs["accesses"] = [a.model_dump() if hasattr(a, "model_dump") else a for a in accesses]
        if tools_config is not None:
            kwargs["tools_config"] = [t.model_dump() if hasattr(t, "model_dump") else t for t in tools_config]
        return self._repo.update(endpoint_id, **kwargs)

    def delete_endpoint(self, endpoint_id: str) -> bool:
        return self._repo.delete(endpoint_id)

    def regenerate_key(self, endpoint_id: str) -> Optional[dict]:
        return self._repo.regenerate_api_key(endpoint_id)

    def verify_access(self, endpoint_id: str, user_id: str) -> bool:
        return self._repo.verify_access(endpoint_id, user_id)
