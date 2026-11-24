//! The editor element: viewport-virtualised block layout (`TA-13`), bounded
//! multi-pass scroll-anchor convergence (`TA-15`), panic-isolated widget
//! rendering (`TA-33`), and binary-searched visible-range painting (`TA-13`).
use super::{
    decoration::Block,
    editor::EditorView,
    layout::{BlockGeometry, DocLayout, Leaf, ScrollAnchor},
    render::{LeafEntry, RenderCx},
    style::LineStyle,
    widget::{WidgetCx, WidgetState, render_block_widget_safely},
};
use gpui::{prelude::*, *};
use gpui_kit::base::text::editor_host::collect_leaf_geometry;
use std::{collections::HashMap, ops::Range, rc::Rc};

/// Margin kept between the caret and the viewport edge when scrolling.
const SCROLL_MARGIN: f32 = 8.;

/// Layout passes one frame may take to settle (`TA-15`).
const MAX_PASSES: usize = 3;

/// Document laid out beyond each edge of the viewport, at least: a page
/// motion (viewport height) from a visible caret stays within the layout.
const MIN_OVERSCAN: f32 = 400.;

pub struct EditorElement {
    pub view: Entity<EditorView>,
}

impl IntoElement for EditorElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

struct PlannedBlock {
    #[cfg(feature = "dev-capture")]
    lines: Range<usize>,
    source: Range<usize>,
    top: f32,
    height: f32,
    /// A block widget (not a line box).
    widget: bool,
}

/// One built document: the element tree and the plan it was built from.
pub struct Frame {
    /// The document revision it was built from.
    revision: u64,
    child: AnyElement,
    leaves: Vec<LeafEntry>,
    blocks: Vec<PlannedBlock>,
    column_left: f32,
    column_width: f32,
    height: f32,
    scroll: f32,
    /// How far blocks above the viewport's top block moved once laid out
    /// (estimates corrected): the scroll that keeps that block in place.
    correction: f32,
    /// The built blocks start at the first block / end at the last one.
    starts: bool,
    ends: bool,
}

pub struct Prepainted {
    frame: Frame,
    hitbox: Hitbox,
}

fn render_everything() -> bool {
    #[cfg(feature = "dev-capture")]
    if std::env::var_os("PUPPYONE_EDITOR_GEOMETRY").is_some() {
        return true;
    }
    false
}

