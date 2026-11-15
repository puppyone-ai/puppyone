#!/usr/bin/env python3
"""The product's format registry and preset viewer manifest, projected for the
native runtime.

`shared/fileFormats.json` is the canonical file format
table (extensions, MIME types, category, default viewer, editability) and
`shared/presetViewerManifest.json` the
process-neutral contract of every viewer that ships with the product. The
native registries (`src/formats`, `src/editor/registry`) read these copies.
DuckDB files (`.duckdb`, `.ddb`) are projected as raw binary files
(`binary-placeholder`) so the native bundle stays free of the 55 MiB DuckDB C++
library while keeping SQLite preview native.
Run with --check to detect a stale projection.
"""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
from product_source import product_root
repo = product_root()
DUCKDB_EXTENSIONS = ('.duckdb', '.ddb')
DUCKDB_MIMES = ('application/vnd.duckdb',)


def project_file_formats(table):
    projected = []
    for entry in table.get('formats', []):
        if entry.get('id') != 'database-candidate':
            projected.append(entry)
            continue
        sqlite_entry = dict(entry)
        sqlite_entry['extensions'] = [
            ext for ext in entry.get('extensions', []) if ext not in DUCKDB_EXTENSIONS
        ]
        sqlite_entry['mimeTypes'] = [
            mime for mime in entry.get('mimeTypes', []) if mime not in DUCKDB_MIMES
        ]
        if 'mimeTypesByExtension' in entry:
            sqlite_entry['mimeTypesByExtension'] = {
                ext: mime
                for ext, mime in entry['mimeTypesByExtension'].items()
                if ext not in DUCKDB_EXTENSIONS
            }
        projected.append(sqlite_entry)
        projected.append({
            'id': 'duckdb',
            'label': 'DuckDB',
            'semanticKind': 'database',
            'extensions': list(DUCKDB_EXTENSIONS),
            'mimeTypes': list(DUCKDB_MIMES),
            'mimeTypesByExtension': {ext: 'application/vnd.duckdb' for ext in DUCKDB_EXTENSIONS},
            'category': 'binary',
            'defaultViewer': 'binary-placeholder',
            'editable': False,
            'ingestStrategy': 'raw',
        })
    out = dict(table)
    out['formats'] = projected
    return out


sources = {
    'shared/fileFormats.json': (root / 'assets/formats/file-formats.json', project_file_formats),
    'shared/presetViewerManifest.json': (root / 'assets/formats/preset-viewers.json', lambda data: data),
}
stale = []
for source, (target, transform) in sources.items():
    # Normalised JSON keeps the copy byte-stable across editors.
    raw = json.loads((repo / source).read_text())
    content = json.dumps(transform(raw), ensure_ascii=False, indent=1) + '\n'
    if '--check' in sys.argv:
        if not target.exists() or target.read_text() != content:
            stale.append(str(target.relative_to(root)))
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
if stale:
    raise SystemExit('Stale format projection: ' + ', '.join(stale))
print('Format registry verified' if '--check' in sys.argv else 'Format registry imported')
