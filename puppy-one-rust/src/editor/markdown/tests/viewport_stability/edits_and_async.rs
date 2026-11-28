//! Viewport stability matrix: external writes above/below/on anchor, typing
//! inside viewport, undo/redo above viewport, async image decode above viewport,
//! and HTML block real height measurement above viewport (T2 #7–#14, each as an
//! independent `#[gpui::test]`).
use super::{
    DEFAULT_TOLERANCE_PX, TopKind, assert_top_text_holds, capture_top_text, measure_offset_top,
    open_sixty_section_view, png_bytes, scroll_to_top_kind, settle, sixty_section_document,
};
use crate::editor::{
    markdown::{
        SetAssets,
        features::html::{sanitize, structure},
        platform::{brokers::assets as md_assets, sessions::measure},
        shared::media::MediaSource,
        tests::setup,
    },
    registry::DocumentAssets,
    text::{
        change::ChangeSet,
        selection::Selection,
        state::{Transaction, UserEvent},
    },
    view::extension::config_transaction,
};
use gpui::{TestAppContext, px, size};
use std::{
    hash::{Hash, Hasher},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

/// T2 #7 (Rust-native): `apply_external` inserting 30 new paragraphs at the
/// start of the document keeps the viewport top text anchored within `0.5px`
/// (fails without `ScrollAnchor` edit mapping).
#[gpui::test]
fn t2_07_external_insert_above_viewport_holds_top_text(cx: &mut TestAppContext) {
    let added: String = (0..30)
        .map(|i| {
            format!(
                "Inserted external paragraph {i} written by an agent above the reader's current scroll position so document height grows substantially.\n\n"
            )
        })
        .collect();
    let delta = added.len();
    assert_top_text_holds(
        cx,
        TopKind::Paragraph,
        move |view, visual| {
            let next = view.read_with(visual, |v, _| format!("{added}{}", v.text()));
            view.update(visual, |v, cx| v.apply_external(&next, cx));
        },
        move |o| o + delta,
    );
}

/// T2 #8 (Rust-native): `apply_external` deleting the first 10 sections above
/// the viewport keeps the viewport top text anchored within `0.5px` (fails
/// without `ScrollAnchor` edit mapping).
#[gpui::test]
fn t2_08_external_delete_above_viewport_holds_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, false);
    scroll_to_top_kind(&view, visual, TopKind::Paragraph);

    let (offset, row0) = capture_top_text(&view, visual);
    let removed = view.read_with(visual, |v, _| {
        v.text()
            .find("## Section 11\n")
            .expect("Section 11 boundary")
    });
    assert!(
        removed < offset,
        "positive control: deleted prefix ({removed}) must lie strictly above anchored top ({offset})"
    );
    let next = view.read_with(visual, |v, _| v.text()[removed..].to_owned());
    view.update(visual, |v, cx| v.apply_external(&next, cx));
    settle(&view, visual);

    let row1 = measure_offset_top(&view, visual, offset - removed, "t2_08 external delete");
    assert!(
        (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "external delete of 10 sections above viewport drifted top text by {:.3}px",
        row1 - row0
    );
}

/// T2 #9 (Rust-native): `apply_external` appending content only at the end of
/// the document keeps the viewport top text anchored within `0.5px`.
#[gpui::test]
fn t2_09_external_append_below_viewport_holds_top_text(cx: &mut TestAppContext) {
    let tail: String = (0..20)
        .map(|i| format!("\n\nAppended tail paragraph {i} far below the current viewport."))
        .collect();
    assert_top_text_holds(
        cx,
        TopKind::Paragraph,
        move |view, visual| {
            let next = view.read_with(visual, |v, _| format!("{}{tail}", v.text()));
            view.update(visual, |v, cx| v.apply_external(&next, cx));
        },
        |o| o,
    );
}

