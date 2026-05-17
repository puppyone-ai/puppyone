"""Conflict-detection / conflict-resolution / auto-merge test inventory.

The cases live in :mod:`tests.conflicts.cases`. They are also reusable from
``backend/scripts/run_conflict_cases.py`` (live staging runner, separate
follow-up).
"""

from tests.conflicts.cases import CASES, ConflictCase, Expected, Writer

__all__ = ["CASES", "ConflictCase", "Expected", "Writer"]
