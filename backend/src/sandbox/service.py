class SandboxService:
    """Placeholder service for sandbox logic."""

    async def start(self, session_id: str, data, readonly: bool):
        if data is None:
            return {"success": False, "error": "data is required"}
        return {"success": True}
