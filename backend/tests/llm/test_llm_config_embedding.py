import pytest

from src.llm.config import LLMConfig


def test_embedding_batch_size_out_of_range_falls_back_to_default():
    cfg = LLMConfig(embedding_batch_size=9999)
    assert cfg.embedding_batch_size == 100


def test_embedding_dimensions_must_be_positive():
    with pytest.raises(ValueError):
        LLMConfig(embedding_dimensions=0)



