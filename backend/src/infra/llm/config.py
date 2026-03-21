"""
LLM Service Configuration

Manages configuration for LLM models including API keys, model settings, and timeouts.
"""

import logging
import os

from pydantic import Field
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

_ENV_FILE = ".env"
_ENV_FILE_FOR_SETTINGS = (
    _ENV_FILE if (os.path.isfile(_ENV_FILE) and os.access(_ENV_FILE, os.R_OK)) else None
)


class LLMConfig(BaseSettings):
    """Configuration for LLM service."""

    model_config = SettingsConfigDict(
        # 在某些受限环境（如沙盒/CI）中 `.env` 可能不可读；此时不应阻断应用启动
        env_file=_ENV_FILE_FOR_SETTINGS,
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    # Default model to use
    default_text_model: str = Field(
        default="openrouter/qwen/qwen3-235b-a22b-2507",
        description="Default text model for general purposes",
    )

    # Supported models (format: provider/model-name)
    supported_text_models: list[str] = Field(
        default=[
            "openrouter/qwen/qwen3-235b-a22b-2507",
            "openrouter/deepseek/deepseek-v3.2",
            "openrouter/deepseek/deepseek-v3.2-speciale",
            "openrouter/openai/gpt-5.1",
            "openrouter/anthropic/claude-sonnet-4.5",
            "openrouter/google/gemini-3-pro-preview",
            "openrouter/qwen/qwen3-8b",
        ],
        description="List of supported text models",
    )

    # Default embedding model to use
    default_embedding_model: str = Field(
        default="openrouter/openai/text-embedding-3-small",
        description="Default embedding model for vectorization (via OpenRouter)",
    )

    # Supported embedding models (format: openrouter/provider/model-name)
    supported_embedding_models: list[str] = Field(
        default=[
            "openrouter/baai/bge-m3",
            "openrouter/qwen/qwen3-embedding-8b",
            "openrouter/qwen/qwen3-embedding-4b",
            "openrouter/openai/text-embedding-3-small",
            "openrouter/google/gemini-embedding-001",
        ],
        description="List of supported embedding models",
    )

    # Embedding vector dimensions (default: 1536 for text-embedding-3-small)
    embedding_dimensions: int = Field(
        default=1536,
        description="Expected embedding vector dimensions (default 1536)",
    )

    # Embedding batch size (used by EmbeddingService when splitting large inputs)
    embedding_batch_size: int = Field(
        default=100,
        description="Batch size for embedding generation (1-2048, default 100)",
    )

    # Request timeout settings
    llm_timeout: int = Field(
        default=60, description="Timeout for LLM API calls in seconds"
    )

    # Temperature for deterministic outputs
    llm_temperature: float = Field(
        default=0.3,
        description="Temperature for LLM outputs (lower = more deterministic)",
    )

    # Max retries on failure
    llm_max_retries: int = Field(
        default=3, description="Maximum number of retries on API failure"
    )

    @field_validator("embedding_dimensions")
    @classmethod
    def _validate_embedding_dimensions(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("embedding_dimensions must be a positive integer")
        return v

    @field_validator("embedding_batch_size")
    @classmethod
    def _validate_embedding_batch_size(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("embedding_batch_size must be a positive integer")
        if v < 1 or v > 2048:
            logger.warning(
                "embedding_batch_size=%s is out of range (1-2048); falling back to default=100",
                v,
            )
            return 100
        return v

    @model_validator(mode="after")
    def _warn_if_embedding_config_suspicious(self) -> "LLMConfig":
        # API key presence validation (non-blocking)
        if not os.environ.get("OPENROUTER_API_KEY"):
            logger.warning(
                "OPENROUTER_API_KEY is not set. Embedding and text model calls via OpenRouter may fail at runtime."
            )

        # Model name format validation (non-blocking)
        for model in [self.default_embedding_model, *self.supported_embedding_models]:
            if not isinstance(model, str) or not model.strip():
                logger.warning("Embedding model name is empty or invalid: %r", model)
                continue
            if not model.startswith("openrouter/") or model.count("/") < 2:
                logger.warning(
                    "Embedding model name format looks suspicious (expected 'openrouter/provider/model'): %s",
                    model,
                )

        # Dimension mismatch warning for the default model (best-effort)
        if self.default_embedding_model == "openrouter/openai/text-embedding-3-small":
            if self.embedding_dimensions != 1536:
                logger.warning(
                    "embedding_dimensions=%s does not match default model '%s' expected dimension 1536",
                    self.embedding_dimensions,
                    self.default_embedding_model,
                )

        return self


# Global config instance
llm_config = LLMConfig()
