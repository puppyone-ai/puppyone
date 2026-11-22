//! Live-preview decorations (product core/decorations/blockDecorations.ts and
//! inlineDecorations.ts):
//! - **Document Layer** (`decorate`, `decorate_with_registry`, `decorate_incremental`, `TA-11`, `TA-32`):
//!   depends only on `(revision, dark, live, features, feature_state)` — never
//!   cursor/selection/focus. Supports `O(|touched|)` splicing across
//!   [`SyntaxSplice`] with `LazyBlockWidget` for off-screen shifted widgets
//!   and [`BlockSplice`] for incremental `HeightMap` updates (`TA-13`).
//! - **Reveal Layer** (`decorate_reveal`, `TA-11`): computes overrides only for
//!   the 0–3 line spans intersecting active reveal/composing/callout-title
//!   ranges.
//! - **Unified `InlineWidget`** (`TA-12`) & **`BlockId` / `eq_widget` reuse** (`TA-14`).
mod builder;
mod inline;
mod lines;
mod marks;

pub use builder::{BlockDecoration, InlineDecoration, LineDecoration};

use super::{
    classes::Class,
    feature::{self, Features, WidgetFactoryCx},
    plans::{self, Plan, Presentation},
    presentation::{LineRhythm, block_rhythm_in_lines},
    state::{FeatureStateStore, PreviewState},
    syntax::{Kind, Syntax, SyntaxSplice},
};
use crate::editor::{
    markdown::style::{MarkdownTheme, cascade::LineInput},
    navigation::ReferenceContext,
    registry::DocumentAssets,
    text::{Anchor, buffer::Buffer},
    view::{
        decoration::{
            Block, BlockSplice, Decorations, InlineImage, InlineWidget, InlineWidgetKind, Mark,
            RevealLayer, RevealPatch, Superscript, Surface, Underline,
        },
        widget::{BlockId, BlockIdRegistry, BlockWidget, WidgetCx},
    },
};
use builder::Builder;
use gpui::{AnyElement, SharedString};
use std::{
    any::Any,
    cell::RefCell,
    collections::{HashMap, HashSet},
    ops::Range,
    rc::Rc,
};

pub struct DecorateCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
    pub plans: &'a [Plan],
    pub rhythm: &'a [LineRhythm],
    pub theme: &'a MarkdownTheme,
    pub preview: &'a PreviewState,
    pub live: bool,
    pub features: Features,
    /// Where the document's media resolve and load from.
    pub assets: Option<&'a DocumentAssets>,
    /// The workspace's link graph (Obsidian embeds resolve by name).
    pub references: Option<&'a ReferenceContext>,
}

/// Shared snapshot for lazily materialising shifted off-screen block widgets
/// only if/when they enter the viewport (`TA-32`). Stored in a reusable slot
/// so `Syntax` has `Rc::strong_count == 1` across incremental edits and
/// already-lazy off-screen widgets avoid per-keystroke `Rc::new` allocations!
pub struct LazyWidgetEnv {
    revision: u64,
    doc: Buffer,
    link_defs_text: String,
    theme: MarkdownTheme,
    features: Features,
    feature_state: FeatureStateStore,
    assets: Option<DocumentAssets>,
    references: Option<ReferenceContext>,
}

pub type LazyEnvSlot = Rc<RefCell<Option<Rc<LazyWidgetEnv>>>>;

type ResolvedLazyWidget = Option<(u64, Range<usize>, Rc<dyn BlockWidget>)>;

struct LazyBlockWidget {
    env_slot: LazyEnvSlot,
    fallback: Rc<dyn BlockWidget>,
    resolved: RefCell<ResolvedLazyWidget>,
}

impl LazyBlockWidget {
    fn base_widget(&self) -> Rc<dyn BlockWidget> {
        if let Some((_, _, w)) = self.resolved.borrow().as_ref() {
            return Rc::clone(w);
        }
        Rc::clone(&self.fallback)
    }

    fn resolve(&self, source: &Range<usize>) -> Rc<dyn BlockWidget> {
        let Some(env) = self.env_slot.borrow().clone() else {
            return Rc::clone(&self.fallback);
        };
        if let Some((cached_rev, cached_src, w)) = self.resolved.borrow().as_ref()
            && *cached_rev == env.revision
            && cached_src == source
        {
            return Rc::clone(w);
        }
        let start_line = env.doc.line_index(source.start);
        let end_line = (env
            .doc
            .line_index(source.end.saturating_sub(1).max(source.start))
            + 1)
        .min(env.doc.line_count());
        let local_syntax = Syntax::parse_window(
            &env.doc,
            start_line..end_line,
            &env.link_defs_text,
            env.features,
        );
        let refreshed = plans::compile_blocks_in_window(
            &env.doc,
            &local_syntax,
            &env.feature_state,
            env.features,
            source.clone(),
            start_line..end_line,
        );
        let best = refreshed
            .iter()
            .filter(|p| {
                (p.source.start == source.start && p.embed().is_some())
                    || (p.element.is_none() && p.is_visible_source())
            })
            .fold(None::<&Plan>, |best, p| match best {
                Some(best) if best.source.end >= p.source.end => Some(best),
                _ => Some(p),
            })
            .and_then(|p| p.embed());

        let factory = WidgetFactoryCx {
            doc: &env.doc,
            syntax: &local_syntax,
            theme: &env.theme,
            assets: env.assets.as_ref(),
            references: env.references.as_ref(),
            state: &env.feature_state,
        };
        let built = best
            .and_then(|embed| Some((feature::find(env.features, embed.feature)?, embed)))
            .and_then(|(f, embed)| {
                feature::catch_feature_panic(f.id(), "block_widget", || {
                    f.block_widget(embed, &factory)
                })
                .flatten()
            })
            .unwrap_or_else(|| Rc::clone(&self.fallback));
        *self.resolved.borrow_mut() = Some((env.revision, source.clone(), Rc::clone(&built)));
        built
    }
}

