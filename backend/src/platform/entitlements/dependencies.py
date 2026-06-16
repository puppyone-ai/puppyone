from src.platform.entitlements.service import EntitlementService


def get_entitlement_service() -> EntitlementService:
    return EntitlementService()
