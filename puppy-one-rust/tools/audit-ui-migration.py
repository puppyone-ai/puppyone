#!/usr/bin/env python3
"""Inventory Web UI sources against tools/ui-migration-map.json.

Mapping is traceability, not a parity percentage. Every file under the source
roots is reported as ported / partial / excluded / pending. The audit fails when
the map is inconsistent: unknown status, missing evidence or remaining work,
a Rust target that no longer exists, a test named as evidence that does not
exist, a source pattern that matches nothing, or a source claimed twice.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--source-root', type=Path,
                    help='Web checkout (default: PUPPYONE_PRODUCT_ROOT or product-source.json)')
parser.add_argument('--max-pending', type=int,
                    help='fail when more source files than this are unmapped')
parser.add_argument('--check', action='store_true',
                    help='validate only; do not write artifacts/ui-migration-audit.json')
args = parser.parse_args()

config = json.loads((root / 'product-source.json').read_text())
source = (args.source_root or Path(os.environ.get('PUPPYONE_PRODUCT_ROOT', root / config['checkout']))).resolve()
mapping = json.loads((root / 'tools/ui-migration-map.json').read_text())
errors = []


def glob_regex(pattern):
    out, i = '', 0
    while i < len(pattern):
        if pattern.startswith('**/', i):
            out, i = out + '(?:.*/)?', i + 3
        elif pattern.startswith('**', i):
            out, i = out + '.*', i + 2
        elif pattern[i] == '*':
            out, i = out + '[^/]*', i + 1
        elif pattern[i] == '?':
            out, i = out + '[^/]', i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile(out + r'\Z')


def git(*argv):
    return subprocess.check_output(['git', '-C', str(source), *argv])


roots = mapping['source_roots']
files = sorted(p for p in git('ls-files', '-z', '--cached', '--others', '--exclude-standard',
                              '--', *roots).decode().split('\0') if p)
head = git('rev-parse', 'HEAD').decode().strip()

rust_sources = '\n'.join(p.read_text() for p in (root / 'src').rglob('*.rs'))
test_names = set(re.findall(r'#\[(?:[\w:]+::)?test[^\]]*\]\s*(?:async\s+)?fn\s+(\w+)', rust_sources))


def check_evidence(group, item):
    kind, _, value = item.partition(':')
    if kind == 'test':
        if value not in test_names:
            errors.append(f"{group}: evidence test `{value}` does not exist")
    elif kind == 'artifact':
        if not (root / 'artifacts' / value).exists():
            errors.append(f"{group}: evidence artifact artifacts/{value} does not exist")
    else:
        errors.append(f"{group}: evidence must be test:<fn> or artifact:<path>, got {item!r}")


owner = {}
for group in mapping['groups']:
    name, status = group['name'], group.get('status')
    if status not in ('ported', 'partial', 'excluded'):
        errors.append(f"{name}: status must be ported, partial or excluded")
        continue
    if status == 'partial' and not group.get('remaining', '').strip():
        errors.append(f"{name}: partial groups must state what remains")
    if status == 'ported':
        if group.get('remaining'):
            errors.append(f"{name}: ported groups cannot carry remaining work")
        if not group.get('evidence'):
            errors.append(f"{name}: ported groups need test or artifact evidence")
    if status == 'excluded' and not group.get('reason', '').strip():
        errors.append(f"{name}: excluded groups need a reason")
    if status != 'excluded' and not group.get('targets'):
        errors.append(f"{name}: {status} groups need Rust targets")
    for target in group.get('targets', []):
        if not (root / target).exists():
            errors.append(f"{name}: Rust target {target} does not exist")
    for item in group.get('evidence', []):
        check_evidence(name, item)
    for pattern in group['sources']:
        if not any(pattern == r or pattern.startswith(r.rstrip('/') + '/') for r in roots):
            errors.append(f"{name}: {pattern} is outside the source roots")
        matcher = glob_regex(pattern)
        matched = [f for f in files if matcher.match(f)]
        if not matched:
            errors.append(f"{name}: source {pattern} matches no file (deleted or renamed?)")
        for path in matched:
            if path in owner:
                errors.append(f"{path}: claimed by both {owner[path]['name']} and {name}")
            owner[path] = group

excluded_rules = [(glob_regex(rule['pattern']), rule) for rule in mapping.get('excluded_patterns', [])]
entries = []
for path in files:
    group = owner.get(path)
    rule = None if group else next((r for m, r in excluded_rules if m.match(path)), None)
    if group:
        status = group['status']
        note = group.get('remaining') or group.get('reason') or ''
    elif rule:
        status, note = 'excluded', rule['reason']
    else:
        status, note = 'pending', 'No reviewed Rust correspondence recorded.'
    content = (source / path).read_bytes() if (source / path).is_file() else b''
    entries.append({
        'source': path,
        'sourceSha256': hashlib.sha256(content).hexdigest(),
        'status': status,
        'group': group['name'] if group else (f"pattern {rule['pattern']}" if rule else None),
        'rustTargets': group.get('targets', []) if group else [],
        'evidence': group.get('evidence', []) if group else [],
        'note': note,
    })

counts = Counter(e['status'] for e in entries)
by_root = defaultdict(Counter)
for e in entries:
    by_root[next(r for r in roots if e['source'].startswith(r))][e['status']] += 1

if args.max_pending is not None and counts['pending'] > args.max_pending:
    errors.append(f"{counts['pending']} pending sources exceed --max-pending {args.max_pending}")
if errors:
    sys.exit('UI migration map is inconsistent:\n  ' + '\n  '.join(errors))

if not args.check:
    report = {
        'capturedAt': datetime.now().astimezone().isoformat(),
        'sourceRepository': mapping['source_repository'],
        'observedSourceCommit': head,
        'policy': mapping['policy'],
        'counts': dict(counts),
        'byRoot': {r: dict(c) for r, c in by_root.items()},
        'groups': [{k: g[k] for k in ('name', 'status', 'targets', 'evidence', 'remaining', 'reason') if k in g}
                   for g in mapping['groups']],
        'entries': entries,
    }
    out = root / 'artifacts/ui-migration-audit.json'
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')

width = max(len(r) for r in roots)
print(f"UI migration map: {len(mapping['groups'])} groups over {len(files)} source files "
      f"(source {head[:8]})")
print(f"  {'root'.ljust(width)}  ported partial excluded pending")
for r in roots:
    c = by_root[r]
    print(f"  {r.ljust(width)}  {c['ported']:6} {c['partial']:7} {c['excluded']:8} {c['pending']:7}")
print(f"  {'total'.ljust(width)}  {counts['ported']:6} {counts['partial']:7} "
      f"{counts['excluded']:8} {counts['pending']:7}")
if not args.check:
    print('Report: artifacts/ui-migration-audit.json')
