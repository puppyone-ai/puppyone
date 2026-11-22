//! `MarkdownExtension`: assembles `core`, `composition`, `platform`, and
//! optional `addons` into an [`EditorExtension`] (product `markdownCodeMirrorExtensions.ts`).
use super::{
    addons,
    composition::{FEATURES, MDX_FEATURES},
    config::{
        SetAssets, SetDialect, SetLivePreview, SetReferences, ToggleLivePreview, format_command,
        parse_format_command, references_fingerprint,
    },
    core::{
        commands::{self, FormatCommand},
        feature::{self as contract, CommandCx, Features},
        plans::Plan,
        state::PreviewState,
        syntax::{
            Syntax,
            block_boundaries::{BlockBoundaries, BoundaryProvider},
        },
    },
    features,
    pipeline::{PipelineCache, PipelineInput},
    style::MarkdownTheme,
};
use crate::{
    editor::{
        navigation::ReferenceContext,
        registry::DocumentAssets,
        text::{
            change::{Assoc, ChangeSet},
            selection::Selection,
            state::{Applied, EditorState, StateEffect, Transaction, UserEvent},
        },
        view::{
            EditorView,
            command::Command,
            decoration::{Decorations, LayeredDecorations, RevealLayer},
            extension::{
                DecorateInput, EditIntent, EditorExtension, LinkAction, LinkActivation,
                SetAppearance, SetReadOnly,
            },
            plugins::ViewPlugin,
        },
    },
    formats::markdown::MarkdownDialect,
    typography::Scale,
};
use gpui::{Action, App, Context, Div, KeyBinding, actions, prelude::*};
use std::{
    cell::{Cell, RefCell},
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    rc::Rc,
};

pub const KEY_CONTEXT: &str = "MarkdownEditor";

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