impl BlockWidget for LazyBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let widget = self.resolve(&cx.source);
        widget.render(cx)
    }

    fn estimate_height(&self, lines: Range<usize>, width: f32) -> f32 {
        self.fallback.estimate_height(lines, width)
    }

    fn as_widget_any(&self) -> Option<&dyn Any> {
        Some(self)
    }
}

fn unwrap_lazy(widget: &Rc<dyn BlockWidget>) -> Rc<dyn BlockWidget> {
    if let Some(lazy) = widget
        .as_widget_any()
        .and_then(|a| a.downcast_ref::<LazyBlockWidget>())
    {
        lazy.base_widget()
    } else {
        Rc::clone(widget)
    }
}

/// The surface of `.markdown-codemirror-editor` / `.cm-content`.
pub fn surface(theme: &MarkdownTheme) -> Surface {
    let s = &theme.surface;
    Surface {
        content: s.insets(),
        max_text_width: Some(s.text_width),
        background: s.background,
        selection: s.selection,
        selection_inactive: s.selection_inactive,
        caret: s.caret,
        caret_width: 1.,
        link: theme.inline.link_color,
        inline_code: theme.inline.code_color,
        inline_code_background: Some(theme.inline.code_background),
        inline_code_padding: Some(theme.inline.code_padding.left),
        // `.cm-md-syntax-link` has no text decoration.
        link_plain: true,
    }
}

fn merge(mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.sort_by_key(|r| (r.start, r.end));
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for r in ranges {
        match merged.last_mut() {
            Some(last) if r.start <= last.end => last.end = last.end.max(r.end),
            _ => merged.push(r),
        }
    }
    merged
}

fn hidden_overlaps(hidden: &[Range<usize>], range: &Range<usize>) -> bool {
    let idx = hidden.partition_point(|h| h.end <= range.start);
    hidden
        .get(idx)
        .is_some_and(|h| h.start < range.end && range.start < h.end)
}

fn hidden_contains(hidden: &[Range<usize>], range: &Range<usize>) -> bool {
    let idx = hidden.partition_point(|h| h.end < range.start);
    hidden[idx..]
        .iter()
        .take_while(|h| h.start <= range.start)
        .any(|h| h.start <= range.start && range.end <= h.end)
}

fn fold_legacy_inline_widgets(
    replaced: Vec<(Range<usize>, SharedString)>,
    superscripts: Vec<Superscript>,
    inline_images: Vec<InlineImage>,
    mut out: Vec<InlineWidget>,
) -> Vec<InlineWidget> {
    if replaced.is_empty() && superscripts.is_empty() && inline_images.is_empty() {
        return out;
    }
    let mut used_sup = vec![false; superscripts.len()];
    for (range, text) in replaced {
        if let Some(img) = inline_images.iter().find(|i| i.range == range) {
            out.push(InlineWidget {
                range,
                kind: InlineWidgetKind::Image {
                    fallback: text,
                    image: img.clone(),
                },
            });
        } else if let Some((idx, sup)) = superscripts
            .iter()
            .enumerate()
            .find(|(i, s)| !used_sup[*i] && s.range == range)
        {
            used_sup[idx] = true;
            out.push(InlineWidget {
                range,
                kind: InlineWidgetKind::Superscript {
                    room_text: text,
                    sup: sup.clone(),
                },
            });
        } else {
            out.push(InlineWidget::text(range, text));
        }
    }
    for (idx, sup) in superscripts.into_iter().enumerate() {
        if !used_sup[idx] {
            let room_text = sup.text.clone();
            out.push(InlineWidget {
                range: sup.range.clone(),
                kind: InlineWidgetKind::Superscript { room_text, sup },
            });
        }
    }
    out
}

struct WindowArtifacts {
    blocks: Vec<Block>,
    marks: Vec<Mark>,
    hidden: Vec<Range<usize>>,
    atomic: Vec<Range<usize>>,
    inline_widgets: Vec<InlineWidget>,
    underlines: Vec<Underline>,
}

