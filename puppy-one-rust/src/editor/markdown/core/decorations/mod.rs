//! Live-preview decorations (product `core/decorations/blockDecorations.ts` and
//! `inlineDecorations.ts`):
//! - **Document Layer** (`decorate`, `decorate_with_registry`, `decorate_incremental`, `TA-11`, `TA-32`):
//!   depends only on `(revision, dark, live, features, feature_state)` — never
//!   cursor/selection/focus. Supports `O(|touched|)` splicing across
//!   [`SyntaxSplice`] with `LazyBlockWidget` for off-screen shifted widgets
//!   and [`BlockSplice`] for incremental `HeightMap` updates (`TA-13`).
//! - **Reveal Layer** (`decorate_reveal`, `TA-11`): computes overrides only for
//!   the 0–3 line spans intersecting active reveal/composing/reveal-line ranges.
//! - **Unified `InlineWidget`** (`TA-12`) & **`BlockId` / `eq_widget` reuse** (`TA-14`).
mod block;
mod builder;
mod incremental;
mod inline;
mod lines;
mod marks;
mod reveal;

pub use block::{LazyEnvSlot, LazyWidgetEnv};
pub use builder::{BlockDecoration, InlineDecoration, LineDecoration};
pub use incremental::{decorate_incremental, decorate_incremental_in_place};
pub use reveal::{decorate_reveal, decorate_reveal_with_fallbacks};

use super::{
    features::Features, plans::Plan, presentation::LineRhythm, state::PreviewState, syntax::Syntax,
};
use crate::editor::{
    markdown::style::MarkdownTheme,
    navigation::ReferenceContext,
    registry::DocumentAssets,
    text::buffer::Buffer,
    view::{
        decoration::{Block, Decorations, Surface},
        widget::{BlockId, BlockIdRegistry, BlockWidget},
    },
};
use block::decorate_window;
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};

pub struct DecorateCx<'a> {
    pub doc: &'a Buffer,
    pub syntax: &'a Syntax,
    pub plans: &'a [Plan],
    pub rhythm: &'a [LineRhythm],
    pub theme: &'a MarkdownTheme,
    pub preview: &'a PreviewState,
    pub live: bool,
    pub features: Features,
    /// Where the document's media resolve and load from.
    pub assets: Option<&'a DocumentAssets>,
    /// The workspace's link graph (Obsidian embeds resolve by name).
    pub references: Option<&'a ReferenceContext>,
    /// Isolated fragment preview port injected by `composition::preview` (`MA-07`, `R13`).
    pub inline_preview:
        Option<&'static dyn crate::editor::markdown::shared::preview::InlinePreview>,
}

/// The surface of `.markdown-codemirror-editor` / `.cm-content`.
pub fn surface(theme: &MarkdownTheme) -> Surface {
    let s = &theme.surface;
    Surface {
        content: s.insets(),
        max_text_width: Some(s.text_width),
        background: s.background,
        selection: s.selection,
        selection_inactive: s.selection_inactive,
        caret: s.caret,
        caret_width: 1.,
        link: theme.inline.link_color,
        inline_code: theme.inline.code_color,
        inline_code_background: Some(theme.inline.code_background),
        inline_code_padding: Some(theme.inline.code_padding.left),
        // `.cm-md-syntax-link` has no text decoration.
        link_plain: true,
    }
}

pub fn decorate(cx: &DecorateCx) -> Decorations {
    let win = decorate_window(cx, 0..cx.doc.line_count(), 0, None, 0, None, None);
    Decorations {
        id: crate::editor::view::decoration::next_decorations_id(),
        blocks: win.blocks,
        marks: win.marks,
        hidden: win.hidden,
        atomic: win.atomic,
        inline_widgets: win.inline_widgets,
        underlines: win.underlines,
        surface: surface(cx.theme),
        splice: None,
        ..Default::default()
    }
}

pub fn decorate_with_registry(
    cx: &DecorateCx,
    registry: &mut BlockIdRegistry,
    revision: u64,
    prev_widgets: &HashMap<BlockId, Rc<dyn BlockWidget>>,
) -> Decorations {
    let win = decorate_window(
        cx,
        0..cx.doc.line_count(),
        0,
        Some(registry),
        revision,
        Some(prev_widgets),
        None,
    );
    let live_ids: HashSet<BlockId> = win
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Widget { id, .. } => Some(*id),
            Block::Line { .. } => None,
        })
        .collect();
    registry.retain_live(&live_ids);
    Decorations {
        id: crate::editor::view::decoration::next_decorations_id(),
        blocks: win.blocks,
        marks: win.marks,
        hidden: win.hidden,
        atomic: win.atomic,
        inline_widgets: win.inline_widgets,
        underlines: win.underlines,
        surface: surface(cx.theme),
        splice: None,
        ..Default::default()
    }
}
