//! Explicit inline HTML ids as in-page fragment targets
//! (`markdownFragmentTargets.test.ts` #0–#15, `markdownHtmlRun.test.ts` #29,
//! #66, #73, `markdownHtmlConformance.test.ts` #0–#3,
//! `markdownHtmlAnchors.test.ts` #0–#11, `markdownLinkActivation.test.ts`
//! #0, #1, #3–#5; gap `markdown-html-id-fragment-targets`).
use super::{MarkdownExtension, setup, setup_with_focus};
use crate::editor::{
    markdown::{
        composition::FEATURES,
        core::{
            links::headings::Headings,
            plans::{self, Presentation},
            syntax::{Kind, Syntax},
        },
        features::html::{
            sanitize::{Element, Node},
            structure::{self, Parsed},
        },
    },
    text::{
        buffer::Buffer,
        change::ChangeSet,
        selection::Selection,
        state::{EditorState, Transaction, UserEvent},
    },
    view::{EditorView, extension::LinkAction},
};
use gpui::{Entity, TestAppContext, VisualTestContext};

fn position(source: &str, key: &str) -> Option<usize> {
    let doc = Buffer::new(source);
    Headings::from_syntax(&doc, &Syntax::parse_with(&doc, FEATURES)).get(key)
}

fn draw(cx: &mut VisualTestContext) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update(|w, cx| w.draw(cx).clear(cx));
    }
}

fn shown(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> String {
    draw(cx);
    view.read_with(cx, |v, _| {
        v.layout()
            .unwrap()
            .leaves
            .iter()
            .map(|l| l.entry.text.text.to_string())
            .collect::<Vec<_>>()
            .join("\n")
    })
}

/// What following `href` in `view` does.
fn follow(view: &Entity<EditorView>, cx: &mut VisualTestContext, href: &str) -> Option<LinkAction> {
    view.update(cx, |v, _| {
        let state: EditorState = v.state().clone();
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .link_action(&state, href, false)
    })
}

fn sanitized(source: &str, tag: &str) -> Element {
    let Parsed::Complete(nodes) = structure::parse(source) else {
        panic!("{source}")
    };
    let mut pending: Vec<&Node> = nodes.iter().collect();
    while let Some(node) = pending.pop() {
        if let Node::Element(e) = node {
            if e.tag == tag {
                return e.clone();
            }
            pending.extend(&e.children);
        }
    }
    panic!("no <{tag}>")
}

/// Fragments #0–#2: controlled inline HTML ids resolve.
#[test]
fn controlled_inline_html_ids_resolve() {
    for source in [
        "<a id=\"target\"></a>",
        "<a id=target></a>",
        "<span id=\"target\">text</span>",
    ] {
        assert_eq!(
            position(&format!("Before {source}"), "#target"),
            Some(7),
            "{source}"
        );
    }
}

/// Fragments #3–#9, anchors #7–#9: literal, incomplete or unsupported HTML
/// registers nothing.
#[test]
fn literal_incomplete_or_unsupported_html_registers_nothing() {
    for source in [
        "`<a id=\"target\"></a>`",
        "```html\n<a id=\"target\"></a>\n```",
        "<!-- <a id=\"target\"></a> -->",
        "Text \\<a id=\"target\"></a>",
        "<a id=target><a>",
        "<a id=target href=\"javascript:alert(1)\"></a>",
        "<a id=\"target other\"></a>",
    ] {
        assert_eq!(position(source, "#target"), None, "{source}");
    }
    // Control: the same anchor in prose registers.
    assert_eq!(position("<a id=\"target\"></a>", "#target"), Some(0));
}

/// Fragments #10, anchors #11: a fragment decodes once, ids keep their case,
/// the first duplicate wins, and a malformed escape names nothing.
#[test]
fn fragments_decode_once_and_ids_keep_their_case() {
    let source = "Before <a id=\"Tar&#103;et\"></a>\n\n<a id=\"Target\"></a>";
    assert_eq!(position(source, "#Tar%67et"), Some(7));
    assert_eq!(position(source, "#target"), None);
    assert_eq!(position(source, "#%Target"), None);
    let source = "# Section\n\n<a id=\"Section\"></a>\n\n<a id=\"Section\"></a>\n\n# Other";
    assert_eq!(position(source, "#%53ection"), source.find("<a"));
    assert_eq!(position(source, "#section"), Some(2));
    assert_eq!(position(source, "#other"), source.find("Other"));
    assert_eq!(position(source, "#%ZZ"), None);
}

/// Fragments #11: an explicit id wins over a heading slug; headings remain.
#[test]
fn explicit_ids_win_over_heading_slugs() {
    let source = "# target\n\n<a id=\"target\"></a>\n\n# Other heading";
    assert_eq!(position(source, "#target"), source.find("<a"));
    assert_eq!(
        position(source, "#other-heading"),
        source.find("Other heading")
    );
}

/// Fragments #12, anchors #10: lookups are local to each document and follow
/// edits to positions and ids.
#[gpui::test]
fn targets_are_per_document_and_follow_edits(cx: &mut TestAppContext) {
    let source = "<a id=\"section\"></a>\n\nBody";
    // Each document has its own targets.
    assert_eq!(position(&format!("Other\n\n{source}"), "#section"), Some(7));
    let (first, visual) = setup(cx, source);
    assert_eq!(
        follow(&first, visual, "#section"),
        Some(LinkAction::Position(0))
    );
    // A selection-only change keeps the target where it is.
    first.update(visual, |v, cx| v.set_selection(Selection::cursor(3), cx));
    assert_eq!(
        follow(&first, visual, "#section"),
        Some(LinkAction::Position(0))
    );
    first.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(0..0, "Before\n\n"),
                None,
                UserEvent::Input,
            ),
            cx,
        )
    });
    assert_eq!(
        follow(&first, visual, "#section"),
        Some(LinkAction::Position(8))
    );
    let id = first.read_with(visual, |v, _| v.text().find("section").unwrap());
    first.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(id..id + 7, "renamed"),
                None,
                UserEvent::Input,
            ),
            cx,
        )
    });
    assert_eq!(follow(&first, visual, "#section"), None);
    assert_eq!(
        follow(&first, visual, "#renamed"),
        Some(LinkAction::Position(8))
    );
    // The other document is untouched.
    assert_eq!(position(&format!("Other\n\n{source}"), "#section"), Some(7));
}

