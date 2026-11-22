//! Read-only contexts passed from `core/` into `MarkdownFeature` callbacks.
use crate::editor::{
    markdown::{
        core::{plans::Plan, state::FeatureStateStore, syntax::Syntax},
        style::MarkdownTheme,
    },
    navigation::ReferenceContext,
    registry::DocumentAssets,
    text::{buffer::Buffer, state::EditorState},
    view::command::Command,
};

/// What plan compilation sees (`folds` carries the pane's [`FeatureStateStore`]
/// while keeping the field name expected by untouched feature unit tests).
pub struct CompileCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
    pub folds: &'a FeatureStateStore,
}

impl<'a> CompileCx<'a> {
    pub fn state<T: 'static>(&self, feature_id: &'static str) -> Option<&'a T> {
        self.folds.get::<T>(feature_id)
    }
}

/// What a block widget factory sees.
pub struct WidgetFactoryCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
    pub theme: &'a MarkdownTheme,
    /// Where the document's media resolve and load from.
    pub assets: Option<&'a DocumentAssets>,
    /// How wiki targets resolve (an embed's file by name).
    pub references: Option<&'a ReferenceContext>,
    /// Per-feature pane state store (`TA-40`).
    pub state: &'a FeatureStateStore,
}

impl<'a> WidgetFactoryCx<'a> {
    pub fn feature_state<T: 'static>(&self, feature_id: &'static str) -> Option<&'a T> {
        self.state.get::<T>(feature_id)
    }
}

/// Pure context passed to [`super::MarkdownFeature::inline_widget`] (`TA-30`, `TA-40`).
pub struct InlineWidgetCx<'a> {
    pub doc: &'a Buffer,
    pub theme: &'a MarkdownTheme,
    pub assets: Option<&'a DocumentAssets>,
    pub references: Option<&'a ReferenceContext>,
    pub state: &'a FeatureStateStore,
}

/// Declarative keybinding contributed by a feature (`TA-40`).
#[derive(Clone, Copy)]
pub struct FeatureKeybinding {
    pub chord: &'static str,
    pub command: fn() -> Command,
}

/// What a document command sees.
pub struct CommandCx<'a> {
    pub state: &'a EditorState,
    pub syntax: &'a Syntax,
    pub plans: &'a [Plan],
}
