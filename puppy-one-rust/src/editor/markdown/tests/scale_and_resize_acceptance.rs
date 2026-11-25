//! T4 performance & O(1) resize scaling acceptance tests:
//! - Resizing a 1,600-section Markdown document performs 0 full `HeightMap`
//!   rebuilds and 0 block re-hashes (`TA-13`) while keeping viewport-top text
//!   anchored within `0.5px`.
//! - Single-line edits and GFM task toggles inside a 10,000-item flat list
//!   patch `Syntax`, `Plans`, `Decorations`, and `HeightMap` incrementally
//!   without full-document reparses (`markdownPerformanceProjection.test.ts` #1).
//! - Extreme document shapes (`list_10k`, `single_line_100k`,
//!   `wide_table_200x2000`, `images_500`) open, type, and arrow-navigate cleanly
//!   without panics or stuck selection.
use crate::{
    editor::{
        markdown::{
            MarkdownExtension,
            composition::FEATURES,
            core::syntax::Syntax,
            tests::{blocks, setup},
        },
        text::{
            buffer::Buffer,
            change::ChangeSet,
            selection::Selection,
            state::{Transaction, UserEvent},
        },
        view::{EditorView, bind_keys},
    },
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext, point, px, size};

fn settle(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
    for _ in 0..4 {
        let _ = blocks(view, cx);
        cx.run_until_parked();
    }
}

fn large_markdown(sections: usize) -> String {
    let para = "PuppyOne opens any folder on your computer. Your documents stay as ordinary files with rich live preview and incremental layout.";
    let mut s = String::with_capacity(sections * 380);
    for i in 0..sections {
        s.push_str(&format!(
            "## Section {i}\n\n{para}\n\n- item alpha {i}\n- item beta {i}\n\n```rust\nfn s_{i}() -> usize {{ {i} }}\n```\n\n"
        ));
    }
    s
}

/// T4 (`TA-13`): resizing column width across a 1,600-section Markdown document
/// performs 0 additional `HeightMap` full rebuilds and 0 block re-hashes while
/// keeping viewport-top text anchored within `0.5px`.
#[gpui::test]
fn t4_width_resize_on_1600_sections_does_zero_block_rehashes(cx: &mut TestAppContext) {
    let doc = large_markdown(1_600);
    let (view, visual) = setup(cx, &doc);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);
    view.update(visual, |v, cx| v.set_scroll_top(24_000.0, cx));
    settle(&view, visual);

    let (rebuilds_before, hashed_before) = view.read_with(visual, |v, _| v.height_map_stats());
    assert!(
        hashed_before > 5_000,
        "positive control: 1,600-section doc must initially populate >5,000 height blocks (got {hashed_before})"
    );
    let (top_offset, top_dist) = view.read_with(visual, |v, _| {
        let l = v.layout().expect("settled 1600-section layout");
        let left = l.blocks[0].bounds.left();
        let off = l.offset_at(point(left, l.bounds.top() + px(2.))).0;
        let dist = f32::from(l.caret(off, false).row_top - l.bounds.top());
        (off, dist)
    });

    for width in [920.0, 820.0, 740.0, 640.0, 880.0, 1000.0] {
        visual.simulate_resize(size(px(width), px(700.)));
        settle(&view, visual);
        let (rebuilds_now, hashed_now) = view.read_with(visual, |v, _| v.height_map_stats());
        assert_eq!(
            rebuilds_now, rebuilds_before,
            "width resize to {width}px triggered a full HeightMap rebuild"
        );
        assert_eq!(
            hashed_now, hashed_before,
            "width resize to {width}px re-hashed blocks ({hashed_before} -> {hashed_now})"
        );
    }

    let after_dist = view.read_with(visual, |v, _| {
        let l = v.layout().expect("settled layout after resizes");
        assert!(
            l.covers(top_offset),
            "anchored top offset fell out of layout"
        );
        f32::from(l.caret(top_offset, false).row_top - l.bounds.top())
    });
    assert!(
        (after_dist - top_dist).abs() <= 0.5,
        "1,600-section width resize drifted top text by {}px",
        after_dist - top_dist
    );
}