pub struct MarkdownExtension {
    theme: MarkdownTheme,
    scale: Scale,
    /// Live preview (`false`: source mode).
    pub live: bool,
    live_flag: Rc<Cell<bool>>,
    pub read_only: bool,
    pub(super) preview: PreviewState,
    pub references: Option<ReferenceContext>,
    /// Where the document's media resolve and load from.
    pub assets: Option<DocumentAssets>,
    dialect: MarkdownDialect,
    /// Fault injection for the existing feature panic-containment tests.
    #[cfg(test)]
    pub(super) test_features: Option<Features>,
    /// The Sub Theme the theme was resolved under (`tokens::theme_key`).
    theme_key: u64,
    pub(super) cache: Rc<RefCell<PipelineCache>>,
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
            dialect: MarkdownDialect::default(),
            #[cfg(test)]
            test_features: None,
            theme_key: crate::editor::tokens::theme_key(),
            cache: Rc::new(RefCell::new(PipelineCache::default())),
        }
    }

    /// The OpenKnowledge MDX dialect (project metadata or `.mdx` documents).
    pub fn mdx(mut self) -> Self {
        self.set_dialect(MarkdownDialect::OpenKnowledgeMdx);
        self
    }

    pub(super) fn features(&self) -> Features {
        #[cfg(test)]
        if let Some(features) = self.test_features {
            return features;
        }
        match self.dialect {
            MarkdownDialect::PuppyGfm => FEATURES,
            MarkdownDialect::OpenKnowledgeMdx => MDX_FEATURES,
        }
    }

    fn pipeline_input(&self) -> PipelineInput<'_> {
        PipelineInput {
            theme: &self.theme,
            scale: self.scale,
            theme_key: self.theme_key,
            live: self.live,
            preview: &self.preview,
            features: self.features(),
            assets: self.assets.as_ref(),
            references: self.references.as_ref(),
        }
    }

    /// Reconfigure presentation while retaining the editor's text and history.
    pub fn set_dialect(&mut self, dialect: MarkdownDialect) -> bool {
        if self.dialect == dialect {
            return false;
        }
        self.dialect = dialect;
        *self.cache.borrow_mut() = PipelineCache::default();
        self.preview.features = Default::default();
        self.preview.revealed_source = None;
        true
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

    pub(super) fn parse(&mut self, state: &EditorState) -> (Rc<Syntax>, Rc<Vec<Plan>>) {
        let mut cache = self.cache.borrow_mut();
        cache.ensure_parsed_in(state, &self.preview.features, self.features())
    }

    pub(super) fn heading_position(&mut self, state: &EditorState, key: &str) -> Option<usize> {
        let mut cache = self.cache.borrow_mut();
        cache.heading_position(state, &self.preview.features, self.features(), key)
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
            KeyBinding::new("secondary-d", ToggleStrike, c),
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
        let features = self.features();
        let provider: BoundaryProvider = Rc::new(move |doc, revision| {
            let live = live_flag.get();
            if let Some(rc) = cache.upgrade()
                && let Ok(mut borrow) = rc.try_borrow_mut()
                && let Some(p) = borrow.parsed.as_mut()
                && p.revision == revision
                && p.len == doc.len()
            {
                p.materialize_tail();
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
            if let Some(dialect) = eff.downcast_ref::<SetDialect>() {
                changed |= self.set_dialect(dialect.0);
            }
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
                let (syntax, plans) = self.parse(state);
                let before =
                    references_fingerprint(&state.doc, &syntax, &plans, self.references.as_ref());
                let after = references_fingerprint(&state.doc, &syntax, &plans, refs.0.as_ref());
                self.references = refs.0.clone();
                if before != after {
                    let next_epoch = self.cache.borrow().config_epoch.wrapping_add(1);
                    self.cache.borrow_mut().config_epoch = next_epoch;
                    changed = true;
                }
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

    fn filter_transaction(&self, tr: &mut Transaction, state: &EditorState, read_only: bool) {
        if !self.live || read_only || tr.event != UserEvent::Paste {
            return;
        }
        let changes = tr.changes.changes();
        if changes.len() != 1 {
            return;
        }
        let c = &changes[0];
        if !c.insert.contains(['\n', '\r', '|']) {
            return;
        }
        let mut cache = self.cache.borrow_mut();
        let (_, plans) = cache.ensure_parsed_in(state, &self.preview.features, self.features());
        let in_table_cell = plans.iter().any(|plan| {
            let Some(embed) = plan.embed().filter(|e| e.feature == features::table::ID) else {
                return false;
            };
            if c.range.start < plan.source.start || c.range.end > plan.source.end {
                return false;
            }
            let check_table = |table: &features::table::model::Table| {
                table.range.start <= c.range.start
                    && c.range.end <= table.range.end
                    && table.rows.iter().any(|row| {
                        row.cells.iter().any(|cell| {
                            cell.editable
                                && cell.range.start <= c.range.start
                                && c.range.end <= cell.range.end
                        })
                    })
            };
            if embed.built_for(&state.doc, plan.source.start)
                && let Some(table) = embed.model::<features::table::model::Table>()
            {
                check_table(table)
            } else {
                features::table::model::table_block(&state.doc, &plan.source)
                    .is_some_and(|table| check_table(&table))
            }
        });
        if !in_table_cell {
            return;
        }
        let sanitized = sanitize_table_cell_paste(&c.insert);
        if sanitized != c.insert {
            let range = c.range.clone();
            let cursor = range.start + sanitized.len();
            tr.changes = ChangeSet::replace(range, sanitized);
            tr.selection = Some(Selection::cursor(cursor));
        }
    }

    fn link_at(
        &mut self,
        state: &EditorState,
        offset: usize,
        release: bool,
    ) -> Option<LinkActivation> {
        self.link_activation(state, offset, release)
    }

    fn link_target(&mut self, state: &EditorState, href: &str) -> Option<LinkAction> {
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
            self.dialect,
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
        let cfg = self.pipeline_input();
        self.cache.borrow_mut().decorate_document(state, dark, &cfg)
    }

    fn decorate_reveal(&self, input: &DecorateInput, doc_layer: &Decorations) -> Rc<RevealLayer> {
        if !self.live || !self.preview.has_reveal_overrides() {
            return Rc::new(RevealLayer::empty());
        }
        let cfg = self.pipeline_input();
        self.cache
            .borrow_mut()
            .decorate_reveal(input, doc_layer, &cfg)
    }

    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        let doc_layer = self.decorate_document(input.state, input.dark);
        let reveal_layer = self.decorate_reveal(input, &doc_layer);
        if reveal_layer.is_empty() {
            let mut plain = (*doc_layer).clone();
            plain.materialize();
            plain.splice = None;
            return plain;
        }
        let layered = LayeredDecorations::new(doc_layer, reveal_layer);
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
        let features = self.features();
        self.cache
            .borrow_mut()
            .prepare_applied(applied, state, &self.preview.features, features);
    }

    fn applied(&mut self, applied: &Applied, state: &EditorState, focused: bool) {
        self.prepare_applied(applied, state);
        let features = self.features();
        let syntax = {
            let mut cache = self.cache.borrow_mut();
            if cache.pending_async.is_some()
                && !cache.adopt_pending_async(state, &self.preview.features, features, false)
            {
                return;
            }
            let head_line = state.doc.line_index(state.selection.head);
            let mut req = state.doc.line_range(head_line).end.saturating_add(1);
            if let Some(r) = &self.preview.reveal {
                let mapped_end = applied.changes.map(r.end, Assoc::After);
                req = req.max(mapped_end.saturating_add(1));
            }
            cache
                .ensure_parsed_covering(state, &self.preview.features, features, Some(req))
                .0
        };
        self.preview
            .applied(applied, state, &syntax, focused, self.read_only);
    }

    fn selection_changed(&mut self, state: &EditorState, focused: bool, pointer_selecting: bool) {
        let head_line = state.doc.line_index(state.selection.head);
        let req = state.doc.line_range(head_line).end.saturating_add(1);
        let features = self.features();
        let syntax = {
            let mut cache = self.cache.borrow_mut();
            cache
                .ensure_parsed_covering(state, &self.preview.features, features, Some(req))
                .0
        };
        self.preview
            .selection_changed(state, &syntax, focused, pointer_selecting, self.read_only);
    }

    fn normalize_selection(&mut self, state: &EditorState) -> Option<Selection> {
        if !self.live {
            return None;
        }
        let features = self.features();
        let syntax = {
            let mut cache = self.cache.borrow_mut();
            if cache.pending_async.is_some()
                && !cache.adopt_pending_async(state, &self.preview.features, features, false)
            {
                return None;
            }
            let head_line = state.doc.line_index(state.selection.head);
            let req = state.doc.line_range(head_line).end.saturating_add(1);
            cache
                .ensure_parsed_covering(state, &self.preview.features, features, Some(req))
                .0
        };
        self.preview.normalize(&state.doc, &syntax, state.selection)
    }

    /// `markdownEditingKeymap`: Markdown-aware Enter, deletion, indentation,
    /// and caret rules; `None` falls back to the default command.
    fn intercept(&mut self, intent: EditIntent, state: &EditorState) -> Option<Transaction> {
        if !self.live {
            return None;
        }
        // Revealed blocks share one source owner. Escape restores its preview
        // without changing the document, including in a read-only surface.
        if intent == EditIntent::Escape
            && let Some(range) = self.preview.revealed_source.take()
        {
            return Some(Transaction::select(Selection::cursor(
                state.doc.clamp(range.end),
            )));
        }
        let (syntax, plans) = self.parse(state);
        // Escape inside an active fenced code block keeps all typed text in the
        // canonical buffer and exits focus from the code block to restore its
        // resting decoration state.
        if intent == EditIntent::Escape {
            let from = state.selection.from();
            let to = state.selection.to();
            if let Some(block) = plans.iter().find_map(|p| {
                let code = p.embed()?.model::<features::code_block::CodeBlock>()?;
                (from <= code.range.end && to >= code.range.start).then_some(code)
            }) {
                let exit = if block.range.end < state.doc.len() {
                    let end_line = state.doc.line_index(block.range.end);
                    if end_line + 1 < state.doc.line_count() {
                        state.doc.line_range(end_line + 1).start
                    } else {
                        state.doc.len()
                    }
                } else {
                    block.range.start.saturating_sub(1)
                };
                return Some(Transaction::select(Selection::cursor(
                    state.doc.clamp(exit),
                )));
            }
        }
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

        let feature = contract::find(self.features(), command.feature())?;
        let mut preview_snapshot = self.preview.clone();
        if let Some(view_res) = contract::catch_feature_panic(feature.id(), "view_command", || {
            feature.view_command(command, &mut preview_snapshot, state)
        }) {
            self.preview = preview_snapshot;
            if let Some(tr) = view_res {
                return Some(tr);
            }
        }
        let features = self.features();
        let (syntax, plans) = self.cache.borrow_mut().refresh_shifted_plans_if_needed(
            state,
            &self.preview.features,
            features,
        );
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

/// Sanitize clipboard text pasted directly into an editable Markdown table cell
/// (`tableCommands.ts` `normalizeMarkdownTableCellInput` / `tableModel.ts`
/// `sanitizeMarkdownTableCell`): fold internal line-break runs into a single
/// space and escape unescaped pipes (`|`) as `\|` so the pipe table stays valid.
fn sanitize_table_cell_paste(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim_matches('\n');
    let mut folded = String::with_capacity(trimmed.len());
    let mut in_newline = false;
    for ch in trimmed.chars() {
        if ch == '\n' {
            if !in_newline {
                folded.push(' ');
            }
            in_newline = true;
        } else {
            in_newline = false;
            folded.push(ch);
        }
    }
    let mut out = String::with_capacity(folded.len());
    let mut backslashes = 0usize;
    for ch in folded.chars() {
        if ch == '\\' {
            backslashes += 1;
            out.push(ch);
        } else if ch == '|' {
            if backslashes.is_multiple_of(2) {
                out.push('\\');
            }
            backslashes = 0;
            out.push('|');
        } else {
            backslashes = 0;
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
impl MarkdownExtension {
    pub(crate) fn config_epoch_for_tests(&self) -> u64 {
        self.cache.borrow().config_epoch
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
