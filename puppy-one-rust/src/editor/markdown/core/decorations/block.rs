//! Window and block-widget decoration pass plus lazy off-screen widget
//! materialisation (`TA-12`, `TA-14`, `TA-32`, product
//! `core/decorations/blockDecorations.ts`).
use super::{
    DecorateCx,
    builder::{self, BlockDecoration, Builder},
};
use crate::editor::{
    markdown::{
        core::{
            features::{self, Features, WidgetFactoryCx},
            plans::{self, Plan, Presentation},
            presentation::classes::Class,
            projection::range::merge_ranges,
            state::FeatureStateStore,
            syntax::{Kind, Syntax},
        },
        style::{MarkdownTheme, cascade::LineInput},
    },
    navigation::ReferenceContext,
    registry::DocumentAssets,
    text::{Anchor, buffer::Buffer},
    view::{
        decoration::{
            Block, InlineImage, InlineWidget, InlineWidgetKind, Mark, Superscript, Underline,
        },
        widget::{BlockId, BlockIdRegistry, BlockWidget, WidgetCx},
    },
};
use gpui::{AnyElement, SharedString};
use std::{any::Any, cell::RefCell, collections::HashMap, ops::Range, rc::Rc};

/// Shared snapshot for lazily materialising shifted off-screen block widgets
/// only if/when they enter the viewport (`TA-32`). Stored in a reusable slot
/// so `Syntax` has `Rc::strong_count == 1` across incremental edits and
/// already-lazy off-screen widgets avoid per-keystroke `Rc::new` allocations!
pub struct LazyWidgetEnv {
    pub(super) revision: u64,
    pub(super) doc: Buffer,
    pub(super) link_defs_text: String,
    pub(super) theme: MarkdownTheme,
    pub(super) features: Features,
    pub(super) feature_state: FeatureStateStore,
    pub(super) assets: Option<DocumentAssets>,
    pub(super) references: Option<ReferenceContext>,
}

pub type LazyEnvSlot = Rc<RefCell<Option<Rc<LazyWidgetEnv>>>>;

type ResolvedLazyWidget = Option<(u64, Range<usize>, Rc<dyn BlockWidget>)>;

pub(super) struct LazyBlockWidget {
    pub(super) env_slot: LazyEnvSlot,
    pub(super) fallback: Rc<dyn BlockWidget>,
    pub(super) resolved: RefCell<ResolvedLazyWidget>,
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
            .and_then(|embed| Some((features::find(env.features, embed.feature)?, embed)))
            .and_then(|(f, embed)| {
                features::catch_feature_panic(f.id(), "block_widget", || {
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

pub(super) struct WindowArtifacts {
    pub(super) blocks: Vec<Block>,
    pub(super) marks: Vec<Mark>,
    pub(super) hidden: Vec<Range<usize>>,
    pub(super) atomic: Vec<Range<usize>>,
    pub(super) inline_widgets: Vec<InlineWidget>,
    pub(super) underlines: Vec<Underline>,
}

pub(super) fn decorate_window(
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
            .and_then(|(_, embed)| Some((features::find(cx.features, embed.feature)?, embed)));
        if let Some((f, embed)) = widget
            && let Some(built_view) = features::catch_feature_panic(f.id(), "block_widget", || {
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
            let ok = features::catch_feature_panic(f.id(), "decorate_block", || {
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
    let hidden = merge_ranges(std::mem::take(&mut b.hidden));
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
