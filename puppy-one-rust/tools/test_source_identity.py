import tempfile
import unittest
from pathlib import Path
from source_identity import ROOT_FILES, source_hashes, verify_source_receipt


class SourceIdentity(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for name in ROOT_FILES:
            (self.root / name).write_text(name)
        (self.root / 'src').mkdir()
        (self.root / 'src/lib.rs').write_text('pub fn shipped() {}')
        self.receipt = dict(passed=True, sourceUnchangedDuringVerification=True,
                            sourceHashes=source_hashes(self.root))

    def test_added_removed_and_modified_source_invalidates_the_receipt(self):
        verify_source_receipt(self.receipt, self.root)
        extra = self.root / 'src/added.rs'
        extra.write_text('new implementation')
        with self.assertRaisesRegex(ValueError, 'added.rs'):
            verify_source_receipt(self.receipt, self.root)
        extra.unlink()
        source = self.root / 'src/lib.rs'
        source.write_text('changed implementation')
        with self.assertRaisesRegex(ValueError, 'lib.rs'):
            verify_source_receipt(self.receipt, self.root)
        source.unlink()
        with self.assertRaisesRegex(ValueError, 'lib.rs'):
            verify_source_receipt(self.receipt, self.root)

    def test_empty_partial_or_failed_receipts_cannot_authorize_packaging(self):
        for overrides in [dict(passed=False), dict(sourceUnchangedDuringVerification=False),
                          dict(sourceUnchangedDuringVerification=None), dict(sourceHashes={}),
                          dict(sourceHashes={'src/lib.rs': self.receipt['sourceHashes']['src/lib.rs']})]:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                verify_source_receipt({**self.receipt, **overrides}, self.root)

    def test_build_outputs_are_excluded_but_new_tool_sources_are_included(self):
        output = self.root / 'tools/source-index/target/debug/index'
        output.parent.mkdir(parents=True)
        output.write_bytes(b'binary')
        verify_source_receipt(self.receipt, self.root)
        source = self.root / 'tools/source-index/src/main.rs'
        source.parent.mkdir()
        source.write_text('fn main() {}')
        with self.assertRaisesRegex(ValueError, 'main.rs'):
            verify_source_receipt(self.receipt, self.root)
