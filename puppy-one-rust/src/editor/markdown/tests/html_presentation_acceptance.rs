//! HTML presentation attributes (`markdownHtmlRun.test.ts` #46–48, 57,
//! 59–63, 65, 68, 69, 71, 72; gap `markdown-html-presentational-attributes`):
//! valid legacy presentation values (percentage widths, image placement,
//! table alignment and width, cell width and vertical alignment, ordered
//! list types, source conditions) are kept and drawn, invalid ones omitted
//! with the element kept, and a picture shows its first candidate the
//! document's media policy allows.
use super::setup_with_focus;
use crate::editor::{
    markdown::{
        SetAssets,
        features::html::{
            sanitize::{Element, Node},
            structure::{self, Parsed},
        },
    },
    registry::DocumentAssets,
    view::{
        EditorView,
        extension::{SetReadOnly, config_transaction},
    },
};
use gpui::{Bounds, Entity, Pixels, TestAppContext, VisualTestContext};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const PICTURE: &str = "<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"assets/dark.svg\"><img src=\"assets/light.svg\" alt=\"Download\" width=\"196\"></picture>";

fn svg() -> Vec<u8> {
    br#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>"#.to_vec()
}

fn draw(cx: &mut VisualTestContext) {
    for _ in 0..4 {
        cx.run_until_parked();
        cx.update(|w, cx| w.draw(cx).clear(cx));
    }
}

/// A read-only, brokered (dark) view of `source`, and the paths its broker read.
fn mount<'a>(
    cx: &'a mut TestAppContext,
    source: &str,
) -> (
    Entity<EditorView>,
    &'a mut VisualTestContext,
    Arc<Mutex<Vec<PathBuf>>>,
) {
    cx.executor().allow_parking();
    let (view, visual) = setup_with_focus(cx, source, false);
    let reads = Arc::new(Mutex::new(Vec::new()));
    let log = reads.clone();
    let media = DocumentAssets {
        workspace: "workspace:html-presentation".into(),
        document: PathBuf::from("README.md"),
        read: Arc::new(move |path: &Path| {
            log.lock().unwrap().push(path.to_path_buf());
            Some(svg())
        }),
    };
    view.update_in(visual, |v, _, cx| {
        v.dispatch(config_transaction(SetAssets(Some(media))), cx);
        v.dispatch(config_transaction(SetReadOnly(true)), cx);
    });
    draw(visual);
    (view, visual, reads)
}

/// The first element named `tag` in `source`'s sanitized tree.
fn sanitized(source: &str, tag: &str) -> Element {
    let Parsed::Complete(nodes) = structure::parse(source) else {
        panic!("{source} parses");
    };
    let mut pending: Vec<&Node> = nodes.iter().collect();
    while let Some(node) = pending.pop() {
        if let Node::Element(e) = node {
            if e.tag == tag {
                return e.clone();
            }
            pending.extend(&e.children);
        }
    }
    panic!("no <{tag}> in {source}")
}

fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
    cx.debug_bounds(selector)
        .unwrap_or_else(|| panic!("{selector} is drawn"))
}

/// #46: in dark mode the picture loads its dark candidate and never gives
/// the fallback image a URL first.
#[gpui::test]
fn a_picture_loads_its_matching_candidate_without_the_fallback_first(cx: &mut TestAppContext) {
    let (_, visual, reads) = mount(cx, PICTURE);
    assert!(visual.debug_bounds("md-html-img").is_some());
    assert_eq!(
        *reads.lock().unwrap(),
        vec![PathBuf::from("assets/dark.svg")]
    );
}

/// #47: a candidate the media policy refuses gives way to the fallback image.
#[gpui::test]
fn a_refused_candidate_gives_way_to_the_fallback_image(cx: &mut TestAppContext) {
    let source = PICTURE.replace("assets/dark.svg", "../outside/dark.svg");
    let (_, visual, reads) = mount(cx, &source);
    assert!(visual.debug_bounds("md-html-img").is_some());
    assert_eq!(
        *reads.lock().unwrap(),
        vec![PathBuf::from("assets/light.svg")]
    );
}

/// #48: with no candidate allowed the picture shows its alt text.
#[gpui::test]
fn a_picture_with_no_allowed_candidate_shows_its_alt_text(cx: &mut TestAppContext) {
    let source = PICTURE
        .replace("assets/dark.svg", "../outside/dark.svg")
        .replace("assets/light.svg", "../outside/light.svg");
    let (_, visual, reads) = mount(cx, &source);
    assert!(visual.debug_bounds("md-html-chip:Download").is_some());
    assert!(visual.debug_bounds("md-html-img").is_none());
    assert!(reads.lock().unwrap().is_empty());
}

/// #57, #59–#63, #65: valid presentation values are kept.
#[test]
fn valid_presentation_values_are_kept() {
    for (source, tag, attribute, value) in [
        (
            "<div><img src=\"a.png\" alt=\"i\" width=\"50%\"></div>",
            "img",
            "width",
            "50%",
        ),
        (
            "<div><img src=\"a.png\" alt=\"i\" align=\"right\"></div>",
            "img",
            "align",
            "right",
        ),
        (
            "<table align=\"center\"><tr><td>c</td></tr></table>",
            "table",
            "align",
            "center",
        ),
        (
            "<table width=\"100%\"><tr><td>c</td></tr></table>",
            "table",
            "width",
            "100%",
        ),
        (
            "<table><tr><td width=\"50%\">c</td></tr></table>",
            "td",
            "width",
            "50%",
        ),
        (
            "<table><tr><td valign=\"top\">c</td></tr></table>",
            "td",
            "valign",
            "top",
        ),
        ("<ol type=\"a\"><li>x</li></ol>", "ol", "type", "a"),
    ] {
        assert_eq!(
            sanitized(source, tag).attribute(attribute),
            Some(value),
            "{source}"
        );
    }
}

