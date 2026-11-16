//! Native Markdown editor (product `src/shared-ui/editor/markdown`):
//! the Markdown source is the only document truth; syntax → plans and block
//! rhythm → two-layer decorations (`TA-11`) → the generic GPUI view (`editor::view`).
//!
//! - `core/`: the format pipeline (incremental syntax, incremental plans,
//!   two-layer decorations, state, commands) and the feature contract
//! - `features/`: one vertical slice per capability
//! - `addons/`: optional view add-ons (`block_drag`, `TA-60`, `R8`)
//! - `style/`: one typed style per element type, the line cascade and the
//!   inline mark mapping; every value is a product token
//! - `composition.rs`: the built-in features
mod addons;
pub mod composition;
pub mod core;
pub mod features;
mod navigation;
pub mod platform;
pub mod shared;
pub mod style;
#[cfg(test)]
mod tests;

pub use self::core::{
    commands::{FormatCommand, block_move::set_enabled as set_block_drag_enabled},
    links::{find_links, find_wiki_links},
};

use self::core::{
    commands,
    decorations::{self, DecorateCx},
    feature::{self as contract, CommandCx},
    plans::{self, Plan, PlanCache},
    presentation::block_rhythm,
    state::{FeatureStateStore, PreviewState},
    syntax::{
        Syntax, SyntaxSplice,
        block_boundaries::{BlockBoundaries, BoundaryProvider},
    },
};
use crate::{
    editor::{
        navigation::ReferenceContext,
        registry::DocumentAssets,
        text::{
            buffer::Buffer,
            selection::Selection,
            state::{Applied, EditorState, StateEffect, Transaction},
        },
        view::{
            EditorView,
            command::Command,
            decoration::{Block, Decorations, RevealLayer},
            extension::{DecorateInput, EditIntent, EditorExtension, SetAppearance, SetReadOnly},
            plugins::ViewPlugin,
            widget::{BlockId, BlockIdRegistry, BlockWidget},
        },
    },
    typography::Scale,
};
use composition::{FEATURES, MDX_FEATURES};
use gpui::{Action, App, Context, Div, KeyBinding, actions, prelude::*};
use std::{
    cell::{Cell, OnceCell, RefCell},
    collections::{HashMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    rc::Rc,
    sync::mpsc::{self, Receiver},
};
use style::MarkdownTheme;

/// Documents larger than 512 KiB whose edit defeats incremental block splicing
/// parse a Rope snapshot on a background thread while shifting existing
/// decorations optimistically (`TA-31`).
const ASYNC_FALLBACK_THRESHOLD: usize = 512 * 1024;

pub const KEY_CONTEXT: &str = "MarkdownEditor";
pub const FORMAT_FEATURE_ID: &str = "markdown.format";

actions!(
    markdown_editor,
    [
        ToggleBold,
        ToggleItalic,
        ToggleStrike,
        ToggleCode,
        ToggleUnderline,
        InsertLink,
        Heading0,
        Heading1,
        Heading2,
        Heading3,
        Heading4,
        Heading5,
        Heading6,
        ToggleBulletList,
        ToggleOrderedList,
        ToggleTaskList,
        ToggleQuote,
    ]
);

#[derive(Clone, PartialEq, serde::Deserialize, Action)]
#[action(no_json)]
struct RunFeatureKeybinding {
    feature_index: usize,
    binding_index: usize,
}

/// Typed configuration `StateEffect`: set live-preview (`true`) vs source mode (`false`) (`TA-21`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SetLivePreview(pub bool);

/// Typed configuration `StateEffect`: toggle live-preview vs source mode (`TA-21`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ToggleLivePreview;

/// Typed configuration `StateEffect`: update workspace link-graph context (`TA-21`).
#[derive(Clone)]
pub struct SetReferences(pub Option<ReferenceContext>);

/// Typed configuration `StateEffect`: update document media asset resolver (`TA-21`).
#[derive(Clone)]
pub struct SetAssets(pub Option<DocumentAssets>);

pub fn format_command(cmd: FormatCommand) -> Command {
    Command::new(FORMAT_FEATURE_ID, cmd)
}

fn parse_format_command(cmd: &Command) -> Option<FormatCommand> {
    (cmd.feature() == FORMAT_FEATURE_ID)
        .then(|| cmd.payload::<FormatCommand>().copied())
        .flatten()
}

struct PendingAsyncParse {
    revision: u64,
    len: usize,
    rx: Receiver<Syntax>,
    optimistic_decos: Option<(bool, u64, Rc<Decorations>)>,
}

struct Parsed {
    revision: u64,
    len: usize,
    syntax: Rc<Syntax>,
    folds: FeatureStateStore,
    plan_cache: PlanCache,
    plans: Rc<Vec<Plan>>,
    headings: OnceCell<navigation::Headings>,
    last_splice: Option<(u64, SyntaxSplice)>,
}

struct CachedDocDecos {
    revision: u64,
    doc_key: u64,
    dark: bool,
    decorations: Rc<Decorations>,
}

#[derive(Default)]
struct PipelineCache {
    parsed: Option<Parsed>,
    doc_decos: Option<CachedDocDecos>,
    registry: BlockIdRegistry,
    prev_widgets: HashMap<BlockId, Rc<dyn BlockWidget>>,
    lazy_env_slot: decorations::LazyEnvSlot,
    reading_language: core::content_language::ReadingLanguage,
    pending_async: Option<PendingAsyncParse>,
    config_epoch: u64,
}

pub struct MarkdownExtension {
    theme: MarkdownTheme,
    scale: Scale,
    /// Live preview (`false`: source mode).
    pub live: bool,
    live_flag: Rc<Cell<bool>>,
    pub read_only: bool,
    preview: PreviewState,
    pub references: Option<ReferenceContext>,
    /// Where the document's media resolve and load from.
    pub assets: Option<DocumentAssets>,
    /// The dialect's features (`.mdx`: with MDX components).
    features: core::feature::Features,
    /// The Sub Theme the theme was resolved under (`tokens::theme_key`).
    theme_key: u64,
    cache: Rc<RefCell<PipelineCache>>,
}

impl MarkdownExtension {
    pub fn new(dark: bool, scale: Scale) -> Self {
        Self {
            theme: MarkdownTheme::resolve(dark, scale),
            scale,
            live: true,
            live_flag: Rc::new(Cell::new(true)),
            read_only: false,
            preview: PreviewState::default(),
            references: None,
            assets: None,
            features: FEATURES,
            theme_key: crate::editor::tokens::theme_key(),
            cache: Rc::new(RefCell::new(PipelineCache::default())),
        }
    }

    /// The Open Knowledge MDX dialect (`.mdx` documents).
    pub fn mdx(mut self) -> Self {
        self.features = MDX_FEATURES;
        self
    }

    /// Follow the app appearance; returns whether anything changed.
    pub fn set_appearance(&mut self, dark: bool, scale: Scale) -> bool {
        let theme_key = crate::editor::tokens::theme_key();
        if self.theme.dark == dark && self.scale == scale && self.theme_key == theme_key {
            return false;
        }
        self.theme_key = theme_key;
        self.theme = MarkdownTheme::resolve(dark, scale);
        self.scale = scale;
        true
    }

    fn resolved_theme(&self, doc: &Buffer, dark: bool, cache: &mut PipelineCache) -> MarkdownTheme {
        let mut theme =
            if dark == self.theme.dark && self.theme_key == crate::editor::tokens::theme_key() {
                self.theme.clone()
            } else {
                MarkdownTheme::resolve(dark, self.scale)
            };
        let han = cache
            .reading_language
            .resolve_buffer(doc, &crate::localization::current().code);
        theme.body.text.weight =
            crate::editor::tokens::Tokens::get(dark, self.scale).reading_weight(han);
        theme
    }

    fn adopt_pending_async(
        &self,
        cache: &mut PipelineCache,
        state: &EditorState,
        block: bool,
    ) -> bool {
        let Some(pending) = cache.pending_async.as_ref() else {
            return false;
        };
        if pending.revision != state.revision || pending.len != state.doc.len() {
            cache.pending_async = None;
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
        cache.pending_async = None;
        let syntax = Rc::new(syntax_val);
        let plans = Rc::new(plans::compile(
            &state.doc,
            &syntax,
            &self.preview.features,
            self.features,
        ));
        cache.parsed = Some(Parsed {
            revision: state.revision,
            len: state.doc.len(),
            syntax,
            folds: self.preview.features.clone(),
            plan_cache: PlanCache::default(),
            plans,
            headings: OnceCell::new(),
            last_splice: None,
        });
        cache.doc_decos = None;
        true
    }

    fn ensure_parsed_in(
        &self,
        cache: &mut PipelineCache,
        state: &EditorState,
    ) -> (Rc<Syntax>, Rc<Vec<Plan>>) {
        let _ = self.adopt_pending_async(cache, state, true);
        let folds = &self.preview.features;
        if let Some(p) = cache.parsed.as_mut()
            && p.revision == state.revision
            && p.len == state.doc.len()
        {
            if p.folds != *folds {
                p.plans = Rc::new(plans::compile(&state.doc, &p.syntax, folds, self.features));
                p.plan_cache = PlanCache::default();
                p.folds = folds.clone();
                p.last_splice = None;
                cache.doc_decos = None;
            }
            return (Rc::clone(&p.syntax), Rc::clone(&p.plans));
        }

        let syntax = Rc::new(Syntax::parse_with(&state.doc, self.features));
        let plans = Rc::new(plans::compile(&state.doc, &syntax, folds, self.features));
        cache.parsed = Some(Parsed {
            revision: state.revision,
            len: state.doc.len(),
            syntax: Rc::clone(&syntax),
            folds: folds.clone(),
            plan_cache: PlanCache::default(),
            plans: Rc::clone(&plans),
            headings: OnceCell::new(),
            last_splice: None,
        });
        (syntax, plans)
    }

    pub(super) fn parse(&mut self, state: &EditorState) -> (Rc<Syntax>, Rc<Vec<Plan>>) {
        let mut cache = self.cache.borrow_mut();
        self.ensure_parsed_in(&mut cache, state)
    }

    pub(super) fn heading_position(&mut self, state: &EditorState, key: &str) -> Option<usize> {
        let mut cache = self.cache.borrow_mut();
        let _ = self.ensure_parsed_in(&mut cache, state);
        let p = cache.parsed.as_ref()?;
        let headings = p
            .headings
            .get_or_init(|| navigation::Headings::from_syntax(&state.doc, &p.syntax));
        headings.get(key)
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

impl EditorExtension for MarkdownExtension {
    fn key_context(&self) -> Option<&'static str> {
        Some(KEY_CONTEXT)
    }

    fn register_keymap(&self, cx: &mut App) {
        let c = Some(KEY_CONTEXT);
        cx.bind_keys([
            KeyBinding::new("secondary-b", ToggleBold, c),
            KeyBinding::new("secondary-i", ToggleItalic, c),
            KeyBinding::new("secondary-shift-x", ToggleStrike, c),
            KeyBinding::new("secondary-e", ToggleCode, c),
            KeyBinding::new("secondary-u", ToggleUnderline, c),
            KeyBinding::new("secondary-k", InsertLink, c),
            KeyBinding::new("secondary-alt-0", Heading0, c),
            KeyBinding::new("secondary-alt-1", Heading1, c),
            KeyBinding::new("secondary-alt-2", Heading2, c),
            KeyBinding::new("secondary-alt-3", Heading3, c),
            KeyBinding::new("secondary-alt-4", Heading4, c),
            KeyBinding::new("secondary-alt-5", Heading5, c),
            KeyBinding::new("secondary-alt-6", Heading6, c),
            KeyBinding::new("secondary-shift-8", ToggleBulletList, c),
            KeyBinding::new("secondary-shift-7", ToggleOrderedList, c),
            KeyBinding::new("secondary-shift-9", ToggleTaskList, c),
            KeyBinding::new("secondary-shift-.", ToggleQuote, c),
        ]);
        for (feature_index, feat) in MDX_FEATURES.iter().enumerate() {
            for (binding_index, kb) in feat.keybindings().iter().enumerate() {
                cx.bind_keys([KeyBinding::new(
                    kb.chord,
                    RunFeatureKeybinding {
                        feature_index,
                        binding_index,
                    },
                    c,
                )]);
            }
        }
    }

    fn bind_actions(&self, root: Div, cx: &mut Context<EditorView>) -> Div {
        macro_rules! bind_fmt {
            ($div:expr, $($action:ty => $cmd:expr),* $(,)?) => {{
                let mut d = $div;
                $(
                    d = d.on_action(cx.listener(|view, _: &$action, window, cx| {
                        view.run_command(&format_command($cmd), window, cx);
                    }));
                )*
                d
            }};
        }
        bind_fmt!(
            root,
            ToggleBold => FormatCommand::Bold,
            ToggleItalic => FormatCommand::Italic,
            ToggleStrike => FormatCommand::Strike,
            ToggleCode => FormatCommand::Code,
            ToggleUnderline => FormatCommand::Underline,
            InsertLink => FormatCommand::Link,
            Heading0 => FormatCommand::Heading(0),
            Heading1 => FormatCommand::Heading(1),
            Heading2 => FormatCommand::Heading(2),
            Heading3 => FormatCommand::Heading(3),
            Heading4 => FormatCommand::Heading(4),
            Heading5 => FormatCommand::Heading(5),
            Heading6 => FormatCommand::Heading(6),
            ToggleBulletList => FormatCommand::BulletList,
            ToggleOrderedList => FormatCommand::OrderedList,
            ToggleTaskList => FormatCommand::TaskList,
            ToggleQuote => FormatCommand::Quote,
        )
        .on_action(
            cx.listener(|view, action: &RunFeatureKeybinding, window, cx| {
                if let Some(feat) = MDX_FEATURES.get(action.feature_index)
                    && let Some(kb) = feat.keybindings().get(action.binding_index)
                {
                    let cmd = (kb.command)();
                    view.run_command(&cmd, window, cx);
                }
            }),
        )
    }

    fn install_plugins(&mut self, plugins: &mut Vec<Box<dyn ViewPlugin>>) {
        let cache = Rc::downgrade(&self.cache);
        let live_flag = Rc::clone(&self.live_flag);
        let features = self.features;
        let provider: BoundaryProvider = Rc::new(move |doc, revision| {
            let live = live_flag.get();
            if let Some(rc) = cache.upgrade()
                && let Ok(borrow) = rc.try_borrow()
                && let Some(p) = borrow.parsed.as_ref()
                && p.revision == revision
                && p.len == doc.len()
            {
                return BlockBoundaries::of(&p.syntax, revision, live);
            }
            let syntax = Syntax::parse_with(doc, features);
            BlockBoundaries::of(&syntax, revision, live)
        });
        plugins.push(addons::block_drag::BlockDragAddon::install(provider));
    }

    fn apply_effects(
        &mut self,
        effects: &[StateEffect],
        state: &EditorState,
        read_only: bool,
    ) -> bool {
        let mut changed = false;
        if self.read_only != read_only {
            self.read_only = read_only;
            changed = true;
        }
        for eff in effects {
            if let Some(ro) = eff.downcast_ref::<SetReadOnly>()
                && self.read_only != ro.0
            {
                self.read_only = ro.0;
                changed = true;
            }
            if let Some(app) = eff.downcast_ref::<SetAppearance>()
                && self.set_appearance(app.dark, app.scale)
            {
                changed = true;
            }
            if let Some(lp) = eff.downcast_ref::<SetLivePreview>()
                && self.live != lp.0
            {
                self.live = lp.0;
                self.live_flag.set(self.live);
                changed = true;
            }
            if eff.is::<ToggleLivePreview>() {
                self.live = !self.live;
                self.live_flag.set(self.live);
                changed = true;
            }
            if let Some(refs) = eff.downcast_ref::<SetReferences>() {
                self.references = refs.0.clone();
                let next_epoch = self.cache.borrow().config_epoch.wrapping_add(1);
                self.cache.borrow_mut().config_epoch = next_epoch;
                changed = true;
            }
            if let Some(assets) = eff.downcast_ref::<SetAssets>() {
                self.assets = assets.0.clone();
                let next_epoch = self.cache.borrow().config_epoch.wrapping_add(1);
                self.cache.borrow_mut().config_epoch = next_epoch;
                changed = true;
            }
        }
        if changed && !self.live {
            self.preview.reveal = None;
            self.preview.composing = None;
            self.preview.callout_title = None;
            self.preview.revealed_source = None;
        } else if changed && self.live {
            let (syntax, _) = self.parse(state);
            self.preview
                .selection_changed(state, &syntax, true, false, self.read_only);
        }
        changed
    }

    fn link_at(
        &mut self,
        state: &EditorState,
        offset: usize,
        release: bool,
    ) -> Option<crate::editor::view::extension::LinkActivation> {
        self.link_activation(state, offset, release)
    }

    fn link_target(
        &mut self,
        state: &EditorState,
        href: &str,
    ) -> Option<crate::editor::view::extension::LinkAction> {
        if !self.live {
            return None;
        }
        self.parse(state);
        self.link_action(state, href.trim(), false)
    }

    fn supports_layered_decorations(&self) -> bool {
        true
    }

    fn document_decoration_key(&self) -> u64 {
        let cache = self.cache.borrow();
        let mut h = DefaultHasher::new();
        (
            &self.preview.features,
            self.live,
            self.scale as u8,
            crate::editor::tokens::theme_key(),
            crate::localization::current().code,
            cache.config_epoch,
            cache.pending_async.is_some(),
        )
            .hash(&mut h);
        h.finish()
    }

    fn reveal_decoration_key(&self) -> u64 {
        if !self.live {
            return 0;
        }
        self.preview.reveal_key()
    }

    fn decorate_document(&self, state: &EditorState, dark: bool) -> Rc<Decorations> {
        let mut cache = self.cache.borrow_mut();
        let _ = self.adopt_pending_async(&mut cache, state, false);
        let doc_key = {
            let mut h = DefaultHasher::new();
            (
                &self.preview.features,
                self.live,
                self.scale as u8,
                crate::editor::tokens::theme_key(),
                crate::localization::current().code,
                cache.config_epoch,
                cache.pending_async.is_some(),
            )
                .hash(&mut h);
            h.finish()
        };

        if let Some(pending) = cache.pending_async.as_ref()
            && pending.revision == state.revision
            && let Some((opt_dark, opt_key, ref decos)) = pending.optimistic_decos
            && opt_dark == dark
            && opt_key == doc_key
        {
            return Rc::clone(decos);
        }

        if let Some(cached) = cache.doc_decos.as_ref()
            && cached.revision == state.revision
            && cached.doc_key == doc_key
            && cached.dark == dark
        {
            return Rc::clone(&cached.decorations);
        }

        let theme = self.resolved_theme(&state.doc, dark, &mut cache);
        let (syntax, plans) = self.ensure_parsed_in(&mut cache, state);
        let doc_preview = PreviewState::document_only(self.preview.features.clone());

        let incremental_splice = cache
            .parsed
            .as_ref()
            .and_then(|p| (p.revision == state.revision).then_some(p.last_splice.clone()))
            .flatten();

        let prev_decos_rc = cache
            .doc_decos
            .as_ref()
            .filter(|prev| prev.doc_key == doc_key && prev.dark == dark)
            .map(|prev| (prev.revision, Rc::clone(&prev.decorations)));

        let next_rc = if let (Some((from_rev, splice)), Some((prev_rev, prev_rc))) =
            (incremental_splice, prev_decos_rc)
            && from_rev == prev_rev
            && self.live
        {
            let PipelineCache {
                registry,
                prev_widgets,
                lazy_env_slot,
                ..
            } = &mut *cache;
            let cx = DecorateCx {
                doc: &state.doc,
                syntax: &syntax,
                plans: &plans,
                rhythm: &[],
                theme: &theme,
                preview: &doc_preview,
                live: self.live,
                features: self.features,
                assets: self.assets.as_ref(),
                references: self.references.as_ref(),
            };
            let built = decorations::decorate_incremental(
                &prev_rc,
                &splice,
                &cx,
                registry,
                state.revision,
                prev_widgets,
                lazy_env_slot,
            );
            if let Some(ref sp) = built.splice {
                for b in &built.blocks[sp.new_blocks.clone()] {
                    if let Block::Widget { id, widget, .. } = b {
                        prev_widgets.insert(*id, Rc::clone(widget));
                    }
                }
            }
            let rc = Rc::new(built);
            drop(prev_rc);
            rc
        } else {
            let rhythm = if self.live {
                block_rhythm(&state.doc, &syntax, None)
            } else {
                Vec::new()
            };
            let PipelineCache {
                registry,
                prev_widgets,
                ..
            } = &mut *cache;
            let cx = DecorateCx {
                doc: &state.doc,
                syntax: &syntax,
                plans: &plans,
                rhythm: &rhythm,
                theme: &theme,
                preview: &doc_preview,
                live: self.live,
                features: self.features,
                assets: self.assets.as_ref(),
                references: self.references.as_ref(),
            };
            let built =
                decorations::decorate_with_registry(&cx, registry, state.revision, prev_widgets);
            record_widget_map(&built.blocks, prev_widgets);
            Rc::new(built)
        };

        cache.doc_decos = Some(CachedDocDecos {
            revision: state.revision,
            doc_key,
            dark,
            decorations: Rc::clone(&next_rc),
        });
        next_rc
    }

    fn decorate_reveal(&self, input: &DecorateInput, doc_layer: &Decorations) -> Rc<RevealLayer> {
        if !self.live || !self.preview.has_reveal_overrides() {
            return Rc::new(RevealLayer::empty());
        }
        let mut cache = self.cache.borrow_mut();
        let state = input.state;
        let theme = self.resolved_theme(&state.doc, input.dark, &mut cache);
        let (syntax, plans) = self.ensure_parsed_in(&mut cache, state);
        let cx = DecorateCx {
            doc: &state.doc,
            syntax: &syntax,
            plans: &plans,
            rhythm: &[],
            theme: &theme,
            preview: &self.preview,
            live: self.live,
            features: self.features,
            assets: self.assets.as_ref(),
            references: self.references.as_ref(),
        };
        Rc::new(decorations::decorate_reveal(doc_layer, &cx, state.revision))
    }

    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        let doc_layer = self.decorate_document(input.state, input.dark);
        let reveal_layer = self.decorate_reveal(input, &doc_layer);
        if reveal_layer.is_empty() {
            let mut plain = (*doc_layer).clone();
            plain.splice = None;
            return plain;
        }
        let layered =
            crate::editor::view::decoration::LayeredDecorations::new(doc_layer, reveal_layer);
        layered.as_decorations().into_owned()
    }

    fn decoration_key(&self) -> u64 {
        let mut h = DefaultHasher::new();
        (self.document_decoration_key(), self.reveal_decoration_key()).hash(&mut h);
        h.finish()
    }

    fn prepare_applied(&mut self, applied: &Applied, state: &EditorState) {
        self.preview
            .features
            .map(&applied.changes, &state.doc, state.revision);

        let mut cache = self.cache.borrow_mut();
        if cache
            .parsed
            .as_ref()
            .is_some_and(|p| p.revision == state.revision && p.len == state.doc.len())
        {
            return;
        }

        cache.registry.map(&applied.changes, state.revision);
        cache.pending_async = None;

        if let Some(mut prev) = cache.parsed.take()
            && prev.len == applied.before_doc.len()
        {
            let prev_element_count = prev.syntax.elements.len();
            if let Some(splice) = Syntax::try_parse_incremental_in_place(
                Rc::make_mut(&mut prev.syntax),
                &state.doc,
                &applied.before_doc,
                &applied.changes,
                self.features,
            ) {
                let mut plan_cache = prev.plan_cache;
                plans::compile_incremental_in_place(
                    &state.doc,
                    &prev.syntax,
                    Rc::make_mut(&mut prev.plans),
                    prev_element_count,
                    &splice,
                    &self.preview.features,
                    self.features,
                    &mut plan_cache,
                );
                cache.parsed = Some(Parsed {
                    revision: state.revision,
                    len: state.doc.len(),
                    syntax: prev.syntax,
                    folds: self.preview.features.clone(),
                    plan_cache,
                    plans: prev.plans,
                    headings: OnceCell::new(),
                    last_splice: Some((prev.revision, splice)),
                });
                return;
            }

            if state.doc.len() > ASYNC_FALLBACK_THRESHOLD {
                let snapshot = Buffer::from_rope(state.doc.rope().clone());
                let features = self.features;
                let (tx, rx) = mpsc::channel();
                std::thread::spawn(move || {
                    let parsed = Syntax::parse_with(&snapshot, features);
                    let _ = tx.send(parsed);
                });
                let optimistic_decos = cache.doc_decos.as_ref().map(|d| {
                    let shifted = Rc::new(d.decorations.map(
                        &applied.changes,
                        &state.doc,
                        state.revision,
                    ));
                    (d.dark, d.doc_key, shifted)
                });
                cache.pending_async = Some(PendingAsyncParse {
                    revision: state.revision,
                    len: state.doc.len(),
                    rx,
                    optimistic_decos,
                });
                return;
            }
        }

        let syntax = Rc::new(Syntax::parse_with(&state.doc, self.features));
        let plans = Rc::new(plans::compile(
            &state.doc,
            &syntax,
            &self.preview.features,
            self.features,
        ));
        cache.parsed = Some(Parsed {
            revision: state.revision,
            len: state.doc.len(),
            syntax,
            folds: self.preview.features.clone(),
            plan_cache: PlanCache::default(),
            plans,
            headings: OnceCell::new(),
            last_splice: None,
        });
    }

    fn applied(&mut self, applied: &Applied, state: &EditorState, focused: bool) {
        self.prepare_applied(applied, state);
        let syntax = {
            let mut cache = self.cache.borrow_mut();
            if cache.pending_async.is_some() && !self.adopt_pending_async(&mut cache, state, false)
            {
                return;
            }
            self.ensure_parsed_in(&mut cache, state).0
        };
        self.preview
            .applied(applied, state, &syntax, focused, self.read_only);
    }

    fn selection_changed(&mut self, state: &EditorState, focused: bool, pointer_selecting: bool) {
        let (syntax, _) = self.parse(state);
        self.preview
            .selection_changed(state, &syntax, focused, pointer_selecting, self.read_only);
    }

    fn normalize_selection(&mut self, state: &EditorState) -> Option<Selection> {
        if !self.live {
            return None;
        }
        let syntax = {
            let mut cache = self.cache.borrow_mut();
            if cache.pending_async.is_some() && !self.adopt_pending_async(&mut cache, state, false)
            {
                return None;
            }
            self.ensure_parsed_in(&mut cache, state).0
        };
        self.preview.normalize(&state.doc, &syntax, state.selection)
    }

    /// `markdownEditingKeymap`: Markdown-aware Enter, deletion, indentation,
    /// and caret rules; `None` falls back to the default command.
    fn intercept(&mut self, intent: EditIntent, state: &EditorState) -> Option<Transaction> {
        if !self.live {
            return None;
        }
        let (syntax, plans) = self.parse(state);
        commands::intercept(
            intent,
            &commands::Cx {
                state,
                syntax: &syntax,
                plans: &plans,
                preview: &self.preview,
                read_only: self.read_only,
            },
        )
    }

    /// Commands of Markdown formatting shortcuts, feature widgets, and hotspots,
    /// isolated with `catch_feature_panic` (`TA-10`, `TA-33`).
    fn command(&mut self, command: &Command, state: &EditorState) -> Option<Transaction> {
        if let Some(fmt_cmd) = parse_format_command(command) {
            let (syntax, plans) = self.parse(state);
            return commands::run_format(
                fmt_cmd,
                &commands::Cx {
                    state,
                    syntax: &syntax,
                    plans: &plans,
                    preview: &self.preview,
                    read_only: self.read_only,
                },
            );
        }

        let feature = contract::find(self.features, command.feature())?;
        let mut preview_snapshot = self.preview.clone();
        if let Some(view_res) = contract::catch_feature_panic(feature.id(), "view_command", || {
            feature.view_command(command, &mut preview_snapshot, state)
        }) {
            self.preview = preview_snapshot;
            if let Some(tr) = view_res {
                return Some(tr);
            }
        }
        let (syntax, plans) = {
            let mut cache = self.cache.borrow_mut();
            let (syntax, plans) = self.ensure_parsed_in(&mut cache, state);
            // Refresh any byte-shifted BlockEmbed models if needed before running a document command.
            let needs_refresh = plans
                .iter()
                .any(|p| p.embed().is_some_and(|e| e.built_at != p.source.start));
            if needs_refresh && let Some(p) = cache.parsed.as_mut() {
                let mut vec = (*p.plans).clone();
                plans::refresh_shifted_block_plans(
                    &state.doc,
                    &syntax,
                    &self.preview.features,
                    self.features,
                    &mut vec,
                    0..state.doc.len(),
                );
                p.plans = Rc::new(vec);
                (syntax, Rc::clone(&p.plans))
            } else {
                (syntax, plans)
            }
        };
        contract::catch_feature_panic(feature.id(), "command", || {
            feature.command(
                command,
                &CommandCx {
                    state,
                    syntax: &syntax,
                    plans: &plans,
                },
            )
        })
        .flatten()
    }
}

#[cfg(test)]
pub(crate) fn begin_block_drag_for_tests(
    view: &mut EditorView,
    offset: usize,
    boundary: usize,
) -> bool {
    let state = view.state().clone();
    let Some(addon) = view.plugin_mut::<addons::block_drag::BlockDragAddon>() else {
        return false;
    };
    addon.begin_drag_for_tests(&state.doc, state.revision, offset, boundary)
}

#[cfg(test)]
pub(crate) fn finish_block_drag_for_tests(view: &mut EditorView, cx: &mut Context<EditorView>) {
    let state = view.state().clone();
    let read_only = view.read_only();
    let tx = view
        .plugin_mut::<addons::block_drag::BlockDragAddon>()
        .and_then(|addon| addon.finish_drag_for_tests(&state, read_only));
    if let Some(tr) = tx {
        view.dispatch(tr, cx);
    }
}
