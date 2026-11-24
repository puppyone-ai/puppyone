//! Math (product `features/math`, `TA-30`, `TA-40`): `$formula$` inline and
//! `$$` … `$$` or a fence labelled `math` as a block. Inline math recognition
//! lives in [`syntax`], model/budget validation in [`model`], plan compilation
//! in [`plan`], TeX-to-Unicode fallback in [`tex`], and block widget in [`widget`].
pub mod model;
pub mod plan;
pub mod syntax;
pub mod tex;
pub(crate) mod widget;

pub use model::MathBlock;

use crate::editor::{
    markdown::core::{
        decorations::BlockDecoration,
        features::{CompileCx, InlineWidgetCx, MarkdownFeature, WidgetFactoryCx},
        plans::{Atom, BlockEmbed, Plan, Presentation},
        presentation::classes::Class,
        syntax::{Element, Kind},
    },
    text::buffer::Buffer,
    view::{
        decoration::{InlineImage, InlineWidget},
        widget::BlockWidget,
    },
};
use std::{ops::Range, rc::Rc};
use widget::MathBlockWidget;

pub struct MathFeature;
pub static FEATURE: MathFeature = MathFeature;
pub const ID: &str = "math";
const KINDS: &[Kind] = &[Kind::FeatureInline(ID)];

#[cfg(test)]
fn blocks(doc: &Buffer, code_lines: &[Range<usize>]) -> Vec<MathBlock> {
    syntax::blocks_in_range(doc, code_lines, 0..doc.line_count())
}

impl MarkdownFeature for MathFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn recognize_inline(&self, line_start: usize, line_text: &str, out: &mut Vec<Element>) {
        if !line_text.contains('$') {
            return;
        }
        for (open, close) in syntax::scan_inline_math(line_text) {
            let (from, to) = (line_start + open, line_start + close + 1);
            let raw = &line_text[open + 1..close];
            let backtick = raw
                .strip_prefix('`')
                .and_then(|s| s.strip_suffix('`'))
                .filter(|s| !s.is_empty() && !s.contains('`'));
            let delimiter_len = if backtick.is_some() { 2 } else { 1 };
            let mut e = Element::new(
                Kind::FeatureInline(ID),
                from..to,
                vec![from..from + delimiter_len, to - delimiter_len..to],
                Some(from + delimiter_len..to - delimiter_len),
            );
            e.text = Some(tex::convert(backtick.unwrap_or(raw)));
            out.push(e);
        }
    }

    fn owns_inline_code(&self, element: &Element, code: &Element) -> bool {
        element.content == code.content
            && code.range == (element.range.start + 1..element.range.end - 1)
            && element.markers.first().is_some_and(|m| m.len() == 2)
    }

    fn scan_block_delimiters(
        &self,
        doc: &Buffer,
        line_window: Range<usize>,
        code_lines: &[Range<usize>],
        out: &mut Vec<usize>,
    ) {
        let mut code_idx = code_lines.partition_point(|r| r.end <= line_window.start);
        let end = line_window.end.min(doc.line_count());
        for line in line_window.start..end {
            while code_idx < code_lines.len() && code_lines[code_idx].end <= line {
                code_idx += 1;
            }
            if code_idx < code_lines.len() && code_lines[code_idx].contains(&line) {
                continue;
            }
            if syntax::is_display_delimiter(&doc.line_cow(line)) {
                out.push(doc.line_range(line).start);
            }
        }
    }

    fn semantic_kinds(&self) -> &'static [Kind] {
        KINDS
    }

    fn compile_element(&self, index: usize, element: &Element, cx: &CompileCx) -> Option<Plan> {
        plan::compile_element(index, element, cx)
    }

    fn inline_widget(
        &self,
        element: &Element,
        plan: &Plan,
        cx: &InlineWidgetCx,
    ) -> Option<(InlineWidget, Class)> {
        let Presentation::InlineAtom(Atom::Text(fallback)) = &plan.presentation else {
            return None;
        };
        use crate::editor::markdown::platform::brokers::render::{
            self as render_broker, Kind as RenderKind, Request, hex,
        };
        let range = cx.doc.clamp_range(element.range.clone());
        let formula = cx.doc.slice_cow(element.content.clone()?);
        let t = crate::editor::tokens::Tokens::get(cx.theme.dark, cx.theme.scale);
        let editor_bg = t.color("--po-editor-bg");
        let request = Request {
            kind: RenderKind::Math {
                display: false,
                color: hex(t.color("--po-md-content-color")),
                font_size: t.len("--po-md-math-inline-font-size", 15.),
            },
            source: formula.into_owned(),
            background: hex(editor_bg),
            scale: 1.,
        };
        let image = InlineImage {
            range: range.clone(),
            pad: 0.08,
            radius: 0.,
            element: None,
            draw: Rc::new(move |line, _, _, window, app| {
                let mut request = request.clone();
                if let Some(line) = line {
                    request.background = hex(crate::editor::tokens::over(line, editor_bg));
                }
                match render_broker::get(&request, window, app) {
                    render_broker::State::Ready(drawn) => Some(drawn),
                    _ => None,
                }
            }),
        };
        Some((
            InlineWidget::image(range, fallback.clone(), image),
            Class::MATH,
        ))
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        plan::compile_blocks(cx, out);
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

    #[test]
    fn incomplete_groups_in_display_and_math_fences_stay_displayable() {
        use crate::editor::markdown::{
            composition::FEATURES,
            core::{plans, state::FeatureStateStore, syntax::Syntax},
        };
        for formula in [r"x^{\", r"\frac{\", r"\sqrt{\", r"\mathbb{\"] {
            for doc_text in [
                format!("$$\n{formula}\n$$\n"),
                format!("```math\n{formula}\n```\n"),
                format!("```math\n{formula}"),
            ] {
                let doc = Buffer::new(&doc_text);
                let syntax = Syntax::parse_with(&doc, FEATURES);
                let compiled =
                    plans::compile(&doc, &syntax, &FeatureStateStore::default(), FEATURES);
                let blocks: Vec<&MathBlock> = compiled
                    .iter()
                    .filter_map(|p| p.embed()?.model::<MathBlock>())
                    .collect();
                assert_eq!(blocks.len(), 1, "expected 1 math block for {doc_text:?}");
                assert!(
                    !blocks[0].text.is_empty(),
                    "expected displayable text for {doc_text:?}"
                );
            }
        }
    }
}
