//! Port of `AgentMarkdownDocument` (react-markdown + remark-gfm) with the
//! `.desktop-agent-markdown` rules of `styles/transcript.css`: block margins
//! collapse like CSS, lists hang their markers outside the 1.55em indent,
//! tables use Chromium's auto layout inside a 12px scrollbar gutter, and code
//! blocks carry the language toolbar. Inline content is `RichText`. The
//! message names its language (`lang`, from its script), whose script faces
//! its text takes.
mod code;
mod inline;
mod mermaid;
mod parse;
mod table;

use super::agent_rich_text::{CODE_PAD, ChipGeometry, RichText};
use crate::ui::components::Icon;
use crate::{theme, theme::Theme};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::ops::Range;

use code::*;
use inline::*;
use mermaid::*;
use parse::*;
use table::*;

pub struct Context<'a> {
    pub t: Theme,
    pub key: String,
    pub order: u64,
    pub window: &'a mut Window,
    pub app: &'a mut App,
    /// Width of the block being laid out (tables need it for auto layout).
    pub width: f32,
    /// The text alignment of the table column being laid out.
    pub align: Option<TextAlign>,
}

fn em(value: f32) -> f32 {
    value * theme::ty().left.content
}

/// (top, bottom) margins of a block before collapsing (`transcript.css`).
fn margins(block: &Block) -> (f32, f32) {
    match block {
        Block::Paragraph { tight: true, .. } => (0., 0.),
        Block::Paragraph { .. } => (4., 4.),
        Block::Heading(_) => (8., 4.),
        Block::List { depth, .. } if *depth > 1 => (em(0.24), em(0.24)),
        Block::List { .. } => (em(0.5), em(0.5)),
        Block::Quote(_) => (em(0.8), em(0.8)),
        Block::Code { .. } | Block::Table { .. } => (10., 10.),
        Block::Rule => (16., 16.),
        // `[data-footnotes] { margin-top: 16px }`.
        Block::Footnotes(_) => (16., 0.),
        Block::FootnoteDefinition(..) => (0., 0.),
    }
}
const ITEM_MARGIN: f32 = 0.18;

/// Margins that collapse through a block's edge (no padding/border there).
fn edge_top(block: &Block) -> f32 {
    margins(block).0.max(inner_top(block))
}
fn edge_bottom(block: &Block) -> f32 {
    margins(block).1.max(inner_bottom(block))
}
fn inner_top(block: &Block) -> f32 {
    match block {
        Block::List { items, .. } => items.first().map_or(0., |i| {
            em(ITEM_MARGIN).max(i.blocks.first().map_or(0., edge_top))
        }),
        Block::Quote(children) => children.first().map_or(0., edge_top),
        _ => 0.,
    }
}
fn inner_bottom(block: &Block) -> f32 {
    match block {
        Block::List { items, .. } => items.last().map_or(0., |i| {
            em(ITEM_MARGIN).max(i.blocks.last().map_or(0., edge_bottom))
        }),
        Block::Quote(children) => children.last().map_or(0., edge_bottom),
        _ => 0.,
    }
}

/// Renders an Agent answer `width` wide. `key` identifies the message.
pub fn render(
    text: &str,
    t: Theme,
    key: &str,
    order: u64,
    width: f32,
    window: &mut Window,
    app: &mut App,
) -> Div {
    let a = super::agent_theme::AgentTheme::new(&t);
    let parsed = parse(text);
    let language = language(text);
    let selector = format!("agent-markdown-lang:{language}");
    let mut cx = Context {
        t,
        key: key.to_owned(),
        order,
        window,
        app,
        width,
        align: None,
    };
    let top = parsed.first().map_or(0., inner_top);
    let bottom = parsed.last().map_or(0., inner_bottom);
    let content =
        crate::ui::fonts::with_content_language(Some(&language), || flow(&parsed, &mut cx, "root"));
    div()
        .debug_selector(move || selector)
        .w_full()
        .min_w_0()
        .pt(px(top))
        .pb(px(bottom))
        .text_color(a.text_muted)
        .child(content)
}

