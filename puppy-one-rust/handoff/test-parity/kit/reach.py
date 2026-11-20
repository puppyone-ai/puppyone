#!/usr/bin/env python3
"""Which TS product modules are reachable from the product's entry points.

  reach.py test TESTFILE      product modules a test imports, each reachable or not
  reach.py module PATH        is PATH reachable; who imports it (reachable importers first)
  reach.py symbol NAME        reachable files that mention NAME (word match)
  reach.py unreachable [PFX]  unreachable product modules under PFX

Regex-based: static/dynamic imports, require, new URL(..., import.meta.url),
path.join(__dirname, "..")-style literals, the Vite/TS aliases. A module
reported unreachable must still be confirmed with `symbol` before it is
classified.
"""
import json
import os
import re
import sys
from collections import deque
from pathlib import Path

TS = Path(os.environ.get('PARITY_TS_ROOT', Path.home() /
          'project/puppyone-rust-test-completeness/puppy-one-rust/artifacts/reference-checkouts/typescript'))
ROOTS = ['src', 'electron', 'shared', 'public', 'scripts']
EXTS = ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.jsx', '.json']
ALIASES = [
    ('@puppyone/localization/', 'src/lib/localization/'),
    ('@puppyone/localization', 'src/lib/localization/index.ts'),
    ('@puppyone/shared-ui/markdown-presentation-preview', 'src/shared-ui/editor/markdown/MarkdownPresentationPreview.tsx'),
    ('@puppyone/shared-ui/', 'src/shared-ui/styles/'),
    ('@puppyone/shared-ui', 'src/shared-ui/index.ts'),
]
ENTRIES = ['src/main.tsx', 'src/platform/mermaid/host.ts', 'electron/app-entry.mjs',
           'electron/host-service/electron-main.mjs', 'electron/host-service/launcher.mjs',
           'public/initial-theme.js', 'public/interface-style-bootstrap.js', 'public/sub-theme-bootstrap.js']
SPEC = [
    re.compile(r'''(?:^|[;\s}])(?:import|export)\s+(?:type\s+)?[^'";]*?\sfrom\s*['"]([^'"]+)['"]''', re.M | re.S),
    re.compile(r'''(?:^|[;\s])import\s*['"]([^'"]+)['"]''', re.M),
    re.compile(r'''import\(\s*['"]([^'"]+)['"]\s*\)'''),
    re.compile(r'''require\(\s*['"]([^'"]+)['"]\s*\)'''),
    re.compile(r'''new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url'''),
]
JOIN = re.compile(r'''path\.(?:join|resolve)\(\s*[A-Za-z_][A-Za-z0-9_.]*\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)\)''')
LIT = re.compile(r'''['"]([^'"]+)['"]''')


def product_files():
    files = {}
    for root in ROOTS:
        base = TS / root
        if not base.exists():
            continue
        for path in base.rglob('*'):
            if path.suffix in EXTS and 'node_modules' not in path.parts and path.is_file():
                files[path.relative_to(TS).as_posix()] = path
    for path in TS.glob('*.html'):
        files[path.name] = path
    for path in (TS / 'src').rglob('*.html'):
        files[path.relative_to(TS).as_posix()] = path
    return files


FILES = product_files()


def resolve(spec, origin):
    if spec.startswith('.'):
        base = (Path(origin).parent / spec).as_posix()
    elif spec.startswith('/'):
        base = spec.lstrip('/')
    else:
        for prefix, target in ALIASES:
            if spec == prefix or (prefix.endswith('/') and spec.startswith(prefix)):
                base = target + spec[len(prefix):] if prefix.endswith('/') else target
                break
        else:
            return None
    base = os.path.normpath(base)
    candidates = [base] + [base + e for e in EXTS] + [base + '/index' + e for e in EXTS]
    stem, ext = os.path.splitext(base)
    if ext in ('.js', '.mjs', '.jsx'):
        candidates += [stem + e for e in ('.ts', '.tsx', '.mts')]
    for c in candidates:
        if c in FILES:
            return c
    return None


def specifiers(rel):
    text = FILES[rel].read_text(errors='ignore')
    out = set()
    if rel.endswith('.html'):
        for spec in re.findall(r'''<script[^>]*src=["']([^"']+)["']''', text):
            out.add(spec if spec.startswith('.') else '/' + spec.lstrip('/'))
        return out
    # Type-only imports and re-exports carry no code.
    text = re.sub(r'''(?:import|export)\s+type\s+[^;]*?from\s*['"][^'"]+['"]''', '', text, flags=re.S)
    for pattern in SPEC:
        out.update(pattern.findall(text))
    for group in JOIN.findall(text):
        parts = LIT.findall(group)
        if parts and re.search(r'\.(?:c|m)?js$|\.ts$', parts[-1]):
            out.add('./' + '/'.join(parts))
            out.add('/' + '/'.join(parts))
    # Root-relative module paths named as plain strings (forked workers).
    for literal in re.findall(r'''['"]((?:electron|src|shared)/[^'"\s]+\.(?:c|m)?[jt]sx?)['"]''', text):
        out.add('/' + literal)
    # Sibling scripts named by file name (spawned or copied by path).
    for literal in re.findall(r'''['"]([\w.-]+\.(?:c|m)?js)['"]''', text):
        out.add('./' + literal)
    return out


def graph():
    edges = {}
    for rel in FILES:
        if rel.endswith(('.json',)):
            edges[rel] = set()
            continue
        edges[rel] = {r for r in (resolve(s, rel) for s in specifiers(rel)) if r}
    return edges


def reachable(edges):
    seen = set()
    queue = deque(e for e in ENTRIES + ['index.html', 'src/platform/mermaid/host.html'] if e in FILES)
    # Every preload/plugin script beside electron/ is loaded by path.
    queue.extend(p for p in FILES if p.startswith('electron/') and p.endswith('.cjs'))
    while queue:
        rel = queue.popleft()
        if rel in seen:
            continue
        seen.add(rel)
        queue.extend(edges.get(rel, ()))
    return seen


def main():
    cmd, *rest = sys.argv[1:] or ['help']
    cache = TS / '.reach-cache.json'
    edges = graph()
    seen = reachable(edges)
    if cmd == 'test':
        test = rest[0]
        text = (TS / test).read_text(errors='ignore')
        specs = set()
        for pattern in SPEC:
            specs.update(pattern.findall(text))
        for spec in sorted(specs):
            target = resolve(spec, test)
            if target and not target.startswith('tests/'):
                print(('REACHABLE  ' if target in seen else 'UNREACHED  ') + target)
    elif cmd == 'module':
        target = rest[0]
        print('reachable' if target in seen else 'NOT reachable')
        importers = sorted((r for r, e in edges.items() if target in e), key=lambda r: r not in seen)
        for r in importers:
            print(('  R ' if r in seen else '  - ') + r)
    elif cmd == 'symbol':
        name = rest[0]
        word = re.compile(r'\b' + re.escape(name) + r'\b')
        for rel in sorted(seen):
            if word.search(FILES[rel].read_text(errors='ignore')):
                print(rel)
    elif cmd == 'unreachable':
        prefix = rest[0] if rest else ''
        for rel in sorted(FILES):
            if rel.startswith(prefix) and rel not in seen and not rel.endswith(('.json', '.html')):
                print(rel)
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
