//! Fenced code blocks (product `features/code-block`): every fence is a block
//! widget showing its code lines in a highlighted panel; the fence lines
//! themselves are not caret positions while the block is rendered.
#[cfg(test)]
pub(crate) mod highlight;
#[cfg(not(test))]
mod highlight;
pub mod layout;
pub mod model;
pub mod plan;
pub mod style;
mod widget;

pub use model::CodeBlock;

use crate::editor::{
    markdown::{
        core::{
            decorations::BlockDecoration,
            features::{CompileCx, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan},
        },
        shared::fence::fence_delimiter_ranges,
    },
    view::widget::BlockWidget,
};
use std::rc::Rc;
use widget::CodeBlockWidget;

pub struct CodeBlockFeature;
pub static FEATURE: CodeBlockFeature = CodeBlockFeature;
pub const ID: &str = "code-block";

impl MarkdownFeature for CodeBlockFeature {
    fn id(&self) -> &'static str {
        ID
    }

    /// `codeBlockPlan.ts`: every fence is a code block widget.
    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        plan::compile_blocks(cx, out);
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        Some(Rc::new(CodeBlockWidget::new(
            embed.model::<CodeBlock>()?,
            &cx.theme.code_block,
            &cx.theme.block,
        )))
    }

    /// The fences around the code text are not caret positions.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<CodeBlock>() {
            let (open, close) = fence_delimiter_ranges(&block.range, &block.code);
            cx.atomic(open);
            cx.atomic(close);
        }
    }
}
