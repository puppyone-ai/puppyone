//! `.cm-md-html-rendered-surface` (markdown-content.css): an HTML block's
//! elements with the product's prose roles — headings, paragraphs, lists
//! on the marker rail, quotes, code panels, the table profile, rules,
//! `details` that open and close, links, images through the Markdown asset
//! policy, inline SVG, and `align` / `<center>` / `style` alignment and
//! colours. `audio` and `video` show a placeholder naming their source.
use super::dom::{Element, Node};
use crate::editor::{
    markdown::{
        features::image::{cache, source},
        style::MarkdownTheme,
    },
    registry::DocumentAssets,
    tokens::{Tokens, parse_css_color},
    view::{editor::EditorView, render::RenderCx, style::TextStyle},
};
use gpui::{prelude::*, *};
use std::{cell::RefCell, collections::HashSet, path::Path};

thread_local! {
    /// `details` opened in this session, by block and order.
    static OPEN: RefCell<HashSet<(usize, usize)>> = RefCell::new(HashSet::new());
}

/// The inherited text of a subtree.
#[derive(Clone)]
struct Inherit {
    text: TextStyle,
    align: TextAlign,
    link: Option<String>,
    mono: bool,
    background: Option<Rgba>,
    underline: bool,
    strike: bool,
}

pub struct Surface<'s, 'r, 'a> {
    pub theme: &'s MarkdownTheme,
    pub assets: Option<&'s DocumentAssets>,
    pub document: &'s Path,
    pub view: WeakEntity<EditorView>,
    /// The block's identity (its source start), for element ids and state.
    pub block: usize,
    pub render: &'r mut RenderCx<'a>,
    details: usize,
    ids: usize,
}

/// What an inline flow holds: text runs and atoms.
enum Piece {
    Text(String, Inherit),
    Break,
    Atom(AnyElement),
}

fn heading_level(tag: &str) -> Option<usize> {
    let b = tag.as_bytes();
    (b.len() == 2 && b[0] == b'h' && (b'1'..=b'6').contains(&b[1])).then(|| (b[1] - b'0') as usize)
}

fn is_block(tag: &str) -> bool {
    heading_level(tag).is_some()
        || matches!(
            tag,
            "address"
                | "article"
                | "aside"
                | "blockquote"
                | "center"
                | "dd"
                | "details"
                | "div"
                | "dl"
                | "dt"
                | "fieldset"
                | "figcaption"
                | "figure"
                | "footer"
                | "header"
                | "hgroup"
                | "hr"
                | "li"
                | "main"
                | "nav"
                | "ol"
                | "p"
                | "pre"
                | "section"
                | "summary"
                | "table"
                | "ul"
                | "video"
                | "audio"
        )
}

fn align_of(e: &Element, inherited: TextAlign) -> TextAlign {
    let style_align = e.attribute("style").and_then(|s| {
        s.split(';').find_map(|d| {
            let (k, v) = d.split_once(':')?;
            (k.trim().eq_ignore_ascii_case("text-align")).then(|| v.trim().to_ascii_lowercase())
        })
    });
    let value = style_align.or_else(|| e.attribute("align").map(str::to_ascii_lowercase));
    match value.as_deref() {
        Some("center") => TextAlign::Center,
        Some("right") => TextAlign::Right,
        Some("left") => TextAlign::Left,
        _ if e.tag == "center" => TextAlign::Center,
        _ => inherited,
    }
}

fn style_color(e: &Element, property: &str) -> Option<Rgba> {
    let style = e.attribute("style")?;
    style.split(';').find_map(|d| {
        let (k, v) = d.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(property) {
            parse_css_color(v)
        } else {
            None
        }
    })
}

impl<'s, 'r, 'a> Surface<'s, 'r, 'a> {
    pub fn new(
        theme: &'s MarkdownTheme,
        assets: Option<&'s DocumentAssets>,
        document: &'s Path,
        view: WeakEntity<EditorView>,
        block: usize,
        render: &'r mut RenderCx<'a>,
    ) -> Self {
        Self {
            theme,
            assets,
            document,
            view,
            block,
            render,
            details: 0,
            ids: 0,
        }
    }

    fn id(&mut self, part: &'static str) -> ElementId {
        self.ids += 1;
        ElementId::NamedInteger(part.into(), (self.block as u64) << 20 | self.ids as u64)
    }

