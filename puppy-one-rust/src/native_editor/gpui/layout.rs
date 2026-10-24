//! Presentation adapter over GPUI Kit's public editor_host API.
//! The application owns one selection and input session; Kit owns all text shaping,
//! wrapping, table layout and leaf hit geometry. No private Kit APIs or editor fork.
use super::*;
use gpui_kit::base::text::editor_host::*;
use std::collections::HashMap;

#[path = "hit_test.rs"]
mod hit_test;
pub use hit_test::TextRegion;
use hit_test::{Label, Leaf};
pub(super) use hit_test::{TextLayout, index_at, line_edge, position_at, vertical_index};
fn paragraph(input: &TextInput, region: &TextRegion, key: u64) -> Paragraph {
    let text = &input.content[region.range.clone()];
    let scalar = input.content[..region.range.start].chars().count();
    let mut marks = Vec::new();
    let mut previous: Option<(usize, Mark)> = None;
    for (n, (byte, _)) in text.char_indices().enumerate() {
        let mark = input.marks.get(scalar + n).copied().unwrap_or_default();
        if previous.is_some_and(|(_, m)| m != mark) {
            let (start, m) = previous.take().unwrap();
            marks.push((
                start..byte,
                TextMark {
                    bold: m.bold,
                    italic: m.italic,
                    ..Default::default()
                },
            ));
        }
        if previous.is_none() {
            previous = Some((byte, mark));
        }
    }
    if let Some((start, m)) = previous {
        marks.push((
            start..text.len(),
            TextMark {
                bold: m.bold,
                italic: m.italic,
                ..Default::default()
            },
        ));
    }
    let mut p = Paragraph::default();
    p.push(InlineNode::new(text.to_owned()).marks(marks));
    p.with_leaf_key(key)
}

