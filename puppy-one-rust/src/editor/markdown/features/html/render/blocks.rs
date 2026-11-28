//! Block-level HTML surface elements: headings, paragraphs, blockquotes,
//! `<pre>`, lists (`<ul>` / `<ol>`), `<table>`, `<hr>`, and `<details>`.
use super::{Inherit, Piece, Surface, align_of, heading_level, is_block, style_color};
use crate::{
    editor::markdown::{
        features::html::sanitize::{Element, MAX_HTML_DEPTH, Node},
        platform::sessions::disclosure,
    },
    ui::components::{SurfaceCorners, SurfaceStyledExt},
};
use gpui::{prelude::*, *};
use std::rc::Rc;

impl Surface<'_, '_, '_> {
    pub(super) fn block_element(
        &mut self,
        e: &Element,
        inherit: &Inherit,
        width: f32,
        depth: usize,
    ) -> AnyElement {
        if depth > MAX_HTML_DEPTH {
            return div().into_any_element();
        }
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
                if level <= 2 && t.heading.border.a > 0. {
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
                inherit
                    .text
                    .apply_for(panel.style(), self.render.language());
                return panel.child(SharedString::from(text)).into_any_element();
            }
            "ul" | "ol" => {
                return self
                    .list(e, &inherit, width, false, depth)
                    .into_any_element();
            }
            "table" => return self.table(e, &inherit, width, block_gap, depth),
            "hr" => {
                let gap = tokens.len("--po-md-heading-gap-before", size);
                return div()
                    .w_full()
                    .h(px(1.))
                    .my(px(gap))
                    .bg(t.rule.color)
                    .into_any_element();
            }
            "details" => return self.details(e, &inherit, width, depth),
            "video" | "audio" => return self.media(e, &inherit, width),
            "dd" => d = d.ml(px(40.)),
            "dl" => d = d.mb(px(block_gap)),
            _ => {}
        }
        inherit.text.apply_for(d.style(), self.render.language());
        d.style().text.text_align = Some(inherit.align);
        let children = self.flow(&e.children, &inherit, width, depth);
        d.children(children).into_any_element()
    }

    pub(super) fn list(
        &mut self,
        e: &Element,
        inherit: &Inherit,
        width: f32,
        nested: bool,
        depth: usize,
    ) -> Div {
        if depth > MAX_HTML_DEPTH {
            return div();
        }
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
                let m = format!("{}.", list_marker(n, e.attribute("type")));
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
            marker_text.apply_for(marker_box.style(), self.render.language());
            let mut body: Vec<AnyElement> = Vec::new();
            let mut inline = Vec::new();
            for node in &item.children {
                match node {
                    Node::Element(sub) if matches!(sub.tag.as_str(), "ul" | "ol") => {
                        if !inline.is_empty() {
                            body.push(self.inline_flow(std::mem::take(&mut inline), inherit));
                        }
                        body.push(
                            self.list(sub, inherit, inner, true, depth + 1)
                                .into_any_element(),
                        );
                    }
                    Node::Element(sub) if is_block(&sub.tag) => {
                        if !inline.is_empty() {
                            body.push(self.inline_flow(std::mem::take(&mut inline), inherit));
                        }
                        body.push(self.block_element(sub, inherit, inner, depth + 1));
                    }
                    _ => self.inline(node, inherit, &mut inline, inner, depth + 1),
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

    pub(super) fn table(
        &mut self,
        e: &Element,
        inherit: &Inherit,
        width: f32,
        gap: f32,
        depth: usize,
    ) -> AnyElement {
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
        // `width` on a cell: at least that wide (pixels, or a share of the
        // column).
        let length = |value: Option<&str>, of: f32| -> Option<f32> {
            let value = value?.trim();
            match value.strip_suffix('%') {
                Some(p) => p.parse::<f32>().ok().map(|p| of * p.min(100.) / 100.),
                None => value.trim_end_matches("px").parse::<f32>().ok(),
            }
            .filter(|v| v.is_finite() && *v > 0.)
        };
        for (row, _) in &rows {
            for (i, cell) in cells(row).iter().enumerate() {
                if let Some(w) = length(cell.attribute("width"), width - 2.) {
                    widths[i] = widths[i].max(w.min(width - 2.));
                }
            }
        }
        // `width` on the table: its columns share that width.
        let total: f32 = widths.iter().sum::<f32>() + 2.;
        if let Some(target) = length(e.attribute("width"), width).map(|w| w.min(width))
            && target > total
        {
            let k = (target - 2.).max(0.) / (total - 2.).max(1.);
            for w in &mut widths {
                *w *= k;
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
            .debug_selector(|| "md-html-table".into())
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
                let id = format!("md-html-cell-{r}-{i}");
                let mut td = div()
                    .debug_selector(move || id.clone())
                    .flex()
                    .flex_col()
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
                    td = td.bg(s.header_background).surface_corners(
                        s.radius,
                        SurfaceCorners {
                            top_left: r == 0 && i == 0,
                            top_right: r == 0 && i + 1 == row_cells.len(),
                            bottom_left: r == last && i == 0,
                            bottom_right: r == last && i + 1 == row_cells.len(),
                        },
                    );
                }
                // `valign`: where the cell's content sits in its row.
                td = match cell.attribute("valign") {
                    Some("middle") => td.justify_center(),
                    Some("bottom") => td.justify_end(),
                    _ => td.justify_start(),
                };
                cell_inherit
                    .text
                    .apply_for(td.style(), self.render.language());
                td.style().text.text_align = Some(cell_inherit.align);
                let content = self.flow(
                    &cell.children,
                    &cell_inherit,
                    (widths[i] - pad).max(0.),
                    depth + 1,
                );
                tr = tr.child(td.children(content));
            }
            table = table.child(tr);
        }
        // `align` on the table: where it sits in the column.
        let placed = div().flex();
        match e.attribute("align") {
            Some("center") => placed.justify_center(),
            Some("right") => placed.justify_end(),
            _ => placed,
        }
        .child(table)
        .into_any_element()
    }

    pub(super) fn details(
        &mut self,
        e: &Element,
        inherit: &Inherit,
        width: f32,
        depth: usize,
    ) -> AnyElement {
        let index = self.details;
        self.details += 1;
        let block_id = self.block_id;
        let toggled =
            disclosure::is_toggled(&mut self.render.widget_states.borrow_mut(), block_id, index);
        let open = e.attribute("open").is_some() != toggled;
        let summary = e.children.iter().find_map(|c| match c {
            Node::Element(s) if s.tag == "summary" => Some(s),
            _ => None,
        });
        let mut pieces = Vec::new();
        match summary {
            Some(s) => {
                for child in &s.children {
                    self.inline(child, inherit, &mut pieces, width, depth + 1);
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
        let states = Rc::clone(self.render.widget_states);
        let header = div()
            .id(self.id("md-html-summary"))
            .debug_selector(|| "md-html-summary".into())
            .flex()
            .cursor(crate::theme::clickable_cursor())
            .child(marker)
            .child(self.inline_flow(pieces, inherit))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, window, cx| {
                disclosure::toggle(&mut states.borrow_mut(), block_id, index);
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
            d = d.children(self.flow(&rest, inherit, width, depth + 1));
        }
        d.into_any_element()
    }
}

/// An ordered list's marker for item `n` in `type` (`1`, `a`, `A`, `i`, `I`).
fn list_marker(n: i64, kind: Option<&str>) -> String {
    let letters = |n: i64, base: u8| {
        if n < 1 {
            return n.to_string();
        }
        let mut n = n;
        let mut out = Vec::new();
        while n > 0 {
            n -= 1;
            out.push((base + (n % 26) as u8) as char);
            n /= 26;
        }
        out.iter().rev().collect()
    };
    let roman = |n: i64| {
        if !(1..4000).contains(&n) {
            return n.to_string();
        }
        let mut n = n;
        let mut out = String::new();
        for (value, numeral) in [
            (1000, "m"),
            (900, "cm"),
            (500, "d"),
            (400, "cd"),
            (100, "c"),
            (90, "xc"),
            (50, "l"),
            (40, "xl"),
            (10, "x"),
            (9, "ix"),
            (5, "v"),
            (4, "iv"),
            (1, "i"),
        ] {
            while n >= value {
                out.push_str(numeral);
                n -= value;
            }
        }
        out
    };
    match kind {
        Some("a") => letters(n, b'a'),
        Some("A") => letters(n, b'A'),
        Some("i") => roman(n),
        Some("I") => roman(n).to_ascii_uppercase(),
        _ => n.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::list_marker;
    use core::prelude::v1::test;

    /// `<ol type>` markers (`markdownHtmlRun.test.ts` #65 keeps `type="a"`).
    #[test]
    fn ordered_list_types_number_their_markers() {
        let markers =
            |kind: Option<&str>| (1..=4).map(|n| list_marker(n, kind)).collect::<Vec<_>>();
        assert_eq!(markers(Some("a")), ["a", "b", "c", "d"]);
        assert_eq!(markers(Some("A")), ["A", "B", "C", "D"]);
        assert_eq!(markers(Some("i")), ["i", "ii", "iii", "iv"]);
        assert_eq!(markers(Some("I")), ["I", "II", "III", "IV"]);
        assert_eq!(markers(None), ["1", "2", "3", "4"]);
        assert_eq!(list_marker(27, Some("a")), "aa");
    }
}
