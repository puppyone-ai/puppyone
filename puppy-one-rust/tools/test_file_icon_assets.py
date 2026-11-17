"""Generated SVGs must remain valid XML even when a renderer is permissive."""
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


class FileIconAssetTests(unittest.TestCase):
    def test_every_generated_glyph_is_a_well_formed_svg_document(self):
        catalog = json.loads((Path(__file__).resolve().parents[1] /
                              'assets/file-icons.json').read_text())
        for theme, definition in catalog['themes'].items():
            for kind, glyph in definition['glyphs'].items():
                with self.subTest(theme=theme, kind=kind):
                    root = ET.fromstring(glyph['svg'])
                    self.assertEqual(root.tag, '{http://www.w3.org/2000/svg}svg')
                    self.assertGreater(len(root), 0)


if __name__ == '__main__':
    unittest.main()
