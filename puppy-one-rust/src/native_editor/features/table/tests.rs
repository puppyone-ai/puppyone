use crate::native_editor::core::document::{Document, Kind};
#[test]
fn table_paste_expands_atomically_and_serializes_escaped_cells() {
    let mut doc = Document::parse("| A | B |\n| --- | --- |\n| x | y |\n", true);
    assert!(doc.paste_table((0, 3), "中\t🐶\na|b\t*c*"));
    let source = doc.source();
    assert!(source.contains("a\\|b"));
    let parsed = Document::parse(&source, true);
    assert!(matches!(&parsed.blocks[0].kind,Kind::Table{rows,..} if rows[2][2].text=="*c*"));
    let before = doc.clone();
    assert!(!doc.paste_table((0, 0), &"x\t".repeat(25)));
    assert_eq!(doc, before);
}
