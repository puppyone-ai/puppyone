#!/usr/bin/env python3
"""Working helper for the TS -> Rust acceptance ledger.

  parity.py summary [PREFIX]          unreviewed counts by area (or by file under PREFIX)
  parity.py files PREFIX              files under PREFIX with their unreviewed counts
  parity.py cases FILE                every case of FILE with its status and line
  parity.py show FILE [I ...]         print the TS source of the given cases (all unreviewed if none)
  parity.py add JSON_FILE             add rows / known differences (see below), then validate
  parity.py check                     validate the manifest against the collected cases

add JSON: a list of entries, each either
  {"id", "acceptance", "typescript": [{"path", "cases": [index, ...]}], "rust": [...]}
      -> a new contract row (or, with "extend": true, cases/tests appended to row "id")
  {"id", "kind": "gap"|"out-of-scope", "reason", "owner", "typescript": [...]}
      -> a new known difference (or, with "extend": true, cases appended to difference "id")
Case names and sha256 are filled in from the collected TS cases.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(os.environ.get('PARITY_RUST_ROOT',
                           Path.home() / 'project/puppyone-rust-test-completeness/puppy-one-rust'))
TS = ROOT / 'artifacts/reference-checkouts/typescript'
MANIFEST = ROOT / 'fixtures/test-parity-contracts.json'
COLLECTED = json.loads((ROOT / 'artifacts/test-parity/typescript-cases.json').read_text())
FILES = {f['path']: f for f in COLLECTED['files']}


def load():
    return json.loads(MANIFEST.read_text())


def save(manifest):
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')


def statuses(manifest):
    status = {}
    for row in manifest['contracts']:
        for c in row['typescript']:
            for case in c.get('cases', []):
                status[(c['path'], case['index'])] = 'mapped'
    for d in manifest.get('knownDifferences', []):
        for c in d['typescript']:
            for case in c.get('cases', []):
                status[(c['path'], case['index'])] = d['kind'] + ':' + d['id']
    return status


def unreviewed(manifest):
    status = statuses(manifest)
    return {path: [i for i in range(len(f['cases'])) if (path, i) not in status]
            for path, f in FILES.items()}


def cmd_summary(prefix=''):
    left = unreviewed(load())
    if prefix:
        return cmd_files(prefix)
    by = Counter()
    total = Counter()
    for path, idx in left.items():
        key = '/'.join(path.split('/')[1:3])
        by[key] += len(idx)
        total[key] += len(FILES[path]['cases'])
    print(f"unreviewed {sum(by.values())} of {sum(total.values())}")
    for key, n in sorted(by.items(), key=lambda kv: -kv[1]):
        if n:
            print(f"  {key:32} {n:5} / {total[key]}")


def cmd_files(prefix):
    left = unreviewed(load())
    rows = [(p, len(i), len(FILES[p]['cases'])) for p, i in left.items() if p.startswith(prefix) and i]
    for p, n, t in sorted(rows):
        print(f"{n:4}/{t:<4} {p}")
    print(f"{sum(r[1] for r in rows)} unreviewed in {len(rows)} files")


def cmd_cases(path):
    status = statuses(load())
    for i, case in enumerate(FILES[path]['cases']):
        s = status.get((path, i), '-')
        print(f"{i:3} L{case['location']['line']:<5} {s:28.28} {case['name']}")


def cmd_show(path, *indices):
    manifest = load()
    cases = FILES[path]['cases']
    picks = [int(i) for i in indices] or unreviewed(manifest)[path]
    lines = (TS / path).read_text().splitlines()
    starts = sorted(c['location']['line'] for c in cases)
    for i in picks:
        line = cases[i]['location']['line']
        nxt = next((s for s in starts if s > line), None)
        end = (nxt - 1) if nxt else min(len(lines), line + 80)
        print(f"----- [{i}] {cases[i]['name']}")
        print('\n'.join(lines[line - 1:end]))


def cite(entry):
    out = []
    for c in entry['typescript']:
        path = c['path']
        f = FILES[path]
        cases = []
        for item in c['cases']:
            index = item if isinstance(item, int) else item['index']
            cases.append({'index': index, 'name': f['cases'][index]['name']})
        out.append({'path': path, 'sha256': f['sha256'], 'cases': cases})
    return out


def merge_citations(old, new):
    by = {c['path']: c for c in old}
    for c in new:
        if c['path'] in by:
            have = {x['index'] for x in by[c['path']]['cases']}
            by[c['path']]['cases'] += [x for x in c['cases'] if x['index'] not in have]
            by[c['path']]['cases'].sort(key=lambda x: x['index'])
        else:
            old.append(c)
            by[c['path']] = c
    return old


def cmd_add(json_file):
    manifest = load()
    entries = json.loads(Path(json_file).read_text())
    rows = {r['id']: r for r in manifest['contracts']}
    diffs = {d['id']: d for d in manifest.setdefault('knownDifferences', [])}
    for e in entries:
        citations = cite(e)
        if e.get('kind'):
            if e.get('extend'):
                merge_citations(diffs[e['id']]['typescript'], citations)
            else:
                assert e['id'] not in diffs, e['id']
                d = {'id': e['id'], 'kind': e['kind'], 'reason': e['reason'], 'owner': e['owner'],
                     'typescript': citations}
                manifest['knownDifferences'].append(d)
                diffs[e['id']] = d
        else:
            if e.get('extend'):
                row = rows[e['id']]
                merge_citations(row['typescript'], citations)
                have = {(t['package'], t.get('target'), t['test']) for t in row['rust']}
                row['rust'] += [t for t in e.get('rust', []) if (t['package'], t.get('target'), t['test']) not in have]
                if e.get('acceptance'):
                    row['acceptance'] = e['acceptance']
            else:
                assert e['id'] not in rows, e['id']
                row = {'id': e['id'], 'acceptance': e['acceptance'], 'typescript': citations, 'rust': e['rust']}
                manifest['contracts'].append(row)
                rows[e['id']] = row
    check(manifest)
    save(manifest)
    print('added', len(entries), 'entries')
    cmd_summary()


def check(manifest):
    sys.path.insert(0, str(ROOT / 'tools'))
    from parity_inventory import case_inventory
    inv = case_inventory(manifest, COLLECTED, list(FILES), [])
    for row in manifest['contracts']:
        assert row['acceptance'] and row['typescript'] and row['rust'], row['id']
        for t in row['rust']:
            assert t.get('package') and t.get('test'), (row['id'], t)
    return inv


def cmd_check():
    inv = check(load())
    print('ok:', inv['reviewedCaseCount'], 'mapped,', len(inv['knownGapCases']), 'gap,',
          len(inv['outOfScopeCases']), 'out of scope,', len(inv['unreviewedCases']), 'unreviewed')


if __name__ == '__main__':
    command, *rest = sys.argv[1:] or ['summary']
    {'summary': cmd_summary, 'files': cmd_files, 'cases': cmd_cases, 'show': cmd_show,
     'add': cmd_add, 'check': cmd_check}[command](*rest)
