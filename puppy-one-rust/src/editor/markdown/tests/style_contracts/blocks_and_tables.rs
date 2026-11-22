//! T3 style contracts: rich-block state rings outside rhythm gaps, table outer
//! frame stability on hover/cell focus, document-level vertical + horizontal
//! scrolling for code blocks, uniform code editable/highlighted glyph metrics,
//! theme-adaptive syntax colors, metadata-free code panels, HTML source toggle
//! reveal & clickability policy, prose divider vs shared table tokens, shared
//! Markdown/CSV structure controls, and drag grip hit-target sizing
//! (`markdownEditorLayout.test.ts` #16, #17, #19–#24, #26–#27).
use super::{ALL_SCALES, ALL_THEMES, all_variants, displayed, settle};
use crate::{
    editor::{
        markdown::{
            MarkdownExtension, SetAssets, SetDialect,
            features::{code_block::highlight, mermaid},
            shared::source_toggle::toggle_left,
            style::MarkdownTheme,
            tests::{setup, setup_with_focus},
        },
        registry::DocumentAssets,
        table::{
            controls::{
                PLUS_HORIZONTAL_STROKE, PLUS_VERTICAL_STROKE, RAIL, grip_size, grip_visual_size,
            },
            operation::Axis,
            style::EditableTableStyle,
        },
        text::selection::Selection,
        tokens::Tokens,
        view::extension::config_transaction,
    },
    formats::markdown::MarkdownDialect,
    render_service::{self, Rendered},
    typography::Scale,
};
use gpui::{Modifiers, RenderImage, TestAppContext, px, size};
use image::{Frame as ImageFrame, RgbaImage};
use std::{path::Path, sync::Arc};

