//! Inline HTML runs (`markdownHtmlRun.test.ts`, `markdownImageReadiness.test.ts`
//! #1–#2, `markdownVideoEmbed.test.ts` #4; gap `markdown-inline-html-runs`):
//! balanced inline HTML the inline-editable profile cannot style shows as
//! what it renders, in paragraphs, list and task items, headings, quotes and
//! table cells, and as its exact source once the caret touches it.
use super::{setup, setup_with_focus};
use crate::editor::{
    markdown::{
        SetAssets,
        composition::FEATURES,
        core::{
            plans::{self, Presentation},
            syntax::{Kind, Syntax},
        },
        features::html::run,
    },
    registry::DocumentAssets,
    text::{
        buffer::Buffer,
        change::ChangeSet,
        selection::Selection,
        state::{Transaction, UserEvent},
    },
    view::{
        EditorView,
        decoration::MarkStyle,
        extension::{SetAppearance, SetReadOnly, config_transaction},
    },
};
use gpui::{Entity, TestAppContext, VisualTestContext};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const LINK: &str = "https://example.com/download";
const PICTURE: &str = "<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"assets/dark.svg\"><img src=\"assets/light.svg\" alt=\"Download\" width=\"196\"></picture>";

fn linked_picture() -> String {
    format!("<a href=\"{LINK}\">{PICTURE}</a>")
}

fn svg() -> Vec<u8> {
    br#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>"#.to_vec()
}

/// A document's asset broker that serves an SVG for every path and records
/// the paths it was asked for.
fn assets(document: &str) -> (DocumentAssets, Arc<Mutex<Vec<PathBuf>>>) {
    let reads = Arc::new(Mutex::new(Vec::new()));
    let log = reads.clone();
    (
        DocumentAssets {
            workspace: "workspace:html-run".into(),
            document: PathBuf::from(document),
            read: Arc::new(move |path: &Path| {
                log.lock().unwrap().push(path.to_path_buf());
                Some(svg())
            }),
        },
        reads,
    )
}

fn draw(cx: &mut VisualTestContext) {
    for _ in 0..4 {
        cx.run_until_parked();
        cx.update(|w, cx| w.draw(cx).clear(cx));
    }
}

/// A read-only view of `source` (as the product's README preview), with an
/// asset broker unless `brokered` is false.
fn mount<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
    brokered: bool,
) -> (
    Entity<EditorView>,
    &'a mut VisualTestContext,
    Arc<Mutex<Vec<PathBuf>>>,
) {
    cx.executor().allow_parking();
    let (view, visual) = setup_with_focus(cx, source, false);
    let (media, reads) = assets("README.md");
    view.update_in(visual, |v, _, cx| {
        if brokered {
            v.dispatch(config_transaction(SetAssets(Some(media))), cx);
        }
        v.dispatch(config_transaction(SetReadOnly(true)), cx);
    });
    draw(visual);
    (view, visual, reads)
}

/// An editable, focused view of `source`, brokered.
fn mount_editable<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.executor().allow_parking();
    let (view, visual) = setup(cx, source);
    let (media, _) = assets("note.md");
    view.update_in(visual, |v, _, cx| {
        v.dispatch(config_transaction(SetAssets(Some(media))), cx);
    });
    draw(visual);
    (view, visual)
}

/// The text each drawn row shows.
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