/// `resolveMarkdownContentLanguage(text, locale)`: the message's language,
/// from its own script before the interface's.
pub fn language(text: &str) -> SharedString {
    crate::editor::markdown::resolve_content_language(
        text,
        &crate::localization::current().code,
        None,
    )
    .language
    .into()
}

/// Children with collapsed gaps between them.
fn flow(children: &[Block], cx: &mut Context<'_>, path: &str) -> Div {
    let mut column = div().flex().flex_col().w_full().min_w_0();
    for (index, block) in children.iter().enumerate() {
        let gap = if index == 0 {
            0.
        } else {
            edge_bottom(&children[index - 1]).max(edge_top(block))
        };
        column = column.child(div().w_full().min_w_0().mt(px(gap)).child(render_block(
            block,
            cx,
            &format!("{path}.{index}"),
        )));
    }
    column
}

fn text_style(size: f32, line_height: f32, color: Rgba) -> TextStyleRefinement {
    TextStyleRefinement {
        font_family: Some(crate::theme::sans().into()),
        font_fallbacks: Some(crate::ui::fonts::fallbacks(
            crate::typography::fonts::Category::Sans,
        )),
        font_size: Some(px(size).into()),
        line_height: Some(px(line_height).into()),
        color: Some(color.into()),
        ..Default::default()
    }
}

fn rich(
    inlines: &[Inline],
    preserve: bool,
    weight: FontWeight,
    size: f32,
    line_height: f32,
    cx: &mut Context<'_>,
    path: &str,
) -> AnyElement {
    let a = super::agent_theme::AgentTheme::new(&cx.t);
    // `code { padding: 0.12em 0.34em; border: 1px }` at 13px around a 14px line.
    let code = theme::ty().right.code;
    let (ascent, descent) = (1005. / 1000. * code, 295. / 1000. * code);
    let baseline = (line_height - (1005. + 295.) / 1000. * size) / 2. + 1005. / 1000. * size;
    let chip = ChipGeometry {
        top: baseline - ascent - 0.12 * code - 1.,
        height: ascent + descent + 2. * (0.12 * code + 1.),
        fill: a.inline_code_surface.into(),
        border: a.inline_code_border.into(),
        radius: 6.,
    };
    let palette = Palette {
        text: a.text_muted,
        strong: a.text_muted,
    };
    let mut out = (String::new(), vec![], vec![], vec![]);
    flatten(
        inlines,
        preserve,
        palette,
        &mut out,
        (weight, false, false, None),
    );
    if out.0.is_empty() {
        return div().h(px(line_height)).into_any_element();
    }
    cx.order += 1;
    RichText::new(
        SharedString::from(format!("{}:{path}", cx.key)),
        out.0.into(),
        out.1,
        TextStyleRefinement {
            text_align: cx.align,
            ..text_style(size, line_height, a.text_muted)
        },
    )
    .document_order(cx.order)
    .chips(out.2, chip)
    .links(out.3)
    .selection_color(cx.t.selection.into())
    .into_any_element()
}