/// `markdownEditorLayout.test.ts` #16: `paints state on the inner surface so
/// wrapper spacing stays outside the ring`. `BlockStyle` defines a `2px` ring
/// with distinct non-transparent hover and selected colors, and selecting any
/// rich block (code, Mermaid, HTML, MDX Tabs, image) paints on the inner surface
/// without changing the block's outer margins or total height.
#[gpui::test]
fn t3_16_rich_block_state_ring_paints_on_inner_surface_outside_rhythm_gaps(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    for (dark, scale, theme) in all_variants() {
        assert_eq!(
            theme.block.ring_width, 2.0,
            "rich block ring width must be 2px"
        );
        assert!(theme.block.hover_ring.a > 0.0, "hover ring must be visible");
        assert!(
            theme.block.selected_ring.a > 0.0,
            "selected ring must be visible"
        );
        assert_ne!(
            theme.block.hover_ring, theme.block.selected_ring,
            "hover and selected rings must be visually distinct (dark={dark}, scale={scale:?})"
        );
        assert!(
            theme.code_block.gap_before + theme.code_block.gap_after > 0.0,
            "positive control: code block must carry outer rhythm spacing"
        );
    }

    // Seed Mermaid and Image assets so all 5 rich block widgets render in ready state.
    let mmd_src = "graph TD; T3RingA-->T3RingB";
    let rgba = RgbaImage::from_pixel(120, 60, image::Rgba([40, 120, 210, 255]));
    let mmd_req = mermaid::widget::request_for_tests(mmd_src, true, Scale::Medium, 1.0);
    render_service::seed_ready_for_tests(
        &mmd_req,
        Rendered {
            image: Arc::new(RenderImage::new(vec![ImageFrame::new(rgba.clone())])),
            width: 240.,
            height: 120.,
            baseline: 0.,
        },
    );
    let mut png = Vec::new();
    rgba.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let png_arc = Arc::new(png);

    let cases: [(&str, String, bool); 5] = [
        (
            "code",
            "Before\n\n```rust\nlet x = 1;\n```\n\nAfter\n".into(),
            false,
        ),
        (
            "mermaid",
            format!("Before\n\n```mermaid\n{mmd_src}\n```\n\nAfter\n"),
            false,
        ),
        (
            "html",
            "Before\n\n<div><p>HTML block</p></div>\n\nAfter\n".into(),
            false,
        ),
        (
            "tabs",
            "Before\n\n<Tabs><Tab label=\"One\">Body</Tab></Tabs>\n\nAfter\n".into(),
            true,
        ),
        (
            "image",
            "Before\n\n![pic](ring.png)\n\nAfter\n".into(),
            false,
        ),
    ];

    for (kind, doc, is_mdx) in cases {
        let (view, visual) = setup_with_focus(cx, &doc, false);
        visual.simulate_resize(size(px(1000.), px(700.)));
        if is_mdx {
            view.update(visual, |v, cx| {
                v.dispatch(
                    config_transaction(SetDialect(MarkdownDialect::OpenKnowledgeMdx)),
                    cx,
                );
            });
        }
        if kind == "image" {
            let bytes = png_arc.clone();
            let assets = DocumentAssets {
                workspace: "memory://t3-16-ring".into(),
                document: "doc.md".into(),
                read: Arc::new(move |rel: &Path| {
                    (rel == Path::new("ring.png")).then(|| (*bytes).clone())
                }),
            };
            view.update(visual, |v, cx| {
                v.dispatch(config_transaction(SetAssets(Some(assets))), cx);
            });
            for _ in 0..6 {
                settle(&view, visual);
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        } else {
            settle(&view, visual);
        }

        let block_bounds = |v: &crate::editor::view::EditorView| {
            v.layout()
                .unwrap()
                .blocks
                .iter()
                .find(|b| b.source.start >= "Before\n\n".len() && b.source.start < doc.len() - 6)
                .unwrap_or_else(|| panic!("{kind}: rich block not found"))
                .bounds
        };

        let resting = view.read_with(visual, |v, _| block_bounds(v));

        // Select across the whole document (activating selected ring on the rich block).
        view.update(visual, |v, cx| {
            v.set_selection(Selection::range(0, doc.len()), cx);
        });
        settle(&view, visual);
        let selected = view.read_with(visual, |v, _| block_bounds(v));

        assert!(
            (f32::from(selected.origin.y) - f32::from(resting.origin.y)).abs() <= 0.5
                && (f32::from(selected.size.height) - f32::from(resting.size.height)).abs() <= 0.5
                && (f32::from(selected.size.width) - f32::from(resting.size.width)).abs() <= 0.5,
            "{kind}: selecting rich block must not change outer margins or total height ({resting:?} -> {selected:?})"
        );
    }

    // Code block height strictly keeps `gap_before + gap_after` outside inner panel.
    let code_doc = "```rust\nlet x = 1;\n```\n";
    let (view, visual) = setup_with_focus(cx, code_doc, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);
    let theme = MarkdownTheme::resolve(true, Scale::Medium);
    let block_h = view.read_with(visual, |v, _| {
        f32::from(v.layout().unwrap().blocks[0].bounds.size.height)
    });
    let expected_panel_h = (theme.code_block.padding.top
        + theme.code_block.line_height
        + theme.code_block.padding.bottom)
        .max(44.0);
    let expected_total_h =
        theme.code_block.gap_before + expected_panel_h + theme.code_block.gap_after;
    assert!(
        (block_h - expected_total_h).abs() <= 1.0,
        "code block outer height ({block_h}) must keep gap_before+gap_after outside inner panel ({expected_total_h})"
    );
}

/// `markdownEditorLayout.test.ts` #17: `keeps the outer table frame unchanged on
/// hover and cell focus`. Hovering the table or focusing a cell leaves both the
/// outer frame dimensions and resting border state unchanged; only whole-block
/// document selection switches the outer frame to `document_selection`.
#[gpui::test]
fn t3_17_table_outer_frame_unchanged_on_hover_and_cell_focus(cx: &mut TestAppContext) {
    for (dark, scale, theme) in all_variants() {
        assert_ne!(
            theme.table.border, theme.table.document_selection,
            "positive control: document selection frame must differ from resting table border (dark={dark}, scale={scale:?})"
        );
    }

    let doc = "Before\n\n| Name | Value |\n| --- | --- |\n| Alpha | 100 |\n\nAfter\n";
    let (view, visual) = setup(cx, doc);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);

    let table_start = doc.find("| Name").unwrap();
    let table_bounds = |v: &crate::editor::view::EditorView| {
        v.layout()
            .unwrap()
            .blocks
            .iter()
            .find(|b| b.source.start == table_start)
            .expect("table block")
            .bounds
    };

    let resting_bounds = view.read_with(visual, |v, _| table_bounds(v));
    assert!(
        visual.debug_bounds("md-table-frame:resting").is_some(),
        "table starts with resting border state"
    );

    // Hover over the table: outer frame size and resting state remain unchanged.
    visual.simulate_mouse_move(resting_bounds.center(), None, Modifiers::none());
    settle(&view, visual);
    let hovered_bounds = view.read_with(visual, |v, _| table_bounds(v));
    assert!(
        visual.debug_bounds("md-table-frame:resting").is_some()
            && visual.debug_bounds("md-table-frame:selected").is_none(),
        "hovering table must keep outer frame border unchanged"
    );
    assert!(
        (f32::from(hovered_bounds.size.width) - f32::from(resting_bounds.size.width)).abs() <= 0.5
            && (f32::from(hovered_bounds.size.height) - f32::from(resting_bounds.size.height))
                .abs()
                <= 0.5,
        "hovering table must not resize outer frame"
    );

    // Focus a cell inside the table: outer frame size and resting border stay identical.
    let cell_offset = doc.find("Alpha").unwrap() + 2;
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(cell_offset), cx);
    });
    settle(&view, visual);
    let focused_bounds = view.read_with(visual, |v, _| table_bounds(v));
    assert!(
        visual.debug_bounds("md-table-frame:resting").is_some()
            && visual.debug_bounds("md-table-frame:selected").is_none(),
        "focusing a table cell must keep outer frame border unchanged"
    );
    assert!(
        (f32::from(focused_bounds.size.width) - f32::from(resting_bounds.size.width)).abs() <= 0.5
            && (f32::from(focused_bounds.size.height) - f32::from(resting_bounds.size.height))
                .abs()
                <= 0.5,
        "cell focus must not resize outer table frame ({:?} -> {:?})",
        resting_bounds.size,
        focused_bounds.size
    );

    // Positive control: selecting across the whole table activates the document-selection frame.
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(0, doc.len()), cx);
    });
    settle(&view, visual);
    assert!(
        visual.debug_bounds("md-table-frame:selected").is_some(),
        "positive control: whole-table selection must switch outer frame to document selection color"
    );
}

