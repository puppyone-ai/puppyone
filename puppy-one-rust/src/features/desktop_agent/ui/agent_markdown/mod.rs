//! Port of `AgentMarkdownDocument` (react-markdown + remark-gfm) with the
//! `.desktop-agent-markdown` rules of `styles/transcript.css`: block margins
//! collapse like CSS, lists hang their markers outside the 1.55em indent,
//! tables use Chromium's auto layout inside a 12px scrollbar gutter, and code
//! blocks carry the language toolbar. Inline content is `RichText`.
mod code;
mod inline;
mod mermaid;
mod parse;
mod table;

use super::agent_rich_text::{CODE_FAMILY, CODE_PAD, ChipGeometry, RichText};
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
    let mut cx = Context {
        t,
        key: key.to_owned(),
        order,
        window,
        app,
        width,
    };
    let top = parsed.first().map_or(0., inner_top);
    let bottom = parsed.last().map_or(0., inner_bottom);
    div()
        .w_full()
        .min_w_0()
        .pt(px(top))
        .pb(px(bottom))
        .text_color(a.text_muted)
        .child(flow(&parsed, &mut cx, "root"))
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
        font_family: Some("Geist".into()),
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
        text_style(size, line_height, a.text_muted),
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
        Block::Table { head, rows } => table(head, rows, cx, path),
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
    #[test]
    fn table_columns_share_extra_width_in_proportion() {
        assert_eq!(column_widths(&[100., 100.], 300.), vec![150., 150.]);
        assert_eq!(column_widths(&[200., 300.], 400.), vec![200., 300.]);
    }
}
