//! T3 style contracts: reading-rail centering across overflow, minimum 48px
//! document inset (+ chrome inset), full-width block alignment, task checkbox
//! compact visual vs 24px hit target + edge-click toggling, HTML image width
//! clamping vs authored size, block image rail filling, and Mermaid viewport-
//! bounded two-axis scrollport (`markdownEditorLayout.test.ts` #3, #6, #7, #9,
//! #11, #14, #15).
use super::{ALL_SCALES, ALL_THEMES, all_variants, decorate_markdown, settle};
use crate::{
    editor::{
        markdown::{
            SetAssets,
            features::{image as md_image, mermaid},
            shared::html_surface::html_image_dimensions,
            tests::{setup, setup_with_focus},
        },
        registry::DocumentAssets,
        view::{decoration::Block, extension::config_transaction, style::Paint},
    },
    render_service::{self, Rendered},
    theme::metric::READING_CONTENT_WIDTH,
};
use gpui::{Modifiers, RenderImage, TestAppContext, point, px, size};
use image::{Frame as ImageFrame, RgbaImage};
use std::{path::Path, sync::Arc};

/// `markdownEditorLayout.test.ts` #3: `keeps the centered reading rail invariant
/// when stacked panes cross the overflow threshold`. Reserving symmetric scrollbar
/// gutters keeps `column_left` unchanged when pane height crosses from no-overflow
/// (`max_scroll == 0`) to vertical overflow (`max_scroll > 0`).
#[gpui::test]
fn t3_03_reading_rail_stays_centered_across_vertical_overflow_threshold(cx: &mut TestAppContext) {
    for (dark, scale, theme) in all_variants() {
        let insets = theme.surface.insets();
        assert_eq!(
            insets.left, insets.right,
            "symmetric scrollbar-gutter reservation must match left and right (dark={dark}, scale={scale:?})"
        );
    }

    let doc: String = (0..18)
        .map(|i| format!("Paragraph {i}: reading rail centering check across overflow.\n\n"))
        .collect();
    let (view, visual) = setup_with_focus(cx, &doc, false);

    // Tall pane: fits completely without vertical overflow.
    visual.simulate_resize(size(px(1100.), px(1400.)));
    settle(&view, visual);
    let (left_no_overflow, max_scroll_tall) = view.read_with(visual, |v, _| {
        let l = v.layout().expect("tall layout");
        (f32::from(l.blocks[0].bounds.left()), l.max_scroll())
    });
    assert_eq!(
        max_scroll_tall, 0.0,
        "positive control: tall pane must have zero vertical overflow"
    );

    // Short pane: crosses vertical overflow threshold (`max_scroll > 100`).
    visual.simulate_resize(size(px(1100.), px(260.)));
    settle(&view, visual);
    let (left_overflow, max_scroll_short) = view.read_with(visual, |v, _| {
        let l = v.layout().expect("short layout");
        (f32::from(l.blocks[0].bounds.left()), l.max_scroll())
    });
    assert!(
        max_scroll_short > 100.0,
        "positive control: short pane must cross vertical overflow threshold (got {max_scroll_short})"
    );
    assert!(
        (left_overflow - left_no_overflow).abs() <= 0.5,
        "centered reading column shifted across overflow threshold ({left_no_overflow} -> {left_overflow})"
    );
}

