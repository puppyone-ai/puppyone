//! HTML blocks and inline HTML (product `features/html`): tokenization lives in
//! [`tokenizer`], strict authored nesting in [`structure`], profile sanitization
//! in [`sanitize`], block model/plan/widget in [`block`], inline HTML in [`inline`],
//! and GPUI surface rendering in [`render`].
pub mod block;
pub mod inline;
pub mod render;
pub mod run;
pub mod sanitize;
pub mod structure;
pub mod tokenizer;

pub use block::{HtmlBlock, ShowSource};

use crate::editor::{
    markdown::core::{
        decorations::{BlockDecoration, InlineDecoration, LineDecoration},
        features::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan},
        state::PreviewState,
        syntax::{Element, Kind, Syntax},
    },
    text::{
        buffer::Buffer,
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use block::HtmlBlockWidget;
use std::{ops::Range, rc::Rc};

pub struct HtmlFeature;
pub static FEATURE: HtmlFeature = HtmlFeature;
pub const ID: &str = "html";

impl MarkdownFeature for HtmlFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn collect_range(
        &self,
        doc: &Buffer,
        syntax: &Syntax,
        window: Range<usize>,
        out: &mut Vec<Element>,
    ) {
        inline::collect_range(doc, syntax, window, out);
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        block::compile_blocks(cx, out);
    }

    fn semantic_kinds(&self) -> &'static [Kind] {
        &[Kind::HtmlRun]
    }

    fn compile_element(&self, index: usize, element: &Element, cx: &CompileCx) -> Option<Plan> {
        run::compile(index, element, cx)
    }

    fn decorate_line(&self, cx: &mut LineDecoration) {
        run::decorate_line(cx);
    }

    fn decorate_inline_content(&self, cx: &mut InlineDecoration) {
        run::decorate_inline(cx);
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        let block = embed.model::<HtmlBlock>()?;
        let nodes = match &block.embed {
            Some(_) => Vec::new(),
            None => match structure::parse(&block.html) {
                structure::Parsed::Complete(nodes) => nodes,
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
    use super::{
        block::{admission_failure, collect_blocks},
        sanitize::Node,
        structure::{self, Parsed},
        *,
    };
    use crate::editor::{
        markdown::core::{plans::Presentation, syntax::Syntax},
        text::buffer::Buffer,
    };
    use core::prelude::v1::test;

    fn blocks(cx: &CompileCx) -> Vec<HtmlBlock> {
        collect_blocks(cx, &mut Vec::new())
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
        let found = collect_blocks(
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
    /// cross-surface cases with the product's inputs.
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
            let Parsed::Complete(nodes) = structure::parse(&blocks[0]) else {
                panic!("{safe}");
            };
            let mut pending: Vec<_> = nodes.iter().collect();
            while let Some(node) = pending.pop() {
                if let Node::Element(e) = node {
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
            match structure::parse(&source) {
                Parsed::Complete(nodes) if admission_failure(&source, &nodes).is_none() => {}
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
