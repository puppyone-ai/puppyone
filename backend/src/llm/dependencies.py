"""
LLM Service Dependencies

FastAPI dependency injection for LLM service.
"""

import threading

from src.llm.embedding_service import EmbeddingService
from src.llm.service import LLMService


# 使用全局变量存储单例，而不是 lru_cache
# 这样可以避免 reload 时的缓存问题
_llm_service = None
_embedding_service = None
_embedding_service_lock = threading.Lock()


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


def get_embedding_service() -> EmbeddingService:
    """
    Get Embedding service instance (singleton).

    示例（FastAPI）:
        ```python
        from fastapi import Depends
        from src.llm.dependencies import get_embedding_service
        from src.llm.embedding_service import EmbeddingService

        async def handler(svc: EmbeddingService = Depends(get_embedding_service)):
            return await svc.generate_embedding("hello")
        ```
    """
    global _embedding_service
    if _embedding_service is None:
        with _embedding_service_lock:
            if _embedding_service is None:
                _embedding_service = EmbeddingService()
    return _embedding_service

