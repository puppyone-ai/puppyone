"""Module paths a Rust source names, for the boundary checks.

`paths(root, file)` yields every absolute `crate::…` path a file names in
`use` trees and in code (comments and test modules stripped), resolving
`self` and `super` against the file's own module path.
"""
from pathlib import Path
import re


def module_path(root, path):
    """`crate::a::b` of `src/a/b.rs` or `src/a/b/mod.rs`."""
    parts = list(path.relative_to(root / 'src').with_suffix('').parts)
    if parts[-1] in ('mod', 'main'):
        parts = parts[:-1]
    return ['crate', *parts]


def strip(source):
    """The source without comments, string literals or its test module."""
    source = re.sub(r'(?s)/\*.*?\*/', '', source)
    source = re.sub(r'//[^\n]*', '', source)
    source = re.sub(r'r(#*)"(?s:.*?)"\1', '""', source)
    source = re.sub(r'"(?:\\.|[^"\\])*"', '""', source)
    return cut_tests(source)


def cut_tests(source):
    """Drops `#[cfg(test)] mod … { … }` blocks and `#[cfg(test)] mod x;`."""
    out, i = [], 0
    pattern = re.compile(r'#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*([{;])')
    while True:
        m = pattern.search(source, i)
        if not m:
            out.append(source[i:])
            break
        out.append(source[i:m.start()])
        if m.group(1) == ';':
            i = m.end()
            continue
        depth, j = 1, m.end()
        while depth and j < len(source):
            depth += {'{': 1, '}': -1}.get(source[j], 0)
            j += 1
        i = j
    return ''.join(out)


def expand(tree):
    """`a::{b, c::{d, e}}` → `a::b`, `a::c::d`, `a::c::e` (aliases dropped)."""
    tree = re.sub(r'\s+', '', tree)
    depth, start, top = 0, 0, []
    brace = tree.find('{')
    if brace < 0:
        return [re.sub(r'as\w+$', '', tree.split(' as ')[0])]
    prefix, inner = tree[:brace], tree[brace + 1:tree.rfind('}')]
    for k, c in enumerate(inner):
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif c == ',' and depth == 0:
            top.append(inner[start:k])
            start = k + 1
    top.append(inner[start:])
    result = []
    for part in filter(None, top):
        for sub in expand(part):
            result.append((prefix + sub) if sub != 'self' else prefix.rstrip(':'))
    return result


def resolve(segments, here):
    """Absolute segments of `segments` written in module `here`."""
    if not segments:
        return None
    if segments[0] == 'crate':
        return segments
    base = list(here)
    if segments[0] == 'self':
        return base + segments[1:]
    if segments[0] == 'super':
        while segments and segments[0] == 'super':
            base = base[:-1]
            segments = segments[1:]
        return base + segments
    return None


def paths(root, path):
    """The absolute `crate::…` paths `path` names."""
    here = module_path(root, path)
    source = strip(path.read_text())
    found = []
    for m in re.finditer(r'\buse\s+([^;]+);', source):
        for tree in expand(m.group(1)):
            tree = re.sub(r'as[A-Za-z_]\w*$', '', tree) if '::' in tree else tree
            absolute = resolve([s for s in tree.split('::') if s], here)
            if absolute:
                found.append(absolute)
    code = re.sub(r'\buse\s+[^;]+;', '', source)
    for m in re.finditer(r'\b(?:crate|super|self)(?:::[A-Za-z_]\w*)+', code):
        absolute = resolve(m.group(0).split('::'), here)
        if absolute:
            found.append(absolute)
    return found


def submodules(root, feature, public=None):
    """The modules a feature declares at its root (only its `pub mod` facade
    modules, or only the others, when `public` says)."""
    folder = root / 'src/features' / feature
    if not folder.is_dir():
        return set()
    found = re.findall(r'^\s*(?:#\[[^\]]*\]\s*)*(pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*[;{]',
                       (folder / 'mod.rs').read_text(), re.M)
    return {name for vis, name in found
            if public is None or (vis.strip() == 'pub') == public}


def deep_feature_imports(root):
    """`(file, path)` for every name of another feature's internals: a path
    that goes through a module below the feature's root that is not one of
    its `pub mod` facade modules."""
    features = {p.name if p.is_dir() else p.stem for p in (root / 'src/features').iterdir()
                if p.is_dir() or (p.suffix == '.rs' and p.stem != 'mod')}
    # A feature's `pub mod` modules are its facade; the others are internals.
    modules = {feature: submodules(root, feature, public=False) for feature in features}
    result = []
    for path in (root / 'src').rglob('*.rs'):
        if path.name == 'tests.rs' or 'tests' in path.parts:
            continue
        here = module_path(root, path)
        own = here[2] if len(here) > 2 and here[1] == 'features' else None
        for segments in paths(root, path):
            if len(segments) < 4 or segments[1] != 'features':
                continue
            feature = segments[2]
            if feature == own or feature not in modules:
                continue
            if segments[3] in modules[feature]:
                result.append((path.relative_to(root), '::'.join(segments)))
    return result


if __name__ == '__main__':
    import collections, sys
    root = Path(__file__).resolve().parents[1]
    found = deep_feature_imports(root)
    by = collections.Counter((str(f).split('/')[1] if str(f).startswith('src/features') else str(f).split('/')[1], p.split('::')[2]) for f, p in found)
    for (who, what), n in by.most_common():
        print(f'{n:4} {who} -> {what}')
    print(len(found))
    if '-v' in sys.argv:
        for f, p in sorted(set(found)):
            print(f, p)
