import os
import sys
from pathlib import Path
import tempfile
import shutil
import pytest
from dotenv import load_dotenv
from moto import mock_aws
import boto3
from botocore.exceptions import ClientError
import psycopg2
from contextlib import closing
from httpx import AsyncClient
from httpx import ASGITransport

# Ensure project module path is importable (so `server.storage_server` works in tests)
PROJECT_ROOT = Path(__file__).resolve().parents[1]  # PuppyStorage directory
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# FastAPI app import is deferred inside fixture to ensure env prepared first


@pytest.fixture(scope="session")
def test_settings():
    """Load test configuration from .env.test if present and provide sane defaults.

    Returns a dict-like view of relevant settings used by tests.
    """
    # Load .env.test if present
    env_test_path = Path(__file__).resolve().parent.parent / ".env.test"
    if env_test_path.exists():
        load_dotenv(dotenv_path=env_test_path, override=True)

    # Provide defaults suitable for local tests
    os.environ.setdefault("APP_ENV", "test")
    os.environ.setdefault("DEPLOYMENT_TYPE", "local")
    os.environ.setdefault("STRICT_LOCAL_AUTH", "false")

    return {
        "APP_ENV": os.environ.get("APP_ENV"),
        "DEPLOYMENT_TYPE": os.environ.get("DEPLOYMENT_TYPE"),
        "STRICT_LOCAL_AUTH": os.environ.get("STRICT_LOCAL_AUTH"),
    }


@pytest.fixture()
def tmp_storage_dir(tmp_path_factory):
    """Provide an isolated temporary directory for storage backend tests.

    Automatically cleaned up by pytest.
    """
    base = tmp_path_factory.mktemp("puppy_storage")
    yield base
    # No manual cleanup needed; pytest handles tmp paths


# -------------------- S3 (moto) --------------------

@pytest.fixture(scope="session")
def s3_moto(test_settings):
    """Start a moto-backed AWS environment and prepare an S3 bucket.

    The application reads Cloudflare R2-style env vars; we map them to moto-compatible
    placeholders so that boto3 client creation succeeds and operations are intercepted by moto.
    """
    bucket_name = os.environ.get("CLOUDFLARE_R2_BUCKET", "puppy-test-bucket")

    # Ensure app config will choose remote only when we explicitly set it in tests
    # For tests relying on moto S3, set DEPLOYMENT_TYPE=remote at test level or here.

    # Provide credentials that satisfy potential validators (length >= 32)
    os.environ["CLOUDFLARE_R2_ACCESS_KEY_ID"] = "A" * 32
    os.environ["CLOUDFLARE_R2_SECRET_ACCESS_KEY"] = "B" * 32
    # Ensure endpoint is NOT set so moto intercepts default AWS endpoint
    os.environ.pop("CLOUDFLARE_R2_ENDPOINT", None)
    os.environ["CLOUDFLARE_R2_BUCKET"] = bucket_name
    os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

    with mock_aws():
        s3 = boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
        try:
            s3.create_bucket(Bucket=bucket_name)
        except ClientError:
            pass
        yield {
            "bucket": bucket_name,
            "client": s3,
        }


# -------------------- PGV (Postgres + pgvector) --------------------

@pytest.fixture(scope="session")
def pgv_db():
    """Provide a Postgres connection for tests requiring pgvector.

    Requires DATABASE_URL to be set. Skips tests if not available.
    """
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        pytest.skip("DATABASE_URL not set; skipping pgvector tests")

    with closing(psycopg2.connect(db_url)) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            try:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            except Exception:
                # Extension may not be available; let tests fail explicitly later if required
                pass
        yield db_url


# -------------------- FastAPI app and HTTP client --------------------

@pytest.fixture(scope="session")
def fastapi_app(test_settings):
    """Import and return the FastAPI app from server.storage_server.

    Ensures local/test-friendly env before import so that configuration validation passes.
    """
    os.environ.setdefault("DEPLOYMENT_TYPE", "local")
    os.environ.setdefault("STRICT_LOCAL_AUTH", "false")
    from server.storage_server import app
    return app


@pytest.fixture()
async def api_client(fastapi_app):
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


