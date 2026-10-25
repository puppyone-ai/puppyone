//! The editor element. It lays the document out for the bounds it is given
//! in the same frame: request-layout only asks for the pane (`size_full`);
//! prepaint builds the document as the product's CSS does (text column
//! centred on the reading rail, blocks stacked at exact fractional heights,
//! absolutely positioned host boxes around GPUI Kit text leaves), lays it out
//! as a root at the real bounds and lets Kit place the leaves inside a
//! `collect_leaf_geometry` scope (painting the selection as leaf
//! decorations).
//!
//! Only the blocks within a viewport above and below the visible one are
//! built (CodeMirror's viewport): the rest of the document is height from
//! `heights::HeightMap`, so a frame costs what is on screen, not the
//! document. A block above the one at the top of the viewport that turns
//! out taller or shorter than estimated moves the scroll by the difference
//! (scroll anchoring) and the pass is rebuilt. When what Kit laid out disagrees with the plan (a leaf
//! wrapped into another row count) or the caret reveal moves the scroll, the
//! pass is rolled back (`Window::transact`) and rebuilt, so a frame never
//! shows a layout for the wrong width or scroll. Paint adds what Kit does not
//! draw: caret, IME underline and line-break selection boxes.
use super::{
    decoration::Block,
    editor::EditorView,
    layout::{BlockGeometry, DocLayout, Leaf},
    render::{LeafEntry, RenderCx},
    widget::{WidgetCx, WidgetState},
};
use gpui::{prelude::*, *};
use gpui_kit::base::text::editor_host::collect_leaf_geometry;
use std::{collections::HashMap, ops::Range, rc::Rc};

/// Margin kept between the caret and the viewport edge when scrolling.
const SCROLL_MARGIN: f32 = 8.;

/// Layout passes one frame may take to settle: the plan, Kit's row-count
/// corrections, then the scroll the caret reveal asks for. Whatever is left
/// settles on the next frame.
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

/// Geometry dumps (`dev-capture`) compare every block with the product, so
/// they lay the whole document out.
fn render_everything() -> bool {
    #[cfg(feature = "dev-capture")]
    if std::env::var_os("PUPPYONE_EDITOR_GEOMETRY").is_some() {
        return true;
    }
    false
}