fn decorate_window(
    cx: &DecorateCx,
    line_window: Range<usize>,
    rhythm_base_line: usize,
    mut registry: Option<&mut BlockIdRegistry>,
    revision: u64,
    prev_widgets: Option<&HashMap<BlockId, Rc<dyn BlockWidget>>>,
    indexed_source_fallbacks: Option<&[(bool, Range<usize>)]>,
) -> WindowArtifacts {
    let doc = cx.doc;
    let total = doc.line_count();
    let start_line = line_window.start.min(total);
    let end_line = line_window.end.min(total).max(start_line);
    let mut b = Builder::new_in(cx, start_line..end_line, rhythm_base_line);

    if !cx.live {
        for line in start_line..end_line {
            b.line_box(
                line,
                LineInput {
                    classes: Class::NONE,
                    level: 0,
                    list: None,
                    live: false,
                },
                false,
            );
        }
        let marks = b.marks();
        return WindowArtifacts {
            blocks: b.blocks,
            marks,
            hidden: Vec::new(),
            atomic: Vec::new(),
            inline_widgets: Vec::new(),
            underlines: Vec::new(),
        };
    }

    let factory = WidgetFactoryCx {
        doc,
        syntax: cx.syntax,
        theme: cx.theme,
        assets: cx.assets,
        references: cx.references,
        state: &cx.preview.features,
    };

    // A diagnosed source fallback owns its authored text even if the base
    // parser also produced nested Markdown elements. Keep these ranges across
    // viewport/reveal windows, including windows starting inside the block.
    let owned_source_fallbacks;
    let source_fallbacks: &[(bool, Range<usize>)] = match indexed_source_fallbacks {
        Some(indexed) => indexed,
        None => {
            owned_source_fallbacks = cx
                .plans
                .iter()
                .filter(|p| matches!(p.presentation, Presentation::SourceFallback { .. }))
                .map(|p| (p.element.is_none(), p.source.clone()))
                .collect::<Vec<_>>();
            &owned_source_fallbacks
        }
    };
    let mut line = start_line;
    while line < end_line {
        let local = line - start_line;
        let range = doc.line_range(line);
        if source_fallbacks.iter().any(|(is_block, source)| {
            *is_block && source.start <= range.start && range.start < source.end
        }) {
            b.source_line(line);
            line += 1;
            continue;
        }
        if cx.preview.composing == Some(range.start) || cx.preview.revealed_line(&range) {
            b.source_line(line);
            line += 1;
            continue;
        }
        let block = b.by_line[local]
            .iter()
            .filter(|p| {
                (p.source.start == range.start && p.embed().is_some())
                    || (p.element.is_none() && p.is_visible_source())
            })
            .fold(None::<&&Plan>, |best, p| match best {
                Some(best) if best.source.end >= p.source.end => Some(best),
                _ => Some(p),
            })
            .and_then(|p| Some((p.source.clone(), p.embed()?.clone())))
            .map(|(source, embed)| {
                if embed.built_for(doc, source.start) {
                    return (source, embed);
                }
                let last_l = doc
                    .line_index(source.end.saturating_sub(1).max(source.start))
                    .min(end_line.saturating_sub(1))
                    .max(line);
                let refreshed = plans::compile_blocks_in_window(
                    doc,
                    cx.syntax,
                    &cx.preview.features,
                    cx.features,
                    source.clone(),
                    line..last_l + 1,
                );
                let fresh = refreshed
                    .into_iter()
                    .find(|p| {
                        p.source == source && p.embed().is_some_and(|e| e.feature == embed.feature)
                    })
                    .and_then(|p| p.embed().cloned())
                    .unwrap_or(embed);
                (source, fresh)
            });
        let widget = block
            .as_ref()
            .and_then(|(_, embed)| Some((feature::find(cx.features, embed.feature)?, embed)));
        if let Some((f, embed)) = widget
            && let Some(built_view) = feature::catch_feature_panic(f.id(), "block_widget", || {
                f.block_widget(embed, &factory)
            })
            .flatten()
        {
            let source = block.as_ref().map(|(s, _)| s.clone()).unwrap_or_default();
            let last = doc
                .line_index(source.end.saturating_sub(1).max(source.start))
                .min(end_line.saturating_sub(1))
                .max(line);
            let id = match registry.as_deref_mut() {
                Some(reg) => reg.resolve_or_insert(source.start, f.id(), revision),
                None => BlockId::new(
                    (source.start as u64) + 1,
                    Anchor::after(source.start, revision),
                ),
            };
            let view = if let Some(prev) = prev_widgets.and_then(|m| m.get(&id)) {
                let prev_base = unwrap_lazy(prev);
                if prev_base.eq_widget(built_view.as_ref()) {
                    prev_base
                } else {
                    built_view
                }
            } else {
                built_view
            };
            b.blocks.push(Block::Widget {
                id,
                lines: line..last + 1,
                widget: view,
            });
            let (h_len, a_len, r_len, s_len, i_len, iw_len, u_len, c_len, sp_len) = (
                b.hidden.len(),
                b.atomic.len(),
                b.replaced.len(),
                b.superscripts.len(),
                b.inline_images.len(),
                b.inline_widgets.len(),
                b.underlines.len(),
                b.colors.len(),
                b.spans.len(),
            );
            let ok = feature::catch_feature_panic(f.id(), "decorate_block", || {
                f.decorate_block(
                    embed,
                    &mut BlockDecoration {
                        builder: &mut b,
                        source,
                        lines: line..last + 1,
                    },
                );
            })
            .is_some();
            if !ok {
                b.hidden.truncate(h_len);
                b.atomic.truncate(a_len);
                b.replaced.truncate(r_len);
                b.superscripts.truncate(s_len);
                b.inline_images.truncate(i_len);
                b.inline_widgets.truncate(iw_len);
                b.underlines.truncate(u_len);
                b.colors.truncate(c_len);
                b.spans.truncate(sp_len);
            }
            line = last + 1;
            continue;
        }
        let plans = b.by_line[local].clone();
        b.line(line, &plans);
        line += 1;
    }

    // Inline fallback can share a line with valid Markdown. Suppress only
    // projections touching its range, preserving neighboring decorations.
    // Drop media callbacks before the view can execute resource loads.
    if !source_fallbacks.is_empty() {
        let literal = |range: &Range<usize>| {
            source_fallbacks
                .iter()
                .any(|(_, source)| source.start < range.end && range.start < source.end)
        };
        b.hidden.retain(|r| !literal(r));
        b.atomic.retain(|r| !literal(r));
        b.replaced.retain(|(r, _)| !literal(r));
        b.superscripts.retain(|s| !literal(&s.range));
        b.inline_images.retain(|i| !literal(&i.range));
        b.inline_widgets.retain(|w| !literal(&w.range));
        b.underlines.retain(|u| !literal(&u.range));
        b.colors.retain(|(r, _, _)| !literal(r));
        b.spans.retain(|s| !literal(&s.range));
        // Restore only the semantic dimming of a whole literal comment after
        // removing nested projections. Whitespace belongs to the block range,
        // while the comment's exact span excludes indentation and line endings.
        for (_, source) in source_fallbacks {
            if let Some(comment) = cx.syntax.elements_in(source.clone()).find(|e| {
                e.kind == Kind::Comment
                    && source.start <= e.range.start
                    && e.range.end <= source.end
                    && doc.slice_cow(source.start..e.range.start).trim().is_empty()
                    && doc.slice_cow(e.range.end..source.end).trim().is_empty()
            }) {
                b.spans.push(builder::ClassSpan {
                    range: comment.range.clone(),
                    classes: Class::COMMENT,
                    href: None,
                });
            }
        }
    }
    let marks = b.marks();
    let hidden = merge(std::mem::take(&mut b.hidden));
    let mut inline_widgets = fold_legacy_inline_widgets(
        std::mem::take(&mut b.replaced),
        std::mem::take(&mut b.superscripts),
        std::mem::take(&mut b.inline_images),
        std::mem::take(&mut b.inline_widgets),
    );
    inline_widgets.retain(|w| !w.range.is_empty() && !hidden_overlaps(&hidden, &w.range));
    inline_widgets.sort_by_key(|w| (w.range.start, w.range.end));
    let mut deduped_widgets: Vec<InlineWidget> = Vec::with_capacity(inline_widgets.len());
    for w in inline_widgets {
        if let Some(prev) = deduped_widgets.last()
            && prev.replaces_text()
            && w.replaces_text()
            && w.range.start < prev.range.end
        {
            continue;
        }
        deduped_widgets.push(w);
    }

    let mut atomic = hidden.clone();
    atomic.extend(b.atomic.into_iter().filter(|r| !r.is_empty()));
    atomic.extend(
        deduped_widgets
            .iter()
            .filter(|w| w.replaces_text())
            .map(|w| w.range.clone()),
    );
    atomic.sort_by_key(|r| (r.start, r.end));

    let mut underlines = std::mem::take(&mut b.underlines);
    underlines.retain(|u| !u.range.is_empty() && !hidden_contains(&hidden, &u.range));
    underlines.sort_by_key(|u| u.range.start);

    WindowArtifacts {
        blocks: b.blocks,
        marks,
        hidden,
        atomic,
        inline_widgets: deduped_widgets,
        underlines,
    }
}