/// `markdownEditorLayout.test.ts` #6: `shares the minimum document inset while
/// only inline padding responds to width`. Across widths `500`, `1000`, and
/// `1600`, top/bottom document insets stay pinned at `48px` (+ `chrome_inset`
/// on the top edge), while only horizontal margins respond to window width.
#[gpui::test]
fn t3_06_minimum_document_inset_constant_with_chrome_inset_across_widths(cx: &mut TestAppContext) {
    for (dark, scale, theme) in all_variants() {
        assert_eq!(
            theme.surface.gutter, 48.0,
            "minimum document inset must be 48px (dark={dark}, scale={scale:?})"
        );
        let insets = theme.surface.insets();
        assert_eq!(insets.top, 48.0);
        assert_eq!(insets.bottom, 48.0);
    }

    let doc = "First paragraph in the document.\n\nSecond paragraph below.\n";
    let (view, visual) = setup_with_focus(cx, doc, false);

    for chrome_inset in [0.0_f32, 36.0_f32] {
        view.update(visual, |v, cx| v.set_chrome_inset(chrome_inset, cx));
        let mut measurements = Vec::new();
        for width in [500.0_f32, 1000.0, 1600.0] {
            visual.simulate_resize(size(px(width), px(700.)));
            settle(&view, visual);
            let (top_inset, bottom_inset, left_inset, col_w) = view.read_with(visual, |v, _| {
                let l = v.layout().expect("layout");
                let b0 = l.blocks[0].bounds;
                let last = l.blocks.last().unwrap().bounds;
                let last_doc_bottom =
                    f32::from(last.bottom() - l.bounds.top()) + f32::from(l.scroll);
                let bottom_pad = f32::from(l.height) - last_doc_bottom;
                (
                    f32::from(b0.top() - l.bounds.top()),
                    bottom_pad,
                    f32::from(b0.left() - l.bounds.left()),
                    f32::from(b0.size.width),
                )
            });
            measurements.push((width, top_inset, bottom_inset, left_inset, col_w));
        }

        let expected_top = 48.0 + chrome_inset;
        for &(w, top, bottom, left, col_w) in &measurements {
            assert!(
                (top - expected_top).abs() <= 0.5,
                "top inset at width={w}px, chrome_inset={chrome_inset}px must be {expected_top}px (got {top})"
            );
            assert!(
                (bottom - 48.0).abs() <= 0.5,
                "bottom inset at width={w}px must remain 48px (got {bottom})"
            );
            assert!(
                left >= 48.0 - 0.5,
                "horizontal inset must never drop below 48px at width {w}px (got {left})"
            );
            assert!(
                col_w <= READING_CONTENT_WIDTH + 0.5,
                "reading column must not exceed 724px at width {w}px (got {col_w})"
            );
        }
        assert!(
            measurements[1].3 > measurements[0].3 + 50.0
                && measurements[2].3 > measurements[1].3 + 250.0,
            "positive control: horizontal inset must grow strictly across 500 -> 1000 -> 1600px: {measurements:?}"
        );
    }
}

/// `markdownEditorLayout.test.ts` #7: `keeps the full-width block edge separate
/// from the document reading rail`. Across narrow (`500`), medium (`1000`), and
/// wide (`1400`) panes, the reading rail stays symmetrically centered while
/// full-width blocks (code blocks, tables, rules) keep their own independent
/// edge bounds without breaking out into the outer gutter.
#[gpui::test]
fn t3_07_full_width_blocks_stay_aligned_within_reading_rail(cx: &mut TestAppContext) {
    let doc = "Intro paragraph.\n\n```rust\nfn demo() { println!(\"wide\"); }\n```\n\n| Col A | Col B | Col C |\n| --- | --- | --- |\n| alpha | beta | gamma |\n\n---\n";
    let (view, visual) = setup_with_focus(cx, doc, false);

    for width in [500.0_f32, 1000.0, 1400.0] {
        visual.simulate_resize(size(px(width), px(800.)));
        settle(&view, visual);

        view.read_with(visual, |v, _| {
            let l = v.layout().expect("settled layout");
            assert!(
                l.blocks.len() >= 4,
                "positive control: expected prose + rich blocks at width={width}"
            );
            let pane_left = f32::from(l.bounds.left());
            let pane_right = f32::from(l.bounds.right());
            let rail_left = f32::from(l.blocks[0].bounds.left());
            let rail_right = f32::from(l.blocks[0].bounds.right());
            let rail_width = f32::from(l.blocks[0].bounds.size.width);

            // Reading rail remains symmetrically centered inside the pane at every width.
            let left_margin = rail_left - pane_left;
            let right_margin = pane_right - rail_right;
            assert!(
                (left_margin - right_margin).abs() <= 1.0,
                "reading rail must stay centered at width={width}px (left_margin={left_margin}, right_margin={right_margin})"
            );
            if width >= 1000.0 {
                assert!(
                    (rail_width - READING_CONTENT_WIDTH).abs() <= 0.5,
                    "positive control: wide window reading rail must be 724px at width={width}px (got {rail_width})"
                );
            }
            for (i, blk) in l.blocks.iter().enumerate() {
                let b_left = f32::from(blk.bounds.left());
                let b_right = f32::from(blk.bounds.right());
                assert!(
                    (b_left - rail_left).abs() <= 0.5 && b_right <= rail_left + rail_width + 0.5,
                    "block {i} at width={width}px broke out of reading rail: [{b_left}..{b_right}] vs [{rail_left}..{}]",
                    rail_left + rail_width
                );
            }
        });
    }
}

