"""Legacy MUT wire models served by PuppyOne.

The transport shape is kept for compatibility, while all kernel primitives now
come from PuppyOne's Git-native version engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.mut_engine.application.errors import ClientTooOldError
from src.mut_engine.application.path_utils import normalize_path  # noqa: F401


PROTOCOL_VERSION = 2
MIN_SUPPORTED_PROTOCOL_VERSION = 2


def require_supported_protocol(body: dict) -> int:
    declared = body.get("protocol_version")
    if not isinstance(declared, int) or declared < MIN_SUPPORTED_PROTOCOL_VERSION:
        raise ClientTooOldError(
            f"client speaks protocol v{declared or 'unknown'} but this "
            f"server requires v{MIN_SUPPORTED_PROTOCOL_VERSION}+. "
            "Upgrade the PuppyOne client."
        )
    return declared


@dataclass
class CloneRequest:
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> CloneRequest:
        return cls(protocol_version=data.get("protocol_version", 1))

    def to_dict(self) -> dict:
        return {"protocol_version": self.protocol_version}


@dataclass
class ScopeInfo:
    path: str = "/"
    exclude: list[str] = field(default_factory=list)
    mode: str = "rw"
    id: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> ScopeInfo:
        return cls(
            path=data.get("path", "/"),
            exclude=data.get("exclude", []),
            mode=data.get("mode", "rw"),
            id=data.get("id", ""),
        )

    def to_dict(self) -> dict:
        out = {"path": self.path, "exclude": self.exclude, "mode": self.mode}
        if self.id:
            out["id"] = self.id
        return out


@dataclass
class ScopesRequest:
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> ScopesRequest:
        return cls(protocol_version=data.get("protocol_version", 1))

    def to_dict(self) -> dict:
        return {"protocol_version": self.protocol_version}


@dataclass
class ScopesResponse:
    owned: ScopeInfo
    descendants: list[ScopeInfo] = field(default_factory=list)
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> ScopesResponse:
        return cls(
            owned=ScopeInfo.from_dict(data.get("owned", {})),
            descendants=[
                ScopeInfo.from_dict(scope)
                for scope in data.get("descendants", [])
            ],
            protocol_version=data.get("protocol_version", 1),
        )

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "owned": self.owned.to_dict(),
            "descendants": [scope.to_dict() for scope in self.descendants],
        }


@dataclass
class CloneResponse:
    project: str
    files: dict[str, str]
    objects: dict[str, str]
    history: list[dict]
    head_commit_id: str
    scope: ScopeInfo
    protocol_version: int = PROTOCOL_VERSION

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "project": self.project,
            "files": self.files,
            "objects": self.objects,
            "history": self.history,
            "head_commit_id": self.head_commit_id,
            "scope": self.scope.to_dict(),
        }


@dataclass
class PushRequest:
    base_commit_id: str = ""
    snapshots: list[dict] = field(default_factory=list)
    objects: dict[str, str] = field(default_factory=dict)
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> PushRequest:
        return cls(
            base_commit_id=data.get("base_commit_id", ""),
            snapshots=data.get("snapshots", []),
            objects=data.get("objects", {}),
            protocol_version=data.get("protocol_version", 1),
        )

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "base_commit_id": self.base_commit_id,
            "snapshots": self.snapshots,
            "objects": self.objects,
        }


@dataclass
class PushResponse:
    status: str
    commit_id: str = ""
    pushed: int = 0
    root: str = ""
    merged: bool = False
    conflicts: int = 0
    merged_changes: list[dict] = field(default_factory=list)
    commit_object: str = ""
    protocol_version: int = PROTOCOL_VERSION

    def to_dict(self) -> dict:
        out: dict = {
            "protocol_version": self.protocol_version,
            "status": self.status,
            "commit_id": self.commit_id,
            "pushed": self.pushed,
            "root": self.root,
        }
        if self.merged:
            out["merged"] = True
            out["conflicts"] = self.conflicts
        if self.merged_changes:
            out["merged_changes"] = self.merged_changes
        if self.commit_object:
            out["commit_object"] = self.commit_object
        return out


@dataclass
class PullRequest:
    since_commit_id: str = ""
    have_hashes: list[str] = field(default_factory=list)
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> PullRequest:
        return cls(
            since_commit_id=data.get("since_commit_id", ""),
            have_hashes=data.get("have_hashes", []),
            protocol_version=data.get("protocol_version", 1),
        )

    def to_dict(self) -> dict:
        out: dict = {
            "protocol_version": self.protocol_version,
            "since_commit_id": self.since_commit_id,
        }
        if self.have_hashes:
            out["have_hashes"] = self.have_hashes
        return out


@dataclass
class PullResponse:
    status: str
    head_commit_id: str = ""
    files: dict[str, str] = field(default_factory=dict)
    objects: dict[str, str] = field(default_factory=dict)
    history: list[dict] = field(default_factory=list)
    protocol_version: int = PROTOCOL_VERSION

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "status": self.status,
            "head_commit_id": self.head_commit_id,
            "files": self.files,
            "objects": self.objects,
            "history": self.history,
        }


@dataclass
class NegotiateRequest:
    hashes: list[str] = field(default_factory=list)
    remote_head: str = ""
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> NegotiateRequest:
        return cls(
            hashes=data.get("hashes", []),
            remote_head=data.get("remote_head", ""),
            protocol_version=data.get("protocol_version", 1),
        )

    def to_dict(self) -> dict:
        out: dict = {
            "protocol_version": self.protocol_version,
            "hashes": self.hashes,
        }
        if self.remote_head:
            out["remote_head"] = self.remote_head
        return out


@dataclass
class NegotiateResponse:
    missing: list[str] = field(default_factory=list)
    server_head_commit_id: str = ""
    remote_head_recognized: bool = True
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> NegotiateResponse:
        return cls(
            missing=data.get("missing", []),
            server_head_commit_id=data.get("server_head_commit_id", ""),
            remote_head_recognized=data.get("remote_head_recognized", True),
            protocol_version=data.get("protocol_version", 1),
        )

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "missing": self.missing,
            "server_head_commit_id": self.server_head_commit_id,
            "remote_head_recognized": self.remote_head_recognized,
        }


@dataclass
class PullCommitRequest:
    commit_id: str = ""
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> PullCommitRequest:
        return cls(
            commit_id=data.get("commit_id", ""),
            protocol_version=data.get("protocol_version", 1),
        )

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "commit_id": self.commit_id,
        }


@dataclass
class RollbackRequest:
    target_commit_id: str = ""
    protocol_version: int = PROTOCOL_VERSION

    @classmethod
    def from_dict(cls, data: dict) -> RollbackRequest:
        return cls(
            target_commit_id=data.get("target_commit_id", ""),
            protocol_version=data.get("protocol_version", 1),
        )

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "target_commit_id": self.target_commit_id,
        }


@dataclass
class RollbackResponse:
    status: str
    new_commit_id: str = ""
    target_commit_id: str = ""
    root: str = ""
    changes: list[dict] = field(default_factory=list)
    protocol_version: int = PROTOCOL_VERSION

    def to_dict(self) -> dict:
        out: dict = {
            "protocol_version": self.protocol_version,
            "status": self.status,
            "new_commit_id": self.new_commit_id,
            "target_commit_id": self.target_commit_id,
            "changes": self.changes,
        }
        if self.root:
            out["root"] = self.root
        return out


@dataclass
class ErrorResponse:
    error: str
    code: int = 500
    protocol_version: int = PROTOCOL_VERSION

    def to_dict(self) -> dict:
        return {
            "protocol_version": self.protocol_version,
            "error": self.error,
        }
