//! Inline HTML acceptance through production parsing, projection and drawn text.
use super::setup_with_focus;
use crate::{
    editor::{
        markdown::{
            MarkdownExtension,
            composition::FEATURES,
            core::syntax::{Kind, Syntax},
        },
        text::{buffer::Buffer, selection::Selection},
        view::{EditorView, decoration::MarkStyle},
    },
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext};

fn parse(source: &str) -> Syntax {
    Syntax::parse_with(&Buffer::new(source), FEATURES)
}
fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| w.draw(cx).clear(cx));
}
fn rows(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<String> {
    draw(cx);
    view.read_with(cx, |v, _| {
        v.layout()
            .unwrap()
            .leaves
            .iter()
            .map(|l| l.entry.text.text.to_string())
            .collect()
    })
}
fn painted(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<(String, MarkStyle)> {
    view.read_with(cx, |v, _| {
        v.layout()
            .unwrap()
            .leaves
            .iter()
            .flat_map(|l| {
                l.entry
                    .text
                    .marks
                    .iter()
                    .map(|(r, s)| (l.entry.text.text[r.clone()].to_owned(), s.clone()))
            })
            .collect()
    })
}

#[test]
fn inline_html_keeps_unicode_marker_ranges_nested_roles_and_independent_siblings() {
    let source = "- <span style=\"color: #B45309;\">四层资产对应的产品截图或示意素材</span>";
    let s = parse(source);
    let e = s
        .elements
        .iter()
        .find(|e| e.kind == Kind::InlineHtml)
        .unwrap();
    let from = source.find('>').unwrap() + 1;
    let to = source.find("</span>").unwrap();
    assert_eq!(e.range, 2..source.len());
    assert_eq!(e.content, Some(from..to));
    assert_eq!(e.markers, vec![2..from, to..source.len()]);
    assert_eq!(e.html.as_ref().unwrap().color.as_deref(), Some("#B45309"));
    let source = "<span style=\"color: red\"><em>This is **important**</em></span>";
    let s = parse(source);
    let tags: Vec<_> = s
        .elements
        .iter()
        .filter_map(|e| e.html.as_ref().map(|h| h.name.as_str()))
        .collect();
    assert_eq!(tags, ["span", "em"]);
    assert_eq!(
        s.reveal_element(source.find("important").unwrap() + 2)
            .unwrap()
            .kind,
        Kind::Strong
    );
    let source = "<span style=\"color: red\">red</span> <span style=\"color: blue\">blue</span>";
    let s = parse(source);
    let tags: Vec<_> = s
        .elements
        .iter()
        .filter(|e| e.kind == Kind::InlineHtml)
        .collect();
    assert_eq!(tags.len(), 2);
    assert_eq!(tags[0].range, 0..source.find("</span>").unwrap() + 7);
    assert_eq!(
        tags[1].range,
        source[1..].find("<span").unwrap() + 1..source.len()
    );
    assert_eq!(
        tags[1].html.as_ref().unwrap().color.as_deref(),
        Some("blue")
    );
}

#[test]
fn inline_html_soft_line_queries_keep_the_whole_paragraph_owner() {
    let source = "Text <span>one\ntwo</span> end";
    let doc = Buffer::new(source);
    let s = Syntax::parse_with(&doc, FEATURES);
    let tags: Vec<_> = s
        .elements_in(doc.line_range(1))
        .filter(|e| e.kind == Kind::InlineHtml)
        .collect();
    assert_eq!(tags.len(), 1);
    assert_eq!(
        tags[0].range,
        source.find("<span>").unwrap()..source.find("</span>").unwrap() + 7
    );
    assert_eq!(
        tags[0].content,
        Some(source.find('>').unwrap() + 1..source.find("</span>").unwrap())
    );
    for source in [
        "Text <span>one\n\ntwo</span> end",
        "- <span>one\n- two</span>",
        "# <span>one\n# two</span>",
        "> <span>one\n\ntwo</span>",
    ] {
        assert!(
            parse(source)
                .elements
                .iter()
                .all(|e| e.kind != Kind::InlineHtml),
            "separate containers: {source}"
        );
    }
}

#[test]
fn incomplete_and_mismatched_inline_html_never_become_reveal_targets() {
    for source in [
        "Text <span>unfinished",
        "<span><em>x</span></em>",
        "<span>outer <em>inner</em>",
    ] {
        let s = parse(source);
        assert!(
            s.elements.iter().all(|e| e.kind != Kind::InlineHtml),
            "{source}: {:?}",
            s.elements
        );
        assert!(
            (0..source.len()).all(|at| s.reveal_element(at).is_none()),
            "{source}"
        );
    }
    let source = "<b>okay</b> <span>outer <em>inner</em>\n\n<span>next</span>";
    let syntax = parse(source);
    let contents: Vec<_> = syntax
        .elements
        .iter()
        .filter(|e| e.kind == Kind::InlineHtml)
        .map(|e| &source[e.content.clone().unwrap()])
        .collect();
    assert_eq!(
        contents,
        ["okay", "next"],
        "malformed ancestry must not poison independent siblings or containers"
    );
}

#[test]
fn parser_keeps_quoted_delimiters_url_slashes_and_script_less_than_text() {
    let source =
        "a <span title=\"1 > 0\" data-url=https://example.com/a style=\"color: red\">text</span>";
    let s = parse(source);
    let e = s
        .elements
        .iter()
        .find(|e| e.kind == Kind::InlineHtml)
        .unwrap();
    assert_eq!(
        &source[e.markers[0].clone()],
        "<span title=\"1 > 0\" data-url=https://example.com/a style=\"color: red\">"
    );
    assert_eq!(&source[e.content.clone().unwrap()], "text");
    assert_eq!(e.html.as_ref().unwrap().color.as_deref(), Some("red"));
    let source = "before <script>if (a < b) run()</script>";
    let s = parse(source);
    let tags: Vec<_> = s.inline_tags.iter().map(|r| &source[r.clone()]).collect();
    assert_eq!(tags, ["<script>", "</script>"]);
    assert!(s.elements.iter().all(|e| e.kind != Kind::InlineHtml));
}

#[gpui::test]
fn inline_html_paints_safe_colors_nested_markdown_and_styled_strong_labels(
    cx: &mut TestAppContext,
) {
    for (source, visible, color, bold, italic) in [
        (
            "<strong style=\"color: #92400E;\">团队待提供：</strong>",
            "团队待提供：",
            Some(0x92400eff),
            true,
            false,
        ),
        (
            "<span style=\"color: red\">This is **important**</span>",
            "This is important",
            Some(0xff0000ff),
            true,
            false,
        ),
        ("**bold and _italic_**", "bold and italic", None, true, true),
        (
            "- <span style=\"color: #B45309;\">orange</span>",
            "orange",
            Some(0xb45309ff),
            false,
            false,
        ),
        (
            "<span style=\"display: none; color: red\">text</span>",
            "text",
            Some(0xff0000ff),
            false,
            false,
        ),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        assert_eq!(rows(&view, visual), [visible]);
        let marks = painted(&view, visual);
        if let Some(color) = color {
            assert!(
                marks.iter().any(|(_, s)| s.color == Some(color)),
                "{source}: {marks:?}"
            );
        }
        assert_eq!(marks.iter().any(|(_, s)| s.bold), bold);
        assert_eq!(marks.iter().any(|(_, s)| s.italic), italic);
        view.read_with(visual, |v, _| {
            if source.starts_with("- <span") {
                let expected = [
                    2..source.find('>').unwrap() + 1,
                    source.find("</span>").unwrap()..source.len(),
                ];
                // Adjacent list/HTML markers are coalesced by the native view.
                // Restrict to the authored HTML span before comparing exactly.
                for ranges in [&v.decorations().hidden, &v.decorations().atomic] {
                    let within_html: Vec<_> = ranges
                        .iter()
                        .filter_map(|r| {
                            let clipped = r.start.max(2)..r.end.min(source.len());
                            (!clipped.is_empty()).then_some(clipped)
                        })
                        .collect();
                    assert_eq!(within_html, expected);
                }
            }
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}

#[gpui::test]
fn revealing_inline_html_keeps_content_color_and_only_collapses_markers(cx: &mut TestAppContext) {
    let head = "<span style=\"color: red\">text</span>";
    let source = format!("{head}\n\nend");
    let (view, visual) = setup_with_focus(cx, &source, true);
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    assert_eq!(rows(&view, visual)[0], "text");
    view.read_with(visual, |v, _| {
        assert_eq!(v.decorations().atomic, v.decorations().hidden);
        assert_eq!(
            v.decorations().hidden,
            vec![
                0..head.find('>').unwrap() + 1,
                head.find("</span>").unwrap()..head.len()
            ]
        );
    });
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(head.find("text").unwrap() + 1), cx)
    });
    assert_eq!(rows(&view, visual)[0], head);
    assert!(
        painted(&view, visual)
            .iter()
            .any(|(text, s)| text == "text" && s.color == Some(0xff0000ff))
    );
    view.read_with(visual, |v, _| {
        assert!(v.decorations().hidden.is_empty());
        assert!(v.decorations().atomic.is_empty());
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn unsupported_inline_html_is_visible_and_block_ownership_comes_from_the_parser(
    cx: &mut TestAppContext,
) {
    for source in [
        "before <script>alert(1)</script>",
        "before <script>if (a < b) run()</script>",
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        assert_eq!(rows(&view, visual), [source]);
        view.read_with(visual, |v, _| {
            assert!(v.decorations().hidden.is_empty());
            assert!(v.decorations().atomic.is_empty());
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
    for (source, block) in [
        ("<strong style=\"color: red\">text</strong>", false),
        ("<div>\ncontent\n</div>", true),
        ("<script>\nif (a < b) run()\n</script>", true),
    ] {
        let mut md = MarkdownExtension::new(true, Scale::Medium);
        let (s, _) = md.parse(&crate::editor::text::state::EditorState::new(source));
        assert_eq!(!s.html_blocks.is_empty(), block, "{source}");
    }
}

#[test]
fn html_heavy_range_queries_bound_candidates_to_the_requested_paragraph() {
    let source = (0..5000)
        .map(|i| format!("<span data-index=\"{i}\">paragraph {i}</span>\n\n"))
        .collect::<String>();
    let doc = Buffer::new(&source);
    let syntax = Syntax::parse_with(&doc, FEATURES);
    assert!(doc.line_count() >= 10000);
    for line in [0, 100, 4998, 9998] {
        let query = syntax.elements_in(doc.line_range(line));
        // The production iterator exposes its candidate bound before filtering;
        // a full-document scan would report thousands of candidates here.
        assert_eq!(query.size_hint().1, Some(1));
        let entries: Vec<_> = query.collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, Kind::InlineHtml);
        assert_eq!(
            doc.slice(entries[0].content.clone().unwrap()),
            format!("paragraph {}", line / 2)
        );
    }
}

#[gpui::test]
fn late_inline_html_viewport_repaints_changed_color_and_shifted_ranges(cx: &mut TestAppContext) {
    use crate::editor::text::{
        change::ChangeSet,
        state::{Transaction, UserEvent},
    };
    let early = "<span style=\"color: red\">early</span>";
    let late = "<span style=\"color: blue\">late</span>";
    let filler = (0..2500)
        .map(|i| {
            format!(
                "- Paragraph {i}: **context** [reference](note-{i}.md) {}\n",
                "detail ".repeat(6)
            )
        })
        .collect::<String>();
    let mut source = format!("{early}\n{filler}{late}");
    let (view, visual) = setup_with_focus(cx, &source, false);
    assert!(!rows(&view, visual).iter().any(|s| s == "late"));
    for step in 0..3 {
        if step == 1 {
            let start = source.rfind("blue").unwrap();
            view.update(visual, |v, cx| {
                v.dispatch(
                    Transaction::edit(
                        ChangeSet::replace(start..start + 4, "green"),
                        None,
                        UserEvent::Input,
                    ),
                    cx,
                )
            });
            source.replace_range(start..start + 4, "green");
        } else if step == 2 {
            view.update(visual, |v, cx| {
                v.dispatch(
                    Transaction::edit(
                        ChangeSet::replace(0..0, "prefix\n\n"),
                        None,
                        UserEvent::Input,
                    ),
                    cx,
                )
            });
            source.insert_str(0, "prefix\n\n");
        }
        view.update(visual, |v, cx| v.set_scroll_top(1e9, cx));
        for _ in 0..3 {
            draw(visual);
        }
        assert!(rows(&view, visual).iter().any(|s| s == "late"));
        let expected = if step == 0 { 0x0000ffff } else { 0x008000ff };
        assert!(
            painted(&view, visual)
                .iter()
                .any(|(text, mark)| text == "late" && mark.color == Some(expected))
        );
        view.read_with(visual, |v, _| {
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, step);
        });
    }
}

/// `render-plan.test.ts`: `compiles styled span list items into inlineMark
/// plans`, `keeps incomplete inline HTML as visibleSource without deletion
/// units`, `indexes plans by document and syntax tree identity`;
/// `markdownInlineHtml.test.ts`: `reduces unsafe attributes while
/// preserving honest safe structure`, `rejects unsafe style url() values`.
/// A safe element is a revealable mark whose two tags delete as units; only
/// its safe colours style it (event handlers, `display` and `url()` values
/// are dropped, never hiding the text). The product's reduction diagnostics
/// are inspection data, not shown.
#[test]
fn inline_html_compiles_safe_marks_and_drops_unsafe_attributes() {
    use crate::editor::markdown::core::{
        plans::{self, Presentation},
        state::FeatureStateStore,
    };
    let compiled = |source: &str| {
        let doc = Buffer::new(source);
        let syntax = Syntax::parse_with(&doc, FEATURES);
        let plans = plans::compile(&doc, &syntax, &FeatureStateStore::default(), FEATURES);
        (syntax, plans)
    };
    let source = "- <span style=\"color: #B45309;\">screenshot</span>";
    let (syntax, plans) = compiled(source);
    let (index, html) = syntax
        .elements
        .iter()
        .enumerate()
        .find(|(_, e)| e.kind == Kind::InlineHtml)
        .unwrap();
    let tag = html.html.as_deref().unwrap();
    assert_eq!(
        (tag.name.as_str(), tag.color.as_deref()),
        ("span", Some("#B45309"))
    );
    let plan = plans.iter().find(|p| p.element == Some(index)).unwrap();
    assert!(matches!(plan.presentation, Presentation::InlineMark { .. }));
    assert_eq!(plan.delete_units.len(), 2);
    assert_eq!(
        syntax
            .reveal_element(source.find("screen").unwrap())
            .map(|e| e.kind),
        Some(Kind::InlineHtml)
    );

    let (syntax, plans) = compiled("Text <span>unfinished");
    assert!(syntax.elements.iter().all(|e| e.kind != Kind::InlineHtml));
    assert!(plans.iter().all(|p| p.delete_units.is_empty()));

    let (_, plans) = compiled("<kbd>Cmd</kbd> + <span style=\"color: red\">R</span>");
    assert_eq!(
        plans
            .iter()
            .filter(|p| matches!(p.presentation, Presentation::InlineMark { .. }))
            .count(),
        2
    );

    for (source, color) in [
        (
            "<span style=\"display: none; color: red\">text</span>",
            Some("red"),
        ),
        (
            "<span onclick=\"alert(1)\" style=\"color: blue\">text</span>",
            Some("blue"),
        ),
        (
            "<span style=\"color: url(https://example.com/x)\">text</span>",
            None,
        ),
    ] {
        let syntax = parse(source);
        let html = syntax
            .elements
            .iter()
            .find(|e| e.kind == Kind::InlineHtml)
            .unwrap();
        let tag = html.html.as_deref().unwrap();
        assert_eq!(tag.color.as_deref(), color, "{source}");
        assert_eq!(&source[html.content.clone().unwrap()], "text");
    }
}

/// `markdownUrlPolicy.test.ts`: `compiles unsafe HTML anchors to unsupported
/// visible source`; `compiles safe HTML anchors without a live href
/// attribute` (activation goes through the URL policy, to the canonical
/// URL).
#[test]
fn an_anchor_the_url_policy_refuses_stays_source() {
    let unsafe_anchor = parse("<a href=\"java&#10;script:alert(1)\">x</a>");
    assert!(
        unsafe_anchor
            .elements
            .iter()
            .all(|e| e.kind != Kind::InlineHtml)
    );
    let safe = parse("<a href=\"https://example.com\">x</a>");
    let anchor = safe
        .elements
        .iter()
        .find(|e| e.kind == Kind::InlineHtml)
        .unwrap();
    let href = anchor.href.as_deref().unwrap();
    assert_eq!(
        crate::editor::markdown::platform::link::safe_href(href).as_deref(),
        Some("https://example.com/")
    );
}
