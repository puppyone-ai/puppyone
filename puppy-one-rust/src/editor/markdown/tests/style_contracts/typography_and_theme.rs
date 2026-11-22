//! T3 style contracts: theme contrast, blockquote inline foreground context,
//! reading width token, first-frame Live Preview commit, uniform Source Mode
//! typography, ordinary/empty line geometry, shared Markdown/HTML presentation
//! profile, emphasis weight parity, and math render-request font isolation
//! (`markdownEditorLayout.test.ts` #0, #1, #2, #4, #5, #8, #12, #13 and
//! `markdownMathTypographyContract.test.ts` #0, plus a native guard for #1).
use super::{
    ALL_SCALES, ALL_THEMES, all_variants, contrast_ratio, decorate_markdown, displayed, settle,
};
use crate::{
    editor::{
        markdown::{
            SetLivePreview,
            core::{decorations, presentation::classes::Class},
            features::html::render::resolved_strong_weight,
            features::{math, mermaid},
            style::{
                cascade::{self, LineInput},
                marks,
            },
            tests::{blocks, setup, setup_with_focus},
        },
        tokens::Tokens,
        view::{
            decoration::{Block, packed},
            extension::config_transaction,
            style::LineHeight,
        },
    },
    render_service::{self, Kind, Request},
    theme::metric::READING_CONTENT_WIDTH,
};
use gpui::{TestAppContext, px, size};

/// `markdownEditorLayout.test.ts` #0: `keeps supporting quotes quieter than body
/// copy in every theme`. Across all 6 theme/scale combinations, blockquote text
/// has lower WCAG contrast against the Markdown surface background than body
/// text, and the blockquote left border is softer (lower contrast) than `--po-divider`.
#[test]
fn t3_00_quotes_quieter_than_body_and_divider_in_every_theme() {
    for (dark, scale, theme) in all_variants() {
        let bg = theme.surface.background;
        let divider = crate::theme::Theme::new(dark).divider;
        let body_contrast = contrast_ratio(theme.body.text.color, bg);
        let quote_text_contrast = contrast_ratio(theme.quote.color, bg);
        let divider_contrast = contrast_ratio(divider, bg);
        let quote_border_contrast = contrast_ratio(theme.quote.border_color, bg);

        assert!(
            body_contrast > 4.5,
            "positive control: body text must have strong readability contrast (dark={dark}, scale={scale:?}, ratio={body_contrast:.2})"
        );
        assert!(
            divider_contrast > 1.05,
            "positive control: divider must be visible against surface background (dark={dark}, scale={scale:?}, ratio={divider_contrast:.2})"
        );
        assert!(
            quote_text_contrast < body_contrast,
            "quote text ({quote_text_contrast:.2}) must be quieter than body text ({body_contrast:.2}) for dark={dark}, scale={scale:?}"
        );
        assert!(
            quote_border_contrast < divider_contrast,
            "quote border ({quote_border_contrast:.2}) must be softer than divider ({divider_contrast:.2}) for dark={dark}, scale={scale:?}"
        );
        assert!(
            quote_border_contrast < body_contrast,
            "quote border ({quote_border_contrast:.2}) must be quieter than body text ({body_contrast:.2}) for dark={dark}, scale={scale:?}"
        );
    }
}