impl EditorElement {
    /// Builds the document for a pane `bounds` big at the view's scroll.
    fn build(
        &self,
        bounds: Bounds<Pixels>,
        focused: bool,
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
            kit,
            scroll,
            selection,
            read_only,
        ) = self.view.update(cx, |v, _| {
            let s = v.state.selection;
            (
                v.state.revision,
                v.doc_snapshot(),
                v.decorations.clone(),
                v.paragraph_cache.clone(),
                v.measures.clone(),
                v.heights.clone(),
                v.kit_context(),
                v.scroll_y,
                (s.from(), s.to()),
                v.read_only,
            )
        });
        let width = f32::from(bounds.size.width);
        let surface = decorations.surface.clone();
        let content = surface.content;
        // `.cm-content`: padding-inline max(gutter, (100% - rail) / 2).
        let available = (width - content.left - content.right).max(0.);
        let column_width = surface
            .max_text_width
            .map_or(available, |w| w.min(available));
        let column_left = content.left.max((width - column_width) / 2.);
        let mut rcx = RenderCx {
            doc: &doc,
            decorations: &decorations,
            leaves: Vec::new(),
            cache: &cache,
            measures: &measures,
            kit: &kit,
            view: self.view.downgrade(),
            scale: window.scale_factor(),
            keys: Default::default(),
            window,
            app: cx,
        };
        let mut heights = heights.borrow_mut();
        heights.prepare(&decorations, &doc, column_width, content.top);
        let count = heights.len();
        // The document from a viewport above the visible one to a viewport
        // below it (all of it for geometry dumps).
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
            let block = &decorations.blocks[i];
            let lines = block.lines();
            let source = doc.line_range(lines.start).start..doc.line_range(lines.end - 1).end;
            let (element, height) = match block {
                Block::Line { line, style } => rcx.line(
                    source.clone(),
                    style,
                    line + 1 < doc.line_count(),
                    y,
                    column_left,
                    column_width,
                ),
                Block::Widget { widget, .. } => {
                    let state =
                        WidgetState::of(&source, selection.0, selection.1, focused, read_only);
                    widget.render(&mut WidgetCx {
                        source: source.clone(),
                        top: y,
                        left: column_left,
                        width: column_width,
                        state,
                        render: &mut rcx,
                    })
                }
            };
            let delta = heights.measured(i, height);
            if i < anchor {
                // Content below this block moves; so does the viewport.
                correction += delta;
                until += delta;
            }
            children.push(element);
            blocks.push(PlannedBlock {
                lines,
                source,
                top: y,
                height,
                widget: matches!(block, Block::Widget { .. }),
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

    /// Lays `frame` out at `bounds`, prepaints it and publishes the layout
    /// to the view. False when the plan did not hold (Kit wrapped a leaf
    /// into another row count, or the scroll moved): the frame is stale.
    fn place(
        &self,
        frame: &mut Frame,
        bounds: Bounds<Pixels>,
        focused: bool,
        window: &mut Window,
        cx: &mut App,
    ) -> bool {
        let view = self.view.read(cx);
        let surface = &view.decorations.surface;
        let color: Hsla = if focused {
            surface.selection
        } else {
            surface.selection_inactive
        }
        .into();
        // The clause an input method converts is underlined, not selected.
        let selection = if view.composition_clause().is_some() {
            0..0
        } else {
            view.state.selection.as_range()
        };
        let measures = view.measures.clone();
        let mut decorations: HashMap<u64, Vec<(Range<usize>, Hsla)>> = HashMap::new();
        // A widget the selection covers whole shows its block-selected state
        // instead of text selection inside it (replaced widgets; tables make
        // `--po-selection-background` transparent while `is-doc-selected`).
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
            // Kit's inline flow (inline code) may wrap differently from the
            // plain-line prediction: adopt its row count.
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
            v.layout = Some(layout.clone());
            // Keep the viewport's top block in place over corrected estimates.
            v.scroll_y += frame.correction;
            let height = f32::from(bounds.size.height);
            if v.reveal_caret && settled && !layout.covers(v.state.selection.head) {
                // The caret's block is not laid out: scroll to where the
                // plan puts it; the next pass lays it out and reveals the
                // caret exactly.
                if let Some((top, bottom)) = v.estimated_block_of(v.state.selection.head) {
                    let before = v.scroll_y;
                    if v.reveal_centered {
                        v.scroll_y = (top + bottom) / 2. - height / 2.;
                    } else if top - SCROLL_MARGIN < v.scroll_y {
                        v.scroll_y = (top - SCROLL_MARGIN).max(0.);
                    } else if bottom + SCROLL_MARGIN > v.scroll_y + height {
                        v.scroll_y = bottom + SCROLL_MARGIN - height;
                    }
                    if v.scroll_y == before {
                        v.reveal_caret = false;
                    }
                } else {
                    v.reveal_caret = false;
                }
            } else if v.reveal_caret && settled {
                v.reveal_caret = false;
                let s = v.state.selection;
                let caret = layout.caret(s.head, s.upstream);
                // Document-relative caret row.
                let top = f32::from(caret.row_top - bounds.top()) + frame.scroll;
                let bottom = top + f32::from(caret.row_height);
                if std::mem::take(&mut v.reveal_centered) {
                    // A find match lands in the middle of the viewport.
                    v.scroll_y = (top + bottom) / 2. - height / 2.;
                } else if top - SCROLL_MARGIN < v.scroll_y {
                    v.scroll_y = (top - SCROLL_MARGIN).max(0.);
                } else if bottom + SCROLL_MARGIN > v.scroll_y + height {
                    v.scroll_y = bottom + SCROLL_MARGIN - height;
                }
            }
            // Whole device pixels, so text never shimmers between frames.
            v.scroll_y = (v.scroll_y.clamp(0., layout.max_scroll()) * scale).round() / scale;
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

    /// The editor fills its pane; the document is built once the pane's
    /// bounds are known (prepaint), never for a guessed width.
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
        let focused = self.view.read(cx).focus.is_focused(window);
        self.view.update(cx, |v, cx| {
            v.sync_decorations(focused);
            v.ensure_blink(focused, cx);
        });
        let mut pass = 0;
        let frame = loop {
            pass += 1;
            let mut frame = self.build(bounds, focused, window, cx);
            let last = pass == MAX_PASSES;
            let placed = window.transact(|window| {
                let settled = self.place(&mut frame, bounds, focused, window, cx);
                if settled || last {
                    Ok(settled)
                } else {
                    Err(())
                }
            });
            match placed {
                Ok(settled) => {
                    if !settled {
                        // Drawing ignores `Window::refresh`; ask for a frame.
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
        // Find matches mark their text (under it): `.cm-editor-find-match`
        // and the current one's stronger tint and outline.
        if let Some(layout) = self.view.read(cx).layout.clone() {
            let view = self.view.read(cx);
            let marks = &view.find;
            if !marks.matches.is_empty() {
                let t = crate::theme::Theme::new(view.dark);
                let visible =
                    |b: &Bounds<Pixels>| b.bottom() >= bounds.top() && b.top() <= bounds.bottom();
                window.with_content_mask(Some(ContentMask { bounds }), |window| {
                    for (i, range) in marks.matches.iter().enumerate() {
                        let current = marks.current == Some(i);
                        for b in layout
                            .range_boxes(range.clone())
                            .iter()
                            .filter(|b| visible(b))
                        {
                            let tint =
                                crate::theme::alpha(t.warning, if current { 0.58 } else { 0.34 });
                            if current {
                                let ring = crate::theme::mix(t.warning, t.text, 0.82);
                                window.paint_quad(quad(
                                    b.dilate(px(1.)),
                                    px(3.),
                                    Rgba::default(),
                                    px(1.),
                                    ring,
                                    BorderStyle::Solid,
                                ));
                            }
                            window.paint_quad(quad(
                                *b,
                                px(2.),
                                tint,
                                px(0.),
                                Rgba::default(),
                                BorderStyle::Solid,
                            ));
                        }
                    }
                });
            }
        }
        frame.child.paint(window, cx);
        let view = self.view.read(cx);
        let focus = view.focus.clone();
        let focused = focus.is_focused(window);
        let Some(layout) = view.layout.clone() else {
            return;
        };
        let surface = view.decorations.surface.clone();
        let selection = view.state.selection;
        let composition = view.composition_range();
        let clause = view.composition_clause();
        let show_caret = focused
            && selection.is_empty()
            && !view.read_only
            && view.caret_visible()
            && layout.covers(selection.head);
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
            }
            // Marked text: a thin underline on every row it covers; the
            // clause being converted gets a thick one (NSTextView's look).
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
        });
        // The candidate window follows the marked text when layout or scroll
        // moves it.
        let moved = self.view.update(cx, |v, _| {
            let current = v.composition.as_ref().map(|c| c.range.clone()).map(|r| {
                let rect = layout.first_row_rect(r.start..r.start);
                Bounds::new(
                    rect.origin + point(px(0.), layout.scroll - px(v.scroll_y)),
                    rect.size,
                )
            });
            match &mut v.composition {
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
