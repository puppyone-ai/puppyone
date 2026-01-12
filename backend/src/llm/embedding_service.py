"""
Embedding Service

Core service for generating embeddings via OpenRouter (using OpenAI client).

使用 OpenAI 客户端直接调用 OpenRouter 的 embedding API，
避免 litellm 不支持 OpenRouter embedding 的问题。
"""

import asyncio
import logging
import os
from typing import Any, Optional

from src.llm.config import llm_config
from src.llm.exceptions import (
    APIKeyError,
    InvalidInputError,
    InvalidResponseError,
    LLMError,
    ModelNotFoundError,
    RateLimitError,
    TextTooLongError,
    TimeoutError,
)

logger = logging.getLogger(__name__)

# OpenRouter API base URL
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


class EmbeddingService:
    """Service for interacting with embedding models via OpenRouter."""

    # OpenAI 的 embedding token limit 示例（用于输入预检，避免难以定位的批量错误）
    _DEFAULT_MAX_INPUT_TOKENS = 8191

    def __init__(self):
        self.config = llm_config
        self.default_model = self.config.default_embedding_model
        self.supported_models = self.config.supported_embedding_models
        self.dimensions = self.config.embedding_dimensions
        self.default_batch_size = self.config.embedding_batch_size

        self._client_loaded = False
        self._async_client = None

        logger.info(
            "EmbeddingService initialized with default model: %s (OpenAI client not loaded yet)",
            self.default_model,
        )

    def _ensure_client(self) -> None:
        """
        确保 OpenAI 客户端已加载（懒加载）
        """
        if self._client_loaded:
            return

        logger.info("Initializing OpenAI client for OpenRouter embeddings...")

        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise APIKeyError("openrouter")

        try:
            from openai import AsyncOpenAI
        except ImportError as e:
            raise LLMError(
                "Missing dependency 'openai'. Please ensure openai is installed.",
                original_error=e,
            ) from e

        self._async_client = AsyncOpenAI(
            base_url=OPENROUTER_BASE_URL,
            api_key=api_key,
            timeout=float(self.config.llm_timeout),
        )
        self._client_loaded = True
        logger.info("OpenAI client initialized for OpenRouter embeddings")

    @staticmethod
    def _normalize_model_name(model: str) -> str:
        """
        将模型名称转换为 OpenRouter 格式。
        
        例如：
        - "openrouter/qwen/qwen3-embedding-8b" -> "qwen/qwen3-embedding-8b"
        - "qwen/qwen3-embedding-8b" -> "qwen/qwen3-embedding-8b"
        """
        if model.startswith("openrouter/"):
            return model[len("openrouter/"):]
        return model

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """
        粗略估算 token 数（避免引入额外依赖）

        经验值：英文平均 ~4 chars/token；中文会更紧凑，但作为预检足够。
        """
        if not text:
            return 0
        return max(1, len(text) // 4)

    def _validate_text(self, text: str, index: int | None = None) -> str:
        stripped = (text or "").strip()
        if not stripped:
            raise InvalidInputError("文本不能为空", index=index)

        estimated_tokens = self._estimate_tokens(stripped)
        if estimated_tokens > self._DEFAULT_MAX_INPUT_TOKENS:
            raise TextTooLongError(
                actual_length=estimated_tokens,
                limit_length=self._DEFAULT_MAX_INPUT_TOKENS,
                index=index,
            )
        return stripped

    def _validate_model(self, model: str) -> None:
        if model not in self.supported_models:
            raise ModelNotFoundError(model, self.supported_models)

    def _extract_embeddings(
        self, response: Any, expected_count: int
    ) -> list[list[float]]:
        data = getattr(response, "data", None)
        if data is None and isinstance(response, dict):
            data = response.get("data")

        if not data or not isinstance(data, list):
            raise InvalidResponseError("embedding", str(response))

        embeddings: list[list[float]] = []
        for item in data:
            emb = None
            if isinstance(item, dict):
                emb = item.get("embedding")
            else:
                emb = getattr(item, "embedding", None)

            if not isinstance(emb, list):
                raise InvalidResponseError("embedding", str(response))
            embeddings.append([float(x) for x in emb])

        if len(embeddings) != expected_count:
            raise InvalidResponseError(
                "embedding",
                f"Expected {expected_count} embeddings, got {len(embeddings)}",
            )

        # Validate dimensions if configured
        if self.dimensions:
            for i, emb in enumerate(embeddings):
                if len(emb) != self.dimensions:
                    raise InvalidResponseError(
                        "embedding",
                        f"Embedding dimension mismatch at index={i}: expected={self.dimensions}, got={len(emb)}",
                    )

        return embeddings

    async def _call_embedding_api(
        self, texts: list[str], model: str
    ) -> list[list[float]]:
        """
        调用 OpenRouter embedding API（带重试）
        """
        self._ensure_client()

        # 转换模型名称（去掉 openrouter/ 前缀）
        openrouter_model = self._normalize_model_name(model)

        last_error: Exception | None = None
        for attempt in range(self.config.llm_max_retries):
            try:
                logger.info(
                    "Calling OpenRouter Embedding API (attempt %s/%s): model=%s, texts=%s",
                    attempt + 1,
                    self.config.llm_max_retries,
                    openrouter_model,
                    len(texts),
                )

                # 构建请求参数
                create_params: dict[str, Any] = {
                    "model": openrouter_model,
                    "input": texts,
                    "encoding_format": "float",
                }

                # OpenAI text-embedding-3-* 支持 dimensions 参数
                if "text-embedding-3" in model and self.dimensions:
                    create_params["dimensions"] = self.dimensions

                response = await self._async_client.embeddings.create(**create_params)
                return self._extract_embeddings(response, expected_count=len(texts))

            except Exception as e:
                from openai import (
                    APIError,
                    APITimeoutError,
                    AuthenticationError,
                    RateLimitError as OpenAIRateLimitError,
                )

                if isinstance(e, AuthenticationError):
                    logger.error("OpenRouter authentication error: %s", e)
                    raise APIKeyError("openrouter") from e

                if isinstance(e, APITimeoutError):
                    logger.warning(
                        "OpenRouter timeout on attempt %s: %s", attempt + 1, e
                    )
                    last_error = TimeoutError(self.config.llm_timeout)
                    if attempt < self.config.llm_max_retries - 1:
                        await asyncio.sleep(2**attempt)
                    continue

                if isinstance(e, OpenAIRateLimitError):
                    retry_after = getattr(e, "retry_after", None)
                    logger.warning(
                        "OpenRouter rate limit on attempt %s (retry_after=%s): %s",
                        attempt + 1,
                        retry_after,
                        e,
                    )
                    last_error = RateLimitError(retry_after)
                    if attempt < self.config.llm_max_retries - 1:
                        wait_time = retry_after if retry_after else (2**attempt)
                        await asyncio.sleep(wait_time)
                    continue

                if isinstance(e, APIError):
                    status_code = getattr(e, "status_code", None)
                    logger.error(
                        "OpenRouter API error on attempt %s: status=%s, error=%s",
                        attempt + 1,
                        status_code,
                        e,
                        exc_info=True,
                    )

                    # Retry on transient server errors
                    if (
                        status_code in {500, 502, 503, 504}
                        and attempt < self.config.llm_max_retries - 1
                    ):
                        last_error = LLMError(
                            f"OpenRouter API error: {str(e)}", original_error=e
                        )
                        await asyncio.sleep(2**attempt)
                        continue

                    raise LLMError(
                        f"OpenRouter API error: {str(e)}", original_error=e
                    ) from e

                # Unexpected error
                logger.error(
                    "Unexpected embedding error on attempt %s: %s",
                    attempt + 1,
                    e,
                    exc_info=True,
                )
                last_error = LLMError(
                    f"Unexpected embedding error: {str(e)}", original_error=e
                )
                if attempt < self.config.llm_max_retries - 1:
                    await asyncio.sleep(2**attempt)
                continue

        logger.error(
            "All %s embedding retries exhausted: model=%s, texts=%s, last_error=%s",
            self.config.llm_max_retries,
            openrouter_model,
            len(texts),
            repr(last_error),
            exc_info=True,
        )
        if last_error:
            raise last_error
        raise LLMError("All embedding retries exhausted with unknown error")

    async def generate_embedding(
        self, text: str, model: Optional[str] = None
    ) -> list[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Input text to embed (must be non-empty after stripping)
            model: Optional embedding model override

        Returns:
            A list[float] representing the embedding vector
        """
        model = model or self.default_model
        self._validate_model(model)

        normalized = self._validate_text(text)
        vectors = await self._call_embedding_api([normalized], model=model)
        return vectors[0]

    async def generate_embeddings_batch(
        self,
        texts: list[str],
        model: Optional[str] = None,
        batch_size: Optional[int] = None,
    ) -> list[list[float]]:
        """
        Generate embeddings for multiple texts (with automatic batching).

        Args:
            texts: List of input texts to embed
            model: Optional embedding model override
            batch_size: Optional override for batching (defaults to config.embedding_batch_size)

        Returns:
            A list of embedding vectors, aligned with input order
        """
        if not texts:
            return []

        model = model or self.default_model
        self._validate_model(model)

        batch_size = batch_size or self.default_batch_size
        if batch_size <= 0:
            raise InvalidInputError("batch_size must be a positive integer")

        normalized_texts: list[str] = []
        for i, t in enumerate(texts):
            normalized_texts.append(self._validate_text(t, index=i))

        results: list[list[float]] = []
        for i in range(0, len(normalized_texts), batch_size):
            batch = normalized_texts[i : i + batch_size]
            batch_vectors = await self._call_embedding_api(batch, model=model)
            results.extend(batch_vectors)

        return results
