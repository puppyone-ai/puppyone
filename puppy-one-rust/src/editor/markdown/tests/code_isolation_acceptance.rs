//! Code ownership comes from the Markdown parser, including indented code.
use super::setup_with_focus;
use crate::editor::{
    markdown::{
        composition::FEATURES,
        core::syntax::{Kind, Syntax},
    },
    text::buffer::Buffer,
};
use gpui::TestAppContext;

#[gpui::test]
fn indented_code_keeps_custom_syntax_media_and_footnotes_literal(cx: &mut TestAppContext) {
    use crate::editor::{
        markdown::SetAssets, registry::DocumentAssets, view::extension::config_transaction,
    };
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let literal = "[[Note]] ~~gone~~ ==hot== %%comment%% ![[image.png]] $x$ [^code] :smile: &copy;";
    let source = format!(
        "    {literal}\n\nOutside [^outside]\n\n[^outside]: outside note\n\n[^code]: code note"
    );
    let syntax = Syntax::parse_with(&Buffer::new(&source), FEATURES);
    assert_eq!(syntax.code_lines.len(), 1);
    assert_eq!(syntax.code_lines[0], 0..1);
    let references: Vec<_> = syntax
        .elements
        .iter()
        .filter(|e| e.kind == Kind::FootnoteReference)
        .collect();
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].href.as_deref(), Some("outside"));
    assert_eq!(references[0].text.as_deref(), Some("1"));
    let reads = Arc::new(AtomicUsize::new(0));
    let observed = reads.clone();
    let (view, visual) = setup_with_focus(cx, &source, false);
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetAssets(Some(DocumentAssets {
                workspace: "indented-code-literal-acceptance".into(),
                document: "notes/note.md".into(),
                read: Arc::new(move |_| {
                    observed.fetch_add(1, Ordering::SeqCst);
                    None
                }),
            }))),
            cx,
        )
    });
    visual.run_until_parked();
    visual.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    visual.run_until_parked();
    view.read_with(visual, |v, _| {
        let first = &v.layout().unwrap().leaves[0].entry.text;
        assert_eq!(first.text.trim_start(), literal);
        assert!(
            first
                .marks
                .iter()
                .all(|(_, s)| s.link.is_none() && !s.strike && s.highlight.is_none())
        );
        assert!(
            v.decorations()
                .inline_widgets
                .iter()
                .all(|w| w.range.start >= source.find("Outside").unwrap())
        );
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
    assert_eq!(
        reads.load(Ordering::SeqCst),
        0,
        "literal code must not load media"
    );
}

#[test]
fn parser_code_ownership_handles_tabs_quotes_lists_and_paragraph_continuations() {
    for (source, line, code) in [
        ("\t[[Note]] ==literal== $x$", 0, true),
        (">     [[Note]] ==literal== $x$", 0, true),
        ("- item\n\n      [[Note]] ==literal== $x$", 2, true),
        ("> ```md\n> [[Note]] ==literal== $x$\n> ```", 1, true),
        ("paragraph\n    [[Note]] ==literal== $x$", 1, false),
    ] {
        let doc = Buffer::new(source);
        let syntax = Syntax::parse_with(&doc, FEATURES);
        assert_eq!(
            syntax.code_lines.iter().any(|r| r.contains(&line)),
            code,
            "{source:?}"
        );
        for kind in [Kind::WikiLink, Kind::Highlight, Kind::FeatureInline("math")] {
            assert_eq!(
                syntax.elements.iter().any(|e| e.kind == kind),
                !code,
                "{kind:?}: {source:?}"
            );
        }
    }
}

#[test]
fn indented_and_fenced_code_ranges_splice_independently_across_boundary_edits() {
    use crate::editor::text::{
        change::ChangeSet,
        state::{EditorState, Transaction, UserEvent},
    };
    let source = "before\n\n    [[Code]]\n\nparagraph\n\n```md\n[[Fence]]\n```\n\nafter\n\nguard one\n\nguard two\n\nguard three";
    let mut state = EditorState::new(source);
    let mut syntax = Syntax::parse_with(&state.doc, FEATURES);
    assert_eq!(syntax.code_lines, [2..3, 6..9]);
    for (needle, replacement) in [
        ("before", "前文\nnew prefix"),
        ("[[Code]]", "$x$ [[Code]]"),
        ("    $x$ [[Code]]", "$x$ [[Code]]"),
        ("$x$ [[Code]]", "    $x$ [[Code]]"),
        ("[[Fence]]", "[[Fence]]\n==literal=="),
        ("paragraph", "paragraph\nnew text"),
    ] {
        let at = state.doc.as_str().find(needle).unwrap();
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
        .expect("bounded code edit should splice");
        let full = Syntax::parse_with(&state.doc, FEATURES);
        assert_eq!(incremental, full, "edit {needle:?}");
        assert_eq!(
            full.code_lines.len(),
            if needle == "    $x$ [[Code]]" { 1 } else { 2 }
        );
        syntax = incremental;
    }
}
