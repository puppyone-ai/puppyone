use super::parse::parse_kind;
use crate::native_editor::core::{
    document::{Document, Kind, Style},
    text::{Mark, Text},
};
use pulldown_cmark::Parser;

#[test]
fn empty_markdown_starts_rich_and_heading_line_breaks_are_not_lost() {
    let empty = Document::parse("", true);
    assert!(matches!(
        empty.blocks[0].kind,
        Kind::Text(Style::Paragraph, _)
    ));
    assert_eq!(empty.source(), "");
    let mut heading = Document::parse("# Title\n", true);
    *heading.text_mut((0, 0)).unwrap() = Text::plain("First\nSecond");
    let parsed = Document::parse(&heading.source(), true);
    assert_eq!(parsed.blocks[0].kind.texts()[0].text, "First\nSecond");
}
#[test]
fn untouched_markdown_is_byte_exact_and_unknown_syntax_is_source() {
    let samples = [
        "# Title\n\nHello **bold** and *italic*.\n",
        "---\ntitle: frontmatter\n---\n\n[link](https://example.com) ![image](a.png)\n\n<Thing foo={1} />\n",
        "- [ ] task\n- [x] done\n\n> quote\n",
        "| a | b |\n| :--- | ---: |\n| 中🐶 | **bold** |\n",
        "```rust\nlet x=1;\n```\n\n$$a+b$$\n",
        "- nested\n  - child\n\n[a]: https://example.com\n\n[a]\n",
        "\n\n",
        "    code\n\n",
        "before  \nafter\n\n***\n",
    ];
    for source in samples {
        let doc = Document::parse(source, true);
        assert_eq!(doc.source(), source, "{source}");
    }
    let doc = Document::parse("[link](url)\n", true);
    assert!(matches!(doc.blocks[0].kind, Kind::Raw(_)));
}
#[test]
fn rich_blocks_parse_marks_lists_code_and_table() {
    let doc = Document::parse(
        "# Title\n\nA **bold** and *italic*.\n\n- [ ] task\n- [x] done\n\n| a | b |\n| --- | --- |\n| x | y |\n\n```rs\ncode\n```\n",
        true,
    );
    assert!(matches!(
        doc.blocks[0].kind,
        Kind::Text(Style::Heading(1), _)
    ));
    assert!(doc.blocks[1].kind.texts()[0].marks.iter().any(|m| m.bold));
    assert!(
        matches!(&doc.blocks[2].kind,Kind::List{items,..} if items.len()==2&&items[1].checked==Some(true))
    );
    assert!(matches!(&doc.blocks[3].kind,Kind::Table{rows,..} if rows.len()==2));
    assert!(matches!(&doc.blocks[4].kind,Kind::Code{language,..} if language=="rs"));
}
#[test]
fn editing_one_block_preserves_references_and_unsupported_neighbors() {
    let source = "<Widget />\n\n# Old\n\n[ref]: /target \"title\"\n\n[ref]\n";
    let mut doc = Document::parse(source, true);
    *doc.text_mut((1, 0)).unwrap() = Text::plain("New 中🐶");
    assert_eq!(doc.source(), source.replace("# Old", "# New 中🐶"));
}

#[test]
fn deleting_a_block_preserves_reference_definitions_in_its_leading_gap() {
    let source = "Before\n\n[ref]: /target\n\n# Remove\n\n[ref]\n";
    let mut doc = Document::parse(source, true);
    doc.remove_block(1);
    assert!(doc.source().contains("[ref]: /target"));
    assert!(!doc.source().contains("# Remove"));
    assert!(doc.source().ends_with("[ref]\n"));
}

#[test]
fn multiline_table_cell_roundtrips_without_splitting_the_table() {
    let mut doc = Document::parse("| A | B |\n| --- | --- |\n| x | y |\n", true);
    *doc.text_mut((0, 2)).unwrap() = Text::plain("one\ntwo");
    let parsed = Document::parse(&doc.source(), true);
    assert!(matches!(&parsed.blocks[0].kind,Kind::Table{rows,..} if rows[1][0].text=="one\ntwo"));
}
#[test]
fn edited_code_uses_a_fence_that_cannot_be_closed_by_content() {
    let mut doc = Document::parse("```rust\na\n```\n", true);
    *doc.text_mut((0, 0)).unwrap() = Text::plain("```\ncontent\n");
    let result = Document::parse(&doc.source(), true);
    assert!(matches!(&result.blocks[0].kind,Kind::Code{text,..} if text.text=="```\ncontent\n"));
}
#[test]
fn rich_projection_roundtrips_unicode_punctuation_and_marks() {
    for value in ["hello world", "中文🐶", "a*b & <c> | d", "plain\nnext"] {
        for bold in [false, true] {
            for italic in [false, true] {
                let mut text = Text::plain(value);
                for mark in &mut text.marks {
                    *mark = Mark { bold, italic };
                }
                let source = text.markdown();
                let events: Vec<_> = Parser::new(&source).collect();
                let Kind::Text(_, parsed) = parse_kind(&events).unwrap() else {
                    panic!()
                };
                assert_eq!(parsed.text, text.text);
                for (c, m) in parsed.text.chars().zip(parsed.marks) {
                    if !c.is_whitespace() {
                        assert_eq!(m, Mark { bold, italic }, "{value}");
                    }
                }
            }
        }
    }
}

#[test]
fn adjacent_mark_transitions_roundtrip_without_literal_delimiters() {
    for value in ["abc", "中🐶文", "a*b", "a b"] {
        for pattern in 0..64 {
            let mut text = Text::plain(value);
            for (n, mark) in text.marks.iter_mut().enumerate() {
                *mark = Mark {
                    bold: pattern & (1 << (n * 2)) != 0,
                    italic: pattern & (2 << (n * 2)) != 0,
                };
            }
            let source = text.markdown();
            let events: Vec<_> = Parser::new(&source).collect();
            let Kind::Text(_, parsed) = parse_kind(&events).unwrap() else {
                panic!("{source}")
            };
            assert_eq!(parsed.text, text.text, "{source}");
            for ((c, a), b) in text.text.chars().zip(text.marks).zip(parsed.marks) {
                if !c.is_whitespace() {
                    assert_eq!(a, b, "{source}");
                }
            }
        }
    }
}
