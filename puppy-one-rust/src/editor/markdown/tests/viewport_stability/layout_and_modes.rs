//! Viewport stability matrix: resize, bottom clamping, font scale, theme,
//! Live Preview toggle, blur/focus, scroll jump, and PageDown caret reveal
//! (T2 #1–#6 and #15–#17, each as an independent `#[gpui::test]`).
use super::{
    DEFAULT_TOLERANCE_PX, TopKind, assert_top_text_holds, capture_top_text, measure_offset_top,
    open_sixty_section_view, scroll_to_top_kind, settle,
};
use crate::{
    editor::{
        markdown::SetLivePreview,
        text::selection::Selection,
        view::extension::{SetAppearance, config_transaction},
    },
    typography::Scale,
};
use gpui::{FocusHandle, TestAppContext, px, size};

/// T2 #1 (Rust-native): resizing window width across `760 -> 560 -> 440 -> 880 -> 1000`
/// for 3 rounds keeps viewport top text within `0.5px` at every step, across all
/// four `TopKind` anchors (`Paragraph`, `Table`, `CodeBlock`, `Image`).
#[gpui::test]
fn t2_01_width_resize_cycles_hold_across_all_top_kinds(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    for top in [
        TopKind::Paragraph,
        TopKind::Table,
        TopKind::CodeBlock,
        TopKind::Image,
    ] {
        let (view, visual) = open_sixty_section_view(cx, false);
        scroll_to_top_kind(&view, visual, top);
        let (offset, row0) = capture_top_text(&view, visual);
        for round in 0..3 {
            for width in [760., 560., 440., 880., 1000.] {
                visual.simulate_resize(size(px(width), px(700.)));
                settle(&view, visual);
                let label = format!("t2_01 top={top:?} round={round} width={width}");
                let row1 = measure_offset_top(&view, visual, offset, &label);
                assert!(
                    (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
                    "{label}: drifted by {:.3}px (row0={row0:.2}, row1={row1:.2})",
                    row1 - row0
                );
            }
        }
    }
}

/// T2 #2 (Rust-native): changing window height `700 -> 1100 -> 400 -> 700`
/// holds the viewport top text within `0.5px` across all four `TopKind` anchors.
#[gpui::test]
fn t2_02_height_resize_holds_across_all_top_kinds(cx: &mut TestAppContext) {
    for top in [
        TopKind::Paragraph,
        TopKind::Table,
        TopKind::CodeBlock,
        TopKind::Image,
    ] {
        assert_top_text_holds(
            cx,
            top,
            |view, visual| {
                for height in [1100., 400., 700.] {
                    visual.simulate_resize(size(px(1000.), px(height)));
                    settle(view, visual);
                }
            },
            |o| o,
        );
    }
}

/// T2 #3 (Rust-native): when scrolled to the very bottom of the document,
/// growing window height `700 -> 1100` clamps scroll so the last block stays
/// flush with the viewport bottom (±0.5px) or the document fits with `scroll_top() == 0`.
#[gpui::test]
fn t2_03_bottom_height_growth_clamps_last_line_flush(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, false);
    let max_scroll = view.read_with(visual, |v, _| v.layout().unwrap().max_scroll());
    assert!(
        max_scroll > 2_000.0,
        "positive control: 60-section document must exceed viewport height"
    );
    view.update(visual, |v, cx| v.set_scroll_top(max_scroll, cx));
    settle(&view, visual);

    visual.simulate_resize(size(px(1000.), px(1100.)));
    settle(&view, visual);

    view.read_with(visual, |v, _| {
        let layout = v.layout().expect("layout after bottom height growth");
        let new_max = layout.max_scroll();
        if new_max <= 0.0 {
            assert_eq!(v.scroll_top(), 0.0);
        } else {
            assert!(
                (v.scroll_top() - new_max).abs() <= DEFAULT_TOLERANCE_PX,
                "bottom scroll must stay clamped to max_scroll ({} vs {new_max})",
                v.scroll_top()
            );
            let doc_bottom_in_viewport =
                f32::from(layout.height) - v.scroll_top();
            let viewport_height = f32::from(layout.bounds.size.height);
            assert!(
                (doc_bottom_in_viewport - viewport_height).abs() <= DEFAULT_TOLERANCE_PX,
                "document bottom ({doc_bottom_in_viewport:.2}) must sit flush with viewport bottom ({viewport_height:.2})"
            );
        }
    });
}

