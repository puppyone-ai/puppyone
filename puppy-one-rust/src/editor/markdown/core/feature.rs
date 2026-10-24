//! The Markdown feature contract (core/features/markdownFeatureContract.ts).
//!
//! Each complex capability (code blocks, tables, rules, tasks, …) is a
//! vertical slice in `features/<name>/`: its model refinement, plan
//! compiler, decorations, widget, commands and style live together, and it
//! plugs into the pipeline only through this trait. The built-in list lives
//! in `markdown/composition.rs`; core never names a feature, and a feature
//! never imports composition, so dependencies run Composition → Feature →
//! core contracts.
//!
//! Every committed edit stays one editor transaction: widgets and hotspots
//! send `Command`s, which the owning feature turns into source changes.
use super::{
    decorations::{BlockDecoration, LineDecoration},
    plans::{BlockEmbed, Plan},
    syntax::{Element, Kind, Syntax},
};
use crate::editor::{
    markdown::style::MarkdownTheme,
    text::{
        buffer::Buffer,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::rc::Rc;

/// What plan compilation sees.
pub struct CompileCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
}

/// What a widget factory sees.
pub struct WidgetFactoryCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
    pub theme: &'a MarkdownTheme,
}

/// What a command sees.
pub struct CommandCx<'a> {
    pub state: &'a EditorState,
    pub syntax: &'a Syntax,
    pub plans: &'a [Plan],
}

pub trait MarkdownFeature: Sync {
    /// Stable identity (`Command::feature`, `BlockEmbed::feature`).
    fn id(&self) -> &'static str;

    /// Semantic element kinds this feature compiles (`semanticKinds`).
    fn semantic_kinds(&self) -> &'static [Kind] {
        &[]
    }

    /// The plan of one of its semantic elements (`compile`).
    fn compile_element(&self, _index: usize, _element: &Element, _cx: &CompileCx) -> Option<Plan> {
        None
    }

    /// Block plans the feature recognises beyond semantic elements
    /// (`collectBlock` + `compile`).
    fn compile_blocks(&self, _cx: &CompileCx, _out: &mut Vec<Plan>) {}

    /// The widget replacing one of its block plans (`createBlockWidget`).
    fn block_widget(&self, _embed: &BlockEmbed, _cx: &WidgetFactoryCx) -> Option<Rc<dyn BlockWidget>> {
        None
    }

    /// Decorations its block adds besides the widget (atomic source, the
    /// inline marks of text the widget shows).
    fn decorate_block(&self, _embed: &BlockEmbed, _cx: &mut BlockDecoration) {}

    /// Decorations it adds to a line box (overlays, hotspots).
    fn decorate_line(&self, _cx: &mut LineDecoration) {}

    /// A command from its widgets or hotspots.
    fn command(&self, _command: &Command, _cx: &CommandCx) -> Option<Transaction> {
        None
    }
}

/// The features of a pipeline, in composition order.
pub type Features = &'static [&'static dyn MarkdownFeature];

/// The feature with `id`.
pub fn find(features: Features, id: &str) -> Option<&'static dyn MarkdownFeature> {
    features.iter().copied().find(|f| f.id() == id)
}