/// `markdownEditorLayout.test.ts` #1: `publishes one inline foreground context
/// instead of quote-specific descendant overrides`. Inside blockquotes, strong,
/// emphasis, strikethrough, and inline code take the quote foreground; outside
/// blockquotes, strong takes `strong_color` and inline code inherits `code_color`
/// (`None` / `currentColor` -> body color). List markers resolve `--po-md-list-marker-color`.
#[test]
fn t3_01_blockquote_publishes_single_inline_foreground_context() {
    for (dark, scale, theme) in all_variants() {
        let (body_style, body_ctx) = cascade::line(
            &theme,
            &LineInput {
                classes: Class::NONE,
                level: 0,
                list: None,
                live: true,
            },
        );
        let (quote_style, quote_ctx) = cascade::line(
            &theme,
            &LineInput {
                classes: Class::BLOCKQUOTE,
                level: 0,
                list: None,
                live: true,
            },
        );

        assert_eq!(
            body_ctx.foreground, None,
            "body line sets no quote override"
        );
        assert_eq!(
            quote_ctx.foreground,
            Some(theme.quote.color),
            "blockquote publishes quote color as the single inline foreground context"
        );
        assert_eq!(body_style.text.color, theme.body.text.color);
        assert_eq!(quote_style.text.color, theme.quote.color);
        assert_eq!(
            theme.inline.code_color, None,
            "inline code must inherit currentColor instead of defining an override"
        );

        for (role_name, cls, expected_body) in [
            ("strong", Class::SYNTAX_STRONG, theme.inline.strong_color),
            (
                "emphasis",
                Class::SYNTAX_EMPHASIS,
                theme.inline.emphasis_color,
            ),
            ("strike", Class::SYNTAX_STRIKE, theme.inline.strike_color),
        ] {
            let body_mark = marks::marks(&theme, cls, &body_ctx, None, true);
            let quote_mark = marks::marks(&theme, cls, &quote_ctx, None, true);
            assert_eq!(
                body_mark.color,
                Some(packed(expected_body)),
                "positive control: plain {role_name} uses its role color (dark={dark}, scale={scale:?})"
            );
            assert_eq!(
                quote_mark.color,
                Some(packed(theme.quote.color)),
                "blockquote {role_name} must inherit single quote foreground (dark={dark}, scale={scale:?})"
            );
        }

        // Inline code inherits `currentColor` (`mark.color == None`), so effective color
        // equals line text color (`quote.color` inside quote, `body.text.color` outside).
        let body_code = marks::marks(&theme, Class::SYNTAX_MONOSPACE, &body_ctx, None, true);
        let quote_code = marks::marks(&theme, Class::SYNTAX_MONOSPACE, &quote_ctx, None, true);
        assert!(body_code.code && quote_code.code);
        assert_eq!(body_code.color, None);
        assert_eq!(quote_code.color, None);

        // End-to-end decoration check on real Markdown source comparing quote vs plain prose.
        let decos = decorate_markdown(
            "**bold** `code`\n\n> **qbold** *qem* `qcode`\n\n- item\n",
            dark,
            scale,
            true,
        );
        let plain_strong = decos
            .marks
            .iter()
            .find(|m| m.style.bold && m.range.start < 15)
            .expect("positive control: plain bold mark");
        assert_eq!(
            plain_strong.style.color,
            Some(packed(theme.inline.strong_color))
        );
        let quote_line_start = "**bold** `code`\n\n".len();
        let quote_marks: Vec<_> = decos
            .marks
            .iter()
            .filter(|m| m.range.start >= quote_line_start && (m.style.bold || m.style.italic))
            .collect();
        assert!(
            !quote_marks.is_empty(),
            "positive control: blockquote must emit inline bold/italic marks"
        );
        for m in quote_marks {
            assert_eq!(
                m.style.color,
                Some(packed(theme.quote.color)),
                "decorated mark inside blockquote must inherit quote foreground"
            );
        }
        let quote_code_mark = decos
            .marks
            .iter()
            .find(|m| m.range.start >= quote_line_start && m.style.code)
            .expect("positive control: blockquote must emit inline code mark");
        assert_eq!(
            quote_code_mark.style.color, None,
            "inline code inside blockquote inherits line's quote.color"
        );
        assert_eq!(
            theme.list.marker_color,
            Tokens::get(dark, scale).color("--po-md-list-marker-color")
        );
    }
}

