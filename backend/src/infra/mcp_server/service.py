"""
Simplified MCP Service
Removed process management logic, MCP instances are reduced to pure data records
"""

import jwt
import httpx
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Callable
from src.config import settings
from src.exceptions import (
    AuthException,
    BusinessException,
    NotFoundException,
    ErrorCode,
)
from src.infra.mcp_server.schemas import McpTokenPayload
from src.infra.mcp_server.repository import McpInstanceRepositoryBase
from src.infra.mcp_server.models import McpInstance
from src.utils.logger import log_info, log_error

# MCP Server URL
MCP_SERVER_URL = settings.MCP_SERVER_URL
MCP_SERVER_HEALTHZ_URL = f"{MCP_SERVER_URL}/healthz"
MCP_SERVER_CACHE_INVALIDATE_URL = f"{MCP_SERVER_URL}/cache/invalidate"


class McpService:
    """
    MCP hosting service layer
    - Responsibilities:
        - Handles API_KEY generation and validation for MCP instances (currently using JWT)
        - Manages MCP instances in the database
    """

    def __init__(self, instance_repo: McpInstanceRepositoryBase):
        # MCP Instance storage layer
        self.instance_repo = instance_repo
        # Unified httpx client (for internal access to MCP Server)
        # - Reuses connection pool, reducing creation overhead
        # - trust_env=False: prevents localhost/127.0.0.1 requests from being polluted by env proxy variables causing 502
        self._http_client: httpx.AsyncClient | None = None

    def _get_http_client(self) -> httpx.AsyncClient:
        """Get (or lazily create) the unified httpx.AsyncClient."""
        if self._http_client is None:
            # Default timeout is just a fallback; individual requests can override via timeout=
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(5.0),
                trust_env=False,
            )
        return self._http_client

    async def aclose(self) -> None:
        """Release the unified http client's connection pool resources (optional)."""
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def _http_request(
        self,
        method: str,
        url: str,
        *,
        timeout: float | httpx.Timeout | None = None,
        **kwargs,
    ) -> httpx.Response:
        """
        Unified HTTP request wrapper for MCP Service internals.
        - Uses the shared client with trust_env=False by default
        - Allows per-request timeout override
        """
        client = self._get_http_client()
        return await client.request(method=method, url=url, timeout=timeout, **kwargs)

    # ============================================================
    # API_KEY generation and parsing logic
    # ============================================================

    def generate_mcp_token(
        self, user_id: str, project_id: str, table_id: str, json_pointer: str = ""
    ) -> str:
        """
        Generate a JWT token representing an MCP instance based on user ID, project ID, table ID, and JSON path

        Args:
            user_id: User ID
            project_id: Project ID
            table_id: Table ID
            json_pointer: JSONPath

        Returns:
            JWT token string
        """
        payload = {
            "user_id": user_id,
            "project_id": project_id,
            "table_id": table_id,
            "json_pointer": json_pointer,
            "iat": datetime.now(timezone.utc),
        }
        token = jwt.encode(
            payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM
        )
        return token

    def decode_mcp_token(self, token: str) -> McpTokenPayload:
        """
        Decode an MCP JWT token

        Args:
            token: JWT token string

        Returns:
            McpTokenPayload object

        Raises:
            AuthException: If token is invalid or expired
        """
        try:
            payload = jwt.decode(
                token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
            )
            return McpTokenPayload(**payload)
        except jwt.ExpiredSignatureError:
            raise AuthException("Token has expired", code=ErrorCode.TOKEN_EXPIRED)
        except jwt.InvalidTokenError:
            raise AuthException("Invalid token", code=ErrorCode.INVALID_TOKEN)
        except Exception as e:
            raise AuthException(
                f"Error decoding token: {e}", code=ErrorCode.INVALID_TOKEN
            )

    # ============================================================
    # MCP instances in the database
    # ============================================================

    async def create_mcp_instance(
        self,
        created_by: str,
        project_id: str,
        table_id: str,
        name: str,
        json_pointer: str = "",
        tools_definition: Optional[Dict[str, Any]] = None,
        register_tools: Optional[List[str]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        """
        Create an MCP instance (only creates a database record, does not start a subprocess)

        Args:
            created_by: Creator user ID (for auditing, nullable)
            project_id: Project ID
            table_id: Table ID
            name: MCP instance name
            json_pointer: JSON pointer path
            tools_definition: Tool definition dictionary (optional)
            register_tools: List of tools to register (optional)
            preview_keys: Preview field list (optional)

        Returns:
            McpInstance object
        """
        # 1. Generate API_KEY
        api_key = self.generate_mcp_token(created_by, project_id, table_id, json_pointer)

        # 2. Directly create database record
        try:
            # Create database record, MCP instance enabled by default
            mcp_instance = self.instance_repo.create(
                api_key=api_key,
                created_by=created_by,
                project_id=project_id,
                table_id=table_id,
                name=name,
                json_pointer=json_pointer,
                status=1,  # Enabled by default
                # Tool configuration
                tools_definition=tools_definition,
                register_tools=register_tools,
                preview_keys=preview_keys,
                # Deprecated fields
                port=None,
                docker_info=None,
            )

            log_info(
                f"MCP instance created successfully: ID={mcp_instance.mcp_instance_id}, API_KEY: {api_key}"
            )

            return mcp_instance

        except Exception as e:
            log_error(f"MCP instance creation failed: {e}")
            # Clean up resources
            try:
                if "api_key" in locals():
                    self.instance_repo.delete_by_api_key(api_key)
            except Exception as cleanup_error:
                log_error(f"Cleanup failed: {cleanup_error}")
            raise

    async def update_mcp_instance(
        self,
        api_key: str,
        name: Optional[str] = None,
        status: Optional[int] = None,
        json_pointer: Optional[str] = None,
        tools_definition: Optional[Dict[str, Any]] = None,
        register_tools: Optional[List[str]] = None,
        preview_keys: Optional[List[str]] = None,
    ) -> McpInstance:
        """
        Update an MCP instance (only updates the database record)

        Args:
            api_key: API key
            status: Status, 0 means disabled, 1 means enabled (optional)
            json_pointer: JSON pointer path (optional)
            tools_definition: Tool definition dictionary (optional)
            register_tools: List of tools to register (optional)
            preview_keys: Preview field list (optional)

        Returns:
            Updated McpInstance object
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        try:
            # Prepare final parameters
            final_name = name if name is not None else instance.name
            final_json_pointer = (
                json_pointer if json_pointer is not None else instance.json_pointer
            )
            final_register_tools = (
                register_tools
                if register_tools is not None
                else instance.register_tools
            )
            final_tools_definition = (
                tools_definition
                if tools_definition is not None
                else instance.tools_definition
            )
            final_preview_keys = (
                preview_keys if preview_keys is not None else instance.preview_keys
            )
            target_status = status if status is not None else instance.status

            # Update database
            updated_instance = self.instance_repo.update_by_api_key(
                api_key=api_key,
                created_by=instance.created_by,
                project_id=instance.project_id,
                table_id=instance.table_id,
                name=final_name,
                json_pointer=final_json_pointer,
                status=target_status,
                port=instance.port,
                docker_info=instance.docker_info,
                tools_definition=final_tools_definition,
                register_tools=final_register_tools,
                preview_keys=final_preview_keys,
            )

            # Notify MCP Server to invalidate cache
            try:
                await self._invalidate_mcp_cache(api_key)
            except Exception as e:
                log_error(f"Failed to notify MCP Server cache invalidation: {e}")

            log_info(f"MCP instance {api_key} updated successfully")
            return updated_instance

        except Exception as e:
            log_error(f"Failed to update MCP instance: {e}")
            raise BusinessException(
                f"Failed to update MCP instance: {e}",
                code=ErrorCode.MCP_INSTANCE_UPDATE_FAILED,
            )

    async def delete_mcp_instance(self, api_key: str) -> bool:
        """
        Delete an MCP instance (only deletes the database record)

        Args:
            api_key: API key

        Returns:
            Whether deletion was successful
        """
        try:
            instance = self.instance_repo.get_by_api_key(api_key)
            if not instance:
                raise NotFoundException(
                    f"MCP instance not found: api_key={api_key}",
                    code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
                )

            # Delete record from database
            result = self.instance_repo.delete_by_api_key(api_key)

            if result:
                # Notify MCP Server to invalidate cache
                try:
                    await self._invalidate_mcp_cache(api_key)
                except Exception as e:
                    log_error(f"Failed to notify MCP Server cache invalidation: {e}")

                log_info(f"MCP instance deleted: api_key={api_key}")
            else:
                raise BusinessException(
                    f"Failed to delete MCP instance from repository: api_key={api_key}",
                    code=ErrorCode.MCP_INSTANCE_DELETE_FAILED,
                )

            return True
        except NotFoundException:
            raise
        except Exception as e:
            log_error(f"Failed to delete MCP instance {api_key}: {e}")
            raise BusinessException(
                f"Failed to delete MCP instance: {e}",
                code=ErrorCode.MCP_INSTANCE_DELETE_FAILED,
            )

    async def get_mcp_instance_status(self, api_key: str) -> Dict[str, Any]:
        """
        Get MCP instance status (simplified, calls MCP Server's healthz)

        Args:
            api_key: API key

        Returns:
            Status information dictionary
        """
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        # Call MCP Server's healthz to check service status
        mcp_server_status = await self._check_mcp_server_health()

        return {
            "name": instance.name,
            "status": instance.status,
            "port": instance.port,
            "json_pointer": instance.json_pointer,
            "tools_definition": instance.tools_definition,
            "register_tools": instance.register_tools,
            "preview_keys": instance.preview_keys,
            "docker_info": instance.docker_info,
            "mcp_server_status": mcp_server_status,
            "synced": True,
        }

    ### Basic query methods ###

    async def get_mcp_instance_by_api_key(self, api_key: str) -> Optional[McpInstance]:
        """Get MCP instance by API key"""
        return self.instance_repo.get_by_api_key(api_key)

    async def get_mcp_instance_by_id(
        self, mcp_instance_id: str
    ) -> Optional[McpInstance]:
        """Get MCP instance by instance ID"""
        return self.instance_repo.get_by_id(mcp_instance_id)

    async def get_project_mcp_instances(self, project_id: str) -> List[McpInstance]:
        """Get all MCP instances for a project (filtered by project_id)"""
        return self.instance_repo.get_by_project_id(project_id)

    async def get_mcp_instance_by_api_key_with_access_check(
        self,
        api_key: str,
        user_id: str,
        verify_project_access: Callable[[str, str], bool],
    ) -> McpInstance:
        """Get MCP instance and verify user's project access (project_id-based access)"""
        instance = self.instance_repo.get_by_api_key(api_key)
        if not instance:
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        # Verify access through project, no longer comparing user_id
        if not verify_project_access(instance.project_id, user_id):
            raise NotFoundException(
                f"MCP instance not found: api_key={api_key}",
                code=ErrorCode.MCP_INSTANCE_NOT_FOUND,
            )

        return instance

    async def check_mcp_server_health(self) -> Dict[str, Any]:
        """
        Public: Check MCP Server health status (calls /healthz)

        Returns:
            Health status dictionary
        """
        return await self._check_mcp_server_health()

    ### Private helper methods ###

    async def _check_mcp_server_health(self) -> Dict[str, Any]:
        """
        Check MCP Server health status

        Returns:
            Health status dictionary
        """
        try:
            response = await self._http_request(
                "GET", MCP_SERVER_HEALTHZ_URL, timeout=5.0
            )
            if response.status_code == 200:
                return response.json()
            else:
                return {"status": "unhealthy", "error": f"HTTP {response.status_code}"}
        except Exception as e:
            return {"status": "unhealthy", "error": str(e)}

    async def _invalidate_mcp_cache(self, api_key: str) -> None:
        """
        Notify MCP Server to invalidate cache

        Args:
            api_key: API key
        """
        try:
            await self._http_request(
                "POST",
                MCP_SERVER_CACHE_INVALIDATE_URL,
                timeout=5.0,
                json={"api_key": api_key},
            )
        except Exception as e:
            log_error(f"Failed to invalidate MCP cache: {e}")
