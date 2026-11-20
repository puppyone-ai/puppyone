//! HTML flow acceptance at the production plan, sanitized surface, native
//! widget and input boundaries. DOM structure, not HTML whitespace, is the
//! contract shared with the pinned TS markdownBlockSyntax suite.
use super::{setup, setup_with_focus};
use crate::{
    editor::{
        markdown::{
            MarkdownExtension, SetAssets,
            features::html::HtmlBlock,
            shared::dom::{self, Element, Node},
        },
        registry::DocumentAssets,
        text::{selection::Selection, state::EditorState},
        view::{decoration::Block, extension::config_transaction},
    },
    typography::Scale,
};
use gpui::{Modifiers, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn html_block(source: &str) -> HtmlBlock {
    let state = EditorState::new(source);
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    let (_, plans) = markdown.parse(&state);
    let blocks: Vec<_> = plans
        .iter()
        .filter_map(|p| p.embed()?.model::<HtmlBlock>())
        .collect();
    assert_eq!(blocks.len(), 1, "one native HTML flow for {source:?}");
    blocks[0].clone()
}

fn parsed(html: &str) -> Vec<Node> {
    let dom::Parsed::Complete(nodes) = dom::parse(html) else {
        panic!("surface must accept the generated HTML: {html:?}");
    };
    nodes
}

fn descendants<'a>(nodes: &'a [Node], tag: &str) -> Vec<&'a Element> {
    let mut out = Vec::new();
    for node in nodes {
        if let Node::Element(element) = node {
            if element.tag == tag {
                out.push(element);
            }
            out.extend(descendants(&element.children, tag));
        }
    }
    out
}

#[gpui::test]
fn markdown_inside_html_keeps_its_nested_roles_and_one_native_flow(cx: &mut TestAppContext) {
    for (source, ancestors, expected) in [
        (
            "<details>\n<summary>Title</summary>\n\n- one\n- **two**\n\n</details>\n\nafter",
            &["details", "li", "strong"][..],
            "two",
        ),
        (
            "<div align=\"center\">\n\n**Bold** and [link](https://example.com)\n\n</div>",
            &["div", "strong"][..],
            "Bold",
        ),
        (
            "<table>\n<tr>\n<td>\n\n**Bold**\n\n</td>\n</tr>\n</table>",
            &["td", "strong"][..],
            "Bold",
        ),
    ] {
        let block = html_block(source);
        let nodes = parsed(&block.html);
        let mut matches = descendants(&nodes, ancestors[0]);
        for tag in &ancestors[1..] {
            matches = matches
                .into_iter()
                .flat_map(|parent| descendants(&parent.children, tag))
                .collect();
        }
        assert!(matches.iter().any(|e| e.text() == expected), "{nodes:?}");
        let (view, visual) = setup_with_focus(cx, source, false);
        draw(visual);
        view.read_with(visual, |v, _| {
            assert_eq!(
                v.decorations()
                    .blocks
                    .iter()
                    .filter(|b| matches!(b, Block::Widget { .. }))
                    .count(),
                1
            );
            assert!(v.layout().unwrap().blocks[0].bounds.size.height > gpui::px(0.));
            assert!(
                v.layout()
                    .unwrap()
                    .leaves
                    .iter()
                    .all(|leaf| !leaf.entry.text.text.contains("</"))
            );
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
    let source = "<details>\n<summary>T</summary>\n\nbody\n\n</details>";
    assert_eq!(html_block(source).range, 0..source.len());
}

#[gpui::test]
fn html_source_button_reveals_the_entire_authored_flow_without_editing(cx: &mut TestAppContext) {
    let source = "<details>\n<summary>T</summary>\n\n**body**\n\n</details>\n\nafter";
    let (view, visual) = setup(cx, source);
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    draw(visual);
    let button = visual
        .debug_bounds("md-html-widget")
        .expect("HTML source control");
    visual.simulate_click(button.center(), Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        let displayed = v
            .layout()
            .unwrap()
            .leaves
            .iter()
            .map(|leaf| leaf.entry.text.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        for literal in [
            "<details>",
            "<summary>T</summary>",
            "body",
            "</details>",
            "after",
        ] {
            assert!(
                displayed.contains(literal),
                "missing {literal:?}: {displayed:?}"
            );
        }
        assert!(
            v.decorations()
                .blocks
                .iter()
                .all(|b| !matches!(b, Block::Widget { .. }))
        );
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn markdown_images_inside_html_use_the_document_media_reader(cx: &mut TestAppContext) {
    use std::{
        io::Cursor,
        sync::{Arc, Mutex},
    };
    let source = "<div>\n\n![alt](a.png)\n\n</div>";
    let block = html_block(source);
    let nodes = parsed(&block.html);
    let images = descendants(&nodes, "img");
    assert_eq!(images.len(), 1);
    assert_eq!(images[0].attribute("src"), Some("a.png"));
    assert_eq!(images[0].attribute("alt"), Some("alt"));
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let png = png.into_inner();
    let reads = Arc::new(Mutex::new(Vec::new()));
    let observed = reads.clone();
    let (view, visual) = setup_with_focus(cx, source, false);
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetAssets(Some(DocumentAssets {
                workspace: "html-markdown-media-acceptance".into(),
                document: "notes/note.md".into(),
                read: Arc::new(move |path| {
                    observed.lock().unwrap().push(path.to_path_buf());
                    Some(png.clone())
                }),
            }))),
            cx,
        );
    });
    draw(visual);
    draw(visual);
    assert_eq!(
        *reads.lock().unwrap(),
        [std::path::PathBuf::from("notes/a.png")]
    );
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn executable_html_is_removed_from_the_native_markdown_flow(cx: &mut TestAppContext) {
    let source = "<div>\n\ntext\n\n<script>alert(1)</script>\n\n</div>";
    let block = html_block(source);
    let nodes = parsed(&block.html);
    assert!(descendants(&nodes, "script").is_empty());
    assert!(
        descendants(&nodes, "div")
            .iter()
            .all(|e| !e.text().contains("alert(1)"))
    );
    assert!(descendants(&nodes, "p").iter().any(|e| e.text() == "text"));
    let (view, visual) = setup_with_focus(cx, source, false);
    draw(visual);
    assert!(visual.debug_bounds("md-html-widget").is_some());
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[test]
fn native_html_block_conversion_preserves_the_ts_semantic_structure() {
    for (source, tag, expected) in [
        ("# H", "h1", "H"),
        ("- a\n- b", "ul", "a\nb\n"),
        ("3. a", "ol", "a\n"),
        ("> q", "blockquote", "q\n"),
        ("```\n<b>\n```", "code", "<b>\n"),
        ("---", "hr", ""),
        ("| a |\n| - |\n| b |", "table", "a\nb"),
        ("<div>x</div>", "div", "x"),
    ] {
        let nodes = dom::markdown_nodes(source);
        let elements = descendants(&nodes, tag);
        assert_eq!(elements.len(), 1, "{source:?}: {nodes:?}");
        // HTML block-boundary whitespace differs between parsers. Content
        // and semantic roles are the observable native contract.
        let text = elements[0].text();
        assert_eq!(
            text.split_whitespace().collect::<Vec<_>>(),
            expected.split_whitespace().collect::<Vec<_>>(),
            "{source:?}"
        );
        match tag {
            "ol" => assert_eq!(elements[0].attribute("start"), Some("3")),
            "ul" => assert_eq!(
                descendants(&nodes, "li")
                    .iter()
                    .map(|e| e.text())
                    .collect::<Vec<_>>(),
                ["a", "b"]
            ),
            "table" => {
                assert_eq!(descendants(&nodes, "th")[0].text(), "a");
                assert_eq!(descendants(&nodes, "td")[0].text(), "b");
            }
            "code" => {
                assert_eq!(text, "<b>\n");
                assert!(descendants(&nodes, "b").is_empty());
            }
            _ => {}
        }
    }
}

#[test]
fn native_html_inline_conversion_preserves_roles_links_images_and_escaping() {
    for (source, expected) in [
        (
            "**b** *i* ~~s~~ `c`",
            "<strong>b</strong> <em>i</em> <del>s</del> <code>c</code>",
        ),
        (
            "[x](https://example.com)",
            "<a href=\"https://example.com\">x</a>",
        ),
        ("![a](b.png)", "<img src=\"b.png\" alt=\"a\">"),
        (
            "[![a](b.png)](https://e.com)",
            "<a href=\"https://e.com\"><img src=\"b.png\" alt=\"a\"></a>",
        ),
        ("a <b>raw</b> c", "a <b>raw</b> c"),
        ("a &copy; b", "a &copy; b"),
        ("1 < 2 & 3", "1 &lt; 2 &amp; 3"),
        ("\\*x\\*", "*x*"),
        ("`<b>`", "<code>&lt;b&gt;</code>"),
    ] {
        // These are the actual DOM nodes consumed by the native HTML/MDX
        // surface. Compare inline children so paragraph wrappers and entity
        // spelling do not disguise lost text, marks, links or image nesting.
        let actual = dom::markdown_nodes(source);
        let expected = parsed(&format!("<p>{expected}</p>"));
        let paragraphs = descendants(&actual, "p");
        assert_eq!(paragraphs.len(), 1, "{source:?}");
        assert_eq!(
            paragraphs[0].children,
            descendants(&expected, "p")[0].children,
            "{source:?}"
        );
    }
    let html = dom::markdown_html("[x](a\"b)");
    assert!(
        !html.contains("a\"b"),
        "attribute quote must be escaped: {html:?}"
    );
    let nodes = parsed(&html);
    let links = descendants(&nodes, "a");
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].text(), "x");
    assert_eq!(links[0].attribute("href"), Some("a%22b"));
    assert_eq!(
        links[0].attributes.len(),
        1,
        "quoted URL cannot inject an attribute"
    );
}

#[gpui::test]
fn inline_table_context_does_not_promote_heading_or_list_prefixes(cx: &mut TestAppContext) {
    for inline in ["# not a heading", "- not a list"] {
        let source = format!("| Value |\n| --- |\n| {inline} |\n\nafter");
        let (view, visual) = setup_with_focus(cx, &source, false);
        draw(visual);
        view.read_with(visual, |v, _| {
            assert!(
                v.layout()
                    .unwrap()
                    .leaves
                    .iter()
                    .any(|leaf| leaf.entry.text.text == inline)
            );
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}

#[test]
fn html_flows_resolve_document_references_outside_their_own_source_range() {
    let flow = "<div>\n\n[x][r]\n\n</div>";
    for source in [
        format!("{flow}\n\n[r]: https://e.com"),
        format!("[r]: https://e.com\n\n{flow}"),
    ] {
        let block = html_block(&source);
        let nodes = parsed(&block.html);
        let links = descendants(&nodes, "a");
        assert_eq!(links.len(), 1, "{source:?}: {nodes:?}");
        assert_eq!(links[0].attribute("href"), Some("https://e.com"));
        assert_eq!(links[0].text(), "x");
        assert_eq!(&source[block.range], flow);
    }
    let nodes = parsed(&html_block(flow).html);
    assert!(descendants(&nodes, "a").is_empty());
    assert!(
        descendants(&nodes, "p")
            .iter()
            .any(|e| e.text() == "[x][r]")
    );
}

#[test]
fn html_reference_plans_refresh_after_definition_edits_and_keep_first_definition() {
    use crate::editor::text::{
        change::ChangeSet,
        state::{Transaction, UserEvent},
    };
    let source = "[r]: https://first.example\n\n<div>\n\n[x][r]\n\n[r]: https://second.example\n\n</div>\n\nafter";
    let mut state = EditorState::new(source);
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    for expected in ["https://first.example", "https://edited.example"] {
        let (_, plans) = markdown.parse(&state);
        let blocks: Vec<_> = plans
            .iter()
            .filter_map(|p| p.embed()?.model::<HtmlBlock>())
            .collect();
        assert_eq!(blocks.len(), 1);
        let nodes = parsed(&blocks[0].html);
        let links = descendants(&nodes, "a");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].attribute("href"), Some(expected));
        assert_eq!(links[0].text(), "x");
        assert!(!descendants(&nodes, "div")[0].text().contains("https://"));
        if expected == "https://first.example" {
            let at = source.find("first").unwrap();
            state
                .apply(Transaction::edit(
                    ChangeSet::replace(at..at + 5, "edited"),
                    None,
                    UserEvent::Input,
                ))
                .unwrap();
        }
    }
}

fn find<'a>(nodes: &'a [Node], tag: &str) -> Option<&'a Element> {
    nodes.iter().find_map(|node| match node {
        Node::Element(e) if e.tag == tag => Some(e),
        Node::Element(e) => find(&e.children, tag),
        Node::Text(_) => None,
    })
}

/// `markdownHtmlRun.test.ts`: `keeps editable inline marks for text-only
/// HTML` and `renders a text mark inside a task item`: text-only inline
/// HTML stays editable marks with its tags hidden, also inside a task.
#[gpui::test]
fn text_only_inline_html_stays_marks_also_inside_a_task(cx: &mut TestAppContext) {
    for (source, shown) in [
        (
            "<kbd>K</kbd> <ins>a</ins> <samp>b</samp> <strike>c</strike> <tt>d</tt> <var>e</var>",
            "K a b c d e",
        ),
        ("- [x] <kbd>K</kbd>", "K"),
    ] {
        let (view, cx) = setup_with_focus(cx, source, false);
        draw(cx);
        let rows = view.read_with(cx, |v, _| {
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .map(|l| l.entry.text.text.to_string())
                .collect::<Vec<_>>()
        });
        assert!(
            rows.iter().any(|r| r.ends_with(shown)),
            "{source}: {rows:?}"
        );
        assert!(rows.iter().all(|r| !r.contains('<')), "{source}: {rows:?}");
    }
}

/// `leaves an image alone in its block to the HTML block widget`; `renders
/// a picture block through the shared block widget`.
#[test]
fn an_image_alone_and_a_centered_picture_are_html_blocks() {
    let picture = r#"<picture><source media="(prefers-color-scheme: dark)" srcset="assets/dark.svg"><img src="assets/light.svg" alt="Download" width="196"></picture>"#;
    for source in [
        r#"<img src="a.png" alt="i">"#.to_owned(),
        format!("<div align=\"center\">\n  {picture}\n</div>"),
    ] {
        html_block(&source);
    }
}

/// `Markdown HTML reduction`: an unknown tag, a marquee and a form wrapper
/// are reduced to their text, script and style payloads (and event
/// handlers) are removed, a table loses its column group but keeps its
/// cells, and an ordered list keeps a valid start (an invalid one falls
/// back to 1, as an omitted attribute does).
#[test]
fn html_blocks_reduce_unsafe_parts_and_keep_the_rest() {
    for source in [
        "<div><foo>hello</foo></div>",
        "<div><marquee>hello</marquee></div>",
        "<div><form>hello</form></div>",
        "<div onclick=\"evil()\"><script>alert(1)</script>hello</div>",
        "<div><style>p{color:red}</style>hello</div>",
    ] {
        let nodes = parsed(source);
        let div = find(&nodes, "div").unwrap();
        assert_eq!(div.text(), "hello", "{source}");
        assert!(div.attribute("onclick").is_none());
        for removed in ["script", "style", "form"] {
            assert!(find(&nodes, removed).is_none(), "{source}");
        }
    }
    let nodes = parsed("<table><colgroup><col width=\"50\"></colgroup><tr><td>c</td></tr></table>");
    assert_eq!(find(&nodes, "td").unwrap().text(), "c");
    let start = |html: &str| {
        let nodes = parsed(html);
        find(&nodes, "ol")
            .unwrap()
            .attribute("start")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(1)
    };
    assert_eq!(start("<ol start=\"3\"><li>x</li></ol>"), 3);
    assert_eq!(start("<ol start=\"1e9\"><li>x</li></ol>"), 1);
}
