import os
import uuid
import math
import pytest


@pytest.mark.integration
@pytest.mark.pgv
def test_pgv_store_and_search(pgv_db):
    # vecs client in PostgresVectorDatabase expects SUPABASE_URL in config
    # Map DATABASE_URL to SUPABASE_URL for tests if not set
    os.environ.setdefault("SUPABASE_URL", os.environ.get("DATABASE_URL", ""))

    from vector.vdb.pgv import PostgresVectorDatabase

    db = PostgresVectorDatabase()
    collection = f"test_collection_{uuid.uuid4().hex[:8]}"

    # Small deterministic dataset
    vectors = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ]
    contents = ["A", "B", "C"]

    db.store_vectors(vectors=vectors, contents=contents, collection_name=collection)

    res = db.search_vectors(collection_name=collection, query_vector=[1.0, 0.0, 0.0], top_k=2)
    assert len(res) >= 1
    # The top result should be content "A"
    assert any(r.get("content") == "A" for r in res[:1])

    # Cleanup
    assert db.delete_collection(collection_name=collection)


@pytest.mark.integration
@pytest.mark.pgv
def test_pgv_metrics_and_dimension_mismatch(pgv_db):
    os.environ.setdefault("SUPABASE_URL", os.environ.get("DATABASE_URL", ""))
    from vector.vdb.pgv import PostgresVectorDatabase

    db = PostgresVectorDatabase()
    collection = f"test_collection_{uuid.uuid4().hex[:8]}"

    vectors = [[1.0, 0.0, 0.0], [0.5, 0.5, 0.0]]
    contents = ["A", "B"]
    db.store_vectors(vectors=vectors, contents=contents, collection_name=collection)

    # Different metric
    res_l2 = db.search_vectors(collection_name=collection, query_vector=[1.0, 0.0, 0.0], top_k=2, metric="l2")
    assert len(res_l2) >= 1

    # Dimension mismatch should yield empty results (handled inside)
    res_bad = db.search_vectors(collection_name=collection, query_vector=[1.0, 0.0], top_k=2)
    assert res_bad == []

    assert db.delete_collection(collection_name=collection)


