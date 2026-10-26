//! The render context: building the frame's element tree. The view lays blocks out itself, the
//! way Chromium lays out the product's CodeMirror lines: every box gets its
//! exact (fractional) CSS geometry and an absolute position, so GPUI's
//! per-box pixel snapping never accumulates down the document. Text inside a
//! box is a keyed GPUI Kit paragraph (`editor_host`), placed so its first
//! baseline lands on the device pixel Chromium uses; rows are counted with
//! GPUI's own shaping (the same runs Kit shapes), so box heights follow
//! Kit's wrapping.
//!
//! Block widgets (CodeMirror `Decoration.replace({ block: true })`) replace
//! whole source lines with their own boxes and leaves; the document text
//! inside them stays the one canonical source.
mod baseline;
mod cache;

pub use baseline::{chromium_baseline, chromium_text_top, primary_metrics};
pub use cache::{LeafEntry, MeasureCache, ParagraphCache, TextMetrics};

use crate::editor::{
    text::buffer::Buffer,
    view::{
        command::Command,
        decoration::Decorations,
        editor::EditorView,
        projection::LeafText,
        style::{Align, LineStyle, Paint, Rect, TextStyle},
    },
};
use baseline::round_half_down;
use gpui::{prelude::*, *};
use gpui_kit::base::text::editor_host::{BlockNode, CodeBlock, FlowPosition, RenderContext};
use std::{
    cell::RefCell,
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

pub struct RenderCx<'a> {
    pub doc: &'a Buffer,
    pub decorations: &'a Decorations,
    pub leaves: Vec<LeafEntry>,
    pub cache: &'a RefCell<ParagraphCache>,
    pub measures: &'a RefCell<MeasureCache>,
    pub kit: &'a RenderContext,
    pub view: WeakEntity<EditorView>,
    /// Device pixels per CSS pixel.
    pub scale: f32,
    /// Leaf keys handed out this frame.
    pub keys: std::collections::HashSet<u64>,
    pub window: &'a mut Window,
    pub app: &'a mut App,
}

