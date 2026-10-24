use super::{
    decoration::{Decorations, Surface},
    extension::PlainText,
    style::{Edges, LineHeight, LineStyle, TextStyle},
    *,
};
use crate::editor::text::selection::Selection;
use core::prelude::v1::test;

fn plain() -> Box<PlainText> {
    let text = TextStyle { size: 15., weight: 500., italic: false, mono: false, color: rgba(0xfafafaff), tabular: false, line_height: LineHeight::Factor(1.75) };
    let line = LineStyle { padding: Edges::new(0., 0., 3.75, 0.), ..LineStyle::new(text) };
    Box::new(PlainText {
        line: std::rc::Rc::new(line),
        decorations: Decorations {
            surface: Surface {
                content: Edges::new(48., 48., 48., 48.),
                max_text_width: Some(724.),
                selection: rgba(0x60a5fa47),
                selection_inactive: rgba(0x60a5fa27),
                caret: rgba(0xfafafaff),
                caret_width: 1.,
                background: rgba(0x161616ff),
                link: rgba(0x60a5faff),
                inline_code: rgba(0xb7b7bcff),
            },
            ..Default::default()
        },
    })
}

fn setup<'a>(cx: &'a mut TestAppContext, text: &str) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let text = text.to_owned();
    let (view, cx) = cx.add_window_view(move |_, cx| EditorView::new(&text, plain(), cx));
    view.update_in(cx, |v, w, cx| v.focus(w, cx));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    (view, cx)
}

#[gpui::test]
fn typing_motion_deletion_and_history(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "hello\nworld");
    view.update_in(cx, |v, _, cx| v.set_selection(Selection::cursor(5), cx));
    cx.simulate_input(" there");
    cx.simulate_keystrokes("enter");
    cx.simulate_input("x");
    view.update(cx, |v, _| assert_eq!(v.text(), "hello there\nx\nworld"));
    cx.simulate_keystrokes("alt-backspace");
    view.update(cx, |v, _| assert_eq!(v.text(), "hello there\n\nworld"));
    cx.simulate_keystrokes("cmd-z");
    view.update(cx, |v, _| assert_eq!(v.text(), "hello there\nx\nworld"));
    cx.simulate_keystrokes("cmd-up shift-down");
    view.update(cx, |v, _| {
        let s = v.state().selection;
        assert_eq!((s.anchor, s.from()), (0, 0));
        assert_eq!(s.to(), 12, "shift-down extends to the same column of the next row");
    });
    cx.simulate_keystrokes("cmd-a backspace");
    view.update(cx, |v, _| assert_eq!(v.text(), ""));
}

#[gpui::test]
fn layout_centres_the_rail_and_maps_points_to_offsets(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, "one\ntwo");
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    view.update(cx, |v, _| {
        let layout = v.layout().unwrap();
        assert_eq!(layout.blocks.len(), 2);
        let (a, b) = (layout.blocks[0].bounds, layout.blocks[1].bounds);
        assert!((f32::from(a.size.height) - 30.).abs() < 1e-3, "26.25 line + 3.75 gap: {a:?}");
        assert!((f32::from(b.top() - a.top()) - 30.).abs() < 1e-3);
        // 48px insets, or centred on the 724px rail in a wider window.
        let w = f32::from(layout.bounds.size.width);
        assert_eq!(f32::from(a.left() - layout.bounds.left()), 48f32.max((w - 724f32.min(w - 96.)) / 2.));
        let caret = layout.caret(4 + 3, false);
        // Kit's row is shifted so its baseline matches Chromium's; the test
        // platform's text system has synthetic metrics, so only bound it.
        let shift = f32::from(caret.row_top - b.top());
        assert!(caret.x > a.left() + px(10.) && shift.abs() < 8., "caret {caret:?} block {b:?}");
        assert_eq!(layout.offset_at(point(a.left(), b.top() + px(1.))), (4, false));
        assert_eq!(layout.offset_at(point(a.left() + px(500.), a.top() + px(2.))), (3, false));
    });
}

/// A host pane narrower than the window, as the workbench lays editors out.
struct Pane {
    editor: Entity<EditorView>,
}

impl Render for Pane {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().flex().child(div().w(px(160.))).child(div().w(px(420.)).h_full().child(self.editor.clone()))
    }
}

type PaneLayout = (Bounds<Pixels>, Vec<Bounds<Pixels>>, Vec<Bounds<Pixels>>);

/// What the editor published from the frame just drawn.
fn pane_layout(view: &Entity<EditorView>, cx: &App) -> PaneLayout {
    let layout = view.read(cx).layout().expect("laid out on the first frame");
    (layout.bounds, layout.blocks.iter().map(|b| b.bounds).collect(), layout.leaves.iter().map(|l| l.geometry.bounds()).collect())
}

/// The layout fills the 420px pane at x 160: a 324px column at the 48px
/// gutter that every leaf stays inside.
fn assert_fits_pane((bounds, blocks, leaves): &PaneLayout) {
    assert_eq!((f32::from(bounds.left()), f32::from(bounds.size.width)), (160., 420.), "the pane, not the window");
    let (left, right) = (bounds.left() + px(48.), bounds.right() - px(48.));
    for b in blocks {
        assert_eq!((b.left(), b.right()), (left, right), "block {b:?}");
    }
    for l in leaves {
        assert!(l.left() >= left && l.right() <= right + px(0.5), "leaf {l:?} outside the column {left:?}..{right:?}");
    }
    assert!(blocks.iter().any(|b| f32::from(b.size.height) > 60.), "the long paragraph wraps: {blocks:?}");
}

#[gpui::test]
fn a_new_editor_lays_out_for_its_pane_on_its_first_frame(cx: &mut TestAppContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
    });
    let long = "a paragraph long enough to wrap inside a narrow pane ".repeat(6);
    let text = format!("{long}\nshort\n{long}");
    let (pane, cx) = cx.add_window_view(|_, cx| Pane { editor: cx.new(|cx| EditorView::new(&text, plain(), cx)) });
    // Opening a file is a new editor; check the one frame that shows it
    // first, before anything else can draw.
    let open = |cx: &mut VisualTestContext, text: String| {
        cx.update(|w, cx| {
            let editor = pane.update(cx, |p, cx| {
                p.editor = cx.new(|cx| EditorView::new(&text, plain(), cx));
                cx.notify();
                p.editor.clone()
            });
            let _ = w.draw(cx);
            (editor.clone(), pane_layout(&editor, cx))
        })
    };
    let (editor, first) = open(cx, format!("{long}\n{long}"));
    assert_fits_pane(&first);
    // The first frame is final: the next one lays out the same.
    let again = cx.update(|w, cx| {
        w.refresh();
        let _ = w.draw(cx);
        pane_layout(&editor, cx)
    });
    assert_eq!(again, first);
    let (_, other) = open(cx, format!("short\n{long}\n- {long}"));
    assert_fits_pane(&other);
}
