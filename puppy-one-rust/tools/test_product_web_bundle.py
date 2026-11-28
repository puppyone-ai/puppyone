"""A verified export cannot create output without its pinned source receipt."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid
from source_identity import ROOT


class VerifiedBundleExport(unittest.TestCase):
    def invoke(self, script):
        return subprocess.run([shutil.which('node') or 'node', '--input-type=module', '-e', script],
                              cwd=ROOT, capture_output=True, text=True, timeout=30)

    def test_export_requires_an_explicit_output_directory(self):
        result = self.invoke("import {bundleProductPage} from './tools/product-web-bundle.mjs';"
                             "process.argv=['node','tool','--export-verified'];"
                             "await bundleProductPage({name:'missing',entry:'unused',styles:[]});")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--export-verified requires --out-dir', result.stderr)

    def test_unpinned_source_cannot_export_or_create_a_receipt(self):
        with tempfile.TemporaryDirectory(prefix='po-unpinned-bundle-') as folder:
            folder = Path(folder)
            entry = folder / 'entry.tsx'
            entry.write_text('console.log("unqualified viewer");')
            output = folder / 'output'
            name = f'unqualified-{uuid.uuid4().hex}'
            receipt = ROOT / f'assets/web/{name}.json'
            script = ("import {bundleProductPage} from './tools/product-web-bundle.mjs';"
                      f"process.argv=['node','tool','--export-verified','--out-dir',{json.dumps(str(output))}];"
                      f"await bundleProductPage({{name:{json.dumps(name)},"
                      f"entry:{json.dumps(os.path.relpath(entry, ROOT))},styles:[]}});")
            result = self.invoke(script)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Stale', result.stderr)
            self.assertIn(name, result.stderr)
            self.assertFalse(output.exists())
            self.assertFalse(receipt.exists())