/// #68, #69, #71, #72: an invalid value is omitted; the element stays.
#[test]
fn invalid_presentation_values_are_omitted() {
    for (source, tag, attribute) in [
        (
            "<div><img src=\"a.png\" alt=\"i\" align=\"javascript\"></div>",
            "img",
            "align",
        ),
        (
            "<table><tr><td valign=\"sideways\">c</td></tr></table>",
            "td",
            "valign",
        ),
        ("<ol type=\"disc\"><li>x</li></ol>", "ol", "type"),
        (
            "<picture><source media=\"a{}\" srcset=\"d.svg\"><img src=\"l.svg\" alt=\"p\"></picture>",
            "source",
            "media",
        ),
    ] {
        let element = sanitized(source, tag);
        assert_eq!(element.attribute(attribute), None, "{source}");
    }
    // Controls: the same elements keep a valid value (see above) and their
    // other attributes.
    assert_eq!(
        sanitized(
            "<div><img src=\"a.png\" alt=\"i\" align=\"javascript\"></div>",
            "img"
        )
        .attribute("src"),
        Some("a.png")
    );
    assert_eq!(
        sanitized(
            "<picture><source media=\"a{}\" srcset=\"d.svg\"><img src=\"l.svg\" alt=\"p\"></picture>",
            "source"
        )
        .attribute("srcset"),
        Some("d.svg")
    );
}

/// The kept values draw: a percentage image width, right placement, a
/// centred full-width table, a half-width cell, and the omitted ones draw
/// as if absent.
#[gpui::test]
fn kept_presentation_values_draw(cx: &mut TestAppContext) {
    // A percentage width is a share of the column.
    let (_, visual, _) = mount(cx, "<div><img src=\"a.png\" alt=\"i\" width=\"50%\"></div>");
    let surface = bounds(visual, "md-html-rendered-surface");
    let image = bounds(visual, "md-html-img");
    assert!((f32::from(image.size.width) - f32::from(surface.size.width) / 2.).abs() < 1.);
    // `align="right"` puts the image at the right of its line; an invalid
    // value leaves it at the left.
    let (_, visual, _) = mount(
        cx,
        "<div><img src=\"a.png\" alt=\"i\" align=\"right\"></div>",
    );
    let surface = bounds(visual, "md-html-rendered-surface");
    let image = bounds(visual, "md-html-img");
    assert!((f32::from(image.right()) - f32::from(surface.right())).abs() < 1.);
    let (_, visual, _) = mount(
        cx,
        "<div><img src=\"a.png\" alt=\"i\" align=\"javascript\"></div>",
    );
    let surface = bounds(visual, "md-html-rendered-surface");
    let image = bounds(visual, "md-html-img");
    assert!((f32::from(image.left()) - f32::from(surface.left())).abs() < 1.);
    // A centred table sits in the middle; `width="100%"` fills the column.
    let (_, visual, _) = mount(cx, "<table align=\"center\"><tr><td>c</td></tr></table>");
    let surface = bounds(visual, "md-html-rendered-surface");
    let table = bounds(visual, "md-html-table");
    let gap_left = f32::from(table.left()) - f32::from(surface.left());
    let gap_right = f32::from(surface.right()) - f32::from(table.right());
    assert!(
        gap_left > 10. && (gap_left - gap_right).abs() < 1.5,
        "{gap_left} / {gap_right}"
    );
    let (_, visual, _) = mount(cx, "<table width=\"100%\"><tr><td>c</td></tr></table>");
    let surface = bounds(visual, "md-html-rendered-surface");
    let table = bounds(visual, "md-html-table");
    assert!((f32::from(table.size.width) - f32::from(surface.size.width)).abs() < 1.5);
    // Control: without `width` the table is as wide as its text.
    let (_, visual, _) = mount(cx, "<table><tr><td>c</td></tr></table>");
    let narrow = bounds(visual, "md-html-table");
    assert!(f32::from(narrow.size.width) < f32::from(surface.size.width) / 2.);
    // A cell `width="50%"` takes at least half the column.
    let (_, visual, _) = mount(
        cx,
        "<table><tr><td width=\"50%\">c</td><td>d</td></tr></table>",
    );
    let surface = bounds(visual, "md-html-rendered-surface");
    let cell = bounds(visual, "md-html-cell-0-0");
    assert!(f32::from(cell.size.width) >= f32::from(surface.size.width) / 2. - 2.);
}

/// `valign` places a cell's content in its row; without it the content
/// sits at the top.
#[gpui::test]
fn cell_vertical_alignment_places_the_content(cx: &mut TestAppContext) {
    let tall = "<td>one<br>two<br>three<br>four</td>";
    let mut offsets = Vec::new();
    for valign in [
        "",
        " valign=\"middle\"",
        " valign=\"bottom\"",
        " valign=\"sideways\"",
    ] {
        let source =
            format!("<table><tr>{tall}<td{valign}><img src=\"a.png\" alt=\"i\"></td></tr></table>");
        let (_, visual, _) = mount(cx, &source);
        let cell = bounds(visual, "md-html-cell-0-1");
        let image = bounds(visual, "md-html-img");
        offsets.push(f32::from(image.top()) - f32::from(cell.top()));
    }
    let [top, middle, bottom, invalid] = offsets[..] else {
        unreachable!()
    };
    assert!(top < middle && middle < bottom, "{offsets:?}");
    assert!(
        (invalid - top).abs() < 0.5,
        "an invalid valign is absent: {offsets:?}"
    );
}
