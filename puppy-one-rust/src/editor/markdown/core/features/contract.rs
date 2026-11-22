//! `MarkdownFeature` trait and composition-order lookup
//! (product `core/features/markdownFeatureContract.ts`).
use super::context::{CommandCx, CompileCx, FeatureKeybinding, InlineWidgetCx, WidgetFactoryCx};
use crate::editor::{
    markdown::core::{
        decorations::{BlockDecoration, InlineDecoration, LineDecoration},
        plans::{BlockEmbed, Plan},
        presentation::classes::Class,
        state::PreviewState,
        syntax::{Element, Kind},
    },
    text::{
        buffer::Buffer,
        state::{EditorState, Transaction},
    },
    view::{command::Command, decoration::InlineWidget, widget::BlockWidget},
};
use std::{ops::Range, rc::Rc};

pub trait MarkdownFeature: Sync {
    /// Stable identity (`Command::feature`, `BlockEmbed::feature`).
    fn id(&self) -> &'static str;

    /// Line-level inline syntax extension (`TA-30`, `TA-40`), e.g. `$formula$`
    /// in `features/math`. Called per non-code line or table cell; ranges are
    /// validated and clamped to `doc` boundaries (`TA-33`).
    fn recognize_inline(&self, _line_start: usize, _line_text: &str, _out: &mut Vec<Element>) {}

    /// Whether a recognized feature uses a fully enclosed code span as its
    /// own delimiter syntax. Other code intersections always suppress it.
    fn owns_inline_code(&self, _element: &Element, _code: &Element) -> bool {
        false
    }

    /// Block-level syntax extension (`TA-30`, `TA-40`), returning line ranges
    /// owned by feature blocks that suppress inner line-level inline scanning.
    fn recognize_blocks(
        &self,
        _doc: &Buffer,
        _code_lines: &[Range<usize>],
        _out: &mut Vec<Range<usize>>,
    ) {
    }

    /// Record byte offsets of multi-block delimiters inside `line_window`
    /// (`TA-30`–`TA-32`), allowing incremental plan compilation to detect
    /// straddling block constructs in `O(log N)` without naming features in `core/`.
    fn scan_block_delimiters(
        &self,
        _doc: &Buffer,
        _line_window: Range<usize>,
        _code_lines: &[Range<usize>],
        _out: &mut Vec<usize>,
    ) {
    }

    /// Whether its block plans own every line they cover, as the product's
    /// block parser consumes a component's lines before HTML sees them: a
    /// block plan a feature composed after it compiles wholly inside one is
    /// dropped.
    fn owns_block_lines(&self) -> bool {
        false
    }

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

    /// First-class [`InlineWidget`] and optional CSS [`Class`] for a feature's
    /// unrevealed inline element (`TA-12`, `TA-30`, `TA-40`).
    fn inline_widget(
        &self,
        _element: &Element,
        _plan: &Plan,
        _cx: &InlineWidgetCx,
    ) -> Option<(InlineWidget, Class)> {
        None
    }

    /// Decorations its block adds besides the widget (atomic source, the
    /// inline marks of text the widget shows).
    fn decorate_block(&self, _embed: &BlockEmbed, _cx: &mut BlockDecoration) {}

    /// Decorations it adds to a line box (overlays, hotspots).
    fn decorate_line(&self, _cx: &mut LineDecoration) {}

    /// Inline content inside a block widget (for example table cells).
    /// This context cannot replace the owning block or decorate a line box.
    fn decorate_inline_content(&self, _cx: &mut InlineDecoration) {}

    /// Declarative keymap contributions (`TA-40`).
    fn keybindings(&self) -> &'static [FeatureKeybinding] {
        &[]
    }

    /// A command from its widgets, keybindings or hotspots.
    fn command(&self, _command: &Command, _cx: &CommandCx) -> Option<Transaction> {
        None
    }

    /// A command that changes the pane's view state (a fold, zoom, tab, or
    /// revealed source) rather than the document (`TA-22`, `TA-40`).
    fn view_command(
        &self,
        _command: &Command,
        _preview: &mut PreviewState,
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
