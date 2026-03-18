"""Backward-compatible alias — CollaborationService is now MutCompatService."""

from src.mut_core.compat_service import MutCompatService as CollaborationService

__all__ = ["CollaborationService"]
