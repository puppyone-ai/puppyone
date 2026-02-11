"""
RPC客户端模块
用于MCP Server调用主服务的Internal API

整合后只保留 Agent 模式需要的端点：
- /internal/agent-by-mcp-key/{mcp_api_key} - 获取 Agent 及其 bash 访问权限和 tools
- /internal/tables/{table_id}/context-* - 数据操作端点
- /internal/tools/{tool_id}/search - Search Tool 查询端点
"""
import httpx
from typing import Any, Optional, Dict, List


class InternalApiClient:
    """
    Internal API客户端
    用于MCP Server调用主服务的内部API（整合后只支持 Agent 模式）
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
    
    # ============================================================
    # Agent 模式端点（整合后唯一支持的模式）
    # ============================================================
    
    async def get_agent_by_mcp_key(self, mcp_api_key: str) -> Optional[Dict[str, Any]]:
        """
        根据 MCP API key 获取 Agent 及其访问权限
        
        Args:
            mcp_api_key: MCP API key（以 "mcp_" 开头）
            
        Returns:
            Agent 数据字典，格式：
            {
                "agent": { "id", "name", "project_id", "type" },
                "accesses": [
                    {
                        "node_id": "xxx",
                        "bash_enabled": true,
                        "bash_readonly": true,
                        "tool_query": true,
                        "tool_create": false,
                        "tool_update": false,
                        "tool_delete": false,
                        "json_path": ""
                    }
                ]
            }
            如果不存在则返回 None
        """
        try:
            url = f"{self.base_url}/internal/agent-by-mcp-key/{mcp_api_key}"
            response = await self._client.get(url)
            
            if response.status_code == 404:
                return None
            
            response.raise_for_status()
            return response.json()
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

    # ============================================================
    # 数据操作端点（Context Data CRUD）
    # ============================================================

    async def get_context_schema(self, table_id: str, json_path: str = "") -> Any:
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

    async def get_context_data(self, table_id: str, json_path: str = "") -> Any:
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

    async def query_context_data(self, table_id: str, json_path: str, query: str) -> Any:
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
        table_id: str,
        json_path: str,
        elements: List[Dict[str, Any]]
    ) -> bool:
        """
        创建表格数据
        
        Args:
            table_id: 表格ID（node_id）
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
        table_id: str,
        json_path: str,
        elements: List[Dict[str, Any]]
    ) -> bool:
        """
        更新表格数据
        
        Args:
            table_id: 表格ID（node_id）
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
        table_id: str,
        json_path: str,
        keys: List[str]
    ) -> bool:
        """
        删除表格数据
        
        Args:
            table_id: 表格ID（node_id）
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

    # ============================================================
    # ContentNode POSIX 端点
    # ============================================================

    async def resolve_path(
        self,
        project_id: str,
        root_accesses: List[Dict[str, Any]],
        path: str,
    ) -> Dict[str, Any]:
        """
        解析人类可读路径到节点信息。
        
        Returns:
            {"node_id": "...", "name": "...", "type": "...", "path": "...", ...}
            或 {"virtual_root": True, "path": "/"} 表示虚拟根
        """
        try:
            url = f"{self.base_url}/internal/nodes/resolve-path"
            payload = {
                "project_id": project_id,
                "root_accesses": root_accesses,
                "path": path,
            }
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            raise RuntimeError(
                f"路径解析失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(f"路径解析失败: {str(e)}") from e

    async def list_children(
        self,
        node_id: str,
        project_id: str,
    ) -> Dict[str, Any]:
        """列出子节点"""
        try:
            url = f"{self.base_url}/internal/nodes/{node_id}/children"
            params = {"project_id": project_id}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            raise RuntimeError(
                f"列出子节点失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(f"列出子节点失败: {str(e)}") from e

    async def read_node_content(
        self,
        node_id: str,
        project_id: str,
    ) -> Dict[str, Any]:
        """读取节点内容"""
        try:
            url = f"{self.base_url}/internal/nodes/{node_id}/content"
            params = {"project_id": project_id}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            raise RuntimeError(
                f"读取节点失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(f"读取节点失败: {str(e)}") from e

    async def write_node_content(
        self,
        node_id: str,
        project_id: str,
        content: Any,
    ) -> Dict[str, Any]:
        """更新节点内容"""
        try:
            url = f"{self.base_url}/internal/nodes/{node_id}/content"
            payload = {"project_id": project_id, "content": content}
            response = await self._client.put(url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            raise RuntimeError(
                f"写入节点失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(f"写入节点失败: {str(e)}") from e

    async def create_node(
        self,
        project_id: str,
        parent_id: str,
        name: str,
        node_type: str,
        content: Any = None,
        created_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        """创建节点"""
        try:
            url = f"{self.base_url}/internal/nodes/create"
            payload = {
                "project_id": project_id,
                "parent_id": parent_id,
                "name": name,
                "node_type": node_type,
                "content": content,
                "created_by": created_by,
            }
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            raise RuntimeError(
                f"创建节点失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(f"创建节点失败: {str(e)}") from e

    async def trash_node(
        self,
        node_id: str,
        project_id: str,
        user_id: str,
    ) -> Dict[str, Any]:
        """软删除节点（移入废纸篓）"""
        try:
            url = f"{self.base_url}/internal/nodes/{node_id}/trash"
            payload = {"project_id": project_id, "user_id": user_id}
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            raise RuntimeError(
                f"删除节点失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(f"删除节点失败: {str(e)}") from e

    # ============================================================
    # Search Tool 端点
    # ============================================================

    async def search_tool_query(
        self,
        tool_id: str,
        query: str,
        top_k: int = 5
    ) -> Dict[str, Any]:
        """
        调用 Search Tool 执行语义向量检索
        
        Args:
            tool_id: Tool ID
            query: 搜索查询
            top_k: 返回结果数量
            
        Returns:
            搜索结果
        """
        try:
            url = f"{self.base_url}/internal/tools/{tool_id}/search"
            payload = {
                "query": query,
                "top_k": top_k
            }
            response = await self._client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            body = (e.response.text or "").strip()
            print(
                f"Error executing search tool: status={e.response.status_code} url={e.request.url} body={body}"
            )
            raise RuntimeError(
                f"搜索失败: HTTP {e.response.status_code} - {body}"
            ) from e
        except httpx.RequestError as e:
            print(f"Error executing search tool: request_failed url={e.request.url} error={e}")
            raise RuntimeError(f"搜索失败: {str(e)}") from e


# 创建全局客户端实例
def create_client() -> InternalApiClient:
    """创建Internal API客户端实例"""
    from ..settings import settings
    return InternalApiClient(
        base_url=settings.MAIN_SERVICE_URL,
        secret=settings.INTERNAL_API_SECRET,
        timeout=settings.RPC_TIMEOUT
    )
