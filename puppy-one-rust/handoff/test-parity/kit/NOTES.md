# Parity work notes
Crate map: po-contracts(asset_catalog clock file_kind formats geometry model text wake workspace::contracts agent::contract)
 po-platform(localization platform) po-workspace(cloud workspace) po-agent(agent)
 po-editor(bench documents editor render_service web_host) po-ui(assets theme typography ui)
 po-app(app features lab capture main native_window test_support) -> test with `--bin puppy-one-rust`
Env: export PATH="$HOME/.cargo/bin:$PATH" CARGO_BUILD_JOBS=6
Helpers: parity.py (summary/files/cases/show/add/check), gate_rows.py GATE --changed
po-app bin tests: {"package": "po-app", "target": "puppy-one-rust", "test": ...}
Verify test paths via gate (module paths may have nested `tests::` mods, e.g. cloud::publication::tests::credential_tests).
- GAP candidates to implement later: cloud-publish-transfer-progress (bytes/rate during upload), cloud-auth-replay-after-same-account-sign-in
Nested test mods: cloud::publication::tests::{coordinator_tests,credential_tests,git_push_tests}
## REVISIT (left unreviewed on purpose; need deeper check/tests)
- (done) component/cloud/repositories REVISIT list mapped in rows/cloud-revisit.json
