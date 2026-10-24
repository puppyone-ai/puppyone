#!/usr/bin/env python3
"""Inventory every source Agent file; mapping is traceability, not a parity claim."""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root', type=Path, required=True)
parser.add_argument('--require-complete', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = args.source_root.resolve()
mapping_path = root / 'tools/agent-migration-map.json'
mapping = json.loads(mapping_path.read_text())


def git(*argv):
    return subprocess.check_output(['git', '-C', str(source), *argv])


head = git('rev-parse', 'HEAD').decode().strip()
# Preserve the reviewed mapping baseline independently from the observed tree.
# A newer HEAD or dirty file is traceability evidence, never an equivalence claim.
baseline = {}
for row in git('ls-tree', '-r', '-z', 'HEAD', '--', *mapping['source_roots']).split(b'\0'):
    if row:
        meta, path = row.split(b'\t', 1)
        baseline[path.decode()] = meta.split()[2].decode()
files = set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
                *mapping['source_roots']).decode().strip('\0').split('\0'))
files.discard('')
mapped = {}
for group in mapping['groups']:
    if group['status'] != 'partial' or not group['remaining']:
        raise SystemExit(f"Unreviewed completion claim: {group['name']}")
    for target in group['targets']:
        if not (root / target).is_file():
            raise SystemExit(f'Missing Rust target: {target}')
    for path in group['sources']:
        if path not in files or path in mapped:
            raise SystemExit(f'Missing or duplicate source mapping: {path}')
        mapped[path] = group

entries = []
for path in sorted(files):
    file = source / path
    content = file.read_bytes() if file.is_file() else None
    blob = (hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
            if content is not None else None)
    group = mapped.get(path)
    entries.append({
        'source': path,
        'sourceSha256': hashlib.sha256(content).hexdigest() if content is not None else None,
        'baselineBlob': baseline.get(path),
        'sourceState': ('deleted' if content is None else 'untracked' if path not in baseline
                        else 'unchanged' if blob == baseline[path] else 'modified'),
        'status': group['status'] if group else 'pending',
        'group': group['name'] if group else None,
        'rustTargets': group['targets'] if group else [],
        'remaining': group['remaining'] if group else 'No reviewed Rust correspondence recorded.',
    })
counts = dict(Counter(e['status'] for e in entries))
report = {
    'capturedAt': datetime.now().astimezone().isoformat(),
    'sourceRepository': mapping['source_repository'],
    'sourceBaseCommit': head,
    'mappingBaselineCommit': mapping['source_base_commit'],
    'mappingBaselineAdvanced': head != mapping['source_base_commit'],
    'sourceScope': mapping['source_roots'],
    'sourceIncludesUncommittedChanges': any(e['sourceState'] != 'unchanged' for e in entries),
    'policy': mapping['policy'],
    'counts': counts,
    'mappingSha256': hashlib.sha256(mapping_path.read_bytes()).hexdigest(),
    'targetSha256': {p: hashlib.sha256((root / p).read_bytes()).hexdigest()
                     for p in sorted({p for g in mapping['groups'] for p in g['targets']})},
    'files': entries,
}
output = root / 'artifacts/agent-migration/inventory.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(f'Agent inventory: {len(entries)} source files, {counts}; none declared complete.')
print('Source includes local changes:', report['sourceIncludesUncommittedChanges'])
print('Report:', output.relative_to(root))
if args.require_complete:
    raise SystemExit('Full Agent parity has not been achieved.')
