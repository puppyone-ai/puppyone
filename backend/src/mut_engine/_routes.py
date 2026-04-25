"""
Single source of truth for MUT public URL paths.

Why a constant: these prefixes are part of our public client contract.
mut clients in the wild (mut v0.1.x), the puppyone CLI, the frontend, and
external docs all hard-code these paths. Routing them in two halves
("APIRouter prefix" + "include_router prefix") makes accidental drift very
easy — and we have already shipped a regression of exactly that bug twice.

Centralising the canonical path here means:
  * the contract test in tests/mut_engine/test_routes_contract.py validates
    the real composed URL using this constant — if the router is rewired,
    the test fails immediately (search by symbol catches every reference);
  * future code (docs generation, OpenAPI tags, telemetry) has one symbol
    to import instead of re-typing the literal.

If you change MUT_AP_PREFIX you are breaking every deployed client. Don't.
"""

# Canonical public URL prefix for the MUT access-point router.
# Composed from:
#   - main.py  : app.include_router(ap_router, prefix="/api/v1", ...)
#   - access_point.py : APIRouter(prefix="/mut/ap")
# Full route shape: {MUT_AP_PREFIX}/{access_key}/{clone|push|pull|negotiate|...}
MUT_AP_PREFIX = "/api/v1/mut/ap"

# Legacy prefix used by mut clients <= v0.1.6 that hard-coded "/mut/ap"
# before we standardised on /api/v1. main.py mounts ap_router twice so old
# clients keep working transparently. Remove this constant — and the legacy
# include in main.py — once telemetry shows < 1% traffic on /mut/ap/*.
MUT_AP_LEGACY_PREFIX = "/mut/ap"
