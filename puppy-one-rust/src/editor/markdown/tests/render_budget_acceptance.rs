//! Soft render budgets (`markdownOversizedBlocks.test.ts` #11–#12; gap
//! `markdown-soft-budget-deferred-preview`): an HTML block over its rich
//! budget waits behind a `Render preview` card, a large Mermaid diagram
//! waits to be rendered, and a code fence over the code budget stays source.
use super::{setup, setup_with_focus};
use crate::editor::{
    markdown::{MarkdownExtension, core::plans::Presentation, features::mermaid::MermaidBlock},
    view::{EditorView, decoration::Block},
};
use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    for _ in 0..3 {
        cx.run_until_parked();
        cx.update(|w, cx| w.draw(cx).clear(cx));
    }
}

fn widgets(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> usize {
    draw(cx);
    view.update(cx, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .filter(|b| matches!(b, Block::Widget { .. }))
            .count()
    })
}

/// #11: a soft-over-budget HTML subtree waits for explicit activation.
#[gpui::test]
fn a_soft_over_budget_html_block_waits_for_activation(cx: &mut TestAppContext) {
    let source = std::iter::once("<div>".to_owned())
        .chain((0..450).map(|i| format!("<p>paragraph {i}</p>")))
        .chain(std::iter::once("</div>".to_owned()))
        .collect::<Vec<_>>()
        .join("\n");
    let (view, visual) = setup_with_focus(cx, &source, false);
    assert_eq!(widgets(&view, visual), 1);
    let card = visual
        .debug_bounds("md-html-deferred")
        .expect("the paused card");
    assert!(visual.debug_bounds("md-html-rendered-surface").is_none());
    let button = visual.debug_bounds("md-html-deferred-load").unwrap();
    assert!(card.size.height > gpui::px(0.));
    visual.simulate_click(button.center(), Modifiers::none());
    draw(visual);
    assert!(visual.debug_bounds("md-html-deferred").is_none());
    assert!(visual.debug_bounds("md-html-rendered-surface").is_some());
    assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), source);
    // Control: a small block renders at once.
    let (_, visual) = setup_with_focus(cx, "<div>\n<p>one</p>\n</div>", false);
    draw(visual);
    assert!(visual.debug_bounds("md-html-deferred").is_none());
    assert!(visual.debug_bounds("md-html-rendered-surface").is_some());
}

/// #12: a large Mermaid diagram waits to be rendered, and a code fence over
/// 512 lines stays source instead of a code widget.
#[gpui::test]
fn a_large_diagram_waits_and_a_long_fence_stays_source(cx: &mut TestAppContext) {
    let mermaid = std::iter::once("```mermaid".to_owned())
        .chain(std::iter::once("graph TD".to_owned()))
        .chain((0..1_050).map(|i| format!("A{i} --> A{}", i + 1)))
        .chain(std::iter::once("```".to_owned()))
        .collect::<Vec<_>>()
        .join("\n");
    let (view, visual) = setup_with_focus(cx, &mermaid, false);
    draw(visual);
    let deferred = view.update(visual, |v, _| {
        let state = v.state().clone();
        let md = v.extension_mut::<MarkdownExtension>().unwrap();
        let (_, plans) = md.parse(&state);
        plans
            .iter()
            .find_map(|p| p.embed()?.model::<MermaidBlock>().map(|b| b.deferred))
    });
    assert_eq!(deferred, Some(true));

    let code = |lines: usize| {
        std::iter::once("```text".to_owned())
            .chain((0..lines).map(|i| format!("line {i}")))
            .chain(std::iter::once("```".to_owned()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let long = code(513);
    let (view, visual) = setup(cx, &long);
    assert_eq!(widgets(&view, visual), 0, "no code widget");
    let fallback = view.update(visual, |v, _| {
        let state = v.state().clone();
        let md = v.extension_mut::<MarkdownExtension>().unwrap();
        let (_, plans) = md.parse(&state);
        plans.iter().any(|p| {
            matches!(
                p.presentation,
                Presentation::SourceFallback {
                    code: "codeBlock.render-budget"
                }
            )
        })
    });
    assert!(fallback);
    assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), long);
    // Control: a fence within the budget is a code widget.
    let (view, visual) = setup(cx, &code(20));
    assert_eq!(widgets(&view, visual), 1);
}
