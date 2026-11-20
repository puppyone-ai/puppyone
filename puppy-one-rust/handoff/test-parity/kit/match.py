#!/usr/bin/env python3
"""Propose Rust tests for unreviewed TS cases by name.

usage: match.py PREFIX
Reads /tmp/rust-tests.json (cargo test --list over the workspace).
"""
import json, re, sys, difflib
sys.argv, prefix = sys.argv[:1], sys.argv[1]
exec(open('/Users/supersayajin/project/rust-test-parity-work/parity.py').read().split('def cmd_summary')[0])
manifest = load()
left = unreviewed(manifest)
tests = json.load(open('/tmp/rust-tests.json'))
mapped = {r['test'] for c in manifest['contracts'] for r in c['rust']}
pkg = {'puppy_one_rust': 'po-app', 'po_editor': 'po-editor', 'po_platform': 'po-platform',
       'po_agent': 'po-agent', 'po_workspace': 'po-workspace', 'po_contracts': 'po-contracts', 'po_ui': 'po-ui'}
by_leaf = {}
for t in tests:
    by_leaf.setdefault(t['test'].split('::')[-1], []).append(t)
leaves = list(by_leaf)

STOP = {'a','an','the','and','or','of','to','in','on','for','with','without','its','it','is','as','by','when','while','from','into','only','one','not','does','do','be','that','this','their','after','before'}
THRESHOLD = 0.3

def snake(name):
    name = name.split(' > ')[-1]
    name = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
    return name

for path, idx in sorted(left.items()):
    if not path.startswith(prefix) or not idx:
        continue
    print(f'== {path}')
    for i in idx:
        case = FILES[path]['cases'][i]['name']
        s = snake(case)
        hits = by_leaf.get(s)
        tag = 'EXACT'
        if not hits:
            words = set(s.split('_')) - STOP
            scored = sorted(((len(words & set(l.split('_'))) / max(1, len(words | (set(l.split('_')) - STOP))), l) for l in leaves), reverse=True)[:2]
            hits = [h for score, l in scored if score >= THRESHOLD for h in by_leaf[l][:1]]
            tag = f'{scored[0][0]:.2f}' if hits else '-'
        desc = '; '.join(f"{pkg.get(h['bin'], h['bin'])}:{h['test']}{' [m]' if h['test'] in mapped else ''}" for h in hits[:2])
        print(f'  [{i}] {tag:5} {case.split(" > ")[-1][:90]}\n        {desc}')
