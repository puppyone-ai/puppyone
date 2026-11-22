//! HTML blocks (product features/html): a top-level HTML block whose tags
//! nest as authored renders as `.cm-md-html-widget` — the sanitized
//! surface, a source toggle in its toolbar and the block rings. A block
//! that opens a tag a later HTML block closes, across Markdown between
//! them, is one flow as GitHub reads it (`createMarkdownCrossingBlock`):
//! the Markdown inside renders too, so `<details>` holds Markdown. Blocks
//! a browser would repair, comments and declarations stay source. A block
//! that is only an `https:` `<iframe>` is a web embed (`embed`).
pub mod dom;
pub mod embed;
mod widget;

use crate::editor::{
    markdown::{
        core::{
            decorations::BlockDecoration,
            features::{CompileCx, MarkdownFeature, WidgetFactoryCx},
            plans::{BlockEmbed, Plan, Presentation},
            state::PreviewState,
        },
        shared::dom::markdown_html,
    },
    text::{
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::{ops::Range, rc::Rc};
use widget::HtmlBlockWidget;

pub struct HtmlFeature;
pub static FEATURE: HtmlFeature = HtmlFeature;
pub const ID: &str = "html";
/// `MARKDOWN_HTML_FLOW_MAX_SIBLINGS`.
const MAX_FLOW: usize = 512;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct HtmlBlock {
    /// Whole source lines.
    pub range: Range<usize>,
    /// The HTML the surface renders.
    pub html: String,
    /// The page a lone `<iframe>` asks for.
    pub embed: Option<String>,
}

/// Reveal the block's source (the toolbar toggle).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource(pub Range<usize>);

fn source_fallback(range: Range<usize>, code: &'static str) -> Plan {
    Plan {
        element: None,
        source: range,
        presentation: Presentation::SourceFallback { code },
        delete_units: Vec::new(),
    }
}

/// A reduced nested element cannot grant link navigation or hide a forbidden root.
fn admission_failure(html: &str, nodes: &[dom::Node]) -> Option<&'static str> {
    if dom::has_blocked_root(html) {
        return Some("htmlBlock.blocked-tag");
    }
    let mut pending: Vec<_> = nodes.iter().collect();
    while let Some(node) = pending.pop() {
        if let dom::Node::Element(element) = node {
            if element.tag == "a"
                && let Some(href) = element.attribute("href")
                && crate::editor::markdown::platform::link::safe_href(href).is_none()
            {
                return Some("htmlBlock.unsafe-href");
            }
            pending.extend(&element.children);
        }
    }
    None
}

fn admit(
    html: String,
    range: Range<usize>,
    nodes: &[dom::Node],
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
fn blocks(cx: &CompileCx, fallbacks: &mut Vec<Plan>) -> Vec<HtmlBlock> {
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
        if let Some(href) = embed::external_href(doc.slice(range.clone())) {
            out.push(HtmlBlock {
                html: String::new(),
                range,
                embed: Some(href),
            });
            i += 1;
            continue;
        }
        match dom::parse(doc.slice(range.clone())) {
            dom::Parsed::Complete(nodes) => admit(
                doc.slice(range.clone()).to_owned(),
                range,
                &nodes,
                &mut out,
                fallbacks,
            ),
            dom::Parsed::Incomplete(open) => {
                let mut open = open;
                let mut resolved = false;
                // Incomplete comments/declarations cannot be closed by a later tag.
                if !open.is_empty() {
                    for (j, span) in spans.iter().enumerate().skip(i + 1).take(MAX_FLOW) {
                        let next = lines(span);
                        let Some(rest) = dom::balance(doc.slice(next.clone()), open) else {
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
                            match dom::parse(&html) {
                                dom::Parsed::Complete(nodes) => {
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
            dom::Parsed::Malformed => fallbacks.push(source_fallback(range, "htmlBlock.malformed")),
            dom::Parsed::Unsupported => {
                fallbacks.push(source_fallback(range, "htmlBlock.unsupported"))
            }
        }
        i += 1;
    }
    out
}

impl MarkdownFeature for HtmlFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        for block in blocks(cx, out) {
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
        let block = embed.model::<HtmlBlock>()?;
        let nodes = match &block.embed {
            Some(_) => Vec::new(),
            None => match dom::parse(&block.html) {
                dom::Parsed::Complete(nodes) => nodes,
                _ => return None,
            },
        };
        Some(Rc::new(HtmlBlockWidget {
            range: block.range.clone(),
            nodes,
            embed: block.embed.clone(),
            theme: cx.theme.clone(),
            assets: cx.assets.cloned(),
        }))
    }

    /// The block is one caret position while it renders.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<HtmlBlock>() {
            cx.atomic(block.range.clone());
        }
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let ShowSource(range) = command.payload::<ShowSource>()?;
        let range = state.doc.clamp_range(range.clone());
        let caret = state
            .doc
            .clamp(range.start.saturating_add(1).min(range.end));
        preview.revealed_source = Some(range);
        Some(Transaction::select(Selection::cursor(caret)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{markdown::core::syntax::Syntax, text::buffer::Buffer};
    use core::prelude::v1::test;

    fn blocks(cx: &CompileCx) -> Vec<HtmlBlock> {
        super::blocks(cx, &mut Vec::new())
    }

    #[test]
    fn html_blocks_and_flows_render_as_authored() {
        let text = "<div align=\"center\">\n<b>hi</b>\n</div>\n\n<details>\n<summary>More</summary>\n\nInside **md**.\n\n</details>\n\n<p><div>bad</div></p>\n\n<!-- note -->\n";
        let doc = Buffer::new(text);
        let syntax = Syntax::parse(&doc);
        let folds = Default::default();
        let found = blocks(&CompileCx {
            doc: &doc,
            syntax: &syntax,
            folds: &folds,
        });
        assert_eq!(found.len(), 2, "{found:?}");
        assert_eq!(
            doc.slice(found[0].range.clone()),
            "<div align=\"center\">\n<b>hi</b>\n</div>"
        );
        assert!(
            found[1].html.contains("<strong>md</strong>"),
            "{}",
            found[1].html
        );
        assert!(doc.slice(found[1].range.clone()).ends_with("</details>"));
    }

    /// What compiling `text` gives: the blocks' sources (an embed as
    /// `embed:<url>`) and the fallbacks' codes.
    fn compiled(text: &str) -> (Vec<String>, Vec<&'static str>) {
        let doc = Buffer::new(text);
        let syntax = Syntax::parse(&doc);
        let folds = Default::default();
        let mut fallbacks = Vec::new();
        let found = super::blocks(
            &CompileCx {
                doc: &doc,
                syntax: &syntax,
                folds: &folds,
            },
            &mut fallbacks,
        );
        let codes = fallbacks
            .iter()
            .filter_map(|p| match p.presentation {
                Presentation::SourceFallback { code } => Some(code),
                _ => None,
            })
            .collect();
        let blocks = found
            .iter()
            .map(|b| match &b.embed {
                Some(url) => format!("embed:{url}"),
                None => b.html.clone(),
            })
            .collect();
        (blocks, codes)
    }

    /// `markdownHtmlConformance.test.ts`, plan-level policy and
    /// cross-surface cases with the product's inputs: safe blocks, details,
    /// unknown and component-like elements render (unknown tags reduced to
    /// their content, event handlers stripped); a blocked root, an unsafe
    /// link, an iframe with extra behaviour or a plain-HTTP one stay source;
    /// a lone HTTPS iframe is an embed; a README header split by blank lines
    /// is one flow, also from an inner fragment; a flow across Markdown
    /// renders that Markdown; one that never closes stays source; adjacent
    /// complete blocks stay independent.
    #[test]
    fn html_block_policy_follows_the_product_classification() {
        for safe in [
            "<div><strong>safe</strong></div>",
            "<details><summary>Title</summary>Body</details>",
            "<div onclick=\"run()\" style=\"display:none;color:red\">safe</div>",
            "<div onclick=\"run()\"><time datetime=\"2026-08-05\">Today</time></div>",
            "<my-widget>\nvalue\n</my-widget>",
            "<Tabs>\n<Tab>one</Tab>\n</Tabs>",
            "<div align=\"center\"><p align=\"right\">safe</p></div>",
            "<div align=\"sideways\">safe</div>",
        ] {
            let (blocks, codes) = compiled(safe);
            assert_eq!((blocks.len(), codes.len()), (1, 0), "{safe}: {codes:?}");
            let dom::Parsed::Complete(nodes) = dom::parse(&blocks[0]) else {
                panic!("{safe}");
            };
            let mut pending: Vec<_> = nodes.iter().collect();
            while let Some(node) = pending.pop() {
                if let dom::Node::Element(e) = node {
                    assert!(
                        e.attributes.iter().all(|(n, _)| !n.starts_with("on")),
                        "{safe}"
                    );
                    pending.extend(&e.children);
                }
            }
        }
        for (refused, code) in [
            ("<script>alert(1)</script>", "htmlBlock.blocked-tag"),
            ("<form><input></form>", "htmlBlock.blocked-tag"),
            (
                "<div><a href=\"javascript:alert(1)\">x</a></div>",
                "htmlBlock.unsafe-href",
            ),
            (
                "<iframe src=\"https://example.com\" allow=\"camera\"></iframe>",
                "htmlBlock.blocked-tag",
            ),
            (
                "<iframe src=\"http://example.com\"></iframe>",
                "htmlBlock.blocked-tag",
            ),
        ] {
            assert_eq!(compiled(refused), (vec![], vec![code]), "{refused}");
        }
        assert_eq!(
            compiled("<iframe src=\"https://example.com/embed\"></iframe>").0,
            ["embed:https://example.com/embed"]
        );

        let header = "<div align=\"center\">\n  <img src=\"public/assets/brand/puppy/puppy-dark.svg\" alt=\"puppyone Logo\" width=\"72\" height=\"72\" />\n\n  <h1>puppyone</h1>\n\n  <p><b>A local-first editor. Built for you and your agents.</b></p>\n\n  <p>\n    <a href=\"https://www.puppyone.ai\"><img src=\"https://img.shields.io/badge/Website-puppyone.ai-39BC66?style=flat-square\" alt=\"Website\" /></a>\n  </p>\n</div>";
        let (blocks, codes) = compiled(header);
        assert_eq!((blocks.len(), codes.len()), (1, 0));
        assert!(blocks[0].contains("<h1>puppyone</h1>") && blocks[0].contains("img.shields.io"));

        let (blocks, _) = compiled("<div>\n\n**Markdown** child\n\n</div>");
        assert!(
            blocks[0].contains("<strong>Markdown</strong>"),
            "{blocks:?}"
        );
        assert_eq!(
            compiled("<div>\n\nMarkdown child"),
            (vec![], vec!["htmlBlock.incomplete"])
        );
        assert_eq!(
            compiled("<div>one</div>\n\n<section>two</section>").0.len(),
            2
        );
    }

    /// `covers every versioned safe-block tag through one policy authority`;
    /// `covers every passive-media tag only through the composed media
    /// profile`: each tag of the product's safe-block and safe-media
    /// profiles is admitted on its own.
    #[test]
    fn every_safe_block_and_media_tag_is_admitted() {
        const TAGS: &[&str] = &[
            "a",
            "abbr",
            "b",
            "br",
            "cite",
            "code",
            "del",
            "em",
            "i",
            "ins",
            "kbd",
            "mark",
            "q",
            "rp",
            "rt",
            "ruby",
            "s",
            "samp",
            "small",
            "span",
            "strike",
            "strong",
            "sub",
            "sup",
            "time",
            "tt",
            "u",
            "var",
            "bdi",
            "bdo",
            "big",
            "data",
            "dfn",
            "font",
            "label",
            "meter",
            "nobr",
            "output",
            "progress",
            "wbr",
            "address",
            "article",
            "aside",
            "blockquote",
            "caption",
            "center",
            "dd",
            "details",
            "div",
            "dl",
            "dt",
            "figcaption",
            "fieldset",
            "figure",
            "footer",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "header",
            "hgroup",
            "hr",
            "legend",
            "li",
            "main",
            "menu",
            "nav",
            "ol",
            "p",
            "pre",
            "section",
            "summary",
            "table",
            "tbody",
            "td",
            "tfoot",
            "th",
            "thead",
            "tr",
            "ul",
            "audio",
            "img",
            "picture",
            "source",
            "video",
        ];
        const VOID: &[&str] = &["br", "hr", "img", "source", "wbr"];
        let mut refused = Vec::new();
        for tag in TAGS {
            let source = if VOID.contains(tag) {
                format!("<{tag}>")
            } else {
                format!("<{tag}></{tag}>")
            };
            match dom::parse(&source) {
                dom::Parsed::Complete(nodes) if admission_failure(&source, &nodes).is_none() => {}
                other => refused.push(format!("{tag}: {other:?}")),
            }
        }
        assert!(refused.is_empty(), "{refused:?}");
    }

    #[test]
    fn a_lone_iframe_block_is_a_web_embed() {
        let text = "<iframe src=\"https://example.com/v\"></iframe>\n\n<div><iframe src=\"https://example.com/v\"></iframe></div>\n";
        let doc = Buffer::new(text);
        let syntax = Syntax::parse(&doc);
        let folds = Default::default();
        let found = blocks(&CompileCx {
            doc: &doc,
            syntax: &syntax,
            folds: &folds,
        });
        assert_eq!(
            found.first().and_then(|b| b.embed.as_deref()),
            Some("https://example.com/v")
        );
        assert!(found.iter().skip(1).all(|b| b.embed.is_none()));
    }
}
