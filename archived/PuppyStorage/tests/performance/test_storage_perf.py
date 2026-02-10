"""
Performance tests for storage operations.
Marked as 'slow' - these tests establish baseline thresholds.
"""
import os
import time
import uuid
import pytest


@pytest.mark.slow
@pytest.mark.integration
@pytest.mark.local
def test_storage_write_performance_small_files(tmp_storage_dir):
    """
    Baseline: Write 100 small files (<10KB) should complete within reasonable time.
    Threshold: < 5 seconds for 100 files
    """
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass

    from storage import reset_storage_manager, get_storage
    
    reset_storage_manager()
    adapter = get_storage()
    
    prefix = f"perf_test/{uuid.uuid4().hex}"
    file_count = 100
    file_size = 8 * 1024  # 8KB
    data = b"x" * file_size
    
    start = time.time()
    
    for i in range(file_count):
        key = f"{prefix}/file_{i:04d}.txt"
        adapter.save_file(key, data, "text/plain")
    
    elapsed = time.time() - start
    
    # Log metrics
    print(f"\n=== Storage Write Performance ===")
    print(f"Files written: {file_count}")
    print(f"File size: {file_size} bytes")
    print(f"Total time: {elapsed:.3f}s")
    print(f"Throughput: {file_count/elapsed:.1f} files/sec")
    
    # Threshold check
    assert elapsed < 5.0, f"Write performance degraded: {elapsed:.3f}s > 5.0s threshold"
    
    # Cleanup
    for i in range(file_count):
        key = f"{prefix}/file_{i:04d}.txt"
        adapter.delete_file(key)


@pytest.mark.slow
@pytest.mark.integration
@pytest.mark.local
def test_storage_read_performance(tmp_storage_dir):
    """
    Baseline: Read 100 small files should be fast.
    Threshold: < 3 seconds for 100 reads
    """
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    
    try:
        from utils.config import paths
        paths.STORAGE_ROOT = str(tmp_storage_dir)
    except Exception:
        pass

    from storage import reset_storage_manager, get_storage
    
    reset_storage_manager()
    adapter = get_storage()
    
    prefix = f"perf_test/{uuid.uuid4().hex}"
    file_count = 100
    file_size = 8 * 1024
    data = b"x" * file_size
    
    # Setup: write files first
    for i in range(file_count):
        key = f"{prefix}/file_{i:04d}.txt"
        adapter.save_file(key, data, "text/plain")
    
    # Measure read performance
    start = time.time()
    
    for i in range(file_count):
        key = f"{prefix}/file_{i:04d}.txt"
        content, _ = adapter.get_file(key)
        assert content == data
    
    elapsed = time.time() - start
    
    print(f"\n=== Storage Read Performance ===")
    print(f"Files read: {file_count}")
    print(f"Total time: {elapsed:.3f}s")
    print(f"Throughput: {file_count/elapsed:.1f} files/sec")
    
    assert elapsed < 3.0, f"Read performance degraded: {elapsed:.3f}s > 3.0s threshold"
    
    # Cleanup
    for i in range(file_count):
        key = f"{prefix}/file_{i:04d}.txt"
        adapter.delete_file(key)


@pytest.mark.slow
@pytest.mark.integration
@pytest.mark.s3
def test_storage_list_performance_s3(s3_moto):
    """
    Baseline: List operations should scale well with object count.
    Threshold: < 2 seconds to list 500 objects
    """
    # s3_moto fixture returns dict with 'bucket' and 'client'  
    bucket_name = s3_moto["bucket"]
    
    os.environ["DEPLOYMENT_TYPE"] = "remote"
    # Note: s3_moto already sets the necessary env vars in conftest.py
    
    from storage import reset_storage_manager, get_storage
    
    reset_storage_manager()
    adapter = get_storage()
    
    prefix = f"perf_list/{uuid.uuid4().hex}"
    file_count = 500
    data = b"test"
    
    # Setup: create files
    for i in range(file_count):
        key = f"{prefix}/file_{i:04d}.txt"
        adapter.save_file(key, data, "text/plain")
    
    # Measure list performance
    start = time.time()
    results = adapter.list_objects(prefix=prefix)
    elapsed = time.time() - start
    
    print(f"\n=== Storage List Performance ===")
    print(f"Objects created: {file_count}")
    print(f"Objects listed: {len(results)}")
    print(f"Total time: {elapsed:.3f}s")
    
    assert len(results) == file_count
    assert elapsed < 2.0, f"List performance degraded: {elapsed:.3f}s > 2.0s threshold"
    
    # Cleanup
    for i in range(file_count):
        key = f"{prefix}/file_{i:04d}.txt"
        adapter.delete_file(key)

