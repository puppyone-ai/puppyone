use super::{
    decoration::{Decorations, Surface},
    extension::PlainText,
    style::{Edges, LineHeight, LineStyle, TextStyle},
    *,
};
use crate::editor::text::selection::Selection;
use core::prelude::v1::test;

fn plain() -> Box<PlainText> {
    let text = TextStyle {
        size: 15.,
        weight: 500.,
        italic: false,
        mono: false,
        color: rgba(0xfafafaff),
        tabular: false,
        line_height: LineHeight::Factor(1.75),
    };
    let line = LineStyle {
        padding: Edges::new(0., 0., 3.75, 0.),
        ..LineStyle::new(text)
    };
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
        assert_eq!(
            s.to(),
            12,
            "shift-down extends to the same column of the next row"
        );
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
        assert!(
            (f32::from(a.size.height) - 30.).abs() < 1e-3,
            "26.25 line + 3.75 gap: {a:?}"
        );
        assert!((f32::from(b.top() - a.top()) - 30.).abs() < 1e-3);
        // 48px insets, or centred on the 724px rail in a wider window.
        let w = f32::from(layout.bounds.size.width);
        assert_eq!(
            f32::from(a.left() - layout.bounds.left()),
            48f32.max((w - 724f32.min(w - 96.)) / 2.)
        );
        let caret = layout.caret(4 + 3, false);
        // Kit's row is shifted so its baseline matches Chromium's; the test
        // platform's text system has synthetic metrics, so only bound it.
        let shift = f32::from(caret.row_top - b.top());
        assert!(
            caret.x > a.left() + px(10.) && shift.abs() < 8.,
            "caret {caret:?} block {b:?}"
        );
        assert_eq!(
            layout.offset_at(point(a.left(), b.top() + px(1.))),
            (4, false)
        );
        assert_eq!(
            layout.offset_at(point(a.left() + px(500.), a.top() + px(2.))),
            (3, false)
        );
    });
}

/// A host pane narrower than the window, as the workbench lays editors out.
struct Pane {
    editor: Entity<EditorView>,
}

impl Render for Pane {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .child(div().w(px(160.)))
            .child(div().w(px(420.)).h_full().child(self.editor.clone()))
    }
}

type PaneLayout = (Bounds<Pixels>, Vec<Bounds<Pixels>>, Vec<Bounds<Pixels>>);

/// What the editor published from the frame just drawn.
fn pane_layout(view: &Entity<EditorView>, cx: &App) -> PaneLayout {
    let layout = view.read(cx).layout().expect("laid out on the first frame");
    (
        layout.bounds,
        layout.blocks.iter().map(|b| b.bounds).collect(),
        layout.leaves.iter().map(|l| l.geometry.bounds()).collect(),
    )
}

