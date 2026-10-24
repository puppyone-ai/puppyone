use super::*;

fn parse(text: &str) -> (Buffer, Syntax) {
    let doc = Buffer::new(text);
    let syntax = Syntax::parse(&doc);
    (doc, syntax)
}

fn kinds(s: &Syntax) -> Vec<(Kind, Span)> {
    s.elements.iter().map(|e| (e.kind, e.range.clone())).collect()
}

fn classes_at(s: &Syntax, offset: usize) -> Hl {
    s.highlights.iter().find(|(r, _)| r.contains(&offset)).map_or(Hl::NONE, |h| h.1)
}

#[test]
fn inline_elements_carry_marker_and_content_ranges() {
    let (_, s) = parse("a **b** *i* `c` [l](u) \\* ~~s~~ <http://x.y>");
    let strong = s.elements.iter().find(|e| e.kind == Kind::Strong).unwrap();
    assert_eq!((strong.markers.clone(), strong.content.clone()), (vec![2..4, 5..7], Some(4..5)));
    let code = s.elements.iter().find(|e| e.kind == Kind::InlineCode).unwrap();
    assert_eq!((code.range.clone(), code.content.clone()), (12..15, Some(13..14)));
    let link = s.elements.iter().find(|e| e.kind == Kind::Link && e.range.start == 16).unwrap();
    assert_eq!((link.markers.clone(), link.content.clone()), (vec![16..17, 18..19, 19..20, 21..22], Some(17..18)));
    let escape = s.elements.iter().find(|e| e.kind == Kind::Escape).unwrap();
    assert_eq!((escape.range.clone(), escape.markers.clone()), (23..25, vec![23..24]));
    let strike = s.elements.iter().find(|e| e.kind == Kind::Strike).unwrap();
    assert_eq!(strike.content, Some(28..29));
    let auto = s.elements.iter().find(|e| e.kind == Kind::Link && e.range.start == 32).unwrap();
    assert_eq!((auto.markers.clone(), auto.href.as_deref()), (vec![32..33, 43..44], Some("http://x.y")));
}

#[test]
fn highlight_classes_follow_lezer_style_tags() {
    let (_, s) = parse("- a **b** `c`\n\n> q\n\n# H\n");
    // List text inherits `list`; strong adds its class; marks are markup.
    assert_eq!(classes_at(&s, 2), Hl::LIST);
    assert_eq!(classes_at(&s, 4), Hl::LIST | Hl::STRONG | Hl::MARKUP);
    assert_eq!(classes_at(&s, 6), Hl::LIST | Hl::STRONG);
    assert_eq!(classes_at(&s, 0), Hl::LIST | Hl::MARKUP);
    // Inline code is not inherited: its marks are markup only.
    assert_eq!(classes_at(&s, 10), Hl::LIST | Hl::MARKUP);
    assert_eq!(classes_at(&s, 11), Hl::LIST | Hl::MONOSPACE);
    assert_eq!(classes_at(&s, 17), Hl::QUOTE);
    assert_eq!(classes_at(&s, 15), Hl::QUOTE | Hl::MARKUP);
    assert_eq!(classes_at(&s, 22), Hl::HEADING);
    assert_eq!(classes_at(&s, 20), Hl::HEADING | Hl::MARKUP);
}

#[test]
fn list_items_and_tasks_follow_the_parser_structure() {
    let text = "- one\n- two\n  - nested\n\n1. a\n10. b\n\n- [ ] t\n- [x] done\n\n> - quoted\n";
    let (doc, s) = parse(text);
    assert_eq!(s.lists.len(), 5);
    let nested = s.items.iter().find(|i| i.marker_from == 14).unwrap();
    assert_eq!((nested.parents.clone(), nested.indent_columns, nested.content_column), (vec![1], 2, 4));
    let ordered = &s.lists[2];
    assert!(ordered.ordered && ordered.columns == 3 && ordered.parent.is_none());
    let done = s.items.iter().find(|i| i.task.as_ref().is_some_and(|t| t.checked)).unwrap();
    let task = done.task.as_ref().unwrap();
    assert_eq!(&doc.as_str()[task.checkbox.clone()], "[x]");
    assert_eq!(&doc.as_str()[task.prefix_to..done.range.end], "done");
    assert_eq!(done.blocks[0].0, BlockKind::Task);
    let quoted = s.items.last().unwrap();
    assert!(quoted.quoted);
    // Elements: quoted items have none; tasks carry two markers.
    let task_el = s.elements.iter().find(|e| e.kind == Kind::Task && e.checked).unwrap();
    assert_eq!(task_el.markers.len(), 2);
    assert!(!s.elements.iter().any(|e| e.kind == Kind::List && e.range.start == quoted.range.start));
    // Tight items have one implicit paragraph each.
    let first = &s.items[0];
    assert_eq!(first.blocks, vec![(BlockKind::Paragraph, 2..5)]);
}

#[test]
fn block_elements_use_the_product_marker_ranges() {
    let (_, s) = parse("## Title\n\n> > nested\n\n---\n");
    let h = s.elements.iter().find(|e| e.kind == Kind::Heading).unwrap();
    assert_eq!((h.level, h.markers.clone(), h.content.clone()), (2, vec![0..3], Some(3..8)));
    let quotes: Vec<_> = s.elements.iter().filter(|e| e.kind == Kind::Blockquote).collect();
    assert_eq!(quotes[0].markers, vec![10..12]);
    let rule = kinds(&s).into_iter().find(|k| k.0 == Kind::Rule).unwrap();
    assert_eq!(rule.1, 22..25);
}

#[test]
fn sample_fixture_parses_every_construct() {
    let text = include_str!("../../../../../fixtures/editor/sample.md");
    let (_, s) = parse(text);
    let count = |k: Kind| s.elements.iter().filter(|e| e.kind == k).count();
    assert_eq!(count(Kind::Heading), 3);
    assert_eq!(count(Kind::List), 5);
    assert_eq!(count(Kind::Task), 2);
    assert_eq!(count(Kind::Blockquote), 1);
    assert_eq!(count(Kind::Rule), 1);
    assert_eq!(count(Kind::Strong), 2);
    assert_eq!(s.fences.len(), 1);
    assert!(s.paragraphs.iter().any(|p| p.item.is_none()));
}
