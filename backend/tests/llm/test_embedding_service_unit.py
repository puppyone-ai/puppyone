import asyncio

import pytest

from src.llm.embedding_service import EmbeddingService
from src.llm.exceptions import APIKeyError, InvalidInputError, RateLimitError, TextTooLongError


def _make_service(monkeypatch, *, call_impl, dimensions=3, models=None):
    svc = EmbeddingService()
    svc.dimensions = dimensions
    svc.default_model = "openrouter/openai/text-embedding-3-small"
    svc.supported_models = models or [svc.default_model]

    async def _call_embedding_api(texts, model):
        return await call_impl(texts=texts, model=model)

    monkeypatch.setattr(svc, "_call_embedding_api", _call_embedding_api)
    return svc


def test_lazy_load_not_triggered_on_init():
    svc = EmbeddingService()
    assert svc._client_loaded is False


def test_generate_embedding_success(monkeypatch):
    async def call_stub(*, texts, model):
        assert texts == ["hello"]
        assert model == "openrouter/openai/text-embedding-3-small"
        return [[0.1, 0.2, 0.3]]

    svc = _make_service(monkeypatch, call_impl=call_stub, dimensions=3)
    vec = asyncio.run(svc.generate_embedding("hello"))
    assert vec == [0.1, 0.2, 0.3]


def test_generate_embedding_empty_text_raises(monkeypatch):
    async def call_stub(*, texts, model):
        raise AssertionError("should not call external api for empty text")

    svc = _make_service(monkeypatch, call_impl=call_stub)
    with pytest.raises(InvalidInputError):
        asyncio.run(svc.generate_embedding("   "))


def test_generate_embedding_text_too_long_raises(monkeypatch):
    async def call_stub(*, texts, model):
        raise AssertionError("should not call external api for too-long text")

    svc = _make_service(monkeypatch, call_impl=call_stub)
    too_long = "a" * (8191 * 4 + 10)
    with pytest.raises(TextTooLongError):
        asyncio.run(svc.generate_embedding(too_long))


def test_generate_embeddings_batch_empty_list_returns_empty(monkeypatch):
    async def call_stub(*, texts, model):
        raise AssertionError("should not call external api for empty list")

    svc = _make_service(monkeypatch, call_impl=call_stub)
    assert asyncio.run(svc.generate_embeddings_batch([])) == []


def test_generate_embeddings_batch_auto_batches_and_preserves_order(monkeypatch):
    calls = []

    async def call_stub(*, texts, model):
        calls.append(list(texts))
        out = []
        for t in texts:
            base = float(ord(t[-1]))
            out.append([base, base + 1, base + 2])
        return out

    svc = _make_service(monkeypatch, call_impl=call_stub, dimensions=3)
    texts = ["t1", "t2", "t3", "t4", "t5"]
    out = asyncio.run(svc.generate_embeddings_batch(texts, batch_size=2))

    assert calls == [["t1", "t2"], ["t3", "t4"], ["t5"]]
    assert len(out) == len(texts)
    assert out[0][0] == float(ord("1"))
    assert out[4][0] == float(ord("5"))


def test_auth_error_bubbles_up(monkeypatch):
    async def call_stub(*, texts, model):
        raise APIKeyError("openrouter")

    svc = _make_service(monkeypatch, call_impl=call_stub, dimensions=3)
    with pytest.raises(APIKeyError):
        asyncio.run(svc.generate_embedding("hello"))


def test_rate_limit_error_bubbles_up(monkeypatch):
    async def call_stub(*, texts, model):
        raise RateLimitError()

    svc = _make_service(monkeypatch, call_impl=call_stub, dimensions=3)
    with pytest.raises(RateLimitError):
        asyncio.run(svc.generate_embedding("hello"))
