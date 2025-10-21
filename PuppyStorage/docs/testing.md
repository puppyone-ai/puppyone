# PuppyStorage Testing Guide

## Overview

PuppyStorage uses a comprehensive testing strategy with multiple layers to ensure code quality, correctness, and performance. Tests are organized by type and execution speed, allowing for flexible CI/CD pipelines.

## Test Markers

Tests are categorized using pytest markers defined in `pytest.ini`:

### By Test Type

- **`unit`**: Fast unit tests with no external dependencies
- **`integration`**: Tests requiring IO or external services (DB, S3, etc.)
- **`contract`**: API contract tests validating interface behavior
- **`e2e`**: End-to-end tests with full system deployment
- **`slow`**: Performance tests and benchmarks

### By Target Backend

- **`local`**: Tests targeting local filesystem backend
- **`s3`**: Tests targeting S3-compatible backends (MinIO, CloudFlare R2)
- **`pgv`**: Tests requiring Postgres + pgvector

## Quick Start

### Local Development

```bash
# Run fast tests (unit + contract)
pytest -m "unit or contract"

# Run all non-e2e tests
pytest -m "not e2e and not slow"

# Run specific test type
pytest -m unit
pytest -m integration
pytest -m contract
```

### With Coverage

```bash
# Generate coverage report
pytest -m "unit or integration or contract" \
  --cov=server \
  --cov=storage \
  --cov=vector \
  --cov=utils \
  --cov-report=html \
  --cov-fail-under=99

# View coverage report
open htmlcov/index.html
```

### E2E Tests

E2E tests require Docker Compose to spin up full stack:

```bash
# Start services
docker compose -f docker-compose.e2e.yml up -d

# Run E2E tests
pytest -m e2e

# Cleanup
docker compose -f docker-compose.e2e.yml down -v
```

### Performance Tests

Performance tests establish baseline thresholds and are marked as `slow`:

```bash
# Run performance tests (requires services)
pytest -m slow --durations=20

# Show test duration breakdown
pytest -m slow -v --durations=0
```

## Test Directory Structure

```
PuppyStorage/
├── pytest.ini              # Pytest configuration and markers
├── tests/
│   ├── conftest.py         # Shared fixtures (app, client, S3, PGV)
│   ├── unit/               # Fast unit tests (no external deps)
│   │   ├── test_auth_*.py
│   │   ├── test_storage_*.py
│   │   └── test_utils_*.py
│   ├── integration/        # Integration tests (DB, S3, etc.)
│   │   ├── test_storage_local.py
│   │   ├── test_storage_s3_moto.py
│   │   └── test_pgv_vecs.py
│   ├── contract/           # API contract tests
│   │   ├── test_health.py
│   │   ├── test_upload.py
│   │   └── test_vector_download.py
│   ├── e2e/                # End-to-end tests
│   │   ├── test_happy_path.py
│   │   └── wiremock/       # Mock configurations
│   ├── performance/        # Performance benchmarks
│   │   ├── test_storage_perf.py
│   │   └── test_vector_perf.py
│   ├── fixtures/           # Test data and resources
│   └── resources/          # Additional test resources
```

## Environment Variables

### Core Configuration

```bash
# Deployment type (affects storage backend)
DEPLOYMENT_TYPE=local|remote

# Local storage
LOCAL_STORAGE_PATH=/path/to/storage

# Remote storage (S3/R2)
CLOUDFLARE_R2_ACCESS_KEY=xxx
CLOUDFLARE_R2_SECRET_KEY=xxx
CLOUDFLARE_R2_BUCKET_NAME=bucket-name
CLOUDFLARE_R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com
CLOUDFLARE_R2_EXTERNAL_ENDPOINT=https://xxx  # Optional for presigned URLs

# Database (for vector operations)
DATABASE_URL=postgresql://user:pass@host:port/dbname
# OR
SUPABASE_URL=postgresql://user:pass@host:port/dbname
```

### Test-Specific

```bash
# Integration tests with Postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=test_db
```

## CI/CD Workflows

### PR Tests (`.github/workflows/pr-test.yml`)

Runs on every pull request:

- ✅ Unit tests
- ✅ Integration tests (with Postgres service)
- ✅ Contract tests
- ✅ Coverage analysis (≥99% threshold)
- 📊 Coverage report uploaded as artifact
- 💬 Coverage comment posted on PR

**Typical duration**: 5-10 minutes

### E2E Fast (`.github/workflows/e2e-fast.yml`)

Optimized E2E tests for feature branches:

- ⚡ Docker layer caching
- 🔄 Parallel test execution
- 🏥 Health checks for all services
- 📝 Logs uploaded on failure

**Typical duration**: 2-3 minutes

### Nightly Tests (`.github/workflows/nightly-test.yml`)

Comprehensive tests run daily at 02:00 UTC:

- 🌐 Full E2E test suite
- 📈 Performance benchmarks
- 📊 Performance reports archived
- 📧 Summary posted to workflow summary

**Typical duration**: 30-45 minutes

### Smoke Tests (`.github/workflows/smoke-test.yml`)

Quick validation for feature branches:

- ✅ Config validation
- ✅ Python syntax check
- ✅ Quick unit tests

**Typical duration**: 1-2 minutes

## Writing Tests

### Unit Test Example

```python
import pytest

@pytest.mark.unit
def test_sanitize_file_name():
    from utils.file_utils import sanitize_file_name
    
    assert sanitize_file_name("file.txt") == "file.txt"
    assert sanitize_file_name("../etc/passwd") == "passwd"
    assert sanitize_file_name("file<>|.txt") == "file.txt"
```

### Integration Test Example