impl EditorElement {
    /// Builds the document for a pane `bounds` big at the view's scroll, or
    /// where `anchor` estimates it after the heights were planned again.
    fn build(
        &self,
        bounds: Bounds<Pixels>,
        focused: bool,
        anchor: Option<&ScrollAnchor>,
        window: &mut Window,
        cx: &mut App,
    ) -> Frame {
        let (
            revision,
            doc,
            decorations,
            cache,
            measures,
            heights,
            widget_states,
            kit,
            scroll,
            selection,
            read_only,
        ) = self.view.update(cx, |v, cx| {
            let s = v.state.selection;
            (
                v.state.revision,
                v.doc_snapshot(),
                v.caches.decorations.clone(),
                v.caches.paragraph_cache.clone(),
                v.caches.measures.clone(),
                v.caches.heights.clone(),
                v.caches.widget_states.clone(),
                v.kit_context(cx),
                v.scroll_y,
                (s.from(), s.to()),
                v.read_only,
            )
        });
        let width = f32::from(bounds.size.width);
        let surface = decorations.surface().clone();
        let content = surface.content;
        let available = (width - content.left - content.right).max(0.);
        let column_width = surface
            .max_text_width
            .map_or(available, |w| w.min(available));
        let column_left = content.left.max((width - column_width) / 2.);
        let mut rcx = RenderCx {
            revision,
            doc: &doc,
            decorations: &decorations,
            leaves: Vec::new(),
            cache: &cache,
            measures: &measures,
            widget_states: &widget_states,
            kit: &kit,
            view: self.view.downgrade(),
            scale: window.scale_factor(),
            keys: Default::default(),
            text_end: (1, 0.),
            rooms: Vec::new(),
            tab_size: super::projection::TAB_SIZE,
            window,
            app: cx,
        };
        let mut heights = heights.borrow_mut();
        heights.prepare(&decorations, &doc, column_width, content.top);
        let count = heights.len();
        // A new column width plans every block again, those never laid out
        // from estimates: start from where the anchor's block is now, so it
        // is laid out and `place` can hold its row exactly.
        let scroll = match anchor {
            Some(a) if count > 0 => {
                let offset = doc.clamp(a.offset());
                let i = decorations.block_index_for_line(doc.line_index(offset));
                if i < count && heights.valid(i) {
                    (heights.top(i) + a.within.min(heights.height(i)) - a.row).max(0.)
                } else {
                    scroll
                }
            }
            _ => scroll,
        };
        let viewport = f32::from(bounds.size.height);
        let overscan = viewport.max(MIN_OVERSCAN);
        let everything = render_everything();
        let (first, anchor) = if everything || count == 0 {
            (0, 0)
        } else {
            (
                heights.index_at(scroll - overscan),
                heights.index_at(scroll),
            )
        };
        let mut until = scroll + viewport + overscan;
        let mut correction = 0.;
        let mut children = Vec::new();
        let mut blocks = Vec::new();
        let mut y = if count == 0 {
            content.top
        } else {
            heights.top(first)
        };
        let mut index = first;
        while index < count && (everything || y < until) {
            let i = index;
            index += 1;
            if !heights.valid(i) {
                continue;
            }
            let block = decorations.block(i);
            let lines = block.lines();
            let source = doc.line_range(lines.start).start..doc.line_range(lines.end - 1).end;
            let mut is_widget = matches!(block, Block::Widget { .. });
            let (element, height) = match block {
                Block::Line { line, style } => rcx.line(
                    source.clone(),
                    style,
                    line + 1 < doc.line_count(),
                    y,
                    column_left,
                    column_width,
                    WidgetState::of(&source, selection.0, selection.1, focused, read_only),
                ),
                Block::Widget { id, lines, widget } => {
                    let state =
                        WidgetState::of(&source, selection.0, selection.1, focused, read_only);
                    let rendered = render_block_widget_safely(
                        widget.as_ref(),
                        &mut WidgetCx {
                            block_id: *id,
                            source: source.clone(),
                            top: y,
                            left: column_left,
                            width: column_width,
                            state,
                            render: &mut rcx,
                        },
                    );
                    if let Some(ok) = rendered {
                        ok
                    } else {
                        // TA-33: a widget that panics during render degrades to
                        // visible source lines without crashing the editor.
                        is_widget = false;
                        let fallback_style = LineStyle::default();
                        let mut line_elems = Vec::with_capacity(lines.len());
                        let mut h_sum = 0f32;
                        for ln in lines.clone() {
                            let lr = doc.line_range(ln);
                            let (el, lh) = rcx.line(
                                lr.clone(),
                                &fallback_style,
                                ln + 1 < doc.line_count(),
                                y + h_sum,
                                column_left,
                                column_width,
                                WidgetState::of(&lr, selection.0, selection.1, focused, read_only),
                            );
                            line_elems.push(el);
                            h_sum += lh;
                        }
                        (div().children(line_elems).into_any_element(), h_sum)
                    }
                }
            };
            let delta = heights.measured(i, height);
            if i < anchor {
                correction += delta;
                until += delta;
            }
            children.push(element);
            blocks.push(PlannedBlock {
                #[cfg(feature = "dev-capture")]
                lines,
                source,
                top: y,
                height,
                widget: is_widget,
            });
            y += height;
        }
        let leaves = std::mem::take(&mut rcx.leaves);
        cache.borrow_mut().sweep();
        measures.borrow_mut().sweep();
        let starts = first == 0;
        let ends = index >= count;
        let height = if count == 0 { y } else { heights.bottom() } + content.bottom;
        let document = div()
            .absolute()
            .left_0()
            .top(px(-scroll))
            .w(px(width))
            .h(px(height))
            .children(children);
        let child = div()
            .relative()
            .w(bounds.size.width)
            .h(bounds.size.height)
            .overflow_hidden()
            .bg(surface.background)
            .child(document)
            .into_any_element();
        Frame {
            revision,
            child,
            leaves,
            blocks,
            column_left,
            column_width,
            height,
            scroll,
            correction,
            starts,
            ends,
        }
    }

