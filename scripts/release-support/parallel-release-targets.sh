#!/usr/bin/env bash

# Each target owns a distinct prefix. Drain BOTH writers before returning a
# failure, so the caller cannot start rollback while a sibling is still writing.
# Invoke this directly from a `set -euo pipefail` step, never in an if/|| list:
# Bash disables errexit inside functions whose status is tested by their caller.
run_release_targets() {
  local task="$1"
  shift
  local first_pid second_pid status=0
  ( set -euo pipefail; echo "[release-upload] start $task $1"; "$task" "$1" "$2"; echo "[release-upload] complete $task $1" ) &
  first_pid=$!
  ( set -euo pipefail; echo "[release-upload] start $task $3"; "$task" "$3" "$4"; echo "[release-upload] complete $task $3" ) &
  second_pid=$!
  wait "$first_pid" || status=1
  wait "$second_pid" || status=1
  if [ "$status" -ne 0 ]; then
    echo "Release target transfer failed; all target writers have stopped." >&2
  fi
  return "$status"
}