/// All drawn text, rows joined by newlines, without the room kept for images.
fn shown(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> String {
    rows(view, cx)
        .join("\n")
        .chars()
        .filter(|c| !matches!(c, '\u{2002}'..='\u{200a}'))
        .collect()
}

fn painted(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<(String, MarkStyle)> {
    draw(cx);
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

fn parse(source: &str) -> Syntax {
    Syntax::parse_with(&Buffer::new(source), FEATURES)
}

fn run_ranges(source: &str) -> Vec<std::ops::Range<usize>> {
    parse(source)
        .elements
        .iter()
        .filter(|e| e.kind == Kind::HtmlRun)
        .map(|e| e.range.clone())
        .collect()
}

/// The runs drawn in the frame: their first tag hidden or drawn over.
fn runs(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> usize {
    draw(cx);
    let text = view.read_with(cx, |v, _| v.text().to_owned());
    let syntax = parse(&text);
    view.update(cx, |v, _| {
        let d = v.decorations();
        syntax
            .elements
            .iter()
            .filter(|e| e.kind == Kind::HtmlRun)
            .filter(|e| {
                let first = &e.markers[0];
                d.hidden
                    .iter()
                    .any(|h| h.start <= first.start && first.end <= h.end)
                    || d.inline_widgets
                        .iter()
                        .any(|w| w.range.start <= first.start && first.end <= w.range.end)
            })
            .count()
    })
}

/// Embedded runs (a run filling its lines) in the frame.
fn embedded(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> usize {
    draw(cx);
    view.update(cx, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .filter(|b| matches!(b, crate::editor::view::decoration::Block::Line { style, .. } if style.embed.is_some()))
            .count()
    })
}

/// `markdownHtmlRun.test.ts` #0: the README's linked theme-aware download
/// cards in a list item draw as two runs, link and picture intact.
#[gpui::test]
fn readme_download_cards_draw_as_linked_theme_pictures(cx: &mut TestAppContext) {
    let card = linked_picture();
    let source = format!("1. **Get it.**\n\n   {card}\n   {card}\n\n2. Open a folder.");
    let (view, visual, reads) = mount(cx, &source, true);
    assert_eq!(runs(&view, visual), 2);
    assert_eq!(embedded(&view, visual), 2);
    assert!(
        !shown(&view, visual).contains('<'),
        "{:?}",
        rows(&view, visual)
    );
    assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), source);
    // The run keeps the link and the picture's media query.
    let syntax = parse(&source);
    let run_el = syntax
        .elements
        .iter()
        .find(|e| e.kind == Kind::HtmlRun)
        .unwrap();
    let nodes = run::admit(run_el.text.as_deref().unwrap()).unwrap();
    let crate::editor::markdown::features::html::sanitize::Node::Element(a) = &nodes[0] else {
        panic!("{nodes:?}")
    };
    assert_eq!((a.tag.as_str(), a.attribute("href")), ("a", Some(LINK)));
    // The editor's colour mode picks the picture's source: dark, then light.
    draw(visual);
    assert!(view.read_with(visual, |v, _| v.dark()));
    assert_eq!(
        *reads.lock().unwrap(),
        vec![PathBuf::from("assets/dark.svg")]
    );
    let image = visual
        .debug_bounds("md-html-img")
        .expect("the card image is drawn");
    assert_eq!(f32::from(image.size.width), 196.);
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetAppearance {
                dark: false,
                scale: crate::typography::Scale::Medium,
            }),
            cx,
        )
    });
    draw(visual);
    assert!(
        reads
            .lock()
            .unwrap()
            .contains(&PathBuf::from("assets/light.svg")),
        "{:?}",
        reads.lock().unwrap()
    );
}

/// The picture source a colour mode picks (`<source media>`, else `<img>`).
#[test]
fn a_picture_follows_the_colour_mode() {
    let sources = || {
        [
            (Some("(prefers-color-scheme: dark)"), Some("dark.svg")),
            (
                Some("(prefers-color-scheme: light)"),
                Some("light-source.svg"),
            ),
        ]
        .into_iter()
    };
    assert_eq!(
        run::picture_source(sources(), Some("img.svg"), true).as_deref(),
        Some("dark.svg")
    );
    assert_eq!(
        run::picture_source(sources(), Some("img.svg"), false).as_deref(),
        Some("light-source.svg")
    );
    let dark_only = [(Some("(prefers-color-scheme: dark)"), Some("dark.svg"))];
    assert_eq!(
        run::picture_source(dark_only.into_iter(), Some("img.svg"), false).as_deref(),
        Some("img.svg")
    );
}

/// #1: the list continuation indent stays outside the run.
#[test]
fn the_list_continuation_indent_stays_outside_the_run() {
    let source = format!("1. Item\n\n   {}", linked_picture());
    assert_eq!(
        run_ranges(&source),
        vec![source.find("<a").unwrap()..source.len()]
    );
}