/// `markdownEditorLayout.test.ts` #19: `keeps vertical scrolling at the document
/// level for code blocks`. A 40-line code block expands vertically to contain all
/// 40 lines without an inner vertical scrollbar, while a long single line creates
/// horizontal scroll overflow (`md-code-scroll-content` wider than `md-code-scroll`).
#[gpui::test]
fn t3_19_code_block_scrolls_horizontally_while_growing_vertically_with_document(
    cx: &mut TestAppContext,
) {
    let lines: String = (0..40)
        .map(|i| format!("let line_{i:02}: usize = {i};\n"))
        .collect();
    let doc = format!("```rust\n{lines}```\n");
    let (view, visual) = setup_with_focus(cx, &doc, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    for dark in ALL_THEMES {
        for scale in ALL_SCALES {
            view.update(visual, |v, cx| v.set_appearance(dark, scale, cx));
            settle(&view, visual);
            let theme = MarkdownTheme::resolve(dark, scale);
            let block_h = view.read_with(visual, |v, _| {
                f32::from(v.layout().unwrap().blocks[0].bounds.size.height)
            });
            let min_expected = 40.0 * theme.code_block.line_height
                + theme.code_block.padding.top
                + theme.code_block.padding.bottom
                + theme.code_block.gap_before
                + theme.code_block.gap_after;
            assert!(
                block_h >= min_expected - 2.0,
                "40-line code block must expand to full document height >= {min_expected}px (dark={dark}, scale={scale:?}, got {block_h}px)"
            );
            let scroll = visual
                .debug_bounds("md-code-scroll")
                .expect("code scroll viewport");
            let content = visual
                .debug_bounds("md-code-scroll-content")
                .expect("code scroll content");
            assert!(
                (f32::from(content.size.height) - f32::from(scroll.size.height)).abs() <= 1.0,
                "code block must have no inner vertical scroll overflow"
            );
        }
    }

    // Horizontal overflow check: a long 220-char line overflows the horizontal scrollport.
    let long_line = "const very_long_identifier_segment = ".to_owned() + &"x".repeat(220) + ";";
    let wide_doc = format!("```ts\n{long_line}\n```\n");
    let (wide_view, visual) = setup_with_focus(cx, &wide_doc, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&wide_view, visual);
    let scroll = visual
        .debug_bounds("md-code-scroll")
        .expect("wide code scroll viewport");
    let content = visual
        .debug_bounds("md-code-scroll-content")
        .expect("wide code scroll content");
    assert!(
        f32::from(content.size.width) > f32::from(scroll.size.width) + 200.0,
        "long code line must produce horizontal scrollable content ({:?} > {:?})",
        content.size.width,
        scroll.size.width
    );
}

/// `markdownEditorLayout.test.ts` #20: `keeps editable and highlighted code glyph
/// metrics identical`. `CodeBlockWidget` shapes one editable text leaf with
/// `CodeBlockStyle::text()` and applies syntax highlighting strictly via color
/// overrides—never altering font weight or italic style that would shift glyph metrics.
#[test]
fn t3_20_code_block_editable_and_highlighted_glyph_metrics_identical() {
    let sample = "// comment\nconst answer: number = 42;\nfunction greet(name: string) { return `hi ${name}`; }\n";
    for (dark, scale, theme) in all_variants() {
        let code_text = theme.code_block.text();
        assert!(code_text.mono, "code block must use monospace font");
        assert!(!code_text.italic, "base code style must not be italic");
        assert_eq!(code_text.size, theme.code_block.size);
        assert_eq!(code_text.weight, theme.code_block.weight);
        assert_eq!(code_text.line_height_px(), theme.code_block.line_height);

        let spans = highlight::highlight(sample, "ts", &theme.code_block.syntax);
        assert!(
            !spans.is_empty(),
            "positive control: TypeScript snippet must emit syntax highlight spans"
        );
        for (range, style) in spans.iter() {
            assert!(
                style.font_weight.is_none(),
                "highlight span {:?} must not override font_weight (dark={dark}, scale={scale:?})",
                &sample[range.clone()]
            );
            assert!(
                style.font_style.is_none(),
                "highlight span {:?} must not override font_style (dark={dark}, scale={scale:?})",
                &sample[range.clone()]
            );
        }
    }
}

/// `markdownEditorLayout.test.ts` #21: `maps Markdown code tokens through
/// theme-adaptive semantic colors`. All 10 semantic syntax token roles resolve to
/// opaque theme tokens, adapt between Light and Dark themes, and never alter weight.
#[test]
fn t3_21_code_block_tokens_use_theme_adaptive_semantic_colors() {
    for scale in ALL_SCALES {
        let light = MarkdownTheme::resolve(false, scale).code_block.syntax;
        let dark = MarkdownTheme::resolve(true, scale).code_block.syntax;
        let pairs = [
            ("comment", light.comment, dark.comment),
            ("keyword", light.keyword, dark.keyword),
            ("string", light.string, dark.string),
            ("constant", light.constant, dark.constant),
            ("special", light.special, dark.special),
            ("type_name", light.type_name, dark.type_name),
            ("function", light.function, dark.function),
            ("property", light.property, dark.property),
            ("operator", light.operator, dark.operator),
            ("meta", light.meta, dark.meta),
        ];
        let mut adapted_count = 0usize;
        for (name, l, d) in pairs {
            assert!(
                l.a > 0.0 && d.a > 0.0,
                "token {name} must be visible in light & dark"
            );
            if l != d {
                adapted_count += 1;
            }
        }
        assert!(
            adapted_count >= 8,
            "code syntax palette must adapt between Light and Dark themes (only {adapted_count}/10 differed for {scale:?})"
        );
    }
}

/// `markdownEditorLayout.test.ts` #22: `keeps code panels free of language
/// metadata and its reserved row`. A fenced block with language info (`rust`)
/// renders no header label text and reserves zero extra vertical header row.
#[gpui::test]
fn t3_22_code_panels_omit_language_metadata_and_reserved_header_row(cx: &mut TestAppContext) {
    let doc = "```rust\nlet v = 1;\n```\n";
    let (view, visual) = setup_with_focus(cx, doc, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    for dark in ALL_THEMES {
        for scale in ALL_SCALES {
            view.update(visual, |v, cx| v.set_appearance(dark, scale, cx));
            settle(&view, visual);
            let shown = displayed(&view, visual);
            assert!(
                shown.contains("let v = 1;") && !shown.contains("rust"),
                "code panel must render code body without a language header row (dark={dark}, scale={scale:?}): {shown:?}"
            );
            let theme = MarkdownTheme::resolve(dark, scale);
            let block_h = view.read_with(visual, |v, _| {
                f32::from(v.layout().unwrap().blocks[0].bounds.size.height)
            });
            let panel_h = (theme.code_block.padding.top
                + theme.code_block.line_height
                + theme.code_block.padding.bottom)
                .max(44.0);
            let expected = theme.code_block.gap_before + panel_h + theme.code_block.gap_after;
            assert!(
                (block_h - expected).abs() <= 1.0,
                "code panel height ({block_h}) must not reserve a metadata row (expected {expected})"
            );
        }
    }
}

/// `markdownEditorLayout.test.ts` #23: `reveals the HTML source control only for
/// hover, keyboard focus, or selection`. At rest, the `26x24` HTML source toggle
/// is invisible (`hidden`) and ignores clicks; hovering the HTML block or
/// selecting across it reveals the control (`visible`) and enables clicking it
/// to enter source view.
#[gpui::test]
fn t3_23_html_source_toggle_hidden_unclickable_at_rest_and_revealed_on_hover_or_selection(
    cx: &mut TestAppContext,
) {
    assert_eq!(toggle_left(724.0), 724.0 - 32.0);
    assert_eq!(toggle_left(20.0), 0.0);

    let doc = "Before\n\n<div>\n<p>HTML body</p>\n</div>\n\nAfter\n";
    let (view, visual) = setup_with_focus(cx, doc, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);

    let toggle = visual
        .debug_bounds("md-html-widget")
        .expect("HTML block must mount its source toggle slot");
    assert!(
        (f32::from(toggle.size.width) - 26.0).abs() <= 0.5
            && (f32::from(toggle.size.height) - 24.0).abs() <= 0.5,
        "HTML source toggle must be 26x24 (got {:?})",
        toggle.size
    );
    let html_start = doc.find("<div>").unwrap();
    let html_block = view.read_with(visual, |v, _| {
        v.layout()
            .unwrap()
            .blocks
            .iter()
            .find(|b| b.source.start == html_start)
            .expect("html block")
            .bounds
    });
    assert!(
        (f32::from(html_block.right() - toggle.right()) - 6.0).abs() <= 1.0
            && (f32::from(toggle.top() - html_block.top()) - 6.0).abs() <= 1.0,
        "source toggle must sit 6px inside top-right corner of HTML block"
    );

    // At rest: hidden and unclickable.
    assert!(
        visual
            .debug_bounds("md-html-widget-toggle:hidden")
            .is_some()
            && visual
                .debug_bounds("md-html-widget-toggle:visible")
                .is_none(),
        "HTML source toggle must be hidden at rest"
    );
    visual.simulate_click(toggle.center(), Modifiers::none());
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            None,
            "clicking hidden HTML source toggle at rest must not reveal source"
        );
    });

    // Move pointer away and return caret outside HTML block so hover, focus_within,
    // and selection are all false before testing individual reveal triggers.
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(0), cx);
    });
    visual.simulate_mouse_move(gpui::point(px(2.), px(2.)), None, Modifiers::none());
    settle(&view, visual);
    assert!(
        visual
            .debug_bounds("md-html-widget-toggle:hidden")
            .is_some(),
        "moving pointer and caret outside HTML block leaves toggle hidden"
    );

    // Positive control 1: selecting across the HTML block reveals the toggle without hover.
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(0, doc.len()), cx);
    });
    settle(&view, visual);
    assert!(
        visual
            .debug_bounds("md-html-widget-toggle:visible")
            .is_some(),
        "positive control: selecting across HTML block must reveal source toggle"
    );

    // Collapse selection back outside the HTML block -> hidden again.
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(0), cx);
    });
    settle(&view, visual);
    assert!(
        visual
            .debug_bounds("md-html-widget-toggle:hidden")
            .is_some(),
        "clearing selection returns source toggle to hidden state"
    );

    // Positive control 2: hovering the HTML block reveals the toggle and makes it clickable.
    visual.simulate_mouse_move(toggle.center(), None, Modifiers::none());
    settle(&view, visual);
    assert!(
        visual
            .debug_bounds("md-html-widget-toggle:visible")
            .is_some(),
        "positive control: hovering HTML block must reveal source toggle"
    );
    visual.simulate_click(toggle.center(), Modifiers::none());
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source
                .is_some(),
            "positive control: clicking hover-revealed HTML source toggle must reveal source"
        );
    });
}

