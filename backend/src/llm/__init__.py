"""
LLM Service Module

Provides unified interface for interacting with text models and embedding models via litellm.
"""

from src.llm.dependencies import get_embedding_service, get_llm_service
from src.llm.embedding_service import EmbeddingService
from src.llm.service import LLMService
from src.llm.schemas import (
    BatchEmbeddingRequest,
    BatchEmbeddingResponse,
    EmbeddingRequest,
    EmbeddingResponse,
    TextModelRequest,
    TextModelResponse,
)

__all__ = [
    "LLMService",
    "EmbeddingService",
    "get_llm_service",
    "get_embedding_service",
    "TextModelRequest",
    "TextModelResponse",
    "EmbeddingRequest",
    "EmbeddingResponse",
    "BatchEmbeddingRequest",
    "BatchEmbeddingResponse",
]