/// `markdownEditorLayout.test.ts` #2: `shares its reading width with other
/// document-like product surfaces`. Markdown's `SurfaceStyle::text_width` and
/// `decorations::surface().max_text_width` resolve to the shared `724px`
/// `READING_CONTENT_WIDTH` token across all themes and text scales.
#[test]
fn t3_02_reading_width_matches_shared_document_token() {
    assert_eq!(READING_CONTENT_WIDTH, 724.0);
    for (dark, scale, theme) in all_variants() {
        assert_eq!(
            theme.surface.text_width, READING_CONTENT_WIDTH,
            "SurfaceStyle::text_width must match READING_CONTENT_WIDTH (dark={dark}, scale={scale:?})"
        );
        let surface = decorations::surface(&theme);
        assert_eq!(
            surface.max_text_width,
            Some(READING_CONTENT_WIDTH),
            "decorations::surface max_text_width must expose the shared reading width"
        );
        let tokens = Tokens::get(dark, scale);
        assert_eq!(
            tokens.len("--po-markdown-editor-text-width", theme.body.text.size),
            READING_CONTENT_WIDTH
        );
    }
}

/// `markdownEditorLayout.test.ts` #4: `keeps canonical Markdown source invisible
/// until Live Preview commits`. On the very first rendered frame (no warmup pass),
/// Live Preview hides Markdown delimiters immediately rather than flashing raw
/// source first; Source Mode serves as the positive control showing raw delimiters.
#[gpui::test]
fn t3_04_live_preview_first_frame_hides_source_without_flash(cx: &mut TestAppContext) {
    let source = "# Heading Title\n\nSome **bold** and *italic* text.\n";
    let (view, visual) = setup_with_focus(cx, source, false);
    visual.simulate_resize(size(px(1000.), px(700.)));

    // First draw frame (no prior draw): Live Preview must already hide `# `, `**`, `*`.
    let _ = blocks(&view, visual);
    let first_hidden = view.read_with(visual, |v, _| v.decorations().hidden.clone());
    assert!(
        first_hidden.contains(&(0..2)),
        "frame 1 must hide heading `# ` delimiter without source flash: {first_hidden:?}"
    );
    let first_text = displayed(&view, visual);
    assert!(
        !first_text.contains("# Heading") && !first_text.contains("**bold**"),
        "frame 1 Live Preview must not display raw Markdown syntax: {first_text:?}"
    );
    assert!(first_text.contains("Heading Title") && first_text.contains("bold"));

    // Positive control: Source Mode reveals the raw syntax delimiters immediately.
    view.update(visual, |v, cx| {
        v.dispatch(config_transaction(SetLivePreview(false)), cx);
    });
    settle(&view, visual);
    let source_text = displayed(&view, visual);
    assert!(
        source_text.contains("# Heading Title") && source_text.contains("**bold**"),
        "positive control: Source Mode must expose raw delimiters: {source_text:?}"
    );
}

