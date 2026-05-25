"""Compatibility shim for Version Engine L6 S3 storage.

New code should import from ``src.version_engine.storage.backends.s3``.
"""

from src.version_engine.storage.backends import s3 as _s3
from src.version_engine.storage.backends.s3 import *  # noqa: F403
from src.version_engine.storage.backends.s3 import (  # noqa: F401
    _DEFERRED_STORAGE_NAMESPACE,
    _encode_object_bundle,
    _verify_loose_hash,
)


def __getattr__(name: str):
    return getattr(_s3, name)
