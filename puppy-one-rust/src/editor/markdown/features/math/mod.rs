//! Math (product `features/math`, `TA-30`, `TA-40`): `$formula$` inline and
//! `$$` … `$$` or a fence labelled `math` as a block. Inline math recognition,
//! TeX-to-Unicode fallback (`tex::convert`), and inline KaTeX `InlineWidget`
//! construction all live here in `features/math` rather than in `core/`.
pub mod tex;
pub(crate) mod widget;

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
// The product's rich-preview budget is measured in JS UTF-16 code units,
// independently of the raster service's byte and image-size limits.
const MAX_RICH_SOURCE_UNITS: usize = 32 * 1024;

fn source_diagnostic(source: &str) -> Option<&'static str> {
    if source.trim().is_empty() {
        Some("math.empty-source")
    } else if source
        .encode_utf16()
        .take(MAX_RICH_SOURCE_UNITS + 1)
        .count()
        > MAX_RICH_SOURCE_UNITS
    {
        Some("math.source-too-large")
    } else {
        None
    }
}

/// A display formula (`MarkdownMathBlock`).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct MathBlock {
    /// Opening delimiter line start to closing line end.
    pub range: Range<usize>,
    /// The formula's source between the delimiters.
    pub content: Range<usize>,
    /// The Unicode rendering shown until the typeset formula arrives.
    pub text: String,
    /// The TeX source KaTeX typesets.
    pub source: String,
}

fn escaped(bytes: &[u8], at: usize) -> bool {
    bytes[..at]
        .iter()
        .rev()
        .take_while(|b| **b == b'\\')
        .count()
        % 2
        == 1
}

/// `$formula$` on one line (`scanInlineMath`): no `$$`, no space just inside
/// either `$`, and not a price range such as `$5-$10`.
fn scan_inline_math(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let space = |i: usize| bytes.get(i).is_none_or(|b| b.is_ascii_whitespace());
    let mut out = Vec::new();
    let mut open = 0;
    while open < bytes.len() {
        if bytes[open] != b'$'
            || bytes.get(open + 1) == Some(&b'$')
            || escaped(bytes, open)
            || space(open + 1)
        {
            open += 1;
            continue;
        }
        let mut next = open;
        let mut close = open + 1;
        while close < bytes.len() {
            if bytes[close] != b'$' || escaped(bytes, close) {
                close += 1;
                continue;
            }
            if bytes[close - 1] == b'$'
                || bytes.get(close + 1) == Some(&b'$')
                || bytes[close - 1].is_ascii_whitespace()
            {
                next = if bytes.get(close + 1) == Some(&b'$') {
                    close + 1
                } else {
                    close - 1
                };
                break;
            }
            let source = &text[open + 1..close];
            let currency = bytes.get(close + 1).is_some_and(u8::is_ascii_digit)
                && source
                    .trim_start_matches(['+', '-'])
                    .trim_end_matches(['-', '–', '—'])
                    .chars()
                    .all(|c| c.is_ascii_digit() || c == ',' || c == '.')
                && source
                    .trim_start_matches(['+', '-'])
                    .starts_with(|c: char| c.is_ascii_digit());
            if !currency {
                out.push((open, close));
            }
            next = close;
            break;
        }
        open = next.max(open) + 1;
    }
    out
}

/// `^\s{0,3}\$\$\s*$`.
fn delimiter(text: &str) -> bool {
    let lead = text.len() - text.trim_start_matches(' ').len();
    lead <= 3 && text.trim() == "$$"
}

