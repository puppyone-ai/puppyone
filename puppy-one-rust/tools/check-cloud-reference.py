#!/usr/bin/env python3
"""Check reviewed live-file protocol inputs, without editing either reference."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
receipt = json.loads((root / 'fixtures/cloud/provider-reference.json').read_text())
changed = []
count = 0
for name, source in receipt['sources'].items():
    reference = (root / source['checkout']).resolve()
    for relative, expected in source['inputs'].items():
        path = reference / relative
        count += 1
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            changed.append(f'{name}:{relative}')
if changed:
    raise SystemExit('Live Cloud protocol reference drift; review before repinning:\n' + '\n'.join(changed))
print(f'Live Cloud protocol reference verified: {count} working-tree inputs across {len(receipt["sources"])} recorded repository revisions')
