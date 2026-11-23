//! Inline HTML runs (product `htmlRunWidget.ts`, `compileInlineHtmlRunPlan`):
//! a balanced stretch of inline HTML the inline-editable profile cannot
//! style (an image, a theme picture, a passive element such as `<font>` or
//! `<meter>`, an HTML block sharing its line with a list or quote marker)
//! shows as what it renders, and its exact source as soon as the caret
//! touches it.
//!
//! A run that fills its lines (apart from list and quote markers) is drawn by
//! the HTML surface in place of the lines' text; one that shares its line
//! with Markdown keeps that text ordinary: its tags hide, its images draw in
//! the text and its elements style the text between the tags.
use super::{
    block::admission_failure,
    sanitize::Node,
    structure::{self, Parsed},
};
use crate::editor::{
    markdown::{
        core::{
            decorations::{ClassSpan, InlineDecoration, LineDecoration},
            features::CompileCx,
            plans::{Atom, Plan, Presentation},
            syntax::{Element, Kind},
        },
        platform::brokers::embed::external_iframe_href,
    },
    registry::DocumentAssets,
    text::buffer::Buffer,
    view::{decoration::InlineImage, style::Embed},
};
use gpui::SharedString;
use std::{
    hash::{Hash, Hasher},
    ops::Range,
    rc::Rc,
};

/// The x-height of the body face, in ems (`vertical-align: middle`).
const X_HEIGHT: f32 = 0.5;

/// The sanitized nodes a run renders, or why it stays source
/// (`compileInlineHtmlRunPlan`: the HTML block policy and structure).
pub fn admit(source: &str) -> Result<Vec<Node>, &'static str> {
    if external_iframe_href(source).is_some() {
        return Err("htmlBlock.inline-embed");
    }
    match structure::parse(source) {
        Parsed::Complete(nodes) => match admission_failure(source, &nodes) {
            Some(code) => Err(code),
            None => Ok(nodes),
        },
        Parsed::Incomplete(_) => Err("htmlBlock.incomplete"),
        Parsed::Malformed => Err("htmlBlock.malformed"),
        Parsed::Unsupported => Err("htmlBlock.unsupported"),
    }
}

/// Whether drawing `nodes` needs the document's asset broker.
pub fn has_media(nodes: &[Node]) -> bool {
    nodes.iter().any(|n| match n {
        Node::Element(e) => {
            matches!(
                e.tag.as_str(),
                "img" | "picture" | "audio" | "video" | "source"
            ) || has_media(&e.children)
        }
        Node::Text(_) => false,
    })
}

/// The plan of a run: drawn whole (no collapsed delete unit, so deletion
/// edits the revealed text one character at a time), or its exact source.
pub fn compile(index: usize, e: &Element, _cx: &CompileCx) -> Option<Plan> {
    let source = e.text.as_deref()?;
    Some(Plan {
        element: Some(index),
        source: e.range.clone(),
        presentation: match admit(source) {
            Ok(_) => Presentation::InlineAtom(Atom::Text(source.to_owned())),
            Err(code) => Presentation::SourceFallback { code },
        },
        delete_units: Vec::new(),
    })
}

/// The runs drawn in `range` (not revealed, admitted, and with their media
/// brokered), each with its nodes.
fn drawn_runs<'s>(
    syntax: &'s crate::editor::markdown::core::syntax::Syntax,
    range: Range<usize>,
    reveal: Option<&Range<usize>>,
    assets: Option<&DocumentAssets>,
) -> Vec<(&'s Element, Vec<Node>)> {
    syntax
        .elements_in(range.clone())
        .filter(|e| {
            e.kind == Kind::HtmlRun && e.range.start < range.end && e.range.end > range.start
        })
        .filter(|e| reveal != Some(&e.range))
        .filter_map(|e| {
            let nodes = admit(e.text.as_deref()?).ok()?;
            (assets.is_some() || !has_media(&nodes)).then_some((e, nodes))
        })
        .collect()
}

