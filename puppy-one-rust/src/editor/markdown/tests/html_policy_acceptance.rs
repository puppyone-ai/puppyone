//! Authored HTML structure and native capability-reduction acceptance.
use super::setup_with_focus;
use crate::editor::{
    markdown::{
        MarkdownExtension,
        features::html::HtmlBlock,
        features::html::dom::{self, Node, Parsed},
    },
    text::state::EditorState,
    view::decoration::Block,
};
use crate::typography::Scale;
use gpui::TestAppContext;

#[test]
fn html_structure_preserves_authored_classification_instead_of_browser_repair() {
    for (source, expected) in [
        ("<div><span>x</span></div>", "complete"),
        ("<div>a</div><section>b</section>", "complete"),
        ("<div>a<br><img alt=\"x\"></div>", "complete"),
        ("<div><span>x</div></span>", "malformed"),
        ("</div>", "malformed"),
        ("<div><span>x</span>", "incomplete"),
        ("<div id=\"a\" id=\"b\"></div>", "malformed"),
        ("<p><div>x</div></p>", "malformed"),
        ("<table><div>x</div></table>", "malformed"),
        ("<table>text<tr><td>x</td></tr></table>", "malformed"),
        ("<div><!-- <span> --></div>", "complete"),
        ("<!-- <div> -->", "unsupported"),
        ("<!-- <div>", "incomplete"),
        ("<!DOCTYPE html>", "unsupported"),
        ("<?target value?>", "unsupported"),
        ("<![CDATA[<div>]]>", "unsupported"),
    ] {
        let parsed = dom::parse(source);
        let actual = match parsed {
            Parsed::Complete(_) => "complete",
            Parsed::Incomplete(_) => "incomplete",
            Parsed::Malformed => "malformed",
            Parsed::Unsupported => "unsupported",
        };
        assert_eq!(actual, expected, "{source}");
    }
}

