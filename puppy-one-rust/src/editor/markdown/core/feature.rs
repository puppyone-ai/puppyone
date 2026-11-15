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
    /// The pane's callout folds (a folded body leaves the flow).
    pub folds: &'a super::state::CalloutFolds,
}

/// What a widget factory sees.
pub struct WidgetFactoryCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
    pub theme: &'a MarkdownTheme,
    /// Where the document's media resolve and load from.
    pub assets: Option<&'a crate::editor::registry::DocumentAssets>,
    /// How wiki targets resolve (an embed's file by name).
    pub references: Option<&'a crate::editor::navigation::ReferenceContext>,
    /// The pane's MDX tabs shown, by block start.
    pub tabs: &'a std::collections::BTreeMap<usize, usize>,
    /// The pane's diagram zoom and deferred renders.
    pub diagrams: &'a super::state::DiagramViews,
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
    fn block_widget(
        &self,
        _embed: &BlockEmbed,
        _cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
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

    /// A command that changes the pane's view state (a fold, a revealed
    /// source) rather than the document; the transaction (a caret, or the
    /// selection as it is) redraws the pane.
    fn view_command(
        &self,
        _command: &Command,
        _preview: &mut super::state::PreviewState,
        _state: &EditorState,
    ) -> Option<Transaction> {
        None
    }
}

/// The features of a pipeline, in composition order.
pub type Features = &'static [&'static dyn MarkdownFeature];

/// The feature with `id`.
pub fn find(features: Features, id: &str) -> Option<&'static dyn MarkdownFeature> {
    features.iter().copied().find(|f| f.id() == id)
}

/// Diagnostic event emitted when a feature panics at a pure pipeline boundary.
pub const FEATURE_PANIC_EVENT: &str = "[markdown-editor] feature panicked";

/// Isolates a pure `MarkdownFeature` callback (`compile_element`,
/// `compile_blocks`, `block_widget`). On panic, discards partial output and
/// logs one diagnostic per feature ID per process session.
pub fn catch_feature_panic<T>(
    feature: &'static str,
    stage: &'static str,
    work: impl FnOnce() -> T,
) -> Option<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)) {
        Ok(value) => Some(value),
        Err(payload) => {
            let message = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_owned())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "feature panicked".to_owned());
            report_feature_panic_once(feature, stage, &message);
            None
        }
    }
}

fn report_feature_panic_once(feature: &'static str, stage: &'static str, message: &str) {
    use std::{
        collections::HashSet,
        sync::{Mutex, OnceLock},
    };
    static REPORTED: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    let reported = REPORTED.get_or_init(|| Mutex::new(HashSet::new()));
    let first = reported
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(feature);
    if first {
        crate::platform::diagnostics::warn(
            FEATURE_PANIC_EVENT,
            serde_json::json!({
                "feature": feature,
                "stage": stage,
                "message": message,
            }),
        );
    }
}
