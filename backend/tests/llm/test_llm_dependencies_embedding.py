from src.llm.dependencies import get_embedding_service
from src.llm.embedding_service import EmbeddingService


def test_get_embedding_service_is_singleton():
    svc1 = get_embedding_service()
    svc2 = get_embedding_service()
    assert svc1 is svc2
    assert isinstance(svc1, EmbeddingService)