    fn place(
        &self,
        frame: &mut Frame,
        bounds: Bounds<Pixels>,
        focused: bool,
        anchor: Option<&ScrollAnchor>,
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        let view = self.view.read(cx);
        let surface = view.caches.decorations.surface();
        let color: Hsla = if focused {
            surface.selection
        } else {
            surface.selection_inactive
        }
        .into();
        let selection = if view.composition_clause().is_some() {
            0..0
        } else {
            view.state.selection.as_range()
        };
        let measures = view.caches.measures.clone();
        let mut decorations: HashMap<u64, Vec<(Range<usize>, Hsla)>> = HashMap::new();
        let covered: Vec<&Range<usize>> = frame
            .blocks
            .iter()
            .filter(|b| {
                b.widget
                    && WidgetState::of(&b.source, selection.start, selection.end, focused, false)
                        .selected
            })
            .map(|b| &b.source)
            .collect();
        let painted: Vec<LeafEntry> = frame
            .leaves
            .iter()
            .filter(|l| {
                !covered
                    .iter()
                    .any(|c| c.start <= l.text.source.start && l.text.source.end <= c.end)
            })
            .cloned()
            .collect();
        for (key, range) in DocLayout::selection_ranges(&painted, &selection) {
            decorations.entry(key).or_default().push((range, color));
        }
        let child = &mut frame.child;
        let (_, mut geometry) = collect_leaf_geometry(decorations, || {
            child.layout_as_root(bounds.size.into(), window, cx);
            child.prepaint_at(bounds.origin, window, cx);
        });
        let mut settled = true;
        let mut leaves = Vec::with_capacity(frame.leaves.len());
        for entry in std::mem::take(&mut frame.leaves) {
            let Some(geometry) = geometry.remove(&entry.key) else {
                continue;
            };
            let line = f32::from(geometry.line_height()).max(1.);
            let rows = (f32::from(geometry.bounds().size.height) / line)
                .round()
                .max(1.) as usize;
            if rows != entry.rows {
                measures
                    .borrow_mut()
                    .corrections
                    .insert(entry.measure_key, rows);
                settled = false;
            }
            leaves.push(Leaf { entry, geometry });
        }
        let origin = bounds.origin + point(px(frame.column_left), px(-frame.scroll));
        let blocks = frame
            .blocks
            .iter()
            .map(|b| BlockGeometry {
                bounds: Bounds::new(
                    origin + point(px(0.), px(b.top)),
                    size(px(frame.column_width), px(b.height)),
                ),
                #[cfg(feature = "dev-capture")]
                lines: b.lines.clone(),
                source: b.source.clone(),
            })
            .collect();
        let layout = Rc::new(DocLayout {
            revision: frame.revision,
            bounds,
            scroll: px(frame.scroll),
            height: px(frame.height),
            leaves,
            blocks,
            starts_document: frame.starts,
            ends_document: frame.ends,
        });
        let scale = window.scale_factor();
        self.view.update(cx, |v, _| {
            v.bounds = Some(bounds);
            v.caches.layout = Some(layout.clone());
            // The anchor's row where it was in the viewport; without one,
            // the blocks above it absorb what their measurement changed.
            let anchored = anchor.and_then(|a| Some((a, layout.anchored_scroll(a)?)));
            v.scroll_y = anchored.map_or(frame.scroll + frame.correction, |(_, y)| y);
            let held = v.scroll_y;
            let height = f32::from(bounds.size.height);
            if v.pointer.reveal_caret && settled && !layout.covers(v.state.selection.head) {
                if let Some((top, bottom)) = v.estimated_block_of(v.state.selection.head) {
                    let before = v.scroll_y;
                    if v.pointer.reveal_centered {
                        v.scroll_y = (top + bottom) / 2. - height / 2.;
                    } else if top - SCROLL_MARGIN < v.scroll_y {
                        v.scroll_y = (top - SCROLL_MARGIN).max(0.);
                    } else if bottom + SCROLL_MARGIN > v.scroll_y + height {
                        v.scroll_y = bottom + SCROLL_MARGIN - height;
                    }
                    if v.scroll_y == before {
                        v.pointer.reveal_caret = false;
                    }
                } else {
                    v.pointer.reveal_caret = false;
                }
            } else if v.pointer.reveal_caret && settled {
                v.pointer.reveal_caret = false;
                let s = v.state.selection;
                let caret = layout.caret(s.head, s.upstream);
                let top = f32::from(caret.row_top - bounds.top()) + frame.scroll;
                let bottom = top + f32::from(caret.row_height);
                if std::mem::take(&mut v.pointer.reveal_centered) {
                    v.scroll_y = (top + bottom) / 2. - height / 2.;
                } else if top - SCROLL_MARGIN < v.scroll_y {
                    v.scroll_y = (top - SCROLL_MARGIN).max(0.);
                } else if bottom + SCROLL_MARGIN > v.scroll_y + height {
                    v.scroll_y = bottom + SCROLL_MARGIN - height;
                }
            }
            // A caret reveal moved away from the anchor: the next frame
            // chooses again.
            let revealed = v.scroll_y != held;
            v.scroll_y = (v.scroll_y.clamp(0., layout.max_scroll()) * scale).round() / scale;
            v.held_anchor = anchored
                .filter(|_| !revealed)
                .map(|(a, _)| (*a, v.scroll_y, frame.revision));
            if v.scroll_y != frame.scroll {
                settled = false;
            }
        });
        #[cfg(feature = "dev-capture")]
        if settled && let Some(path) = std::env::var_os("PUPPYONE_EDITOR_GEOMETRY") {
            static WRITTEN: std::sync::atomic::AtomicBool =
                std::sync::atomic::AtomicBool::new(false);
            if !layout.leaves.is_empty()
                && !WRITTEN.swap(true, std::sync::atomic::Ordering::Relaxed)
            {
                let _ = std::fs::write(
                    path,
                    serde_json::to_vec_pretty(&layout.dump()).unwrap_or_default(),
                );
            }
        }
        settled
    }
}