/// `markdownEditorLayout.test.ts` #5: `keeps Markdown source mode typography
/// uniform`. In Source Mode (`live = false`), every line across headings, inline
/// emphasis, code fences, blockquotes, and lists renders with uniform body font
/// size, line weight, non-italic, non-mono, body color, and no underlines or
/// hidden delimiters; all neutralized inline roles (`strong`, `emphasis`, `link`,
/// `monospace`, `strike`, `source-syntax-*`) collapse to plain typography (while
/// `SYNTAX_HEADING` bold follows TS `markdown-editor.css` & `style/headings.md`).
#[test]
fn t3_05_source_mode_typography_is_uniform_across_all_syntax() {
    let doc = "# Heading 1\n\n## Heading 2\n\n**bold** *italic* ~~strike~~ `code` [link](a.md)\n\n> blockquote\n\n- bullet item\n\n```rust\nfn main() {}\n```\n";
    for (dark, scale, theme) in all_variants() {
        let live = decorate_markdown(doc, dark, scale, true);
        let source = decorate_markdown(doc, dark, scale, false);

        // Positive control: Live Preview differentiates headings and inline marks.
        assert!(
            !live.marks.is_empty() && !live.hidden.is_empty(),
            "positive control: Live Preview must emit marks and hidden delimiters"
        );
        let live_h1_size = match &live.blocks[0] {
            Block::Line { style, .. } => style.text.size,
            _ => panic!("expected heading line in Live Preview"),
        };
        assert!(
            live_h1_size > theme.body.text.size,
            "positive control: Live Preview h1 must be larger than body text"
        );

        assert!(source.hidden.is_empty(), "Source Mode must hide nothing");
        assert!(
            source.underlines.is_empty(),
            "Source Mode must add no underlines"
        );
        let (_, body_ctx) = cascade::line(
            &theme,
            &LineInput {
                classes: Class::NONE,
                level: 0,
                list: None,
                live: false,
            },
        );
        for cls in [
            Class::SYNTAX_STRONG,
            Class::SYNTAX_EMPHASIS,
            Class::SYNTAX_LINK,
            Class::SYNTAX_MONOSPACE,
            Class::SYNTAX_STRIKE,
            Class::SOURCE_SYNTAX_HEADING,
            Class::SOURCE_SYNTAX_LIST,
            Class::SOURCE_SYNTAX_TASK,
        ] {
            let m = marks::marks(&theme, cls, &body_ctx, None, false);
            assert!(
                m.is_plain(),
                "Source Mode must neutralize {cls:?} to plain typography (dark={dark}, scale={scale:?}): {m:?}"
            );
        }
        let non_heading_start = doc.find("**bold**").unwrap();
        for m in &source.marks {
            assert!(
                !m.style.italic
                    && !m.style.strike
                    && !m.style.underline
                    && !m.style.code
                    && m.style.link.is_none()
                    && m.style.color.is_none()
                    && m.style.highlight.is_none(),
                "Source Mode mark must never set italic/strike/underline/code/link/color: {m:?}"
            );
            assert!(
                m.range.end <= non_heading_start,
                "Source Mode must emit zero marks on strong/emphasis/strike/code/link/quote/list/fence lines: {m:?}"
            );
        }
        let first_weight = match &source.blocks[0] {
            Block::Line { style, .. } => style.text.weight,
            _ => panic!("expected plain line block"),
        };
        for block in &source.blocks {
            let Block::Line { style, .. } = block else {
                panic!(
                    "Source Mode must render plain line blocks only (dark={dark}, scale={scale:?})"
                );
            };
            assert_eq!(style.text.size, theme.body.text.size);
            assert_eq!(style.text.weight, first_weight);
            assert!(!style.text.italic);
            assert!(!style.text.mono);
            assert_eq!(style.text.color, theme.body.text.color);
            assert!(!style.strike);
        }
    }
}