/// T2 #4 (Rust-native): switching font scale (`Small` -> `Large` -> `Medium`)
/// via `SetAppearance` actually changes body `line_height` (positive control)
/// while holding the anchored top text within `0.5px`.
#[gpui::test]
fn t2_04_font_scale_switches_hold_viewport_top(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, false);
    scroll_to_top_kind(&view, visual, TopKind::Paragraph);

    let (offset, row0) = capture_top_text(&view, visual);
    let mut line_heights = Vec::new();
    for scale in [Scale::Small, Scale::Large, Scale::Medium] {
        view.update(visual, |v, cx| {
            v.dispatch(config_transaction(SetAppearance { dark: false, scale }), cx);
        });
        settle(&view, visual);
        let lh = view.read_with(visual, |v, _| {
            let layout = v.layout().unwrap();
            layout
                .leaves
                .iter()
                .find(|l| l.source().start <= offset && offset <= l.source().end)
                .map(|l| f32::from(l.geometry.line_height()))
                .expect("leaf containing anchored offset")
        });
        line_heights.push((scale, lh));
        let label = format!("t2_04 scale={scale:?}");
        let row1 = measure_offset_top(&view, visual, offset, &label);
        assert!(
            (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
            "{label}: drifted by {:.3}px (row0={row0:.2}, row1={row1:.2})",
            row1 - row0
        );
    }
    let small_lh = line_heights[0].1;
    let large_lh = line_heights[1].1;
    let medium_lh = line_heights[2].1;
    assert!(
        small_lh < medium_lh && medium_lh < large_lh,
        "positive control: body line_height must actually change across Small/Medium/Large ({line_heights:?})"
    );
}

/// T2 #5 (Rust-native): toggling Light <-> Dark theme three times holds the
/// viewport top text within `0.5px`.
#[gpui::test]
fn t2_05_theme_switches_hold_viewport_top(cx: &mut TestAppContext) {
    assert_top_text_holds(
        cx,
        TopKind::Paragraph,
        |view, visual| {
            for round in 0..3 {
                for dark in [true, false] {
                    view.update(visual, |v, cx| {
                        v.dispatch(
                            config_transaction(SetAppearance {
                                dark,
                                scale: Scale::Medium,
                            }),
                            cx,
                        );
                    });
                    settle(view, visual);
                    let _ = round;
                }
            }
        },
        |o| o,
    );
}

/// T2 #6 (Rust-native): toggling `SetLivePreview(false)` then `(true)` three
/// times holds the viewport top text within `0.5px` with zero drift accumulation.
#[gpui::test]
fn t2_06_live_preview_source_round_trips_hold_viewport_top(cx: &mut TestAppContext) {
    assert_top_text_holds(
        cx,
        TopKind::Paragraph,
        |view, visual| {
            for _ in 0..3 {
                view.update(visual, |v, cx| {
                    v.dispatch(config_transaction(SetLivePreview(false)), cx);
                });
                settle(view, visual);
                view.update(visual, |v, cx| {
                    v.dispatch(config_transaction(SetLivePreview(true)), cx);
                });
                settle(view, visual);
            }
        },
        |o| o,
    );
}

/// T2 #15 (Rust-native): blurring and re-focusing the editor while the caret
/// sits far above the viewport keeps the viewport top text anchored without
/// jumping back up to the caret.
#[gpui::test]
fn t2_15_blur_and_refocus_with_caret_above_viewport_holds_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, true);
    scroll_to_top_kind(&view, visual, TopKind::Paragraph);

    let (offset, row0) = capture_top_text(&view, visual);
    let caret = view.read_with(visual, |v, _| v.state().selection.head);
    assert!(
        caret < 100 && caret + 500 < offset,
        "positive control: caret ({caret}) must sit far above viewport top ({offset})"
    );
    let outside: FocusHandle = visual.update(|_, cx| cx.focus_handle());
    visual.update(|w, cx| outside.focus(w, cx));
    settle(&view, visual);
    view.update_in(visual, |v, w, cx| v.focus(w, cx));
    settle(&view, visual);

    let row1 = measure_offset_top(&view, visual, offset, "t2_15 blur/refocus");
    assert!(
        (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "blur + refocus with caret above viewport drifted top text by {:.3}px",
        row1 - row0
    );
}

/// T2 #16 (Rust-native): calling `set_scroll_top` to a distant position,
/// drawing once, and immediately resizing width to 560 anchors to the text
/// at the jumped position rather than the pre-jump anchor.
#[gpui::test]
fn t2_16_scroll_jump_then_immediate_width_resize_holds_jumped_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, false);
    scroll_to_top_kind(&view, visual, TopKind::Paragraph);
    let (before_jump_offset, _) = capture_top_text(&view, visual);

    let max_scroll = view.read_with(visual, |v, _| v.layout().unwrap().max_scroll());
    let far_scroll = (max_scroll * 0.78).max(1_000.0);
    view.update(visual, |v, cx| v.set_scroll_top(far_scroll, cx));
    let _ = super::super::blocks(&view, visual);
    visual.run_until_parked();

    let (jumped_offset, row0) = capture_top_text(&view, visual);
    assert!(
        jumped_offset > before_jump_offset + 200,
        "positive control: jump must land far past the previous viewport top"
    );

    visual.simulate_resize(size(px(560.), px(700.)));
    settle(&view, visual);

    let row1 = measure_offset_top(&view, visual, jumped_offset, "t2_16 resize after jump");
    assert!(
        (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "resize after scroll jump drifted from jumped top text by {:.3}px",
        row1 - row0
    );
}

/// T2 #17 (Rust-native): pressing `PageDown` once, waiting for caret reveal,
/// and then resizing width to 560 holds the post-`PageDown` viewport top text.
#[gpui::test]
fn t2_17_page_down_caret_reveal_then_width_resize_holds_revealed_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, true);
    scroll_to_top_kind(&view, visual, TopKind::Paragraph);
    let (initial_top, mid_viewport_offset) = view.read_with(visual, |v, _| {
        let l = v.layout().unwrap();
        let left = l.blocks[0].bounds.left();
        let top_off = l.offset_at(gpui::point(left, l.bounds.top() + px(2.))).0;
        let mid_off = l
            .offset_at(gpui::point(
                left,
                l.bounds.top() + l.bounds.size.height * 0.5,
            ))
            .0;
        (top_off, mid_off)
    });
    // Place caret in the middle of the viewport so a single PageDown moves past
    // the viewport bottom and triggers caret reveal.
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(mid_viewport_offset), cx);
    });
    settle(&view, visual);

    let scroll_before = view.read_with(visual, |v, _| v.scroll_top());
    visual.simulate_keystrokes("pagedown");
    settle(&view, visual);

    let scroll_after = view.read_with(visual, |v, _| v.scroll_top());
    assert!(
        scroll_after > scroll_before + 100.0,
        "positive control: PageDown must advance scroll_top ({scroll_before} -> {scroll_after})"
    );
    let (post_pd_offset, row0) = capture_top_text(&view, visual);
    assert!(
        post_pd_offset > initial_top,
        "positive control: PageDown must advance viewport top offset ({initial_top} -> {post_pd_offset})"
    );

    visual.simulate_resize(size(px(560.), px(700.)));
    settle(&view, visual);

    let row1 = measure_offset_top(&view, visual, post_pd_offset, "t2_17 resize after PageDown");
    assert!(
        (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "resize after PageDown drifted from revealed top text by {:.3}px",
        row1 - row0
    );
}
