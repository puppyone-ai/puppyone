//! Port of `AgentMarkdownDocument` (react-markdown + remark-gfm) with the
//! `.desktop-agent-markdown` rules of `styles/transcript.css`: block margins
//! collapse like CSS, lists hang their markers outside the 1.55em indent,
//! tables use Chromium's auto layout inside a 12px scrollbar gutter, and code
//! blocks carry the language toolbar. Inline content is `RichText`.
use super::agent_rich_text::{CODE_FAMILY, CODE_PAD, ChipGeometry, RichText};
use crate::ui::components::Icon;
use crate::{theme, theme::Theme};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use std::ops::Range;

#[derive(Clone, Debug, PartialEq)]
enum Inline {
    Text(String),
    Code(String),
    Strong(Vec<Inline>),
    Emphasis(Vec<Inline>),
    Strike(Vec<Inline>),
    Link(String, Vec<Inline>),
    Image(String),
    SoftBreak,
    HardBreak,
}

#[derive(Clone, Debug, PartialEq)]
enum Block {
    /// `tight`: a list item's bare text (no `<p>`, no margins, normal white-space).
    Paragraph {
        inlines: Vec<Inline>,
        tight: bool,
    },
    Heading(Vec<Inline>),
    List {
        start: Option<u64>,
        items: Vec<Item>,
        depth: usize,
    },
    Quote(Vec<Block>),
    Code {
        language: String,
        text: String,
    },
    Table {
        head: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
    },
    Rule,
}

#[derive(Clone, Debug, PartialEq)]
struct Item {
    task: Option<bool>,
    blocks: Vec<Block>,
}

fn parse(text: &str) -> Vec<Block> {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let mut parser = Parser::new_ext(text, options).peekable();
    blocks(&mut parser, None, 0)
}

fn blocks<'a>(
    events: &mut std::iter::Peekable<Parser<'a>>,
    until: Option<TagEnd>,
    depth: usize,
) -> Vec<Block> {
    let mut out = vec![];
    let mut loose: Vec<Inline> = vec![];
    let flush = |out: &mut Vec<Block>, loose: &mut Vec<Inline>| {
        if !loose.is_empty() {
            out.push(Block::Paragraph {
                inlines: std::mem::take(loose),
                tight: true,
            });
        }
    };
    while let Some(event) = events.next() {
        match event {
            Event::End(end) if Some(end) == until => break,
            Event::Start(Tag::Paragraph) => {
                flush(&mut out, &mut loose);
                out.push(Block::Paragraph {
                    inlines: inlines(events, TagEnd::Paragraph),
                    tight: false,
                });
            }
            Event::Start(Tag::Heading { level, .. }) => {
                flush(&mut out, &mut loose);
                out.push(Block::Heading(inlines(events, TagEnd::Heading(level))));
            }
            Event::Start(Tag::List(start)) => {
                flush(&mut out, &mut loose);
                let mut items = vec![];
                while let Some(event) = events.next() {
                    match event {
                        Event::Start(Tag::Item) => {
                            let mut task = None;
                            if let Some(Event::TaskListMarker(checked)) = events.peek() {
                                task = Some(*checked);
                                events.next();
                            }
                            items.push(Item {
                                task,
                                blocks: blocks(events, Some(TagEnd::Item), depth + 1),
                            });
                        }
                        Event::End(TagEnd::List(_)) => break,
                        _ => {}
                    }
                }
                out.push(Block::List {
                    start,
                    items,
                    depth: depth + 1,
                });
            }
            Event::Start(Tag::BlockQuote(_)) => {
                flush(&mut out, &mut loose);
                out.push(Block::Quote(blocks(
                    events,
                    Some(TagEnd::BlockQuote(None)),
                    depth,
                )));
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                flush(&mut out, &mut loose);
                let language = match kind {
                    CodeBlockKind::Fenced(info) => {
                        info.split_whitespace().next().unwrap_or("").to_lowercase()
                    }
                    CodeBlockKind::Indented => String::new(),
                };
                let mut text = String::new();
                for event in events.by_ref() {
                    match event {
                        Event::Text(t) => text.push_str(&t),
                        Event::End(TagEnd::CodeBlock) => break,
                        _ => {}
                    }
                }
                out.push(Block::Code {
                    language,
                    text: text.trim_end_matches('\n').to_owned(),
                });
            }
            Event::Start(Tag::Table(_alignments)) => {
                flush(&mut out, &mut loose);
                let (mut head, mut rows, mut row) = (vec![], vec![], vec![]);
                let mut in_head = false;
                while let Some(event) = events.next() {
                    match event {
                        Event::Start(Tag::TableHead) => in_head = true,
                        Event::End(TagEnd::TableHead) => {
                            in_head = false;
                            head = std::mem::take(&mut row);
                        }
                        Event::Start(Tag::TableCell) => {
                            row.push(inlines(events, TagEnd::TableCell))
                        }
                        Event::End(TagEnd::TableRow) if !in_head => {
                            rows.push(std::mem::take(&mut row))
                        }
                        Event::End(TagEnd::Table) => break,
                        _ => {}
                    }
                }
                out.push(Block::Table { head, rows });
            }
            Event::Rule => {
                flush(&mut out, &mut loose);
                out.push(Block::Rule);
            }
            // Raw HTML is shown as text (react-markdown does not render it).
            Event::Html(html) | Event::InlineHtml(html) => {
                loose.push(Inline::Text(html.to_string()))
            }
            Event::Text(t) => loose.push(Inline::Text(t.to_string())),
            Event::Code(c) => loose.push(Inline::Code(c.to_string())),
            Event::SoftBreak => loose.push(Inline::SoftBreak),
            Event::HardBreak => loose.push(Inline::HardBreak),
            Event::Start(
                tag @ (Tag::Strong
                | Tag::Emphasis
                | Tag::Strikethrough
                | Tag::Link { .. }
                | Tag::Image { .. }),
            ) => {
                loose.push(inline_container(events, tag));
            }
            _ => {}
        }
    }
    flush(&mut out, &mut loose);
    out
}

