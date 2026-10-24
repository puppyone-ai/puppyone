//! Rich inline text for Agent Markdown: GPUI text runs (weight, style, colour,
//! underline, strikethrough) plus product inline-code chips painted behind
//! their glyphs, participating in Kit's window text selection. Inline code is
//! bracketed by `CODE_PAD` (U+E000, an empty glyph of the agent inline-code
//! face sized to the chip's padding + border); copying strips it.
use gpui::{prelude::*, *};
use gpui_kit::base::{
    TextSelection, TextSelectionHandle, TextSelectionRegistration, TextSelectionRun,
};
use std::{cell::RefCell, ops::Range, rc::Rc};

pub const CODE_PAD: char = '\u{E000}';
/// `tools/import-agent-code-font.py`.
pub const CODE_FAMILY: &str = "PuppyOne Agent Inline Code";

/// Chip box relative to its line's top (`code { padding: 0.12em 0.34em; border: 1px }`).
#[derive(Clone, Copy)]
pub struct ChipGeometry {
    pub top: f32,
    pub height: f32,
    pub fill: Hsla,
    pub border: Hsla,
    pub radius: f32,
}

pub struct RichText {
    id: ElementId,
    order: u64,
    text: SharedString,
    styled: StyledText,
    style: TextStyleRefinement,
    chips: Vec<Range<usize>>,
    chip: Option<ChipGeometry>,
    links: Vec<(Range<usize>, SharedString)>,
    selection: Option<Hsla>,
}

struct RichTextState {
    handle: TextSelectionHandle,
    copy: Rc<RefCell<String>>,
}

impl RichText {
    pub fn new(
        id: impl Into<ElementId>,
        text: SharedString,
        runs: Vec<TextRun>,
        style: TextStyleRefinement,
    ) -> Self {
        Self {
            id: id.into(),
            order: 0,
            styled: StyledText::new(text.clone()).with_runs(runs),
            text,
            style,
            chips: vec![],
            chip: None,
            links: vec![],
            selection: None,
        }
    }
    pub fn document_order(mut self, order: u64) -> Self {
        self.order = order;
        self
    }
    pub fn chips(mut self, ranges: Vec<Range<usize>>, geometry: ChipGeometry) -> Self {
        self.chips = ranges;
        self.chip = Some(geometry);
        self
    }
    pub fn links(mut self, links: Vec<(Range<usize>, SharedString)>) -> Self {
        self.links = links;
        self
    }
    pub fn selection_color(mut self, color: Hsla) -> Self {
        self.selection = Some(color);
        self
    }

    /// Line fragments of `range`, as `(left, line_top, right)` in window space.
    fn fragments(layout: &TextLayout, range: Range<usize>) -> Vec<(Pixels, Pixels, Pixels)> {
        let (Some(start), Some(end)) = (
            layout.position_for_index(range.start),
            layout.position_for_index(range.end),
        ) else {
            return vec![];
        };
        let bounds = layout.bounds();
        let line = layout.line_height();
        if start.y == end.y {
            return vec![(start.x, start.y, end.x)];
        }
        let mut out = vec![(start.x, start.y, bounds.right())];
        let mut y = start.y + line;
        while y < end.y {
            out.push((bounds.left(), y, bounds.right()));
            y += line;
        }
        if end.x > bounds.left() {
            out.push((bounds.left(), end.y, end.x));
        }
        out
    }

    fn link_at(&self, layout: &TextLayout, position: Point<Pixels>) -> Option<SharedString> {
        let index = layout.index_for_position(position).ok()?;
        self.links
            .iter()
            .find(|(range, _)| range.contains(&index))
            .map(|(_, url)| url.clone())
    }
}

impl IntoElement for RichText {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for RichText {
    type RequestLayoutState = (TextSelectionHandle, Rc<RefCell<String>>);
    type PrepaintState = Hitbox;

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let text = self.text.clone();
        let state = window.with_element_state(
            global_id.expect("RichText has a stable id"),
            |retained: Option<Rc<RichTextState>>, _| {
                let state = retained.unwrap_or_else(|| {
                    let handle = TextSelectionHandle::new(text.replace(CODE_PAD, ""), cx);
                    let copy = Rc::new(RefCell::new(String::new()));
                    let projected = copy.clone();
                    handle.copy_with(move |_| projected.borrow().clone(), cx);
                    Rc::new(RichTextState { handle, copy })
                });
                (state.clone(), state)
            },
        );
        let (layout_id, ()) = window.with_text_style(Some(self.style.clone()), |window| {
            self.styled
                .request_layout(global_id, inspector_id, window, cx)
        });
        (layout_id, (state.handle.clone(), state.copy.clone()))
    }

    fn prepaint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        (handle, _): &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        window.with_text_style(Some(self.style.clone()), |window| {
            self.styled
                .prepaint(global_id, inspector_id, bounds, &mut (), window, cx);
        });
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        let registration = TextSelectionRegistration::new(hitbox.clone(), bounds)
            .with_document_order(self.order)
            .with_text_bounds(vec![bounds])
            .with_rendered_element(handle, window, cx);
        handle.register(registration, window, cx);
        hitbox
    }

    fn paint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        (handle, copy): &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled.layout().clone();
        let before = TextSelection::selected_text(window, cx);
        let projection = handle.update_runs(
            &[
                TextSelectionRun::new(self.text.clone(), layout.clone(), bounds)
                    .with_document_order(self.order),
            ],
            cx,
        );
        *copy.borrow_mut() = projection
            .ranges()
            .iter()
            .flatten()
            .map(|range| self.text[range.clone()].replace(CODE_PAD, ""))
            .collect();
        if before != TextSelection::selected_text(window, cx) {
            window.refresh();
        }
        if let Some(chip) = self.chip {
            for range in &self.chips {
                for (left, top, right) in Self::fragments(&layout, range.clone()) {
                    window.paint_quad(PaintQuad {
                        bounds: Bounds::from_corners(
                            point(left, top + px(chip.top)),
                            point(right, top + px(chip.top + chip.height)),
                        ),
                        background: chip.fill.into(),
                        corner_radii: Corners::all(px(chip.radius)),
                        border_widths: Edges::all(px(1.)),
                        border_color: chip.border,
                        border_style: BorderStyle::default(),
                    });
                }
            }
        }
        let color = self
            .selection
            .unwrap_or_else(|| gpui_kit::base::Theme::global(cx).tokens.colors.selection);
        for range in projection.ranges().iter().flatten().cloned() {
            let line = layout.line_height();
            for (left, top, right) in Self::fragments(&layout, range) {
                window.paint_quad(fill(
                    Bounds::from_corners(point(left, top), point(right, top + line)),
                    color,
                ));
            }
        }
        window.with_text_style(Some(self.style.clone()), |window| {
            self.styled.paint(
                global_id,
                inspector_id,
                bounds,
                &mut (),
                &mut (),
                window,
                cx,
            );
        });
        if !self.links.is_empty() {
            if hitbox.is_hovered(window) && self.link_at(&layout, window.mouse_position()).is_some()
            {
                window.set_cursor_style(CursorStyle::PointingHand, hitbox);
            }
            let links = self.links.clone();
            let hitbox = hitbox.clone();
            window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble
                    || event.button != MouseButton::Left
                    || !hitbox.is_hovered(window)
                {
                    return;
                }
                if !TextSelection::selected_text(window, cx).is_empty() {
                    return;
                }
                let Ok(index) = layout.index_for_position(event.position) else {
                    return;
                };
                if let Some((_, url)) = links.iter().find(|(range, _)| range.contains(&index)) {
                    cx.open_url(url);
                }
            });
        }
    }
}