/// `getMarkdownMathBlock`: `$$` lines around a formula that is not empty,
/// outside code, bounded to `line_bounds` (`TA-32` incremental compilation).
fn blocks_in_range(
    doc: &Buffer,
    code_lines: &[Range<usize>],
    line_bounds: Range<usize>,
) -> Vec<MathBlock> {
    let in_code = |line: usize| {
        let i = code_lines.partition_point(|r| r.end <= line);
        code_lines.get(i).is_some_and(|r| r.start <= line)
    };
    let mut out = Vec::new();
    let mut line = line_bounds.start;
    let count = line_bounds.end.min(doc.line_count());
    while line < count {
        if in_code(line) || !delimiter(&doc.line_cow(line)) {
            line += 1;
            continue;
        }
        let Some(close) = (line + 1..count).find(|&l| delimiter(&doc.line_cow(l)) && !in_code(l))
        else {
            break;
        };
        let content = doc.line_range(line).end + 1..doc.line_range(close).start.saturating_sub(1);
        let content = content.start..content.end.max(content.start);
        let source_cow = doc.slice_cow(content.clone());
        let source = source_cow.as_ref();
        let fence_inside = {
            let a = code_lines.partition_point(|r| r.end <= line + 1);
            code_lines.get(a).is_some_and(|r| r.start < close)
        };
        if !source.trim().is_empty() && !fence_inside {
            out.push(MathBlock {
                range: doc.line_range(line).start..doc.line_range(close).end,
                content,
                text: tex::convert(source),
                source: source.to_owned(),
            });
        }
        line = close + 1;
    }
    out
}

#[cfg(test)]
fn blocks(doc: &Buffer, code_lines: &[Range<usize>]) -> Vec<MathBlock> {
    blocks_in_range(doc, code_lines, 0..doc.line_count())
}

impl MarkdownFeature for MathFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn recognize_inline(&self, line_start: usize, line_text: &str, out: &mut Vec<Element>) {
        if !line_text.contains('$') {
            return;
        }
        for (open, close) in scan_inline_math(line_text) {
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
            if delimiter(&doc.line_cow(line)) {
                out.push(doc.line_range(line).start);
            }
        }
    }

    fn semantic_kinds(&self) -> &'static [Kind] {
        KINDS
    }

    fn compile_element(&self, index: usize, element: &Element, cx: &CompileCx) -> Option<Plan> {
        let source = cx.doc.slice_cow(element.content.clone()?);
        let presentation = match source_diagnostic(&source) {
            Some(code) => Presentation::SourceFallback { code },
            None => Presentation::InlineAtom(Atom::Text(element.text.clone()?)),
        };
        Some(Plan {
            element: Some(index),
            source: element.range.clone(),
            presentation,
            delete_units: Vec::new(),
        })
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
        use crate::editor::markdown::platform::render::{
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
        let line_bounds = match (cx.syntax.top_blocks.first(), cx.syntax.top_blocks.last()) {
            (Some(first), Some(last)) => {
                cx.doc.line_index(first.start)..cx.doc.line_index(last.end) + 1
            }
            _ => 0..0,
        };
        let mut found = blocks_in_range(cx.doc, &cx.syntax.code_lines, line_bounds);
        for fence in &cx.syntax.fences {
            if fence.language.eq_ignore_ascii_case("math")
                && fence.info.trim().eq_ignore_ascii_case("math")
            {
                let code_cow = cx.doc.slice_cow(fence.code.clone());
                if !code_cow.trim().is_empty() {
                    found.push(MathBlock {
                        range: fence.range.clone(),
                        content: fence.code.clone(),
                        text: tex::convert(&code_cow),
                        source: code_cow.into_owned(),
                    });
                }
            }
        }
        for block in found {
            out.push(Plan {
                element: None,
                source: block.range.clone(),
                presentation: match source_diagnostic(&block.source) {
                    Some(code) => Presentation::SourceFallback { code },
                    None => Presentation::BlockAtom(BlockEmbed::new(ID, block)),
                },
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
            core::{plans, state::CalloutFolds, syntax::Syntax},
        };
        for formula in [r"x^{\", r"\frac{\", r"\sqrt{\", r"\mathbb{\"] {
            for doc_text in [
                format!("$$\n{formula}\n$$\n"),
                format!("```math\n{formula}\n```\n"),
                format!("```math\n{formula}"),
            ] {
                let doc = Buffer::new(&doc_text);
                let syntax = Syntax::parse_with(&doc, FEATURES);
                let compiled = plans::compile(&doc, &syntax, &CalloutFolds::default(), FEATURES);
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