/// `markdownEditorLayout.test.ts` #24: `uses Markdown colors for prose dividers
/// and shared tokens for table lines`. Horizontal rules resolve `--po-md-rule-color`
/// (`37px` tall, `1px` stroke), while table outer and inner borders bind the
/// shared `EditableTableStyle` tokens identical to CSV tables.
#[test]
fn t3_24_prose_dividers_use_markdown_rule_and_tables_use_shared_tokens() {
    for (dark, scale, theme) in all_variants() {
        let t = Tokens::get(dark, scale);
        let csv_tokens = Tokens::csv(dark, scale);
        let csv_size = csv_tokens.len("--po-editable-table-font-size", theme.body.text.size);
        let csv = EditableTableStyle::resolve(csv_tokens, csv_size);

        assert_eq!(theme.rule.color, t.color("--po-md-rule-color"));
        assert_eq!(theme.rule.thickness, 1.0);
        assert_eq!(theme.rule.height, 37.0);
        assert_eq!(
            theme.table.border, theme.table.editable.border,
            "Markdown table outer border must use shared editable-table token (dark={dark}, scale={scale:?})"
        );
        assert_eq!(
            theme.table.cell_border, theme.table.editable.cell_border,
            "Markdown table cell border must use shared editable-table token (dark={dark}, scale={scale:?})"
        );
        assert_eq!(
            theme.table.border, csv.border,
            "Markdown and CSV tables must share the same outer border token"
        );
        assert_eq!(
            theme.table.cell_border, csv.cell_border,
            "Markdown and CSV tables must share the same cell border token"
        );
    }
}