fn inline_container<'a>(events: &mut std::iter::Peekable<Parser<'a>>, tag: Tag<'a>) -> Inline {
    match tag {
        Tag::Strong => Inline::Strong(inlines(events, TagEnd::Strong)),
        Tag::Emphasis => Inline::Emphasis(inlines(events, TagEnd::Emphasis)),
        Tag::Strikethrough => Inline::Strike(inlines(events, TagEnd::Strikethrough)),
        Tag::Link { dest_url, .. } => {
            Inline::Link(dest_url.to_string(), inlines(events, TagEnd::Link))
        }
        Tag::Image { .. } => {
            let alt = inlines(events, TagEnd::Image);
            Inline::Image(plain(&alt))
        }
        _ => Inline::Text(String::new()),
    }
}

fn inlines<'a>(events: &mut std::iter::Peekable<Parser<'a>>, end: TagEnd) -> Vec<Inline> {
    let mut out = vec![];
    while let Some(event) = events.next() {
        match event {
            Event::End(e) if e == end => break,
            Event::Text(t) => out.push(Inline::Text(t.to_string())),
            Event::Code(c) => out.push(Inline::Code(c.to_string())),
            Event::Html(h) | Event::InlineHtml(h) => out.push(Inline::Text(h.to_string())),
            Event::SoftBreak => out.push(Inline::SoftBreak),
            Event::HardBreak => out.push(Inline::HardBreak),
            Event::Start(tag) => out.push(inline_container(events, tag)),
            _ => {}
        }
    }
    out
}

fn plain(inlines: &[Inline]) -> String {
    inlines
        .iter()
        .map(|i| match i {
            Inline::Text(t) | Inline::Code(t) | Inline::Image(t) => t.clone(),
            Inline::Strong(c) | Inline::Emphasis(c) | Inline::Strike(c) | Inline::Link(_, c) => {
                plain(c)
            }
            Inline::SoftBreak | Inline::HardBreak => " ".into(),
        })
        .collect()
}

/// Product link policy (`classifyAgentMarkdownHref`): only web and mail links open.
fn safe_href(url: &str) -> Option<SharedString> {
    let lower = url.trim().to_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:"))
        .then(|| url.trim().to_owned().into())
}

#[derive(Clone, Copy)]
struct Palette {
    text: Rgba,
    strong: Rgba,
}

/// Flattened inline text: content, styled runs, code-chip ranges and links.
type Flattened = (
    String,
    Vec<TextRun>,
    Vec<Range<usize>>,
    Vec<(Range<usize>, SharedString)>,
);

