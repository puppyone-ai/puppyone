#!/usr/bin/env bash
#
# Reads version from root version.json and syncs it to all sub-projects.
# Usage: ./scripts/sync-version.sh
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -e "console.log(require('$ROOT_DIR/version.json').version)")

echo "Syncing version: $VERSION"

# 1) frontend/package.json
node -e "
  const fs = require('fs');
  const p = '$ROOT_DIR/frontend/package.json';
  const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
"
echo "  ✓ frontend/package.json"

# 2) cli/package.json
node -e "
  const fs = require('fs');
  const p = '$ROOT_DIR/cli/package.json';
  const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
"
echo "  ✓ cli/package.json"

# 3) cli/src/version.js
echo "export const version = \"$VERSION\";" > "$ROOT_DIR/cli/src/version.js"
echo "  ✓ cli/src/version.js"

# 4) backend/pyproject.toml
sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT_DIR/backend/pyproject.toml"
echo "  ✓ backend/pyproject.toml"

# 5) backend/src/config.py
sed -i '' "s/VERSION: str = \".*\"/VERSION: str = \"$VERSION\"/" "$ROOT_DIR/backend/src/config.py"
echo "  ✓ backend/src/config.py"

echo ""
echo "All synced to v$VERSION"