impl Element for EditorElement {
    type RequestLayoutState = ();
    type PrepaintState = Prepainted;

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
    ) -> (LayoutId, ()) {
        let style = Style {
            size: size(relative(1.).into(), relative(1.).into()),
            overflow: point(Overflow::Hidden, Overflow::Hidden),
            ..Default::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Prepainted {
        // The content's text, built and laid out here, takes its language's
        // script faces (`lang`); the editor's chrome keeps the interface's.
        let language = self.view.read(cx).surface().language.clone();
        crate::ui::fonts::with_content_language(language.as_ref(), || {
            self.prepaint_content(bounds, window, cx)
        })
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        prepainted: &mut Prepainted,
        window: &mut Window,
        cx: &mut App,
    ) {
        let Prepainted { frame, hitbox } = prepainted;
        window.set_cursor_style(CursorStyle::IBeam, hitbox);

        // Plugin underlays (e.g. FindPlugin match highlights, binary-searched
        // over visible viewport byte range, `TA-13`, `TA-20`).
        {
            let view = self.view.read(cx);
            if let Some(layout) = &view.caches.layout {
                let dark = view.dark;
                for plugin in &view.extensions.plugins {
                    plugin.paint_underlay(dark, layout, bounds, window);
                }
            }
        }

        frame.child.paint(window, cx);
        let view = self.view.read(cx);
        let focus = view.focus.clone();
        let focused = focus.is_focused(window);
        let Some(layout) = view.caches.layout.clone() else {
            return;
        };
        let layered = view.caches.decorations.clone();
        let surface = layered.surface().clone();
        let selection = view.state.selection;
        let secondary = view.secondary.clone();
        let composition = view.composition_range();
        let clause = view.composition_clause();
        let can_show_carets = focused && !view.read_only && view.caret_visible();
        let show_caret = can_show_carets && selection.is_empty() && layout.covers(selection.head);
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.view.clone()),
            cx,
        );
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            let color: Hsla = if focused {
                surface.selection
            } else {
                surface.selection_inactive
            }
            .into();
            let text_system = window.text_system().clone();
            let space = |leaf: &LeafEntry| {
                let id = text_system.resolve_font(&font(leaf.style.family()));
                text_system
                    .advance(id, px(leaf.style.size), ' ')
                    .map_or(px(leaf.style.size / 4.), |s| s.width)
            };
            if clause.is_none() {
                for b in layout.line_break_boxes(selection.as_range(), space) {
                    window.paint_quad(fill(b, color));
                }
                for sec in &secondary {
                    for b in layout.line_break_boxes(sec.as_range(), space) {
                        window.paint_quad(fill(b, color));
                    }
                }
            }
            // TA-13: binary-search decoration underlines over only the visible
            // viewport byte range instead of iterating the whole document!
            if !layout.leaves.is_empty() {
                let vis_start = layout.leaves.first().map_or(0, |l| l.source().start);
                let vis_end = layout.leaves.last().map_or(0, |l| l.source().end);
                layered.for_each_underline_in(&(vis_start..vis_end), |u| {
                    for b in layout.range_boxes(u.range.clone()) {
                        let y = b.top() + b.size.height / 2. + px(0.35 * u.size + 2.);
                        let mut x = b.left();
                        while x < b.right() {
                            let w = px(u.dash).min(b.right() - x);
                            window.paint_quad(fill(
                                Bounds::new(point(x, y), size(w, px(1.))),
                                u.color,
                            ));
                            x += px(u.dash + u.gap);
                        }
                    }
                });
            }
            if let Some(range) = &composition {
                for r in layout.underline_boxes(range.clone(), px(1.)) {
                    window.paint_quad(fill(r, surface.caret));
                }
                if let Some(clause) = &clause {
                    for r in layout.underline_boxes(clause.clone(), px(2.)) {
                        window.paint_quad(fill(r, surface.caret));
                    }
                }
            }
            if show_caret {
                let c = layout.caret(selection.head, selection.upstream);
                let r = Bounds::new(point(c.x, c.top), size(px(surface.caret_width), c.height));
                window.paint_quad(fill(r, surface.caret));
            }
            if can_show_carets {
                for sec in &secondary {
                    if sec.is_empty() && layout.covers(sec.head) {
                        let c = layout.caret(sec.head, sec.upstream);
                        let r =
                            Bounds::new(point(c.x, c.top), size(px(surface.caret_width), c.height));
                        window.paint_quad(fill(r, surface.caret));
                    }
                }
            }
        });
        let moved = self.view.update(cx, |v, _| {
            let current = v
                .ime
                .composition
                .as_ref()
                .map(|c| c.range.clone())
                .map(|r| {
                    let rect = layout.first_row_rect(r.start..r.start);
                    Bounds::new(
                        rect.origin + point(px(0.), layout.scroll - px(v.scroll_y)),
                        rect.size,
                    )
                });
            match &mut v.ime.composition {
                Some(c) if c.anchor != current => {
                    let first = c.anchor.is_none();
                    c.anchor = current;
                    !first
                }
                _ => false,
            }
        });
        if moved {
            window.invalidate_character_coordinates();
        }
    }
}

