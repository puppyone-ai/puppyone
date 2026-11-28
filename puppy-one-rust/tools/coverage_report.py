"""Read LLVM LCOV using AST test exclusions, retaining zero-hit production lines."""
from collections import defaultdict
from pathlib import Path


def domain(path):
    if path.startswith(('src/editor/', 'src/documents/')):
        return 'editor'
    if path.startswith(('src/agent/', 'src/features/desktop_agent/')):
        return 'agent'
    if path.startswith(('src/app/', 'src/features/workbench/', 'src/features/desktop_terminal/')):
        return 'workbench'
    if path.startswith('src/workspace/'):
        return 'workspace'
    if path.startswith('src/platform/'):
        return 'platform'
    return 'shared'


def measure(lcov, source_index, root):
    root = Path(root).resolve()
    sources = {file['path']: file for file in source_index['files']}
    files = {}
    current = None
    for line in lcov.splitlines():
        if line.startswith('SF:'):
            path = Path(line[3:]).resolve()
            if not path.is_relative_to(root):
                raise ValueError(f'Coverage contains an unexpected external source: {path}')
            name = path.relative_to(root).as_posix()
            if name not in sources:
                raise ValueError(f'Coverage source is absent from AST inventory: {name}')
            current = files.setdefault(name, {'lines': {}, 'branches': {}})
            excluded = sources[name]['excluded']
        elif line == 'end_of_record':
            current = None
        elif current is not None and line.startswith(('DA:', 'BRDA:')):
            kind, value = line.split(':', 1)
            parts = value.split(',')
            number = int(parts[0])
            if any(span['start'] <= number <= span['end'] for span in excluded):
                continue
            if kind == 'DA':
                key, hits, metric = number, int(parts[1]), 'lines'
            else:
                key, hits, metric = tuple(parts[:3]), 0 if parts[3] == '-' else int(parts[3]), 'branches'
            current[metric][key] = max(hits, current[metric].get(key, 0))
    totals = defaultdict(lambda: {'lines': [0, 0], 'branches': [0, 0]})
    rows = []
    for path, counts in sorted(files.items()):
        if not counts['lines'] and not counts['branches']:
            continue
        metrics = {}
        for metric in ('lines', 'branches'):
            values = counts[metric].values()
            covered, total = sum(value > 0 for value in values), len(counts[metric])
            metrics[metric] = {'covered': covered, 'total': total,
                               'percent': round(100 * covered / total, 2) if total else None}
            for key in (domain(path), 'all'):
                totals[key][metric][0] += covered
                totals[key][metric][1] += total
        rows.append({'path': path, 'domain': domain(path), **metrics,
                     'uncoveredLines': sorted(line for line, hits in counts['lines'].items() if not hits)})
    if not totals['all']['lines'][1] or not totals['all']['branches'][1]:
        raise ValueError('A nonempty production line AND branch denominator is required')
    domains = {name: {metric: {'covered': c, 'total': t, 'percent': round(100*c/t, 2) if t else None}
                     for metric, (c, t) in metrics.items()} for name, metrics in sorted(totals.items())}
    return {'domains': domains, 'files': rows,
            'scope': 'Executable production lines and branches emitted for this platform and feature set; AST test spans excluded. This is not cross-platform or functional parity evidence.'}


def failures(report, baseline):
    errors = []
    for name, thresholds in baseline['thresholds'].items():
        for metric, threshold in thresholds.items():
            measured = report['domains'].get(name, {}).get(metric)
            if not measured or measured['percent'] is None:
                errors.append(f'{name}.{metric}: missing measurement')
            elif measured['percent'] < threshold:
                errors.append(f'{name}.{metric}: {measured["percent"]}% < {threshold}%')
    return errors
