//! Cached parse → plan → decoration pipeline and incremental scheduling (`TA-11`, `TA-31`, `TA-81`).
use super::{
    core::{
        decorations::{self, DecorateCx},
        features::Features,
        links::Headings,
        plans::{self, Plan, PlanCache},
        presentation::block_rhythm,
        presentation::content_language::ReadingLanguage,
        projection::{Parsed, incremental_required_byte, reveal_required_byte},
        state::{FeatureStateStore, PreviewState},
        syntax::{Syntax, SyntaxSplice},
    },
    style::MarkdownTheme,
};
use crate::{
    editor::{
        navigation::ReferenceContext,
        registry::DocumentAssets,
        text::{
            buffer::Buffer,
            state::{Applied, EditorState},
        },
        view::{
            decoration::{Block, Decorations, RevealLayer},
            extension::DecorateInput,
            widget::{BlockId, BlockIdRegistry, BlockWidget},
        },
    },
    typography::Scale,
};
use std::{
    cell::OnceCell,
    collections::{HashMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    rc::Rc,
    sync::mpsc::{self, Receiver},
};

/// Documents larger than 512 KiB whose edit defeats incremental block splicing
/// parse a Rope snapshot on a background thread while shifting existing
/// decorations optimistically (`TA-31`).
const ASYNC_FALLBACK_THRESHOLD: usize = 512 * 1024;

pub(super) struct PendingAsyncParse {
    pub(super) revision: u64,
    pub(super) len: usize,
    pub(super) rx: Receiver<Syntax>,
    pub(super) optimistic_decos: Option<(bool, u64, Rc<Decorations>)>,
}

pub(super) struct CachedDocDecos {
    pub(super) revision: u64,
    pub(super) doc_key: u64,
    pub(super) dark: bool,
    pub(super) decorations: Rc<Decorations>,
}

#[derive(Default)]
pub(super) struct PipelineCache {
    pub(super) parsed: Option<Parsed>,
    pub(super) doc_decos: Option<CachedDocDecos>,
    pub(super) registry: BlockIdRegistry,
    pub(super) prev_widgets: HashMap<BlockId, Rc<dyn BlockWidget>>,
    pub(super) lazy_env_slot: decorations::LazyEnvSlot,
    pub(super) reading_language: ReadingLanguage,
    pub(super) pending_async: Option<PendingAsyncParse>,
    pub(super) config_epoch: u64,
}

pub(super) struct PipelineInput<'a> {
    pub(super) theme: &'a MarkdownTheme,
    pub(super) scale: Scale,
    pub(super) theme_key: u64,
    pub(super) live: bool,
    pub(super) preview: &'a PreviewState,
    pub(super) features: Features,
    pub(super) assets: Option<&'a DocumentAssets>,
    pub(super) references: Option<&'a ReferenceContext>,
}

impl PipelineCache {
    fn resolved_theme(
        &mut self,
        doc: &Buffer,
        dark: bool,
        cfg: &PipelineInput<'_>,
    ) -> MarkdownTheme {
        let mut theme =
            if dark == cfg.theme.dark && cfg.theme_key == crate::editor::tokens::theme_key() {
                cfg.theme.clone()
            } else {
                MarkdownTheme::resolve(dark, cfg.scale)
            };
        let han = self
            .reading_language
            .resolve_buffer(doc, &crate::localization::current().code);
        theme.body.text.weight =
            crate::editor::tokens::Tokens::get(dark, cfg.scale).reading_weight(han);
        theme
    }

    pub(super) fn adopt_pending_async(
        &mut self,
        state: &EditorState,
        folds: &FeatureStateStore,
        features: Features,
        block: bool,
    ) -> bool {
        let Some(pending) = self.pending_async.as_ref() else {
            return false;
        };
        if pending.revision != state.revision || pending.len != state.doc.len() {
            self.pending_async = None;
            return false;
        }
        let received = if block {
            pending.rx.recv().ok()
        } else {
            pending.rx.try_recv().ok()
        };
        let Some(syntax_val) = received else {
            return false;
        };
        self.pending_async = None;
        self.parsed = Some(Parsed::from_syntax(
            state.revision,
            &state.doc,
            Rc::new(syntax_val),
            folds,
            features,
        ));
        self.doc_decos = None;
        true
    }

    pub(super) fn ensure_parsed_in(
        &mut self,
        state: &EditorState,
        folds: &FeatureStateStore,
        features: Features,
    ) -> (Rc<Syntax>, Rc<Vec<Plan>>) {
        self.ensure_parsed_covering(state, folds, features, None)
    }