/// `markdownEditorLayout.test.ts` #8: `keeps ordinary editable-line geometry
/// independent of empty-line DOM`. Body line height (`1.75`), source line gap
/// (`0.25em`), and list item gap (`0px`) hold across all variants, and empty
/// lines share identical row height and rhythm with ordinary flowing lines.
#[gpui::test]
fn t3_08_ordinary_line_geometry_independent_of_empty_lines(cx: &mut TestAppContext) {
    for (dark, scale, theme) in all_variants() {
        assert_eq!(
            theme.body.text.line_height,
            LineHeight::Factor(1.75),
            "body line height must stay 1.75 (dark={dark}, scale={scale:?})"
        );
        assert!(
            (theme.body.source_line_gap - 0.25 * theme.body.text.size).abs() < 0.05,
            "source_line_gap must be 0.25em (dark={dark}, scale={scale:?})"
        );
        assert_eq!(
            theme.list.item_gap, 0.0,
            "list item gap must stay 0px (dark={dark}, scale={scale:?})"
        );

        let decos = decorate_markdown("First line\nSecond line\n\nThird line\n", dark, scale, true);
        let line_style = |idx: usize| match &decos.blocks[idx] {
            Block::Line { style, .. } => style,
            _ => panic!("expected plain line block at {idx}"),
        };
        let ordinary = line_style(0);
        let empty = line_style(2);
        assert_eq!(
            empty.text.line_height_px(),
            ordinary.text.line_height_px(),
            "empty line must keep identical line height to ordinary line"
        );
        assert_eq!(
            empty.padding.bottom, theme.body.source_line_gap,
            "empty line must keep standard source_line_gap without special-casing"
        );
    }

    let doc = "First ordinary line\nSecond line\n\nFourth ordinary line\n";
    let (view, visual) = setup(cx, doc);
    visual.simulate_resize(size(px(1000.), px(700.)));
    for dark in ALL_THEMES {
        for scale in ALL_SCALES {
            view.update(visual, |v, cx| v.set_appearance(dark, scale, cx));
            settle(&view, visual);
            let heights: Vec<f32> = view.read_with(visual, |v, _| {
                let l = v.layout().expect("settled layout");
                let line0 = l.caret(0, false).row_height;
                let empty_off = doc.find("\n\n").unwrap() + 1;
                let line_empty = l.caret(empty_off, false).row_height;
                vec![f32::from(line0), f32::from(line_empty)]
            });
            assert!(
                (heights[0] - heights[1]).abs() <= 0.5,
                "rendered empty line height ({}) must match ordinary line ({}) for dark={dark}, scale={scale:?}",
                heights[1],
                heights[0]
            );
        }
    }
}

/// `markdownEditorLayout.test.ts` #12: `uses one semantic presentation profile
/// without a second HTML widget gap`. Native Markdown headings (`h1`–`h3`) and
/// HTML headings consume the exact same `MarkdownTheme` tokens (size, weight,
/// no visible bottom border/underline), and `HtmlBlockWidget` adds zero extra
/// wrapper padding around its rendered surface.
#[gpui::test]
fn t3_12_html_and_native_markdown_share_one_presentation_profile(cx: &mut TestAppContext) {
    for (dark, scale, theme) in all_variants() {
        assert_eq!(
            theme.heading.border.a, 0.0,
            "h1/h2 must have no visible underline/bottom border in Neutral theme (dark={dark}, scale={scale:?})"
        );
        let decos = decorate_markdown("# H1\n\n## H2\n\n### H3\n\nParagraph\n", dark, scale, true);
        let mut heading_lines = decos.blocks.iter().filter_map(|b| match b {
            Block::Line { style, .. } if style.text.size > theme.body.text.size => Some(style),
            _ => None,
        });
        for level in 1..=3 {
            let style = heading_lines.next().expect("heading line");
            let expected = theme.heading.level(level);
            assert_eq!(style.text.size, expected.size, "h{level} size");
            assert_eq!(style.text.weight, expected.weight, "h{level} weight");
            assert_eq!(
                style.padding.top, expected.gap_before,
                "h{level} gap_before"
            );
            assert_eq!(
                style.padding.bottom, expected.gap_after,
                "h{level} gap_after"
            );
            assert_eq!(
                style.text.line_height,
                LineHeight::Factor(theme.heading.line_height),
                "h{level} line_height"
            );
            if let Some((_, border_color)) = style.inset_bottom {
                assert_eq!(
                    border_color.a, 0.0,
                    "h{level} must not paint a visible bottom rule"
                );
            }
        }
        assert!(decos.marks.iter().all(|m| !m.style.underline));
        assert!(theme.heading.level(1).size > theme.heading.level(2).size);
        assert!(theme.heading.level(2).size > theme.heading.level(3).size);
        assert!(theme.heading.level(3).size >= theme.body.text.size);
    }

    let html_doc = "<div>\n<h1>HTML Heading</h1>\n<p>Body copy</p>\n</div>\n";
    let (view, visual) = setup_with_focus(cx, html_doc, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);
    let block_bounds = view.read_with(visual, |v, _| v.layout().unwrap().blocks[0].bounds);
    let surface_bounds = visual
        .debug_bounds("md-html-rendered-surface")
        .expect("rendered HTML surface bounds");
    assert!(
        (f32::from(surface_bounds.top()) - f32::from(block_bounds.top())).abs() <= 0.5,
        "HTML widget must not add a second top wrapper padding (block_top={:?}, surface_top={:?})",
        block_bounds.top(),
        surface_bounds.top()
    );
    assert!(
        (f32::from(surface_bounds.left()) - f32::from(block_bounds.left())).abs() <= 0.5,
        "HTML widget must align flush with the reading column"
    );
}