#[gpui::test]
fn forbidden_html_roots_remain_literal_source_in_editable_and_read_only_surfaces(
    cx: &mut TestAppContext,
) {
    for read_only in [false, true] {
        for source in [
            "<script>value</script>",
            "<form><input></form>",
            "<iframe src=\"https://example.com\" allow=\"camera\"></iframe>",
            "<iframe src=\"http://example.com\"></iframe>",
            "<div>a</div><script>alert(1)</script>",
            "<div><a href=\"javascript:alert(1)\">x</a></div>",
        ]
        .into_iter()
        .map(str::to_owned)
        .chain(
            dom::BLOCKED_TAGS
                .iter()
                .map(|tag| format!("<{tag}></{tag}>")),
        ) {
            let (view, visual) = setup_with_focus(cx, &source, false);
            view.update(visual, |v, cx| v.set_read_only(read_only, cx));
            visual.run_until_parked();
            visual.update(|w, cx| w.draw(cx).clear(cx));
            view.read_with(visual, |v, _| {
                assert!(
                    v.decorations()
                        .blocks
                        .iter()
                        .all(|b| !matches!(b, Block::Widget { .. })),
                    "{source}"
                );
                let visible = v
                    .layout()
                    .unwrap()
                    .leaves
                    .iter()
                    .map(|l| l.entry.text.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                assert_eq!(visible, source, "read_only={read_only}");
                assert_eq!(v.text(), source);
                assert_eq!(v.state().revision, 0);
            });
            assert_eq!(visual.opened_url(), None);
        }
    }
}

#[gpui::test]
fn blocked_html_display_keeps_safe_text_and_inherited_color_painted(cx: &mut TestAppContext) {
    // The unadorned TS case and an underline that exposes the same inherited
    // text color in GPUI's actual painted scene.
    for content in ["safe", "<u>safe</u>"] {
        let source = format!("<div style=\"display: none; color: red\">{content}</div>");
        let mut markdown = MarkdownExtension::new(true, Scale::Medium);
        let state = EditorState::new(&source);
        let (_, plans) = markdown.parse(&state);
        let html: Vec<_> = plans
            .iter()
            .filter_map(|p| p.embed()?.model::<HtmlBlock>())
            .collect();
        assert_eq!(html.len(), 1);
        let Parsed::Complete(nodes) = dom::parse(&html[0].html) else {
            panic!("safe element kept")
        };
        let Node::Element(div) = &nodes[0] else {
            panic!("div kept")
        };
        assert_eq!(div.tag, "div");
        assert_eq!(div.text(), "safe");
        let (view, visual) = setup_with_focus(cx, &source, false);
        for _ in 0..3 {
            visual.run_until_parked();
            visual.update(|w, cx| w.draw(cx).clear(cx));
        }
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
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
        if content.starts_with("<u>") {
            let underlines = visual.update(|w, _| w.painted_underlines());
            assert!(
                underlines
                    .iter()
                    .any(|u| u.color == gpui::Hsla::from(gpui::rgb(0xff0000))
                        && u.bounds.size.width > gpui::ScaledPixels::default()),
                "safe red content must remain painted: {underlines:?}"
            );
        }
    }
}

#[test]
fn html_plan_rejections_keep_exact_source_ranges_and_stable_diagnostic_codes() {
    use crate::editor::markdown::core::plans::Presentation;
    let mut cases = vec![
        (
            "<div><span>x</div></span>".to_owned(),
            "htmlBlock.malformed",
        ),
        ("<p><div>x</div></p>".to_owned(), "htmlBlock.malformed"),
        ("<!-- note -->".to_owned(), "htmlBlock.unsupported"),
        ("<div>".to_owned(), "htmlBlock.incomplete"),
        (
            "<div>\n\n<section>value</div>".to_owned(),
            "htmlBlock.malformed",
        ),
        (
            "<div><a href=\"javascript:alert(1)\">x</a></div>".to_owned(),
            "htmlBlock.unsafe-href",
        ),
    ];
    cases.push(("<script>alert(1)</script>".into(), "htmlBlock.blocked-tag"));
    cases.push((
        "<div>a</div><script>alert(1)</script>".into(),
        "htmlBlock.blocked-tag",
    ));
    for (source, code) in cases {
        let mut markdown = MarkdownExtension::new(true, Scale::Medium);
        let state = EditorState::new(&source);
        let (_, plans) = markdown.parse(&state);
        let fallback: Vec<_> = plans
            .iter()
            .filter(|p| p.element.is_none() && p.is_visible_source())
            .collect();
        assert_eq!(fallback.len(), 1, "{source}: {plans:?}");
        assert_eq!(fallback[0].source, 0..source.len());
        assert_eq!(
            fallback[0].presentation,
            Presentation::SourceFallback { code }
        );
        assert!(plans.iter().all(|p| p.embed().is_none()), "{source}");
    }
}

#[gpui::test]
fn rejected_html_stays_opaque_after_prefix_edits_while_neighbor_marks_still_render(
    cx: &mut TestAppContext,
) {
    use crate::editor::{
        markdown::{SetAssets, core::plans::Presentation},
        registry::DocumentAssets,
        text::{
            change::ChangeSet,
            selection::Selection,
            state::{Transaction, UserEvent},
        },
        view::extension::config_transaction,
    };
    use std::sync::Arc;
    for block in [
        "<div><span>**literal** ![secret](a.png)</div></span>",
        "<script>**literal** ![secret](a.png)</script>",
        "<!-- **literal** ![secret](a.png) -->",
    ] {
        let source = format!(
            "{block}\n\nafter **bold**\n\nguard one\n\nguard two\n\nguard three\n\nguard four"
        );
        let (view, visual) = setup_with_focus(cx, &source, false);
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetAssets(Some(DocumentAssets {
                    workspace: "rejected-html-opaque".into(),
                    document: "note.md".into(),
                    read: Arc::new(|_| {
                        panic!("a rejected HTML range must not start image loading")
                    }),
                }))),
                cx,
            )
        });
        for shifted in [false, true] {
            if shifted {
                view.update(visual, |v, cx| {
                    v.dispatch(
                        Transaction::edit(
                            ChangeSet::replace(0..0, "preface\n\n"),
                            Some(Selection::cursor(0)),
                            UserEvent::Input,
                        ),
                        cx,
                    )
                });
            }
            for _ in 0..3 {
                visual.run_until_parked();
                visual.update(|w, cx| w.draw(cx).clear(cx));
            }
            view.read_with(visual, |v, _| {
                let leaves = &v.layout().unwrap().leaves;
                assert!(
                    leaves.iter().any(|l| l.entry.text.text == block),
                    "entire rejected source stays literal"
                );
                assert!(leaves.iter().any(|l| l.entry.text.text == "after bold"
                    && l.entry.text.marks.iter().any(|(_, s)| s.bold)));
                assert!(
                    v.decorations()
                        .inline_widgets
                        .iter()
                        .all(|w| w.as_image().is_none())
                );
                assert_eq!(
                    v.text(),
                    if shifted {
                        format!("preface\n\n{source}")
                    } else {
                        source.clone()
                    }
                );
                assert_eq!(v.state().revision, if shifted { 1 } else { 0 });
                let cache = v.extension::<MarkdownExtension>().unwrap().cache.borrow();
                let parsed = cache.parsed.as_ref().unwrap();
                let fallback = parsed
                    .plans
                    .iter()
                    .find(|p| matches!(p.presentation, Presentation::SourceFallback { .. }))
                    .unwrap();
                let start = if shifted { "preface\n\n".len() } else { 0 };
                assert_eq!(fallback.source, start..start + block.len());
            });
        }
    }
}