/// #2–#8: linked images, two images, a span around an image, heading, list
/// and quote marker images and a theme picture draw without exposing tags.
#[gpui::test]
fn runs_draw_without_exposing_tags(cx: &mut TestAppContext) {
    let cases: Vec<(String, usize)> = vec![
        (
            format!("<a href=\"{LINK}\"><img src=\"a.png\" alt=\"i\"></a>"),
            1,
        ),
        (
            "<img src=\"a.png\" alt=\"a\"> <img src=\"b.png\" alt=\"b\">".into(),
            2,
        ),
        ("<span><img src=\"a.png\" alt=\"i\"></span>".into(), 1),
        (
            "# Title <img src=\"a.png\" alt=\"i\" width=\"20\">".into(),
            1,
        ),
        ("- <img src=\"a.png\" alt=\"i\">".into(), 1),
        ("> <img src=\"a.png\" alt=\"i\">".into(), 1),
        (PICTURE.into(), 1),
    ];
    for (source, count) in cases {
        let (view, visual, _) = mount(cx, &source, true);
        assert_eq!(runs(&view, visual), count, "{source}");
        let text = shown(&view, visual);
        assert!(!text.contains('<'), "{source}: {text:?}");
    }
}

/// #9: the text around a run stays ordinary document text.
#[gpui::test]
fn text_around_a_run_stays_ordinary_text(cx: &mut TestAppContext) {
    let source = "before <img src=\"a.png\" alt=\"i\"> **after**";
    let (view, visual, _) = mount(cx, source, true);
    assert_eq!(runs(&view, visual), 1);
    let text = shown(&view, visual);
    assert!(
        text.starts_with("before ") && text.ends_with(" after"),
        "{text:?}"
    );
    assert!(!text.contains('<') && !text.contains("**"), "{text:?}");
    let strong = painted(&view, visual)
        .into_iter()
        .find(|(t, _)| t == "after")
        .expect("after is marked");
    assert!(strong.1.bold, "{strong:?}");
}

/// #10: Markdown inside a run renders, and escaped text never reads as HTML.
#[gpui::test]
fn markdown_inside_a_run_renders_but_escaped_text_stays_text(cx: &mut TestAppContext) {
    let source = "head <center>**bold** &lt;b&gt;plain&lt;/b&gt;</center> tail";
    let (view, visual, _) = mount(cx, source, true);
    assert_eq!(runs(&view, visual), 1);
    let text = shown(&view, visual);
    assert!(text.contains("<b>plain</b>"), "{text:?}");
    assert!(
        !text.contains("<center>") && !text.contains("**"),
        "{text:?}"
    );
    let marks = painted(&view, visual);
    let bold = |s: &str| marks.iter().any(|(t, m)| t.contains(s) && m.bold);
    assert!(bold("bold"), "{marks:?}");
    assert!(!bold("plain"), "the escaped <b> is no element: {marks:?}");
}

/// #11–#13: an HTML block sharing its line with a list, ordered list or quote
/// marker draws as a block run that keeps the marker.
#[gpui::test]
fn html_blocks_on_marker_lines_draw_as_block_runs(cx: &mut TestAppContext) {
    for (source, text) in [
        ("- <div align=\"center\">hi</div>", "hi"),
        ("1. <details><summary>S</summary>Body</details>", "SBody"),
        ("> <details><summary>S</summary>Body</details>", "SBody"),
    ] {
        let syntax = parse(source);
        let run_el = syntax
            .elements
            .iter()
            .find(|e| e.kind == Kind::HtmlRun)
            .unwrap_or_else(|| panic!("{source}: no run"));
        let nodes = run::admit(run_el.text.as_deref().unwrap()).unwrap();
        let shown_text: String = nodes
            .iter()
            .map(|n| match n {
                crate::editor::markdown::features::html::sanitize::Node::Element(e) => e.text(),
                crate::editor::markdown::features::html::sanitize::Node::Text(t) => t.clone(),
            })
            .collect();
        assert_eq!(shown_text, text, "{source}");
        let (view, visual, _) = mount(cx, source, true);
        assert_eq!(
            (runs(&view, visual), embedded(&view, visual)),
            (1, 1),
            "{source}"
        );
        assert!(visual.debug_bounds("md-html-run").is_some(), "{source}");
        let drawn = shown(&view, visual);
        assert!(!drawn.contains('<'), "{source}: {drawn:?}");
    }
}