/// `markdownEditorLayout.test.ts` #13: `keeps emphasis weight consistent across
/// Markdown presentation adapters`. Strong weight uses `theme.inline.strong_weight`
/// across body Markdown, inline HTML `<b>`, HTML block `<strong>`, and table body
/// cells, while strong spans inside headings and `<th>` headers inherit the
/// heading/header weight rather than downgrading it.
#[test]
fn t3_13_emphasis_weight_consistent_across_markdown_html_and_tables() {
    for (dark, scale, theme) in all_variants() {
        assert!(
            theme.inline.strong_weight > theme.body.text.weight,
            "positive control: strong_weight ({}) must exceed body weight ({}) for dark={dark}, scale={scale:?}",
            theme.inline.strong_weight,
            theme.body.text.weight
        );
        let (_, body_ctx) = cascade::line(
            &theme,
            &LineInput {
                classes: Class::NONE,
                level: 0,
                list: None,
                live: true,
            },
        );
        let body_strong = marks::marks(&theme, Class::SYNTAX_STRONG, &body_ctx, None, true);
        assert!(body_strong.bold, "body strong must activate bold weight");

        // Inline HTML `<b>` maps to the exact same bold mark as Markdown `**bold**`.
        let inline_html = decorate_markdown("<b>html</b> and **md**\n", dark, scale, true);
        let bold_marks: Vec<_> = inline_html.marks.iter().filter(|m| m.style.bold).collect();
        assert_eq!(
            bold_marks.len(),
            2,
            "inline HTML <b> and Markdown **bold** must emit identical bold marks"
        );

        // HTML surface `<strong>` / `<b>`: upgrades body weight to strong_weight,
        // while preserving heavier container weights (`<th>` = 650, or h1..h6).
        assert_eq!(
            resolved_strong_weight(theme.body.text.weight, theme.inline.strong_weight),
            theme.inline.strong_weight
        );
        assert_eq!(
            resolved_strong_weight(theme.table.header_weight, theme.inline.strong_weight),
            theme.table.header_weight,
            "<strong> inside HTML <th> must preserve header_weight ({}) instead of downgrading to strong_weight ({})",
            theme.table.header_weight,
            theme.inline.strong_weight
        );

        // Heading strong mark inherits heading weight (does NOT double-bold).
        for level in 1..=6u8 {
            let (_, heading_ctx) = cascade::line(
                &theme,
                &LineInput {
                    classes: Class::HEADING,
                    level,
                    list: None,
                    live: true,
                },
            );
            let heading_strong =
                marks::marks(&theme, Class::SYNTAX_STRONG, &heading_ctx, None, true);
            assert!(
                !heading_strong.bold,
                "strong inside h{level} must inherit heading weight rather than overriding"
            );
            assert_eq!(
                resolved_strong_weight(
                    theme.heading.level(level as usize).weight,
                    theme.inline.strong_weight
                ),
                theme.heading.level(level as usize).weight
            );
        }

        // Markdown table cells: body cells inherit body weight (so bold reaches strong_weight),
        // while header cells use `table.header_weight` (`650 >= 600`) and do not downgrade or double-bold.
        let header_style = theme.table.cell_text(true, theme.body.text.weight);
        let body_cell_style = theme.table.cell_text(false, theme.body.text.weight);
        assert_eq!(header_style.weight, theme.table.header_weight);
        assert_eq!(body_cell_style.weight, theme.body.text.weight);
        assert!(header_style.weight >= theme.inline.strong_weight);
    }
}

