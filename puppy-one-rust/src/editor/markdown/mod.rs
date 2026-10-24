//! Native Markdown editor (product `packages/shared-ui/src/editor/markdown`):
//! the Markdown source is the only document truth; syntax → plans and block
//! rhythm → decorations → the GPUI Kit based view (`editor::view`).
//!
//! - `core/`: the format pipeline (syntax, plans, decorations, state,
//!   commands) and the feature contract (`core/feature.rs`)
//! - `features/`: one vertical slice per capability (code block, table,
//!   rule, task), each with its own style and widget
//! - `style/`: one typed style per element type, the line cascade and the
//!   inline mark mapping; every value is a product token
//! - `composition.rs`: the built-in features
pub mod composition;
pub mod core;
pub mod features;
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
use composition::FEATURES;
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
use std::{
    hash::{Hash, Hasher},
    rc::Rc,
};
use style::MarkdownTheme;

struct Parsed {
    revision: u64,
    len: usize,
    syntax: Rc<Syntax>,
    plans: Rc<Vec<Plan>>,
}

pub struct MarkdownExtension {
    theme: MarkdownTheme,
    scale: Scale,
    /// Live preview (`false`: source mode).
    pub live: bool,
    pub read_only: bool,
    parsed: Option<Parsed>,
    preview: PreviewState,
}

impl MarkdownExtension {
    pub fn new(dark: bool, scale: Scale) -> Self {
        Self { theme: MarkdownTheme::resolve(dark, scale), scale, live: true, read_only: false, parsed: None, preview: PreviewState::default() }
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
        match &self.parsed {
            Some(p) if p.revision == state.revision && p.len == state.doc.len() => (p.syntax.clone(), p.plans.clone()),
            _ => {
                let syntax = Rc::new(Syntax::parse(&state.doc));
                let plans = Rc::new(plans::compile(&state.doc, &syntax, FEATURES));
                self.parsed = Some(Parsed { revision: state.revision, len: state.doc.len(), syntax: syntax.clone(), plans: plans.clone() });
                (syntax, plans)
            }
        }
    }
}

impl EditorExtension for MarkdownExtension {
    fn decorate(&mut self, input: &DecorateInput) -> Decorations {
        if input.dark != self.theme.dark {
            self.theme = MarkdownTheme::resolve(input.dark, self.scale);
        }
        let state = input.state;
        let (syntax, plans) = self.parse(state);
        let composing = self.preview.composing.map(|c| state.doc.line_index(c));
        let rhythm = block_rhythm(&state.doc, &syntax, composing);
        decorations::decorate(&DecorateCx { doc: &state.doc, syntax: &syntax, plans: &plans, rhythm: &rhythm, theme: &self.theme, preview: &self.preview, live: self.live, features: FEATURES })
    }

    fn decoration_key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (self.preview.reveal.clone().map(|r| (r.start, r.end)), self.preview.composing, self.preview.selecting, self.live, self.scale as u8).hash(&mut h);
        h.finish()
    }

    fn applied(&mut self, applied: &Applied, state: &EditorState, focused: bool) {
        let (syntax, _) = self.parse(state);
        self.preview.applied(applied, state, &syntax, focused, self.read_only);
    }

    fn selection_changed(&mut self, state: &EditorState, focused: bool, pointer_selecting: bool) {
        let (syntax, _) = self.parse(state);
        self.preview.selection_changed(state, &syntax, focused, pointer_selecting, self.read_only);
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
        if !self.live && !matches!(intent, EditIntent::Bold | EditIntent::Italic | EditIntent::Strike | EditIntent::Code | EditIntent::Underline | EditIntent::Link) {
            return None;
        }
        let (syntax, plans) = self.parse(state);
        commands::intercept(intent, &commands::Cx { state, syntax: &syntax, plans: &plans, preview: &self.preview, read_only: self.read_only })
    }

    /// Commands of feature widgets and hotspots, run by the owning feature.
    fn command(&mut self, command: &Command, state: &EditorState) -> Option<Transaction> {
        let (syntax, plans) = self.parse(state);
        contract::find(FEATURES, command.feature())?.command(command, &CommandCx { state, syntax: &syntax, plans: &plans })
    }
}
