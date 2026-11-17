"""The same complete source identity for verification and local packaging."""
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = ('Cargo.toml', 'Cargo.lock', 'README.md', 'THIRD_PARTY.md', 'product-source.json')
SOURCE_DIRS = ('src', 'crates', 'tools', 'assets', 'fixtures', 'vendor')


def source_hashes(root=ROOT):
    root = Path(root)
    paths = [root / name for name in ROOT_FILES]
    # Rescan on every call: new files must invalidate an earlier receipt too.
    for folder in SOURCE_DIRS:
        paths += [path for path in (root / folder).rglob('*') if path.is_file()
                  and not {'__pycache__', 'target'}.intersection(path.relative_to(root).parts)
                  and path.suffix not in ('.dylib', '.so', '.dll')]
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)}


def verify_source_receipt(receipt, root=ROOT):
    if receipt.get('passed') is not True or receipt.get('sourceUnchangedDuringVerification') is not True:
        raise ValueError('Verification did not pass against one stable source snapshot')
    expected = receipt.get('sourceHashes')
    if not isinstance(expected, dict) or not expected:
        raise ValueError('Missing source identity')
    current = source_hashes(root)
    changed = sorted(name for name in current.keys() | expected.keys()
                     if current.get(name) != expected.get(name))
    if changed:
        raise ValueError('Source changed after verification: ' + ', '.join(changed[:10]))