fn render_block(block: &Block, cx: &mut Context<'_>, path: &str) -> AnyElement {
    let t = cx.t;
    let a = super::agent_theme::AgentTheme::new(&t);
    let size = theme::ty().left.content;
    let line = size * 1.6;
    match block {
        Block::Paragraph { inlines, tight } => {
            rich(inlines, !tight, FontWeight::NORMAL, size, line, cx, path)
        }
        Block::Heading(inlines) => rich(inlines, false, FontWeight::SEMIBOLD, size, line, cx, path),
        Block::Rule => div()
            .w_full()
            .h(px(1.))
            .bg(a.border_subtle)
            .into_any_element(),
        Block::Quote(children) => {
            let outer = cx.width;
            cx.width = outer - 14.;
            let content = flow(children, cx, path);
            cx.width = outer;
            div()
                .pl(px(12.))
                .border_l_2()
                .border_color(t.border_strong)
                .child(content)
                .into_any_element()
        }
        Block::List {
            start,
            items,
            depth,
        } => {
            let task_list = items.iter().any(|i| i.task.is_some());
            let indent = if task_list { em(0.25) } else { em(1.55) };
            let mut list = div().flex().flex_col().pl(px(indent)).w_full().min_w_0();
            for (index, item) in items.iter().enumerate() {
                let gap = if index == 0 {
                    0.
                } else {
                    em(ITEM_MARGIN)
                        .max(items[index - 1].blocks.last().map_or(0., edge_bottom))
                        .max(em(ITEM_MARGIN).max(item.blocks.first().map_or(0., edge_top)))
                };
                let item_path = format!("{path}.{index}");
                let outer = cx.width;
                cx.width = outer - indent - if item.task.is_some() { 21. } else { 0. };
                let content = flow(&item.blocks, cx, &item_path);
                cx.width = outer;
                let inner_top = item.blocks.first().map_or(0., inner_top);
                let element = if let Some(checked) = item.task {
                    // `.task-list-item`: a 14px disabled checkbox, 7px gap.
                    div()
                        .flex()
                        .items_start()
                        .gap(px(7.))
                        .child(checkbox(checked, &t).mt(px(em(0.28) + inner_top)))
                        .child(div().flex_1().min_w_0().child(content))
                } else {
                    // Chromium draws disc/circle/square markers as shapes ≈ 0.32em wide,
                    // centred 0.3em above the baseline and 0.75em before the content;
                    // ordered markers are the text "N. " ending at the content edge.
                    let baseline = (line - 1.3 * size) / 2. + 1.005 * size;
                    let marker: AnyElement = match start {
                        Some(first) => div()
                            .absolute()
                            .top(px(inner_top))
                            .left(px(-indent))
                            .w(px(indent))
                            .flex()
                            .justify_end()
                            .child(rich(
                                &[Inline::Text(format!("{}. ", first + index as u64))],
                                true,
                                FontWeight::NORMAL,
                                size,
                                line,
                                cx,
                                &format!("{item_path}.marker"),
                            ))
                            .into_any_element(),
                        None => {
                            let diameter = 0.32 * size;
                            let shape = div()
                                .absolute()
                                .top(px(inner_top + baseline - 0.3 * size - diameter / 2.))
                                .left(px(-0.75 * size - diameter / 2.))
                                .size(px(diameter));
                            match depth {
                                1 => shape.rounded_full().bg(a.text_muted),
                                2 => shape.rounded_full().border_1().border_color(a.text_muted),
                                _ => shape.bg(a.text_muted),
                            }
                            .into_any_element()
                        }
                    };
                    div().relative().child(marker).child(content)
                };
                list = list.child(div().w_full().min_w_0().mt(px(gap)).child(element));
            }
            list.into_any_element()
        }
        // `agentMarkdownBlockRegistry`: `mermaid` fences are diagrams.
        Block::Code { language, text } if language == "mermaid" => mermaid(text, cx, path),
        Block::Code { language, text } => code_block(language, text, cx, path),
        Block::Table { head, rows, align } => table(head, rows, align, cx, path),
        // `section[data-footnotes]`: a rule, then the footnotes in order.
        Block::Footnotes(notes) => {
            let list = Block::List {
                start: Some(1),
                items: notes
                    .iter()
                    .map(|blocks| Item {
                        task: None,
                        blocks: blocks.clone(),
                    })
                    .collect(),
                depth: 1,
            };
            div()
                .debug_selector(|| "agent-markdown-footnotes".into())
                .w_full()
                .min_w_0()
                .pt(px(8.))
                .border_t_1()
                .border_color(a.border_subtle)
                .child(render_block(&list, cx, path))
                .into_any_element()
        }
        Block::FootnoteDefinition(..) => div().into_any_element(),
    }
}