pub(super) struct KitTextElement {
    pub input: Entity<TextInput>,
}
impl IntoElement for KitTextElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
pub(super) struct Frame {
    child: AnyElement,
    regions: Vec<TextRegion>,
    text: SharedString,
    decorations: HashMap<u64, Vec<(Range<usize>, Hsla)>>,
    tables: HashMap<usize, (Range<usize>, ScrollHandle, Pixels)>,
}
impl Element for KitTextElement {
    type RequestLayoutState = Frame;
    type PrepaintState = TextLayout;
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Frame) {
        self.input.update(cx, |i, _| {
            i.table_scrolls
                .retain(|group, _| i.regions.iter().any(|r| r.columns > 0 && r.group == *group));
            for region in &i.regions {
                if region.columns > 0 {
                    i.table_scrolls.entry(region.group).or_default();
                }
            }
        });
        let input = self.input.read(cx);
        let mut tables = HashMap::new();
        let t = crate::theme::Theme::new(input.dark);
        let regions = if input.regions.is_empty() {
            vec![TextRegion {
                range: 0..input.content.len(),
                font_size: input.font_size,
                heading: input.heading,
                ..Default::default()
            }]
        } else {
            input.regions.clone()
        };
        let text = input.content.clone();
        let focused = input.focus_handle.is_focused(window);
        let selected = input.selected_range.clone();
        let mut blocks = Vec::new();
        let mut decorations = HashMap::new();
        for (n, r) in regions.iter().enumerate() {
            if focused && selected.start < r.range.end && selected.end > r.range.start {
                decorations.insert(
                    n as u64,
                    vec![(
                        selected.start.saturating_sub(r.range.start)
                            ..selected.end.min(r.range.end) - r.range.start,
                        t.selection.into(),
                    )],
                );
            }
        }
        let mut n = 0;
        while n < regions.len() {
            let r = &regions[n];
            if r.columns > 0 {
                let columns = r.columns;
                let mut rows = Vec::new();
                let aligns = regions[n..]
                    .iter()
                    .take(columns)
                    .map(|r| match r.alignment {
                        -1 => ColumnAlign::Left,
                        1 => ColumnAlign::Right,
                        2 => ColumnAlign::Center,
                        _ => ColumnAlign::None,
                    })
                    .collect();
                loop {
                    let mut row = Vec::new();
                    for _ in 0..columns {
                        if n >= regions.len() || regions[n].columns != columns {
                            break;
                        }
                        row.push(paragraph(input, &regions[n], n as u64));
                        n += 1;
                    }
                    rows.push(row);
                    if n >= regions.len()
                        || regions[n - 1].after > 0.
                        || regions[n].columns != columns
                    {
                        break;
                    }
                }
                let range = r.range.start..regions[n - 1].range.end;
                // Kit keeps a four-rem minimum per column. Own the viewport so
                // wide tables remain reachable by both scrolling and the caret.
                tables.insert(
                    blocks.len(),
                    (
                        range,
                        input.table_scrolls[&r.group].clone(),
                        window.rem_size() * 4. * columns as f32 + px(2.),
                    ),
                );
                blocks.push(BlockNode::Table(Table::new(rows, aligns)));
                continue;
            }
            let p = paragraph(input, r, n as u64);
            let block = if r.code {
                BlockNode::CodeBlock(
                    CodeBlock::from_code(text[r.range.clone()].to_owned(), None::<SharedString>)
                        .with_leaf_key(n as u64),
                )
            } else if r.heading {
                let level = if r.heading_level > 0 {
                    r.heading_level
                } else if r.font_size >= 30. {
                    1
                } else if r.font_size >= 25. {
                    2
                } else if r.font_size >= 21. {
                    3
                } else {
                    4
                };
                BlockNode::Heading {
                    level,
                    children: p,
                    span: None,
                }
            } else if r.quote {
                BlockNode::Blockquote {
                    children: vec![BlockNode::Paragraph(p)],
                    span: None,
                }
            } else if !r.prefix.is_empty() {
                let start = r.prefix.trim_end_matches('.').parse::<u32>().ok();
                let group = r.group;
                let mut children = vec![];
                while n < regions.len()
                    && !regions[n].prefix.is_empty()
                    && regions[n].group == group
                {
                    let r = &regions[n];
                    let checked = match r.prefix.as_str() {
                        "☑" => Some(true),
                        "☐" => Some(false),
                        _ => None,
                    };
                    children.push(BlockNode::ListItem {
                        children: vec![BlockNode::Paragraph(paragraph(input, r, n as u64))],
                        spread: false,
                        checked,
                        span: None,
                    });
                    n += 1;
                }
                blocks.push(BlockNode::List {
                    children,
                    ordered: start.is_some(),
                    start,
                    span: None,
                });
                continue;
            } else {
                BlockNode::Paragraph(p)
            };
            blocks.push(block);
            n += 1;
        }
        let style = super::presentation::text_style(input.dark);
        let rcx = RenderContext::new(style).with_body_font_size(px(input.font_size));
        let min_height = input.min_height;
        let font_size = input.font_size;
        let document_mode = input.document_mode;
        let placeholder = input.placeholder.clone();
        let refs: Vec<_> = blocks.iter().collect();
        let children: Vec<_> = refs
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let content = b.render_with_id(
                    ("kit-block", i),
                    FlowPosition::at(&refs, i, i + 1 == refs.len()),
                    &rcx,
                    window,
                    cx,
                );
                if let Some((_, scroll, min_width)) = tables.get(&i) {
                    div()
                        .id(("table-viewport", i))
                        .w_full()
                        .overflow_x_scroll()
                        .track_scroll(scroll)
                        .child(div().min_w(*min_width).w_full().child(content))
                        .into_any_element()
                } else {
                    content
                }
            })
            .collect();
        let mut child = div()
            .relative()
            .w_full()
            .min_h(px(min_height))
            .font_family("Open Sans")
            .text_size(px(font_size))
            .line_height(relative(if document_mode {
                super::presentation::BODY_LINE_HEIGHT
            } else {
                1.55
            }))
            .text_color(t.text)
            .children(children)
            .when(text.is_empty(), |d| {
                d.child(
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .text_color(t.muted)
                        .child(placeholder),
                )
            })
            .into_any_element();
        let id = child.request_layout(window, cx);
        (
            id,
            Frame {
                child,
                regions,
                text,
                decorations,
                tables,
            },
        )
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        frame: &mut Frame,
        window: &mut Window,
        cx: &mut App,
    ) -> TextLayout {
        let (_, mut geometry) =
            collect_leaf_geometry(std::mem::take(&mut frame.decorations), || {
                frame.child.prepaint(window, cx)
            });
        let mut layout = TextLayout {
            origin: bounds.origin,
            ..Default::default()
        };
        for (n, r) in frame.regions.iter().enumerate() {
            if let Some(geometry) = geometry.remove(&(n as u64)) {
                if !r.prefix.is_empty() {
                    let b = geometry.bounds();
                    layout.labels.push(Label {
                        range: r.range.clone(),
                        origin: b.origin - bounds.origin - point(px(28.), px(0.)),
                        width: px(26.),
                        height: geometry.line_height(),
                    });
                }
                layout.leaves.push(Leaf {
                    range: r.range.clone(),
                    geometry,
                });
            }
        }
        self.input.update(cx, |input, _| {
            if input
                .last_bounds
                .is_some_and(|old| old.size.width != bounds.size.width)
            {
                input.reveal_cursor = true;
            }
            input.last_bounds = Some(bounds);
            input.last_layout = layout.clone();
            if input.reveal_cursor {
                let cursor = bounds.origin
                    + position_at(&layout, input.cursor_offset(), input.line_height());
                let view = input.scroll.bounds();
                let mut offset = input.scroll.offset();
                let h = layout.height_at(input.cursor_offset(), input.line_height());
                if cursor.y < view.top() + px(8.) {
                    offset.y += view.top() + px(8.) - cursor.y;
                } else if cursor.y + h > view.bottom() - px(8.) {
                    offset.y += view.bottom() - px(8.) - cursor.y - h;
                }
                offset.y = if input.cursor_offset() == 0 {
                    px(0.)
                } else {
                    offset.y.min(px(0.))
                };
                if offset != input.scroll.offset() {
                    input.scroll.set_offset(offset);
                    window.refresh();
                }
                for (range, scroll, _) in frame.tables.values() {
                    if range.contains(&input.cursor_offset()) || input.cursor_offset() == range.end
                    {
                        let view = scroll.bounds();
                        let mut offset = scroll.offset();
                        if cursor.x < view.left() + px(12.) {
                            offset.x += view.left() + px(12.) - cursor.x;
                        } else if cursor.x > view.right() - px(12.) {
                            offset.x += view.right() - px(12.) - cursor.x;
                        }
                        offset.x = if input.cursor_offset() == range.start {
                            px(0.)
                        } else {
                            offset.x.min(px(0.))
                        };
                        if offset != scroll.offset() {
                            scroll.set_offset(offset);
                            window.refresh();
                        }
                    }
                }
                input.reveal_cursor = false;
            }
        });
        layout
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        frame: &mut Frame,
        layout: &mut TextLayout,
        window: &mut Window,
        cx: &mut App,
    ) {
        frame.child.paint(window, cx);
        let input = self.input.read(cx);
        let focus = input.focus_handle.clone();
        let selected = input.selected_range.clone();
        let cursor = input.cursor_offset();
        let marked = input.marked_range.clone();
        let t = crate::theme::Theme::new(input.dark);
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        if focus.is_focused(window) && selected.is_empty() {
            window.paint_quad(fill(
                Bounds::new(
                    bounds.origin + position_at(layout, cursor, px(24.)),
                    size(px(1.5), layout.height_at(cursor, px(24.))),
                ),
                t.focus,
            ));
        }
        if let Some(marked) = marked {
            for leaf in &layout.leaves {
                let start = marked.start.max(leaf.range.start);
                let end = marked.end.min(leaf.range.end);
                if start >= end {
                    continue;
                }
                for (i, ch) in frame.text[start..end].char_indices() {
                    let a = leaf
                        .geometry
                        .position_for_index(start + i - leaf.range.start);
                    let b = leaf
                        .geometry
                        .position_for_index(start + i + ch.len_utf8() - leaf.range.start);
                    let width = if a.y == b.y {
                        b.x - a.x
                    } else {
                        leaf.geometry.bounds().right() - a.x
                    };
                    window.paint_quad(fill(
                        Bounds::new(
                            a + point(px(0.), leaf.geometry.caret_height()),
                            size(width.max(px(1.)), px(1.)),
                        ),
                        t.focus,
                    ));
                }
            }
        }
    }
}