pub fn decorate(cx: &DecorateCx) -> Decorations {
    let win = decorate_window(cx, 0..cx.doc.line_count(), 0, None, 0, None, None);
    Decorations {
        id: crate::editor::view::decoration::next_decorations_id(),
        blocks: win.blocks,
        marks: win.marks,
        hidden: win.hidden,
        atomic: win.atomic,
        inline_widgets: win.inline_widgets,
        underlines: win.underlines,
        surface: surface(cx.theme),
        splice: None,
        ..Default::default()
    }
}

pub fn decorate_with_registry(
    cx: &DecorateCx,
    registry: &mut BlockIdRegistry,
    revision: u64,
    prev_widgets: &HashMap<BlockId, Rc<dyn BlockWidget>>,
) -> Decorations {
    let win = decorate_window(
        cx,
        0..cx.doc.line_count(),
        0,
        Some(registry),
        revision,
        Some(prev_widgets),
        None,
    );
    let live_ids: HashSet<BlockId> = win
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Widget { id, .. } => Some(*id),
            Block::Line { .. } => None,
        })
        .collect();
    registry.retain_live(&live_ids);
    Decorations {
        id: crate::editor::view::decoration::next_decorations_id(),
        blocks: win.blocks,
        marks: win.marks,
        hidden: win.hidden,
        atomic: win.atomic,
        inline_widgets: win.inline_widgets,
        underlines: win.underlines,
        surface: surface(cx.theme),
        splice: None,
        ..Default::default()
    }
}

fn shift_range(r: &Range<usize>, delta: isize) -> Range<usize> {
    let s = ((r.start as isize) + delta) as usize;
    let e = ((r.end as isize) + delta) as usize;
    s..e
}

fn shift_inline_widget_in_place(w: &mut InlineWidget, delta: isize) {
    w.range = shift_range(&w.range, delta);
    match &mut w.kind {
        InlineWidgetKind::Text(_) => {}
        InlineWidgetKind::Superscript { sup, .. } => sup.range = w.range.clone(),
        InlineWidgetKind::Image { image, .. } => image.range = w.range.clone(),
    }
}

