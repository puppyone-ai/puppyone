"""
Upload Module - File upload and processing pipeline.

Submodules:
- file/  : File processing (OCR, LLM extraction, ETL)
- shared/: Common components (task models, normalizers)

SaaS platform sync has been moved to src/sync/saas/.
"""

from src.upload.schemas import (
    SourceType,
    IngestType,
    IngestStatus,
    IngestMode,
)

__all__ = [
    "SourceType",
    "IngestType",
    "IngestStatus",
    "IngestMode",
]



