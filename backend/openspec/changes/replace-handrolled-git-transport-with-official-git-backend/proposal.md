# Change: Replace hand-rolled Git push transport with official Git backend

## Why
Puppyone's smart HTTP receive-pack path parsed and unpacked incoming pushes in Python. That made large/chunked pushes sensitive to client buffering details and returned non-host-like errors for valid Git protocol exchanges such as empty stateless receive-pack requests.

## What Changes
- Spool Git receive-pack HTTP request bodies to disk instead of buffering the full request in memory.
- Delegate receive-pack protocol parsing, thin-pack validation, quarantine ingestion, ref update checks, and report-status output to stock `git receive-pack --stateless-rpc`.
- Keep Puppyone's Version Engine as the only publish authority after official Git accepts the temporary quarantine ref.
- Return product-level rejections as normal receive-pack `ng <ref> puppyone-rejected: ...` responses.
- Add real Git CLI coverage for flush-only receive-pack requests and large pushes forced through the non-buffered/chunked client path.

## Impact
- Affected specs: `git-remote-transport`
- Affected code: `src/version_engine/entrypoints/git/router.py`, `src/version_engine/adapters/git/receive_pack.py`, `src/version_engine/adapters/git/object_quarantine.py`
- Affected tests: `tests/version_engine/test_write_engine.py`, `tests/version_engine/test_git_product_mixed_e2e.py`