/// #14: one classification however a range query slices a multi-line run.
#[gpui::test]
fn a_multi_line_run_keeps_one_classification_in_any_slice(cx: &mut TestAppContext) {
    let source = format!("Click <a href=\"{LINK}\">\n<img src=\"a.png\" alt=\"i\">\n</a> now");
    let doc = Buffer::new(source.clone());
    let syntax = parse(&source);
    let owner = syntax
        .elements_in(doc.line_range(0))
        .find(|e| e.kind == Kind::HtmlRun)
        .expect("the first line's slice finds the run");
    assert_eq!(owner.html.as_ref().unwrap().name, "a");
    assert_eq!(
        owner.range,
        source.find("<a").unwrap()..source.find(" now").unwrap()
    );
    let folds = Default::default();
    let all = plans::compile(&doc, &syntax, &folds, FEATURES);
    let run_plans: Vec<_> = all
        .iter()
        .filter(|p| {
            p.element
                .is_some_and(|i| syntax.elements[i].kind == Kind::HtmlRun)
        })
        .collect();
    assert_eq!(run_plans.len(), 1);
    let (view, visual, _) = mount(cx, &source, true);
    assert_eq!(runs(&view, visual), 1);
}

/// #15: a multi-line run's source drops its quote prefixes.
#[test]
fn a_quoted_multi_line_run_drops_its_quote_prefixes() {
    let source =
        format!("> Click <a href=\"{LINK}\">\n> <img src=\"a.png\" alt=\"i\">\n> </a> now");
    let syntax = parse(&source);
    let run_el = syntax
        .elements
        .iter()
        .find(|e| e.kind == Kind::HtmlRun)
        .unwrap();
    assert_eq!(
        run_el.text.as_deref(),
        Some(format!("<a href=\"{LINK}\">\n<img src=\"a.png\" alt=\"i\">\n</a>").as_str())
    );
}

/// #18: an image inside a task item draws.
#[gpui::test]
fn an_image_inside_a_task_item_draws(cx: &mut TestAppContext) {
    let source = "- [ ] <img src=\"a.png\" alt=\"i\">";
    let (view, visual, reads) = mount(cx, source, true);
    assert_eq!(runs(&view, visual), 1);
    assert!(!shown(&view, visual).contains('<'));
    assert_eq!(*reads.lock().unwrap(), vec![PathBuf::from("a.png")]);
}

/// #20: a multi-line HTML block after a quote marker draws as one run
/// without the continuation lines' quote markers.
#[gpui::test]
fn a_multi_line_block_after_a_quote_marker_draws_as_one_run(cx: &mut TestAppContext) {
    let source = "> <div>\n> hi\n> </div>\n\nafter";
    let syntax = parse(source);
    let run_el = syntax
        .elements
        .iter()
        .find(|e| e.kind == Kind::HtmlRun)
        .unwrap();
    assert_eq!(run_el.text.as_deref(), Some("<div>\nhi\n</div>"));
    let (view, visual, _) = mount(cx, source, true);
    assert_eq!((runs(&view, visual), embedded(&view, visual)), (1, 3));
    let drawn = shown(&view, visual);
    assert_eq!(drawn.trim(), "after", "{:?}", rows(&view, visual));
}

/// #21: an image on its own line between text lines is one run, no block.
#[test]
fn an_image_line_inside_a_paragraph_is_a_run_not_a_block() {
    let source = "Before\n<img src=\"a.png\" alt=\"i\">\nAfter";
    let doc = Buffer::new(source);
    let syntax = parse(source);
    let all = plans::compile(&doc, &syntax, &Default::default(), FEATURES);
    let runs: Vec<_> = all
        .iter()
        .filter(|p| {
            p.element
                .is_some_and(|i| syntax.elements[i].kind == Kind::HtmlRun)
        })
        .collect();
    assert_eq!(runs.len(), 1);
    assert!(matches!(runs[0].presentation, Presentation::InlineAtom(_)));
    assert!(
        !all.iter()
            .any(|p| matches!(p.presentation, Presentation::BlockAtom(_)))
    );
    // Control: alone in its block the image is an HTML block, not a run (#16).
    let lone = "<img src=\"a.png\" alt=\"i\">";
    assert!(run_ranges(lone).is_empty());
    assert_eq!(parse(lone).html_blocks.len(), 1);
}

