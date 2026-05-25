"""IO storage routing strategy for Version Engine objects.

This module is L6 policy: it decides the physical storage layout for
content-addressed Git objects. Generic S3 stays a key/value byte service; L5
continues to see only ObjectStore operations.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from math import ceil
from typing import Mapping


class ObjectWriteLayout(StrEnum):
    """Physical layout selected for a logical Version Engine object."""

    LOOSE = "loose"
    BUNDLE = "bundle"
    CHUNKED = "chunked"


@dataclass(frozen=True)
class ObjectWriteRoute:
    object_id: str
    size_bytes: int
    layout: ObjectWriteLayout


@dataclass(frozen=True)
class ObjectWritePlan:
    routes: dict[str, ObjectWriteRoute]
    chunk_bytes: int

    def route_for(self, object_id: str) -> ObjectWriteRoute:
        return self.routes[object_id]

    @property
    def uses_location_index(self) -> bool:
        return any(
            route.layout in {ObjectWriteLayout.BUNDLE, ObjectWriteLayout.CHUNKED}
            for route in self.routes.values()
        )

    def chunk_part_count(self, object_id: str) -> int:
        route = self.route_for(object_id)
        if route.layout is not ObjectWriteLayout.CHUNKED:
            return 0
        return ceil(route.size_bytes / self.chunk_bytes)


@dataclass(frozen=True)
class IOStorageStrategy:
    """Route logical Git objects to physical storage layouts.

    The defaults are intentionally conservative for S3-compatible storage:
    small batched objects are packed into immutable bundles; large objects are
    split into application-level chunks plus a manifest; single small writes can
    remain loose.
    """

    bundle_target_bytes: int
    chunk_bytes: int
    location_index_enabled: bool = True

    def __post_init__(self) -> None:
        if self.bundle_target_bytes <= 0:
            raise ValueError("bundle_target_bytes must be positive")
        if self.chunk_bytes <= 0:
            raise ValueError("chunk_bytes must be positive")

    def plan_single(self, object_id: str, size_bytes: int) -> ObjectWriteRoute:
        if self.location_index_enabled and size_bytes > self.bundle_target_bytes:
            layout = ObjectWriteLayout.CHUNKED
        else:
            layout = ObjectWriteLayout.LOOSE
        return ObjectWriteRoute(
            object_id=object_id,
            size_bytes=size_bytes,
            layout=layout,
        )

    def plan_batch(self, object_sizes: Mapping[str, int]) -> ObjectWritePlan:
        if len(object_sizes) <= 1:
            routes = {
                object_id: self.plan_single(object_id, size_bytes)
                for object_id, size_bytes in object_sizes.items()
            }
            return ObjectWritePlan(routes=routes, chunk_bytes=self.chunk_bytes)

        routes: dict[str, ObjectWriteRoute] = {}
        for object_id, size_bytes in object_sizes.items():
            if not self.location_index_enabled:
                layout = ObjectWriteLayout.LOOSE
            elif size_bytes > self.bundle_target_bytes:
                layout = ObjectWriteLayout.CHUNKED
            else:
                layout = ObjectWriteLayout.BUNDLE
            routes[object_id] = ObjectWriteRoute(
                object_id=object_id,
                size_bytes=size_bytes,
                layout=layout,
            )
        return ObjectWritePlan(routes=routes, chunk_bytes=self.chunk_bytes)

    def without_location_index(self) -> "IOStorageStrategy":
        if not self.location_index_enabled:
            return self
        return IOStorageStrategy(
            bundle_target_bytes=self.bundle_target_bytes,
            chunk_bytes=self.chunk_bytes,
            location_index_enabled=False,
        )