impl RenderCx<'_> {
    /// Round a length to whole device pixels as GPUI does for authored sizes.
    pub fn snap(&self, v: f32) -> f32 {
        round_half_down(v * self.scale) / self.scale
    }

    pub fn font(style: &TextStyle) -> Font {
        let text = style.refinement();
        Font {
            family: style.family(),
            features: text.font_features.unwrap_or_default(),
            fallbacks: text.font_fallbacks,
            weight: FontWeight(style.weight),
            style: if style.italic {
                FontStyle::Italic
            } else {
                FontStyle::Normal
            },
        }
    }

    /// Shape `leaf` with the runs Kit's plain inline path uses.
    fn measure(
        &mut self,
        leaf: &LeafText,
        style: &TextStyle,
        wrap: Option<f32>,
    ) -> (u64, TextMetrics) {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        leaf.text.hash(&mut h);
        for (r, m) in &leaf.marks {
            (r.start, r.end, m.bold, m.italic, m.code).hash(&mut h);
        }
        (
            style.family(),
            style.size.to_bits(),
            style.weight.to_bits(),
            style.italic,
            style.tabular,
            wrap.map(f32::to_bits),
        )
            .hash(&mut h);
        let key = h.finish();
        let mut cache = self.measures.borrow_mut();
        let found = cache
            .used
            .get(&key)
            .or_else(|| cache.entries.get(&key))
            .copied();
        let mut metrics = match found {
            Some(m) => m,
            None => {
                drop(cache);
                let base = Self::font(style);
                // Inline code shapes as Geist Mono at the full size (what the
                // inline-code family renders at Kit's 0.875 code size).
                let mono = TextStyle {
                    mono: true,
                    ..style.clone()
                }
                .family();
                let run = |len: usize, bold: bool, italic: bool, code: bool| TextRun {
                    len,
                    font: Font {
                        family: if code {
                            mono.clone()
                        } else {
                            base.family.clone()
                        },
                        weight: if bold { FontWeight::BOLD } else { base.weight },
                        style: if italic {
                            FontStyle::Italic
                        } else {
                            base.style
                        },
                        ..base.clone()
                    },
                    color: black(),
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                };
                let mut runs = Vec::new();
                let mut at = 0;
                for (r, m) in &leaf.marks {
                    if r.start > at {
                        runs.push(run(r.start - at, false, false, false));
                    }
                    runs.push(run(r.len(), m.bold, m.italic, m.code));
                    at = r.end;
                }
                if at < leaf.text.len() {
                    runs.push(run(leaf.text.len() - at, false, false, false));
                }
                let shaped = self.window.text_system().shape_text(
                    leaf.text.clone().into(),
                    px(style.size),
                    &runs,
                    wrap.map(px),
                    None,
                );
                let metrics = match shaped.ok().as_ref().and_then(|lines| lines.first()) {
                    Some(line) if !leaf.text.is_empty() => TextMetrics {
                        rows: line.wrap_boundaries.len() + 1,
                        ascent: f32::from(line.unwrapped_layout.ascent),
                        descent: f32::from(line.unwrapped_layout.descent),
                    },
                    _ => {
                        let (a, d) = self.primary_metrics(style);
                        TextMetrics {
                            rows: 1,
                            ascent: a,
                            descent: d,
                        }
                    }
                };
                cache = self.measures.borrow_mut();
                metrics
            }
        };
        cache.used.insert(key, metrics);
        if let Some(rows) = cache.corrections.get(&key) {
            metrics.rows = *rows;
        }
        (key, metrics)
    }

    /// The key of the leaf showing `source`. It follows the source, not the
    /// leaf's place in the frame: a frame builds only the blocks near the
    /// viewport, so scrolling changes which leaves come first, and a
    /// positional key would hand every paragraph a new identity (and Kit
    /// would shape it again).
    fn leaf_key(&mut self, source: &Range<usize>) -> u64 {
        let mut key = ((source.start as u64) << 32) ^ source.end as u64;
        while !self.keys.insert(key) {
            key = key.wrapping_add(0x9E37_79B9_7F4A_7C15);
        }
        key
    }

    /// Unrounded ascent and descent of the style's primary face.
    fn primary_metrics(&mut self, style: &TextStyle) -> (f32, f32) {
        primary_metrics(self.window, style)
    }

    /// Top (relative to `block_top`) of a text container whose first row
    /// should sit at document y `row_top` (see `chromium_text_top`).
    fn baseline_top(
        &mut self,
        style: &TextStyle,
        metrics: TextMetrics,
        block_top: f32,
        row_top: f32,
    ) -> f32 {
        let primary = self.primary_metrics(style);
        chromium_text_top(
            self.scale,
            style,
            primary,
            (metrics.ascent, metrics.descent),
            row_top,
        ) - block_top
    }

    /// A keyed Kit text leaf showing `source` with its first row at
    /// (`x`, `y`) inside the block whose document top is `block_top`.
    /// Returns the positioned container and the CSS height of its rows.
    #[expect(
        clippy::too_many_arguments,
        reason = "the same positional parameters as text_aligned, left-aligned"
    )]
    pub fn text(
        &mut self,
        source: Range<usize>,
        style: &TextStyle,
        strike: bool,
        wrap: Option<f32>,
        line_break: bool,
        block_top: f32,
        x: f32,
        y: f32,
    ) -> (AnyElement, f32) {
        self.text_aligned(
            source,
            style,
            strike,
            wrap,
            line_break,
            block_top,
            x,
            y,
            TextAlign::Left,
        )
    }

    /// `text` with a horizontal alignment of its rows (`text-align`).
    #[allow(clippy::too_many_arguments)]
    pub fn text_aligned(
        &mut self,
        source: Range<usize>,
        style: &TextStyle,
        strike: bool,
        wrap: Option<f32>,
        line_break: bool,
        block_top: f32,
        x: f32,
        y: f32,
        align: TextAlign,
    ) -> (AnyElement, f32) {
        let d = self.decorations;
        let leaf = LeafText::build(
            self.doc.as_str(),
            source.clone(),
            d.hidden_in(&source),
            d.marks_in(&source),
            strike,
        );
        let wrap = wrap.map(|w| self.snap(w));
        let (measure_key, metrics) = self.measure(&leaf, style, wrap);
        let key = self.leaf_key(&source);
        let (paragraph, text) = self.cache.borrow_mut().get(&leaf, key);
        let code = text.marks.iter().any(|(_, m)| m.code);
        self.leaves.push(LeafEntry {
            key,
            text,
            style: style.clone(),
            line_break,
            rows: metrics.rows,
            measure_key,
        });
        let block = BlockNode::Paragraph(paragraph);
        let refs = [&block];
        let flow = FlowPosition::at(&refs, 0, true);
        // Kit resolves an inline-code mark's family from the theme while the
        // paragraph is built; use the editor's inline-code family for it.
        let previous = code.then(|| {
            let theme = gpui_kit::base::Theme::global_mut(self.app);
            std::mem::replace(
                &mut theme.tokens.typography.mono,
                SharedString::from(super::style::inline_code_family(style.weight)),
            )
        });
        let element = block.render(key as usize, flow, self.kit, self.window, self.app);
        if let Some(previous) = previous {
            gpui_kit::base::Theme::global_mut(self.app)
                .tokens
                .typography
                .mono = previous;
        }
        let top = self.baseline_top(style, metrics, block_top, block_top + y);
        let mut container = div().absolute().left(px(x)).top(px(top));
        container = match wrap {
            Some(w) => container.w(px(w)),
            None => container.whitespace_nowrap(),
        };
        style.apply(container.style());
        container.style().text.text_align = Some(align);
        (
            container.child(element).into_any_element(),
            metrics.rows as f32
                * baseline::chromium_line_height(self.scale, style.line_height_px()),
        )
    }

    /// A keyed Kit code leaf (`white-space: pre`, hard line breaks) showing
    /// `source` with its first row at (`x`, `y`) inside the box whose
    /// document top is `box_top`. Returns the container and its CSS height.
    /// `highlight` colours the displayed code (Kit code-block highlighter).
    #[allow(clippy::too_many_arguments)]
    pub fn code(
        &mut self,
        source: Range<usize>,
        style: &TextStyle,
        tab_size: usize,
        box_top: f32,
        x: f32,
        y: f32,
        width: f32,
        highlight: impl FnOnce(&str) -> std::sync::Arc<Vec<(Range<usize>, HighlightStyle)>>,
    ) -> (AnyElement, f32) {
        let key = self.leaf_key(&source);
        let leaf = LeafText::build_with_tabs(self.doc.as_str(), source, &[], &[], false, tab_size);
        let styles = highlight(&leaf.text);
        let rows = leaf.text.split('\n').count();
        let (ascent, descent) = self.primary_metrics(style);
        let metrics = TextMetrics {
            rows,
            ascent,
            descent,
        };
        self.leaves.push(LeafEntry {
            key,
            text: Rc::new(leaf.clone()),
            style: style.clone(),
            line_break: false,
            rows,
            measure_key: 0,
        });
        // Kit's code block, restyled to the product panel's text: the panel
        // box itself is the host's.
        let mut refinement = StyleRefinement::default()
            .p_0()
            .border_0()
            .bg(transparent_black());
        refinement.text = style.refinement();
        refinement.text.white_space = Some(WhiteSpace::Nowrap);
        let kit = self
            .kit
            .clone()
            .with_style(self.kit.style().clone().with_code_block(refinement))
            .with_code_block_highlighter(move |_| (*styles).clone());
        let block = BlockNode::CodeBlock(
            CodeBlock::from_code(leaf.text.clone(), None::<SharedString>).with_leaf_key(key),
        );
        let refs = [&block];
        let element = block.render(
            key as usize,
            FlowPosition::at(&refs, 0, true),
            &kit,
            self.window,
            self.app,
        );
        let top = self.baseline_top(style, metrics, box_top, box_top + y);
        let container = div()
            .absolute()
            .left(px(x))
            .top(px(top))
            .w(px(width))
            .child(element);
        (
            container.into_any_element(),
            rows as f32 * style.line_height_px(),
        )
    }

    /// Non-source text (list markers) on one row of `rect`, its baseline
    /// where the product's flex-centred `::before` puts it.
    pub fn label(
        &mut self,
        rect: Rect,
        text: &SharedString,
        style: &TextStyle,
        align: Align,
        block_top: f32,
    ) -> AnyElement {
        let (a, d) = self.primary_metrics(style);
        let metrics = TextMetrics {
            rows: 1,
            ascent: a,
            descent: d,
        };
        // A one-row line box of 1lh, centred in the rect.
        let row_top = rect.y + (rect.height - style.line_height_px()) / 2.;
        let top = self.baseline_top(style, metrics, block_top, block_top + row_top);
        let mut label = div()
            .absolute()
            .left(px(rect.x))
            .top(px(top))
            .w(px(rect.width))
            .flex()
            .whitespace_nowrap();
        label = match align {
            Align::Start => label.justify_start(),
            Align::Center => label.justify_center(),
            Align::End => label.justify_end(),
        };
        style.apply(label.style());
        label.child(text.clone()).into_any_element()
    }

    /// A box decoration (background, border, polygon) or label.
    pub fn paint(&mut self, paint: &Paint, block_top: f32) -> AnyElement {
        match paint {
            Paint::Quad {
                rect,
                background,
                radii,
                border,
                border_color,
            } => {
                let mut quad = div()
                    .absolute()
                    .left(px(rect.x))
                    .top(px(rect.y))
                    .w(px(rect.width))
                    .h(px(rect.height))
                    .rounded_tl(px(radii[0]))
                    .rounded_tr(px(radii[1]))
                    .rounded_br(px(radii[2]))
                    .rounded_bl(px(radii[3]));
                if let Some(bg) = background {
                    quad = quad.bg(*bg);
                }
                if let Some(color) = border_color {
                    quad = quad.border(px(*border)).border_color(*color);
                }
                quad.into_any_element()
            }
            Paint::Label {
                rect,
                text,
                style,
                align,
            } => self.label(*rect, text, style, *align, block_top),
            Paint::Polygon { points, color } => {
                let (points, color) = (points.clone(), *color);
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let mut builder = PathBuilder::fill();
                        for (k, (x, y)) in points.iter().enumerate() {
                            let p = bounds.origin + point(px(*x), px(*y));
                            if k == 0 {
                                builder.move_to(p)
                            } else {
                                builder.line_to(p)
                            }
                        }
                        builder.close();
                        if let Ok(path) = builder.build() {
                            window.paint_path(path, color);
                        }
                    },
                )
                .absolute()
                .left_0()
                .top_0()
                .size_full()
                .into_any_element()
            }
        }
    }

    /// An interactive area that runs `command` through the format.
    pub fn hotspot(&mut self, rect: Rect, command: Command) -> AnyElement {
        let view = self.view.clone();
        let id = self.leaves.len();
        div()
            .id(("editor-hotspot", id))
            .absolute()
            .left(px(rect.x))
            .top(px(rect.y))
            .w(px(rect.width))
            .h(px(rect.height))
            .cursor(CursorStyle::Arrow)
            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                cx.stop_propagation();
                let _ = view.update(cx, |v, cx| v.run_command(&command, window, cx));
            })
            .into_any_element()
    }

    /// A positioned block box of the given document geometry.
    pub fn block_box(&self, top: f32, left: f32, width: f32, height: f32) -> Div {
        div()
            .absolute()
            .top(px(top))
            .left(px(left))
            .w(px(width))
            .h(px(height))
    }

    /// A `.cm-line` box at document `top`: background, inset rule, border,
    /// its text leaf and absolutely positioned decorations. Returns the
    /// element and its CSS height.
    pub fn line(
        &mut self,
        source: Range<usize>,
        style: &LineStyle,
        line_break: bool,
        top: f32,
        left: f32,
        width: f32,
    ) -> (AnyElement, f32) {
        let (p, b) = (style.padding, style.border);
        let x = b.left + p.left;
        let y = b.top + p.top;
        let wrap = (!style.nowrap).then(|| (width - x - p.right - b.right).max(0.));
        let (text, text_height) = self.text(
            source,
            &style.text,
            style.strike,
            wrap,
            line_break,
            top,
            x,
            y,
        );
        let height = y + text_height + p.bottom + b.bottom;
        let mut line = self.block_box(top, left, width, height);
        if let Some(bg) = style.background {
            line = line.bg(bg);
        }
        if let Some((n, color)) = style.inset_bottom {
            line = line.child(
                div()
                    .absolute()
                    .left_0()
                    .w(px(width))
                    .top(px(height - n))
                    .h(px(n))
                    .bg(color),
            );
        }
        if let Some(color) = style.border_color {
            for r in [
                Rect::new(0., 0., b.left, height),
                Rect::new(width - b.right, 0., b.right, height),
                Rect::new(0., 0., width, b.top),
                Rect::new(0., height - b.bottom, width, b.bottom),
            ] {
                if r.width > 0. && r.height > 0. {
                    line = line.child(self.paint(&Paint::fill(r, color), top));
                }
            }
        }
        line = line.child(text);
        for paint in &style.overlays {
            line = line.child(self.paint(paint, top));
        }
        for (rect, command) in &style.hotspots {
            line = line.child(self.hotspot(*rect, command.clone()));
        }
        (line.into_any_element(), height)
    }
}