    fn tokens(&self) -> &'static Tokens {
        Tokens::get(self.theme.dark, self.theme.scale)
    }

    /// The surface: `nodes` in a column of `width`.
    pub fn render(&mut self, nodes: &[Node], width: f32) -> AnyElement {
        let base = Inherit {
            text: self.theme.body.text.clone(),
            align: TextAlign::Left,
            link: None,
            mono: false,
            background: None,
            underline: false,
            strike: false,
        };
        let children = self.flow(nodes, &base, width);
        let mut root = div().w(px(width)).flex().flex_col();
        base.text.apply(root.style());
        root.children(children).into_any_element()
    }

    /// Block children in order; runs of inline content become one flow.
    fn flow(&mut self, nodes: &[Node], inherit: &Inherit, width: f32) -> Vec<AnyElement> {
        let mut out = Vec::new();
        let mut inline: Vec<Piece> = Vec::new();
        for node in nodes {
            match node {
                Node::Element(e) if is_block(&e.tag) => {
                    if !inline.is_empty() {
                        out.push(self.inline_flow(std::mem::take(&mut inline), inherit));
                    }
                    out.push(self.block_element(e, inherit, width));
                }
                _ => self.inline(node, inherit, &mut inline),
            }
        }
        if !inline.is_empty() {
            out.push(self.inline_flow(inline, inherit));
        }
        out
    }

    fn block_element(&mut self, e: &Element, inherit: &Inherit, width: f32) -> AnyElement {
        let t = self.theme;
        let tokens = self.tokens();
        let size = inherit.text.size;
        let mut inherit = Inherit {
            align: align_of(e, inherit.align),
            ..inherit.clone()
        };
        if let Some(color) = style_color(e, "color") {
            inherit.text.color = color;
        }
        let block_gap = tokens.len("--po-md-block-gap", size);
        let mut d = div().flex().flex_col().w_full();
        if let Some(bg) = style_color(e, "background-color") {
            d = d.bg(bg);
        }
        let children =
            |s: &mut Self, inherit: &Inherit, width: f32| s.flow(&e.children, inherit, width);
        match e.tag.as_str() {
            tag if heading_level(tag).is_some() => {
                let level = heading_level(tag).unwrap();
                let h = t.heading.level(level);
                inherit.text.size = h.size;
                inherit.text.weight = h.weight;
                inherit.text.color = h.color;
                inherit.text.line_height =
                    crate::editor::view::style::LineHeight::Factor(t.heading.line_height);
                d = d.mt(px(h.gap_before)).mb(px(h.gap_after));
                if level <= 2 {
                    d = d.border_b_1().border_color(t.heading.border);
                }
            }
            "p" => {
                d = d
                    .mt(px(t.body.paragraph_gap_before))
                    .mb(px(t.body.source_line_gap + t.body.paragraph_gap_after));
            }
            "blockquote" => {
                inherit.text.color = t.quote.color;
                d = d
                    .px(px(t.quote.padding))
                    .border_l(px(t.quote.border_width))
                    .border_color(t.quote.border_color)
                    .mb(px(block_gap));
            }
            "pre" => {
                let c = &t.code_block;
                inherit.text = c.text();
                inherit.mono = true;
                let mut text = e.text();
                if text.ends_with('\n') {
                    text.pop();
                }
                let mut panel = div()
                    .w_full()
                    .bg(c.background)
                    .rounded(px(c.radius))
                    .pt(px(c.padding.top))
                    .pr(px(c.padding.right))
                    .pb(px(c.padding.bottom))
                    .pl(px(c.padding.left))
                    .mb(px(block_gap));
                inherit.text.apply(panel.style());
                return panel.child(SharedString::from(text)).into_any_element();
            }
            "ul" | "ol" => {
                return self.list(e, &inherit, width, false).into_any_element();
            }
            "table" => return self.table(e, &inherit, width, block_gap),
            "hr" => {
                let gap = tokens.len("--po-md-heading-gap-before", size);
                return div()
                    .w_full()
                    .h(px(1.))
                    .my(px(gap))
                    .bg(t.rule.color)
                    .into_any_element();
            }
            "details" => return self.details(e, &inherit, width),
            "video" | "audio" => return self.media_placeholder(e, &inherit),
            "dd" => d = d.ml(px(40.)),
            "dl" => d = d.mb(px(block_gap)),
            _ => {}
        }
        inherit.text.apply(d.style());
        d.style().text.text_align = Some(inherit.align);
        d.children(children(self, &inherit, width))
            .into_any_element()
    }

    fn list(&mut self, e: &Element, inherit: &Inherit, width: f32, nested: bool) -> Div {
        let l = &self.theme.list;
        let ordered = e.tag == "ol";
        let slot = l.marker_width;
        let indent = if nested {
            l.indent_step.max(slot + l.marker_gap)
        } else {
            l.inset + slot + l.marker_gap
        };
        let start: i64 = e
            .attribute("start")
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);
        let mut list = div()
            .flex()
            .flex_col()
            .w_full()
            .pl(px(indent))
            .mt(px(if nested {
                0.
            } else {
                self.theme.body.paragraph_gap_before
            }))
            .mb(px(if nested {
                0.
            } else {
                self.theme.body.paragraph_gap_after
            }));
        let mut n = start;
        let inner = (width - indent).max(0.);
        for child in &e.children {
            let Node::Element(item) = child else {
                continue;
            };
            if item.tag != "li" {
                continue;
            }
            let marker = if ordered {
                let m = format!("{n}.");
                n += 1;
                m
            } else {
                "•".to_owned()
            };
            let mut marker_text = inherit.text.clone();
            marker_text.color = l.marker_color;
            marker_text.weight = l.marker_weight;
            let mut marker_box = div()
                .absolute()
                .left(px(-(slot + l.marker_gap)))
                .top_0()
                .w(px(slot))
                .h(px(inherit.text.line_height_px()))
                .flex()
                .items_center()
                .justify_center();
            marker_text.apply(marker_box.style());
            let mut body: Vec<AnyElement> = Vec::new();
            let mut inline = Vec::new();
            for node in &item.children {
                match node {
                    Node::Element(sub) if matches!(sub.tag.as_str(), "ul" | "ol") => {
                        if !inline.is_empty() {
                            body.push(self.inline_flow(std::mem::take(&mut inline), inherit));
                        }
                        body.push(self.list(sub, inherit, inner, true).into_any_element());
                    }
                    Node::Element(sub) if is_block(&sub.tag) => {
                        if !inline.is_empty() {
                            body.push(self.inline_flow(std::mem::take(&mut inline), inherit));
                        }
                        body.push(self.block_element(sub, inherit, inner));
                    }
                    _ => self.inline(node, inherit, &mut inline),
                }
            }
            if !inline.is_empty() {
                body.push(self.inline_flow(inline, inherit));
            }
            list = list.child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .mt(px(l.item_gap / 2.))
                    .mb(px(self.theme.body.source_line_gap + l.item_gap / 2.))
                    .child(marker_box.child(SharedString::from(marker)))
                    .children(body),
            );
        }
        list
    }

    fn table(&mut self, e: &Element, inherit: &Inherit, width: f32, gap: f32) -> AnyElement {
        let s = &self.theme.table;
        let mut rows: Vec<(&Element, bool)> = Vec::new();
        fn collect<'e>(e: &'e Element, out: &mut Vec<(&'e Element, bool)>, head: bool) {
            for child in &e.children {
                if let Node::Element(c) = child {
                    match c.tag.as_str() {
                        "tr" => out.push((c, head)),
                        "thead" => collect(c, out, true),
                        "tbody" | "tfoot" => collect(c, out, false),
                        _ => {}
                    }
                }
            }
        }
        collect(e, &mut rows, false);
        let mut text = inherit.text.clone();
        text.size = s.size;
        text.line_height = crate::editor::view::style::LineHeight::Factor(s.line_height);
        let cells = |row: &Element| -> Vec<Element> {
            row.children
                .iter()
                .filter_map(|c| match c {
                    Node::Element(c) if matches!(c.tag.as_str(), "td" | "th") => Some(c.clone()),
                    _ => None,
                })
                .collect()
        };
        let columns = rows.iter().map(|(r, _)| cells(r).len()).max().unwrap_or(0);
        if columns == 0 {
            return div().into_any_element();
        }
        // Automatic layout: each column as wide as its widest cell, the
        // table no wider than the column of text.
        // Padding, the cell rule and a pixel of slack for the wrap.
        let pad = s.cell_padding.left + s.cell_padding.right + 2.;
        let mut widths = vec![0f32; columns];
        for (row, head) in &rows {
            let mut style = text.clone();
            if *head {
                style.weight = s.header_weight;
            }
            for (i, cell) in cells(row).iter().enumerate() {
                let w = self.render.plain_extent(cell.text().trim(), &style, None).1;
                widths[i] = widths[i].max(w.ceil() + pad);
            }
        }
        let total: f32 = widths.iter().sum::<f32>() + 2.;
        if total > width {
            let k = (width - 2.).max(0.) / (total - 2.).max(1.);
            for w in &mut widths {
                *w *= k;
            }
        }
        let mut table = div()
            .flex()
            .flex_col()
            .border_1()
            .border_color(s.border)
            .rounded(px(s.radius))
            .overflow_hidden()
            .bg(s.background)
            .mb(px(gap));
        let last = rows.len().saturating_sub(1);
        for (r, (row, _)) in rows.iter().enumerate() {
            let row_cells = cells(row);
            let mut tr = div().flex();
            for (i, cell) in row_cells.iter().enumerate() {
                let mut cell_inherit = Inherit {
                    text: text.clone(),
                    align: align_of(cell, TextAlign::Left),
                    ..inherit.clone()
                };
                if cell.tag == "th" {
                    cell_inherit.text.color = s.header_color;
                    cell_inherit.text.weight = s.header_weight;
                } else {
                    cell_inherit.text.color = s.body_color;
                }
                let mut td = div()
                    .w(px(widths[i]))
                    .pt(px(s.cell_padding.top))
                    .pr(px(s.cell_padding.right))
                    .pb(px(s.cell_padding.bottom))
                    .pl(px(s.cell_padding.left))
                    .border_color(s.cell_border);
                if i + 1 < row_cells.len() {
                    td = td.border_r_1();
                }
                if r < last {
                    td = td.border_b_1();
                }
                if cell.tag == "th" {
                    td = td.bg(s.header_background);
                }
                cell_inherit.text.apply(td.style());
                td.style().text.text_align = Some(cell_inherit.align);
                let content = self.flow(&cell.children, &cell_inherit, widths[i] - pad);
                tr = tr.child(td.children(content));
            }
            table = table.child(tr);
        }
        div().flex().child(table).into_any_element()
    }

    fn details(&mut self, e: &Element, inherit: &Inherit, width: f32) -> AnyElement {
        let index = self.details;
        self.details += 1;
        let key = (self.block, index);
        let open = e.attribute("open").is_some() != OPEN.with(|o| o.borrow().contains(&key));
        let summary = e.children.iter().find_map(|c| match c {
            Node::Element(s) if s.tag == "summary" => Some(s),
            _ => None,
        });
        let mut pieces = Vec::new();
        match summary {
            Some(s) => {
                for child in &s.children {
                    self.inline(child, inherit, &mut pieces);
                }
            }
            None => pieces.push(Piece::Text("Details".into(), inherit.clone())),
        }
        let line = inherit.text.line_height_px();
        let (icon, w, h) = if open {
            ("icons/details-open.svg", 8., 7.)
        } else {
            ("icons/details-closed.svg", 7., 8.)
        };
        let marker = div()
            .w(px(w + inherit.text.size * 0.25))
            .h(px(line))
            .flex()
            .items_center()
            .child(
                svg()
                    .path(icon)
                    .w(px(w))
                    .h(px(h))
                    .text_color(inherit.text.color),
            );
        let view = self.view.clone();
        let header = div()
            .id(self.id("md-html-summary"))
            .flex()
            .cursor(crate::theme::clickable_cursor())
            .child(marker)
            .child(self.inline_flow(pieces, inherit))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, window, cx| {
                OPEN.with(|o| {
                    let mut o = o.borrow_mut();
                    if !o.remove(&key) {
                        o.insert(key);
                    }
                });
                let _ = view.update(cx, |_, cx| cx.notify());
                window.refresh();
            });
        let mut d = div().flex().flex_col().w_full().child(header);
        if open {
            let rest: Vec<Node> = e
                .children
                .iter()
                .filter(|c| !matches!(c, Node::Element(s) if s.tag == "summary"))
                .cloned()
                .collect();
            d = d.children(self.flow(&rest, inherit, width));
        }
        d.into_any_element()
    }

    fn media_placeholder(&mut self, e: &Element, inherit: &Inherit) -> AnyElement {
        let src = e.attribute("src").map(str::to_owned).or_else(|| {
            e.children.iter().find_map(|c| match c {
                Node::Element(s) if s.tag == "source" => s.attribute("src").map(str::to_owned),
                _ => None,
            })
        });
        let name = src
            .as_deref()
            .and_then(|s| s.rsplit('/').next())
            .unwrap_or(&e.tag)
            .to_owned();
        self.chip(
            &format!("{} · {name}", if e.tag == "video" { "▶" } else { "♪" }),
            inherit,
        )
    }

    /// `.cm-md-image-placeholder`: muted meta text in a bordered chip.
    fn chip(&mut self, label: &str, inherit: &Inherit) -> AnyElement {
        let t = crate::theme::Theme::new(self.theme.dark);
        let mut meta = inherit.text.clone();
        meta.size = crate::theme::ty().ui.meta;
        meta.color = t.muted;
        let mut chip = div()
            .flex()
            .items_center()
            .min_h(px(22.))
            .px(px(8.))
            .border_1()
            .border_color(t.border_subtle)
            .rounded(px(self.theme.block.radius))
            .bg(crate::theme::mix(
                t.control,
                Rgba { a: 0., ..t.control },
                0.26,
            ));
        meta.apply(chip.style());
        div()
            .flex()
            .child(chip.child(SharedString::from(label.to_owned())))
            .into_any_element()
    }

    /// An `<img>`, `<picture>` or inline `<svg>` as an atom.
    fn image(&mut self, e: &Element, inherit: &Inherit) -> AnyElement {
        let (src, attrs) = match e.tag.as_str() {
            "picture" => {
                let img = e.children.iter().find_map(|c| match c {
                    Node::Element(i) if i.tag == "img" => Some(i),
                    _ => None,
                });
                let source = e.children.iter().find_map(|c| match c {
                    Node::Element(s) if s.tag == "source" => {
                        s.attribute("srcset").map(str::to_owned)
                    }
                    _ => None,
                });
                (
                    img.and_then(|i| i.attribute("src").map(str::to_owned))
                        .or_else(|| source.as_deref().and_then(best_candidate)),
                    img.unwrap_or(e),
                )
            }
            _ => (
                e.attribute("src")
                    .map(str::to_owned)
                    .or_else(|| e.attribute("srcset").and_then(best_candidate)),
                e,
            ),
        };
        let number = |name: &str| {
            attrs
                .attribute(name)
                .and_then(|v| v.trim().trim_end_matches("px").parse::<f32>().ok())
        };
        let source = if e.tag == "svg" {
            Some(source::Source::Data(serialize(e).into_bytes()))
        } else {
            src.as_deref()
                .and_then(|s| source::markdown(self.document, s))
        };
        let label = attrs
            .attribute("alt")
            .map(str::to_owned)
            .or(src.clone())
            .unwrap_or_else(|| e.tag.clone());
        let state = match &source {
            Some(s) => cache::get(&s.key(self.assets), s, self.assets, self.render.app),
            None => cache::State::Failed,
        };
        match state {
            cache::State::Ready {
                image,
                width,
                height,
            } => {
                let (w, h) = match (number("width"), number("height")) {
                    (Some(w), Some(h)) => (w, h),
                    (Some(w), None) => (w, height * w / width.max(1.)),
                    (None, Some(h)) => (width * h / height.max(1.), h),
                    (None, None) => (width, height),
                };
                img(ImageSource::Render(image))
                    .w(px(w))
                    .h(px(h))
                    .max_w_full()
                    .into_any_element()
            }
            cache::State::Loading => div()
                .w(px(number("width").unwrap_or(96.)))
                .h(px(number("height").unwrap_or(54.)))
                .into_any_element(),
            cache::State::Failed => self.chip(&label, inherit),
        }
    }

    fn inline(&mut self, node: &Node, inherit: &Inherit, out: &mut Vec<Piece>) {
        let e = match node {
            Node::Text(text) => {
                // HTML whitespace collapses (`white-space: normal`).
                let collapsed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
                let lead = text.starts_with(char::is_whitespace) && !collapsed.is_empty();
                let trail = text.ends_with(char::is_whitespace);
                let mut shown = String::new();
                if lead || (collapsed.is_empty() && !text.is_empty()) {
                    shown.push(' ');
                }
                shown.push_str(&collapsed);
                if trail && !collapsed.is_empty() {
                    shown.push(' ');
                }
                if !shown.is_empty() {
                    out.push(Piece::Text(shown, inherit.clone()));
                }
                return;
            }
            Node::Element(e) => e,
        };
        let mut inherit = inherit.clone();
        let t = self.theme;
        match e.tag.as_str() {
            "br" => return out.push(Piece::Break),
            "img" | "picture" | "svg" => {
                let atom = self.image(e, &inherit);
                return out.push(Piece::Atom(atom));
            }
            "b" | "strong" => inherit.text.weight = t.inline.strong_weight,
            "i" | "em" | "cite" | "var" | "dfn" => inherit.text.italic = true,
            "s" | "del" | "strike" => inherit.strike = true,
            "u" | "ins" => inherit.underline = true,
            "code" | "kbd" | "samp" | "tt" => {
                inherit.mono = true;
                inherit.background = Some(t.inline.code_background);
                if let Some(c) = t.inline.code_color {
                    inherit.text.color = c;
                }
            }
            "mark" => {
                let (background, text) = crate::editor::tokens::mark_colors();
                inherit.background = Some(background);
                inherit.text.color = text;
            }
            "a" => {
                if let Some(href) = e.attribute("href") {
                    inherit.link = Some(href.trim().to_owned());
                    inherit.text.color = t.inline.link_color;
                }
            }
            "small" | "sub" | "sup" => inherit.text.size /= 1.2,
            _ => {}
        }
        if let Some(c) = style_color(e, "color") {
            inherit.text.color = c;
        }
        if let Some(c) = style_color(e, "background-color") {
            inherit.background = Some(c);
        }
        if e.tag == "q" {
            out.push(Piece::Text("\u{201c}".into(), inherit.clone()));
        }
        for child in &e.children {
            self.inline(child, &inherit, out);
        }
        if e.tag == "q" {
            out.push(Piece::Text("\u{201d}".into(), inherit.clone()));
        }
    }

    /// One inline formatting context: text runs (links clickable) wrapping
    /// in the column, with images as atoms in the flow.
    fn inline_flow(&mut self, pieces: Vec<Piece>, inherit: &Inherit) -> AnyElement {
        // Leading and trailing collapsible spaces of a line go.
        let mut segments: Vec<AnyElement> = Vec::new();
        let mut text = String::new();
        let mut runs: Vec<TextRun> = Vec::new();
        let mut links: Vec<(std::ops::Range<usize>, String)> = Vec::new();
        let has_atoms = pieces.iter().any(|p| matches!(p, Piece::Atom(_)));
        let base = inherit.text.clone();
        let flush = |s: &mut Self,
                     text: &mut String,
                     runs: &mut Vec<TextRun>,
                     links: &mut Vec<(std::ops::Range<usize>, String)>,
                     segments: &mut Vec<AnyElement>| {
            if text.trim().is_empty() && segments.is_empty() {
                text.clear();
                runs.clear();
                links.clear();
                return;
            }
            let styled = StyledText::new(SharedString::from(std::mem::take(text)))
                .with_runs(std::mem::take(runs));
            let targets: Vec<String> = links.iter().map(|(_, h)| h.clone()).collect();
            let ranges: Vec<_> = std::mem::take(links).into_iter().map(|(r, _)| r).collect();
            let view = s.view.clone();
            let id = s.id("md-html-text");
            segments.push(
                InteractiveText::new(id, styled)
                    .on_click(ranges, move |i, _, cx| {
                        if let Some(href) = targets.get(i) {
                            let href = href.clone();
                            let _ = view.update(cx, |v, cx| v.follow_href(&href, cx));
                        }
                    })
                    .into_any_element(),
            );
        };
        for piece in pieces {
            match piece {
                Piece::Text(s, style) => {
                    let s = if text.is_empty() || text.ends_with(' ') || text.ends_with('\n') {
                        s.trim_start().to_owned()
                    } else {
                        s
                    };
                    if s.is_empty() {
                        continue;
                    }
                    let start = text.len();
                    text.push_str(&s);
                    let mut font = RenderCx::font(&style.text);
                    if style.mono {
                        font.family = SharedString::from(
                            crate::editor::view::style::inline_code_family(style.text.weight),
                        );
                    }
                    runs.push(TextRun {
                        len: s.len(),
                        font,
                        color: style.text.color.into(),
                        background_color: style.background.map(Into::into),
                        underline: (style.underline || style.link.is_some()).then(|| {
                            UnderlineStyle {
                                thickness: px(1.),
                                color: style.link.is_some().then(|| {
                                    Rgba {
                                        a: 0.,
                                        ..style.text.color
                                    }
                                    .into()
                                }),
                                wavy: false,
                            }
                        }),
                        strikethrough: style.strike.then(|| StrikethroughStyle {
                            thickness: px(1.),
                            color: None,
                        }),
                    });
                    if let Some(href) = style.link {
                        links.push((start..text.len(), href));
                    }
                }
                Piece::Break => {
                    let start = text.len();
                    text.push('\n');
                    runs.push(TextRun {
                        len: 1,
                        font: RenderCx::font(&base),
                        color: base.color.into(),
                        background_color: None,
                        underline: None,
                        strikethrough: None,
                    });
                    let _ = start;
                }
                Piece::Atom(atom) => {
                    while text.ends_with(' ') {
                        text.pop();
                        if let Some(last) = runs.last_mut() {
                            last.len -= 1;
                            if last.len == 0 {
                                runs.pop();
                            }
                        }
                    }
                    if !text.is_empty() {
                        flush(self, &mut text, &mut runs, &mut links, &mut segments);
                    }
                    segments.push(atom);
                }
            }
        }
        while text.ends_with(' ') || text.ends_with('\n') {
            text.pop();
            if let Some(last) = runs.last_mut() {
                last.len -= 1;
                if last.len == 0 {
                    runs.pop();
                }
            }
        }
        if !text.is_empty() {
            flush(self, &mut text, &mut runs, &mut links, &mut segments);
        }
        let mut d = div().w_full();
        base.apply(d.style());
        d.style().text.text_align = Some(inherit.align);
        if has_atoms {
            d = d
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(base.size * 0.25));
            d = match inherit.align {
                TextAlign::Center => d.justify_center(),
                TextAlign::Right => d.justify_end(),
                TextAlign::Left => d,
            };
        }
        d.children(segments).into_any_element()
    }
}

