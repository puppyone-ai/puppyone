"""
Embedding Service

Core service for generating embeddings via litellm.

注意：litellm 库的导入非常慢（20秒+），所以我们使用懒加载策略，
只在实际调用 embedding 时才导入，以提升应用启动和 reload 速度。
"""

import asyncio
import logging
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


class EmbeddingService:
    """Service for interacting with embedding models."""

    # OpenAI 的 embedding token limit 示例（用于输入预检，避免难以定位的批量错误）
    _DEFAULT_MAX_INPUT_TOKENS = 8191

    def __init__(self):
        self.config = llm_config
        self.default_model = self.config.default_embedding_model
        self.supported_models = self.config.supported_embedding_models
        self.dimensions = self.config.embedding_dimensions
        self.default_batch_size = self.config.embedding_batch_size

        self._litellm_loaded = False
        self._aembedding = None

        # 缓存 litellm 异常类型（懒加载后填充）
        self._exc_APIError = None
        self._exc_AuthenticationError = None
        self._exc_RateLimitError = None
        self._exc_Timeout = None

        logger.info(
            "EmbeddingService initialized with default model: %s (litellm not loaded yet)",
            self.default_model,
        )

    def _ensure_litellm(self) -> None:
        """
        确保 litellm 已加载（懒加载）

        只在第一次调用 embedding 时才导入 litellm，避免在应用启动时加载这个重量级库。
        """
        if self._litellm_loaded:
            return

        logger.info(
            "Lazy-loading litellm library for embeddings (this may take a few seconds on first use)..."
        )
        start_time = (
            asyncio.get_event_loop().time()
            if asyncio.get_event_loop().is_running()
            else 0
        )
        try:
            from litellm import aembedding
            from litellm.exceptions import (
                APIError,
                AuthenticationError,
                RateLimitError as LiteLLMRateLimitError,
                Timeout,
            )
        except ImportError as e:
            raise LLMError(
                "Missing dependency 'litellm'. Please ensure litellm is installed.",
                original_error=e,
            ) from e

        self._aembedding = aembedding
        self._exc_APIError = APIError
        self._exc_AuthenticationError = AuthenticationError
        self._exc_RateLimitError = LiteLLMRateLimitError
        self._exc_Timeout = Timeout
        self._litellm_loaded = True

        duration = (
            (asyncio.get_event_loop().time() - start_time) * 1000 if start_time else 0
        )
        logger.info(
            "litellm loaded successfully for embeddings (took %.2fms)", duration
        )

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

    def _maybe_add_dimensions(self, params: dict[str, Any], model: str) -> None:
        """
        OpenAI text-embedding-3-* 支持 dimensions 参数降维；其它模型可能不支持。
        为了避免跨模型失败，这里仅在明确支持的模型上带上 dimensions。
        """
        if "text-embedding-3" in model and self.dimensions:
            params["dimensions"] = self.dimensions

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
        调用 litellm embedding API（带重试）
        """
        self._ensure_litellm()

        request_params: dict[str, Any] = {
            "model": model,
            "input": texts,
            "timeout": self.config.llm_timeout,
        }
        self._maybe_add_dimensions(request_params, model)

        last_error: Exception | None = None
        for attempt in range(self.config.llm_max_retries):
            try:
                logger.info(
                    "Calling Embedding API (attempt %s/%s): model=%s, texts=%s",
                    attempt + 1,
                    self.config.llm_max_retries,
                    model,
                    len(texts),
                )

                response = await self._aembedding(**request_params)
                return self._extract_embeddings(response, expected_count=len(texts))

            except self._exc_AuthenticationError as e:
                provider = model.split("/")[0] if "/" in model else "unknown"
                logger.error(
                    "Embedding authentication error for provider %s: %s", provider, e
                )
                raise APIKeyError(provider) from e

            except self._exc_Timeout as e:
                logger.warning("Embedding timeout on attempt %s: %s", attempt + 1, e)
                last_error = TimeoutError(self.config.llm_timeout)
                if attempt < self.config.llm_max_retries - 1:
                    await asyncio.sleep(2**attempt)
                continue

            except self._exc_RateLimitError as e:
                retry_after = getattr(e, "retry_after", None)
                logger.warning(
                    "Embedding rate limit on attempt %s (retry_after=%s): %s",
                    attempt + 1,
                    retry_after,
                    e,
                )
                last_error = RateLimitError(retry_after)
                if attempt < self.config.llm_max_retries - 1:
                    wait_time = retry_after if retry_after else (2**attempt)
                    await asyncio.sleep(wait_time)
                continue

            except self._exc_APIError as e:
                status_code = getattr(e, "status_code", None)
                logger.error(
                    "Embedding API error on attempt %s: status=%s, error=%s",
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
                        f"Embedding API error: {str(e)}", original_error=e
                    )
                    await asyncio.sleep(2**attempt)
                    continue

                raise LLMError(
                    f"Embedding API error: {str(e)}", original_error=e
                ) from e

            except Exception as e:
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
            model,
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
