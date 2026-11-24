use super::{
    ID, TabsBlock,
    model::{MALFORMED, UNSUPPORTED, tabs},
    syntax::{blocks, tag_at},
};
use crate::editor::{
    markdown::{
        composition::{FEATURES, MDX_FEATURES},
        core::{
            features::Features,
            plans::{self, Plan, Presentation},
            state::FeatureStateStore,
            syntax::Syntax,
        },
    },
    text::buffer::Buffer,
};
use core::prelude::v1::test;
use std::ops::Range;

const TABS: &str = "<Tabs>\n<Tab label=\"npm\">\n\n```sh\nnpm i </Tab>\n```\n\n</Tab>\n<Tab label='pnpm'>\n**pnpm** add\n</Tab>\n</Tabs>";

/// `markdownMdxComponent.test.ts`'s Tabs: indented tabs, blank lines
/// inside, and a single-quoted label.
const PRODUCT_TABS: &str = "<Tabs>\n  <Tab label=\"Tab 1\">\n\n  First **panel**\n  </Tab>\n\n  <Tab label='Tab 2'>\n\n  Second panel\n  </Tab>\n</Tabs>";

/// The product's real-world regression document: a table holding
/// inline HTML, a hard break, then a Tabs block with empty tabs.
const REGRESSION: &str = "/\n\n# Hello man what can I say bro?\n\n| 我靠兄弟，你在搞我啊<br />hello man |  |  |  |\n| - | - | - | - |\n|  |  |  |  |\n|  |  |  |  |\n|  |  |  |  |\n|  |  |  |  |\n\n你好哈哈\\\n\n\n<Tabs>\n  <Tab label=\"Tab 1\">\n\n  </Tab>\n\n  <Tab label=\"Tab 2\">\n\n  </Tab>\n</Tabs>\n";

fn compiled(source: &str, features: Features) -> Vec<Plan> {
    let doc = Buffer::new(source);
    let syntax = Syntax::parse(&doc);
    plans::compile(&doc, &syntax, &FeatureStateStore::default(), features)
}

fn tabs_blocks(plans: &[Plan]) -> Vec<TabsBlock> {
    plans
        .iter()
        .filter_map(|p| p.embed()?.model::<TabsBlock>().cloned())
        .collect()
}

/// The hidden ranges and widget count of `source` in live preview.
fn decorated(source: &str, features: Features) -> (Vec<Range<usize>>, usize) {
    use crate::{
        editor::{
            markdown::{
                core::{
                    decorations::{self, DecorateCx},
                    presentation::block_rhythm,
                    state::PreviewState,
                },
                style::MarkdownTheme,
            },
            view::decoration::Block,
        },
        typography::Scale,
    };
    let doc = Buffer::new(source);
    let syntax = Syntax::parse(&doc);
    let plans = compiled(source, features);
    let rhythm = block_rhythm(&doc, &syntax, None);
    let decorations = decorations::decorate(&DecorateCx {
        doc: &doc,
        syntax: &syntax,
        plans: &plans,
        rhythm: &rhythm,
        theme: &MarkdownTheme::resolve(true, Scale::Medium),
        preview: &PreviewState::default(),
        live: true,
        features,
        assets: None,
        references: None,
        inline_preview: None,
    });
    let widgets = decorations
        .blocks
        .iter()
        .filter(|b| matches!(b, Block::Widget { .. }))
        .count();
    (decorations.hidden, widgets)
}

/// `parses Tabs across CommonMark blank-line boundaries without
/// evaluating code`.
#[test]
fn product_tabs_parse_across_blank_lines() {
    let found = tabs_blocks(&compiled(PRODUCT_TABS, MDX_FEATURES));
    assert_eq!(found.len(), 1);
    let labels: Vec<_> = found[0].tabs.iter().map(|t| t.label.as_str()).collect();
    assert_eq!(labels, ["Tab 1", "Tab 2"]);
    assert!(found[0].tabs[0].content.contains("First **panel**"));
    assert!(found[0].tabs[1].content.contains("Second panel"));
}