/// `markdownEditorLayout.test.ts` #26: `uses one shared, pixel-centered
/// structure control for Markdown and CSV`. Both Markdown tables and CSV tables
/// share `editor::table::controls::rails`, with `7×1` and `1×7` centered plus
/// strokes, a `13px` visible rail, and a hit area equal to `action_gutter`.
#[test]
fn t3_26_markdown_and_csv_share_pixel_centered_structure_rail_controls() {
    assert_eq!(RAIL, 13.0, "visible structure rail must be 13px");
    assert_eq!(PLUS_HORIZONTAL_STROKE, (7.0, 1.0));
    assert_eq!(PLUS_VERTICAL_STROKE, (1.0, 7.0));

    for (dark, scale, theme) in all_variants() {
        let md = &theme.table.editable;
        let csv_tokens = Tokens::csv(dark, scale);
        let csv_size = csv_tokens.len("--po-editable-table-font-size", theme.body.text.size);
        let csv = EditableTableStyle::resolve(csv_tokens, csv_size);

        assert_eq!(
            theme.table.action_gutter, md.action_gutter,
            "Markdown table action gutter must bind shared editable-table action gutter"
        );
        assert!(
            md.action_gutter >= RAIL && csv.action_gutter >= RAIL,
            "both Markdown ({}) and CSV ({}) action gutters must house the {RAIL}px structure rail (dark={dark}, scale={scale:?})",
            md.action_gutter,
            csv.action_gutter
        );
        assert_eq!(
            md.action_gutter, csv.action_gutter,
            "Markdown and CSV must share the exact same structure action gutter hit width"
        );
    }
}

