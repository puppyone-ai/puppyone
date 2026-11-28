//! MDX components (product `features/mdx-component`), in `.mdx` documents
//! only (the Open Knowledge MDX dialect): tag/block scanning lives in
//! [`syntax`], declarative `<Tabs>` parsing & budgets in [`model`], block plan
//! compilation in [`plan`], per-pane tab state in [`state`], and UI in [`widget`].
pub mod model;
pub mod plan;
pub mod state;
pub mod syntax;
#[cfg(test)]
mod tests;
mod widget;

pub use model::{Tab, TabsBlock};
pub use state::{Action, TabsState};
pub use widget::{FirstTab, LastTab, NextTab, PreviousTab, TAB_KEY_CONTEXT};

use crate::editor::{
    markdown::core::{
        decorations::BlockDecoration,
        features::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan},
        state::PreviewState,
    },
    text::{
        buffer::Buffer,
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::{ops::Range, rc::Rc};
use widget::TabsWidget;

pub struct MdxFeature;
pub static FEATURE: MdxFeature = MdxFeature;
pub const ID: &str = "mdx-component";

impl MarkdownFeature for MdxFeature {
    fn id(&self) -> &'static str {
        ID
    }

    /// A component owns its lines, as the product's `MdxComponentBlock`
    /// node does: HTML never sees `<Tabs>` or a `<Tab>` line inside it.
    fn owns_block_lines(&self) -> bool {
        true
    }

    fn scan_block_delimiters(
        &self,
        doc: &Buffer,
        line_window: Range<usize>,
        code_lines: &[Range<usize>],
        out: &mut Vec<usize>,
    ) {
        syntax::scan_block_delimiters(doc, line_window, code_lines, out);
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        plan::compile_blocks(cx, out);
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        let block = embed.model::<TabsBlock>()?;
        let active = cx
            .feature_state::<TabsState>(ID)
            .map_or(0, |s| s.get(block.range.start));
        Some(Rc::new(TabsWidget::new(
            block.clone(),
            cx.theme,
            cx.assets.cloned(),
            active,
            cx.inline_preview,
        )))
    }

    /// The block is one caret position while it renders.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<TabsBlock>() {
            cx.atomic(block.range.clone());
        }
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let len = state.doc.len();
        match command.payload::<Action>()? {
            Action::Select { at, tab } => {
                preview
                    .state_mut::<TabsState>(ID)
                    .set(*at, *tab, state.revision);
                Some(Transaction::select(state.selection))
            }
            Action::ShowSource(range) => {
                preview.revealed_source = Some(range.start.min(len)..range.end.min(len));
                Some(Transaction::select(Selection::cursor(
                    (range.start + 1).min(range.end).min(len),
                )))
            }
        }
    }
}
