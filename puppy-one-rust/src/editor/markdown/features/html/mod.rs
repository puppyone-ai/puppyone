//! HTML blocks (product features/html): a top-level HTML block whose tags
//! nest as authored renders as `.cm-md-html-widget` — the sanitized
//! surface, a source toggle in its toolbar and the block rings. A block
//! that opens a tag a later HTML block closes, across Markdown between
//! them, is one flow as GitHub reads it (`createMarkdownCrossingBlock`):
//! the Markdown inside renders too, so `<details>` holds Markdown. Blocks
//! a browser would repair, comments and declarations stay source.
pub mod dom;
mod render;
mod widget;

use crate::editor::{
    markdown::core::{
        decorations::BlockDecoration,
        feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan, Presentation},
        state::PreviewState,
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
}

/// Reveal the block's source (the toolbar toggle).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource(pub Range<usize>);

/// `renderMarkdownBlocksToHtml`: Markdown to HTML, raw HTML passing
/// through untouched.
fn markdown_html(source: &str) -> String {
    use pulldown_cmark::{Options, Parser, html};
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let mut out = String::new();
    html::push_html(&mut out, Parser::new_ext(source, options));
    out
}

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
        match dom::parse(doc.slice(range.clone())) {
            dom::Parsed::Complete(_) => out.push(HtmlBlock {
                html: doc.slice(range.clone()).to_owned(),
                range,
            }),
            dom::Parsed::Incomplete(open) => {
                // The balancing sibling, once Markdown has been crossed.
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
                        let html = markdown_html(doc.slice(flow.clone()));
                        if crossed && matches!(dom::parse(&html), dom::Parsed::Complete(_)) {
                            out.push(HtmlBlock { range: flow, html });
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
        let dom::Parsed::Complete(nodes) = dom::parse(&block.html) else {
            return None;
        };
        Some(Rc::new(HtmlBlockWidget {
            range: block.range.clone(),
            nodes,
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
}
