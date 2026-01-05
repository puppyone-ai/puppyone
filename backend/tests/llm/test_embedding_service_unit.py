import asyncio

import pytest

from src.llm.embedding_service import EmbeddingService
from src.llm.exceptions import APIKeyError, InvalidInputError, RateLimitError, TextTooLongError


class _StubAuthError(Exception):
    pass


class _StubTimeout(Exception):
    pass


class _StubRateLimit(Exception):
    def __init__(self, retry_after=None):
        super().__init__("rate limited")
        self.retry_after = retry_after


class _StubAPIError(Exception):
    def __init__(self, status_code=None):
        super().__init__("api error")
        self.status_code = status_code


class _StubEmbeddingItem:
    def __init__(self, embedding):
        self.embedding = embedding


class _StubEmbeddingResponse:
    def __init__(self, data):
        self.data = data


def _make_service(monkeypatch, *, aembedding_impl, dimensions=3, models=None):
    svc = EmbeddingService()
    svc.dimensions = dimensions
    svc.default_model = "openrouter/openai/text-embedding-3-small"
    svc.supported_models = models or [svc.default_model]

    def _ensure():
        svc._litellm_loaded = True
        svc._aembedding = aembedding_impl
        svc._exc_AuthenticationError = _StubAuthError
        svc._exc_Timeout = _StubTimeout
        svc._exc_RateLimitError = _StubRateLimit
        svc._exc_APIError = _StubAPIError

    monkeypatch.setattr(svc, "_ensure_litellm", _ensure)
    return svc


def test_lazy_load_not_triggered_on_init():
    svc = EmbeddingService()
    assert svc._litellm_loaded is False


def test_generate_embedding_success(monkeypatch):
    async def aembedding_stub(**kwargs):
        assert kwargs["input"] == ["hello"]
        return _StubEmbeddingResponse([_StubEmbeddingItem([0.1, 0.2, 0.3])])

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub, dimensions=3)
    vec = asyncio.run(svc.generate_embedding("hello"))
    assert vec == [0.1, 0.2, 0.3]


def test_generate_embedding_empty_text_raises(monkeypatch):
    async def aembedding_stub(**kwargs):
        raise AssertionError("should not call external api for empty text")

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub)
    with pytest.raises(InvalidInputError):
        asyncio.run(svc.generate_embedding("   "))


def test_generate_embedding_text_too_long_raises(monkeypatch):
    async def aembedding_stub(**kwargs):
        raise AssertionError("should not call external api for too-long text")

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub)
    # token estimate ~ len(text)//4, so make it bigger than 8191*4
    too_long = "a" * (8191 * 4 + 10)
    with pytest.raises(TextTooLongError):
        asyncio.run(svc.generate_embedding(too_long))


def test_generate_embeddings_batch_empty_list_returns_empty(monkeypatch):
    async def aembedding_stub(**kwargs):
        raise AssertionError("should not call external api for empty list")

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub)
    assert asyncio.run(svc.generate_embeddings_batch([])) == []


def test_generate_embeddings_batch_auto_batches_and_preserves_order(monkeypatch):
    calls = []

    async def aembedding_stub(**kwargs):
        calls.append(list(kwargs["input"]))
        # return embeddings aligned with input
        data = []
        for t in kwargs["input"]:
            base = float(ord(t[-1]))  # stable per-text
            data.append(_StubEmbeddingItem([base, base + 1, base + 2]))
        return _StubEmbeddingResponse(data)

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub, dimensions=3)
    texts = ["t1", "t2", "t3", "t4", "t5"]
    out = asyncio.run(svc.generate_embeddings_batch(texts, batch_size=2))

    assert calls == [["t1", "t2"], ["t3", "t4"], ["t5"]]
    assert len(out) == len(texts)
    # order preserved: embedding derived from last char
    assert out[0][0] == float(ord("1"))
    assert out[4][0] == float(ord("5"))


def test_rate_limit_retries_then_success(monkeypatch):
    attempt = {"n": 0}

    async def aembedding_stub(**kwargs):
        attempt["n"] += 1
        if attempt["n"] == 1:
            raise _StubRateLimit(retry_after=None)
        return _StubEmbeddingResponse([_StubEmbeddingItem([0.1, 0.2, 0.3])])

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub, dimensions=3)

    async def _no_sleep(_):
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    vec = asyncio.run(svc.generate_embedding("hello"))
    assert vec == [0.1, 0.2, 0.3]
    assert attempt["n"] == 2


def test_auth_error_does_not_retry(monkeypatch):
    attempt = {"n": 0}

    async def aembedding_stub(**kwargs):
        attempt["n"] += 1
        raise _StubAuthError("unauthorized")

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub, dimensions=3)
    with pytest.raises(APIKeyError):
        asyncio.run(svc.generate_embedding("hello"))
    assert attempt["n"] == 1


def test_rate_limit_exhausted_raises_rate_limit_error(monkeypatch):
    async def aembedding_stub(**kwargs):
        raise _StubRateLimit(retry_after=None)

    svc = _make_service(monkeypatch, aembedding_impl=aembedding_stub, dimensions=3)

    async def _no_sleep(_):
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    with pytest.raises(RateLimitError):
        asyncio.run(svc.generate_embedding("hello"))


