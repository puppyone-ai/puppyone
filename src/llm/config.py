"""
LLM Service Configuration

Manages configuration for LLM models including API keys, model settings, and timeouts.
"""

import os
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMConfig(BaseSettings):
    """Configuration for LLM service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Default model to use
    default_text_model: str = Field(
        default="openrouter/qwen/qwen3-235b-a22b-2507",
        description="Default text model for general purposes"
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
            "openrouter/qwen/qwen3-8b"
        ],
        description="List of supported text models"
    )

    # Request timeout settings
    llm_timeout: int = Field(
        default=60,
        description="Timeout for LLM API calls in seconds"
    )

    # Temperature for deterministic outputs
    llm_temperature: float = Field(
        default=0.3,
        description="Temperature for LLM outputs (lower = more deterministic)"
    )

    # Max retries on failure
    llm_max_retries: int = Field(
        default=3,
        description="Maximum number of retries on API failure"
    )


# Global config instance
llm_config = LLMConfig()

