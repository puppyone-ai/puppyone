"""
Contract test for the MUT public URL surface.

================================================================================
READ THIS BEFORE "FIXING" A FAILURE
================================================================================
The MUT access-point URL is part of our **public client contract**:

  * mut clients in the wild (mut v0.1.x) hard-code these paths in
    .mut/config.toml after `mut clone`. Existing clones break if the path
    moves.
  * The puppyone CLI (cli/src/commands/access.js) emits these URLs in
    `puppyone access add` output.
  * The frontend (Sync/Filesystem detail views) shows these URLs in copy-
    paste boxes.
  * Public docs (puppydoc) and AGENTS.md reference these URLs verbatim.

This test failed twice already in production after well-meaning refactors
silently dropped the `/api/v1` prefix from the access-point router. Each
regression made every existing `mut push` return 404 with no explanation.

If this test fails:
  * DO NOT just edit the test to make it pass.
  * Instead, fix the router (most likely main.py or _routes.py) so the
    canonical URL works again, then verify the test passes unchanged.
  * If you genuinely need to change the public URL, that is a coordinated
    breaking change requiring: (1) version bump on every mut client, (2)
    docs migration, (3) frontend update, (4) communication to all users
    with active access points. Update this test only as the *last* step.
================================================================================
"""

from __future__ import annotations

from starlette.routing import Route

from src.main import create_app
from src.mut_engine._routes import MUT_AP_LEGACY_PREFIX, MUT_AP_PREFIX

# All MUT access-point endpoints. Keep this list in sync with the
# @ap_router.post(...) decorators in src/mut_engine/routers/access_point.py.
# If you add a new endpoint there, add it here too — the contract test
# documents the full public surface.
AP_ENDPOINTS = (
    "clone",
    "push",
    "pull",
    "negotiate",
    "rollback",
    "pull-commit",
)


def _registered_paths(app) -> set[str]:
    """Return the path templates (e.g. '/api/v1/mut/ap/{access_key}/push')
    of every concrete route registered on the app."""
    return {
        route.path for route in app.router.routes if isinstance(route, Route)
    }


def test_canonical_access_point_routes_are_registered():
    """Every AP endpoint must be reachable at the canonical /api/v1 prefix.

    This is THE check that prevents the regression: if main.py forgets the
    `/api/v1` prefix on `include_router(ap_router, ...)`, this test fails
    with a clear message listing every missing route.
    """
    app = create_app()
    paths = _registered_paths(app)

    missing = [
        f"{MUT_AP_PREFIX}/{{access_key}}/{verb}"
        for verb in AP_ENDPOINTS
        if f"{MUT_AP_PREFIX}/{{access_key}}/{verb}" not in paths
    ]

    assert not missing, (
        "Canonical MUT access-point routes are missing:\n  "
        + "\n  ".join(missing)
        + "\n\nThis is a PUBLIC CONTRACT regression. mut clients in the wild "
        "rely on these URLs. Fix the router wiring in "
        "backend/src/main.py (include_router(ap_router, prefix='/api/v1', ...))"
        " — do NOT change MUT_AP_PREFIX or this test."
    )


def test_legacy_access_point_routes_still_work():
    """Old mut clients (<= v0.1.6) hit /mut/ap/* directly. main.py mounts
    ap_router twice so they keep working. If we drop the legacy mount, this
    test catches it — but unlike the canonical test, removing the legacy
    mount IS an acceptable change once telemetry shows < 1% legacy traffic.

    To delete this test, also delete:
      * the second `include_router(ap_router, ...)` call in main.py;
      * the MUT_AP_LEGACY_PREFIX constant in src/mut_engine/_routes.py.
    """
    app = create_app()
    paths = _registered_paths(app)

    missing = [
        f"{MUT_AP_LEGACY_PREFIX}/{{access_key}}/{verb}"
        for verb in AP_ENDPOINTS
        if f"{MUT_AP_LEGACY_PREFIX}/{{access_key}}/{verb}" not in paths
    ]

    assert not missing, (
        "Legacy MUT access-point routes disappeared:\n  "
        + "\n  ".join(missing)
        + "\n\nIf this removal was intentional (telemetry confirmed < 1% "
        "legacy traffic), also delete this test and the MUT_AP_LEGACY_PREFIX "
        "constant. Otherwise restore the legacy include_router in main.py."
    )


def test_canonical_prefix_constant_matches_design():
    """Sanity-check that the constant didn't drift away from /api/v1.

    The whole point of the constant is to be the single source of truth.
    If you find yourself changing this assertion, stop and re-read the
    file header.
    """
    assert MUT_AP_PREFIX == "/api/v1/mut/ap", (
        f"MUT_AP_PREFIX changed to {MUT_AP_PREFIX!r}. This breaks every "
        "mut client in the wild and every docs reference. See file header."
    )
    assert MUT_AP_LEGACY_PREFIX == "/mut/ap", (
        f"MUT_AP_LEGACY_PREFIX changed to {MUT_AP_LEGACY_PREFIX!r}. "
        "This is the path that mut <= v0.1.6 hard-coded; changing it "
        "defeats the back-compat mount."
    )