/// Whether `run` fills every line it touches: before it only list, quote or
/// task markers, after it nothing.
fn fills_lines(doc: &Buffer, run: &Range<usize>) -> bool {
    let first = doc.line_range(doc.line_index(run.start));
    let last = doc.line_range(doc.line_index(run.end.saturating_sub(1).max(run.start)));
    let before = doc.slice_cow(first.start..run.start);
    let after = doc.slice_cow(run.end.min(last.end)..last.end);
    after.trim().is_empty() && is_marker_prefix(&before)
}

/// Whitespace, quote markers, one list marker and one task box.
fn is_marker_prefix(text: &str) -> bool {
    let mut rest = text.trim_start();
    while let Some(after) = rest.strip_prefix('>') {
        rest = after.trim_start();
    }
    if let Some(after) = rest.strip_prefix(['-', '*', '+']) {
        rest = after;
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if (1..=9).contains(&digits)
            && let Some(after) = rest[digits..].strip_prefix(['.', ')'])
        {
            rest = after;
        }
    }
    rest = rest.trim_start();
    for task in ["[ ]", "[x]", "[X]"] {
        if let Some(after) = rest.strip_prefix(task) {
            rest = after.trim_start();
        }
    }
    rest.is_empty()
}

mod decompose;
mod embed;

use decompose::decompose;
pub use decompose::{picture_candidates, picture_source};
use embed::{Collapsed, RunEmbed};

/// Where a run's decomposed pieces go.
struct Sink<'a> {
    hidden: &'a mut Vec<Range<usize>>,
    replaced: &'a mut Vec<(Range<usize>, SharedString)>,
    images: &'a mut Vec<InlineImage>,
    spans: &'a mut Vec<ClassSpan>,
    colors: &'a mut Vec<(Range<usize>, Option<u32>, Option<u32>)>,
}

/// `decorate_line`: runs on this line, drawn in place of the line's text
/// when they fill it, else in its text.
pub fn decorate_line(cx: &mut LineDecoration) {
    let line = cx.range.clone();
    for (run, nodes) in drawn_runs(
        cx.syntax,
        line.clone(),
        cx.preview.reveal.as_ref(),
        cx.assets,
    ) {
        if fills_lines(cx.doc, &run.range) {
            let shown = run.range.start.max(line.start)..run.range.end.min(line.end);
            cx.hidden.push(shown);
            let first = cx.doc.line_index(run.range.start) == cx.doc.line_index(line.start);
            let mut h = std::hash::DefaultHasher::new();
            (run.range.start, first, cx.theme.dark).hash(&mut h);
            super::sanitize::hash_nodes(&nodes, &mut h);
            cx.style.embed = Some(Embed {
                key: h.finish(),
                content: if first {
                    Rc::new(RunEmbed {
                        range: run.range.clone(),
                        nodes,
                        theme: cx.theme.clone(),
                        assets: cx.assets.cloned(),
                    })
                } else {
                    Rc::new(Collapsed)
                },
            });
        } else {
            let mut sink = Sink {
                hidden: cx.hidden,
                replaced: cx.replaced,
                images: cx.inline_images,
                spans: cx.spans,
                colors: cx.colors,
            };
            decompose(cx.doc, run, line.clone(), cx.theme, cx.assets, &mut sink);
        }
    }
}

/// `decorate_inline_content`: runs in text a widget shows (table cells).
pub fn decorate_inline(cx: &mut InlineDecoration) {
    let range = cx.range.clone();
    for (run, _) in drawn_runs(
        cx.syntax,
        range.clone(),
        cx.preview.reveal.as_ref(),
        cx.assets,
    ) {
        let mut sink = Sink {
            hidden: cx.hidden,
            replaced: cx.replaced,
            images: cx.inline_images,
            spans: cx.spans,
            colors: cx.colors,
        };
        decompose(cx.doc, run, range.clone(), cx.theme, cx.assets, &mut sink);
    }
}
