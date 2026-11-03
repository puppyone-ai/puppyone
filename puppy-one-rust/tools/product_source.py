"""The pinned product checkout every Python tool reads.

`product-source.json` names a checkout and the commit it must be at; a
checkout at another commit is refused, so receipts and oracles are always
generated from the same product. `PUPPYONE_PRODUCT_ROOT` points at another
checkout of the same commit; `PUPPYONE_PRODUCT_UNPINNED=1` skips the commit
check for exploratory runs.
"""
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'product-source.json').read_text())
COMMIT = CONFIG['commit']


def product_root(override=None):
    checkout = override or os.environ.get('PUPPYONE_PRODUCT_ROOT') or CONFIG['checkout']
    product = (ROOT / checkout).resolve()
    if not product.is_dir():
        raise SystemExit(f'Product checkout {product} is missing (product-source.json pins {COMMIT}).')
    if os.environ.get('PUPPYONE_PRODUCT_UNPINNED') != '1':
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=product, text=True).strip()
        if head != COMMIT:
            raise SystemExit(f'Product checkout {product} is at {head}; product-source.json pins {COMMIT}.')
    return product
