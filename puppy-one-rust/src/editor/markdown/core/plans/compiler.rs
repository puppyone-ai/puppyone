//! Full and windowed plan compilation (`TA-32`, `TA-33`,
//! product `core/plans/markdownPlanCompiler.ts`).
use super::{
    primitives::{claim_lines, retain_first_block_owner},
    types::{Atom, Plan, Presentation},
};
use crate::editor::{
    markdown::core::{
        features::{self, CompileCx, Features},
        state::FeatureStateStore,
        syntax::{Element, Kind, Span, Syntax},
    },
    text::buffer::Buffer,
};
use std::ops::Range;

/// Core inline elements (marks, escapes); everything else is visible source.
fn compile_core_element(index: usize, e: &Element) -> Plan {
    let visible = Plan {
        element: Some(index),
        source: e.range.clone(),
        presentation: Presentation::VisibleSource,
        delete_units: Vec::new(),
    };
    match e.kind {
        Kind::Strong
        | Kind::Emphasis
        | Kind::Strike
        | Kind::InlineCode
        | Kind::Link
        | Kind::WikiLink
        | Kind::Highlight
        | Kind::LinkDefinition
        | Kind::Comment
        | Kind::InlineHtml => match &e.content {
            Some(c) if c.start < c.end => Plan {
                element: Some(index),
                source: e.range.clone(),
                presentation: Presentation::InlineMark {
                    content: c.clone(),
                    markers: e.markers.clone(),
                },
                delete_units: e.markers.clone(),
            },
            _ => visible,
        },
        Kind::Escape => Plan {
            presentation: Presentation::InlineAtom(Atom::Escape),
            delete_units: e.markers.clone(),
            ..visible
        },
        Kind::Emoji | Kind::Entity | Kind::FootnoteReference | Kind::FootnoteDefinition => {
            match &e.text {
                Some(text) => Plan {
                    presentation: Presentation::InlineAtom(Atom::Text(text.clone())),
                    ..visible
                },
                None => visible,
            }
        }
        _ => visible,
    }
}

pub(super) fn compile_one_element(
    index: usize,
    e: &Element,
    cx: &CompileCx,
    features: Features,
) -> Plan {
    for f in features
        .iter()
        .filter(|f| f.semantic_kinds().contains(&e.kind))
    {
        match features::catch_feature_panic(f.id(), "compile_element", || {
            f.compile_element(index, e, cx)
        }) {
            Some(Some(plan)) => return plan.clamp_to_doc(cx.doc),
            Some(None) => continue,
            None => {
                return Plan {
                    element: Some(index),
                    source: e.range.clone(),
                    presentation: Presentation::VisibleSource,
                    delete_units: Vec::new(),
                };
            }
        }
    }
    compile_core_element(index, e)
}

