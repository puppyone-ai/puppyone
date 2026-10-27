#!/usr/bin/env python3
"""Verify the exact TS authentication inputs reviewed for the native port.
Never rewrite the reference checkout or silently refresh the pinned hashes.
"""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
reference = (root / json.loads((root / 'product-source.json').read_text())['checkout']).resolve()
receipt = json.loads((root / 'fixtures/cloud/auth-reference.json').read_text())
changed = []
for relative, expected in receipt['inputs'].items():
    path = reference / relative
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        changed.append(relative)
if changed:
    raise SystemExit('Authentication reference drift; review before repinning:\n' + '\n'.join(changed))
print(f"Authentication reference verified: {len(receipt['inputs'])} inputs, {receipt['head'][:8]} plus working-tree hashes")