/// Fragments #13: after a distant edit the target moves with its text and
/// only the edited block is parsed again.
#[test]
fn a_distant_edit_reparses_only_its_block_and_moves_the_target() {
    let source: String = (0..100)
        .map(|i| format!("Block {i} <a id=\"anchor-{i}\"></a>"))
        .collect::<Vec<_>>()
        .join("\n\n");
    let before = Buffer::new(source.clone());
    let syntax = Syntax::parse_with(&before, FEATURES);
    assert_eq!(
        Headings::from_syntax(&before, &syntax).get("#anchor-99"),
        source.rfind("<a")
    );
    let mut after = before.clone();
    let change = ChangeSet::replace(0..0, "Prefix ");
    after.replace(0..0, "Prefix ");
    let (next, splice) = Syntax::try_parse_incremental(&after, &before, &syntax, &change, FEATURES)
        .expect("a one-block edit patches incrementally");
    assert!(splice.new_lines.len() < 10, "{splice:?}");
    assert_eq!(
        Headings::from_syntax(&after, &next).get("#anchor-99"),
        source.rfind("<a").map(|p| p + 7)
    );
}

/// Fragments #14: a target inside what becomes a code fence disappears.
#[test]
fn a_target_turned_into_code_disappears() {
    assert_eq!(position("<a id=\"target\"></a>", "#target"), Some(0));
    assert_eq!(
        position("```html\n<a id=\"target\"></a>\n```", "#target"),
        None
    );
}

/// Fragments #15: an empty anchor is one hidden marker and one deletion unit.
#[test]
fn an_empty_anchor_is_one_hidden_deletion_unit() {
    let anchor = "<a id=\"target\"></a>";
    let source = format!("Before {anchor} after");
    let doc = Buffer::new(source.clone());
    let syntax = Syntax::parse_with(&doc, FEATURES);
    let index = syntax
        .elements
        .iter()
        .position(|e| e.kind == Kind::InlineHtml)
        .unwrap();
    let plan = plans::compile(&doc, &syntax, &Default::default(), FEATURES)
        .into_iter()
        .find(|p| p.element == Some(index))
        .unwrap();
    let range = 7..7 + anchor.len();
    assert!(
        matches!(&plan.presentation, Presentation::InlineMark { markers, .. } if *markers == vec![range.clone()])
    );
    assert_eq!(plan.delete_units, vec![range]);
}

