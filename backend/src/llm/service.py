"""
LLM Service

Core service for interacting with text models via litellm.

注意：litellm 库的导入非常慢（20秒+），所以我们使用懒加载策略，
只在实际调用 LLM 时才导入，以提升应用启动和 reload 速度。
"""

import asyncio
import json
import logging
from typing import Any, Literal, Optional

# 延迟导入 litellm - 只在实际使用时才导入
# from litellm import acompletion  # 不在这里导入！

from src.llm.config import llm_config
from src.llm.exceptions import (
    APIKeyError,
    InvalidResponseError,
    LLMError,
    ModelNotFoundError,
    RateLimitError,
    TimeoutError,
)
from src.llm.schemas import TextModelRequest, TextModelResponse

logger = logging.getLogger(__name__)


class LLMService:
    """Service for interacting with LLM models."""

    def __init__(self):
        """Initialize LLM service with configuration."""
        self.config = llm_config
        self.default_model = self.config.default_text_model
        self.supported_models = self.config.supported_text_models
        self._litellm_loaded = False
        self._acompletion = None
        logger.info(
            f"LLMService initialized with default model: {self.default_model} (litellm not loaded yet)"
        )

    def _ensure_litellm(self):
        """
        确保 litellm 已加载（懒加载）

        只在第一次调用 LLM 时才导入 litellm，避免在应用启动时加载这个重量级库。
        这能将启动时间从 ~43秒 降低到 ~20秒。
        """
        if not self._litellm_loaded:
            logger.info(
                "Lazy-loading litellm library (this may take a few seconds on first use)..."
            )
            start_time = (
                asyncio.get_event_loop().time()
                if asyncio.get_event_loop().is_running()
                else 0
            )

            from litellm import acompletion

            self._acompletion = acompletion
            self._litellm_loaded = True

            duration = (
                (asyncio.get_event_loop().time() - start_time) * 1000
                if start_time
                else 0
            )
            logger.info(f"litellm loaded successfully (took {duration:.2f}ms)")

    async def call_text_model(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        response_format: Literal["text", "json_object"] = "text",
        max_tokens: Optional[int] = None,
    ) -> TextModelResponse:
        """
        Call a text model with the given prompt.

        Args:
            prompt: User prompt for the model
            system_prompt: Optional system prompt to guide model behavior
            model: Model to use (defaults to config default)
            temperature: Temperature for generation (defaults to config default)
            response_format: Response format - 'text' or 'json_object'
            max_tokens: Maximum tokens to generate

        Returns:
            TextModelResponse with generated content and metadata

        Raises:
            ModelNotFoundError: If requested model is not supported
            APIKeyError: If API key is missing or invalid
            TimeoutError: If request times out
            RateLimitError: If rate limit is exceeded
            LLMError: For other errors
        """
        # 懒加载 litellm（只在第一次使用时加载）
        self._ensure_litellm()

        # 导入异常类型（也需要懒加载）
        from litellm.exceptions import (
            APIError,
            AuthenticationError,
            RateLimitError as LiteLLMRateLimitError,
            Timeout,
        )

        # Validate model
        model = model or self.default_model
        if model not in self.supported_models:
            raise ModelNotFoundError(model, self.supported_models)

        # Build messages
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # Prepare request parameters
        temperature = (
            temperature if temperature is not None else self.config.llm_temperature
        )

        request_params: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "timeout": self.config.llm_timeout,
        }

        # Add response format for JSON mode
        if response_format == "json_object":
            request_params["response_format"] = {"type": "json_object"}

        if max_tokens:
            request_params["max_tokens"] = max_tokens

        # Retry logic
        last_error = None
        for attempt in range(self.config.llm_max_retries):
            try:
                logger.info(
                    f"Calling LLM (attempt {attempt + 1}/{self.config.llm_max_retries}): "
                    f"model={model}, response_format={response_format}"
                )

                # 使用懒加载的 acompletion
                response = await self._acompletion(**request_params)

                # Extract response content
                message = response.choices[0].message
                content = message.content

                # Handle None or empty content (some models use reasoning_content)
                if not content:
                    # For reasoning models (like Qwen3), check reasoning_content
                    if (
                        hasattr(message, "reasoning_content")
                        and message.reasoning_content
                    ):
                        logger.info(
                            "Model returned empty content but has reasoning_content. "
                            "This may indicate the model is in reasoning mode and needs more tokens."
                        )
                        content = message.reasoning_content
                    else:
                        logger.warning(
                            "Model returned empty content with no reasoning_content"
                        )
                        content = ""

                # Validate JSON format if requested
                if response_format == "json_object":
                    try:
                        json.loads(content)  # Validate it's valid JSON
                    except json.JSONDecodeError as e:
                        raise InvalidResponseError("json_object", content) from e

                # Build response
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                }

                logger.info(
                    f"LLM call successful: model={model}, "
                    f"tokens={usage['total_tokens']}, "
                    f"finish_reason={response.choices[0].finish_reason}"
                )

                return TextModelResponse(
                    content=content,
                    model=model,
                    usage=usage,
                    finish_reason=response.choices[0].finish_reason,
                )

            except AuthenticationError as e:
                # Extract provider from model
                provider = model.split("/")[0] if "/" in model else "unknown"
                logger.error(f"Authentication error for provider {provider}: {e}")
                raise APIKeyError(provider) from e

            except Timeout as e:
                logger.warning(f"Timeout on attempt {attempt + 1}: {e}")
                last_error = TimeoutError(self.config.llm_timeout)
                if attempt < self.config.llm_max_retries - 1:
                    await asyncio.sleep(2**attempt)  # Exponential backoff
                continue

            except LiteLLMRateLimitError as e:
                logger.warning(f"Rate limit exceeded on attempt {attempt + 1}: {e}")
                # Try to extract retry_after from error
                retry_after = getattr(e, "retry_after", None)
                last_error = RateLimitError(retry_after)
                if attempt < self.config.llm_max_retries - 1:
                    wait_time = retry_after if retry_after else (2**attempt)
                    await asyncio.sleep(wait_time)
                continue

            except APIError as e:
                logger.error(f"API error on attempt {attempt + 1}: {e}")
                last_error = LLMError(f"API error: {str(e)}", original_error=e)
                if attempt < self.config.llm_max_retries - 1:
                    await asyncio.sleep(2**attempt)
                continue

            except Exception as e:
                logger.error(f"Unexpected error on attempt {attempt + 1}: {e}")
                last_error = LLMError(f"Unexpected error: {str(e)}", original_error=e)
                if attempt < self.config.llm_max_retries - 1:
                    await asyncio.sleep(2**attempt)
                continue

        # All retries exhausted
        logger.error(f"All {self.config.llm_max_retries} retries exhausted")
        if last_error:
            raise last_error
        raise LLMError("All retries exhausted with unknown error")

    async def call_text_model_from_request(
        self, request: TextModelRequest
    ) -> TextModelResponse:
        """
        Call text model using a TextModelRequest object.

        Args:
            request: TextModelRequest with all parameters

        Returns:
            TextModelResponse with generated content
        """
        return await self.call_text_model(
            prompt=request.prompt,
            system_prompt=request.system_prompt,
            model=request.model,
            temperature=request.temperature,
            response_format=request.response_format or "text",
            max_tokens=request.max_tokens,
        )

    def get_supported_models(self) -> list[str]:
        """Get list of supported models."""
        return self.supported_models.copy()

    def is_model_supported(self, model: str) -> bool:
        """Check if a model is supported."""
        return model in self.supported_models