/// #22–#27: the passive font, big, dfn, nobr, center and meter elements.
#[gpui::test]
fn passive_elements_draw_without_exposing_tags(cx: &mut TestAppContext) {
    for (source, word) in [
        ("<font color=\"red\">red</font> tail", Some("red")),
        ("<big>big</big> tail", Some("big")),
        ("<dfn>term</dfn> tail", Some("term")),
        ("<nobr>x</nobr> tail", Some("x")),
        ("tail <center>mid</center>", Some("mid")),
        ("<meter value=\"0.5\"></meter> tail", None),
    ] {
        let (view, visual, _) = mount(cx, source, true);
        assert_eq!(runs(&view, visual), 1, "{source}");
        let text = shown(&view, visual);
        assert!(!text.contains('<'), "{source}: {text:?}");
        if let Some(word) = word {
            assert!(text.contains(word), "{source}: {text:?}");
        }
    }
    // The font colour and the definition's italics reach the text.
    let (view, visual, _) = mount(cx, "<font color=\"red\">red</font> tail", true);
    let red = painted(&view, visual)
        .into_iter()
        .find(|(t, _)| t == "red")
        .unwrap();
    assert!(red.1.color.is_some(), "{red:?}");
    let (view, visual, _) = mount(cx, "<dfn>term</dfn> tail", true);
    let term = painted(&view, visual)
        .into_iter()
        .find(|(t, _)| t == "term")
        .unwrap();
    assert!(term.1.italic, "{term:?}");
    // The meter draws a bar in the text.
    let (view, visual, _) = mount(cx, "<meter value=\"0.5\"></meter> tail", true);
    assert!(view.update(visual, |v, _| {
        v.decorations()
            .inline_widgets
            .iter()
            .any(|w| w.as_image().is_some())
    }));
}

/// #28: an empty element hides and its source stays.
#[gpui::test]
fn an_empty_element_hides_and_its_source_stays(cx: &mut TestAppContext) {
    let source = "<span></span>\n\nBody";
    let (view, visual, _) = mount(cx, source, true);
    assert_eq!(shown(&view, visual).trim(), "Body");
    assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), source);
}

/// #34: a nested blocked element is removed; the rest of the run stays.
#[gpui::test]
fn a_nested_blocked_element_is_removed(cx: &mut TestAppContext) {
    let (view, visual, _) = mount(cx, "<span><script>alert(1)</script>safe</span> tail", true);
    assert_eq!(runs(&view, visual), 1);
    let text = shown(&view, visual);
    assert_eq!(text.trim(), "safe tail", "{text:?}");
}

/// #35: without an asset broker media stays visible source.
#[gpui::test]
fn without_an_asset_broker_media_stays_source(cx: &mut TestAppContext) {
    let source = format!("<a href=\"{LINK}\"><img src=\"a.png\" alt=\"i\"></a>");
    let (view, visual, _) = mount(cx, &source, false);
    assert_eq!(runs(&view, visual), 0);
    assert_eq!(shown(&view, visual), source);
    // Control: brokered, the same run draws.
    let (view, visual, _) = mount(cx, &source, true);
    assert_eq!(runs(&view, visual), 1);
}

const EDIT_SOURCE: &str = "before <img src=\"a.png\" alt=\"i\"> after";

fn edges() -> (usize, usize) {
    (
        EDIT_SOURCE.find("<img").unwrap(),
        EDIT_SOURCE.find(" after").unwrap(),
    )
}

fn caret(view: &Entity<EditorView>, cx: &mut VisualTestContext, at: usize) {
    view.update_in(cx, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(at), cx);
    });
    draw(cx);
}

/// #36–#38: a caret at the run's opening edge, closing edge or inside shows
/// its exact source.
#[gpui::test]
fn a_caret_at_either_edge_or_inside_shows_the_exact_source(cx: &mut TestAppContext) {
    let (from, to) = edges();
    for at in [from, to, from + 4] {
        let (view, visual) = mount_editable(cx, EDIT_SOURCE);
        assert_eq!(
            runs(&view, visual),
            1,
            "control: drawn before the caret comes"
        );
        caret(&view, visual, at);
        assert_eq!(runs(&view, visual), 0, "caret at {at}");
        assert_eq!(shown(&view, visual), EDIT_SOURCE, "caret at {at}");
    }
}

/// #39: the run draws again once the caret leaves, the document untouched.
#[gpui::test]
fn the_run_draws_again_when_the_caret_leaves(cx: &mut TestAppContext) {
    let (from, _) = edges();
    let (view, visual) = mount_editable(cx, EDIT_SOURCE);
    caret(&view, visual, from);
    assert_eq!(runs(&view, visual), 0);
    caret(&view, visual, 0);
    assert_eq!(runs(&view, visual), 1);
    assert_eq!(
        view.read_with(visual, |v, _| v.text().to_owned()),
        EDIT_SOURCE
    );
}