/// T2 #10 (Rust-native): `apply_external` deleting the exact paragraph that
/// holds the viewport top anchor does not panic, drops the deleted anchor, and
/// lands cleanly on the block immediately following the deleted paragraph within
/// one line height.
#[gpui::test]
fn t2_10_external_delete_of_anchored_paragraph_falls_back_cleanly(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, false);

    // Scroll directly to the top of Section 30's paragraph so its first row sits at viewport top.
    let para_start = view.read_with(visual, |v, _| {
        v.text()
            .find("Section 30 opens with a long sentence")
            .expect("Section 30 paragraph start")
    });
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(para_start), cx);
    });
    settle(&view, visual);
    let para_scroll = view.read_with(visual, |v, _| {
        let l = v.layout().unwrap();
        (f32::from(l.caret(para_start, false).row_top - l.bounds.top() + l.scroll) + 4.0).max(0.)
    });
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(0), cx);
        v.set_scroll_top(para_scroll, cx);
    });
    settle(&view, visual);

    let (offset, row0) = capture_top_text(&view, visual);
    let (del_start, del_end, line_height) = view.read_with(visual, |v, _| {
        let text = v.text();
        let after = text[para_start..]
            .find("- List item one in section 30")
            .expect("list after Section 30 paragraph");
        let lh = v
            .layout()
            .unwrap()
            .leaves
            .iter()
            .find(|l| l.source().start <= offset && offset <= l.source().end)
            .map(|l| f32::from(l.geometry.line_height()))
            .unwrap_or(28.0);
        (para_start, para_start + after, lh)
    });
    assert!(
        del_start <= offset && offset < del_end,
        "positive control: anchored offset {offset} must lie inside deleted paragraph {del_start}..{del_end}"
    );
    let next = view.read_with(visual, |v, _| {
        format!("{}{}", &v.text()[..del_start], &v.text()[del_end..])
    });
    view.update(visual, |v, cx| v.apply_external(&next, cx));
    settle(&view, visual);

    // Next block (list item one in section 30) now begins at `del_start`.
    let next_block_top = measure_offset_top(
        &view,
        visual,
        del_start,
        "t2_10 block after deleted anchor paragraph",
    );
    assert!(
        (next_block_top - row0).abs() <= line_height,
        "after deleting anchored paragraph, following block must sit at viewport top within 1 line height (row0={row0:.2}, next_block_top={next_block_top:.2}, lh={line_height:.2})"
    );
}

/// T2 #11 (Rust-native): placing the caret inside the viewport (near the middle
/// of the visible window) and typing text holds the viewport top row steady
/// within `0.5px`.
#[gpui::test]
fn t2_11_typing_inside_viewport_holds_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, true);
    scroll_to_top_kind(&view, visual, TopKind::Paragraph);

    let (top_offset, row0) = capture_top_text(&view, visual);
    let edit_offset = view.read_with(visual, |v, _| {
        v.text()
            .find("Short item two in section 30.")
            .expect("visible item below top row")
            + 5
    });
    assert!(
        edit_offset > top_offset,
        "positive control: caret must sit inside viewport below top row"
    );
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(edit_offset), cx);
    });
    settle(&view, visual);

    let (before_offset, before_row) = capture_top_text(&view, visual);
    for ch in [" ", "h", "e", "l", "l", "o"] {
        visual.simulate_input(ch);
        settle(&view, visual);
    }

    let after_row = measure_offset_top(&view, visual, before_offset, "t2_11 typing inside");
    assert!(
        (after_row - before_row).abs() <= DEFAULT_TOLERANCE_PX,
        "typing inside viewport drifted top row by {:.3}px (row0={row0:.2}, before={before_row:.2}, after={after_row:.2})",
        after_row - before_row
    );
}

