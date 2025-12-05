"""
ETL Rule Schemas

Pydantic models for ETL transformation rules.
"""

from datetime import datetime, UTC
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class ETLRule(BaseModel):
    """ETL transformation rule definition."""

    rule_id: str = Field(..., description="Unique rule identifier")
    name: str = Field(..., description="Rule name")
    description: str = Field(..., description="Rule description")
    json_schema: dict[str, Any] = Field(..., description="JSON Schema for output structure")
    system_prompt: Optional[str] = Field(
        None,
        description="System prompt to guide LLM transformation"
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("json_schema")
    @classmethod
    def validate_json_schema(cls, v: dict[str, Any]) -> dict[str, Any]:
        """Validate that json_schema is a valid JSON Schema object."""
        if not isinstance(v, dict):
            raise ValueError("json_schema must be a dictionary")
        if "type" not in v:
            raise ValueError("json_schema must have a 'type' field")
        return v


class RuleCreateRequest(BaseModel):
    """Request to create a new ETL rule."""

    name: str = Field(..., description="Rule name")
    description: str = Field(..., description="Rule description")
    json_schema: dict[str, Any] = Field(..., description="JSON Schema for output")
    system_prompt: Optional[str] = Field(
        None,
        description="Optional system prompt"
    )


class RuleUpdateRequest(BaseModel):
    """Request to update an existing ETL rule."""

    name: Optional[str] = Field(None, description="Rule name")
    description: Optional[str] = Field(None, description="Rule description")
    json_schema: Optional[dict[str, Any]] = Field(None, description="JSON Schema")
    system_prompt: Optional[str] = Field(None, description="System prompt")


class TransformationResult(BaseModel):
    """Result of applying an ETL rule."""

    success: bool = Field(..., description="Whether transformation succeeded")
    output: Optional[dict[str, Any]] = Field(None, description="Transformed JSON output")
    error: Optional[str] = Field(None, description="Error message if failed")
    llm_usage: Optional[dict[str, Any]] = Field(None, description="LLM usage statistics")