/// Build a narrow `Syntax` view bounded to `byte_window` (`line_window`) so
/// feature `compile_blocks` hooks only inspect constructs inside that window.
pub fn window_syntax_view(
    syntax: &Syntax,
    byte_window: &Span,
    line_window: &Range<usize>,
) -> Syntax {
    let slice_spans = |v: &[Span]| -> Vec<Span> {
        let a = v.partition_point(|r| r.end <= byte_window.start);
        let b = v.partition_point(|r| r.start < byte_window.end).max(a);
        v[a..b].to_vec()
    };
    let f_a = syntax
        .fences
        .partition_point(|f| f.range.end <= byte_window.start);
    let f_b = syntax
        .fences
        .partition_point(|f| f.range.start < byte_window.end)
        .max(f_a);
    let fences = syntax.fences[f_a..f_b].to_vec();
    let code_start = syntax
        .code_lines
        .partition_point(|r| r.end <= line_window.start);
    let code_end = syntax
        .code_lines
        .partition_point(|r| r.start < line_window.end)
        .max(code_start);
    let code_lines = syntax.code_lines[code_start..code_end].to_vec();

    let elements: Vec<Element> = syntax
        .elements_in(byte_window.clone())
        .filter(|e| e.range.start < byte_window.end && e.range.end > byte_window.start)
        .cloned()
        .collect();

    Syntax {
        elements,
        items: Vec::new(),
        lists: Vec::new(),
        paragraphs: Vec::new(),
        fences,
        code_blocks: slice_spans(&syntax.code_blocks),
        code_lines,
        highlights: Vec::new(),
        tables: slice_spans(&syntax.tables),
        table_cells: slice_spans(&syntax.table_cells),
        note_definitions: Vec::new(),
        inline_tags: Vec::new(),
        html_blocks: slice_spans(&syntax.html_blocks),
        marker_html: slice_spans(&syntax.marker_html),
        // Clamped to the window: block features scan only its lines. The
        // incremental compile runs only when no multi-block delimiter falls in
        // or opens around the window, so no block they find can reach past it.
        top_blocks: slice_spans(&syntax.top_blocks)
            .into_iter()
            .map(|b| b.start.max(byte_window.start)..b.end.min(byte_window.end))
            .collect(),
        footnotes: Default::default(),
        link_defs: Vec::new(),
        block_delimiters: Vec::new(),
        comment_spans: Vec::new(),
        footnote_spans: Vec::new(),
    }
}

/// Recompile block plans inside `byte_window` (`line_window`) only, used both
/// by incremental plan splicing (`TA-32`) and by on-demand refresh of shifted
/// suffix `BlockEmbed`s when scrolled into view or targeted by a command.
pub fn compile_blocks_in_window(
    doc: &Buffer,
    syntax: &Syntax,
    folds: &FeatureStateStore,
    features: Features,
    byte_window: Span,
    line_window: Range<usize>,
) -> Vec<Plan> {
    let win_syn = window_syntax_view(syntax, &byte_window, &line_window);
    let win_cx = CompileCx {
        doc,
        syntax: &win_syn,
        folds,
    };
    let mut out = Vec::new();
    let mut owned = Vec::new();
    for f in features {
        let mut stage = Vec::new();
        if features::catch_feature_panic(f.id(), "compile_blocks", || {
            f.compile_blocks(&win_cx, &mut stage);
        })
        .is_some()
        {
            let mut stage: Vec<_> = stage.into_iter().map(|p| p.clamp_to_doc(doc)).collect();
            claim_lines(*f, &mut stage, &mut owned);
            for clamped in stage {
                if clamped.source.end > byte_window.start && clamped.source.start < byte_window.end
                    || (byte_window.start == 0 && clamped.source.start == 0)
                {
                    out.push(clamped);
                }
            }
        }
    }
    out.sort_by(|a, b| {
        a.source
            .start
            .cmp(&b.source.start)
            .then(a.source.end.cmp(&b.source.end))
    });
    retain_first_block_owner(&mut out);
    out
}

/// Full-document plan compilation (preserving the exact signature expected by
/// existing feature unit tests).
pub fn compile(
    doc: &Buffer,
    syntax: &Syntax,
    folds: &FeatureStateStore,
    features: Features,
) -> Vec<Plan> {
    let cx = CompileCx { doc, syntax, folds };
    let mut plans: Vec<Plan> = syntax
        .elements
        .iter()
        .enumerate()
        .map(|(i, e)| compile_one_element(i, e, &cx, features))
        .collect();
    let mut owned = Vec::new();
    for f in features {
        let mut stage = Vec::new();
        if features::catch_feature_panic(f.id(), "compile_blocks", || {
            f.compile_blocks(&cx, &mut stage);
        })
        .is_some()
        {
            let mut stage: Vec<_> = stage.into_iter().map(|p| p.clamp_to_doc(doc)).collect();
            claim_lines(*f, &mut stage, &mut owned);
            plans.extend(stage);
        }
    }
    plans.sort_by(|a, b| {
        a.source
            .start
            .cmp(&b.source.start)
            .then(a.source.end.cmp(&b.source.end))
    });
    retain_first_block_owner(&mut plans);
    plans
}