/// Flattens inlines into text, runs, chip and link ranges (`white-space` per block).
fn flatten(
    inlines: &[Inline],
    preserve: bool,
    palette: Palette,
    out: &mut Flattened,
    style: (FontWeight, bool, bool, Option<SharedString>),
) {
    let (weight, italic, strike, link) = style.clone();
    let font = |family: &str, weight: FontWeight| Font {
        family: family.to_owned().into(),
        weight,
        style: if italic {
            FontStyle::Italic
        } else {
            FontStyle::Normal
        },
        ..Font::default()
    };
    let push = |out: &mut Flattened, text: &str, f: Font, color: Rgba| {
        if text.is_empty() {
            return;
        }
        let start = out.0.len();
        out.0.push_str(text);
        out.1.push(TextRun {
            len: text.len(),
            font: f,
            color: color.into(),
            background_color: None,
            underline: link.as_ref().map(|_| UnderlineStyle {
                thickness: px(1.),
                color: Some(color.into()),
                wavy: false,
            }),
            strikethrough: strike.then(|| StrikethroughStyle {
                thickness: px(1.),
                color: Some(color.into()),
            }),
        });
        if let Some(url) = &link {
            out.3.push((start..out.0.len(), url.clone()));
        }
    };
    let color = if weight.0 >= 600. {
        palette.strong
    } else {
        palette.text
    };
    for inline in inlines {
        match inline {
            Inline::Text(t) => {
                let text = if preserve {
                    t.clone()
                } else {
                    t.split_whitespace().collect::<Vec<_>>().join(" ")
                        + if t.ends_with(char::is_whitespace) && !t.trim().is_empty() {
                            " "
                        } else {
                            ""
                        }
                };
                let text =
                    if !preserve && t.starts_with(char::is_whitespace) && !t.trim().is_empty() {
                        format!(" {text}")
                    } else {
                        text
                    };
                push(out, &text, font("Geist", weight), color)
            }
            Inline::Code(code) => {
                let start = out.0.len();
                push(
                    out,
                    &format!("{CODE_PAD}{code}{CODE_PAD}"),
                    font(CODE_FAMILY, FontWeight::NORMAL),
                    palette.text,
                );
                out.2.push(start..out.0.len());
            }
            Inline::Image(alt) => push(out, alt, font("Geist", weight), color),
            Inline::SoftBreak => push(
                out,
                if preserve { "\n" } else { " " },
                font("Geist", weight),
                color,
            ),
            Inline::HardBreak => push(out, "\n", font("Geist", weight), color),
            Inline::Strong(children) => flatten(
                children,
                preserve,
                palette,
                out,
                (FontWeight::SEMIBOLD, italic, strike, link.clone()),
            ),
            Inline::Emphasis(children) => flatten(
                children,
                preserve,
                palette,
                out,
                (weight, true, strike, link.clone()),
            ),
            Inline::Strike(children) => flatten(
                children,
                preserve,
                palette,
                out,
                (weight, italic, true, link.clone()),
            ),
            Inline::Link(url, children) => flatten(
                children,
                preserve,
                palette,
                out,
                (weight, italic, strike, safe_href(url).or(link.clone())),
            ),
        }
    }
}

pub struct Context<'a> {
    pub t: Theme,
    pub key: String,
    pub order: u64,
    pub window: &'a mut Window,
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
pub fn render(text: &str, t: Theme, key: &str, order: u64, width: f32, window: &mut Window) -> Div {
    let a = super::agent_theme::AgentTheme::new(&t);
    let parsed = parse(text);
    let mut cx = Context {
        t,
        key: key.to_owned(),
        order,
        window,
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

/// `AgentMarkdownSourceBlock`: language toolbar with copy, then the source.
fn code_block(language: &str, text: &str, cx: &mut Context<'_>, path: &str) -> AnyElement {
    let t = cx.t;
    let a = super::agent_theme::AgentTheme::new(&t);
    let copy = text.to_owned();
    let language = if language.is_empty() {
        "text".to_owned()
    } else {
        language.to_owned()
    };
    let code = theme::ty().right.code;
    let label: SharedString = crate::localization::t("common.action.copy").into();
    div()
        .w_full()
        .min_w_0()
        .overflow_hidden()
        .border_1()
        .border_color(a.border)
        .rounded(px(10.))
        .bg(a.code_surface)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .min_h(px(theme::control()))
                .pt(px(3.))
                .pr(px(6.))
                .pb(px(3.))
                .pl(px(11.))
                .border_b_1()
                .border_color(a.border_subtle)
                .text_color(a.text_subtle)
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .font_family(theme::MONO)
                        .text_size(px(theme::ty().right.caption))
                        .child(language),
                )
                .child(
                    gpui_kit::base::Button::new(SharedString::from(format!(
                        "{}:{path}:copy",
                        cx.key
                    )))
                    .accessibility_label(label.clone())
                    .size(px(theme::control_small()))
                    .rounded(px(6.))
                    .text_color(a.text_subtle)
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(a.text))
                    .tooltip(crate::ui::components::tooltip(label))
                    .child(Icon::new("copy").small().stroke(2.).color(a.text_subtle))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()))
                    }),
                ),
        )
        .child(
            div()
                .id(SharedString::from(format!("{}:{path}:pre", cx.key)))
                .max_h(px(360.))
                .overflow_scroll()
                .px(px(12.))
                .py(px(10.))
                .font_family(theme::MONO)
                .text_size(px(code))
                .line_height(px(code * 1.5))
                .text_color(a.text_muted)
                .whitespace_nowrap()
                .child(text.replace('\t', "  ")),
        )
        .into_any_element()
}

