//! Math (product features/math): `$formula$` inline and `$$` … `$$` or a
//! fence labelled `math` as a block. The product typesets with KaTeX; the
//! native editor shows the formula as Unicode text (`tex`), centred in the
//! block's panel, and the caret inside a block shows its source above it.
pub mod tex;
mod widget;

use crate::editor::{
    markdown::core::{
        decorations::BlockDecoration,
        feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan, Presentation},
    },
    text::buffer::Buffer,
    view::widget::BlockWidget,
};
use std::{ops::Range, rc::Rc};
use widget::MathBlockWidget;

pub struct MathFeature;
pub static FEATURE: MathFeature = MathFeature;
pub const ID: &str = "math";

/// A display formula (`MarkdownMathBlock`).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct MathBlock {
    /// Opening delimiter line start to closing line end.
    pub range: Range<usize>,
    /// The formula's source between the delimiters.
    pub content: Range<usize>,
    pub text: String,
}

/// `^\s{0,3}\$\$\s*$`.
fn delimiter(text: &str) -> bool {
    let lead = text.len() - text.trim_start_matches(' ').len();
    lead <= 3 && text.trim() == "$$"
}
/// `getMarkdownMathBlock`: `$$` lines around a formula that is not empty,
/// outside code.
fn blocks(doc: &Buffer, code_lines: &[Range<usize>]) -> Vec<MathBlock> {
    let in_code = |line: usize| code_lines.iter().any(|r| r.contains(&line));
    let mut out = Vec::new();
    let mut line = 0;
    let count = doc.line_count();
    while line < count {
        if in_code(line) || !delimiter(doc.line(line)) {
            line += 1;
            continue;
        }
        let Some(close) = (line + 1..count).find(|&l| delimiter(doc.line(l)) && !in_code(l)) else {
            break;
        };
        let content = doc.line_range(line).end + 1..doc.line_range(close).start.saturating_sub(1);
        let content = content.start..content.end.max(content.start);
        let source = doc.slice(content.clone());
        if !source.trim().is_empty() && !(line + 1..close).any(in_code) {
            out.push(MathBlock {
                range: doc.line_range(line).start..doc.line_range(close).end,
                content,
                text: tex::convert(source),
            });
        }
        line = close + 1;
    }
    out
}

impl MarkdownFeature for MathFeature {
    fn id(&self) -> &'static str {
        ID
    }

    /// `collectBlock`: `$$` blocks, and fences labelled `math` (which the
    /// code block feature, later in the composition, would otherwise own).
    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        let mut found = blocks(cx.doc, &cx.syntax.code_lines);
        for fence in &cx.syntax.fences {
            if fence.language.eq_ignore_ascii_case("math")
                && fence.info.trim().eq_ignore_ascii_case("math")
                && !cx.doc.slice(fence.code.clone()).trim().is_empty()
            {
                found.push(MathBlock {
                    range: fence.range.clone(),
                    content: fence.code.clone(),
                    text: tex::convert(cx.doc.slice(fence.code.clone())),
                });
            }
        }
        for block in found {
            out.push(Plan {
                element: None,
                source: block.range.clone(),
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
        Some(Rc::new(MathBlockWidget::new(
            embed.model::<MathBlock>()?,
            cx.theme,
        )))
    }

    /// The delimiters are not caret positions while the block is rendered.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<MathBlock>() {
            cx.atomic(block.range.start..block.content.start);
            cx.atomic(block.content.end..block.range.end);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn display_formulas_are_found_outside_code() {
        let doc = Buffer::new("a\n$$\nE = mc^2\n$$\n```\n$$\nx\n$$\n```\n$$\n\n$$\n");
        let syntax = crate::editor::markdown::core::syntax::Syntax::parse(&doc);
        let found = blocks(&doc, &syntax.code_lines);
        assert_eq!(found.len(), 1);
        assert_eq!(doc.slice(found[0].content.clone()), "E = mc^2");
        assert_eq!(found[0].text, "E = mc²");
    }
}
