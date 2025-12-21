"""
LLM Service Dependencies

FastAPI dependency injection for LLM service.
"""

from src.llm.service import LLMService


# 使用全局变量存储单例，而不是 lru_cache
# 这样可以避免 reload 时的缓存问题
_llm_service = None


def get_llm_service() -> LLMService:
    """
    Get LLM service instance (singleton).

    Returns:
        LLMService instance
    """
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service