impl EditorElement {
    fn prepaint_content(
        &mut self,
        bounds: Bounds<Pixels>,
        window: &mut Window,
        cx: &mut App,
    ) -> Prepainted {
        let focused = self.view.read(cx).focus.is_focused(window);
        self.view.update(cx, |v, cx| {
            v.sync_decorations(focused);
            v.ensure_blink(focused, cx);
        });
        // The text at the viewport top, held still however this frame's
        // blocks lay out.
        let mut anchor = self.view.read(cx).scroll_anchor();
        let mut pass = 0;
        let frame = loop {
            pass += 1;
            let estimate = anchor.as_ref().filter(|_| pass == 1);
            let mut frame = self.build(bounds, focused, estimate, window, cx);
            let last = pass == MAX_PASSES;
            let placed = window.transact(|window| {
                let settled = self.place(&mut frame, bounds, focused, anchor.as_ref(), window, cx);
                if settled || last {
                    Ok(settled)
                } else {
                    Err(())
                }
            });
            // A caret reveal scrolled away from the anchor (or the anchor
            // was not laid out): later passes keep that scroll.
            if self.view.read(cx).held_anchor.is_none() {
                anchor = None;
            }
            match placed {
                Ok(settled) => {
                    if !settled {
                        let view = self.view.entity_id();
                        window.on_next_frame(move |_, cx| cx.notify(view));
                    }
                    break frame;
                }
                Err(()) => continue,
            }
        };
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        Prepainted { frame, hitbox }
    }
}
