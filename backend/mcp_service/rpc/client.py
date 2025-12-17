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
        except httpx.HTTPError as e:
            print(f"Error fetching MCP instance: {e}")
            return None
    
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
        except httpx.HTTPError as e:
            print(f"Error fetching table metadata: {e}")
            return None
    
    async def get_context_schema(self, table_id: int, json_path: str = "") -> Any:
        """获取挂载点结构（不包含值）"""
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-schema"
            params = {"json_path": json_path}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Error fetching context schema: {e}")
            return None

    async def get_context_data(self, table_id: int, json_path: str = "") -> Any:
        """获取挂载点全部数据"""
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-data"
            params = {"json_path": json_path}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Error fetching context data: {e}")
            return None

    async def query_context_data(self, table_id: int, json_path: str, query: str) -> Any:
        """对挂载点数据做 JMESPath 查询"""
        try:
            url = f"{self.base_url}/internal/tables/{table_id}/context-data"
            params = {"json_path": json_path, "query": query}
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"Error querying context data: {e}")
            return None
    
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
        except httpx.HTTPError as e:
            print(f"Error creating table data: {e}")
            return False
    
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
        except httpx.HTTPError as e:
            print(f"Error updating table data: {e}")
            return False
    
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
        except httpx.HTTPError as e:
            print(f"Error deleting table data: {e}")
            return False


# 创建全局客户端实例
def create_client() -> InternalApiClient:
    """创建Internal API客户端实例"""
    from ..settings import settings
    return InternalApiClient(
        base_url=settings.MAIN_SERVICE_URL,
        secret=settings.INTERNAL_API_SECRET,
        timeout=settings.RPC_TIMEOUT
    )