/// #40: Markdown nested in a revealed run does not take the reveal.
#[gpui::test]
fn markdown_nested_in_a_run_does_not_take_the_reveal(cx: &mut TestAppContext) {
    let nested = "a <center>x **bold** y</center> b";
    let (view, visual) = mount_editable(cx, nested);
    assert_eq!(runs(&view, visual), 1);
    caret(&view, visual, nested.find("bold").unwrap() + 1);
    assert_eq!(runs(&view, visual), 0);
    assert_eq!(shown(&view, visual), nested);
}

/// #41: a read-only surface never reveals.
#[gpui::test]
fn a_read_only_surface_never_reveals(cx: &mut TestAppContext) {
    let (from, _) = edges();
    let (view, visual, _) = mount(cx, EDIT_SOURCE, true);
    view.update(visual, |v, cx| v.set_selection(Selection::cursor(from), cx));
    assert_eq!(runs(&view, visual), 1);
    // Control: editable, the same caret reveals (#36).
    let (view, visual) = mount_editable(cx, EDIT_SOURCE);
    caret(&view, visual, from);
    assert_eq!(runs(&view, visual), 0);
}

/// #42: a selection across the run keeps it drawn.
#[gpui::test]
fn a_selection_across_the_run_keeps_it_drawn(cx: &mut TestAppContext) {
    let (view, visual) = mount_editable(cx, EDIT_SOURCE);
    view.update_in(visual, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::range(0, EDIT_SOURCE.len()), cx);
    });
    assert_eq!(runs(&view, visual), 1);
}

/// #43: deletion at the run's edges removes one character, not the run.
#[gpui::test]
fn deletion_at_the_run_edges_removes_one_character(cx: &mut TestAppContext) {
    let (from, to) = edges();
    let doc = Buffer::new(EDIT_SOURCE);
    let syntax = parse(EDIT_SOURCE);
    let all = plans::compile(&doc, &syntax, &Default::default(), FEATURES);
    let plan = all
        .iter()
        .find(|p| {
            p.element
                .is_some_and(|i| syntax.elements[i].kind == Kind::HtmlRun)
        })
        .unwrap();
    assert!(plan.delete_units.is_empty());
    let (view, visual) = mount_editable(cx, EDIT_SOURCE);
    caret(&view, visual, to);
    visual.simulate_keystrokes("backspace");
    let mut expected = EDIT_SOURCE.to_owned();
    expected.remove(to - 1);
    assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), expected);
    let (view, visual) = mount_editable(cx, EDIT_SOURCE);
    caret(&view, visual, from);
    visual.simulate_keystrokes("delete");
    let mut expected = EDIT_SOURCE.to_owned();
    expected.remove(from);
    assert_eq!(view.read_with(visual, |v, _| v.text().to_owned()), expected);
}

/// #44: the run is the reveal element for a caret on either edge, and only
/// there.
#[test]
fn the_run_is_the_reveal_element_on_either_edge() {
    let (from, to) = edges();
    let syntax = parse(EDIT_SOURCE);
    for at in [from, to] {
        let e = syntax.reveal_element(at).expect("an edge reveals");
        assert_eq!((e.kind, e.range.clone()), (Kind::HtmlRun, from..to));
    }
    assert!(syntax.reveal_element(from - 1).is_none());
    assert!(syntax.reveal_element(to + 1).is_none());
}

