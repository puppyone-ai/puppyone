"""
LLMEdge configuration schemas (execution-layer)

This module defines Pydantic models that validate the init_configs used by
LLMEdge execution. It intentionally lives close to the edge implementation to
keep cohesion high and reduce coupling with workflow-level schemas.

Design goals
- Provide strong validation for different provider/hoster paths
- Make provider-specific constraints explicit (e.g., response_format only for openrouter)
- Offer a function to export JSON Schema for contract generation

Note
- Workflow-level payload schemas remain in `PuppyEngine/DataClass/schemas.py`.
  Those validate blocks/edges structures used by the engine pipeline.
  The models here validate the execution init_configs for the LLM edge only.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field
from pydantic import field_validator, model_validator


AllowedHoster = Literal["openrouter", "ollama", "huggingface", "litellm"]


class MessageModel(BaseModel):
    """OpenAI-style chat message."""

    role: Literal["system", "user", "assistant", "tool"] = "user"
    content: str


class JsonSchemaBlock(BaseModel):
    """Shape for response_format.json_schema.json_schema field."""

    name: Optional[str] = None
    schema: Dict[str, Any] = Field(
        default_factory=dict,
        description="A valid JSON Schema object describing the strict output."
    )
    strict: Optional[bool] = Field(
        default=True,
        description="When true, provider should enforce strict schema conformance if supported."
    )


class ResponseFormatModel(BaseModel):
    """OpenAI/Responses API compatible response_format."""

    type: Literal["json_schema"]
    json_schema: JsonSchemaBlock


class LLMEdgeInitConfigs(BaseModel):
    """Validated init_configs for LLMEdge execution.

    Important behavioral constraints:
    - response_format is only allowed when hoster == "openrouter"
    - json_format is only allowed when hoster == "ollama" (best-effort only)
    - model must be a mapping with exactly one model name key
    """

    hoster: AllowedHoster = Field(
        default="openrouter",
        description="Model provider hoster. OpenRouter for remote strict schema, Ollama for local best-effort JSON."
    )

    # The current LLMEdge expects a mapping { model_name: { ...info } }
    model: Dict[str, Dict[str, Any]] = Field(
        description="Single-key mapping of model_name -> model_info."
    )

    # Messages and optional chat history
    messages: List[MessageModel] = Field(default_factory=list)
    chat_histories: Optional[List[MessageModel]] = None

    # Provider-specific structure options
    response_format: Optional[ResponseFormatModel] = Field(
        default=None,
        description="Only supported for hoster=='openrouter'."
    )
    structured_output: Optional[bool] = Field(
        default=False,
        description="Adds 'in json format' hint to messages; does not guarantee strict schema."
    )
    json_format: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Ollama local-only JSON schema hint (best-effort)."
    )

    # General generation options
    temperature: Optional[float] = Field(default=0.7, ge=0.0)
    max_tokens: Optional[int] = Field(default=2048, ge=1)
    stream: Optional[bool] = False
    top_p: Optional[float] = None
    n: Optional[int] = None
    stop: Optional[List[str]] = None
    presence_penalty: Optional[float] = None
    frequency_penalty: Optional[float] = None

    # Optional auth/endpoint overrides
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    api_base: Optional[str] = None  # for huggingface

    @model_validator(mode="after")
    def _validate_provider_constraints(self) -> "LLMEdgeInitConfigs":
        # Validate single-key model mapping
        keys = list(self.model.keys()) if self.model else []
        if len(keys) != 1:
            raise ValueError("model must be a mapping with exactly one model_name key")

        # response_format only with openrouter
        if self.response_format is not None and self.hoster != "openrouter":
            raise ValueError("response_format is only supported when hoster == 'openrouter'")

        # json_format only with ollama
        if self.json_format is not None and self.hoster != "ollama":
            raise ValueError("json_format is only supported when hoster == 'ollama'")

        return self

    @field_validator("messages")
    @classmethod
    def _non_empty_messages(cls, v: List[MessageModel]) -> List[MessageModel]:
        if not v:
            raise ValueError("messages must not be empty")
        return v


def get_llm_inputs_json_schema() -> Dict[str, Any]:
    """Export JSON Schema for LLMEdge init_configs inputs.

    This is useful for generating public contract snippets (inputs schema) or
    building UI forms dynamically.
    """

    # By default, Pydantic v2 returns the JSON-schema compatible dict
    return LLMEdgeInitConfigs.model_json_schema()


__all__ = [
    "MessageModel",
    "JsonSchemaBlock",
    "ResponseFormatModel",
    "LLMEdgeInitConfigs",
    "get_llm_inputs_json_schema",
]

# Rebuild to resolve postponed annotations (e.g., type aliases) under pydantic v2
try:
    LLMEdgeInitConfigs.model_rebuild()
except Exception:
    pass