#[inline]
fn logical_partition(
    len: usize,
    split: usize,
    delta: isize,
    key: impl Fn(usize) -> usize,
    bound: usize,
) -> usize {
    let b = bound as i128;
    let mut lo = 0usize;
    let mut hi = len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        let v = key(mid) as i128 + if mid < split { 0 } else { delta as i128 };
        if v < b {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Incrementally splice Document-Layer decorations across `splice` (`TA-11`,
/// `TA-13`, `TA-32`). Clones `prev` when shared; prefer
/// [`decorate_incremental_in_place`] when the caller owns `prev`.
#[allow(clippy::too_many_arguments)]
pub fn decorate_incremental(
    prev: &Rc<Decorations>,
    splice: &SyntaxSplice,
    cx: &DecorateCx,
    registry: &mut BlockIdRegistry,
    revision: u64,
    prev_widgets: &HashMap<BlockId, Rc<dyn BlockWidget>>,
    lazy_env_slot: &LazyEnvSlot,
) -> Decorations {
    let base_id = prev.id;
    let mut built = decorate_incremental_in_place(
        (**prev).clone(),
        splice,
        cx,
        registry,
        revision,
        prev_widgets,
        lazy_env_slot,
        None,
    );
    if let Some(sp) = &mut built.splice {
        sp.base_ptr = base_id as usize;
    }
    built
}

/// In-place `O(log N + |window|)` incremental Document-Layer decoration splice
/// (`TA-11`, `TA-13`, `TA-32`, `TA-81`). Moves `prev` vectors in place and
/// defers downstream byte shifts via `Decorations::deferred`.
#[allow(clippy::too_many_arguments)]
pub fn decorate_incremental_in_place(
    mut prev: Decorations,
    splice: &SyntaxSplice,
    cx: &DecorateCx,
    registry: &mut BlockIdRegistry,
    revision: u64,
    prev_widgets: &HashMap<BlockId, Rc<dyn BlockWidget>>,
    lazy_env_slot: &LazyEnvSlot,
    source_fallbacks: Option<&[(bool, Range<usize>)]>,
) -> Decorations {
    let base_id = prev.id;
    let new_total = cx.doc.line_count();
    let line_delta: isize = (splice.new_lines.end as isize - splice.new_lines.start as isize)
        - (splice.old_lines.end as isize - splice.old_lines.start as isize);
    let old_total = ((new_total as isize) - line_delta).max(0) as usize;

    if prev.blocks.is_empty() || old_total == 0 || new_total == 0 {
        let rhythm = super::presentation::block_rhythm(cx.doc, cx.syntax, None);
        let full_cx = DecorateCx {
            rhythm: &rhythm,
            ..*cx
        };
        return decorate_with_registry(&full_cx, registry, revision, prev_widgets);
    }

    let raw_old_start = splice.old_lines.start.saturating_sub(1).min(old_total);
    let raw_old_end = (splice.old_lines.end + 1).min(old_total).max(raw_old_start);

    let b_start = prev
        .blocks
        .partition_point(|b| b.lines().end <= raw_old_start);
    let b_end = prev
        .blocks
        .partition_point(|b| b.lines().start < raw_old_end)
        .max(b_start);

    let aligned_old_start = if b_start < b_end {
        prev.blocks[b_start].lines().start.min(raw_old_start)
    } else {
        raw_old_start
    };
    let aligned_old_end = if b_start < b_end {
        prev.blocks[b_end - 1].lines().end.max(raw_old_end)
    } else {
        raw_old_end
    };

    let aligned_new_start = aligned_old_start.min(new_total);
    let aligned_new_end = ((aligned_old_end as isize) + line_delta)
        .clamp(aligned_new_start as isize, new_total as isize) as usize;

    let window_rhythm =
        block_rhythm_in_lines(cx.doc, cx.syntax, aligned_new_start..aligned_new_end, None);
    let win_cx = DecorateCx {
        rhythm: &window_rhythm,
        ..*cx
    };
    let mut win = decorate_window(
        &win_cx,
        aligned_new_start..aligned_new_end,
        aligned_new_start,
        Some(registry),
        revision,
        Some(prev_widgets),
        source_fallbacks,
    );

    let byte_delta: isize = (splice.new_bytes.end as isize - splice.new_bytes.start as isize)
        - (splice.old_bytes.end as isize - splice.old_bytes.start as isize);

    let needs_lazy_wrap = byte_delta != 0 || line_delta != 0;
    if needs_lazy_wrap {
        let link_defs_text = if cx.syntax.link_defs.is_empty() {
            String::new()
        } else {
            cx.syntax
                .link_defs
                .iter()
                .map(|(_, raw)| raw.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        };
        *lazy_env_slot.borrow_mut() = Some(Rc::new(LazyWidgetEnv {
            revision,
            doc: cx.doc.clone(),
            link_defs_text,
            theme: cx.theme.clone(),
            features: cx.features,
            feature_state: cx.preview.features.clone(),
            assets: cx.assets.cloned(),
            references: cx.references.cloned(),
        }));
    }

    // Evict ONLY widget IDs removed from the replaced `prev.blocks[b_start..b_end]`
    // window (`O(|window|)` instead of scanning all document blocks!).
    let mut dead_ids: Vec<BlockId> = Vec::new();
    for old_b in &prev.blocks[b_start..b_end] {
        if let Block::Widget { id: old_id, .. } = old_b {
            let kept = win
                .blocks
                .iter()
                .any(|nb| matches!(nb, Block::Widget { id, .. } if id == old_id));
            if !kept {
                dead_ids.push(*old_id);
            }
        }
    }
    registry.remove_ids(&dead_ids);

    let win_blocks_len = win.blocks.len();
    let new_blocks_range = b_start..b_start + win_blocks_len;
    let block_count_delta = win_blocks_len as isize - (b_end - b_start) as isize;

    if line_delta != 0 {
        prev.materialize_block_anchors();
        let old_lazy = if prev.lazy_wrapped_from == usize::MAX {
            usize::MAX
        } else if prev.lazy_wrapped_from <= b_end {
            b_start + win_blocks_len
        } else {
            ((prev.lazy_wrapped_from as isize) + block_count_delta) as usize
        };
        prev.blocks.splice(b_start..b_end, win.blocks);
        let suffix_start = b_start + win_blocks_len;
        for (offset, block) in prev.blocks[suffix_start..].iter_mut().enumerate() {
            let idx = suffix_start + offset;
            match block {
                Block::Line { line, .. } => {
                    *line = ((*line as isize) + line_delta) as usize;
                }
                Block::Widget { id, lines, widget } => {
                    lines.start = ((lines.start as isize) + line_delta) as usize;
                    lines.end = ((lines.end as isize) + line_delta) as usize;
                    id.shift(byte_delta, revision);
                    if idx < old_lazy
                        && widget
                            .as_widget_any()
                            .and_then(|a| a.downcast_ref::<LazyBlockWidget>())
                            .is_none()
                    {
                        *widget = Rc::new(LazyBlockWidget {
                            env_slot: Rc::clone(lazy_env_slot),
                            fallback: Rc::clone(widget),
                            resolved: RefCell::new(None),
                        });
                    }
                }
            }
        }
        prev.lazy_wrapped_from = suffix_start.min(old_lazy);
    } else {
        if prev.deferred.blocks_delta != 0 {
            let b_split = prev.deferred.blocks_split.min(prev.blocks.len());
            if b_end < b_split {
                prev.materialize_block_anchors();
            } else if b_split < b_start {
                let bd = prev.deferred.blocks_delta;
                let rev = prev.deferred.blocks_revision;
                for block in &mut prev.blocks[b_split..b_start] {
                    if let Block::Widget { id, .. } = block {
                        id.shift(bd, rev);
                    }
                }
                prev.deferred.blocks_split = b_start;
            }
        }
        let old_lazy = if prev.lazy_wrapped_from == usize::MAX {
            usize::MAX
        } else if prev.lazy_wrapped_from <= b_end {
            b_start + win_blocks_len
        } else {
            ((prev.lazy_wrapped_from as isize) + block_count_delta) as usize
        };
        prev.blocks.splice(b_start..b_end, win.blocks);
        let suffix_start = b_start + win_blocks_len;
        if byte_delta != 0 {
            let wrap_end = old_lazy.min(prev.blocks.len());
            if suffix_start < wrap_end {
                for block in &mut prev.blocks[suffix_start..wrap_end] {
                    if let Block::Widget { widget, .. } = block
                        && widget
                            .as_widget_any()
                            .and_then(|a| a.downcast_ref::<LazyBlockWidget>())
                            .is_none()
                    {
                        *widget = Rc::new(LazyBlockWidget {
                            env_slot: Rc::clone(lazy_env_slot),
                            fallback: Rc::clone(widget),
                            resolved: RefCell::new(None),
                        });
                    }
                }
            }
            prev.lazy_wrapped_from = suffix_start.min(old_lazy);
            let next_b_delta = prev.deferred.blocks_delta + byte_delta;
            prev.deferred.blocks_delta = next_b_delta;
            prev.deferred.blocks_revision = revision;
            prev.deferred.blocks_split = if next_b_delta == 0 {
                prev.blocks.len()
            } else {
                suffix_start
            };
        } else {
            prev.lazy_wrapped_from = old_lazy;
            if prev.deferred.blocks_delta != 0 {
                prev.deferred.blocks_split = suffix_start;
            }
        }
    }

    let new_win_bytes_start = if aligned_new_start < new_total {
        cx.doc.line_range(aligned_new_start).start
    } else {
        cx.doc.len()
    };
    let new_win_bytes_end = if aligned_new_end == 0 {
        0
    } else if aligned_new_end < new_total {
        cx.doc.line_range(aligned_new_end).start
    } else {
        cx.doc.len()
    };
    let old_win_bytes_start = new_win_bytes_start;
    let old_win_bytes_end = ((new_win_bytes_end as isize) - byte_delta).max(0) as usize;

    // The window decorates whole lines, but an element on its first or last
    // line can reach into the unchanged lines around it (emphasis wrapping onto
    // the next line). The prefix and suffix keep their own copies of those
    // ranges, so the window contributes only the ones starting inside it;
    // otherwise they would appear twice and break the sorted order.
    let to_eof = aligned_new_end >= new_total;
    let in_window =
        |start: usize| start >= new_win_bytes_start && (to_eof || start < new_win_bytes_end);
    win.marks.retain(|m| in_window(m.range.start));
    win.atomic.retain(|r| in_window(r.start));
    win.inline_widgets.retain(|w| in_window(w.range.start));
    win.underlines.retain(|u| in_window(u.range.start));

    let d0 = prev.deferred.delta;
    let ms0 = prev.deferred.marks_split.min(prev.marks.len());
    let hs0 = prev.deferred.hidden_split.min(prev.hidden.len());
    let as0 = prev.deferred.atomic_split.min(prev.atomic.len());
    let iws0 = prev
        .deferred
        .inline_widgets_split
        .min(prev.inline_widgets.len());
    let us0 = prev.deferred.underlines_split.min(prev.underlines.len());

    let m_pre = logical_partition(
        prev.marks.len(),
        ms0,
        d0,
        |i| prev.marks[i].range.start,
        old_win_bytes_start,
    );
    let m_suf = logical_partition(
        prev.marks.len(),
        ms0,
        d0,
        |i| prev.marks[i].range.start,
        old_win_bytes_end,
    )
    .max(m_pre);

    let mut h_pre = logical_partition(
        prev.hidden.len(),
        hs0,
        d0,
        |i| prev.hidden[i].start,
        old_win_bytes_start,
    );
    let mut h_suf = logical_partition(
        prev.hidden.len(),
        hs0,
        d0,
        |i| prev.hidden[i].start,
        old_win_bytes_end,
    )
    .max(h_pre);

    let a_pre = logical_partition(
        prev.atomic.len(),
        as0,
        d0,
        |i| prev.atomic[i].start,
        old_win_bytes_start,
    );
    let a_suf = logical_partition(
        prev.atomic.len(),
        as0,
        d0,
        |i| prev.atomic[i].start,
        old_win_bytes_end,
    )
    .max(a_pre);

    let iw_pre = logical_partition(
        prev.inline_widgets.len(),
        iws0,
        d0,
        |i| prev.inline_widgets[i].range.start,
        old_win_bytes_start,
    );
    let iw_suf = logical_partition(
        prev.inline_widgets.len(),
        iws0,
        d0,
        |i| prev.inline_widgets[i].range.start,
        old_win_bytes_end,
    )
    .max(iw_pre);

    let u_pre = logical_partition(
        prev.underlines.len(),
        us0,
        d0,
        |i| prev.underlines[i].range.start,
        old_win_bytes_start,
    );
    let u_suf = logical_partition(
        prev.underlines.len(),
        us0,
        d0,
        |i| prev.underlines[i].range.start,
        old_win_bytes_end,
    )
    .max(u_pre);

    // If the edit jumped strictly earlier than the previous deferred split in
    // any inline vector, materialise once so all five vectors keep one shared delta.
    if d0 != 0 && (m_suf < ms0 || h_suf < hs0 || a_suf < as0 || iw_suf < iws0 || u_suf < us0) {
        prev.materialize_inline_vectors();
    }

    let cur_delta = prev.deferred.delta;
    if cur_delta != 0 {
        let ms = prev.deferred.marks_split.min(prev.marks.len());
        if ms < m_pre {
            for m in &mut prev.marks[ms..m_pre] {
                m.range = shift_range(&m.range, cur_delta);
            }
        }
        let hs = prev.deferred.hidden_split.min(prev.hidden.len());
        if hs < h_pre {
            for r in &mut prev.hidden[hs..h_pre] {
                *r = shift_range(r, cur_delta);
            }
        }
        let ats = prev.deferred.atomic_split.min(prev.atomic.len());
        if ats < a_pre {
            for r in &mut prev.atomic[ats..a_pre] {
                *r = shift_range(r, cur_delta);
            }
        }
        let iws = prev
            .deferred
            .inline_widgets_split
            .min(prev.inline_widgets.len());
        if iws < iw_pre {
            for w in &mut prev.inline_widgets[iws..iw_pre] {
                shift_inline_widget_in_place(w, cur_delta);
            }
        }
        let us = prev.deferred.underlines_split.min(prev.underlines.len());
        if us < u_pre {
            for u in &mut prev.underlines[us..u_pre] {
                u.range = shift_range(&u.range, cur_delta);
            }
        }
    }

    let next_delta = cur_delta + byte_delta;

    let m_mid_len = win.marks.len();
    prev.marks.splice(m_pre..m_suf, win.marks);
    let new_marks_split = m_pre + m_mid_len;

    // O(1) sorted boundary coalescing for `hidden` without touching the suffix.
    let mut h_mid = win.hidden;
    if h_pre > 0 && !h_mid.is_empty() && h_mid[0].start <= prev.hidden[h_pre - 1].end {
        h_pre -= 1;
        let left = &prev.hidden[h_pre];
        h_mid[0].start = left.start;
        h_mid[0].end = h_mid[0].end.max(left.end);
    }
    while h_suf < prev.hidden.len() {
        let next_r = shift_range(&prev.hidden[h_suf], next_delta);
        if let Some(last) = h_mid.last_mut() {
            if next_r.start <= last.end {
                last.end = last.end.max(next_r.end);
                h_suf += 1;
                continue;
            }
        } else if h_pre > 0 && next_r.start <= prev.hidden[h_pre - 1].end {
            let merged_start = prev.hidden[h_pre - 1].start;
            let merged_end = prev.hidden[h_pre - 1].end.max(next_r.end);
            h_pre -= 1;
            h_suf += 1;
            h_mid.push(merged_start..merged_end);
            continue;
        }
        break;
    }
    let h_mid_len = h_mid.len();
    prev.hidden.splice(h_pre..h_suf, h_mid);
    let new_hidden_split = h_pre + h_mid_len;

    let a_mid_len = win.atomic.len();
    prev.atomic.splice(a_pre..a_suf, win.atomic);
    let new_atomic_split = a_pre + a_mid_len;

    let iw_mid_len = win.inline_widgets.len();
    prev.inline_widgets
        .splice(iw_pre..iw_suf, win.inline_widgets);
    let new_inline_widgets_split = iw_pre + iw_mid_len;

    let u_mid_len = win.underlines.len();
    prev.underlines.splice(u_pre..u_suf, win.underlines);
    let new_underlines_split = u_pre + u_mid_len;

    prev.deferred.delta = next_delta;
    if next_delta == 0 {
        prev.deferred.marks_split = prev.marks.len();
        prev.deferred.hidden_split = prev.hidden.len();
        prev.deferred.atomic_split = prev.atomic.len();
        prev.deferred.inline_widgets_split = prev.inline_widgets.len();
        prev.deferred.underlines_split = prev.underlines.len();
    } else {
        prev.deferred.marks_split = new_marks_split;
        prev.deferred.hidden_split = new_hidden_split;
        prev.deferred.atomic_split = new_atomic_split;
        prev.deferred.inline_widgets_split = new_inline_widgets_split;
        prev.deferred.underlines_split = new_underlines_split;
    }

    prev.id = crate::editor::view::decoration::next_decorations_id();
    prev.surface = surface(cx.theme);
    prev.splice = Some(BlockSplice {
        base_ptr: base_id as usize,
        old_blocks: b_start..b_end,
        new_blocks: new_blocks_range,
        removed_widget_ids: dead_ids,
    });
    prev
}

/// Build the Reveal Layer (`TA-11`) for ONLY the 0–3 line spans intersecting
/// active `preview.revealed`, `preview.composing`, or `preview.callout_title`.
/// Never rebuilds Document-Layer blocks!
pub fn decorate_reveal(doc_decos: &Decorations, cx: &DecorateCx, revision: u64) -> RevealLayer {
    decorate_reveal_with_fallbacks(doc_decos, cx, revision, None)
}

pub fn decorate_reveal_with_fallbacks(
    doc_decos: &Decorations,
    cx: &DecorateCx,
    revision: u64,
    source_fallbacks: Option<&[(bool, Range<usize>)]>,
) -> RevealLayer {
    if !cx.live || !cx.preview.has_reveal_overrides() {
        return RevealLayer::empty();
    }
    let total = cx.doc.line_count();
    if total == 0 {
        return RevealLayer::empty();
    }

    let mut line_spans: Vec<Range<usize>> = Vec::with_capacity(4);
    for r in [&cx.preview.reveal, &cx.preview.revealed_source]
        .into_iter()
        .flatten()
    {
        let clamped = cx.doc.clamp_range(r.clone());
        let first = cx.doc.line_index(clamped.start);
        let last = cx
            .doc
            .line_index(clamped.end.saturating_sub(1).max(clamped.start));
        line_spans.push(first..(last + 1).min(total));
    }
    if let Some(comp) = cx.preview.composing {
        let l = cx.doc.line_index(cx.doc.clamp(comp));
        line_spans.push(l..(l + 1).min(total));
    }
    if let Some(ct) = cx.preview.callout_title
        && ct < total
    {
        line_spans.push(ct..ct + 1);
    }
    if line_spans.is_empty() {
        return RevealLayer::empty();
    }

    // Align any span touching a multi-line `Block::Widget` to that widget's
    // whole `lines` range so inline reveals inside table cells or revealed
    // source blocks replace whole blocks cleanly.
    for span in &mut line_spans {
        let b_first = doc_decos
            .blocks
            .partition_point(|b| b.lines().end <= span.start);
        let b_last = doc_decos
            .blocks
            .partition_point(|b| b.lines().start < span.end)
            .max(b_first);
        if b_first < b_last {
            span.start = span.start.min(doc_decos.blocks[b_first].lines().start);
            span.end = span.end.max(doc_decos.blocks[b_last - 1].lines().end);
        }
    }
    let merged_spans = merge(line_spans);
    let composing_line = cx
        .preview
        .composing
        .map(|c| cx.doc.line_index(cx.doc.clamp(c)));

    // Seed temporary registry from `doc_decos` widgets inside the reveal spans
    // so any widget re-emitted inside a reveal patch keeps its exact `BlockId`!
    let mut temp_registry = BlockIdRegistry::default();
    let mut prev_widgets: HashMap<BlockId, Rc<dyn BlockWidget>> = HashMap::new();
    for span in &merged_spans {
        let b_first = doc_decos
            .blocks
            .partition_point(|b| b.lines().end <= span.start);
        let b_last = doc_decos
            .blocks
            .partition_point(|b| b.lines().start < span.end)
            .max(b_first);
        for b in &doc_decos.blocks[b_first..b_last] {
            if let Block::Widget { id, widget, .. } = b {
                prev_widgets.insert(*id, Rc::clone(widget));
            }
        }
    }

    let mut patches = Vec::with_capacity(merged_spans.len());
    for span in merged_spans {
        if span.is_empty() {
            continue;
        }
        let rhythm = block_rhythm_in_lines(cx.doc, cx.syntax, span.clone(), composing_line);
        let patch_cx = DecorateCx {
            rhythm: &rhythm,
            ..*cx
        };
        let mut win = decorate_window(
            &patch_cx,
            span.clone(),
            span.start,
            Some(&mut temp_registry),
            revision,
            Some(&prev_widgets),
            source_fallbacks,
        );
        // Preserve exact `BlockId`s for widgets matching existing Document-Layer
        // `lines` in `doc_decos`.
        for block in &mut win.blocks {
            if let Block::Widget { id, lines, .. } = block {
                let idx = doc_decos
                    .blocks
                    .partition_point(|b| b.lines().start < lines.start);
                if let Some(Block::Widget {
                    id: doc_id,
                    lines: doc_lines,
                    ..
                }) = doc_decos.blocks.get(idx)
                    && doc_lines == lines
                {
                    *id = *doc_id;
                }
            }
        }
        let byte_start = cx.doc.line_range(span.start).start;
        let byte_end = cx.doc.line_range(span.end - 1).end;
        patches.push(RevealPatch {
            lines: span,
            byte_range: byte_start..byte_end,
            blocks: win.blocks,
            marks: win.marks,
            hidden: win.hidden,
            atomic: win.atomic,
            inline_widgets: win.inline_widgets,
            underlines: win.underlines,
        });
    }

    RevealLayer::from_patches(patches)
}
