//! Bare `<br>` line breaks and inline `font-weight`
//! (`markdownInlineHtml.test.ts` #11–#13, #18, `render-plan.test.ts` #1;
//! gap `markdown-inline-html-breaks-and-styles`).
use super::{setup, setup_with_focus};
use crate::editor::{
    markdown::{
        composition::FEATURES,
        core::{
            plans::{self, Atom, Presentation},
            syntax::{Kind, Syntax},
        },
    },
    text::{buffer::Buffer, selection::Selection},
    view::{EditorView, decoration::MarkStyle},
};
use gpui::{Entity, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update(|w, cx| w.draw(cx).clear(cx));
    }
}

fn leaves(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<(String, usize)> {
    draw(cx);
    view.read_with(cx, |v, _| {
        v.layout()
            .unwrap()
            .leaves
            .iter()
            .map(|l| (l.entry.text.text.to_string(), l.entry.rows))
            .collect()
    })
}

fn painted(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<(String, MarkStyle)> {
    draw(cx);
    view.read_with(cx, |v, _| {
        v.layout()
            .unwrap()
            .leaves
            .iter()
            .flat_map(|l| {
                l.entry
                    .text
                    .marks
                    .iter()
                    .map(|(r, s)| (l.entry.text.text[r.clone()].to_owned(), s.clone()))
            })
            .collect()
    })
}

/// #12 and `render-plan.test.ts` #1: a bare `<br>` compiles into an atomic
/// line-break atom deleted as a unit.
#[test]
fn a_bare_br_compiles_into_a_line_break_atom() {
    let source = "before<br>after";
    let doc = Buffer::new(source);
    let syntax = Syntax::parse_with(&doc, FEATURES);
    let (index, br) = syntax
        .elements
        .iter()
        .enumerate()
        .find(|(_, e)| e.kind == Kind::InlineHtml && e.html.as_ref().unwrap().name == "br")
        .expect("the br is an inline HTML element");
    assert_eq!(br.range, 6..10);
    let all = plans::compile(&doc, &syntax, &Default::default(), FEATURES);
    let plan = all.iter().find(|p| p.element == Some(index)).unwrap();
    assert!(matches!(&plan.presentation, Presentation::InlineAtom(Atom::Text(t)) if t == "\n"));
    assert_eq!(plan.delete_units, vec![6..10]);
}

/// #18: the br draws as a line break, atomic, and reveals its source.
#[gpui::test]
fn a_bare_br_draws_a_line_break_and_reveals_its_source(cx: &mut TestAppContext) {
    let source = "before<br>after";
    let (view, visual) = setup_with_focus(cx, source, false);
    let drawn = leaves(&view, visual);
    assert_eq!(drawn, vec![("before\nafter".to_owned(), 2)]);
    assert!(view.update(visual, |v, _| v.decorations().atomic.contains(&(6..10))));
    // Control: the same text with a space draws one row.
    let (other, visual2) = setup_with_focus(cx, "before after", false);
    assert_eq!(
        leaves(&other, visual2),
        vec![("before after".to_owned(), 1)]
    );
    // A caret on the tag reveals it.
    let (view, visual) = setup(cx, source);
    view.update_in(visual, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(8), cx);
    });
    assert_eq!(leaves(&view, visual), vec![(source.to_owned(), 1)]);
}

/// #11 and #13: an inline `style` keeps its presentation subset, including
/// `font-weight`; inline surfaces get no layout styles.
#[gpui::test]
fn inline_style_font_weight_applies(cx: &mut TestAppContext) {
    let source = "<span style=\"color: #B45309; font-weight: 700\">text</span>";
    let syntax = Syntax::parse_with(&Buffer::new(source), FEATURES);
    let tag = syntax
        .elements
        .iter()
        .find_map(|e| e.html.as_deref())
        .unwrap_or_else(|| panic!("{:?} {:?}", syntax.elements, syntax.inline_tags));
    assert_eq!(
        (tag.color.as_deref(), tag.weight.as_deref()),
        (Some("#B45309"), Some("700"))
    );
    let (view, visual) = setup_with_focus(cx, source, false);
    let marks = painted(&view, visual);
    let text = marks
        .iter()
        .find(|(t, _)| t == "text")
        .unwrap_or_else(|| panic!("{marks:?}"));
    assert!(text.1.bold && text.1.color.is_some(), "{text:?}");
    // Control: a light weight is not bold.
    let (view, visual) =
        setup_with_focus(cx, "<span style=\"font-weight: 300\">text</span>", false);
    let marks = painted(&view, visual);
    assert!(
        !marks.iter().any(|(t, m)| t == "text" && m.bold),
        "{marks:?}"
    );
}