/// `keeps %s as visible source` (all fourteen shapes) and `bounds the
/// declarative registry before creating a large tab widget`: no widget,
/// the authored text shown whole, and the shape named for inspection.
#[test]
fn invalid_component_shapes_stay_visible_source() {
    let many = std::iter::once("<Tabs>".to_owned())
        .chain((0..65).map(|i| format!("<Tab label=\"{i}\">content</Tab>")))
        .chain(std::iter::once("</Tabs>".to_owned()))
        .collect::<Vec<_>>()
        .join("\n");
    let (u, m) = (UNSUPPORTED, MALFORMED);
    let shapes = [
        ("unknown component", "<Widget>content</Widget>", u),
        (
            "root props",
            "<Tabs className=\"unsafe\"><Tab label=\"x\">x</Tab></Tabs>",
            u,
        ),
        (
            "expression prop",
            "<Tabs><Tab label={window.alert(1)}>x</Tab></Tabs>",
            u,
        ),
        (
            "spread prop",
            "<Tabs><Tab {...props} label=\"x\">x</Tab></Tabs>",
            u,
        ),
        (
            "extra prop",
            "<Tabs><Tab label=\"x\" onClick=\"run\">x</Tab></Tabs>",
            u,
        ),
        (
            "duplicate prop",
            "<Tabs><Tab label=\"x\" label=\"y\">x</Tab></Tabs>",
            u,
        ),
        ("unquoted prop", "<Tabs><Tab label=x>x</Tab></Tabs>", u),
        ("self-closing child", "<Tabs><Tab label=\"x\" /></Tabs>", u),
        (
            "non-Tab direct child",
            "<Tabs><Panel>content</Panel></Tabs>",
            u,
        ),
        (
            "plain direct text",
            "<Tabs>unexpected<Tab label=\"x\">x</Tab></Tabs>",
            u,
        ),
        ("empty Tabs", "<Tabs></Tabs>", u),
        (
            "mismatched close",
            "<Tabs><Tab label=\"x\">x</Tabs></Tab>",
            m,
        ),
        (
            "content after close",
            "<Tabs><Tab label=\"x\">x</Tab></Tabs> trailing",
            m,
        ),
        ("unclosed component", "<Tabs><Tab label=\"x\">x</Tab>", m),
        ("65 tabs", many.as_str(), u),
        (
            "multi-line unknown component",
            "<Widget>\n\nFirst **panel** and *more*\n\n</Widget>",
            u,
        ),
    ];
    for (label, source, expected) in shapes {
        let plans = compiled(source, MDX_FEATURES);
        assert!(plans.iter().all(|p| p.embed().is_none()), "{label}");
        let fallback = plans
            .iter()
            .find(|p| p.element.is_none() && p.is_visible_source())
            .unwrap_or_else(|| panic!("{label}: {plans:?}"));
        assert_eq!(fallback.source, 0..source.len(), "{label}");
        assert_eq!(
            fallback.presentation,
            Presentation::SourceFallback { code: expected },
            "{label}"
        );
        let (hidden, widgets) = decorated(source, MDX_FEATURES);
        assert_eq!((hidden.as_slice(), widgets), (&[][..], 0), "{label}");
    }
}

/// `owns one syntax node, one semantic element, and one plan`; `ends the
/// component node at the root close and leaves following Markdown
/// independent`.
#[test]
fn one_component_is_one_plan_ending_at_its_root_close() {
    let source = format!("{PRODUCT_TABS}\n\n## After\n\nfollowing paragraph");
    let plans = compiled(&source, MDX_FEATURES);
    let found: Vec<_> = plans
        .iter()
        .filter(|p| p.embed().is_some_and(|e| e.feature == ID))
        .collect();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].source, 0..PRODUCT_TABS.len());
    let block_owners = plans
        .iter()
        .filter(|p| p.embed().is_some() || (p.element.is_none() && p.is_visible_source()))
        .filter(|p| p.source.start < PRODUCT_TABS.len())
        .count();
    assert_eq!(block_owners, 1, "HTML never claims a component line");
    assert_eq!(
        &source[found[0].source.end..],
        "\n\n## After\n\nfollowing paragraph"
    );
    let (hidden, widgets) = decorated(&source, MDX_FEATURES);
    assert_eq!(widgets, 1);
    let heading = source.find("## After").unwrap();
    assert_eq!(
        hidden.iter().map(|r| (r.start, r.end)).collect::<Vec<_>>(),
        [(heading, heading + 3)],
        "the heading renders as one"
    );
}