fn checkbox(checked: bool, t: &Theme) -> Div {
    div()
        .size(px(14.))
        .flex_shrink_0()
        .rounded(px(3.))
        .border_1()
        .border_color(t.border_strong)
        .when(checked, |d| d.bg(t.accent).border_color(t.accent))
        .opacity(0.7)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn block_margins_collapse_like_the_product_document() {
        // artifacts/workbench-reference/chat-transcript-*.json: p → ul 7px,
        // li → li 2.52px, ul → table 10px.
        let blocks = parse("Two follow-ups:\n\n- one\n- two\n\n| A | B |\n| - | - |\n| c | d |");
        assert_eq!(blocks.len(), 3);
        let gap = |a: &Block, b: &Block| edge_bottom(a).max(edge_top(b));
        assert!((gap(&blocks[0], &blocks[1]) - 7.).abs() < 0.01);
        assert!((gap(&blocks[1], &blocks[2]) - 10.).abs() < 0.01);
        let Block::List { items, .. } = &blocks[1] else {
            panic!("list")
        };
        assert_eq!(items.len(), 2);
        assert!(matches!(
            items[0].blocks[0],
            Block::Paragraph { tight: true, .. }
        ));
        // A leading list keeps its first item's margin inside the answer.
        assert!((inner_top(&parse("- a")[0]) - em(ITEM_MARGIN)).abs() < 0.01);
    }
    #[test]
    fn inline_code_and_links_flatten_into_runs_chips_and_targets() {
        let blocks =
            parse("Use `pad` and [docs](https://example.com) or [x](javascript:alert(1)).");
        let Block::Paragraph { inlines, .. } = &blocks[0] else {
            panic!("paragraph")
        };
        let palette = Palette {
            text: Rgba::default(),
            strong: Rgba::default(),
        };
        let mut out = (String::new(), vec![], vec![], vec![]);
        flatten(
            inlines,
            true,
            palette,
            &mut out,
            (FontWeight::NORMAL, false, false, None),
        );
        assert!(out.0.contains(&format!("{CODE_PAD}pad{CODE_PAD}")));
        assert_eq!(out.2.len(), 1);
        assert_eq!(out.3.len(), 1, "only the https link is navigable");
        assert_eq!(out.1.iter().map(|r| r.len).sum::<usize>(), out.0.len());
    }
    /// `Agent Markdown renderer`: GFM tables, task lists, nested lists,
    /// strikethrough and rules parse into their blocks; raw HTML stays text,
    /// an unsafe link is no link and an image is only its alt text; a
    /// `mermaid` fence is kept for the diagram.
    #[test]
    fn gfm_blocks_parse_and_unsafe_content_stays_inert() {
        let blocks = parse("| Level | Action |\n| :--- | :---: |\n| 1 | Read |\n| 2 | Open |");
        let Block::Table { head, rows, .. } = &blocks[0] else {
            panic!("table")
        };
        assert_eq!((head.len(), rows.len()), (2, 2));
        let blocks = parse("- [x] Done\n- [ ] Next\n  - Nested\n\n~~obsolete~~\n\n---");
        let Block::List { items, .. } = &blocks[0] else {
            panic!("list")
        };
        assert_eq!(
            items.iter().map(|i| i.task).collect::<Vec<_>>(),
            [Some(true), Some(false)]
        );
        assert!(
            items[1]
                .blocks
                .iter()
                .any(|b| matches!(b, Block::List { depth: 2, .. })),
            "nested under its item"
        );
        let Block::Paragraph { inlines, .. } = &blocks[1] else {
            panic!("paragraph")
        };
        assert!(matches!(&inlines[0], Inline::Strike(_)));
        assert_eq!(blocks[2], Block::Rule);
        let blocks = parse(
            "<script>window.pwned = true</script>\n\n[unsafe](javascript:alert(1))\n\n![tracking pixel](https://tracker.example/pixel.png)",
        );
        let text = format!("{blocks:?}");
        assert!(text.contains("<script>"), "raw HTML stays text: {text}");
        let palette = Palette {
            text: Rgba::default(),
            strong: Rgba::default(),
        };
        let mut targets = 0;
        let mut images = vec![];
        for block in &blocks {
            if let Block::Paragraph { inlines, .. } = block {
                let mut out = (String::new(), vec![], vec![], vec![]);
                flatten(
                    inlines,
                    true,
                    palette,
                    &mut out,
                    (FontWeight::NORMAL, false, false, None),
                );
                targets += out.3.len();
                images.extend(inlines.iter().filter_map(|i| match i {
                    Inline::Image(alt) => Some(alt.clone()),
                    _ => None,
                }));
            }
        }
        assert_eq!(targets, 0, "no navigable link");
        assert_eq!(images, ["tracking pixel"]);
        let blocks = parse("```mermaid\ngraph TD; A-->B\n```");
        assert_eq!(
            blocks[0],
            Block::Code {
                language: "mermaid".into(),
                text: "graph TD; A-->B".into()
            }
        );
    }
    /// `supports task lists, nested lists, strikethrough, autolinks, rules,
    /// and footnotes`: a bare URL is a link to its normalized address, and
    /// a referenced footnote is numbered where it is used and listed after
    /// the answer.
    #[test]
    fn bare_urls_link_and_footnotes_follow_the_answer() {
        let blocks = parse(
            "- [x] Done\n- [ ] Next\n  - Nested\n\n~~obsolete~~\n\nhttps://example.com\n\n---\n\nNote[^1]\n\n[^1]: Detail",
        );
        let Block::List { items, .. } = &blocks[0] else {
            panic!("list")
        };
        assert_eq!(
            items.iter().map(|i| i.task).collect::<Vec<_>>(),
            [Some(true), Some(false)]
        );
        assert!(
            items[1]
                .blocks
                .iter()
                .any(|b| matches!(b, Block::List { depth: 2, .. }))
        );
        let Block::Paragraph { inlines, .. } = &blocks[1] else {
            panic!("strike")
        };
        assert!(matches!(&inlines[0], Inline::Strike(_)));
        let Block::Paragraph { inlines, .. } = &blocks[2] else {
            panic!("autolink")
        };
        let [Inline::Link(href, text)] = &inlines[..] else {
            panic!("{inlines:?}")
        };
        assert_eq!(plain(text), "https://example.com");
        assert_eq!(safe_href(href).as_deref(), Some("https://example.com/"));
        assert_eq!(blocks[3], Block::Rule);
        let Block::Paragraph { inlines, .. } = &blocks[4] else {
            panic!("reference")
        };
        assert_eq!(
            inlines,
            &[Inline::Text("Note".into()), Inline::FootnoteRef("1".into())]
        );
        let Block::Footnotes(notes) = blocks.last().unwrap() else {
            panic!("footnotes")
        };
        assert_eq!(notes.len(), 1);
        assert!(format!("{:?}", notes[0]).contains("Detail"));
        assert_eq!(blocks.len(), 6, "the definition left the flow");
        // An unreferenced definition is not listed.
        assert!(
            !parse("Text\n\n[^x]: Orphan")
                .iter()
                .any(|b| matches!(b, Block::Footnotes(_)))
        );
    }

    /// GFM's autolink literals, without a sentence's trailing punctuation.
    #[test]
    fn autolink_literals_end_where_the_address_does() {
        let links = |text: &str| -> Vec<(String, String)> {
            autolink(text)
                .into_iter()
                .filter_map(|i| match i {
                    Inline::Link(href, text) => Some((href, plain(&text))),
                    _ => None,
                })
                .collect()
        };
        let pair = |href: &str, text: &str| (href.to_owned(), text.to_owned());
        assert_eq!(
            links("Visit www.example.com."),
            [pair("http://www.example.com", "www.example.com")]
        );
        assert_eq!(
            links("(see https://a.example/x?y=1)!"),
            [pair("https://a.example/x?y=1", "https://a.example/x?y=1")]
        );
        assert_eq!(
            links("Wiki https://en.wikipedia.org/wiki/Rust_(language) ok"),
            [pair(
                "https://en.wikipedia.org/wiki/Rust_(language)",
                "https://en.wikipedia.org/wiki/Rust_(language)"
            )]
        );
        assert_eq!(
            links("mail me@example.com, please"),
            [pair("mailto:me@example.com", "me@example.com")]
        );
        assert!(links("https://localhost and xhttps://a.example").is_empty());
        assert_eq!(
            plain(&autolink("go to https://a.example.")),
            "go to https://a.example."
        );
    }

    /// `renders semantic GFM tables inside a bounded horizontal viewport`:
    /// each column keeps its authored alignment.
    #[test]
    fn table_columns_keep_their_authored_alignment() {
        let blocks = parse(
            "| Level | Action | Meaning |\n| :--- | :---: | ---: |\n| 1 | Read | Distribute |\n| 2 | Open | Activate |",
        );
        let Block::Table { head, rows, align } = &blocks[0] else {
            panic!("table")
        };
        assert_eq!((head.len(), rows.len()), (3, 2));
        assert_eq!(align, &[Align::Left, Align::Center, Align::Right]);
        assert_eq!(
            align.iter().map(|a| text_align(*a)).collect::<Vec<_>>(),
            [
                Some(TextAlign::Left),
                Some(TextAlign::Center),
                Some(TextAlign::Right)
            ]
        );
        assert_eq!(text_align(Align::None), None);
        assert!(plain(&rows[1][2]).contains("Activate"));
    }

    struct Answer(&'static str);
    impl Render for Answer {
        fn render(
            &mut self,
            window: &mut Window,
            cx: &mut gpui::Context<Self>,
        ) -> impl IntoElement {
            use crate::ui::appearance::ActiveAppearance as _;
            let t = cx.palette();
            div()
                .w(px(240.))
                .child(super::render(self.0, t, "answer", 0, 240., window, cx))
        }
    }

    /// `uses the message language for locale-aware reading typography` and
    /// the bounded table viewport: a Chinese answer names `zh-Hans` and its
    /// text takes that script's faces; a wide table's viewport takes
    /// keyboard focus and scrolls with the arrows.
    #[gpui::test]
    fn an_answer_names_its_language_and_its_table_viewport_takes_the_keyboard(
        cx: &mut gpui::TestAppContext,
    ) {
        use crate::ui::fonts::test_support::take_asked;
        cx.update(gpui_kit::init);
        crate::localization::set_current("en");
        assert_eq!(
            language("用户访谈已经完成，接下来修复编辑器问题。"),
            "zh-Hans"
        );
        assert_eq!(language("Release notes"), "en");
        let (_, cx) = cx.add_window_view(|_, _| Answer("用户访谈已经完成，接下来修复编辑器问题。"));
        take_asked();
        cx.update(|w, cx| {
            w.refresh();
            w.draw(cx).clear(cx);
        });
        assert!(cx.debug_bounds("agent-markdown-lang:zh-Hans").is_some());
        assert_eq!(take_asked(), [Some("zh-Hans".into())]);

        let wide = "| A | B | C | D |\n| :--- | :---: | ---: | - |\n| aaaaaaaaaaaaaaaaaaaa | bbbbbbbbbbbbbbbbbbbb | cccccccccccccccccccc | dddddddddddddddddddd |";
        let (_, cx) = cx.add_window_view(|_, _| Answer(wide));
        let draw = |cx: &mut gpui::VisualTestContext| {
            cx.update(|w, cx| {
                w.refresh();
                w.draw(cx).clear(cx);
            })
        };
        draw(cx);
        let viewport = cx.debug_bounds("agent-markdown-table-scroll").unwrap();
        let grid = |cx: &mut gpui::VisualTestContext| {
            cx.debug_bounds("agent-markdown-table-grid")
                .unwrap()
                .origin
                .x
        };
        let start = grid(cx);
        assert!(
            cx.debug_bounds("agent-markdown-table-grid")
                .unwrap()
                .size
                .width
                > viewport.size.width,
            "the table is wider than its viewport"
        );
        // Not focused yet: the arrows move nothing.
        cx.simulate_keystrokes("right");
        draw(cx);
        assert_eq!(grid(cx), start);
        // The viewport is a tab stop; focused, the arrows scroll it.
        cx.update(|w, cx| w.focus_next(cx));
        draw(cx);
        cx.simulate_keystrokes("right");
        draw(cx);
        assert_eq!(grid(cx), start - px(40.));
        cx.simulate_keystrokes("left left");
        draw(cx);
        assert_eq!(grid(cx), start, "never before the start");
    }

    #[test]
    fn table_columns_share_extra_width_in_proportion() {
        assert_eq!(column_widths(&[100., 100.], 300.), vec![150., 150.]);
        assert_eq!(column_widths(&[200., 300.], 400.), vec![200., 300.]);
    }
}
