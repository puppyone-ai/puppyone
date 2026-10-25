#!/usr/bin/env python3
"""Editor and window frame-cost benchmarks with real Core Text shaping.

Builds the release test binary once, then runs every (surface, size) in its
own process (GPUI Kit keeps thread-local text caches) and writes
artifacts/editor-bench/result.json. With --check, fails when a frame budget
in tools/editor-frame-budgets.json is exceeded.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='enforce tools/editor-frame-budgets.json')
parser.add_argument('--sections', default='10,40,160', help='document sizes (Markdown sections, ~24 lines each)')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
if platform.system() != 'Darwin':
    sys.exit('The frame benchmarks shape text with Core Text: macOS only.')
cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
build = subprocess.run([cargo, 'test', '--release', '--locked', '--no-run', '--message-format=json'],
                       cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if build.returncode:
    sys.stderr.write(build.stderr)
    sys.exit(build.returncode)
binary = next(json.loads(line)['executable'] for line in build.stdout.splitlines()
              if line.startswith('{') and json.loads(line).get('profile', {}).get('test')
              and json.loads(line).get('executable'))

tests = {'editor': 'editor::view::bench::editor_frame_cost', 'window': 'shell::bench::window_frame_cost'}
results = []
for sections in [int(s) for s in args.sections.split(',')]:
    for surface, test in tests.items():
        run = subprocess.run([binary, test, '--exact', '--ignored', '--nocapture', '--test-threads=1'],
                             cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             env={**os.environ, 'PUPPYONE_BENCH_SECTIONS': str(sections)})
        found = re.search(r'BENCH (\{.*\})', run.stdout)
        if run.returncode or found is None:
            sys.stdout.write(run.stdout)
            sys.exit(f'{surface} benchmark failed at {sections} sections')
        results.append(json.loads(found.group(1)))

print(f"{'surface':<8}{'lines':>7}{'first':>9}{'scroll mean':>13}{'scroll p95':>12}{'resize mean':>13}{'resize p95':>12}")
for r in results:
    print(f"{r['surface']:<8}{r['lines']:>7}{r['firstMs']:>8.1f}m{r['scrollMeanMs']:>12.2f}m"
          f"{r['scrollP95Ms']:>11.2f}m{r['resizeMeanMs']:>12.2f}m{r['resizeP95Ms']:>11.2f}m")

out = root / 'artifacts/editor-bench'
out.mkdir(parents=True, exist_ok=True)
head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, stdout=subprocess.PIPE).stdout.strip()
(out / 'result.json').write_text(json.dumps({'commit': head, 'machine': platform.machine(),
                                             'platform': platform.platform(), 'results': results}, indent=2) + '\n')

if args.check:
    budgets = json.loads((root / 'tools/editor-frame-budgets.json').read_text())
    failures = []
    for b in budgets['budgets']:
        for r in results:
            if r['surface'] == b['surface'] and r['sections'] == b['sections']:
                for metric, limit in b['maxMs'].items():
                    if r[metric] > limit:
                        failures.append(f"{b['surface']} {r['lines']} lines {metric}: {r[metric]:.2f}ms > {limit}ms")
    def measured(surface, sections):
        return next((r for r in results if r['surface'] == surface and r['sections'] == sections), None)
    for c in budgets.get('scaling', []):
        small, large = measured(c['surface'], c['small']), measured(c['surface'], c['large'])
        if small is None or large is None:
            failures.append(f"{c['surface']} scaling {c['small']}->{c['large']} sections was not measured")
            continue
        ratio = large[c['metric']] / max(small[c['metric']], 1e-6)
        if ratio > c['maxRatio']:
            failures.append(f"{c['surface']} {c['metric']} grows with the document: "
                            f"{small['lines']} lines {small[c['metric']]:.2f}ms -> {large['lines']} lines "
                            f"{large[c['metric']]:.2f}ms (x{ratio:.1f} > x{c['maxRatio']})")
    missing = [b for b in budgets['budgets'] if not any(
        r['surface'] == b['surface'] and r['sections'] == b['sections'] for r in results)]
    if missing:
        failures.append(f'{len(missing)} budgeted sizes were not measured (pass --sections)')
    if failures:
        sys.exit('Frame budget exceeded:\n  ' + '\n  '.join(failures))
    print('Frame budgets met.')
