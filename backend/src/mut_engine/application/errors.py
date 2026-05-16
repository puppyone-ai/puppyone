"""Version-engine error types owned by PuppyOne."""

from __future__ import annotations


class MutError(Exception):
    """Base error for version-engine operations."""

    http_status: int = 500


class NotARepoError(MutError):
    http_status = 400


class SnapshotNotFoundError(MutError):
    http_status = 404


class ObjectNotFoundError(MutError):
    http_status = 404


class AuthenticationError(MutError):
    http_status = 401


class PermissionDenied(MutError):
    http_status = 403


class LockError(MutError):
    http_status = 409


class ConflictError(MutError):
    http_status = 409


class DirtyWorkdirError(MutError):
    http_status = 400


class NetworkError(MutError):
    http_status = 502


class StorageWriteError(MutError):
    http_status = 502


class PayloadTooLargeError(MutError):
    http_status = 413


class ValidationError(MutError):
    http_status = 422


class ClientTooOldError(MutError):
    http_status = 426
