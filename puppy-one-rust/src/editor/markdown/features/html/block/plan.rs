//! HTML block plan compilation and cross-block flow pairing
//! (`htmlPlan.ts`, `MA-04`: zero `gpui`).
use super::model::{HtmlBlock, admission_failure};
use crate::editor::markdown::{
    core::{
        features::CompileCx,
        plans::{BlockEmbed, Plan, Presentation, execution::HTML_FLOW_MAX_SIBLINGS},
    },
    features::html::{
        ID,
        sanitize::Node,
        structure::{self, Parsed, markdown_html},
    },
    platform::brokers::embed::external_iframe_href,
};
use std::ops::Range;

fn source_fallback(range: Range<usize>, code: &'static str) -> Plan {
    Plan {
        element: None,
        source: range,
        presentation: Presentation::SourceFallback { code },
        delete_units: Vec::new(),
    }
}

fn admit(
    html: String,
    range: Range<usize>,
    nodes: &[Node],
    out: &mut Vec<HtmlBlock>,
    fallbacks: &mut Vec<Plan>,
) {
    if let Some(code) = admission_failure(&html, nodes) {
        fallbacks.push(source_fallback(range, code));
    } else {
        out.push(HtmlBlock {
            html,
            range,
            embed: None,
        });
    }
}

/// The HTML flows and exact source fallbacks owned by this feature.
pub fn collect_blocks(cx: &CompileCx, fallbacks: &mut Vec<Plan>) -> Vec<HtmlBlock> {
    let doc = cx.doc;
    let lines = |span: &Range<usize>| {
        doc.line_range(doc.line_index(span.start)).start
            ..doc
                .line_range(doc.line_index(span.end.saturating_sub(1).max(span.start)))
                .end
    };
    let spans = &cx.syntax.html_blocks;
    let mut out = Vec::new();
    let mut i = 0;
    while i < spans.len() {
        let range = lines(&spans[i]);
        if let Some(href) = external_iframe_href(doc.slice(range.clone())) {
            out.push(HtmlBlock {
                html: String::new(),
                range,
                embed: Some(href),
            });
            i += 1;
            continue;
        }
        match structure::parse(doc.slice(range.clone())) {
            Parsed::Complete(nodes) => admit(
                doc.slice(range.clone()).to_owned(),
                range,
                &nodes,
                &mut out,
                fallbacks,
            ),
            Parsed::Incomplete(open) => {
                let mut open = open;
                let mut resolved = false;
                // Incomplete comments/declarations cannot be closed by a later tag.
                if !open.is_empty() {
                    for (j, span) in spans
                        .iter()
                        .enumerate()
                        .skip(i + 1)
                        .take(HTML_FLOW_MAX_SIBLINGS)
                    {
                        let next = lines(span);
                        let Some(rest) = structure::balance(doc.slice(next.clone()), open) else {
                            fallbacks.push(source_fallback(
                                range.start..next.end,
                                "htmlBlock.malformed",
                            ));
                            resolved = true;
                            i = j;
                            break;
                        };
                        open = rest;
                        if open.is_empty() {
                            let flow = range.start..next.end;
                            // Document definitions retain first-wins precedence without
                            // widening the range owned by this HTML flow.
                            let definitions = cx
                                .syntax
                                .link_defs
                                .iter()
                                .map(|(_, raw)| raw.as_str())
                                .collect::<Vec<_>>()
                                .join("\n");
                            let source = doc.slice(flow.clone());
                            let html = if definitions.is_empty() {
                                markdown_html(source)
                            } else {
                                markdown_html(&format!("{definitions}\n\n{source}"))
                            };
                            match structure::parse(&html) {
                                Parsed::Complete(nodes) => {
                                    admit(html, flow, &nodes, &mut out, fallbacks)
                                }
                                _ => fallbacks.push(source_fallback(flow, "htmlBlock.malformed")),
                            }
                            resolved = true;
                            i = j;
                            break;
                        }
                    }
                }
                if !resolved {
                    fallbacks.push(source_fallback(range, "htmlBlock.incomplete"));
                }
            }
            Parsed::Malformed => fallbacks.push(source_fallback(range, "htmlBlock.malformed")),
            Parsed::Unsupported => fallbacks.push(source_fallback(range, "htmlBlock.unsupported")),
        }
        i += 1;
    }
    out
}

pub fn compile_blocks(cx: &CompileCx, out: &mut Vec<Plan>) {
    for block in collect_blocks(cx, out) {
        out.push(Plan {
            element: None,
            source: block.range.clone(),
            presentation: Presentation::BlockAtom(BlockEmbed::new(ID, block)),
            delete_units: Vec::new(),
        });
    }
}
