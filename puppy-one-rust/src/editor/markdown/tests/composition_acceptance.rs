//! `markdownFeatureComposition.test.ts`: the static feature lists of each
//! dialect, each block construct through its feature's compile and widget,
//! and images classified by the line they sit on.
use super::setup;
use crate::{
    editor::{
        markdown::{
            composition::{FEATURES, MDX_FEATURES},
            core::{
                features::{self, Features, WidgetFactoryCx},
                plans,
                state::FeatureStateStore,
                syntax::Syntax,
            },
            style::MarkdownTheme,
        },
        text::buffer::Buffer,
        view::decoration::Block,
    },
    typography::Scale,
};
use gpui::TestAppContext;
use std::collections::HashSet;

fn ids(features: Features) -> Vec<&'static str> {
    features.iter().map(|f| f.id()).collect()
}

/// `is frozen and owns each registered capability exactly once`; `fails
/// fast for duplicate ids and semantic owners` (the lists are static, so
/// the guard is this check); `adds declarative MDX components only to the
/// OpenKnowledge dialect`.
#[test]
fn each_dialect_owns_its_features_and_semantic_kinds_once() {
    for features in [FEATURES, MDX_FEATURES] {
        let ids = ids(features);
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
        let kinds: Vec<_> = features.iter().flat_map(|f| f.semantic_kinds()).collect();
        assert_eq!(
            kinds.iter().collect::<HashSet<_>>().len(),
            kinds.len(),
            "{ids:?}"
        );
        for id in [
            "front-matter",
            "callout",
            "math",
            "code-block",
            "mermaid",
            "html",
            "table",
            "video",
            "image",
        ] {
            assert!(ids.contains(&id), "{id}");
        }
    }
    assert!(!ids(FEATURES).contains(&"mdx-component"));
    let mdx = ids(MDX_FEATURES);
    let at = |id| mdx.iter().position(|f| *f == id).unwrap();
    // Components claim their blocks before HTML does.
    assert!(at("mdx-component") < at("html"));
}

/// `runs <construct> through detect, compile, and the registered block
/// widget` for a code block, Mermaid, HTML, a table and a video; `leaves
/// unsupported media envelopes as exact visible source`.
#[test]
fn block_constructs_compile_to_their_features_widget() {
    let theme = MarkdownTheme::resolve(false, Scale::Medium);
    let state = FeatureStateStore::default();
    let block = |source: &str| {
        let doc = Buffer::new(source);
        let syntax = Syntax::parse_with(&doc, FEATURES);
        let plans = plans::compile(&doc, &syntax, &state, FEATURES);
        let embeds: Vec<_> = plans.iter().filter_map(|p| p.embed()).cloned().collect();
        let built = embeds
            .iter()
            .map(|embed| {
                let factory = WidgetFactoryCx {
                    doc: &doc,
                    syntax: &syntax,
                    theme: &theme,
                    assets: None,
                    references: None,
                    state: &state,
                    inline_preview: Some(&crate::editor::markdown::composition::preview::PREVIEW),
                };
                features::find(FEATURES, embed.feature)
                    .and_then(|f| f.block_widget(embed, &factory))
                    .is_some()
            })
            .collect::<Vec<_>>();
        (embeds.iter().map(|e| e.feature).collect::<Vec<_>>(), built)
    };
    for (source, id) in [
        ("```ts\nconst value = 1;\n```", "code-block"),
        ("```mermaid\ngraph TD; A-->B\n```", "mermaid"),
        ("<div>safe</div>", "html"),
        ("| A |\n| --- |\n| B |", "table"),
        ("![[media/demo.mp4]]", "video"),
    ] {
        assert_eq!(block(source), (vec![id], vec![true]), "{source}");
    }
    assert_eq!(block("![[archive/file.bin]]"), (vec![], vec![]));
}

