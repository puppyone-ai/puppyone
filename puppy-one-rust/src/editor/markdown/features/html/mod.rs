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
            feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
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

/// The HTML blocks of the document as the surface shows them.
fn blocks(cx: &CompileCx) -> Vec<HtmlBlock> {
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
            dom::Parsed::Complete(_) => out.push(HtmlBlock {
                html: doc.slice(range.clone()).to_owned(),
                range,
                embed: None,
            }),
            dom::Parsed::Incomplete(open) => {
                let mut open = open;
                let mut crossed = false;
                let mut previous = range.end;
                for (j, span) in spans.iter().enumerate().skip(i + 1).take(MAX_FLOW) {
                    let next = lines(span);
                    crossed |= !doc.slice(previous..next.start).trim().is_empty();
                    previous = next.end;
                    let Some(rest) = dom::balance(doc.slice(next.clone()), open) else {
                        break;
                    };
                    open = rest;
                    if open.is_empty() {
                        let flow = range.start..next.end;
                        // Render the slice with the document's first-wins
                        // reference definitions, just as ordinary Markdown
                        // does. Put them first so a duplicate authored inside
                        // the flow cannot override an earlier document label.
                        // Definitions emit no HTML and never widen the source
                        // range owned by the widget.
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
                        if crossed && matches!(dom::parse(&html), dom::Parsed::Complete(_)) {
                            out.push(HtmlBlock {
                                range: flow,
                                html,
                                embed: None,
                            });
                            i = j;
                        }
                        break;
                    }
                }
            }
            _ => {}
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
        for block in blocks(cx) {
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
        let len = state.doc.len();
        preview.revealed_source = Some(range.start.min(len)..range.end.min(len));
        Some(Transaction::select(Selection::cursor(range.start.min(len))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::{markdown::core::syntax::Syntax, text::buffer::Buffer};
    use core::prelude::v1::test;

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
