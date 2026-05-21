# Retired Root E2E Folder

The old Python E2E scripts in this folder targeted removed protocol routes and
the removed external client package. They were deleted so nobody can
accidentally run stale coverage and treat it as a release signal.

Current E2E entry points:

- Browser/product E2E: `e2e/run.mjs`
- Backend service E2E: `backend/tests/e2e/`
- Version Engine contracts: `backend/tests/version_engine/`

