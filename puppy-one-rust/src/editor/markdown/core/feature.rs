//! The Markdown feature contract (`TA-30`, `TA-33`, `TA-40`,
//! `core/features/markdownFeatureContract.ts`).
//!
//! Each capability is a vertical slice in `features/<name>/` and plugs into the
//! pipeline exclusively through [`MarkdownFeature`]:
//! - Syntax extensions (`recognize_inline`, `recognize_blocks`) producing
//!   feature-owned `Kind::FeatureInline(id)` / `Kind::FeatureBlock(id)` elements
//! - Plan compilation (`compile_element`, `compile_blocks`)
//! - Typed per-feature state slots in [`super::state::FeatureStateStore`]
//! - Block widgets (`block_widget`) and first-class inline widgets
//!   (`inline_widget`)
//! - Document commands (`command`), view commands (`view_command`), and keymap
//!   contributions (`keybindings`).
//!
//! Note: this module is pure (`R10`: zero `gpui` references).
use super::{
    classes::Class,
    decorations::{BlockDecoration, LineDecoration},
    plans::{BlockEmbed, Plan},
    state::{FeatureStateStore, PreviewState},
    syntax::{Element, Kind, Syntax},
};
use crate::editor::{
    markdown::style::MarkdownTheme,
    text::{
        buffer::Buffer,
        state::{EditorState, Transaction},
    },
    view::{command::Command, decoration::InlineWidget, widget::BlockWidget},
};
use std::{ops::Range, rc::Rc};

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
    pub assets: Option<&'a crate::editor::registry::DocumentAssets>,
    /// How wiki targets resolve (an embed's file by name).
    pub references: Option<&'a crate::editor::navigation::ReferenceContext>,
    /// Per-feature pane state store (`TA-40`).
    pub state: &'a FeatureStateStore,
}

impl<'a> WidgetFactoryCx<'a> {
    pub fn feature_state<T: 'static>(&self, feature_id: &'static str) -> Option<&'a T> {
        self.state.get::<T>(feature_id)
    }
}

/// Pure context passed to [`MarkdownFeature::inline_widget`] (`TA-30`, `TA-40`).
pub struct InlineWidgetCx<'a> {
    pub doc: &'a Buffer,
    pub theme: &'a MarkdownTheme,
    pub assets: Option<&'a crate::editor::registry::DocumentAssets>,
    pub references: Option<&'a crate::editor::navigation::ReferenceContext>,
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

pub trait MarkdownFeature: Sync {
    /// Stable identity (`Command::feature`, `BlockEmbed::feature`).
    fn id(&self) -> &'static str;

    /// Line-level inline syntax extension (`TA-30`, `TA-40`), e.g. `$formula$`
    /// in `features/math`. Called per non-code/non-table line; ranges are
    /// validated and clamped to `doc` boundaries (`TA-33`).
    fn recognize_inline(&self, _line_start: usize, _line_text: &str, _out: &mut Vec<Element>) {}

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

/// Diagnostic event emitted when a feature panics at a pipeline boundary.
pub const FEATURE_PANIC_EVENT: &str = "[markdown-editor] feature panicked";

/// Isolates a `MarkdownFeature` callback (`recognize_inline`, `recognize_blocks`,
/// `compile_element`, `compile_blocks`, `block_widget`, `inline_widget`,
/// `decorate_block`, `decorate_line`, `view_command`, `command`, `TA-33`).
/// On panic, discards partial output and logs one diagnostic per feature ID per
/// process session.
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
