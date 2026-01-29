"""
RPC客户端模块
用于MCP Server调用主服务的Internal API
"""
import httpx
from typing import Optional, Dict, Any, List
from dataclasses import dataclass


@dataclass
class McpInstanceData:
    """MCP实例数据"""
    api_key: str
    user_id: str
    project_id: int
    table_id: int
    json_path: str
    status: int
    tools_definition: Optional[Dict[str, Any]]
    register_tools: Optional[List[str]]
    preview_keys: Optional[List[str]]


@dataclass
class TableMetadata:
    """表格元数据"""
    table_id: int
    name: str
    description: Optional[str]
    project_id: int


@dataclass
class AgentAccessData:
    """Agent 访问权限数据"""
    node_id: str
    bash_enabled: bool
    bash_readonly: bool
    tool_query: bool
    tool_create: bool
    tool_update: bool
    tool_delete: bool
    json_path: str


@dataclass
class AgentData:
    """Agent 数据"""
    id: str
    name: str
    user_id: str
    type: str
    accesses: List[AgentAccessData]


class InternalApiClient:
    """
    Internal API客户端
    用于MCP Server调用主服务的内部API
    """
    
    def __init__(
        self,
        base_url: str,
        secret: str,
        timeout: float = 30.0
    ):
        """
        初始化客户端
        
        Args:
            base_url: 主服务的基础URL
            secret: 内部API的SECRET
            timeout: 请求超时时间（秒）
        """
        self.base_url = base_url.rstrip("/")
        self.secret = secret
        self.timeout = timeout
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            headers={"X-Internal-Secret": secret},
            trust_env=False
        )
    
    async def close(self):
        """关闭客户端"""
        await self._client.aclose()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
    
    async def get_mcp_instance(self, api_key: str) -> Optional[McpInstanceData]:
        """
        获取MCP实例数据
        
        Args:
            api_key: API key
            
        Returns:
            MCP实例数据，如果不存在则返回None
        """
        try:
            url = f"{self.base_url}/internal/mcp-instance/{api_key}"
            response = await self._client.get(url)
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            data = response.json()
            
            return McpInstanceData(
                api_key=data["api_key"],
                user_id=data["user_id"],
                project_id=data["project_id"],
                table_id=data["table_id"],
                json_path=data.get("json_path") or data.get("json_pointer", "") or "",
                status=data.get("status", 1),
                tools_definition=data.get("tools_definition"),
                register_tools=data.get("register_tools"),
                preview_keys=data.get("preview_keys")
            )
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error fetching MCP instance: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"获取 MCP 实例失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error fetching MCP instance: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"获取 MCP 实例失败: {str(e)}") from e

    async def get_mcp_v2_instance_and_tools(self, api_key: str) -> Optional[Dict[str, Any]]:
        """
        获取 MCP v2 实例 + 绑定工具列表（新契约）

        Returns:
            {
              "mcp_v2": {...},
              "bound_tools": [{ "tool": {...}, "binding": {...} }, ...]
            }
        """
        try:
            url = f"{self.base_url}/internal/mcp-v2/{api_key}"
            response = await self._client.get(url)

            if response.status_code == 404:
                return None

            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error fetching MCP v2: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"获取 MCP v2 实例失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error fetching MCP v2: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"获取 MCP v2 实例失败: {str(e)}") from e
    
    async def get_table_metadata(self, table_id: int) -> Optional[TableMetadata]:
        """
        获取表格元数据
        
        Args:
            table_id: 表格ID
            
        Returns:
            表格元数据，如果不存在则返回None
        """
        try:
            url = f"{self.base_url}/internal/table/{table_id}"
            response = await self._client.get(url)
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            data = response.json()

            # 兼容不同返回字段：
            # - 新版主服务返回 table_id
            # - 旧版/其他实现可能返回 id
            resolved_table_id = data.get("table_id", data.get("id", table_id))

            return TableMetadata(
                table_id=resolved_table_id,
                name=data["name"],
                description=data.get("description"),
                project_id=data["project_id"]
            )
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error fetching table metadata: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"获取表格元数据失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error fetching table metadata: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"获取表格元数据失败: {str(e)}") from e
    
    async def get_context_schema(self, table_id: int, json_path: str = "") -> Any:
        """获取挂载点结构（不包含值）"""
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-schema"
            params = {"json_path": json_path}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error fetching context schema: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"获取数据结构失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error fetching context schema: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"获取数据结构失败: {str(e)}") from e

    async def get_context_data(self, table_id: int, json_path: str = "") -> Any:
        """获取挂载点全部数据"""
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-data"
            params = {"json_path": json_path}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error fetching context data: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"获取数据失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error fetching context data: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"获取数据失败: {str(e)}") from e

    async def query_context_data(self, table_id: int, json_path: str, query: str) -> Any:
        """对挂载点数据做 JMESPath 查询"""
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-data"
            params = {"json_path": json_path, "query": query}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error querying context data: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"JMESPath 查询失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error querying context data: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"JMESPath 查询失败: {str(e)}") from e
    
    async def create_table_data(
        self,
        table_id: int,
        json_path: str,
        elements: List[Dict[str, Any]]
    ) -> bool:
        """
        创建表格数据
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            elements: 要创建的元素列表
            
        Returns:
            是否成功
        """
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-data"
            payload = {
                "json_path": json_path,
                "elements": elements
            }
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            return True
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error creating table data: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"创建元素失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error creating table data: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"创建元素失败: {str(e)}") from e
    
    async def update_table_data(
        self,
        table_id: int,
        json_path: str,
        elements: List[Dict[str, Any]]
    ) -> bool:
        """
        更新表格数据
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            elements: 要更新的元素列表
            
        Returns:
            是否成功
        """
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-data"
            payload = {
                "json_path": json_path,
                "elements": elements
            }
            response = await self._client.put(url, json=payload)
            response.raise_for_status()
            return True
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error updating table data: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"更新元素失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error updating table data: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"更新元素失败: {str(e)}") from e
    
    async def delete_table_data(
        self,
        table_id: int,
        json_path: str,
        keys: List[str]
    ) -> bool:
        """
        删除表格数据
        
        Args:
            table_id: 表格ID
            json_path: 挂载点 JSON Pointer 路径
            keys: 要删除的key列表
            
        Returns:
            是否成功
        """
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-data"
            payload = {
                "json_path": json_path,
                "keys": keys
            }
            response = await self._client.request("DELETE", url, json=payload)
            response.raise_for_status()
            return True
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error deleting table data: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"删除元素失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error deleting table data: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"删除元素失败: {str(e)}") from e

    async def search_tool(self, tool_id: int, *, query: str, top_k: int | None = None) -> Any:
        """
        执行 Search Tool（通过主服务 internal API）。

        Args:
            tool_id: Tool ID（必须是 type=search）
            query: 查询文本
            top_k: 返回条数（可选）
        """
        try:
            url = f"{self.base_url}/internal/tools/{tool_id}/search"
            payload: dict[str, Any] = {"query": query}
            if top_k is not None:
                payload["top_k"] = top_k
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error searching tool: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"Search Tool 执行失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error searching tool: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"Search Tool 执行失败: {str(e)}") from e

    async def get_agent_by_mcp_key(self, mcp_api_key: str) -> Optional[AgentData]:
        """
        根据 MCP API key 获取 Agent 及其访问权限
        
        Args:
            mcp_api_key: MCP API key
            
        Returns:
            Agent 数据，如果不存在则返回 None
        """
        try:
            url = f"{self.base_url}/internal/agent-by-mcp-key/{mcp_api_key}"
            response = await self._client.get(url)
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            data = response.json()
            
            agent_info = data.get("agent", {})
            accesses_list = data.get("accesses", [])
            
            return AgentData(
                id=agent_info.get("id", ""),
                name=agent_info.get("name", ""),
                user_id=agent_info.get("user_id", ""),
                type=agent_info.get("type", "chat"),
                accesses=[
                    AgentAccessData(
                        node_id=a.get("node_id", ""),
                        bash_enabled=a.get("bash_enabled", False),
                        bash_readonly=a.get("bash_readonly", True),
                        tool_query=a.get("tool_query", False),
                        tool_create=a.get("tool_create", False),
                        tool_update=a.get("tool_update", False),
                        tool_delete=a.get("tool_delete", False),
                        json_path=a.get("json_path", ""),
                    )
                    for a in accesses_list
                ],
            )
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error fetching Agent by MCP key: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"获取 Agent 失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error fetching Agent by MCP key: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"获取 Agent 失败: {str(e)}") from e


# 创建全局客户端实例
def create_client() -> InternalApiClient:
    """创建Internal API客户端实例"""
    from ..settings import settings
    return InternalApiClient(
        base_url=settings.MAIN_SERVICE_URL,
        secret=settings.INTERNAL_API_SECRET,
        timeout=settings.RPC_TIMEOUT
    )