/// `produces one complete image element and one plan` for standard Markdown
/// with spaces and for Obsidian media; `classifies only a line-owning image
/// as block media`; `creates an image widget only from the compiled plan
/// payload`: an image alone on its line (surrounding spaces allowed) is one
/// block embed labelled by its alt text; one beside text sits in the text.
/// The authored title, an accessible description in the product, has no
/// GPUI counterpart.
#[gpui::test]
fn an_image_owning_its_line_is_block_media(cx: &mut TestAppContext) {
    let doc = |source: &str| {
        let doc = Buffer::new(source);
        let syntax = Syntax::parse_with(&doc, FEATURES);
        syntax
            .elements
            .iter()
            .filter(|e| {
                matches!(
                    e.kind,
                    crate::editor::markdown::core::syntax::Kind::Image
                        | crate::editor::markdown::core::syntax::Kind::ImageEmbed
                )
            })
            .map(|e| e.href.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        doc("![Context Base](asserts/Screenshot 2026-07-15 at 10.07.43 PM.png)"),
        [Some(
            "asserts/Screenshot 2026-07-15 at 10.07.43 PM.png".to_owned()
        )]
    );
    assert_eq!(
        doc("![[assets/diagram.png|Diagram]]"),
        [Some("assets/diagram.png".to_owned())]
    );

    let text = "  ![wide](assets/wide.png)  \n\nBefore ![icon](assets/icon.png) after\n\n![authored alt](assets/from-plan.png \"Plan title\")";
    let (view, cx) = setup(cx, text);
    view.update_in(cx, |v, _, cx| {
        v.set_selection(crate::editor::text::selection::Selection::cursor(30), cx)
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.update(cx, |v, _| {
        let d = v.decorations();
        let embeds: Vec<_> = d
            .blocks
            .iter()
            .map(|b| matches!(b, Block::Line { style, .. } if style.embed.is_some()))
            .collect();
        assert_eq!(embeds, [true, false, false, false, true]);
        let inline: Vec<_> = d
            .inline_widgets
            .iter()
            .filter_map(|w| w.as_image().map(|(label, _)| label.to_string()))
            .collect();
        assert_eq!(inline, ["icon"]);
    });
}

/// `render-plan.test.ts`: `compiles fence and table blocks into blockAtom
/// plans with payload`, `propagates the refined table boundary through the
/// canonical plan index`, `carries legacy code-source references into the
/// block plan`; `markdownCodeBlockMetadata.test.ts`: `recognizes legacy
/// line-range filenames and infers the language`. A legacy fence's code is
/// highlighted in its file's language (the quoted file and lines, an
/// accessible description in the product, have no GPUI counterpart).
#[test]
fn fences_and_tables_compile_their_payload_and_tables_end_before_prose() {
    use crate::editor::markdown::{
        core::{plans::Plan, syntax::Kind},
        features::{code_block::CodeBlock, table::model::Table},
    };
    let compiled = |source: &str| {
        let doc = Buffer::new(source);
        let syntax = Syntax::parse_with(&doc, FEATURES);
        let plans = plans::compile(&doc, &syntax, &FeatureStateStore::default(), FEATURES);
        (syntax, plans)
    };
    let code = |plans: &[Plan], source: &str| {
        plans
            .iter()
            .find_map(|p| p.embed()?.model::<CodeBlock>().cloned())
            .map(|c| (c.language, source[c.code].to_owned()))
    };

    let source = "```ts\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    let (_, plans) = compiled(source);
    assert_eq!(
        code(&plans, source),
        Some(("ts".into(), "const x = 1;".into()))
    );
    let table = plans
        .iter()
        .find_map(|p| p.embed()?.model::<Table>())
        .unwrap();
    assert!(table.rows.len() >= 2 && table.alignments.len() >= 2);

    let prose = "**First, this remains a paragraph.**";
    let source = format!("| A | B |\n| --- | --- |\n| 1 | 2 |\n{prose}");
    let prose_from = source.find(prose).unwrap();
    let (syntax, plans) = compiled(&source);
    let (plan, table) = plans
        .iter()
        .find_map(|p| Some((p, p.embed()?.model::<Table>()?)))
        .unwrap();
    assert_eq!(plan.source, 0..prose_from - 1);
    assert_eq!(table.rows.len(), 2);
    assert!(
        syntax
            .elements_in(prose_from..source.len())
            .any(|e| e.kind == Kind::Strong)
    );
    assert!(
        plans
            .iter()
            .filter(|p| p.source.end > prose_from)
            .all(|p| p.embed().is_none())
    );

    let source = "```83:99:package.json\n{\"private\": true}\n```";
    let (_, plans) = compiled(source);
    assert_eq!(
        code(&plans, source),
        Some(("json".into(), "{\"private\": true}".into()))
    );
}