/// #45: a run's links and disclosure controls keep their pointer gestures;
/// any other click puts the caret on the run, which reveals its source.
#[gpui::test]
fn links_and_disclosures_keep_their_gestures_and_other_clicks_reveal(cx: &mut TestAppContext) {
    // A linked image filling its line follows its link, without revealing.
    let source = format!("Text\n\n- <a href=\"{LINK}\"><img src=\"a.png\" alt=\"i\"></a>\n\nEnd");
    let (view, visual) = mount_editable(cx, &source);
    view.update_in(visual, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::cursor(0), cx);
    });
    draw(visual);
    assert_eq!(runs(&view, visual), 1);
    let image = visual
        .debug_bounds("md-html-img")
        .expect("the linked image draws");
    visual.simulate_click(image.center(), gpui::Modifiers::none());
    draw(visual);
    assert_eq!(visual.opened_url(), Some(LINK.to_owned()));
    assert_eq!(runs(&view, visual), 1, "following the link does not reveal");
    // A disclosure's summary toggles it, without revealing.
    let source = "Text\n\n- <details><summary>More</summary>Body</details>\n\nEnd";
    let (view, visual) = mount_editable(cx, source);
    caret(&view, visual, 0);
    let run_bounds = visual.debug_bounds("md-html-run").unwrap();
    visual.simulate_click(
        gpui::point(
            run_bounds.left() + gpui::px(8.),
            run_bounds.top() + gpui::px(8.),
        ),
        gpui::Modifiers::none(),
    );
    draw(visual);
    assert_eq!(runs(&view, visual), 1, "the summary keeps its gesture");
    let opened = visual.debug_bounds("md-html-run").unwrap();
    assert!(
        opened.size.height > run_bounds.size.height,
        "the disclosure opened: {run_bounds:?} -> {opened:?}"
    );
    // Plain run content takes the caret to the run, which reveals it.
    let source = "Text\n\n- <div align=\"center\">hi</div>\n\nEnd";
    let (view, visual) = mount_editable(cx, source);
    caret(&view, visual, 0);
    let run_bounds = visual.debug_bounds("md-html-run").unwrap();
    visual.simulate_click(
        gpui::point(run_bounds.right() - gpui::px(2.), run_bounds.center().y),
        gpui::Modifiers::none(),
    );
    draw(visual);
    assert_eq!(runs(&view, visual), 0, "a plain click reveals the run");
    assert!(shown(&view, visual).contains("<div"));
}

fn table(cell: &str) -> String {
    format!("| A |\n| --- |\n| {cell} |\n")
}

/// The drawn text of the table's body cell (the leaf after the header's),
/// without the room kept for images.
fn cell_text(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> String {
    rows(view, cx)
        .get(1)
        .map(|r| {
            r.chars()
                .filter(|c| !matches!(c, '\u{2002}'..='\u{200a}'))
                .collect()
        })
        .unwrap_or_default()
}

/// #86–#89: runs in table cells draw through the same media path.
#[gpui::test]
fn runs_in_table_cells_draw_through_the_media_path(cx: &mut TestAppContext) {
    // #86: a theme picture.
    let source = table(PICTURE);
    let (view, visual, reads) = mount(cx, &source, true);
    assert_eq!(runs(&view, visual), 1);
    assert_eq!(
        *reads.lock().unwrap(),
        vec![PathBuf::from("assets/dark.svg")]
    );
    assert!(!cell_text(&view, visual).contains('<'));
    // #87: a linked image keeps its link.
    let source = table(&format!(
        "<a href=\"{LINK}\"><img src=\"a.png\" alt=\"i\"></a>"
    ));
    let (view, visual, _) = mount(cx, &source, true);
    assert_eq!(runs(&view, visual), 1);
    let linked = painted(&view, visual)
        .into_iter()
        .any(|(_, m)| m.link.as_deref() == Some(LINK));
    assert!(linked, "{:?}", painted(&view, visual));
    // #88: a Markdown badge link keeps its whole label.
    let source = table(&format!("[![b](a.png)]({LINK})"));
    let (view, visual, _) = mount(cx, &source, true);
    let text = cell_text(&view, visual);
    assert!(!text.contains("![") && !text.contains("]("), "{text:?}");
    assert!(
        painted(&view, visual)
            .into_iter()
            .any(|(_, m)| m.link.as_deref() == Some(LINK))
    );
    // #89: without an asset broker media stays visible source.
    let source = table(PICTURE);
    let (view, visual, _) = mount(cx, &source, false);
    assert_eq!(runs(&view, visual), 0);
    assert_eq!(
        cell_text(&view, visual).trim(),
        PICTURE,
        "{:?}",
        rows(&view, visual)
    );
}

/// `markdownImageReadiness.test.ts` #1: a raw HTML image inside a paragraph
/// draws through the brokered media path at its authored width.
#[gpui::test]
fn a_raw_html_image_in_a_paragraph_draws_through_the_broker(cx: &mut TestAppContext) {
    let source = [
        "文件系统-based context workspace",
        "<img src=\"asserts/Screenshot 2026-07-15 at 10.07.43 PM.png\" alt=\"Context Base\" width=\"600\">",
        "版本管理，diff",
    ]
    .join("\n");
    cx.executor().allow_parking();
    let (view, visual) = setup_with_focus(cx, &source, false);
    let (media, reads) = assets("Puppyone — One Pager.md");
    view.update(visual, |v, cx| {
        v.dispatch(config_transaction(SetAssets(Some(media))), cx)
    });
    draw(visual);
    assert_eq!(runs(&view, visual), 1);
    assert_eq!(
        *reads.lock().unwrap(),
        vec![PathBuf::from(
            "asserts/Screenshot 2026-07-15 at 10.07.43 PM.png"
        )]
    );
    let image = visual.debug_bounds("md-html-img").expect("the image draws");
    assert_eq!(f32::from(image.size.width), 600.);
}

/// `markdownImageReadiness.test.ts` #2: the image's revealed source edits
/// like text and the edited width draws once the caret leaves.
#[gpui::test]
fn a_raw_html_image_edits_through_its_revealed_source(cx: &mut TestAppContext) {
    let source =
        "Before\n<img src=\"assets/context.png\" alt=\"Context Base\" width=\"600\">\nAfter";
    let (view, visual) = mount_editable(cx, source);
    caret(&view, visual, 0);
    assert_eq!(
        f32::from(visual.debug_bounds("md-html-img").unwrap().size.width),
        600.
    );
    let line = source.find("<img").unwrap();
    caret(&view, visual, line);
    assert_eq!(runs(&view, visual), 0);
    assert!(shown(&view, visual).contains("width=\"600\""));
    let width = source.find("600").unwrap();
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(width..width + 3, "800"),
                Some(Selection::cursor(width + 3)),
                UserEvent::Input,
            ),
            cx,
        )
    });
    draw(visual);
    assert!(view.read_with(visual, |v, _| v.text().contains("width=\"800\"")));
    assert_eq!(runs(&view, visual), 0, "still revealed while editing");
    caret(&view, visual, 0);
    // The edited width draws (`max-width: 100%` caps it at the column).
    let column = f32::from(visual.debug_bounds("md-html-run").unwrap().size.width);
    assert_eq!(
        f32::from(visual.debug_bounds("md-html-img").unwrap().size.width),
        800f32.min(column)
    );
    assert!(800f32.min(column) > 600.);
}

