//! The page's inline Markdown policy must also run inside real native cells.
use super::setup_with_focus;
use crate::editor::view::decoration::Block;
use gpui::TestAppContext;

#[gpui::test]
fn table_html_tags_cannot_pair_across_neighboring_cells_or_rows(cx: &mut TestAppContext) {
    let source = "| Left | Right |\n| --- | --- |\n| <b>left | right</b> |\n| <i>open | <b>valid</b> |\n| end | </i>tail |\n\nafter";
    let (view, visual) = setup_with_focus(cx, source, false);
    visual.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.read_with(visual, |v, _| {
        let leaves = &v.layout().unwrap().leaves;
        for literal in ["<b>left", "right</b>", "<i>open", "</i>tail"] {
            assert!(
                leaves.iter().any(|leaf| leaf.entry.text.text == literal),
                "HTML cannot acquire an adjacent cell's closing tag: {literal:?}"
            );
        }
        assert!(
            leaves.iter().any(|leaf| leaf.entry.text.text == "valid"
                && leaf
                    .entry
                    .text
                    .marks
                    .iter()
                    .any(|(_, style)| style.bold && !style.italic)),
            "valid HTML inside one cell must remain styled independently"
        );
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn table_inline_delimiters_cannot_cross_cells_and_code_stays_literal(cx: &mut TestAppContext) {
    let source = concat!(
        "| Left | Right |\n| --- | --- |\n",
        "| [[Left | Right]] |\n",
        "| ==left | right== |\n",
        "| ~~left | right~~ |\n",
        "| [[broken | [[Note]] |\n",
        "| `[[Note]] ~~x~~ ==x== ![[image.png]]` | plain |\n\n",
        "`[[Note]] ~~x~~ ==x== ![[image.png]]`"
    );
    let (view, visual) = setup_with_focus(cx, source, false);
    visual.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.read_with(visual, |v, _| {
        let leaves = &v.layout().unwrap().leaves;
        for expected in [
            "[[Left", "Right]]", "==left", "right==", "~~left", "right~~", "[[broken",
        ] {
            assert!(
                leaves.iter().any(|leaf| leaf.entry.text.text == expected),
                "cell boundaries must preserve unmatched source: {expected}"
            );
        }
        assert!(
            leaves.iter().any(|leaf| {
                leaf.entry.text.text == "Note"
                    && leaf
                        .entry
                        .text
                        .marks
                        .iter()
                        .any(|(_, style)| style.link.as_deref() == Some("Note"))
            }),
            "an unmatched marker in the preceding cell must not swallow a valid link"
        );
        let code: Vec<_> = leaves
            .iter()
            .filter(|leaf| leaf.entry.text.text == "[[Note]] ~~x~~ ==x== ![[image.png]]")
            .collect();
        assert_eq!(
            code.len(),
            2,
            "both table and prose inline code stay literal"
        );
        assert!(code.iter().all(|leaf| {
            leaf.entry
                .text
                .marks
                .iter()
                .all(|(_, style)| style.link.is_none())
        }));
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[test]
fn table_inline_ranges_match_full_parse_after_prefix_and_cell_edits() {
    use crate::editor::{
        markdown::{composition::FEATURES, core::syntax::Syntax},
        text::{
            change::ChangeSet,
            state::{EditorState, Transaction, UserEvent},
        },
    };
    // The incremental parser intentionally uses a full parse below six
    // top-level blocks. Keep enough trailing blocks to exercise a splice.
    let source = "before\n\n| A | B |\n| --- | --- |\n| [[Note]] | ==yes== |\n\nafter\n\nlast\n\nguard one\n\nguard two\n\nguard three";
    let mut state = EditorState::new(source);
    let mut syntax = Syntax::parse_with(&state.doc, FEATURES);
    assert_eq!(syntax.table_cells.len(), 4);
    for (needle, replacement) in [
        ("before", "先に\nnew prefix"),
        ("Note", "Other"),
        ("yes", "是"),
        ("after", "after!"),
    ] {
        let text = state.doc.as_str();
        let at = text.find(needle).unwrap();
        let applied = state
            .apply(Transaction::edit(
                ChangeSet::replace(at..at + needle.len(), replacement),
                None,
                UserEvent::Input,
            ))
            .unwrap();
        let (incremental, _) = Syntax::try_parse_incremental(
            &state.doc,
            &applied.before_doc,
            &syntax,
            &applied.changes,
            FEATURES,
        )
        .expect("local table/prefix edit must retain bounded incremental parsing");
        let full = Syntax::parse_with(&state.doc, FEATURES);
        assert_eq!(
            incremental, full,
            "edit {needle:?} must shift or rebuild cell ranges"
        );
        assert_eq!(full.table_cells.len(), 4);
        syntax = incremental;
    }
}

#[gpui::test]
fn editing_table_wiki_links_updates_the_display_and_supports_undo_redo(cx: &mut TestAppContext) {
    use crate::editor::text::selection::Selection;
    let source = "before\n\n| Value |\n| --- |\n| [[Note]] |\n\nafter";
    let (view, visual) = super::setup(cx, source);
    let at = source.find("Note").unwrap() + "Note".len();
    view.update(visual, |v, cx| v.set_selection(Selection::cursor(at), cx));
    visual.simulate_input("2");
    for (key, expected_source, target) in [
        (None, source.replace("Note", "Note2"), "Note2"),
        (Some("secondary-z"), source.to_owned(), "Note"),
        (
            Some("secondary-shift-z"),
            source.replace("Note", "Note2"),
            "Note2",
        ),
    ] {
        if let Some(key) = key {
            visual.simulate_keystrokes(key);
        }
        view.update(visual, |v, cx| {
            v.set_selection(Selection::cursor(v.text().len()), cx);
        });
        visual.run_until_parked();
        visual.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.read_with(visual, |v, _| {
            assert_eq!(v.text(), expected_source);
            assert!(
                v.layout().unwrap().leaves.iter().any(|leaf| {
                    leaf.entry.text.text == target
                        && leaf
                            .entry
                            .text
                            .marks
                            .iter()
                            .any(|(_, style)| style.link.as_deref() == Some(target))
                }),
                "rendered link must follow the edited source after {key:?}"
            );
        });
    }
}

#[gpui::test]
fn table_cells_render_nested_marks_wiki_links_bare_urls_and_entities(cx: &mut TestAppContext) {
    for (cell, expected, marked, bold, italic, href) in [
        (
            "**bold *and italic***",
            "bold and italic",
            "and italic",
            true,
            true,
            None,
        ),
        (
            "see [[Note]] now",
            "see Note now",
            "Note",
            false,
            false,
            Some("Note"),
        ),
        (
            "see https://example.com",
            "see https://example.com",
            "https://example.com",
            false,
            false,
            Some("https://example.com"),
        ),
        ("a &copy; b", "a © b", "", false, false, None),
    ] {
        let source = format!("| Value |\n| --- |\n| {cell} |\n\nafter");
        let start = source.find(cell).unwrap();
        let (view, visual) = setup_with_focus(cx, &source, false);
        visual.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.read_with(visual, |v, _| {
            assert!(matches!(&v.decorations().blocks[0], Block::Widget { lines, .. } if *lines == (0..3)));
            let leaf = v.layout().unwrap().leaves.iter().find(|leaf| {
                leaf.source().start <= start && leaf.source().end >= start + cell.len()
            }).expect("rendered table body cell");
            assert_eq!(leaf.entry.text.text, expected, "{cell}");
            if !marked.is_empty() {
                assert!(leaf.entry.text.marks.iter().any(|(range, style)| {
                    &leaf.entry.text.text[range.clone()] == marked
                        && style.bold == bold && style.italic == italic
                        && style.link.as_deref() == href
                }), "missing rendered role for {marked:?}: {:?}", leaf.entry.text.marks);
            }
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}

#[gpui::test]
fn pathological_table_inline_source_stays_within_the_ts_acceptance_budget(cx: &mut TestAppContext) {
    let cell = "[".repeat(20_000);
    let source = format!("| Value |\n| --- |\n| {cell} |\n\nafter");
    let start = std::time::Instant::now();
    let (view, visual) = setup_with_focus(cx, &source, false);
    visual.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    assert!(
        start.elapsed() < std::time::Duration::from_secs(2),
        "20,000 unmatched brackets exceeded TS's two-second acceptance budget: {:?}",
        start.elapsed()
    );
    view.read_with(visual, |v, _| {
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|leaf| leaf.entry.text.text == cell)
        );
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn table_footnotes_participate_in_document_order_and_keep_inline_code_literal(
    cx: &mut TestAppContext,
) {
    let source = "| Value |\n| --- |\n| First[^b] and `[^a]` |\n\nNext[^a]\n\n[^a]: first note\n\n[^b]: second note";
    let (view, visual) = setup_with_focus(cx, source, false);
    visual.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.read_with(visual, |v, _| {
        let text = v
            .layout()
            .unwrap()
            .leaves
            .iter()
            .map(|leaf| leaf.entry.text.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("First1 and [^a]"), "{text:?}");
        assert!(text.contains("Next2"), "{text:?}");
        assert!(
            text.contains("2\u{2002} first note") && text.contains("1\u{2002} second note"),
            "{text:?}"
        );
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}