```python
import pytest

@pytest.mark.integration
@pytest.mark.local
def test_local_storage_crud(tmp_storage_dir):
    """Test basic CRUD operations on local storage."""
    import os
    os.environ["DEPLOYMENT_TYPE"] = "local"
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_storage_dir)
    
    from storage import get_storage
    adapter = get_storage()
    
    # Test save, get, list, delete
    adapter.save_file("test.txt", b"data", "text/plain")
    content, _ = adapter.get_file("test.txt")
    assert content == b"data"
```

### Contract Test Example

```python
import pytest

@pytest.mark.contract
def test_health_endpoint(test_client):
    """Health endpoint should return 200 with expected fields."""
    response = test_client.get("/health")
    
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "timestamp" in data
```

### Performance Test Example

```python
import pytest
import time

@pytest.mark.slow
@pytest.mark.integration
def test_search_performance(pgv_db):
    """Vector search should complete within threshold."""
    from vector.vdb.pgv import PostgresVectorDatabase
    
    db = PostgresVectorDatabase()
    # ... setup vectors ...
    
    start = time.time()
    results = db.search_vectors(collection, query_vector, top_k=10)
    elapsed = time.time() - start
    
    print(f"Search time: {elapsed*1000:.1f}ms")
    assert elapsed < 0.5, f"Search too slow: {elapsed}s"
```

## Performance Thresholds

Current baseline thresholds (subject to adjustment):

### Storage Operations

- **Write (100 files × 8KB)**: < 5.0s
- **Read (100 files)**: < 3.0s
- **List (500 objects)**: < 2.0s

### Vector Operations

- **Single search (1000 vectors, 384 dims)**: < 500ms
- **Batch search (10 queries)**: < 2.0s
- **Delete collection (500 vectors)**: < 3.0s
- **Search scaling (top_k 10→200)**: < 4.0x time increase

## Fixtures

Common fixtures are defined in `tests/conftest.py`:

### Core Fixtures

- **`test_client`**: FastAPI test client (httpx)
- **`test_app`**: FastAPI app instance
- **`tmp_storage_dir`**: Temporary storage directory

### Backend Fixtures

- **`moto_s3_bucket`**: Mocked S3 bucket (via moto)
- **`pgv_db`**: Postgres + pgvector database connection

### Usage

```python
def test_example(test_client, tmp_storage_dir):
    # Use fixtures directly as parameters
    response = test_client.get("/health")
    assert response.status_code == 200
```

## Troubleshooting

### Common Issues

#### 1. Import errors in tests

```bash
# Ensure you're in PuppyStorage directory
cd PuppyStorage
pytest tests/
```

#### 2. Postgres connection errors

```bash
# Check if Postgres service is running
docker compose -f docker-compose.e2e.yml ps

# View logs
docker compose -f docker-compose.e2e.yml logs postgres
```

#### 3. S3/MinIO connection errors

```bash
# Check MinIO is accessible
curl http://localhost:9000/minio/health/live

# Restart services
docker compose -f docker-compose.e2e.yml restart minio
```

#### 4. Coverage below threshold

```bash
# Generate detailed coverage report
pytest --cov --cov-report=term-missing

# Identify uncovered lines
# Add tests for missing coverage
```

### Debug Tips

```bash
# Run with verbose output
pytest -v -s

# Show print statements
pytest -s

# Stop on first failure
pytest -x

# Run specific test
pytest tests/unit/test_auth_local.py::test_specific_function

# Show test durations
pytest --durations=10

# Debug with pdb
pytest --pdb
```

## Best Practices

### 1. Test Isolation

- Each test should be independent
- Use fixtures for setup/teardown
- Clean up resources after tests

### 2. Test Naming

- Use descriptive names: `test_<what>_<condition>_<expected>`
- Example: `test_upload_invalid_key_returns_400`

### 3. Markers

- Always mark tests appropriately
- Combine markers when needed: `@pytest.mark.integration @pytest.mark.s3`

### 4. Performance Tests

- Log metrics for trend analysis
- Set realistic thresholds
- Run regularly (nightly) to catch regressions

### 5. Coverage

- Aim for ≥99% coverage
- Focus on critical paths first
- Don't test trivial code for coverage sake

## FAQ

### Q: How do I run only fast tests?

```bash
pytest -m "unit or contract"
```

### Q: How do I skip slow tests?

```bash
pytest -m "not slow"
```

### Q: How do I run tests in parallel?

```bash
pytest -n auto  # Uses all available CPUs
pytest -n 4     # Uses 4 workers
```

### Q: How do I test a specific backend?

```bash
pytest -m local   # Local filesystem tests
pytest -m s3      # S3 tests
pytest -m pgv     # Postgres + pgvector tests
```

### Q: How do I get detailed failure output?

```bash
pytest -v --tb=long  # Long traceback
pytest -v --tb=short # Short traceback
pytest -v --tb=line  # One line per failure
```

### Q: How do I update coverage threshold?

Edit `.github/workflows/pr-test.yml`:

```yaml
--cov-fail-under=99  # Current threshold
```

## References

- [pytest documentation](https://docs.pytest.org/)
- [pytest-cov documentation](https://pytest-cov.readthedocs.io/)
- [pytest-asyncio documentation](https://pytest-asyncio.readthedocs.io/)
- [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)

## Roadmap

### Completed ✅

- P0: Contract health gate + unit auth tests
- P1: Secure contracts (upload pipeline) + core pure functions
- P2: Integration correctness (local + S3 + PGV) + edge cases
- P3: E2E stability (docker-compose dual backends)
- P4: CI layers, coverage gate, performance baseline, docs

### Future Enhancements

- [ ] Mutation testing (detect weak tests)
- [ ] Load testing (sustained traffic simulation)
- [ ] Chaos engineering (failure injection)
- [ ] Visual regression testing (UI components)
- [ ] Security testing (OWASP Top 10)
