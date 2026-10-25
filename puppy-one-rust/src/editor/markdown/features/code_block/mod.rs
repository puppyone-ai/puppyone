//! Fenced code blocks (product features/code-block): every fence is a block
//! widget showing its code lines in a highlighted panel; the fence lines
//! themselves are not caret positions while the block is rendered.
mod highlight;
pub mod style;
mod widget;

use crate::editor::{
    markdown::core::{
        decorations::BlockDecoration,
        feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan, Presentation},
    },
    view::widget::BlockWidget,
};
use std::{ops::Range, rc::Rc};
use widget::CodeBlockWidget;

pub struct CodeBlockFeature;
pub static FEATURE: CodeBlockFeature = CodeBlockFeature;
pub const ID: &str = "code-block";

/// A fenced code block (`codeBlockModel.ts`).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct CodeBlock {
    /// Opening line start to closing (or last) line end.
    pub range: Range<usize>,
    /// The code lines between the fences.
    pub code: Range<usize>,
    pub language: String,
}

impl MarkdownFeature for CodeBlockFeature {
    fn id(&self) -> &'static str {
        ID
    }

    /// `codeBlockPlan.ts`: every fence is a code block widget.
    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        for fence in &cx.syntax.fences {
            let block = CodeBlock {
                range: fence.range.clone(),
                code: fence.code.clone(),
                language: fence.language.clone(),
            };
            out.push(Plan {
                element: None,
                source: fence.range.clone(),
                presentation: Presentation::BlockAtom(BlockEmbed::new(ID, block)),
                delete_units: Vec::new(),
            });
        }
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
            cx.atomic(block.range.start..block.code.start);
            cx.atomic(block.code.end..block.range.end);
        }
    }
}
