from unittest.mock import Mock

from src.chunking.config import ChunkingConfig
from src.chunking.repository import ChunkRepository, ensure_chunks_for_pointer


def _mock_supabase_insert_response(rows):
    resp = Mock()
    resp.data = rows
    return resp


def _mock_supabase_select_response(rows):
    resp = Mock()
    resp.data = rows
    return resp


def test_ensure_chunks_idempotent_when_hash_exists():
    client = Mock()
    table = Mock()
    client.table.return_value = table

    # Chain for select:
    # table.select().eq().eq().eq().order().execute()
    table.select.return_value = table
    table.eq.return_value = table
    table.order.return_value = table
    table.execute.return_value = _mock_supabase_select_response(
        [
            {
                "id": 1,
                "created_at": "2026-01-11T00:00:00Z",
                "updated_at": "2026-01-11T00:00:00Z",
                "table_id": 123,
                "json_pointer": "/a",
                "chunk_index": 0,
                "total_chunks": 1,
                "chunk_text": "hello",
                "char_start": 0,
                "char_end": 5,
                "content_hash": "x" * 64,
                "turbopuffer_namespace": None,
                "turbopuffer_doc_id": None,
            }
        ]
    )

    repo = ChunkRepository(client)
    res = ensure_chunks_for_pointer(
        repo=repo, table_id=123, json_pointer="/a", content="hello"
    )

    assert res.created is False
    assert len(res.chunks) == 1
    assert table.insert.call_count == 0


def test_ensure_chunks_creates_when_missing():
    client = Mock()
    table = Mock()
    client.table.return_value = table

    # First: select returns empty
    table.select.return_value = table
    table.eq.return_value = table
    table.order.return_value = table
    select_empty = _mock_supabase_select_response([])

    # Insert call returns two rows (note: timestamps as ISO strings are accepted by pydantic datetime)
    def insert_side_effect(payload):
        assert isinstance(payload, list)
        assert payload[0]["chunk_index"] == 0
        assert payload[0]["total_chunks"] == 2
        return table

    table.insert.side_effect = insert_side_effect

    inserted_rows = [
        {
            "id": 10,
            "created_at": "2026-01-11T00:00:00Z",
            "updated_at": "2026-01-11T00:00:00Z",
            "table_id": 1,
            "json_pointer": "/p",
            "chunk_index": 0,
            "total_chunks": 2,
            "chunk_text": "A" * 10,
            "char_start": 0,
            "char_end": 10,
            "content_hash": "y" * 64,
            "turbopuffer_namespace": None,
            "turbopuffer_doc_id": None,
        },
        {
            "id": 11,
            "created_at": "2026-01-11T00:00:00Z",
            "updated_at": "2026-01-11T00:00:00Z",
            "table_id": 1,
            "json_pointer": "/p",
            "chunk_index": 1,
            "total_chunks": 2,
            "chunk_text": "B" * 10,
            "char_start": 9,
            "char_end": 19,
            "content_hash": "y" * 64,
            "turbopuffer_namespace": None,
            "turbopuffer_doc_id": None,
        },
    ]
    insert_resp = _mock_supabase_insert_response(inserted_rows)
    table.execute.side_effect = [select_empty, insert_resp]

    repo = ChunkRepository(client)
    cfg = ChunkingConfig(chunk_size_chars=10, chunk_overlap_chars=1, max_content_size_chars=1000)
    res = ensure_chunks_for_pointer(
        repo=repo, table_id=1, json_pointer="/p", content="A" * 10 + "B" * 9, config=cfg
    )

    assert res.created is True
    assert len(res.chunks) == 2
    assert res.chunks[0].chunk_index == 0
    assert res.chunks[1].chunk_index == 1