/// `does not let component-like text in a fenced Tab body close the
/// parser block`.
#[test]
fn component_text_in_a_fenced_tab_body_does_not_close_it() {
    let source =
        "<Tabs>\n<Tab label=\"Code\">\n```mdx\n</Tabs>\n<Unknown />\n```\n</Tab>\n</Tabs>\n\nafter";
    let found = tabs_blocks(&compiled(source, MDX_FEATURES));
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].tabs.len(), 1);
    assert_eq!(found[0].tabs[0].label, "Code");
    assert_eq!(found[0].range.end, source.find("\n\nafter").unwrap());
}

/// `keeps lowercase HTML on the HTML grammar path`; `keeps adjacent
/// component blocks independent`.
#[test]
fn lowercase_html_is_not_a_component_and_adjacent_components_stay_apart() {
    let lowercase = "<tabs><tab>ordinary HTML</tab></tabs>";
    assert!(blocks(lowercase).is_empty());
    let plans = compiled(lowercase, MDX_FEATURES);
    assert!(tabs_blocks(&plans).is_empty());
    assert!(!plans.iter().any(|p| matches!(
        p.presentation,
        Presentation::SourceFallback { code } if code.starts_with("mdx-component.")
    )));

    let second = PRODUCT_TABS
        .replace("Tab 1", "Other 1")
        .replace("Tab 2", "Other 2");
    let source = format!("{PRODUCT_TABS}\n\nbetween\n\n{second}");
    let found = tabs_blocks(&compiled(&source, MDX_FEATURES));
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].range, 0..PRODUCT_TABS.len());
    assert_eq!(found[1].range.start, source.len() - second.len());
    assert_eq!(found[1].tabs[0].label, "Other 1");
}