/// `markdownPerformanceProjection.test.ts` #1: `toggles one task token in
/// 10,000 lines without scanning the document` (and T4 `list_10k` incremental
/// typing): both a 0-delta task toggle (`[ ]` -> `[x]`) and a character insert
/// inside a 10,000-item flat list patch `Syntax` incrementally (`old_lines ==
/// 4999..5000`), match a full rebuild identically, and hash <= 4 blocks in
/// `HeightMap` with 0 full rebuilds.
#[gpui::test]
fn t4_single_list_10k_task_toggle_and_typing_patch_incrementally(cx: &mut TestAppContext) {
    let source: String = (0..10_000)
        .map(|i| format!("- [ ] Task {i} with `code_{i}` and **bold**"))
        .collect::<Vec<_>>()
        .join("\n");

    // 1. Pure Syntax incremental check: 0-delta checkbox toggle + positive-delta insert.
    let before = Buffer::new(source.clone());
    let mut syntax = Syntax::parse_with(&before, FEATURES);
    assert_eq!(
        syntax.top_blocks.len(),
        1,
        "positive control: 10k flat list is a single top-level block"
    );

    let line_4999 = before.line_range(4_999);
    let box_from = line_4999.start + 2;
    let box_to = box_from + 3;
    assert_eq!(before.slice(box_from..box_to), "[ ]");

    let mut after_toggle = before.clone();
    let toggle_cs = ChangeSet::replace(box_from..box_to, "[x]");
    after_toggle.replace(box_from..box_to, "[x]");
    let splice = Syntax::try_parse_incremental_in_place(
        &mut syntax,
        &after_toggle,
        &before,
        &toggle_cs,
        FEATURES,
    )
    .expect("10k flat-list task toggle must use single-list incremental patch");
    assert_eq!(splice.old_lines, 4_999..5_000);
    assert_eq!(splice.new_lines, 4_999..5_000);
    assert_eq!(splice.byte_delta, 0);
    assert_eq!(
        syntax,
        Syntax::parse_with(&after_toggle, FEATURES),
        "incremental single-list toggle syntax must equal full parse"
    );

    // Character insert inside line 4999 (`byte_delta == 1`).
    let insert_at = line_4999.start + 10;
    let mut after_type = after_toggle.clone();
    let type_cs = ChangeSet::replace(insert_at..insert_at, "Z");
    after_type.replace(insert_at..insert_at, "Z");
    let splice2 = Syntax::try_parse_incremental_in_place(
        &mut syntax,
        &after_type,
        &after_toggle,
        &type_cs,
        FEATURES,
    )
    .expect("10k flat-list character insert must use single-list incremental patch");
    assert_eq!(splice2.old_lines, 4_999..5_000);
    assert_eq!(splice2.byte_delta, 1);
    assert_eq!(
        syntax,
        Syntax::parse_with(&after_type, FEATURES),
        "incremental single-list insert syntax must equal full parse"
    );

    // 2. Live EditorView pipeline check: 0 full HeightMap rebuilds, <= 4 blocks hashed.
    let (view, visual) = setup(cx, &source);
    visual.simulate_resize(size(px(1000.), px(700.)));
    settle(&view, visual);
    let (rebuilds_before, hashed_before) = view.read_with(visual, |v, _| v.height_map_stats());
    assert!(
        hashed_before >= 10_000,
        "positive control: initial 10k list populates 10,000 height blocks (got {hashed_before})"
    );

    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(box_from..box_to, "[x]"),
                Some(Selection::cursor(box_to)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    settle(&view, visual);
    let (rebuilds_after, hashed_after) = view.read_with(visual, |v, _| v.height_map_stats());
    assert_eq!(
        rebuilds_after, rebuilds_before,
        "10k list task toggle must trigger 0 full HeightMap rebuilds"
    );
    assert!(
        hashed_after - hashed_before <= 4,
        "10k list task toggle must hash <= 4 blocks, not full document (delta={})",
        hashed_after - hashed_before
    );
    // 3. Single-row incremental patch on a wide oversized GFM table: verifies
    // typing in a body row of a 200-column table patches `Syntax` incrementally
    // and equals a full `Syntax::parse_with` rebuild bit-for-bit.
    let wide_header = (0..200)
        .map(|c| format!("C{c}"))
        .collect::<Vec<_>>()
        .join("|");
    let wide_sep = (0..200).map(|_| "---").collect::<Vec<_>>().join("|");
    let wide_row = (0..200)
        .map(|c| format!("v{c}"))
        .collect::<Vec<_>>()
        .join("|");
    let mut wide_src = format!("|{wide_header}|\n|{wide_sep}|\n");
    for _ in 0..40 {
        wide_src.push('|');
        wide_src.push_str(&wide_row);
        wide_src.push_str("|\n");
    }
    let wide_before = Buffer::new(wide_src);
    let mut wide_syn = Syntax::parse_with(&wide_before, FEATURES);
    assert_eq!(
        wide_syn.tables.len(),
        1,
        "positive control: 200-column table parses as one GFM table"
    );
    let row20_start = wide_before.line_range(22).start + 2;
    let mut wide_after = wide_before.clone();
    let wide_cs = ChangeSet::replace(row20_start..row20_start, "X");
    wide_after.replace(row20_start..row20_start, "X");
    let wide_splice = Syntax::try_parse_incremental_in_place(
        &mut wide_syn,
        &wide_after,
        &wide_before,
        &wide_cs,
        FEATURES,
    )
    .expect("wide table body-row insert must use single-table-row incremental patch");
    assert_eq!(wide_splice.old_lines, 22..23);
    assert_eq!(wide_splice.new_lines, 22..23);
    assert_eq!(wide_splice.byte_delta, 1);
    assert_eq!(
        wide_syn,
        Syntax::parse_with(&wide_after, FEATURES),
        "incremental single-table-row patch must equal full Syntax::parse_with"
    );
}

/// Task book A1 (`markdown-single-block-documents-reparse`): a document that
/// is one long list compiles a one-item edit at item level. The window's
/// syntax view holds only the edited lines, so block features (math, MDX)
/// scan those lines and not the whole list; a math block in another item
/// still matches a full compile whether the edit is before or after it.
#[test]
fn a_one_item_edit_in_a_long_list_compiles_only_its_lines() {
    use crate::editor::markdown::core::{
        plans::{self, PlanCache},
        state::FeatureStateStore,
    };
    let source: String = (0..10_000)
        .map(|i| {
            if i == 7_000 {
                format!("- Item {i} with a formula\n  $$\n  x^2 + y^2\n  $$")
            } else {
                format!("- Item {i} with `code_{i}` and **bold**")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    let folds = FeatureStateStore::default();
    for item in [5_000, 8_000] {
        let before = Buffer::new(source.clone());
        let syntax = Syntax::parse_with(&before, FEATURES);
        assert_eq!(syntax.top_blocks.len(), 1, "the whole list is one block");
        let plans_before = plans::compile(&before, &syntax, &folds, FEATURES);
        let math = |plans: &[plans::Plan]| {
            plans
                .iter()
                .filter(|p| p.embed().is_some_and(|e| e.feature == "math"))
                .count()
        };
        assert_eq!(
            math(&plans_before),
            1,
            "control: the formula is a math block"
        );

        let line = before.line_index(source.find(&format!("- Item {item} ")).unwrap());
        let at = before.line_range(line).start + 4;
        let mut after = before.clone();
        let change = ChangeSet::replace(at..at, "Z");
        after.replace(at..at, "Z");
        let (next, splice) =
            Syntax::try_parse_incremental(&after, &before, &syntax, &change, FEATURES)
                .expect("a one-item edit patches the list incrementally");
        assert_eq!(splice.new_lines, line..line + 1);

        // The window view the block features see stays inside the edited line.
        let view = plans::window_syntax_view(&next, &splice.new_bytes, &splice.new_lines);
        assert!(!view.top_blocks.is_empty());
        assert!(
            view.top_blocks
                .iter()
                .all(|b| b.start >= splice.new_bytes.start && b.end <= splice.new_bytes.end),
            "item {item}: the window's blocks {:?} reach past {:?}",
            view.top_blocks,
            splice.new_bytes
        );
        // Control: the document's own block spans the whole list.
        assert!(next.top_blocks[0].start < splice.new_bytes.start);
        assert!(next.top_blocks[0].end > splice.new_bytes.end);

        let mut cache = PlanCache::default();
        cache.rebuild_index(&plans_before);
        let incremental = plans::compile_incremental(
            &after,
            &next,
            &plans_before,
            syntax.elements.len(),
            &splice,
            &folds,
            FEATURES,
            &mut cache,
        );
        assert_eq!(
            cache.block_compiles, 1,
            "item {item}: compiled incrementally"
        );
        let mut refreshed = incremental.clone();
        plans::refresh_shifted_block_plans(
            &after,
            &next,
            &folds,
            FEATURES,
            &mut refreshed,
            0..after.len(),
        );
        assert_eq!(
            refreshed,
            plans::compile(&after, &next, &folds, FEATURES),
            "item {item}: incremental plans match a full compile"
        );
        assert_eq!(math(&incremental), 1, "item {item}: the formula survives");
    }
}

/// T4 extreme-shape contract: verifies opening, typing, and arrow navigation
/// work cleanly without panics or stuck selection on a 10k-item list, a
/// 100k-char single line, a 200x2000 wide table, and a 500-image document.
#[gpui::test]
fn t4_extreme_documents_edit_and_navigate_cleanly(cx: &mut TestAppContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        bind_keys(cx);
    });

    let list_10k: String = (0..10_000)
        .map(|i| format!("- List item {i} with inline `code_{i}` and **emphasis**"))
        .collect::<Vec<_>>()
        .join("\n");
    let single_100k = "word ".repeat(20_000);
    let table_header = (0..200)
        .map(|c| format!("C{c}"))
        .collect::<Vec<_>>()
        .join("|");
    let table_sep = (0..200).map(|_| "---").collect::<Vec<_>>().join("|");
    let table_row = (0..200)
        .map(|c| format!("v{c}"))
        .collect::<Vec<_>>()
        .join("|");
    let mut wide_table = String::with_capacity(2_002 * (table_row.len() + 3));
    wide_table.push_str(&format!("|{table_header}|\n|{table_sep}|\n"));
    for _ in 0..2_000 {
        wide_table.push('|');
        wide_table.push_str(&table_row);
        wide_table.push_str("|\n");
    }
    let images_500: String = (0..500)
        .map(|i| format!("![Image {i}](assets/img-{i}.png)\n"))
        .collect();

    for (label, doc) in [
        ("list_10k", list_10k),
        ("single_line_100k", single_100k),
        ("wide_table_200x2000", wide_table),
        ("images_500", images_500),
    ] {
        let initial_len = doc.len();
        let anchor_pos = match label {
            "list_10k" => doc
                .find("- List item 5000")
                .map(|p| p + 18)
                .unwrap_or(initial_len / 2),
            "single_line_100k" => initial_len / 2,
            "wide_table_200x2000" => doc.len() / 2,
            "images_500" => doc.find("![Image 250]").unwrap_or(0) + 4,
            _ => 0,
        };
        let (view, visual) = cx.add_window_view(move |w, cx| {
            let v = EditorView::new(
                &doc,
                Box::new(MarkdownExtension::new(true, Scale::Medium)),
                cx,
            );
            v.focus(w, cx);
            v
        });
        visual.simulate_resize(size(px(1000.), px(700.)));
        settle(&view, visual);

        view.update(visual, |v, cx| {
            v.set_selection(Selection::cursor(anchor_pos.min(initial_len)), cx);
        });
        settle(&view, visual);
        visual.simulate_input("X");
        settle(&view, visual);
        assert_eq!(
            view.read_with(visual, |v, _| v.text().len()),
            initial_len + 1,
            "{label}: typing must insert exactly 1 byte"
        );

        let (fwd, back) = if label == "single_line_100k" {
            ("right", "left")
        } else {
            ("down", "up")
        };
        let rev_before = view.read_with(visual, |v, _| v.state().revision);
        let head_before = view.read_with(visual, |v, _| v.state().selection.head);
        visual.simulate_keystrokes(fwd);
        settle(&view, visual);
        let head_after_fwd = view.read_with(visual, |v, _| v.state().selection.head);
        assert_ne!(
            head_before, head_after_fwd,
            "{label}: `{fwd}` arrow key must move selection"
        );
        visual.simulate_keystrokes(back);
        settle(&view, visual);
        let head_after_back = view.read_with(visual, |v, _| v.state().selection.head);
        assert_ne!(
            head_after_fwd, head_after_back,
            "{label}: `{back}` arrow key must move selection"
        );
        assert_eq!(
            view.read_with(visual, |v, _| v.state().revision),
            rev_before,
            "{label}: arrow movement must not mutate document"
        );
    }
}