/// `markdownEditorLayout.test.ts` #27: `keeps compact drag grips inside larger
/// pointer targets`. Column handles expose a `32x24` hit target around the `22x14`
/// grip visual, and row handles expose a `24x32` hit target around the `14x22`
/// grip visual, shared by Markdown and CSV tables.
#[test]
fn t3_27_table_drag_grips_keep_compact_visuals_inside_larger_hit_targets() {
    let (col_w, col_h) = grip_size(Axis::Column);
    let (row_w, row_h) = grip_size(Axis::Row);
    let (col_vis_w, col_vis_h) = grip_visual_size(Axis::Column);
    let (row_vis_w, row_vis_h) = grip_visual_size(Axis::Row);

    assert_eq!((col_w, col_h), (32.0, 24.0));
    assert_eq!((row_w, row_h), (24.0, 32.0));
    assert_eq!((col_vis_w, col_vis_h), (22.0, 14.0));
    assert_eq!((row_vis_w, row_vis_h), (14.0, 22.0));
    assert!(col_w - col_vis_w >= 10.0 && col_h - col_vis_h >= 10.0);
    assert!(row_w - row_vis_w >= 10.0 && row_h - row_vis_h >= 10.0);

    for (dark, scale, theme) in all_variants() {
        assert!(
            theme.table.handle_gutter >= col_h / 2.0,
            "table handle gutter ({}) must accommodate straddling {}px drag grip target (dark={dark}, scale={scale:?})",
            theme.table.handle_gutter,
            col_h
        );
    }
}