/// `markdownMathTypographyContract.test.ts` #0: `keeps editor prose fonts from
/// reaching math widgets`. Production KaTeX render requests (`Kind::Math`) and
/// their JSON payloads carry only display mode, color, and font size—never the
/// editor's prose font family—whereas Mermaid render requests (`Kind::Mermaid`)
/// do carry `fontFamily` (positive control).
#[test]
fn t3_math_00_prose_fonts_do_not_reach_math_render_requests() {
    for (dark, scale, _theme) in all_variants() {
        let math_req = math::widget::request_for_tests("E = mc^2", dark, scale);
        match &math_req.kind {
            Kind::Math {
                display,
                color,
                font_size,
            } => {
                assert!(*display);
                assert!(color.starts_with('#'));
                assert!(*font_size > 0.);
            }
            Kind::Mermaid { .. } => panic!("expected Kind::Math"),
        }
        let math_payload = render_service::payload_for_tests(&math_req);
        for forbidden in [
            "fontFamily",
            "font-family",
            "Geist",
            "PT Serif",
            "Open Sans",
        ] {
            assert!(
                !math_payload.contains(forbidden),
                "math payload must not carry prose font {forbidden:?} (dark={dark}, scale={scale:?}): {math_payload}"
            );
        }

        // Positive control: Mermaid requests DO carry a fontFamily config token.
        let mermaid_req = mermaid::widget::request_for_tests("graph TD; A-->B", dark, scale, 1.0);
        let mermaid_payload = render_service::payload_for_tests(&mermaid_req);
        assert!(
            mermaid_payload.contains("fontFamily") && mermaid_payload.contains("Geist"),
            "positive control: Mermaid payload must carry fontFamily (dark={dark}, scale={scale:?}): {mermaid_payload}"
        );
    }
}

/// Native companion guard for `markdownMathTypographyContract.test.ts` #1
/// (`leaves math font-role mapping to the upstream KaTeX stylesheet`, retained
/// as out-of-scope because KaTeX's bundled stylesheet inside the render service
/// owns math font mapping): asserts that neither inline nor display math render
/// requests constructed by the native Rust frontend ever inject font families or
/// KaTeX glyph-role overrides into the render-service IPC payload.
#[test]
fn t3_math_01_native_frontend_never_injects_font_into_math_render_requests() {
    for (dark, scale, theme) in all_variants() {
        let t = Tokens::get(dark, scale);
        let display_req = math::widget::request_for_tests(r"\sum_{i=1}^n i^2", dark, scale);
        let inline_req = Request {
            kind: Kind::Math {
                display: false,
                color: render_service::hex(t.color("--po-md-content-color")),
                font_size: t.len("--po-md-math-inline-font-size", theme.body.text.size),
            },
            source: r"\alpha + \beta".into(),
            background: render_service::hex(t.color("--po-editor-bg")),
            scale: 1.,
        };
        for (label, req) in [("display", display_req), ("inline", inline_req)] {
            let json: serde_json::Value =
                serde_json::from_str(&render_service::payload_for_tests(&req))
                    .expect("valid render-service JSON payload");
            let obj = json.as_object().expect("JSON object payload");
            assert_eq!(obj.get("kind").and_then(|v| v.as_str()), Some("math"));
            for key in obj.keys() {
                assert!(
                    !key.to_ascii_lowercase().contains("font") || key == "fontSize",
                    "{label} math payload must only pass fontSize, never font family/override (got key {key:?}): {json}"
                );
            }
            let raw = json.to_string();
            assert!(
                !raw.contains("KaTeX_") && !raw.contains("fontFamily"),
                "{label} math payload must not override KaTeX font roles: {raw}"
            );
        }
    }
}
