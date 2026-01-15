class AgentService:
    """Placeholder service for agent logic."""

    async def should_use_bash(self, node_data, bash_access) -> bool:
        if not bash_access:
            return False
        return node_data is not None