    /// Ensure `self.parsed` matches `state` and covers `required_byte_end`
    /// (`None` means the entire document, materialising any deferred suffix tail).
    pub(super) fn ensure_parsed_covering(
        &mut self,
        state: &EditorState,
        folds: &FeatureStateStore,
        features: Features,
        required_byte_end: Option<usize>,
    ) -> (Rc<Syntax>, Rc<Vec<Plan>>) {
        let _ = self.adopt_pending_async(state, folds, features, true);
        if let Some(p) = self.parsed.as_mut()
            && p.revision == state.revision
            && p.len == state.doc.len()
        {
            if let Some(tail) = &p.tail {
                let needs_tail = match required_byte_end {
                    None => true,
                    Some(end) => end >= tail.split_byte,
                };
                if needs_tail {
                    p.materialize_tail();
                }
            }
            if p.folds != *folds {
                p.materialize_tail();
                let compiled = plans::compile(&state.doc, &p.syntax, folds, features);
                p.plan_cache = PlanCache::default();
                p.plan_cache.rebuild_index(&compiled);
                p.plans = Rc::new(compiled);
                p.folds = folds.clone();
                p.last_splice = None;
                self.doc_decos = None;
            }
            return (Rc::clone(&p.syntax), Rc::clone(&p.plans));
        }

        let parsed = Parsed::from_syntax(
            state.revision,
            &state.doc,
            Rc::new(Syntax::parse_with(&state.doc, features)),
            folds,
            features,
        );
        let result = (Rc::clone(&parsed.syntax), Rc::clone(&parsed.plans));
        self.parsed = Some(parsed);
        result
    }

    pub(super) fn heading_position(
        &mut self,
        state: &EditorState,
        folds: &FeatureStateStore,
        features: Features,
        key: &str,
    ) -> Option<usize> {
        let _ = self.ensure_parsed_in(state, folds, features);
        let p = self.parsed.as_ref()?;
        let headings = p
            .headings
            .get_or_init(|| Headings::from_syntax(&state.doc, &p.syntax));
        headings.get(key)
    }

    pub(super) fn refresh_shifted_plans_if_needed(
        &mut self,
        state: &EditorState,
        folds: &FeatureStateStore,
        features: Features,
    ) -> (Rc<Syntax>, Rc<Vec<Plan>>) {
        let (syntax, plans) = self.ensure_parsed_in(state, folds, features);
        let needs_refresh = plans.iter().any(|p| {
            p.embed()
                .is_some_and(|e| !e.built_for(&state.doc, p.source.start))
        });
        if needs_refresh && let Some(p) = self.parsed.as_mut() {
            let mut vec = (*p.plans).clone();
            plans::refresh_shifted_block_plans(
                &state.doc,
                &syntax,
                folds,
                features,
                &mut vec,
                0..state.doc.len(),
            );
            p.plans = Rc::new(vec);
            (syntax, Rc::clone(&p.plans))
        } else {
            (syntax, plans)
        }
    }

