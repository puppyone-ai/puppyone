"""The built-in Sub Themes and theme contract the app ships stay the
product's: `import-theme-contract.mjs --check` passes for this checkout and
fails for a changed or an extra built-in package."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from product_source import product_root

ROOT = Path(__file__).resolve().parents[1]


class ThemeContractTests(unittest.TestCase):
    def check(self, root):
        env = {**os.environ, 'PUPPYONE_PRODUCT_ROOT': str(product_root())}
        return subprocess.run(
            ['node', str(root / 'tools/import-theme-contract.mjs'), '--check'],
            cwd=root, env=env, capture_output=True, text=True)

    def test_the_shipped_builtin_themes_are_the_products(self):
        result = self.check(ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('default-neutral', result.stdout)

    def test_a_changed_or_extra_builtin_theme_is_stale(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tools').mkdir()
            for name in ['import-theme-contract.mjs', 'product-source.mjs', 'system-fonts.mjs']:
                shutil.copy(ROOT / 'tools' / name, root / 'tools' / name)
            shutil.copy(ROOT / 'product-source.json', root / 'product-source.json')
            shutil.copytree(ROOT / 'assets/themes', root / 'assets/themes')
            (root / 'assets/typography').mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / 'assets/typography/fonts.json', root / 'assets/typography/fonts.json')
            self.assertEqual(self.check(root).returncode, 0)
            warm = root / 'assets/themes/builtin/default-warm.css'
            original = warm.read_bytes()
            warm.write_bytes(original + b'\n')
            result = self.check(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('builtin/default-warm.css', result.stderr)
            warm.write_bytes(original)
            (root / 'assets/themes/builtin/retired.css').write_text('')
            result = self.check(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('retired.css', result.stderr)


if __name__ == '__main__':
    unittest.main()