/// Chromium auto table layout for `width: max-content; min-width: 100%`:
/// columns start at their max-content width (cells capped at 280px of content,
/// padded 9px each side) and share any extra width in proportion.
fn column_widths(maxima: &[f32], available: f32) -> Vec<f32> {
    let total: f32 = maxima.iter().sum();
    if total <= 0. {
        return maxima.to_vec();
    }
    if total >= available {
        return maxima.to_vec();
    }
    maxima
        .iter()
        .map(|m| m + (available - total) * m / total)
        .collect()
}

fn table(
    head: &[Vec<Inline>],
    rows: &[Vec<Vec<Inline>>],
    cx: &mut Context<'_>,
    path: &str,
) -> AnyElement {
    let t = cx.t;
    let a = super::agent_theme::AgentTheme::new(&t);
    let size = theme::ty().left.meta;
    let line = size * 1.5;
    let columns = head.len().max(rows.iter().map(Vec::len).max().unwrap_or(0));
    // Max-content per column, measured with the product faces.
    let measure = |inlines: &[Inline], bold: bool, window: &mut Window| -> f32 {
        let text = plain(inlines);
        let font = Font {
            family: "Geist".into(),
            weight: if bold {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            },
            ..Font::default()
        };
        let run = TextRun {
            len: text.len(),
            font,
            color: Hsla::default(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        f32::from(
            window
                .text_system()
                .shape_line(text.into(), px(size), &[run], None)
                .width,
        )
    };
    let mut maxima = vec![0f32; columns];
    for (c, cell) in head.iter().enumerate() {
        maxima[c] = maxima[c].max(measure(cell, true, cx.window).clamp(76., 280.) + 18.);
    }
    for row in rows {
        for (c, cell) in row.iter().enumerate() {
            maxima[c] = maxima[c].max(measure(cell, false, cx.window).clamp(76., 280.) + 18.);
        }
    }
    // The table fills the answer width inside the wrapper border and the
    // 12px gutter `scrollbar-gutter: stable` reserves.
    let widths = column_widths(&maxima, cx.width - 2. - 12.);
    let cell = |content: AnyElement, width: f32, last_col: bool, last_row: bool, header: bool| {
        div()
            .w(px(width))
            .flex_shrink_0()
            .px(px(9.))
            .py(px(7.))
            .when(!last_col, |d| d.border_r_1())
            .when(!last_row, |d| d.border_b_1())
            .border_color(a.border_subtle)
            .when(header, |d| d.bg(a.table_header_surface))
            .child(content)
    };
    let mut all_rows: Vec<(Vec<Vec<Inline>>, bool)> = vec![];
    if !head.is_empty() {
        all_rows.push((head.to_vec(), true));
    }
    all_rows.extend(rows.iter().map(|r| (r.clone(), false)));
    let row_count = all_rows.len();
    let mut grid = div().flex().flex_col();
    for (r, (cells, header)) in all_rows.iter().enumerate() {
        // `tbody tr:nth-child(even)`.
        let body_index = if head.is_empty() {
            r
        } else {
            r.saturating_sub(1)
        };
        let mut row = div().flex().when(!header && body_index % 2 == 1, |d| {
            d.bg(a.table_alternate_surface)
        });
        for (c, &width) in widths.iter().enumerate().take(columns) {
            let inlines = cells.get(c).cloned().unwrap_or_default();
            let weight = if *header {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            };
            let content = rich(
                &inlines,
                false,
                weight,
                size,
                line,
                cx,
                &format!("{path}.{r}.{c}"),
            );
            row = row.child(cell(
                content,
                width,
                c + 1 == columns,
                r + 1 == row_count,
                *header,
            ));
        }
        grid = grid.child(row);
    }
    div()
        .id(SharedString::from(format!("{}:{path}:table", cx.key)))
        .w_full()
        .overflow_x_scroll()
        .border_1()
        .border_color(a.border_subtle)
        .rounded(px(8.))
        .bg(a.markdown_disclosure_surface)
        .pr(px(12.))
        .child(grid)
        .into_any_element()
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
