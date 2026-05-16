"""Engine-level error types (formerly mut.foundation.error).

Each server-facing error carries an HTTP status code so that handlers
can map cleanly to responses without long if/elif chains.

Wire-protocol-only errors (``ClientTooOldError``, ``NetworkError``)
have been dropped along with the MUT protocol surface.
"""


class EngineError(Exception):
    """Base error for all version-engine operations."""
    http_status: int = 500


class ObjectNotFoundError(EngineError):
    """Raised when a hash-addressed object is missing from the store."""
    http_status = 404


class AuthenticationError(EngineError):
    """Raised on invalid / expired / missing auth tokens."""
    http_status = 401


class PermissionDenied(EngineError):
    """Raised when an actor tries to access outside its scope."""
    http_status = 403


class LockError(EngineError):
    """Raised when a scope lock cannot be acquired."""
    http_status = 409


class ConflictError(EngineError):
    """Raised when a merge conflict cannot be auto-resolved."""
    http_status = 409


class StorageWriteError(EngineError):
    """Raised when writing an object to the storage backend fails."""
    http_status = 502


class PayloadTooLargeError(EngineError):
    """Raised when request body exceeds the size limit."""
    http_status = 413


class ValidationError(EngineError):
    """Raised when request data fails schema/semantic validation."""
    http_status = 422


# Backwards-compatible alias for callers still using the legacy name.
MutError = EngineError