/// The densest `srcset` candidate up to 2x (else the first).
fn best_candidate(srcset: &str) -> Option<String> {
    let mut best: Option<(f32, String)> = None;
    for candidate in srcset.split(',') {
        let mut parts = candidate.split_whitespace();
        let Some(url) = parts.next() else { continue };
        let density = parts
            .next()
            .and_then(|d| d.strip_suffix('x'))
            .and_then(|d| d.parse::<f32>().ok())
            .unwrap_or(1.);
        let better = best
            .as_ref()
            .is_none_or(|(b, _)| (density <= 2. && density > *b) || *b > 2. && density < *b);
        if better {
            best = Some((density, url.to_owned()));
        }
    }
    best.map(|(_, url)| url)
}

/// An inline `<svg>` subtree as markup, for the SVG rasteriser.
fn serialize(e: &Element) -> String {
    fn escape(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('"', "&quot;")
    }
    let mut out = format!("<{}", e.tag);
    if e.tag == "svg" && e.attribute("xmlns").is_none() {
        out.push_str(" xmlns=\"http://www.w3.org/2000/svg\"");
    }
    for (name, value) in &e.attributes {
        out.push_str(&format!(" {name}=\"{}\"", escape(value)));
    }
    out.push('>');
    for child in &e.children {
        match child {
            Node::Text(t) => out.push_str(&escape(t)),
            Node::Element(c) => out.push_str(&serialize(c)),
        }
    }
    out.push_str(&format!("</{}>", e.tag));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn media_sources_pick_what_a_browser_shows() {
        assert_eq!(
            best_candidate("a.png 1x, b.png 2x, c.png 3x").as_deref(),
            Some("b.png")
        );
        assert_eq!(best_candidate("only.png").as_deref(), Some("only.png"));
        let svg = Element {
            tag: "svg".into(),
            attributes: vec![("width".into(), "10".into())],
            children: vec![],
        };
        assert_eq!(
            serialize(&svg),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\"></svg>"
        );
    }
}