/// T2 #12 (Rust-native): applying an edit (`Transaction::edit`) above the
/// viewport, then undoing and redoing it, holds the viewport top text within
/// `0.5px` at every step (fails without `ScrollAnchor` edit mapping).
#[gpui::test]
fn t2_12_edit_undo_redo_above_viewport_holds_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let (view, visual) = open_sixty_section_view(cx, true);
    scroll_to_top_kind(&view, visual, TopKind::Paragraph);

    // Keep the caret inside the viewport (below the top row) so undo/redo
    // restores an in-viewport selection and exercises scroll-anchor mapping
    // rather than scrolling up to reveal an off-screen caret at byte 0.
    let in_view_caret = view.read_with(visual, |v, _| {
        v.text()
            .find("Short item two in section 30.")
            .expect("visible item below top row")
            + 4
    });
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(in_view_caret), cx);
    });
    settle(&view, visual);

    let (offset0, row0) = capture_top_text(&view, visual);
    let inserted = (0..12)
        .map(|i| format!("Above-viewport edited line {i} adding vertical height.\n\n"))
        .collect::<String>();
    let delta = inserted.len();

    // Step 1: edit above viewport (without scroll_into_view).
    let mut tr = Transaction::edit(ChangeSet::replace(0..0, &inserted), None, UserEvent::Input);
    tr.scroll_into_view = false;
    view.update(visual, |v, cx| v.dispatch(tr, cx));
    settle(&view, visual);
    let row_edit = measure_offset_top(&view, visual, offset0 + delta, "t2_12 after edit");
    assert!(
        (row_edit - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "edit above viewport drifted top text by {:.3}px",
        row_edit - row0
    );

    // Step 2: undo edit above viewport.
    view.update(visual, |v, cx| v.undo(false, cx));
    settle(&view, visual);
    let row_undo = measure_offset_top(&view, visual, offset0, "t2_12 after undo");
    assert!(
        (row_undo - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "undo above viewport drifted top text by {:.3}px",
        row_undo - row0
    );

    // Step 3: redo edit above viewport.
    view.update(visual, |v, cx| v.undo(true, cx));
    settle(&view, visual);
    let row_redo = measure_offset_top(&view, visual, offset0 + delta, "t2_12 after redo");
    assert!(
        (row_redo - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "redo above viewport drifted top text by {:.3}px",
        row_redo - row0
    );
}

/// T2 #13 (Rust-native): an image above the viewport whose `DocumentAssets.read`
/// callback blocks until released expands from its placeholder estimate to its
/// real decoded height (positive control) while keeping the viewport top text
/// anchored within `0.5px`.
#[gpui::test]
fn t2_13_async_image_decode_above_viewport_holds_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let gate = Arc::new(AtomicBool::new(false));
    let tall_png = png_bytes(600, 420);
    let gate_cb = gate.clone();
    let assets = DocumentAssets {
        workspace: "memory://t2-13-async-img".into(),
        document: "doc.md".into(),
        read: Arc::new(move |rel| {
            if rel.to_string_lossy().contains("tall-above.png") {
                if !gate_cb.load(Ordering::Acquire) {
                    return None;
                }
                return Some(tall_png.clone());
            }
            Some(png_bytes(48, 24))
        }),
    };

    let doc = format!(
        "## Intro\n\n![tall](tall-above.png)\n\n{}",
        sixty_section_document()
    );
    let (view, visual) = setup(cx, &doc);
    visual.simulate_resize(size(px(1000.), px(700.)));
    view.update_in(visual, |v, _, cx| {
        v.dispatch(config_transaction(SetAssets(Some(assets.clone()))), cx);
    });
    settle(&view, visual);
    std::thread::sleep(std::time::Duration::from_millis(20));
    settle(&view, visual);

    // Measure placeholder height of the image block before decode completes.
    let img_start = doc.find("![tall](tall-above.png)").unwrap();
    let (est_height, img_doc_y) = view.read_with(visual, |v, _| {
        let l = v.layout().unwrap();
        let b = l
            .blocks
            .iter()
            .find(|b| b.source.start == img_start)
            .expect("image placeholder block");
        (
            f32::from(b.bounds.size.height),
            f32::from(b.bounds.top() - l.bounds.top() + l.scroll),
        )
    });

    // Scroll past the image (~360px below it, so it sits strictly above the
    // viewport top yet within the overscan window that renders and decodes it).
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(doc.len()), cx);
        v.set_scroll_top((img_doc_y + est_height + 300.0).max(0.), cx);
    });
    settle(&view, visual);

    let (top_offset, row0) = capture_top_text(&view, visual);
    let scroll_before = view.read_with(visual, |v, _| v.scroll_top());

    // Release the asset read gate and retry decode.
    gate.store(true, Ordering::Release);
    visual.update(|_, cx| {
        md_assets::retry(
            &MediaSource::Workspace("tall-above.png".into()),
            Some(&assets),
            cx,
        );
    });
    for _ in 0..10 {
        settle(&view, visual);
        std::thread::sleep(std::time::Duration::from_millis(15));
    }

    // Positive control: decoded image height (420px) must differ significantly from placeholder estimate.
    let decoded_h = match visual.update(|_, cx| {
        md_assets::get(
            &MediaSource::Workspace("tall-above.png".into()),
            Some(&assets),
            cx,
        )
    }) {
        md_assets::AssetState::Ready { height, .. } => height,
        _ => panic!("positive control: tall-above.png must finish decoding to Ready"),
    };
    assert!(
        (decoded_h - est_height).abs() > 100.0,
        "positive control: decoded height ({decoded_h}) must differ from initial placeholder height ({est_height})"
    );
    let scroll_after = view.read_with(visual, |v, _| v.scroll_top());
    assert!(
        scroll_after > scroll_before + 100.0,
        "positive control: image growth above viewport must advance scroll_top ({scroll_before} -> {scroll_after})"
    );

    let row1 = measure_offset_top(&view, visual, top_offset, "t2_13 async image above");
    assert!(
        (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "async image decode above viewport drifted top text by {:.3}px",
        row1 - row0
    );
}

