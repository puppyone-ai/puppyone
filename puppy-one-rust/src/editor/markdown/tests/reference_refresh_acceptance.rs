//! Native Markdown reference-refresh identity acceptance (`T5-A`,
//! `inlinePreviewLinkIdentity.test.ts` #0–#7): verifies that dispatching
//! [`SetReferences`] updates decoration invalidation (`config_epoch`), live
//! missing/ambiguous underline decorations, and link resolution across both
//! inline prose and Markdown table cells ONLY when a referenced target's
//! resolution actually changes, while unrelated workspace files and escaped
//! `\[[...]]` syntax leave `config_epoch`, asset reads, and mounted widget
//! `BlockId`s untouched.
use super::{blocks, setup_with_focus};
use crate::editor::{
    markdown::{MarkdownExtension, SetAssets, SetReferences},
    navigation::{Document as NavDocument, ReferenceContext, ReferenceIndex},
    registry::DocumentAssets,
    view::{
        EditorView,
        decoration::Block,
        extension::{LinkAction, config_transaction},
    },
};
use gpui::{Entity, TestAppContext, VisualTestContext, px, size};
use image::RgbaImage;
use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

fn make_refs(source: &str, paths: &[&str]) -> ReferenceContext {
    let docs = paths
        .iter()
        .map(|p| NavDocument {
            path: (*p).to_owned(),
            name: p.rsplit('/').next().unwrap_or(p).to_owned(),
        })
        .collect();
    ReferenceContext {
        source: source.to_owned(),
        index: Arc::new(ReferenceIndex::new(docs)),
    }
}

fn settle(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
    for _ in 0..3 {
        let _ = blocks(view, cx);
        cx.run_until_parked();
    }
}

fn set_refs(view: &Entity<EditorView>, cx: &mut VisualTestContext, source: &str, paths: &[&str]) {
    view.update(cx, |v, cx| {
        v.dispatch(
            config_transaction(SetReferences(Some(make_refs(source, paths)))),
            cx,
        );
    });
    settle(view, cx);
}

fn config_epoch(view: &Entity<EditorView>, cx: &VisualTestContext) -> u64 {
    view.read_with(cx, |v, _| {
        v.extension::<MarkdownExtension>()
            .expect("MarkdownExtension")
            .config_epoch_for_tests()
    })
}

fn first_widget_id(view: &Entity<EditorView>, cx: &VisualTestContext) -> Option<u64> {
    view.read_with(cx, |v, _| {
        v.decorations().blocks.iter().find_map(|b| match b {
            Block::Widget { id, .. } => Some(id.raw()),
            _ => None,
        })
    })
}

fn has_underline_dash(view: &Entity<EditorView>, cx: &VisualTestContext, dash: f32) -> bool {
    view.read_with(cx, |v, _| {
        v.decorations()
            .underlines
            .iter()
            .any(|u| (u.dash - dash).abs() < 0.05)
    })
}

/// `inlinePreviewLinkIdentity.test.ts` #0:
/// `isolated inline preview link dependencies > ignores unrelated files for plain text, line breaks and ordinary anchors`.
/// Covers both inline prose and table cells, with a positive control proving
/// that adding the referenced `target.md` DOES invalidate `config_epoch`.
#[gpui::test]
fn t5_a0_unrelated_files_ignored_for_plain_breaks_and_ordinary_anchors(cx: &mut TestAppContext) {
    let source = "plain text\n\nline<br />break\n\n[link](target.md)\n\n| A | B |\n| --- | --- |\n| plain text | line<br />break [link](target.md) |";
    let (view, visual) = setup_with_focus(cx, source, false);
    set_refs(&view, visual, "note.md", &[]);
    let epoch_before = config_epoch(&view, visual);
    let table_id_before = first_widget_id(&view, visual).expect("table widget mounted");

    set_refs(&view, visual, "note.md", &["folder/new.md"]);
    assert_eq!(
        config_epoch(&view, visual),
        epoch_before,
        "unrelated file must not invalidate plain text, <br />, or ordinary anchor references"
    );
    assert_eq!(first_widget_id(&view, visual), Some(table_id_before));

    // Positive control: adding the referenced `target.md` MUST invalidate config_epoch.
    set_refs(&view, visual, "note.md", &["folder/new.md", "target.md"]);
    assert!(
        config_epoch(&view, visual) > epoch_before,
        "positive control: adding referenced target.md must invalidate config_epoch"
    );
}

