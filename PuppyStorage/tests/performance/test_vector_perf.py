"""
Performance tests for vector search operations.
Marked as 'slow' - these tests establish baseline thresholds for search latency.
"""
import os
import time
import uuid
import pytest


@pytest.mark.slow
@pytest.mark.integration
@pytest.mark.pgv
def test_vector_search_performance_small_dataset(pgv_db):
    """
    Baseline: Vector search on small dataset (1000 vectors, 384 dims) should be fast.
    Threshold: < 500ms for single search, < 2s for 10 searches
    """
    os.environ.setdefault("SUPABASE_URL", os.environ.get("DATABASE_URL", ""))
    
    from vector.vdb.pgv import PostgresVectorDatabase
    
    db = PostgresVectorDatabase()
    collection = f"perf_test_{uuid.uuid4().hex[:8]}"
    
    # Generate 1000 vectors with 384 dimensions (common embedding size)
    vector_count = 1000
    dimension = 384
    
    import random
    vectors = []
    contents = []
    for i in range(vector_count):
        # Generate random normalized vectors
        vec = [random.random() for _ in range(dimension)]
        # Simple normalization
        norm = sum(x*x for x in vec) ** 0.5
        vec = [x/norm for x in vec]
        vectors.append(vec)
        contents.append(f"content_{i}")
    
    # Store vectors
    store_start = time.time()
    db.store_vectors(vectors=vectors, contents=contents, collection_name=collection)
    store_elapsed = time.time() - store_start
    
    print(f"\n=== Vector Store Performance ===")
    print(f"Vectors stored: {vector_count}")
    print(f"Dimension: {dimension}")
    print(f"Store time: {store_elapsed:.3f}s")
    print(f"Throughput: {vector_count/store_elapsed:.1f} vectors/sec")
    
    # Single search performance
    query_vector = vectors[0]  # Use first vector as query
    search_start = time.time()
    results = db.search_vectors(collection_name=collection, query_vector=query_vector, top_k=10)
    search_elapsed = time.time() - search_start
    
    print(f"\n=== Vector Search Performance (Single) ===")
    print(f"Search time: {search_elapsed*1000:.1f}ms")
    print(f"Results returned: {len(results)}")
    
    assert len(results) > 0
    assert search_elapsed < 0.5, f"Single search too slow: {search_elapsed:.3f}s > 0.5s threshold"
    
    # Batch search performance
    batch_size = 10
    batch_start = time.time()
    for i in range(batch_size):
        db.search_vectors(collection_name=collection, query_vector=vectors[i], top_k=10)
    batch_elapsed = time.time() - batch_start
    
    print(f"\n=== Vector Search Performance (Batch) ===")
    print(f"Batch size: {batch_size}")
    print(f"Total time: {batch_elapsed:.3f}s")
    print(f"Avg per search: {batch_elapsed/batch_size*1000:.1f}ms")
    
    assert batch_elapsed < 2.0, f"Batch search too slow: {batch_elapsed:.3f}s > 2.0s threshold"
    
    # Cleanup
    db.delete_collection(collection_name=collection)


@pytest.mark.slow
@pytest.mark.integration
@pytest.mark.pgv
def test_vector_delete_performance(pgv_db):
    """
    Baseline: Vector deletion should be efficient.
    Threshold: < 3 seconds to delete a collection with 500 vectors
    """
    os.environ.setdefault("SUPABASE_URL", os.environ.get("DATABASE_URL", ""))
    
    from vector.vdb.pgv import PostgresVectorDatabase
    
    db = PostgresVectorDatabase()
    collection = f"perf_delete_{uuid.uuid4().hex[:8]}"
    
    # Generate 500 vectors
    vector_count = 500
    dimension = 128
    
    import random
    vectors = [[random.random() for _ in range(dimension)] for _ in range(vector_count)]
    contents = [f"doc_{i}" for i in range(vector_count)]
    
    db.store_vectors(vectors=vectors, contents=contents, collection_name=collection)
    
    # Measure delete performance
    delete_start = time.time()
    success = db.delete_collection(collection_name=collection)
    delete_elapsed = time.time() - delete_start
    
    print(f"\n=== Vector Delete Performance ===")
    print(f"Vectors to delete: {vector_count}")
    print(f"Delete time: {delete_elapsed:.3f}s")
    
    assert success
    assert delete_elapsed < 3.0, f"Delete too slow: {delete_elapsed:.3f}s > 3.0s threshold"


@pytest.mark.slow
@pytest.mark.integration
@pytest.mark.pgv
def test_vector_search_accuracy_vs_speed_tradeoff(pgv_db):
    """
    Performance vs accuracy tradeoff: Test search with different top_k values.
    Higher top_k should have linear or sub-linear time complexity.
    """
    os.environ.setdefault("SUPABASE_URL", os.environ.get("DATABASE_URL", ""))
    
    from vector.vdb.pgv import PostgresVectorDatabase
    
    db = PostgresVectorDatabase()
    collection = f"perf_topk_{uuid.uuid4().hex[:8]}"
    
    # Store 2000 vectors
    vector_count = 2000
    dimension = 256
    
    import random
    vectors = [[random.random() for _ in range(dimension)] for _ in range(vector_count)]
    contents = [f"item_{i}" for i in range(vector_count)]
    
    db.store_vectors(vectors=vectors, contents=contents, collection_name=collection)
    
    query_vector = vectors[0]
    
    print(f"\n=== Vector Search Scaling (top_k) ===")
    
    # Test different top_k values
    top_k_values = [10, 50, 100, 200]
    results_data = []
    
    for k in top_k_values:
        start = time.time()
        results = db.search_vectors(collection_name=collection, query_vector=query_vector, top_k=k)
        elapsed = time.time() - start
        
        results_data.append((k, elapsed, len(results)))
        print(f"top_k={k:3d}: {elapsed*1000:6.1f}ms ({len(results)} results)")
    
    # Check that search time scales reasonably
    # Time for top_k=200 should not be more than 4x time for top_k=10
    time_10 = results_data[0][1]
    time_200 = results_data[-1][1]
    scaling_factor = time_200 / time_10 if time_10 > 0 else float('inf')
    
    print(f"Scaling factor (200/10): {scaling_factor:.2f}x")
    
    assert scaling_factor < 4.0, f"Search scaling too poor: {scaling_factor:.2f}x > 4.0x threshold"
    
    # Cleanup
    db.delete_collection(collection_name=collection)