/// `markdownVideoEmbed.test.ts` #4: a standalone single-line HTML video is
/// a run drawn through the workspace media path, never autoplaying (the
/// native player has no autoplay).
#[gpui::test]
fn a_single_line_html_video_draws_through_the_media_path(cx: &mut TestAppContext) {
    let source = "<video autoplay src=\"assets/demo.mp4\" poster=\"assets/poster.png\"><source src=\"assets/fallback.webm\" type=\"video/webm\"></video>";
    use crate::editor::markdown::{platform::brokers::embed, shared::media::MediaKind};
    assert_eq!(run_ranges(source), vec![0..source.len()]);
    let _ = embed::take_requested();
    let (view, visual, _) = mount(cx, source, true);
    assert_eq!((runs(&view, visual), embedded(&view, visual)), (1, 1));
    assert!(visual.debug_bounds("md-html-run").is_some());
    assert!(!shown(&view, visual).contains('<'));
    // The video's own `src` (not the fallback `<source>`), as a video.
    let asked = embed::take_requested();
    assert!(!asked.is_empty());
    assert!(
        asked
            .iter()
            .all(|r| *r == (PathBuf::from("assets/demo.mp4"), MediaKind::Video)),
        "{asked:?}"
    );
}

/// #85: audio in a sentence resolves through the workspace media path as
/// audio and draws as a player in the text.
#[gpui::test]
fn audio_in_a_sentence_resolves_through_the_media_path_as_audio(cx: &mut TestAppContext) {
    use crate::editor::markdown::{platform::brokers::embed, shared::media::MediaKind};
    let _ = embed::take_requested();
    let (view, visual, _) = mount(cx, "tail <audio src=\"a.mp3\" controls></audio>", true);
    assert_eq!(runs(&view, visual), 1);
    assert_eq!(embedded(&view, visual), 0, "it stays in the sentence");
    let asked = embed::take_requested();
    assert!(!asked.is_empty());
    assert!(
        asked
            .iter()
            .all(|r| *r == (PathBuf::from("a.mp3"), MediaKind::Audio)),
        "{asked:?}"
    );
    assert!(shown(&view, visual).starts_with("tail"));
    assert!(!shown(&view, visual).contains('<'));
}
