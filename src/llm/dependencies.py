"""
LLM Service Dependencies

FastAPI dependency injection for LLM service.
"""

from functools import lru_cache

from src.llm.service import LLMService


@lru_cache
def get_llm_service() -> LLMService:
    """
    Get LLM service instance (singleton).

    Returns:
        LLMService instance
    """
    return LLMService()

