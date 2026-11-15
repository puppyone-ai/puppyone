#!/usr/bin/env python3
"""Editor, edit-path and window frame-cost benchmarks with real Core Text shaping.

Builds the release test binaries once, then runs every (surface, size) in its
own process (GPUI Kit keeps thread-local text caches) and writes
artifacts/editor-bench/result.json. With --check, fails when a frame or scaling
budget in tools/editor-frame-budgets.json is exceeded (scaling checks marked
with `pending` are measured and reported as KNOWN GAP without failing).
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
parser.add_argument('--sections', default='10,40,160', help='frame-surface sizes for editor/window (Markdown sections, ~24 lines each)')
parser.add_argument('--edit-sections', default='160,1600', help='edit-surface sizes for typing/arrow/IME/find+type')
parser.add_argument('--surfaces', default='editor,window,edit', help='comma-separated surfaces to run (default: editor,window,edit)')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
if platform.system() != 'Darwin':
    sys.exit('The frame benchmarks shape text with Core Text: macOS only.')
all_surfaces = {
    'editor': ('po-editor', 'po_editor', 'editor::view::bench::editor_frame_cost', [int(s) for s in args.sections.split(',') if s]),
    'window': ('po-app', 'puppy-one-rust', 'app::dev::bench::window_frame_cost', [int(s) for s in args.sections.split(',') if s]),
    'edit': ('po-editor', 'po_editor', 'editor::view::bench::editor_edit_cost', [int(s) for s in args.edit_sections.split(',') if s]),
}
selected = [s.strip() for s in args.surfaces.split(',') if s.strip()]
for s in selected:
    if s not in all_surfaces:
        sys.exit(f'Unknown benchmark surface: {s} (expected one of {", ".join(all_surfaces)})')

packages = []
for s in selected:
    pkg = all_surfaces[s][0]
    if pkg not in packages:
        packages.append(pkg)
pkg_args = [arg for pkg in packages for arg in ('-p', pkg)]

cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
build = subprocess.run([cargo, 'test', '--release', '--locked', *pkg_args, '--no-run', '--message-format=json'],
                       cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if build.returncode:
    sys.stderr.write(build.stderr)
    sys.exit(build.returncode)

# The editor's benchmarks are in po-editor's tests, the window's in the app's.
binaries = {
    a['target']['name']: a['executable']
    for a in map(json.loads, filter(lambda l: l.startswith('{'), build.stdout.splitlines()))
    if a.get('profile', {}).get('test') and a.get('executable')
}

results = []
# Run frame surfaces grouped by section size as before, then edit surfaces by edit-section size.
frame_surfaces = [s for s in ('editor', 'window') if s in selected]
if frame_surfaces:
    for sections in all_surfaces[frame_surfaces[0]][3]:
        for surface in frame_surfaces:
            _, target, test, _ = all_surfaces[surface]
            run = subprocess.run(
                [binaries[target], test, '--exact', '--ignored', '--nocapture', '--test-threads=1'],
                cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                env={**os.environ, 'PUPPYONE_BENCH_SECTIONS': str(sections)},
            )
            found = re.search(r'BENCH (\{.*\})', run.stdout)
            if run.returncode or found is None:
                sys.stdout.write(run.stdout)
                sys.exit(f'{surface} benchmark failed at {sections} sections')
            results.append(json.loads(found.group(1)))

if 'edit' in selected:
    _, target, test, edit_sizes = all_surfaces['edit']
    for sections in edit_sizes:
        run = subprocess.run(
            [binaries[target], test, '--exact', '--ignored', '--nocapture', '--test-threads=1'],
            cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env={**os.environ, 'PUPPYONE_BENCH_SECTIONS': str(sections)},
        )
        found = re.search(r'BENCH (\{.*\})', run.stdout)
        if run.returncode or found is None:
            sys.stdout.write(run.stdout)
            sys.exit(f'edit benchmark failed at {sections} sections')
        results.append(json.loads(found.group(1)))

frame_rows = [r for r in results if r['surface'] in ('editor', 'window')]
if frame_rows:
    print(f"{'surface':<8}{'lines':>7}{'first':>9}{'scroll mean':>13}{'scroll p95':>12}{'resize mean':>13}{'resize p95':>12}")
    for r in frame_rows:
        print(f"{r['surface']:<8}{r['lines']:>7}{r['firstMs']:>8.1f}m{r['scrollMeanMs']:>12.2f}m"
              f"{r['scrollP95Ms']:>11.2f}m{r['resizeMeanMs']:>12.2f}m{r['resizeP95Ms']:>11.2f}m")

edit_rows = [r for r in results if r['surface'] == 'edit']
if edit_rows:
    if frame_rows:
        print()
    print(
        f"{'surface':<8}{'sect':>6}{'lines':>7}"
        f"{'type mean':>11}{'type p95':>10}"
        f"{'arrow mean':>12}{'arrow p95':>11}"
        f"{'ime mean':>10}{'ime p95':>10}"
        f"{'find mean':>11}{'find p95':>10}"
    )
    for r in edit_rows:
        print(
            f"{r['surface']:<8}{r['sections']:>6}{r['lines']:>7}"
            f"{r['typeMeanMs']:>10.2f}m{r['typeP95Ms']:>9.2f}m"
            f"{r['arrowMeanMs']:>11.2f}m{r['arrowP95Ms']:>10.2f}m"
            f"{r['imeMeanMs']:>9.2f}m{r['imeP95Ms']:>9.2f}m"
            f"{r['findTypeMeanMs']:>10.2f}m{r['findTypeP95Ms']:>9.2f}m"
        )

cpu_brand = subprocess.run(
    ['sysctl', '-n', 'machdep.cpu.brand_string'],
    cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
).stdout.strip()

out = root / 'artifacts/editor-bench'
out.mkdir(parents=True, exist_ok=True)
head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, stdout=subprocess.PIPE).stdout.strip()
(out / 'result.json').write_text(
    json.dumps(
        {
            'commit': head,
            'machine': platform.machine(),
            'cpu': cpu_brand or platform.processor(),
            'platform': platform.platform(),
            'results': results,
        },
        indent=2,
    ) + '\n'
)

if args.check:
    budgets = json.loads((root / 'tools/editor-frame-budgets.json').read_text())
    ci_cfg = budgets.get('ci', {})
    in_ci = bool(ci_cfg.get('env') and os.environ.get(ci_cfg['env']) == 'true')
    ci_multiplier = float(ci_cfg.get('uncalibratedMultiplier', 1.0)) if in_ci and not ci_cfg.get('calibrated') else 1.0
    if in_ci and not ci_cfg.get('calibrated'):
        print(
            f"CI absolute-budget mode: runner calibration pending; applying x{ci_multiplier:.2f} "
            f"to entries without explicit ciMaxMs (scaling maxRatio still enforced strictly)."
        )

    failures = []
    known_gaps = []

    for b in budgets['budgets']:
        for r in results:
            if r['surface'] == b['surface'] and r['sections'] == b['sections']:
                ci_overrides = b.get('ciMaxMs', {}) if in_ci else {}
                for metric, local_limit in b['maxMs'].items():
                    limit = ci_overrides.get(metric, local_limit * ci_multiplier)
                    if r[metric] > limit:
                        failures.append(
                            f"{b['surface']} {r['lines']} lines {metric}: {r[metric]:.2f}ms > {limit:.2f}ms"
                        )

    def measured(surface, sections):
        return next((r for r in results if r['surface'] == surface and r['sections'] == sections), None)

    for c in budgets.get('scaling', []):
        small, large = measured(c['surface'], c['small']), measured(c['surface'], c['large'])
        if small is None or large is None:
            failures.append(f"{c['surface']} scaling {c['small']}->{c['large']} sections was not measured")
            continue
        ratio = large[c['metric']] / max(small[c['metric']], 1e-6)
        pending = c.get('pending')
        if ratio > c['maxRatio']:
            detail = (
                f"{c['surface']} {c['metric']} {small['lines']} lines {small[c['metric']]:.2f}ms -> "
                f"{large['lines']} lines {large[c['metric']]:.2f}ms (x{ratio:.2f} > x{c['maxRatio']})"
            )
            if pending:
                known_gaps.append(f"KNOWN GAP [pending {pending}]: {detail}")
            else:
                failures.append(f"{c['surface']} {c['metric']} grows with the document: {detail}")

    missing = [
        b for b in budgets['budgets']
        if not any(r['surface'] == b['surface'] and r['sections'] == b['sections'] for r in results)
    ]
    if missing:
        failures.append(f'{len(missing)} budgeted sizes were not measured (check --sections / --edit-sections)')

    for gap in known_gaps:
        print(gap)
    if failures:
        sys.exit('Frame budget exceeded:\n  ' + '\n  '.join(failures))
    print(f"Frame budgets met ({len(known_gaps)} pending scaling gap(s) tracked).")