/// `inlinePreviewLinkIdentity.test.ts` #1:
/// `isolated inline preview link dependencies > retains resolved wiki links and wiki media when only unrelated files change`.
/// Covers both inline prose and table cells, verifying via a `DocumentAssets`
/// read counter that wiki media is NOT re-read when only unrelated files change,
/// with a positive control proving removing `picture.png` DOES invalidate.
#[gpui::test]
fn t5_a1_resolved_wiki_links_and_media_retain_identity_on_unrelated_files(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let mut png = Vec::new();
    RgbaImage::from_pixel(4, 4, image::Rgba([80, 140, 220, 255]))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let png_arc = Arc::new(png);
    let reads = Arc::new(AtomicUsize::new(0));
    let reads_cb = reads.clone();

    let source = "[[target#heading|label]] and ![[picture.png|100]]\n\n| Link | Media |\n| --- | --- |\n| [[target#heading|label]] | ![[picture.png|100]] |";
    let (view, visual) = setup_with_focus(cx, source, false);
    let assets = DocumentAssets {
        workspace: "memory://t5-a1-unrelated".into(),
        document: "note.md".into(),
        read: Arc::new(move |rel: &Path| {
            reads_cb.fetch_add(1, Ordering::SeqCst);
            (rel == Path::new("picture.png")).then(|| (*png_arc).clone())
        }),
    };
    view.update(visual, |v, cx| {
        v.dispatch(config_transaction(SetAssets(Some(assets))), cx);
    });
    set_refs(&view, visual, "note.md", &["target.md", "picture.png"]);
    for _ in 0..4 {
        settle(&view, visual);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    let reads_before = reads.load(Ordering::SeqCst);
    assert!(
        reads_before >= 1,
        "positive control: initial load must read picture.png once (got {reads_before})"
    );
    let epoch_before = config_epoch(&view, visual);
    let table_id_before = first_widget_id(&view, visual).expect("table widget mounted");

    set_refs(
        &view,
        visual,
        "note.md",
        &["target.md", "picture.png", "unrelated.md"],
    );
    assert_eq!(
        config_epoch(&view, visual),
        epoch_before,
        "unrelated file must not invalidate resolved wiki links or wiki media"
    );
    assert_eq!(
        reads.load(Ordering::SeqCst),
        reads_before,
        "unrelated file must not re-read resolved wiki media assets"
    );
    assert_eq!(first_widget_id(&view, visual), Some(table_id_before));

    // Positive control: removing `picture.png` changes media resolution and bumps config_epoch.
    set_refs(&view, visual, "note.md", &["target.md", "unrelated.md"]);
    assert!(
        config_epoch(&view, visual) > epoch_before,
        "positive control: removing referenced wiki media must invalidate config_epoch"
    );
}

/// `inlinePreviewLinkIdentity.test.ts` #2:
/// `isolated inline preview link dependencies > invalidates when a missing wiki target appears or disappears`.
/// Verified independently for both inline prose and table cells, asserting
/// decoration underline transitions (`dash == 1.0` missing <-> none resolved).
#[gpui::test]
fn t5_a2_missing_wiki_target_appearing_or_disappearing_invalidates_inline_and_table(
    cx: &mut TestAppContext,
) {
    for (label, source) in [
        ("inline", "See [[target]] here."),
        ("table", "| Col |\n| --- |\n| [[target]] |"),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        set_refs(&view, visual, "note.md", &[]);
        let e0 = config_epoch(&view, visual);
        assert!(
            has_underline_dash(&view, visual, 1.0),
            "{label}: missing [[target]] must show dotted missing underline (dash=1.0)"
        );

        set_refs(&view, visual, "note.md", &["target.md"]);
        let e1 = config_epoch(&view, visual);
        assert!(
            e1 > e0,
            "{label}: appearing target.md must invalidate config_epoch"
        );
        assert!(
            !has_underline_dash(&view, visual, 1.0),
            "{label}: resolved [[target]] must clear dotted missing underline"
        );

        set_refs(&view, visual, "note.md", &[]);
        let e2 = config_epoch(&view, visual);
        assert!(
            e2 > e1,
            "{label}: disappearing target.md must invalidate config_epoch"
        );
        assert!(
            has_underline_dash(&view, visual, 1.0),
            "{label}: disappeared [[target]] must restore dotted missing underline"
        );
    }
}

/// `inlinePreviewLinkIdentity.test.ts` #3:
/// `isolated inline preview link dependencies > invalidates when a target becomes ambiguous`.
/// Verified for both inline prose and table cells, asserting decoration state
/// flips from resolved (no underline) to ambiguous (`dash == 3.0` dashed underline).
#[gpui::test]
fn t5_a3_wiki_target_becoming_ambiguous_invalidates_inline_and_table(cx: &mut TestAppContext) {
    for (label, source) in [
        ("inline", "Ref [[target]]"),
        ("table", "| Col |\n| --- |\n| [[target]] |"),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        set_refs(&view, visual, "note.md", &["one/target.md"]);
        let e0 = config_epoch(&view, visual);
        assert!(
            !has_underline_dash(&view, visual, 3.0) && !has_underline_dash(&view, visual, 1.0),
            "{label}: uniquely resolved [[target]] must have no diagnostic underline"
        );

        set_refs(
            &view,
            visual,
            "note.md",
            &["one/target.md", "two/target.md"],
        );
        let e1 = config_epoch(&view, visual);
        assert!(
            e1 > e0,
            "{label}: target becoming ambiguous must invalidate config_epoch"
        );
        assert!(
            has_underline_dash(&view, visual, 3.0),
            "{label}: ambiguous [[target]] must show dashed ambiguous underline (dash=3.0)"
        );
    }
}

/// `inlinePreviewLinkIdentity.test.ts` #4:
/// `isolated inline preview link dependencies > considers fragments outside the currently mounted viewport`.
/// Places `[[target]]` inside a table far below the 700px viewport, verifies
/// `!layout.covers(offset)` (positive control), updates references while
/// offscreen, and scrolls down to confirm the newly resolved state renders.
#[gpui::test]
fn t5_a4_offscreen_wiki_target_outside_viewport_still_invalidates_references(
    cx: &mut TestAppContext,
) {
    let filler: String = (0..140)
        .map(|i| format!("Filler paragraph line {i} pushing the table far below the viewport.\n\n"))
        .collect();
    let source = format!("{filler}| Visible | Offscreen |\n| --- | --- |\n| row | [[target]] |");
    let target_offset = source.find("[[target]]").expect("offscreen wiki link");

    let (view, visual) = setup_with_focus(cx, &source, false);
    visual.simulate_resize(size(px(1000.), px(700.)));
    set_refs(&view, visual, "note.md", &[]);

    view.read_with(visual, |v, _| {
        assert!(
            !v.layout().expect("settled layout").covers(target_offset),
            "positive control: [[target]] must start outside the mounted viewport"
        );
    });
    assert!(
        has_underline_dash(&view, visual, 1.0),
        "positive control: offscreen [[target]] starts with missing underline"
    );
    let e0 = config_epoch(&view, visual);

    // Target appears while table is offscreen.
    set_refs(&view, visual, "note.md", &["target.md"]);
    assert!(
        config_epoch(&view, visual) > e0,
        "offscreen wiki target appearing must invalidate config_epoch even while unmounted"
    );

    // Scroll to the bottom where the table lives and confirm resolved state renders.
    let max_scroll = view.read_with(visual, |v, _| v.layout().unwrap().max_scroll());
    view.update(visual, |v, cx| v.set_scroll_top(max_scroll, cx));
    settle(&view, visual);
    view.read_with(visual, |v, _| {
        assert!(
            v.layout().unwrap().covers(target_offset),
            "scrolling down must mount the offscreen table"
        );
    });
    assert!(
        !has_underline_dash(&view, visual, 1.0),
        "scrolling back to previously offscreen [[target]] must display resolved state"
    );
}

/// `inlinePreviewLinkIdentity.test.ts` #5:
/// `isolated inline preview link dependencies > resolves dependencies in the owning document's directory`.
#[gpui::test]
fn t5_a5_references_resolve_in_owning_document_directory(cx: &mut TestAppContext) {
    let source = "See [[target]]\n\n| Cell |\n| --- |\n| [[target]] |";
    let paths = ["one/target.md", "two/target.md"];
    let (view, visual) = setup_with_focus(cx, source, false);

    set_refs(&view, visual, "one/note.md", &paths);
    let e_one = config_epoch(&view, visual);
    let target_one = view.update(visual, |v, _| {
        let state = v.state().clone();
        let offset = source.find("target").unwrap();
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .link_activation(&state, offset, false)
            .map(|a| a.action)
    });
    assert_eq!(
        target_one,
        Some(LinkAction::Workspace(vec!["one/target.md".into()]))
    );

    set_refs(&view, visual, "two/note.md", &paths);
    assert!(
        config_epoch(&view, visual) > e_one,
        "switching owning document directory must invalidate config_epoch"
    );
    let target_two = view.update(visual, |v, _| {
        let state = v.state().clone();
        let offset = source.find("target").unwrap();
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .link_activation(&state, offset, false)
            .map(|a| a.action)
    });
    assert_eq!(
        target_two,
        Some(LinkAction::Workspace(vec!["two/target.md".into()]))
    );
}

/// `inlinePreviewLinkIdentity.test.ts` #6:
/// `isolated inline preview link dependencies > ignores escaped wiki syntax`.
/// Includes a positive control showing unescaped `[[target]]` DOES invalidate.
#[gpui::test]
fn t5_a6_escaped_wiki_syntax_does_not_invalidate_on_reference_changes(cx: &mut TestAppContext) {
    let escaped = r"\[[target]]

| Cell |
| --- |
| \[[target]] |";
    let (view, visual) = setup_with_focus(cx, escaped, false);
    set_refs(&view, visual, "note.md", &[]);
    let e0 = config_epoch(&view, visual);

    set_refs(&view, visual, "note.md", &["target.md"]);
    assert_eq!(
        config_epoch(&view, visual),
        e0,
        "escaped \\[[target]] must not invalidate when target.md appears"
    );
    assert!(
        !has_underline_dash(&view, visual, 1.0),
        "escaped \\[[target]] must never be decorated as a link"
    );

    // Positive control: unescaped `[[target]]` invalidates under the exact same change.
    let (pos_view, pos_visual) = setup_with_focus(cx, "[[target]]", false);
    set_refs(&pos_view, pos_visual, "note.md", &[]);
    let pos_e0 = config_epoch(&pos_view, pos_visual);
    set_refs(&pos_view, pos_visual, "note.md", &["target.md"]);
    assert!(
        config_epoch(&pos_view, pos_visual) > pos_e0,
        "positive control: unescaped [[target]] must invalidate when target.md appears"
    );
}

/// `inlinePreviewLinkIdentity.test.ts` #7:
/// `isolated inline preview link dependencies > conservatively refreshes HTML with entity-decoded link candidates`.
/// Covers inline HTML, table-cell HTML, and HTML blocks, with a negative control
/// showing plain entity text without link candidates stays stable on unrelated files.
#[gpui::test]
fn t5_a7_html_entity_decoded_link_candidates_conservatively_refresh(cx: &mut TestAppContext) {
    for (label, source) in [
        ("inline-html", "<span>&#91;&#91;target&#93;&#93;</span>"),
        (
            "table-html",
            "| Col |\n| --- |\n| <span>&#91;&#91;target&#93;&#93;</span> |",
        ),
        (
            "html-block",
            "<div>\n<span>&#91;&#91;target&#93;&#93;</span>\n</div>",
        ),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        set_refs(&view, visual, "note.md", &[]);
        let e0 = config_epoch(&view, visual);

        set_refs(&view, visual, "note.md", &["target.md"]);
        assert!(
            config_epoch(&view, visual) > e0,
            "{label}: HTML containing entity-decoded [[target]] must refresh when target.md appears"
        );
    }

    // Negative control: HTML with non-link entities ignores unrelated workspace files.
    let (plain_view, plain_visual) = setup_with_focus(cx, "<span>&copy; plain text</span>", false);
    set_refs(&plain_view, plain_visual, "note.md", &[]);
    let plain_e0 = config_epoch(&plain_view, plain_visual);
    set_refs(&plain_view, plain_visual, "note.md", &["unrelated.md"]);
    assert_eq!(
        config_epoch(&plain_view, plain_visual),
        plain_e0,
        "HTML with non-link entities must stay stable when unrelated files change"
    );
}
