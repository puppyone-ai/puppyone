"""Conflict-detection / conflict-resolution / auto-merge test inventory.

The cases live in :mod:`tests.conflicts.cases` and are consumed by the
Version Engine test suite.
"""

from tests.conflicts.cases import CASES, ConflictCase, Expected, Writer

__all__ = ["CASES", "ConflictCase", "Expected", "Writer"]
