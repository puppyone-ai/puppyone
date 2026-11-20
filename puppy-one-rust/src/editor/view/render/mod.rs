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
        decoration::{LayeredDecorations, Superscript},
        editor::EditorView,
        projection::LeafText,
        style::{Align, LineStyle, Paint, Rect, TextStyle},
        widget::{BlockId, WidgetStateStore, render_line_embed_safely},
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

/// Room a leaf keeps for a drawn inline image, and the image.
pub struct Room {
    pub range: Range<usize>,
    pub text: SharedString,
    pub image: crate::render_service::Rendered,
    /// Space kept on each side of the image.
    pub pad: f32,
    pub radius: f32,
}

pub struct RenderCx<'a> {
    pub revision: u64,
    pub doc: &'a Buffer,
    pub decorations: &'a LayeredDecorations,
    pub leaves: Vec<LeafEntry>,
    pub cache: &'a RefCell<ParagraphCache>,
    pub measures: &'a RefCell<MeasureCache>,
    pub widget_states: &'a RefCell<WidgetStateStore>,
    pub kit: &'a RenderContext,
    pub view: WeakEntity<EditorView>,
    /// Device pixels per CSS pixel.
    pub scale: f32,
    /// Leaf keys handed out this frame.
    pub keys: std::collections::HashSet<u64>,
    /// Rows of the last text leaf and where its last row ends.
    pub text_end: (usize, f32),
    /// The ready inline images of the line being laid out (an inline
    /// formula): the leaf keeps room for each, the line paints it there.
    pub rooms: Vec<Room>,
    /// Tab stop width of the current line box (`TAB_SIZE` by default).
    pub tab_size: usize,
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

    /// Shaping runs of `leaf` as Kit's plain inline path styles it.
    fn runs(leaf: &LeafText, style: &TextStyle) -> Vec<TextRun> {
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
        runs
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
                let runs = Self::runs(leaf, style);
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
                        end: line
                            .position_for_index(leaf.text.len(), px(1.))
                            .map_or(0., |p| f32::from(p.x)),
                    },
                    _ => {
                        let (a, d) = self.primary_metrics(style);
                        TextMetrics {
                            rows: 1,
                            ascent: a,
                            descent: d,
                            end: 0.,
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

    /// Rows and widest row of non-source text in `style` (a widget's own
    /// text: `max-content` columns, wrapped values).
    pub fn plain_extent(
        &mut self,
        text: &str,
        style: &TextStyle,
        wrap: Option<f32>,
    ) -> (usize, f32) {
        if text.is_empty() {
            return (1, 0.);
        }
        let font = Self::font(style);
        let run = TextRun {
            len: text.len(),
            font,
            color: black(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let shaped = self.window.text_system().shape_text(
            SharedString::from(text.to_owned()),
            px(style.size),
            &[run],
            wrap.map(px),
            None,
        );
        match shaped.ok().as_ref().and_then(|lines| lines.first()) {
            Some(line) => {
                let rows = line.wrap_boundaries.len() + 1;
                let width = if rows == 1 {
                    f32::from(line.unwrapped_layout.width)
                } else {
                    wrap.unwrap_or_default()
                };
                (rows, width)
            }
            None => (1, 0.),
        }
    }

    /// Content-and-style-derived leaf key (`TA-13`): independent of absolute
    /// `source.start` so typing earlier in the document preserves shaped Kit
    /// paragraphs on untouched lines below, while disambiguating duplicate
    /// visible lines within the same frame via `self.keys`.
    fn leaf_key(&mut self, content_hash: u64, style_hash: u64) -> u64 {
        let mut key = content_hash ^ style_hash.rotate_left(23);
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

    /// Rich inline content inside a widget, using the ordinary line's media
    /// and superscript layout without replacing the widget's own box.
    #[expect(
        clippy::too_many_arguments,
        reason = "same source geometry as text_aligned"
    )]
    pub fn inline_content_aligned(
        &mut self,
        source: Range<usize>,
        style: &TextStyle,
        width: f32,
        block_top: f32,
        x: f32,
        y: f32,
        align: TextAlign,
    ) -> (AnyElement, f32) {
        let previous_rooms = std::mem::take(&mut self.rooms);
        self.rooms = self.ready_images(&source, style, None, width);
        let (lift, drop) = self.shifted_growth(&source, style);
        let (image_lift, image_drop) = self.image_growth(style);
        let (lift, drop) = (lift.max(image_lift), drop.max(image_drop));
        let origin = (x, y + lift);
        let wrap = Some(width);
        let (text, height) = self.text_aligned(
            source.clone(),
            style,
            false,
            wrap,
            false,
            block_top,
            origin.0,
            origin.1,
            align,
        );
        let children = div()
            .child(text)
            .children(self.superscripts(&source, style, wrap, origin, block_top, align))
            .children(self.inline_images(style, wrap, origin, align));
        self.rooms = previous_rooms;
        (children.into_any_element(), height + lift + drop)
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
        let widgets = d.inline_widgets_in(&source);
        // A ready inline image shows as the room it is painted over; otherwise
        // every inline widget contributes its `display_text()` (`TA-12`).
        let replaced: Vec<(Range<usize>, SharedString)> = widgets
            .iter()
            .map(|w| {
                let text = self
                    .rooms
                    .iter()
                    .find(|r| r.range == w.range)
                    .map_or_else(|| w.display_text().clone(), |r| r.text.clone());
                (w.range.clone(), text)
            })
            .collect();
        let hidden = d.hidden_in(&source);
        let marks = d.marks_in(&source);
        let leaf = LeafText::build_buffer_with_tabs(
            self.doc,
            source.clone(),
            &hidden,
            &replaced,
            &marks,
            strike,
            self.tab_size,
        );
        let wrap = wrap.map(|w| self.snap(w));
        let (measure_key, metrics) = self.measure(&leaf, style, wrap);
        self.text_end = (metrics.rows, metrics.end);
        let key = self.leaf_key(leaf.content_hash(), measure_key);
        let (paragraph, text) = self.cache.borrow_mut().get(leaf, key);
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
        let leaf =
            LeafText::build_buffer_with_tabs(self.doc, source, &[], &[], &[], false, tab_size);
        let key = self.leaf_key(
            leaf.content_hash(),
            style.size.to_bits() as u64 ^ (tab_size as u64),
        );
        let styles = highlight(&leaf.text);
        let rows = leaf.text.split('\n').count();
        let (ascent, descent) = self.primary_metrics(style);
        let metrics = TextMetrics {
            rows,
            ascent,
            descent,
            end: 0.,
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
            end: 0.,
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
            Paint::Icon { rect, path, color } => svg()
                .path(path.clone())
                .absolute()
                .left(px(rect.x))
                .top(px(rect.y))
                .w(px(rect.width))
                .h(px(rect.height))
                .text_color(*color)
                .into_any_element(),
        }
    }

    /// The inline images fully inside `source` that are ready, each with
    /// the room the leaf keeps for it: its width and its padding on both
    /// sides, in spaces of the line's font.
    fn ready_images(
        &mut self,
        source: &Range<usize>,
        style: &TextStyle,
        background: Option<Rgba>,
        width: f32,
    ) -> Vec<Room> {
        let found: Vec<_> = self
            .decorations
            .inline_widgets_in(source)
            .iter()
            .filter(|w| w.range.start >= source.start && w.range.end <= source.end)
            .filter_map(|w| w.as_image().map(|(_, img)| img.clone()))
            .collect();
        let mut rooms = Vec::new();
        for image in found {
            if let Some(drawn) = (image.draw)(background, width, style.size, self.window, self.app)
            {
                let pad = image.pad * style.size;
                let text = self.room(drawn.width + 2. * pad, style);
                rooms.push(Room {
                    range: image.range,
                    text,
                    image: drawn,
                    pad,
                    radius: image.radius,
                });
            }
        }
        rooms
    }

    /// Spaces of `style`'s font as wide as `width` (to under the narrowest
    /// space's advance), widest first.
    fn room(&mut self, width: f32, style: &TextStyle) -> SharedString {
        const SPACES: [char; 7] = [
            '\u{2003}', '\u{2002}', '\u{2004}', '\u{2005}', '\u{2009}', '\u{2006}', '\u{200a}',
        ];
        let font = Self::font(style);
        let mut advances: Vec<(char, f32)> = SPACES
            .iter()
            .filter_map(|&c| {
                let text = SharedString::from(c.to_string());
                let run = TextRun {
                    len: text.len(),
                    font: font.clone(),
                    color: Hsla::default(),
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                };
                let line = self
                    .window
                    .text_system()
                    .shape_line(text, px(style.size), &[run], None);
                let width = f32::from(line.width);
                (width > 0.).then_some((c, width))
            })
            .collect();
        advances.sort_by(|a, b| b.1.total_cmp(&a.1));
        let mut room = String::new();
        let mut left = width;
        for &(c, advance) in &advances {
            while left >= advance - 0.01 {
                room.push(c);
                left -= advance;
            }
        }
        room.into()
    }

    /// How far the line's inline images reach above and below its row.
    fn image_growth(&mut self, style: &TextStyle) -> (f32, f32) {
        let line = baseline::chromium_baseline(self.scale, style, self.primary_metrics(style), 0.);
        let below = style.line_height_px() - line;
        self.rooms.iter().fold((0f32, 0f32), |(lift, drop), room| {
            (
                lift.max(room.image.baseline - line),
                drop.max(room.image.height - room.image.baseline - below),
            )
        })
    }

    /// The line's inline images, each over the room the leaf just built
    /// keeps for it, its baseline on the text's.
    fn inline_images(
        &mut self,
        style: &TextStyle,
        wrap: Option<f32>,
        (x, y): (f32, f32),
        align: TextAlign,
    ) -> Vec<AnyElement> {
        let Some(leaf) = self
            .leaves
            .last()
            .map(|l| l.text.clone())
            .filter(|_| !self.rooms.is_empty())
        else {
            return Vec::new();
        };
        let runs = Self::runs(&leaf, style);
        let shaped = self.window.text_system().shape_text(
            leaf.text.clone().into(),
            px(style.size),
            &runs,
            wrap.map(|w| px(self.snap(w))),
            None,
        );
        let Some(shaped) = shaped.ok().and_then(|lines| lines.into_iter().next()) else {
            return Vec::new();
        };
        let row = baseline::chromium_line_height(self.scale, style.line_height_px());
        let line_baseline =
            baseline::chromium_baseline(self.scale, style, self.primary_metrics(style), 0.);
        let mut out = Vec::new();
        for room in &self.rooms {
            let pad = room.pad;
            let index = leaf.to_display(room.range.start - leaf.source.start, false);
            let Some(at) = aligned_position(&shaped, index, row, wrap, align) else {
                continue;
            };
            let image = &room.image;
            out.push(
                div()
                    .debug_selector(|| "editor-inline-image".to_owned())
                    .absolute()
                    .left(px(x + f32::from(at.x) + pad))
                    .top(px(y + f32::from(at.y) + line_baseline - image.baseline))
                    .w(px(image.width))
                    .h(px(image.height))
                    .child(
                        img(ImageSource::Render(image.image.clone()))
                            .size_full()
                            .rounded(px(room.radius)),
                    )
                    .into_any_element(),
            );
        }
        out
    }

    /// The shifted texts (`<sup>`, `<sub>`) fully inside `source`.
    fn shifted_in(&self, source: &Range<usize>) -> Vec<Superscript> {
        self.decorations
            .inline_widgets_in(source)
            .iter()
            .filter(|w| w.range.start >= source.start && w.range.end <= source.end)
            .filter_map(|w| w.as_superscript().cloned())
            .collect()
    }

    /// The style a shifted text is painted in, on a line of `style`.
    fn shifted_style(sup: &Superscript, style: &TextStyle) -> TextStyle {
        TextStyle {
            // `font-size: smaller`: Blink's next smaller size, ÷ 1.2.
            size: sup.size.unwrap_or(style.size / 1.2),
            color: sup.color.unwrap_or(style.color),
            ..style.clone()
        }
    }

    /// How far its baseline moves up: Blink's `vertical-align: super` (a
    /// third of the parent's font size) or `sub` (a fifth, down), plus one
    /// layout pixel (a device pixel, as Blink lays out zoomed for the device
    /// scale).
    fn shift(&self, sup: &Superscript, style: &TextStyle) -> f32 {
        let one = 1. / self.scale;
        if sup.lower {
            -(style.size / 5. + one)
        } else {
            style.size / 3. + one
        }
    }

    /// How far the shifted texts in `source` reach above and below its row:
    /// the line box grows by that much (Blink's line box around a raised
    /// `<sup>` or a lowered `<sub>`).
    fn shifted_growth(&mut self, source: &Range<usize>, style: &TextStyle) -> (f32, f32) {
        let scale = self.scale;
        let line = baseline::chromium_baseline(scale, style, self.primary_metrics(style), 0.);
        let below = style.line_height_px() - line;
        let (mut lift, mut drop): (f32, f32) = (0., 0.);
        for sup in self.shifted_in(source) {
            let text = Self::shifted_style(&sup, style);
            let above = baseline::chromium_baseline(scale, &text, self.primary_metrics(&text), 0.);
            let shift = self.shift(&sup, style);
            lift = lift.max(above + shift - line);
            drop = drop.max(text.line_height_px() - above - shift - below);
        }
        (lift, drop)
    }

    /// The shifted texts in the leaf just built for `source` (first row at
    /// `x`, `y` in its line box): each painted over the room the leaf keeps
    /// for it.
    fn superscripts(
        &mut self,
        source: &Range<usize>,
        style: &TextStyle,
        wrap: Option<f32>,
        (x, y): (f32, f32),
        block_top: f32,
        align: TextAlign,
    ) -> Vec<AnyElement> {
        let found = self.shifted_in(source);
        let Some(leaf) = self
            .leaves
            .last()
            .map(|l| l.text.clone())
            .filter(|_| !found.is_empty())
        else {
            return Vec::new();
        };
        let runs = Self::runs(&leaf, style);
        let shaped = self.window.text_system().shape_text(
            leaf.text.clone().into(),
            px(style.size),
            &runs,
            wrap.map(|w| px(self.snap(w))),
            None,
        );
        let Some(shaped) = shaped.ok().and_then(|lines| lines.into_iter().next()) else {
            return Vec::new();
        };
        let row = baseline::chromium_line_height(self.scale, style.line_height_px());
        let scale = self.scale;
        let line_baseline =
            baseline::chromium_baseline(scale, style, self.primary_metrics(style), 0.);
        let mut out = Vec::new();
        for sup in found {
            let index = leaf.to_display(sup.range.start - leaf.source.start, false);
            let Some(at) = aligned_position(&shaped, index, row, wrap, align) else {
                continue;
            };
            let text = Self::shifted_style(&sup, style);
            let top = y + f32::from(at.y) + line_baseline
                - baseline::chromium_baseline(scale, &text, self.primary_metrics(&text), 0.)
                - self.shift(&sup, style);
            let width = (sup.text.chars().count() as f32 + 1.) * text.size;
            let rect = Rect::new(x + f32::from(at.x), top, width, text.line_height_px());
            out.push(self.label(rect, &sup.text, &text, Align::Start, block_top));
        }
        out
    }

    /// An interactive area that runs `command` through the format.
    pub fn hotspot(&mut self, rect: Rect, command: Command) -> AnyElement {
        let view = self.view.clone();
        let id = self.leaves.len();
        div()
            .id(("editor-hotspot", id))
            .debug_selector(|| command.feature().to_owned())
            .absolute()
            .left(px(rect.x))
            .top(px(rect.y))
            .w(px(rect.width))
            .h(px(rect.height))
            .cursor(CursorStyle::Arrow)
            .on_mouse_down(MouseButton::Left, |_, _, cx| {
                cx.stop_propagation();
            })
            .on_click(move |_, window, cx| {
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
    #[allow(clippy::too_many_arguments)]
    pub fn line(
        &mut self,
        source: Range<usize>,
        style: &LineStyle,
        line_break: bool,
        top: f32,
        left: f32,
        width: f32,
        state: super::widget::WidgetState,
    ) -> (AnyElement, f32) {
        let (p, b) = (style.padding, style.border);
        let x = b.left + p.left;
        let column = (width - x - p.right - b.right).max(0.);
        self.rooms = self.ready_images(&source, &style.text, style.background, column);
        let (lift, drop) = self.shifted_growth(&source, &style.text);
        let (image_lift, image_drop) = self.image_growth(&style.text);
        let (lift, drop) = (lift.max(image_lift), drop.max(image_drop));
        let y = b.top + p.top + lift;
        let embed = style.embed.as_ref().and_then(|embed| {
            let inner = (width - x - p.right - b.right).max(0.);
            let (element, height) = render_line_embed_safely(
                embed.content.as_ref(),
                &mut super::widget::WidgetCx {
                    block_id: BlockId::for_line_embed(source.start, self.revision),
                    source: source.clone(),
                    top: top + y,
                    left: 0.,
                    width: inner,
                    state,
                    render: self,
                },
            )?;
            let placed = div()
                .absolute()
                .left(px(x))
                .top(px(y))
                .w(px(inner))
                .h(px(height))
                .child(element);
            Some((placed, height))
        });
        let wrap = (!style.nowrap).then(|| (width - x - p.right - b.right).max(0.));
        let prev_tab = std::mem::replace(
            &mut self.tab_size,
            style.tab_size.unwrap_or(super::projection::TAB_SIZE),
        );
        let (text, text_height) = self.text(
            source.clone(),
            &style.text,
            style.strike,
            wrap,
            line_break,
            top,
            x,
            y,
        );
        self.tab_size = prev_tab;
        let content_height = embed.as_ref().map_or(text_height, |(_, h)| *h);
        let height = y + content_height + drop + p.bottom + b.bottom;
        let mut line = self.block_box(top, left, width, height);
        if let Some(bg) = style.background {
            let [tl, tr, br, bl] = style.background_radii;
            line = line
                .bg(bg)
                .rounded_tl(px(tl))
                .rounded_tr(px(tr))
                .rounded_br(px(br))
                .rounded_bl(px(bl));
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
        if let Some((placed, _)) = embed {
            line = line.child(placed);
        }
        for sup in self.superscripts(&source, &style.text, wrap, (x, y), top, TextAlign::Left) {
            line = line.child(sup);
        }
        for image in self.inline_images(&style.text, wrap, (x, y), TextAlign::Left) {
            line = line.child(image);
        }
        self.rooms.clear();
        for paint in &style.overlays {
            line = line.child(self.paint(paint, top));
        }
        for (rect, command) in &style.hotspots {
            line = line.child(self.hotspot(*rect, command.clone()));
        }
        if let Some(t) = &style.trailing {
            let (rows, end) = self.text_end;
            let row = baseline::chromium_line_height(self.scale, style.text.line_height_px());
            let rect = Rect::new(
                (x + end + t.gap).min(width - p.right - b.right - t.size),
                y + rows.saturating_sub(1) as f32 * row + (row - t.size) / 2.,
                t.size,
                t.size,
            );
            line = line
                .child(
                    svg()
                        .path(t.icon.clone())
                        .absolute()
                        .left(px(rect.x))
                        .top(px(rect.y))
                        .w(px(rect.width))
                        .h(px(rect.height))
                        .text_color(t.color)
                        .with_transformation(Transformation::rotate(radians(
                            t.rotation.to_radians(),
                        ))),
                )
                .child(self.hotspot(rect, t.command.clone()));
        }
        (line.into_any_element(), height)
    }
}

/// Offset overlays by the same per-wrapped-row alignment used to paint text.
fn aligned_position(
    shaped: &WrappedLine,
    index: usize,
    row_height: f32,
    wrap: Option<f32>,
    align: TextAlign,
) -> Option<Point<Pixels>> {
    let mut position = shaped.position_for_index(index, px(row_height))?;
    if align == TextAlign::Left {
        return Some(position);
    }
    let row = (f32::from(position.y) / row_height).round() as usize;
    let boundary_x = |i: usize| {
        shaped.wrap_boundaries.get(i).map(|b| {
            shaped.unwrapped_layout.runs[b.run_ix].glyphs[b.glyph_ix]
                .position
                .x
        })
    };
    let start = row.checked_sub(1).and_then(boundary_x).unwrap_or(px(0.));
    let end = boundary_x(row).unwrap_or(shaped.unwrapped_layout.width);
    let width = wrap.map(px).unwrap_or(shaped.unwrapped_layout.width);
    let extra = width - (end - start);
    position.x += match align {
        TextAlign::Center => extra / 2.,
        TextAlign::Right => extra,
        TextAlign::Left => px(0.),
    };
    Some(position)
}
