//! MDX Tabs in a live `.mdx` pane (`markdownMdxComponent.test.ts`): the
//! tabs switch by pointer without touching the source, labels are text,
//! and the source toggle reveals the component where it is now.
use super::super::{MarkdownExtension, features::mdx};
use crate::{
    editor::{
        text::selection::Selection,
        view::{EditorView, bind_keys, decoration::Block, style},
    },
    typography::Scale,
};
use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

/// The product fixture: indented tabs, blank lines, a single-quoted label.
const TABS: &str = "<Tabs>\n  <Tab label=\"Tab 1\">\n\n  First **panel**\n  </Tab>\n\n  <Tab label='Tab 2'>\n\n  Second panel\n  </Tab>\n</Tabs>";

fn setup<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let text = text.to_owned();
    let (view, cx) = cx.add_window_view(move |_, cx| {
        EditorView::new(
            &text,
            Box::new(MarkdownExtension::new(true, Scale::Medium).mdx()),
            cx,
        )
    });
    view.update_in(cx, |v, w, cx| v.focus(w, cx));
    draw(cx);
    (view, cx)
}

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn click(cx: &mut VisualTestContext, selector: &str) {
    let bounds = cx
        .debug_bounds(Box::leak(selector.to_owned().into_boxed_str()))
        .unwrap_or_else(|| panic!("{selector}"));
    cx.simulate_click(bounds.center(), Modifiers::default());
    draw(cx);
}

fn shown(cx: &mut VisualTestContext, label: &str) -> bool {
    let selector = format!("md-mdx-tab:{label}:shown");
    cx.debug_bounds(Box::leak(selector.into_boxed_str()))
        .is_some()
}

fn widgets(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> usize {
    view.read_with(cx, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .filter(|b| matches!(b, Block::Widget { .. }))
            .count()
    })
}

/// `renders accessible tabs and switches panels without changing source`.
#[gpui::test]
fn a_tab_shows_by_pointer_without_changing_the_source(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, TABS);
    assert_eq!(widgets(&view, cx), 1);
    assert!(shown(cx, "Tab 1"));
    assert!(cx.debug_bounds("md-mdx-tab:Tab 2:hidden").is_some());

    click(cx, "md-mdx-tab:Tab 2:hidden");
    assert!(shown(cx, "Tab 2"));
    assert!(cx.debug_bounds("md-mdx-tab:Tab 1:hidden").is_some());
    view.read_with(cx, |v, _| {
        let md = v.extension::<MarkdownExtension>().unwrap();
        let state = md.preview.state::<mdx::TabsState>(mdx::ID).unwrap();
        assert_eq!(state.get(0), 1);
        assert_eq!(v.text(), TABS);
    });
}

/// `renders authored labels as text rather than executable markup`.
#[gpui::test]
fn a_markup_label_shows_as_its_text(cx: &mut TestAppContext) {
    let (view, cx) = setup(
        cx,
        r#"<Tabs><Tab label="<img src=x onerror=alert(1)>">safe</Tab></Tabs>"#,
    );
    assert_eq!(widgets(&view, cx), 1);
    assert!(shown(cx, "<img src=x onerror=alert(1)>"));
}

/// `reveals the mapped canonical source after edits before the widget`.
#[gpui::test]
fn the_source_toggle_reveals_the_component_where_it_is_after_an_edit_above(
    cx: &mut TestAppContext,
) {
    let initial = format!("intro\n\n{TABS}");
    let (view, cx) = setup(cx, &initial);
    assert_eq!(widgets(&view, cx), 1);

    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(0), cx));
    cx.simulate_input("shifted\n");
    draw(cx);
    click(cx, "md-mdx-source");

    view.read_with(cx, |v, _| {
        let from = v.text().find("<Tabs>").unwrap();
        let md = v.extension::<MarkdownExtension>().unwrap();
        assert_eq!(md.preview.revealed_source, Some(from..from + TABS.len()));
        assert_eq!(&v.text()[from..from + TABS.len()], TABS);
    });
    assert_eq!(widgets(&view, cx), 0, "the revealed component is source");
}

/// `mounts the exact regression shape without legacy HTML warning widgets`:
/// the table and the Tabs are the only widgets, both tabs labelled.
#[gpui::test]
fn the_regression_document_mounts_a_table_and_tabs(cx: &mut TestAppContext) {
    let source = "/\n\n# Hello man what can I say bro?\n\n| 我靠兄弟，你在搞我啊<br />hello man |  |  |  |\n| - | - | - | - |\n|  |  |  |  |\n|  |  |  |  |\n|  |  |  |  |\n|  |  |  |  |\n\n你好哈哈\\\n\n\n<Tabs>\n  <Tab label=\"Tab 1\">\n\n  </Tab>\n\n  <Tab label=\"Tab 2\">\n\n  </Tab>\n</Tabs>\n";
    let (view, cx) = setup(cx, source);
    assert_eq!(widgets(&view, cx), 2);
    assert!(shown(cx, "Tab 1"));
    assert!(cx.debug_bounds("md-mdx-tab:Tab 2:hidden").is_some());
    view.read_with(cx, |v, _| assert_eq!(v.text(), source));
}