    pub(super) fn prepare_applied(
        &mut self,
        applied: &Applied,
        state: &EditorState,
        folds: &FeatureStateStore,
        features: Features,
    ) {
        if self
            .parsed
            .as_ref()
            .is_some_and(|p| p.revision == state.revision && p.len == state.doc.len())
        {
            return;
        }

        self.registry.map(&applied.changes, state.revision);
        self.pending_async = None;

        if let Some(mut prev) = self.parsed.take()
            && prev.len == applied.before_doc.len()
        {
            if prev.tail.is_some() {
                let max_old = applied.changes.changes().last().map_or(0, |c| c.range.end);
                if !prev.tail_fits_head(max_old) {
                    prev.materialize_tail();
                }
            }

            let run_incremental = |prev: &mut Parsed, allow_eof: bool| -> Option<SyntaxSplice> {
                let prev_elems = prev.syntax.elements.len();
                let prev_lists = prev.syntax.lists.len();
                let prev_items = prev.syntax.items.len();
                let splice = Syntax::try_parse_incremental_in_place_bounded(
                    Rc::make_mut(&mut prev.syntax),
                    &state.doc,
                    &applied.before_doc,
                    &applied.changes,
                    features,
                    allow_eof,
                )?;
                let new_elems = prev.syntax.elements.len();
                let new_lists = prev.syntax.lists.len();
                let new_items = prev.syntax.items.len();
                plans::compile_incremental_in_place(
                    &state.doc,
                    &prev.syntax,
                    Rc::make_mut(&mut prev.plans),
                    prev_elems,
                    &splice,
                    folds,
                    features,
                    &mut prev.plan_cache,
                );
                if let Some(tail) = &mut prev.tail {
                    tail.split_byte = ((tail.split_byte as isize) + splice.byte_delta) as usize;
                    tail.split_line = ((tail.split_line as isize) + splice.line_delta) as usize;
                    tail.byte_delta += splice.byte_delta;
                    tail.line_delta += splice.line_delta;
                    tail.elem_delta += new_elems as isize - prev_elems as isize;
                    tail.list_delta += new_lists as isize - prev_lists as isize;
                    tail.item_delta += new_items as isize - prev_items as isize;
                }
                Some(splice)
            };

            let had_tail = prev.tail.is_some();
            let splice_opt = run_incremental(&mut prev, !had_tail).or_else(|| {
                if prev.tail.is_some() {
                    prev.materialize_tail();
                    run_incremental(&mut prev, true)
                } else {
                    None
                }
            });

            if let Some(splice) = splice_opt {
                if prev.tail.is_some() && !prev.syntax.block_delimiters.is_empty() {
                    prev.materialize_tail();
                }
                let prev_rev = prev.revision;
                let splice_new_end = splice.new_bytes.end;
                let mut next = Parsed {
                    revision: state.revision,
                    len: state.doc.len(),
                    syntax: prev.syntax,
                    folds: folds.clone(),
                    plan_cache: prev.plan_cache,
                    plans: prev.plans,
                    headings: OnceCell::new(),
                    last_splice: Some((prev_rev, splice)),
                    tail: prev.tail,
                };
                if next.tail.is_none() {
                    next.maybe_detach_tail(&state.doc, splice_new_end);
                }
                self.parsed = Some(next);
                return;
            }

            if state.doc.len() > ASYNC_FALLBACK_THRESHOLD {
                let snapshot = Buffer::from_rope(state.doc.rope().clone());
                let (tx, rx) = mpsc::channel();
                std::thread::spawn(move || {
                    let parsed = Syntax::parse_with(&snapshot, features);
                    let _ = tx.send(parsed);
                });
                let optimistic_decos = self.doc_decos.as_ref().map(|d| {
                    let shifted = Rc::new(d.decorations.map(
                        &applied.changes,
                        &state.doc,
                        state.revision,
                    ));
                    (d.dark, d.doc_key, shifted)
                });
                self.pending_async = Some(PendingAsyncParse {
                    revision: state.revision,
                    len: state.doc.len(),
                    rx,
                    optimistic_decos,
                });
                return;
            }
        }

        self.parsed = Some(Parsed::from_syntax(
            state.revision,
            &state.doc,
            Rc::new(Syntax::parse_with(&state.doc, features)),
            folds,
            features,
        ));
    }

