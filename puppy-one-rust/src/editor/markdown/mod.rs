//! Native Markdown editor (product `src/shared-ui/editor/markdown`):
//! the Markdown source is the only document truth; syntax → plans and block
//! rhythm → decorations → the GPUI Kit based view (`editor::view`).
//!
//! - `core/`: the format pipeline (syntax, plans, decorations, state,
//!   commands) and the feature contract (`core/feature.rs`)
//! - `features/`: one vertical slice per capability (front matter, math,
//!   code block, table, rule, task, callout), each with its own style and
//!   widget
//! - `style/`: one typed style per element type, the line cascade and the
//!   inline mark mapping; every value is a product token
//! - `composition.rs`: the built-in features
pub mod composition;
pub mod core;
pub mod features;
mod navigation;
pub mod shared;
pub mod style;
#[cfg(test)]
mod tests;

use self::core::{
    commands,
    decorations::{self, DecorateCx},
    feature::{self as contract, CommandCx},
    plans::{self, Plan},
    presentation::block_rhythm,
    state::PreviewState,
    syntax::Syntax,
};
use crate::{
    editor::{
        text::{
            selection::Selection,
            state::{Applied, EditorState, Transaction},
        },
        view::{
            command::Command,
            decoration::Decorations,
            extension::{DecorateInput, EditIntent, EditorExtension},
        },
    },
    typography::Scale,
};
use composition::FEATURES;
use std::{
    hash::{Hash, Hasher},
    rc::Rc,
};
use style::MarkdownTheme;

struct Parsed {
    revision: u64,
    len: usize,
    syntax: Rc<Syntax>,
    /// The callout folds the plans were compiled with.
    folds: core::state::CalloutFolds,
    plans: Rc<Vec<Plan>>,
    headings: navigation::Headings,
}

pub struct MarkdownExtension {
    theme: MarkdownTheme,
    scale: Scale,
    reading_language: core::content_language::ReadingLanguage,
    /// Live preview (`false`: source mode).
    pub live: bool,
    pub read_only: bool,
    parsed: Option<Parsed>,
    preview: PreviewState,
    pub references: Option<crate::editor::navigation::ReferenceContext>,
    /// Where the document's media resolve and load from.
    pub assets: Option<crate::editor::registry::DocumentAssets>,
}

impl MarkdownExtension {
    pub fn new(dark: bool, scale: Scale) -> Self {
        Self {
            theme: MarkdownTheme::resolve(dark, scale),
            scale,
            reading_language: Default::default(),
            live: true,
            read_only: false,
            parsed: None,
            preview: PreviewState::default(),
            references: None,
            assets: None,
        }
    }

    /// Follow the app appearance; returns whether anything changed.
    pub fn set_appearance(&mut self, dark: bool, scale: Scale) -> bool {
        if self.theme.dark == dark && self.scale == scale {
            return false;
        }
        self.theme = MarkdownTheme::resolve(dark, scale);
        self.scale = scale;
        true
    }

    fn parse(&mut self, state: &EditorState) -> (Rc<Syntax>, Rc<Vec<Plan>>) {
        let folds = &self.preview.callout_folds;
        match &mut self.parsed {
            Some(p) if p.revision == state.revision && p.len == state.doc.len() => {
                // A callout folded or opened: the same syntax, new plans.
                if p.folds != *folds {
                    p.plans = Rc::new(plans::compile(&state.doc, &p.syntax, folds, FEATURES));
                    p.folds = folds.clone();
                }
                (p.syntax.clone(), p.plans.clone())
            }
            _ => {
                let syntax = Rc::new(Syntax::parse(&state.doc));
                let plans = Rc::new(plans::compile(&state.doc, &syntax, folds, FEATURES));
                self.parsed = Some(Parsed {
                    revision: state.revision,
                    len: state.doc.len(),
                    syntax: syntax.clone(),
                    folds: folds.clone(),
                    plans: plans.clone(),
                    headings: navigation::Headings::new(state.doc.as_str()),
                });
                (syntax, plans)
            }
        }
    }
}

impl EditorExtension for MarkdownExtension {
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
        self.link_action(href.trim(), false)
    }
    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        if input.dark != self.theme.dark {
            self.theme = MarkdownTheme::resolve(input.dark, self.scale);
        }
        let state = input.state;
        let han = self
            .reading_language
            .resolve(state.doc.as_str(), &crate::localization::current().code);
        self.theme.body.text.weight =
            crate::editor::tokens::Tokens::get(input.dark, self.scale).reading_weight(han);
        let (syntax, plans) = self.parse(state);
        let composing = self.preview.composing.map(|c| state.doc.line_index(c));
        let rhythm = block_rhythm(&state.doc, &syntax, composing);
        decorations::decorate(&DecorateCx {
            doc: &state.doc,
            syntax: &syntax,
            plans: &plans,
            rhythm: &rhythm,
            theme: &self.theme,
            preview: &self.preview,
            live: self.live,
            features: FEATURES,
            assets: self.assets.as_ref(),
            references: self.references.as_ref(),
        })
    }

    fn decoration_key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (
            self.preview.reveal.clone().map(|r| (r.start, r.end)),
            self.preview.composing,
            self.preview.selecting,
            self.preview.callout_title,
            &self.preview.callout_folds,
            self.preview
                .revealed_source
                .clone()
                .map(|r| (r.start, r.end)),
            self.live,
            self.scale as u8,
            crate::localization::current().code,
        )
            .hash(&mut h);
        h.finish()
    }

    fn applied(&mut self, applied: &Applied, state: &EditorState, focused: bool) {
        let (syntax, _) = self.parse(state);
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
        let (syntax, _) = self.parse(state);
        self.preview.normalize(&state.doc, &syntax, state.selection)
    }

    /// `markdownEditingKeymap`: Markdown-aware Enter, deletion, indentation,
    /// formatting and caret rules; `None` falls back to the default command.
    fn intercept(&mut self, intent: EditIntent, state: &EditorState) -> Option<Transaction> {
        if !self.live
            && !matches!(
                intent,
                EditIntent::Bold
                    | EditIntent::Italic
                    | EditIntent::Strike
                    | EditIntent::Code
                    | EditIntent::Underline
                    | EditIntent::Link
            )
        {
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

    /// Commands of feature widgets and hotspots, run by the owning feature.
    fn command(&mut self, command: &Command, state: &EditorState) -> Option<Transaction> {
        let feature = contract::find(FEATURES, command.feature())?;
        if let Some(tr) = feature.view_command(command, &mut self.preview, state) {
            return Some(tr);
        }
        let (syntax, plans) = self.parse(state);
        feature.command(
            command,
            &CommandCx {
                state,
                syntax: &syntax,
                plans: &plans,
            },
        )
    }
}
