"""Global test configuration — set required env vars for unit test collection.

Integration tests that need live services (Supabase, S3, MineRU) should
use pytest marks and skip appropriately.
"""

import os

# Set minimal env vars so test modules can import without crashing.
# These are dummy values — tests that need real services should mock them.
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_KEY", "test-key-for-unit-tests")
os.environ.setdefault("INTERNAL_API_SECRET", "test-secret-for-unit-tests")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SKIP_AUTH", "true")
