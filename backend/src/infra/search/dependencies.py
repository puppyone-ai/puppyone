from __future__ import annotations

from src.infra.chunking.repository import ChunkRepository
from src.infra.chunking.service import ChunkingService
from src.content.repository import ContentNodeRepository
from src.content.service import ContentNodeService
from src.infra.llm.embedding_service import EmbeddingService
from src.infra.s3.service import S3Service
from src.infra.search.service import SearchService
from src.infra.supabase.client import SupabaseClient
from src.infra.turbopuffer.service import TurbopufferSearchService
from src.platform.project.dependencies import get_project_service

_search_service: SearchService | None = None


def get_search_service() -> SearchService:
    global _search_service
    if _search_service is None:
        # 使用低层 supabase client 以便直接操作 chunks 表（chunking/repository 的接口约定）
        sb_client = SupabaseClient().get_client()
        chunk_repo = ChunkRepository(sb_client)
        
        # 手动创建 ContentNodeService（不使用 Depends，因为这里不在 FastAPI 请求上下文中）
        node_repo = ContentNodeRepository(SupabaseClient())
        s3_service = S3Service()
        node_service = ContentNodeService(node_repo, s3_service)
        
        _search_service = SearchService(
            node_service=node_service,
            chunk_repo=chunk_repo,
            project_service=get_project_service(),
            chunking_service=ChunkingService(),
            embedding_service=EmbeddingService(),
            turbopuffer_service=TurbopufferSearchService(),
        )
    return _search_service
