from __future__ import annotations

from src.chunking.repository import ChunkRepository
from src.chunking.service import ChunkingService
from src.content_node.dependencies import get_content_node_service
from src.llm.embedding_service import EmbeddingService
from src.search.service import SearchService
from src.supabase.client import SupabaseClient
from src.turbopuffer.service import TurbopufferSearchService

_search_service: SearchService | None = None


def get_search_service() -> SearchService:
    global _search_service
    if _search_service is None:
        # 使用低层 supabase client 以便直接操作 chunks 表（chunking/repository 的接口约定）
        sb_client = SupabaseClient().get_client()
        chunk_repo = ChunkRepository(sb_client)
        _search_service = SearchService(
            node_service=get_content_node_service(),
            chunk_repo=chunk_repo,
            chunking_service=ChunkingService(),
            embedding_service=EmbeddingService(),
            turbopuffer_service=TurbopufferSearchService(),
        )
    return _search_service