/// T2 #14 (Rust-native): when an HTML block (`<div><table>...</table></div>`)
/// ~1.5 screens above the viewport records its real measured height via
/// `record_measured_height`, the viewport top text stays anchored within `0.5px`.
#[gpui::test]
fn t2_14_html_block_measured_height_above_viewport_holds_top_text(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let html_block = "<div><table><tr><th>Col A</th><th>Col B</th></tr><tr><td>One</td><td>Two</td></tr></table></div>";
    let doc = format!("## Top\n\n{html_block}\n\n{}", sixty_section_document());
    let (view, visual) = setup(cx, &doc);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);

    let html_start = doc.find(html_block).unwrap();
    let (col_width, html_block_id, widget_states) = view.read_with(visual, |v, _| {
        let col_width = f32::from(v.layout().unwrap().blocks[0].bounds.size.width);
        let html_block_id = v
            .decorations()
            .blocks
            .iter()
            .find_map(|b| match b {
                crate::editor::view::decoration::Block::Widget { id, lines, .. }
                    if v.state().doc.line_range(lines.start).start == html_start =>
                {
                    Some(*id)
                }
                _ => None,
            })
            .expect("expected HTML Block::Widget");
        (col_width, html_block_id, v.widget_states())
    });
    let structure::Parsed::Complete(nodes) = structure::parse(html_block) else {
        panic!("expected Complete HTML block");
    };
    let mut h = std::hash::DefaultHasher::new();
    (html_start, col_width.to_bits()).hash(&mut h);
    sanitize::hash_nodes(&nodes, &mut h);
    let key = h.finish();
    let measured_before =
        measure::get(&mut widget_states.borrow_mut(), html_block_id, key).unwrap_or(40.0);

    // Scroll ~1.5 screens past the HTML block so it sits above the viewport.
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(doc.len()), cx);
        v.set_scroll_top(1_150.0, cx);
    });
    settle(&view, visual);

    let (top_offset, row0) = capture_top_text(&view, visual);
    let scroll_before = view.read_with(visual, |v, _| v.scroll_top());

    // Record a significantly taller real measured height for the off-screen HTML block.
    assert!(
        measure::record(
            &mut widget_states.borrow_mut(),
            html_block_id,
            key,
            measured_before + 240.0,
        ),
        "positive control: measure::record must accept taller height"
    );
    visual.update(|_, cx| cx.refresh_windows());
    settle(&view, visual);

    let scroll_after = view.read_with(visual, |v, _| v.scroll_top());
    assert!(
        scroll_after >= scroll_before,
        "scroll_top must never regress when HTML block above grows ({scroll_before} -> {scroll_after})"
    );
    let row1 = measure_offset_top(&view, visual, top_offset, "t2_14 html measured height");
    assert!(
        (row1 - row0).abs() <= DEFAULT_TOLERANCE_PX,
        "HTML block measured height above viewport drifted top text by {:.3}px",
        row1 - row0
    );
}