/// Run #29, conformance #0–#1, anchors #0–#1: valid empty anchors (and a
/// legacy named one) hide in preview without changing their source.
#[gpui::test]
fn empty_anchors_hide_without_changing_their_source(cx: &mut TestAppContext) {
    for anchor in ["<a id=\"target\"></a>", "<a id=target></a>"] {
        let source = format!("Before {anchor} after");
        let (view, visual) = setup_with_focus(cx, &source, false);
        assert_eq!(shown(&view, visual), "Before  after");
        assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), source);
    }
    let (view, visual) = setup_with_focus(cx, "<a name=\"top\"></a>\n\nBody", false);
    assert_eq!(shown(&view, visual).trim(), "Body");
    assert_eq!(position("<a name=\"top\"></a>\n\nBody", "#top"), Some(0));
}

/// Conformance #2, anchors #3–#5: incomplete or unsupported anchors stay
/// visible source and are no targets.
#[gpui::test]
fn incomplete_or_unsupported_anchors_stay_source(cx: &mut TestAppContext) {
    for anchor in [
        "<a id=section><a>",
        "<a id=section>",
        "<a id=section href=\"javascript:alert(1)\"></a>",
    ] {
        let source = format!("{anchor}\n\nBody");
        let (view, visual) = setup_with_focus(cx, &source, false);
        assert!(shown(&view, visual).contains(anchor), "{anchor}");
        assert_eq!(follow(&view, visual, "#section"), None, "{anchor}");
    }
}

/// Conformance #3, anchors #2: an anchor reveals for editing and folds again.
#[gpui::test]
fn an_anchor_reveals_for_editing_and_folds_again(cx: &mut TestAppContext) {
    let source = "Before <a id=\"target\"></a> after";
    let (view, visual) = setup(cx, source);
    view.update_in(visual, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(source.len()), cx);
    });
    assert_eq!(shown(&view, visual), "Before  after");
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.find("target").unwrap() + 1), cx)
    });
    assert_eq!(shown(&view, visual), source);
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    assert_eq!(shown(&view, visual), "Before  after");
    assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), source);
}

/// Anchors #6, activation #0, #3–#5: `[Jump](#target)`, `[[#target]]` and
/// `<a href="#target">` reach an explicit target, moving only the view.
#[gpui::test]
fn links_reach_an_explicit_target(cx: &mut TestAppContext) {
    for (link, wiki) in [
        ("[Jump](#target)", false),
        ("[[#target]]", true),
        ("<a href=\"#target\">Jump</a>", false),
    ] {
        let source = format!("{link}\n\n<a id=\"target\"></a>\n\nBody");
        let (view, visual) = setup_with_focus(cx, &source, false);
        let action = view.update(visual, |v, _| {
            let state = v.state().clone();
            v.extension_mut::<MarkdownExtension>()
                .unwrap()
                .link_action(&state, "#target", wiki)
        });
        assert_eq!(
            action,
            Some(LinkAction::Position(source.rfind("<a id=").unwrap())),
            "{link}"
        );
        assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), source);
    }
}

/// Activation #1: a link's target disappears when its id is renamed and
/// returns when it is restored.
#[gpui::test]
fn a_renamed_target_is_unavailable_until_restored(cx: &mut TestAppContext) {
    let source = "[Jump](#target)\n\nUnrelated paragraph\n\nMore body\n\n<a id=\"target\"></a>";
    let (view, visual) = setup(cx, source);
    let from = source.find("id=\"target\"").unwrap() + 4;
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(from..from + 6, "renamed"),
                None,
                UserEvent::Input,
            ),
            cx,
        )
    });
    assert_eq!(follow(&view, visual, "#target"), None);
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(from..from + 7, "target"),
                None,
                UserEvent::Input,
            ),
            cx,
        )
    });
    assert!(follow(&view, visual, "#target").is_some());
}

/// Run #66, #73: a legacy anchor name becomes its id; an explicit id wins.
#[test]
fn a_legacy_anchor_name_is_its_id_unless_an_id_is_given() {
    assert_eq!(
        sanitized("<div><a name=\"top\">x</a></div>", "a").attribute("id"),
        Some("top")
    );
    assert_eq!(
        sanitized("<div><a id=\"real\" name=\"legacy\">x</a></div>", "a").attribute("id"),
        Some("real")
    );
}
