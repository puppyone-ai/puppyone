import pytest

pytest.skip(
    "Legacy S3 API integration tests (router no longer mounted in main app)",
    allow_module_level=True,
)