/// `markdownEditorLayout.test.ts` #9: `keeps task checkbox visuals compact inside
/// a reliable desktop hit target`. Across every theme and text scale, the hotspot
/// is at least `24x24px` with the painted checkbox (`box_em * em`) strictly
/// smaller and centered inside it; in a live GPUI window, `debug_bounds("task")`
/// is `>= 24x24` and clicking the outer edge of the hit target (outside the
/// compact visual box) toggles the task state.
#[gpui::test]
fn t3_09_task_checkbox_compact_visual_inside_24px_hit_target_and_edge_clicks(
    cx: &mut TestAppContext,
) {
    for (dark, scale, theme) in all_variants() {
        assert_eq!(theme.task.hit, 24.0, "TaskStyle hit target must be 24px");
        let expected_visual = theme.task.box_em * theme.body.text.size;
        assert!(
            expected_visual > 10.0 && expected_visual < theme.task.hit,
            "visual checkbox ({expected_visual}px) must be compact inside 24px target (dark={dark}, scale={scale:?})"
        );

        let decos = decorate_markdown(
            "- [ ] unchecked task\n- [x] checked task\n",
            dark,
            scale,
            true,
        );
        for (idx, label) in [(0, "unchecked"), (1, "checked")] {
            let Block::Line { style, .. } = &decos.blocks[idx] else {
                panic!("expected line block for {label} task");
            };
            let (hit, _) = style
                .hotspots
                .first()
                .unwrap_or_else(|| panic!("missing hotspot on {label} task"));
            assert!(
                hit.width >= 24.0 && hit.height >= 24.0,
                "{label} task hit target must be >= 24x24 (got {}x{})",
                hit.width,
                hit.height
            );
            let visual_rect = style
                .overlays
                .iter()
                .find_map(|p| match p {
                    Paint::Quad { rect, .. } => Some(*rect),
                    _ => None,
                })
                .unwrap_or_else(|| panic!("missing visual quad on {label} task"));
            assert!(
                (visual_rect.width - expected_visual).abs() < 0.05
                    && (visual_rect.height - expected_visual).abs() < 0.05,
                "visual checkbox must match TaskStyle box_em * em ({expected_visual}), got {}x{}",
                visual_rect.width,
                visual_rect.height
            );
            assert!(
                visual_rect.width < hit.width && visual_rect.height < hit.height,
                "visual checkbox must sit strictly inside the 24x24 hit target"
            );
            let hit_cx = hit.x + hit.width / 2.0;
            let hit_cy = hit.y + hit.height / 2.0;
            let vis_cx = visual_rect.x + visual_rect.width / 2.0;
            let vis_cy = visual_rect.y + visual_rect.height / 2.0;
            assert!(
                (hit_cx - vis_cx).abs() < 0.1 && (hit_cy - vis_cy).abs() < 0.1,
                "visual checkbox must be centered within its hit target"
            );
        }
    }

    // Live GPUI hit-bounds & outer-edge click verification.
    let (view, visual) = setup(cx, "- [ ] Edge click task\n");
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);

    let hit_bounds = visual
        .debug_bounds("task")
        .expect("task checkbox hotspot debug_bounds must exist");
    assert!(
        f32::from(hit_bounds.size.width) >= 24.0 - 0.1
            && f32::from(hit_bounds.size.height) >= 24.0 - 0.1,
        "rendered task checkbox debug_bounds must be >= 24x24 (got {:?})",
        hit_bounds.size
    );

    // Click near top-left outer corner of the 24x24 target (outside the ~15.75px centered box).
    let top_left_edge = point(hit_bounds.left() + px(1.5), hit_bounds.top() + px(1.5));
    visual.simulate_click(top_left_edge, Modifiers::none());
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            "- [x] Edge click task\n",
            "clicking top-left outer edge of 24x24 hit target must toggle checkbox"
        );
    });

    // Click near bottom-right outer corner to toggle back.
    let bottom_right_edge = point(hit_bounds.right() - px(1.5), hit_bounds.bottom() - px(1.5));
    visual.simulate_click(bottom_right_edge, Modifiers::none());
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.text(),
            "- [ ] Edge click task\n",
            "clicking bottom-right outer edge of 24x24 hit target must toggle back"
        );
    });
}

