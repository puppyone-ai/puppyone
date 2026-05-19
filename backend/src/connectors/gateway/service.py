"""Gateway service — business logic for third-party account bindings."""
from __future__ import annotations

from src.connectors.gateway.repository import GatewayRepository
from src.connectors.gateway.schemas import GatewayDetail, GatewayOut
from src.exceptions import ErrorCode, NotFoundException


class GatewayService:
    def __init__(self, repo: GatewayRepository | None = None):
        self.repo = repo or GatewayRepository()

    def create(self, *, org_id: str, user_id: str, provider: str,
               name: str | None = None, credentials: dict | None = None,
               metadata: dict | None = None) -> dict:
        return self.repo.create(
            org_id=org_id, user_id=user_id, provider=provider,
            name=name, credentials=credentials, metadata=metadata,
        )

    def get_by_id(self, gateway_id: str) -> dict:
        gw = self.repo.get_by_id(gateway_id)
        if not gw:
            raise NotFoundException("Gateway not found", code=ErrorCode.NOT_FOUND)
        return gw

    def get_detail(self, gateway_id: str) -> GatewayDetail:
        gw = self.get_by_id(gateway_id)
        creds = gw.get("credentials") or {}
        return GatewayDetail(
            id=gw["id"],
            org_id=gw["org_id"],
            user_id=str(gw["user_id"]),
            provider=gw["provider"],
            name=gw.get("name"),
            status=gw.get("status", "active"),
            metadata=gw.get("metadata") or {},
            has_credentials=bool(creds),
            credential_keys=list(creds.keys()),
            access_point_count=self.repo.count_connectors(gateway_id),
            created_at=gw.get("created_at"),
            updated_at=gw.get("updated_at"),
        )

    def list_by_org(self, org_id: str, *, provider: str | None = None) -> list[GatewayOut]:
        rows = self.repo.list_by_org(org_id, provider=provider)
        return [self._to_out(r) for r in rows]

    def update(self, gateway_id: str, *, name: str | None = None,
               metadata: dict | None = None, status: str | None = None) -> dict:
        self.get_by_id(gateway_id)  # verify exists
        fields = {}
        if name is not None:
            fields["name"] = name
        if metadata is not None:
            fields["metadata"] = metadata
        if status is not None:
            fields["status"] = status
        if not fields:
            return self.repo.get_by_id(gateway_id)
        return self.repo.update(gateway_id, fields)

    def delete(self, gateway_id: str) -> bool:
        self.get_by_id(gateway_id)  # verify exists
        ap_count = self.repo.count_connectors(gateway_id)
        if ap_count > 0:
            raise NotFoundException(
                f"Cannot delete gateway: {ap_count} access point(s) still reference it. "
                f"Delete or unbind them first.",
                code=ErrorCode.VALIDATION_ERROR,
            )
        return self.repo.delete(gateway_id)

    def refresh_token(self, gateway_id: str) -> dict:
        """Refresh OAuth token for a gateway. Provider-specific logic."""
        gw = self.get_by_id(gateway_id)
        creds = gw.get("credentials") or {}
        refresh_token = creds.get("refresh_token")
        if not refresh_token:
            raise NotFoundException(
                "No refresh token available for this gateway",
                code=ErrorCode.VALIDATION_ERROR,
            )
        # TODO: provider-specific OAuth refresh logic
        # For now, return current credentials
        return gw

    def get_credentials(self, gateway_id: str) -> dict:
        """Get credentials for sync execution. Internal use only."""
        gw = self.get_by_id(gateway_id)
        return gw.get("credentials") or {}

    @staticmethod
    def _to_out(row: dict) -> GatewayOut:
        creds = row.get("credentials") or {}
        return GatewayOut(
            id=row["id"],
            org_id=row["org_id"],
            user_id=str(row["user_id"]),
            provider=row["provider"],
            name=row.get("name"),
            status=row.get("status", "active"),
            metadata=row.get("metadata") or {},
            has_credentials=bool(creds),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )
