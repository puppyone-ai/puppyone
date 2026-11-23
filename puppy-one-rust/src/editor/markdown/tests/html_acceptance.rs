//! HTML flow acceptance at the production plan, sanitized surface, native
//! widget and input boundaries. DOM structure, not HTML whitespace, is the
//! contract shared with the pinned TS markdownBlockSyntax suite.
use super::{setup, setup_with_focus};
use crate::{
    editor::{
        markdown::{
            MarkdownExtension, SetAssets,
            features::html::HtmlBlock,
            features::html::dom::{self, Element, Node},
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
    visual.simulate_mouse_move(button.center(), None, Modifiers::none());
    draw(visual);
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

const CENTERED_README_HEADER: &str = "<div align=\"center\">\n  <img src=\"public/assets/brand/puppy/puppy-dark.svg\" alt=\"puppyone Logo\" width=\"72\" height=\"72\" />\n\n  <h1>puppyone</h1>\n\n  <p><b>A local-first editor. Built for you and your agents.</b></p>\n\n  <p>\n    <a href=\"https://www.puppyone.ai\"><img src=\"https://img.shields.io/badge/Website-puppyone.ai-39BC66?style=flat-square\" alt=\"Website\" /></a>\n    <a href=\"https://www.puppyone.ai/doc\"><img src=\"https://img.shields.io/badge/Docs-Read-D7F3FF?style=flat-square&logo=readthedocs&logoColor=black\" alt=\"Documentation\" /></a>\n    <a href=\"https://discord.gg/zwJ9Y3Uvpd\"><img src=\"https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white\" alt=\"Discord\" /></a>\n    <a href=\"https://x.com/puppyone_ai\"><img src=\"https://img.shields.io/badge/X-(Twitter)-000000?style=flat-square&logo=x&logoColor=white\" alt=\"X\" /></a>\n  </p>\n</div>";

/// `markdownHtmlConformance.test.ts`: `mounts the complete README header
/// instead of raw fragments` (editable and read-only) — one HTML widget
/// for the whole blank-line-split header, with its five images and four
/// links and none of its tags as text; `keeps accessible alt text when a
/// … image is unavailable` (an unresolved local or a plain-HTTP image).
#[gpui::test]
fn the_readme_header_mounts_whole_and_missing_images_keep_their_alt(cx: &mut TestAppContext) {
    for read_only in [false, true] {
        let (view, cx) = setup_with_focus(cx, CENTERED_README_HEADER, false);
        view.update_in(cx, |v, _, cx| v.set_read_only(read_only, cx));
        draw(cx);
        view.read_with(cx, |v, _| {
            let widgets = v
                .decorations()
                .blocks
                .iter()
                .filter(|b| matches!(b, Block::Widget { .. }))
                .count();
            assert_eq!(widgets, 1, "read_only={read_only}");
            assert_eq!(v.text(), CENTERED_README_HEADER);
        });
        let nodes = parsed(&html_block(CENTERED_README_HEADER).html);
        assert_eq!(descendants(&nodes, "img").len(), 5);
        assert_eq!(descendants(&nodes, "a").len(), 4);
    }
    for href in ["http://example.com/tracker.png", "missing/logo.png"] {
        let source = format!("<img src=\"{href}\" alt=\"Missing logo\">");
        let (view, cx) = setup_with_focus(cx, &source, false);
        view.update(cx, |v, cx| {
            v.dispatch(
                config_transaction(SetAssets(Some(DocumentAssets {
                    workspace: "html-missing-image".into(),
                    document: "README.md".into(),
                    read: std::sync::Arc::new(|_| None),
                }))),
                cx,
            );
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while cx.debug_bounds("md-html-chip:Missing logo").is_none() {
            assert!(std::time::Instant::now() < deadline, "{href}");
            draw(cx);
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
}

struct SplitPanes {
    left: gpui::Entity<crate::editor::view::EditorView>,
    right: gpui::Entity<crate::editor::view::EditorView>,
}

impl gpui::Render for SplitPanes {
    fn render(
        &mut self,
        _window: &mut gpui::Window,
        _cx: &mut gpui::Context<Self>,
    ) -> impl gpui::IntoElement {
        use gpui::{ParentElement, Styled, div};
        div()
            .size_full()
            .flex()
            .child(div().flex_1().h_full().child(self.left.clone()))
            .child(div().flex_1().h_full().child(self.right.clone()))
    }
}

fn setup_two_panes<'a>(
    cx: &'a mut TestAppContext,
    left_source: &str,
    right_source: &str,
) -> (
    gpui::Entity<crate::editor::view::EditorView>,
    gpui::Entity<crate::editor::view::EditorView>,
    &'a mut VisualTestContext,
) {
    use crate::editor::view::{EditorView, bind_keys, style};
    use gpui::AppContext;
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let left_text = left_source.to_owned();
    let right_text = right_source.to_owned();
    let (root, visual) = cx.add_window_view(move |_, cx| SplitPanes {
        left: cx.new(|cx| {
            EditorView::new(
                &left_text,
                Box::new(MarkdownExtension::new(true, Scale::Medium)),
                cx,
            )
        }),
        right: cx.new(|cx| {
            EditorView::new(
                &right_text,
                Box::new(MarkdownExtension::new(true, Scale::Medium)),
                cx,
            )
        }),
    });
    visual.run_until_parked();
    let (left, right) = root.read_with(visual, |r, _| (r.left.clone(), r.right.clone()));
    (left, right, visual)
}

/// Rust-native (M6 per-pane `<details>` disclosure session): two separate panes
/// displaying the exact same Markdown document toggle `<details>` disclosure
/// state independently without cross-pane bleed.
#[gpui::test]
fn details_disclosure_is_isolated_between_two_panes_showing_same_document(cx: &mut TestAppContext) {
    use crate::editor::markdown::platform::sessions::disclosure;

    let source = "<details>\n<summary>Show notes</summary>\n\nLine 1\n\nLine 2\n\nLine 3\n\n</details>\n\nafter";
    let (pane_a, pane_b, visual) = setup_two_panes(cx, source, source);
    for _ in 0..3 {
        draw(visual);
    }

    let block_bounds = |view: &gpui::Entity<crate::editor::view::EditorView>,
                        visual: &mut VisualTestContext| {
        view.read_with(visual, |v, _| v.layout().unwrap().blocks[0].bounds)
    };
    let block_height = |view: &gpui::Entity<crate::editor::view::EditorView>,
                        visual: &mut VisualTestContext| {
        f32::from(block_bounds(view, visual).size.height)
    };
    let summary_click_point = |view: &gpui::Entity<crate::editor::view::EditorView>,
                               visual: &mut VisualTestContext| {
        let b = block_bounds(view, visual);
        gpui::point(b.origin.x + gpui::px(24.), b.origin.y + gpui::px(12.))
    };
    let block_id_of = |view: &gpui::Entity<crate::editor::view::EditorView>,
                       visual: &mut VisualTestContext| {
        view.read_with(visual, |v, _| {
            v.decorations()
                .blocks
                .iter()
                .find_map(|b| match b {
                    Block::Widget { id, .. } => Some(*id),
                    _ => None,
                })
                .expect("expected HTML Block::Widget")
        })
    };

    let collapsed_a = block_height(&pane_a, visual);
    let collapsed_b = block_height(&pane_b, visual);
    let id_a = block_id_of(&pane_a, visual);
    let id_b = block_id_of(&pane_b, visual);
    let store_a = pane_a.read_with(visual, |v, _| v.widget_states());
    let store_b = pane_b.read_with(visual, |v, _| v.widget_states());
    assert!(!disclosure::is_toggled(&mut store_a.borrow_mut(), id_a, 0));
    assert!(!disclosure::is_toggled(&mut store_b.borrow_mut(), id_b, 0));

    // Click `<summary>` in pane A only.
    let click_a = summary_click_point(&pane_a, visual);
    visual.simulate_click(click_a, Modifiers::none());
    for _ in 0..3 {
        draw(visual);
    }

    let expanded_a = block_height(&pane_a, visual);
    let after_b = block_height(&pane_b, visual);
    assert!(
        disclosure::is_toggled(&mut store_a.borrow_mut(), id_a, 0),
        "positive control: clicking summary in pane A must toggle pane A disclosure"
    );
    assert!(
        expanded_a > collapsed_a + 20.0,
        "positive control: pane A details block must grow when expanded ({collapsed_a} -> {expanded_a})"
    );
    assert!(
        !disclosure::is_toggled(&mut store_b.borrow_mut(), id_b, 0),
        "pane B disclosure must stay collapsed when pane A toggles"
    );
    assert!(
        (after_b - collapsed_b).abs() <= 0.5,
        "pane B height must stay unchanged ({collapsed_b} -> {after_b})"
    );

    // Positive control: pane B toggles independently; collapsing pane A leaves pane B open.
    let click_b = summary_click_point(&pane_b, visual);
    visual.simulate_click(click_b, Modifiers::none());
    visual.simulate_click(click_a, Modifiers::none());
    for _ in 0..3 {
        draw(visual);
    }
    assert!(!disclosure::is_toggled(&mut store_a.borrow_mut(), id_a, 0));
    assert!(disclosure::is_toggled(&mut store_b.borrow_mut(), id_b, 0));
    assert!(block_height(&pane_b, visual) > collapsed_b + 20.0);
}

/// Rust-native (M6 per-pane `<details>` disclosure session): two different
/// documents that both start with `<details>` at byte offset 0 toggle
/// disclosure independently; inserting text above preserves the open state via
/// `BlockId`, and removing the block evicts its session.
#[gpui::test]
fn details_disclosure_is_isolated_between_two_documents_with_same_block_offset(
    cx: &mut TestAppContext,
) {
    use crate::editor::{
        markdown::platform::sessions::disclosure,
        text::{
            change::ChangeSet,
            state::{Transaction, UserEvent},
        },
    };

    let doc_a = "<details>\n<summary>Doc A</summary>\n\nAlpha 1\n\nAlpha 2\n\n</details>\n";
    let doc_b = "<details>\n<summary>Doc B</summary>\n\nBeta 1\n\nBeta 2\n\n</details>\n";
    let (view_a, view_b, visual) = setup_two_panes(cx, doc_a, doc_b);
    for _ in 0..3 {
        draw(visual);
    }

    let first_widget_id = |view: &gpui::Entity<crate::editor::view::EditorView>,
                           visual: &mut VisualTestContext| {
        view.read_with(visual, |v, _| {
            v.decorations()
                .blocks
                .iter()
                .find_map(|b| match b {
                    Block::Widget { id, .. } => Some(*id),
                    _ => None,
                })
                .expect("expected HTML widget")
        })
    };

    let id_a = first_widget_id(&view_a, visual);
    let id_b = first_widget_id(&view_b, visual);
    assert_eq!(
        id_a.raw(),
        id_b.raw(),
        "positive control: both documents assign identical BlockId at offset 0"
    );

    let bounds_a = view_a.read_with(visual, |v, _| v.layout().unwrap().blocks[0].bounds);
    visual.simulate_click(
        gpui::point(
            bounds_a.origin.x + gpui::px(24.),
            bounds_a.origin.y + gpui::px(12.),
        ),
        Modifiers::none(),
    );
    for _ in 0..3 {
        draw(visual);
    }

    let store_a = view_a.read_with(visual, |v, _| v.widget_states());
    let store_b = view_b.read_with(visual, |v, _| v.widget_states());
    assert!(disclosure::is_toggled(&mut store_a.borrow_mut(), id_a, 0));
    assert!(
        !disclosure::is_toggled(&mut store_b.borrow_mut(), id_b, 0),
        "doc B at identical offset 0 must not inherit doc A's disclosure toggle"
    );

    // Prefix insert in doc A shifts the block's byte offset while keeping its BlockId open.
    view_a.update(visual, |v, cx| {
        let tr = Transaction::edit(
            ChangeSet::replace(0..0, "# Heading\n\n"),
            Some(Selection::cursor(0)),
            UserEvent::Input,
        );
        v.dispatch(tr, cx);
    });
    for _ in 0..3 {
        draw(visual);
    }
    let shifted_id_a = first_widget_id(&view_a, visual);
    assert_eq!(
        shifted_id_a, id_a,
        "BlockId must stay stable across prefix edit"
    );
    assert!(disclosure::is_toggled(
        &mut store_a.borrow_mut(),
        shifted_id_a,
        0
    ));

    // Removing the HTML block evicts its DisclosureSession from doc A's WidgetStateStore.
    view_a.update(visual, |v, cx| {
        let len = v.state().doc.len();
        let tr = Transaction::edit(
            ChangeSet::replace(0..len, "plain paragraph\n"),
            Some(Selection::cursor(0)),
            UserEvent::Input,
        );
        v.dispatch(tr, cx);
    });
    draw(visual);
    assert!(!disclosure::is_toggled(&mut store_a.borrow_mut(), id_a, 0));
}