/// `markdownEditorLayout.test.ts` #11: `caps raw HTML images at the reading rail
/// without replacing authored sizing`. A 2000px-wide raw HTML image clamps to the
/// reading column width while preserving aspect ratio, whereas an authored
/// `width="120"` keeps its authored 120px width.
#[gpui::test]
fn t3_11_html_images_cap_at_reading_rail_while_preserving_authored_size(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    for (_dark, _scale, theme) in all_variants() {
        let rail = theme.surface.text_width;
        let (wide_w, wide_h) = html_image_dimensions((2000., 600.), (None, None), rail);
        assert!(
            (wide_w - rail).abs() <= 0.5,
            "2000px HTML image must cap at reading rail {rail}px (got {wide_w})"
        );
        assert!(
            (wide_h - 600. * rail / 2000.).abs() <= 0.5,
            "capped HTML image must preserve aspect ratio (got {wide_h})"
        );
        let (authored_w, authored_h) =
            html_image_dimensions((2000., 600.), (Some(120.), None), rail);
        assert_eq!(authored_w, 120.0, "authored width=120 must be preserved");
        assert!(
            (authored_h - 36.0).abs() <= 0.5,
            "authored width=120 scales height proportionally"
        );
    }

    let mut png = Vec::new();
    RgbaImage::from_pixel(2000, 600, image::Rgba([40, 120, 210, 255]))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let png_arc = Arc::new(png);
    for (label, html, expected_w) in [
        (
            "wide-natural",
            "<div><img src=\"wide.png\" alt=\"wide\" /></div>\n",
            READING_CONTENT_WIDTH,
        ),
        (
            "authored-120",
            "<div><img src=\"wide.png\" width=\"120\" alt=\"small\" /></div>\n",
            120.0,
        ),
    ] {
        let bytes = png_arc.clone();
        let assets = DocumentAssets {
            workspace: format!("memory://t3-11-{label}"),
            document: "doc.md".into(),
            read: Arc::new(move |rel: &Path| {
                (rel == Path::new("wide.png")).then(|| (*bytes).clone())
            }),
        };
        let (view, visual) = setup_with_focus(cx, html, false);
        visual.simulate_resize(size(px(1100.), px(700.)));
        view.update_in(visual, |v, _, cx| {
            v.dispatch(config_transaction(SetAssets(Some(assets))), cx);
        });
        for _ in 0..8 {
            settle(&view, visual);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let img_bounds = visual
            .debug_bounds("md-html-img")
            .unwrap_or_else(|| panic!("{label}: expected rendered HTML image bounds"));
        let w = f32::from(img_bounds.size.width);
        assert!(
            (w - expected_w).abs() <= 1.0,
            "{label}: expected rendered width {expected_w}px, got {w}px"
        );
    }
}

/// `markdownEditorLayout.test.ts` #14: `fills the rich content rail for block
/// images without a product pixel cap`. Block images use the full 724px reading
/// rail with no 520px width cap and no 320px height cap; inline images cap at
/// 320px height (positive control).
#[test]
fn t3_14_block_images_fill_reading_rail_without_520px_cap() {
    for (dark, scale, theme) in all_variants() {
        let rail = theme.surface.text_width;
        assert_eq!(rail, 724.0);
        let (bw, bh) = md_image::fit_for_tests(None, true, (1200., 600.), rail);
        assert!(
            (bw - 724.0).abs() <= 0.1 && (bh - 362.0).abs() <= 0.1,
            "block image must fill 724px rail without 520px cap (dark={dark}, scale={scale:?}, got {bw}x{bh})"
        );
        let (tw, th) = md_image::fit_for_tests(None, true, (800., 900.), rail);
        assert!(
            (tw - 724.0).abs() <= 0.1 && th > 800.0,
            "tall block image must not apply inline 320px height cap (got {tw}x{th})"
        );
        let (_, ih) = md_image::fit_for_tests(None, false, (800., 900.), rail);
        assert!(
            (ih - 320.0).abs() <= 0.1,
            "positive control: inline image must cap at 320px height (got {ih})"
        );
    }
}

/// `markdownEditorLayout.test.ts` #15: `keeps dense diagrams inside a bounded
/// two-axis scrollport`. A dense Mermaid diagram clamps its preview container
/// height to `min(68% viewport height, 720px)` with two-axis scrolling, and a
/// narrow diagram renders horizontally centered inside its canvas.
#[gpui::test]
fn t3_15_mermaid_dense_diagrams_stay_within_viewport_bounded_scrollport(cx: &mut TestAppContext) {
    let dense_src = "graph TD; T3Dense1-->T3Dense2-->T3Dense3";
    let dense_doc = format!("```mermaid\n{dense_src}\n```\n");
    let rgba = RgbaImage::from_pixel(4, 4, image::Rgba([24, 32, 48, 255]));
    let dense_rendered = Rendered {
        image: Arc::new(RenderImage::new(vec![ImageFrame::new(rgba.clone())])),
        width: 1600.,
        height: 1400.,
        baseline: 0.,
    };
    for dark in ALL_THEMES {
        for scale in ALL_SCALES {
            let req = mermaid::widget::request_for_tests(dense_src, dark, scale, 1.0);
            render_service::seed_ready_for_tests(&req, dense_rendered.clone());
            // 1600px wide inside ~690px inner width clamps to 0.7 -> bucket 0.75.
            let zoomed = mermaid::widget::request_for_tests(dense_src, dark, scale, 0.75);
            render_service::seed_ready_for_tests(&zoomed, dense_rendered.clone());
        }
    }

    let (view, visual) = setup_with_focus(cx, &dense_doc, false);

    // Tall window (1200px): 68% = 816px > 720px, so 720px cap wins.
    visual.simulate_resize(size(px(1000.), px(1200.)));
    settle(&view, visual);
    let preview_tall = visual
        .debug_bounds("md-mermaid-preview")
        .expect("Mermaid preview panel in tall window");
    let h_tall = f32::from(preview_tall.size.height);
    assert!(
        (h_tall - 720.0).abs() <= 1.0,
        "tall window (1200px) dense Mermaid preview must cap at 720px (got {h_tall}px)"
    );

    // Short window (600px): 68% = 408px < 720px, so 68% viewport height cap wins.
    visual.simulate_resize(size(px(1000.), px(600.)));
    for dark in ALL_THEMES {
        for scale in ALL_SCALES {
            view.update(visual, |v, cx| v.set_appearance(dark, scale, cx));
            settle(&view, visual);
            let preview_short = visual
                .debug_bounds("md-mermaid-preview")
                .expect("Mermaid preview panel in short window");
            let h_short = f32::from(preview_short.size.height);
            let expected_short = 600.0 * 0.68;
            assert!(
                (h_short - expected_short).abs() <= 1.0,
                "short window (600px) dense Mermaid preview must cap at 68% vh = {expected_short}px (dark={dark}, scale={scale:?}, got {h_short}px)"
            );
            let canvas = visual
                .debug_bounds("md-mermaid-canvas")
                .expect("Mermaid bounded scrollport canvas");
            assert!(
                f32::from(canvas.size.width) <= READING_CONTENT_WIDTH + 0.5,
                "Mermaid scrollport width must stay inside reading rail"
            );
            // Overflowing diagram image exceeds both scrollport axes (two-axis scrollable).
            let img_bounds = visual
                .debug_bounds("md-mermaid-image")
                .expect("Mermaid diagram image bounds");
            assert!(
                img_bounds.size.width > canvas.size.width
                    && img_bounds.size.height > canvas.size.height,
                "dense Mermaid diagram ({:?}) must exceed both scrollport axes ({:?}) for two-axis scrolling",
                img_bounds.size,
                canvas.size
            );
        }
    }

    // Centering check: narrow diagram sits horizontally centered inside its canvas.
    let small_src = "graph LR; T3SmallA-->T3SmallB";
    let small_doc = format!("```mermaid\n{small_src}\n```\n");
    let small_rendered = Rendered {
        image: Arc::new(RenderImage::new(vec![ImageFrame::new(rgba)])),
        width: 220.,
        height: 110.,
        baseline: 0.,
    };
    let req =
        mermaid::widget::request_for_tests(small_src, true, crate::typography::Scale::Medium, 1.0);
    render_service::seed_ready_for_tests(&req, small_rendered);
    let (small_view, visual) = setup_with_focus(cx, &small_doc, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&small_view, visual);
    let canvas = visual
        .debug_bounds("md-mermaid-canvas")
        .expect("small canvas");
    let img = visual
        .debug_bounds("md-mermaid-image")
        .expect("small image");
    let delta_x = (f32::from(img.center().x) - f32::from(canvas.center().x)).abs();
    assert!(
        delta_x <= 1.0,
        "narrow Mermaid diagram must be horizontally centered inside canvas (delta={delta_x}px)"
    );
}
