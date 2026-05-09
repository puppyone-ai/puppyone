"""Content API — REST HTTP shell for MutOps.

Provides POSIX-like file system operations (ls, cat, write, mkdir, mv, rm)
on the MUT content tree. Used by the frontend Web UI and internal services.

Split into sub-modules for maintainability:
  content_read.py     — ls, cat, stat, tree
  content_write.py    — write, mkdir, mv, rm, bulk-write
  content_history.py  — versions, version-content, diff, rollback
"""

from __future__ import annotations

from fastapi import APIRouter

from src.mut_engine.routers.content_history import history_router
from src.mut_engine.routers.content_read import read_router
from src.mut_engine.routers.content_write import write_router

router = APIRouter(
    prefix="/content",
    tags=["content"],
)

router.include_router(read_router)
router.include_router(write_router)
router.include_router(history_router)
