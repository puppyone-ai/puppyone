#!/bin/zsh
# verify.sh CRATE... : fmt, strict clippy on the crates, guards, crate lib tests, ledger check.
set -e
cd ~/project/puppyone-rust-test-completeness/puppy-one-rust
export PATH="$HOME/.cargo/bin:$PATH" CARGO_BUILD_JOBS=6
cargo fmt --all
args=()
for c in "$@"; do args+=(-p "$c"); done
if ! cargo clippy --locked --offline "${args[@]}" --all-targets -- -D warnings > /tmp/verify-clippy.log 2>&1; then
  grep -E "^(error|warning)" -A8 /tmp/verify-clippy.log | head -60; echo CLIPPY_FAILED; exit 1
fi
echo CLIPPY_OK
python3 tools/check-ui-boundaries.py > /tmp/verify-guards.log || { cat /tmp/verify-guards.log; exit 1; }
python3 tools/check-editor-architecture.py | tail -1
for c in "$@"; do
  if [ "$c" = "po-app" ]; then
    cargo test --locked --offline --bin puppy-one-rust --features dev-capture 2>&1 | grep -E "test result|FAILED|panicked" | head -20
  else
    cargo test --locked --offline -p "$c" --lib 2>&1 | grep -E "test result|FAILED|panicked" | head -20
  fi
done
python3 ~/project/rust-test-parity-work/parity.py check | tail -1
git status --short
