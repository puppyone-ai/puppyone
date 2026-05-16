"""Test-only wrappers around :mod:`src.mut_engine.adapters.mut.legacy_handlers`.

The real handlers require every request to carry the current
``protocol_version`` (enforced by ``require_supported_protocol``).
Test code that exercises the handlers in-process — i.e. not through
the HTTP transport where the client auto-stamps it — would otherwise
have to repeat ``{"protocol_version": PROTOCOL_VERSION, ...}`` at ~80
call sites. These thin wrappers auto-inject the current protocol
version so tests stay focused on the semantic behavior they care
about; if a test needs to exercise the version-rejection path it
should import from :mod:`src.mut_engine.adapters.mut.legacy_handlers` directly instead.
"""

from __future__ import annotations

from src.mut_engine.adapters.mut.protocol import PROTOCOL_VERSION
from src.mut_engine.adapters.mut import legacy_handlers as _h


def _v(body):
    out = dict(body or {})
    out.setdefault("protocol_version", PROTOCOL_VERSION)
    return out


def handle_clone(repo, auth, body=None):
    return _h.handle_clone(repo, auth, _v(body))


def handle_push(repo, auth, body=None):
    return _h.handle_push(repo, auth, _v(body))


def handle_pull(repo, auth, body=None):
    return _h.handle_pull(repo, auth, _v(body))


def handle_negotiate(repo, auth, body=None):
    return _h.handle_negotiate(repo, auth, _v(body))


def handle_rollback(repo, auth, body=None):
    return _h.handle_rollback(repo, auth, _v(body))


def handle_pull_commit(repo, auth, body=None):
    return _h.handle_pull_commit(repo, auth, _v(body))