/// The layout fills the 420px pane at x 160: a 324px column at the 48px
/// gutter that every leaf stays inside.
fn assert_fits_pane((bounds, blocks, leaves): &PaneLayout) {
    assert_eq!(
        (f32::from(bounds.left()), f32::from(bounds.size.width)),
        (160., 420.),
        "the pane, not the window"
    );
    let (left, right) = (bounds.left() + px(48.), bounds.right() - px(48.));
    for b in blocks {
        assert_eq!((b.left(), b.right()), (left, right), "block {b:?}");
    }
    for l in leaves {
        assert!(
            l.left() >= left && l.right() <= right + px(0.5),
            "leaf {l:?} outside the column {left:?}..{right:?}"
        );
    }
    assert!(
        blocks.iter().any(|b| f32::from(b.size.height) > 60.),
        "the long paragraph wraps: {blocks:?}"
    );
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
    let (pane, cx) = cx.add_window_view(|_, cx| Pane {
        editor: cx.new(|cx| EditorView::new(&text, plain(), cx)),
    });
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

// Viewport layout: a frame lays out the blocks near the viewport only.

fn long_document(lines: usize, words: usize) -> String {
    (0..lines)
        .map(|i| format!("Line {i}{}", " word".repeat(words)))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Draws until the passes a frame defers (anchoring, reveal) have settled.
fn settle(cx: &mut VisualTestContext) {
    for _ in 0..6 {
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        cx.run_until_parked();
    }
}

fn caret_in_view(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
    view.read_with(cx, |v, _| {
        let l = v.layout.as_ref().unwrap();
        let head = v.state.selection.head;
        assert!(l.covers(head), "the caret's block is laid out");
        let c = l.caret(head, v.state.selection.upstream);
        assert!(
            c.row_top >= l.bounds.top() && c.row_top + c.row_height <= l.bounds.bottom(),
            "caret row {:?} within {:?}",
            c.row_top,
            l.bounds
        );
    });
}

#[gpui::test]
fn a_long_document_lays_out_only_the_blocks_near_the_viewport(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, &long_document(5000, 0));
    cx.simulate_resize(size(px(900.), px(600.)));
    settle(cx);
    view.read_with(cx, |v, _| {
        let l = v.layout.as_ref().unwrap();
        assert!(l.starts_document && !l.ends_document);
        assert!(l.blocks.len() < 120, "{} blocks laid out", l.blocks.len());
        // Every line still counts toward the document height (30px each).
        assert!(f32::from(l.height) > 5000. * 30.);
    });
    view.update(cx, |v, cx| {
        v.scroll_y = 1e9;
        cx.notify();
    });
    settle(cx);
    view.read_with(cx, |v, _| {
        let l = v.layout.as_ref().unwrap();
        assert!(l.ends_document && !l.starts_document);
        assert!(l.covers(v.state.doc.len()));
        assert_eq!(v.scroll_y, l.max_scroll());
    });
}

#[gpui::test]
fn the_caret_moved_far_outside_the_layout_is_revealed(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, &long_document(5000, 12));
    cx.simulate_keystrokes("cmd-down");
    settle(cx);
    view.read_with(cx, |v, _| {
        assert_eq!(v.state.selection.head, v.state.doc.len())
    });
    caret_in_view(&view, cx);
    cx.simulate_keystrokes("cmd-up");
    settle(cx);
    view.read_with(cx, |v, _| {
        assert_eq!(v.state.selection.head, 0);
        // Back at the top: the reveal margin above the first row, within
        // the content inset.
        assert!(v.scroll_y < 48., "scroll {}", v.scroll_y);
    });
    caret_in_view(&view, cx);
    // A caret scrolled out of view moves by source lines, then comes back.
    view.update(cx, |v, cx| {
        v.scroll_y = 60_000.;
        cx.notify();
    });
    settle(cx);
    cx.simulate_keystrokes("down");
    settle(cx);
    view.read_with(cx, |v, _| {
        assert_eq!(v.state.doc.line_index(v.state.selection.head), 1);
    });
    caret_in_view(&view, cx);
}

#[gpui::test]
fn page_down_walks_a_long_document_with_the_caret_in_view(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, &long_document(400, 12));
    let end = view.read_with(cx, |v, _| v.state.doc.len());
    let mut last = 0;
    for _ in 0..80 {
        cx.simulate_keystrokes("pagedown");
        settle(cx);
        caret_in_view(&view, cx);
        let head = view.read_with(cx, |v, _| v.state.selection.head);
        assert!(head > last || head == end, "page down moved forward");
        last = head;
        if head == end {
            break;
        }
    }
    assert_eq!(last, end);
}

#[gpui::test]
fn corrected_estimates_above_the_viewport_do_not_move_what_is_shown(cx: &mut TestAppContext) {
    // Long lines: estimated from their length, laid out on fewer rows here,
    // so blocks coming into view above the viewport are shorter than planned.
    let (view, cx) = setup(cx, &long_document(3000, 30));
    view.update(cx, |v, cx| {
        v.scroll_y = 40_000.;
        cx.notify();
    });
    settle(cx);
    let row_of = |view: &Entity<EditorView>, cx: &mut VisualTestContext, offset: usize| {
        view.read_with(cx, |v, _| {
            let l = v.layout.as_ref().unwrap();
            f32::from(l.caret(offset, false).row_top - l.bounds.top())
        })
    };
    // The line at the top of the viewport.
    let line = view.read_with(cx, |v, _| {
        let l = v.layout.as_ref().unwrap();
        let (offset, _) = l.offset_at(point(l.bounds.left() + px(300.), l.bounds.top() + px(40.)));
        v.state.doc.line_range(v.state.doc.line_index(offset)).start
    });
    let mut y = row_of(&view, cx, line);
    let start = view.read_with(cx, |v, _| v.scroll_y);
    let mut steps = 0.;
    for _ in 0..40 {
        steps += 1.;
        view.update(cx, |v, cx| {
            v.scroll_y -= 24.;
            cx.notify();
        });
        settle(cx);
        let next = row_of(&view, cx, line);
        // Scroll snaps to device pixels (2x here): a correction may round
        // by one of them.
        assert!(
            (next - (y + 24.)).abs() <= 0.5,
            "moved {} instead of 24",
            next - y
        );
        y = next;
        if y > 400. {
            break;
        }
    }
    // The blocks that came into view were shorter than estimated: the
    // scroll absorbed the difference instead of the content jumping.
    let travelled = start - view.read_with(cx, |v, _| v.scroll_y);
    assert!(travelled > steps * 24. + 1., "no estimate was corrected");
}