    pub(super) fn decorate_document(
        &mut self,
        state: &EditorState,
        dark: bool,
        cfg: &PipelineInput<'_>,
    ) -> Rc<Decorations> {
        let _ = self.adopt_pending_async(state, &cfg.preview.features, cfg.features, false);
        let doc_key = {
            let mut h = DefaultHasher::new();
            (
                &cfg.preview.features,
                cfg.live,
                cfg.scale as u8,
                crate::editor::tokens::theme_key(),
                crate::localization::current().code,
                self.config_epoch,
                self.pending_async.is_some(),
            )
                .hash(&mut h);
            h.finish()
        };

        if let Some(pending) = self.pending_async.as_ref()
            && pending.revision == state.revision
            && let Some((opt_dark, opt_key, ref decos)) = pending.optimistic_decos
            && opt_dark == dark
            && opt_key == doc_key
        {
            return Rc::clone(decos);
        }

        if let Some(cached) = self.doc_decos.as_ref()
            && cached.revision == state.revision
            && cached.doc_key == doc_key
            && cached.dark == dark
        {
            return Rc::clone(&cached.decorations);
        }

        let theme = self.resolved_theme(&state.doc, dark, cfg);
        let doc_preview = PreviewState::document_only(cfg.preview.features.clone());

        let incremental_splice = self
            .parsed
            .as_ref()
            .and_then(|p| (p.revision == state.revision).then_some(p.last_splice.clone()))
            .flatten();

        let can_incremental = incremental_splice.as_ref().is_some_and(|(from_rev, _)| {
            cfg.live
                && self.doc_decos.as_ref().is_some_and(|prev| {
                    prev.revision == *from_rev && prev.doc_key == doc_key && prev.dark == dark
                })
        });

        let next_rc = if can_incremental
            && let Some((_, splice)) = incremental_splice
            && let Some(prev_cached) = self.doc_decos.take()
        {
            let required_byte = incremental_required_byte(
                &state.doc,
                prev_cached.decorations.blocks.len(),
                |i| prev_cached.decorations.blocks[i].lines(),
                &splice,
            );
            let (syntax, plans) = self.ensure_parsed_covering(
                state,
                &cfg.preview.features,
                cfg.features,
                required_byte,
            );
            let PipelineCache {
                parsed,
                registry,
                prev_widgets,
                lazy_env_slot,
                ..
            } = self;
            let source_fallbacks = parsed
                .as_ref()
                .and_then(|p| p.plan_cache.source_fallbacks());
            let cx = DecorateCx {
                doc: &state.doc,
                syntax: &syntax,
                plans: &plans,
                rhythm: &[],
                theme: &theme,
                preview: &doc_preview,
                live: cfg.live,
                features: cfg.features,
                assets: cfg.assets,
                references: cfg.references,
                inline_preview: Some(&super::composition::preview::PREVIEW),
            };
            let owned_prev = Rc::unwrap_or_clone(prev_cached.decorations);
            let built = decorations::decorate_incremental_in_place(
                owned_prev,
                &splice,
                &cx,
                registry,
                state.revision,
                prev_widgets,
                lazy_env_slot,
                source_fallbacks,
            );
            if let Some(ref sp) = built.splice {
                for dead in &sp.removed_widget_ids {
                    prev_widgets.remove(dead);
                }
                for b in &built.blocks[sp.new_blocks.clone()] {
                    if let Block::Widget { id, widget, .. } = b {
                        prev_widgets.insert(*id, Rc::clone(widget));
                    }
                }
            }
            Rc::new(built)
        } else {
            let (syntax, plans) = self.ensure_parsed_in(state, &cfg.preview.features, cfg.features);
            let rhythm = if cfg.live {
                block_rhythm(&state.doc, &syntax, None)
            } else {
                Vec::new()
            };
            let PipelineCache {
                registry,
                prev_widgets,
                ..
            } = self;
            let cx = DecorateCx {
                doc: &state.doc,
                syntax: &syntax,
                plans: &plans,
                rhythm: &rhythm,
                theme: &theme,
                preview: &doc_preview,
                live: cfg.live,
                features: cfg.features,
                assets: cfg.assets,
                references: cfg.references,
                inline_preview: Some(&super::composition::preview::PREVIEW),
            };
            let built =
                decorations::decorate_with_registry(&cx, registry, state.revision, prev_widgets);
            record_widget_map(&built.blocks, prev_widgets);
            Rc::new(built)
        };

        self.doc_decos = Some(CachedDocDecos {
            revision: state.revision,
            doc_key,
            dark,
            decorations: Rc::clone(&next_rc),
        });
        next_rc
    }

    pub(super) fn decorate_reveal(
        &mut self,
        input: &DecorateInput,
        doc_layer: &Decorations,
        cfg: &PipelineInput<'_>,
    ) -> Rc<RevealLayer> {
        let state = input.state;
        let theme = self.resolved_theme(&state.doc, input.dark, cfg);
        let required_byte =
            reveal_required_byte(&state.doc, cfg.preview, doc_layer.blocks.len(), |i| {
                doc_layer.blocks[i].lines()
            });
        let (syntax, plans) =
            self.ensure_parsed_covering(state, &cfg.preview.features, cfg.features, required_byte);
        let source_fallbacks = self
            .parsed
            .as_ref()
            .and_then(|p| p.plan_cache.source_fallbacks());
        let cx = DecorateCx {
            doc: &state.doc,
            syntax: &syntax,
            plans: &plans,
            rhythm: &[],
            theme: &theme,
            preview: cfg.preview,
            live: cfg.live,
            features: cfg.features,
            assets: cfg.assets,
            references: cfg.references,
            inline_preview: Some(&super::composition::preview::PREVIEW),
        };
        Rc::new(decorations::decorate_reveal_with_fallbacks(
            doc_layer,
            &cx,
            state.revision,
            source_fallbacks,
        ))
    }
}

fn record_widget_map(blocks: &[Block], map: &mut HashMap<BlockId, Rc<dyn BlockWidget>>) {
    map.clear();
    for b in blocks {
        if let Block::Widget { id, widget, .. } = b {
            map.insert(*id, Rc::clone(widget));
        }
    }
}