/// `renders authored labels as text rather than executable markup`: a
/// label is the literal text between its quotes.
#[test]
fn labels_are_the_authored_text() {
    let found =
        tabs(r#"<Tabs><Tab label="<img src=x onerror=alert(1)>">safe</Tab></Tabs>"#).unwrap();
    assert_eq!(found[0].label, "<img src=x onerror=alert(1)>");
    assert_eq!(found[0].content, "safe");
}

/// `does not turn component-like text into a widget in ordinary Puppy
/// GFM`; `projects the exact real-world regression shape as a table and
/// a Tabs block`.
#[test]
fn puppy_gfm_has_no_component_and_the_regression_is_a_table_and_tabs() {
    use crate::editor::markdown::features::{html::HtmlBlock, table::model::Table};
    let plain = compiled(PRODUCT_TABS, FEATURES);
    assert!(plain.iter().all(|p| p.embed().is_none()), "{plain:?}");
    assert_eq!(decorated(PRODUCT_TABS, FEATURES).1, 0);

    let plans = compiled(REGRESSION, MDX_FEATURES);
    let embeds: Vec<_> = plans.iter().filter_map(|p| p.embed()).collect();
    assert!(embeds.iter().any(|e| e.model::<Table>().is_some()));
    assert_eq!(tabs_blocks(&plans).len(), 1);
    assert_eq!(tabs_blocks(&plans)[0].tabs.len(), 2);
    assert!(!embeds.iter().any(|e| e.model::<HtmlBlock>().is_some()));
    assert_eq!(decorated(REGRESSION, MDX_FEATURES).1, 2);
}

#[test]
fn a_tabs_block_runs_to_its_closing_tag_around_code() {
    let doc = format!("Intro\n\n{TABS}\n\nAfter <Note/>\n");
    let found = blocks(&doc);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(doc[found[0].clone()].trim_end(), TABS);
    let tabs = tabs(TABS).unwrap();
    assert_eq!(
        tabs.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(),
        ["npm", "pnpm"]
    );
    assert!(
        tabs[0].content.contains("npm i </Tab>"),
        "fenced code is content"
    );
    assert_eq!(tabs[1].content.trim(), "**pnpm** add");
}

#[test]
fn only_literal_tabs_render() {
    let ok = |s: &str| tabs(s).is_ok();
    assert!(ok("<Tabs><Tab label=\"a\">x</Tab></Tabs>"));
    assert!(
        !ok("<Tabs id=\"x\"><Tab label=\"a\">x</Tab></Tabs>"),
        "no Tabs props"
    );
    assert!(!ok("<Tabs><Tab label={a}>x</Tab></Tabs>"), "no expressions");
    assert!(
        !ok("<Tabs><Tab label=\"a\" b=\"c\">x</Tab></Tabs>"),
        "one label"
    );
    assert!(
        !ok("<Tabs>text<Tab label=\"a\">x</Tab></Tabs>"),
        "only Tab children"
    );
    assert!(!ok("<Tabs><Tab label=\"a\">x</Tab>"), "unclosed");
    assert!(!ok("<Tabs></Tabs>"), "at least one tab");
    assert!(!ok("<Note><Tab label=\"a\">x</Tab></Note>"), "unregistered");
    assert!(!ok("<Tabs><Tab label=\"a\">x</Tab></Tabs> tail"));
    assert!(
        ok("<Tabs><Tab label=\"a\"><Badge /> x</Tab></Tabs>"),
        "nested components are content"
    );
}

#[test]
fn tabs_render_in_the_mdx_dialect_only() {
    let doc = Buffer::new(format!("Intro\n\n{TABS}\n"));
    let syntax = Syntax::parse(&doc);
    let tabs_in = |features| {
        plans::compile(&doc, &syntax, &FeatureStateStore::default(), features)
            .iter()
            .filter_map(|p| p.embed()?.model::<TabsBlock>().cloned())
            .collect::<Vec<_>>()
    };
    let found = tabs_in(MDX_FEATURES);
    assert_eq!(found.len(), 1);
    assert_eq!(doc.slice(found[0].range.clone()), TABS);
    assert!(
        tabs_in(FEATURES).is_empty(),
        "plain Markdown has no components"
    );
}

#[test]
fn tags_keep_quoted_and_braced_closers() {
    let t = tag_at("<Tab label=\"a>b\" x={c > d} />", 0).unwrap();
    assert!(t.self_closing && !t.closing);
    assert_eq!(t.name, "Tab");
    assert!(tag_at("<div>", 0).is_none(), "lowercase is HTML");
    assert!(tag_at("</Tab x>", 0).is_none());
}

#[test]
fn self_closing_tabs_at_line_start_stay_literal_source() {
    use crate::{
        editor::{
            markdown::{
                core::{
                    decorations::{self, DecorateCx},
                    presentation::block_rhythm,
                    state::PreviewState,
                },
                style::MarkdownTheme,
            },
            view::decoration::Block,
        },
        typography::Scale,
    };
    for snippet in ["<Tabs/>", "<Tabs />"] {
        assert!(tabs(snippet).is_err(), "{snippet} must not parse as Tabs");
    }
    let doc = Buffer::new("<Tabs/>\n\n<Tabs />\n");
    let syntax = Syntax::parse(&doc);
    let compiled = plans::compile(&doc, &syntax, &FeatureStateStore::default(), MDX_FEATURES);
    assert!(
        compiled
            .iter()
            .all(|p| p.embed().and_then(|e| e.model::<TabsBlock>()).is_none()),
        "self-closing <Tabs/> must not emit TabsBlock"
    );
    let rhythm = block_rhythm(&doc, &syntax, None);
    let md_theme = MarkdownTheme::resolve(true, Scale::Medium);
    let preview = PreviewState::default();
    let decorated = decorations::decorate(&DecorateCx {
        doc: &doc,
        syntax: &syntax,
        plans: &compiled,
        rhythm: &rhythm,
        theme: &md_theme,
        preview: &preview,
        live: true,
        features: MDX_FEATURES,
        assets: None,
        references: None,
        inline_preview: None,
    });
    assert!(
        decorated.hidden.is_empty(),
        "self-closing <Tabs/> lines must remain visible source: {:?}",
        decorated.hidden
    );
    assert!(
        decorated
            .blocks
            .iter()
            .all(|b| matches!(b, Block::Line { .. })),
        "self-closing <Tabs/> must not be replaced by a block widget"
    );
}
