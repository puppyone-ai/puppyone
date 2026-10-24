use super::*;
#[test]
fn enter_splits_heading_and_backspace_joins_paragraph_without_losing_marks() {
    let mut d = Document::parse("# Hello **world**\n\nNext\n", true);
    d.replace_visible(5..5, Text::plain("\n"), false);
    assert!(matches!(d.blocks[1].kind, Kind::Text(Style::Paragraph, _)));
    assert_eq!(Projection::new(&d).text.text, "Hello\n world\nNext");
    d.replace_visible(5..6, Text::default(), false);
    assert_eq!(Projection::new(&d).text.text, "Hello world\nNext");
    assert!(d.source().contains("**world**"));
}
#[test]
fn cross_paragraph_unicode_replacement_preserves_surrounding_document() {
    let mut d = Document::parse("# Intro\n\nHello 中🐶\n\nWorld **tail**\n\nFinal\n", true);
    let p = Projection::new(&d);
    let a = p.text.text.find('中').unwrap();
    let b = p.text.text.find("tail").unwrap();
    d.replace_visible(a..b, Text::plain("你好 "), false);
    assert_eq!(
        Projection::new(&d).text.text,
        "Intro\nHello 你好 tail\nFinal"
    );
    assert!(d.source().contains("**tail**"));
    assert!(d.source().starts_with("# Intro\n"));
}
#[test]
fn list_enter_continues_then_empty_enter_exits() {
    let mut d = Document::parse("- [x] Done\n", true);
    d.replace_visible(4..4, Text::plain("\n"), false);
    assert!(d.source().contains("- [ ] "));
    let caret = d.replace_visible(5..5, Text::plain("\n"), false);
    assert!(matches!(d.blocks[1].kind, Kind::Text(Style::Paragraph, _)));
    assert_eq!(caret, 5);
}
#[test]
fn cross_cell_deletion_preserves_grid_and_remaining_cells() {
    let mut d = Document::parse("| Alpha | Beta |\n| --- | --- |\n| One | Two |\n", true);
    let p = Projection::new(&d);
    d.replace_visible(2..p.spans[2].range.start + 1, Text::plain("X"), false);
    assert_eq!(Projection::new(&d).text.text, "AlX\t\nne\tTwo");
    assert!(
        matches!(&d.blocks[0].kind, Kind::Table { rows, align } if rows.len()==2 && align.len()==2)
    );
}
#[test]
fn select_all_replaces_document_and_keeps_reference_definitions() {
    let mut d = Document::parse(
        "# Title\n\n[ref]: /target\n\n| A | B |\n| --- | --- |\n| C | D |\n",
        true,
    );
    let len = Projection::new(&d).text.text.len();
    d.replace_visible(0..len, Text::plain("New\nDocument"), false);
    assert_eq!(Projection::new(&d).text.text, "New\nDocument");
    assert!(d.source().contains("[ref]: /target"));
}
#[test]
fn formatting_applies_across_paragraphs_and_softbreak_stays_in_heading() {
    let mut d = Document::parse("# First\n\nSecond\n", true);
    d.toggle_visible(0..12, true);
    assert!(d.source().contains("**Second**"));
    d.replace_visible(5..5, Text::plain("\nline"), true);
    assert_eq!(d.blocks.len(), 2);
    assert_eq!(Projection::new(&d).text.text, "First\nline\nSecond");
}
#[test]
fn typed_markdown_prefix_becomes_visual_heading_without_dirtying_other_blocks() {
    let mut d = Document::parse("", true);
    d.replace_visible(0..0, Text::plain("## "), false);
    assert_eq!(d.shortcut(3), 0);
    d.replace_visible(0..0, Text::plain("标题"), false);
    assert!(d.source().contains("## 标题"));
}
#[test]
fn typed_emphasis_and_task_prefixes_hide_syntax_but_keep_markdown() {
    let mut d = Document::parse("", true);
    d.replace_visible(0..0, Text::plain("**bold*"), false);
    assert_eq!(d.shortcut(7), 7);
    d.replace_visible(7..7, Text::plain("*"), false);
    assert_eq!(d.shortcut(8), 4);
    assert_eq!(Projection::new(&d).text.text, "bold");
    assert_eq!(d.source(), "**bold**");
    let mut d = Document::parse("- ", true);
    d.replace_visible(0..0, Text::plain("[ ] "), false);
    assert_eq!(d.shortcut(4), 0);
    assert!(
        matches!(&d.blocks[0].kind, Kind::List { items, .. } if items[0].checked == Some(false))
    );
}
#[test]
fn fenced_code_enter_and_empty_list_exit_keep_caret_at_edit_site() {
    let mut d = Document::parse("", true);
    d.replace_visible(0..0, Text::plain("```rust"), false);
    assert_eq!(d.replace_visible(7..7, Text::plain("\n"), false), 0);
    assert!(matches!(&d.blocks[0].kind, Kind::Code { language, .. } if language=="rust"));
    let mut d = Document::parse("- one\n- \n- three\n", true);
    assert_eq!(d.replace_visible(4..4, Text::plain("\n"), false), 4);
    assert_eq!(Projection::new(&d).text.text, "one\n\nthree");
}
