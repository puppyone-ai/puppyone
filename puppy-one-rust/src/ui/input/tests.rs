use super::*;
use core::prelude::v1::test;
#[test]
fn utf16_surrogates_and_combining_text_map_to_valid_utf8() {
    let s = "中🐶e\u{301}";
    assert_eq!(utf16_to_byte(s, 1), 3);
    assert_eq!(utf16_to_byte(s, 3), 7);
    assert_eq!(utf16_to_byte(s, 5), s.len());
}
#[gpui::test]
fn native_input_grapheme_delete_and_local_undo(cx: &mut TestAppContext) {
    cx.update(bind_keys);
    let (input, cx) = cx.add_window_view(|w, cx| {
        let input = TextInput::new("", true, 2000, cx);
        input.focus_handle.focus(w, cx);
        input
    });
    input.update_in(cx, |i, w, cx| i.replace_text_in_range(None, "中👨‍👩‍👧‍👦", w, cx));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    cx.simulate_keystrokes("backspace");
    input.update(cx, |i, _| assert_eq!(i.text(), "中"));
    cx.simulate_keystrokes("cmd-z");
    input.update(cx, |i, _| assert_eq!(i.text(), "中👨‍👩‍👧‍👦"));
    cx.simulate_keystrokes("cmd-shift-z");
    input.update(cx, |i, _| assert_eq!(i.text(), "中"));
}
#[gpui::test]
fn native_input_scrolls_caret_and_caps_paste(cx: &mut TestAppContext) {
    cx.update(bind_keys);
    let (input, cx) = cx.add_window_view(|w, cx| {
        let input = TextInput::new("", true, 120, cx);
        input.focus_handle.focus(w, cx);
        input
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    input.update_in(cx, |i, w, cx| {
        i.replace_text_in_range(None, &"line\n".repeat(100), w, cx)
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    input.update(cx, |i, _| {
        assert_eq!(i.text().chars().count(), 120);
        assert!(i.scroll.offset().y < px(0.));
    });
    cx.simulate_keystrokes("home");
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    input.update(cx, |i, _| assert_eq!(i.scroll.offset().y, px(0.)));
}
#[gpui::test]
fn kit_wide_table_reveals_the_active_cell(cx: &mut TestAppContext) {
    cx.update(bind_keys);
    let (input, cx) = cx.add_window_view(|w, cx| {
        let mut input = TextInput::new("", true, 2000, cx);
        input.document_mode = true;
        let text = (0..24)
            .map(|i| format!("cell{i}"))
            .collect::<Vec<_>>()
            .join("\t");
        let mut offset = 0;
        input.regions = text
            .split('\t')
            .enumerate()
            .map(|(column, cell)| {
                let range = offset..offset + cell.len();
                offset += cell.len() + 1;
                TextRegion {
                    range,
                    columns: 24,
                    column,
                    ..Default::default()
                }
            })
            .collect();
        let end = text.len();
        input.restore(
            InputSnapshot {
                marks: vec![Mark::default(); text.chars().count()],
                text,
                anchor: end,
                cursor: end,
            },
            cx,
        );
        input.focus_handle.focus(w, cx);
        input
    });
    cx.simulate_resize(size(px(640.), px(480.)));
    input.update(cx, |i, cx| {
        i.reveal_cursor = true;
        cx.notify();
    });
    for _ in 0..2 {
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
    input.read_with(cx, |i, _| {
        let viewport = &i.table_scrolls[&0];
        assert!(
            viewport.offset().x < px(0.),
            "bounds={:?}, input={:?}, leaf={:?}, caret={:?}",
            viewport.bounds(),
            i.last_bounds,
            i.last_layout.leaves.last().map(|l| l.geometry.bounds()),
            position_at(&i.last_layout, i.cursor_offset(), px(24.))
        );
        let p = i.last_layout.origin + position_at(&i.last_layout, i.cursor_offset(), px(24.));
        assert!(p.x >= viewport.bounds().left() && p.x <= viewport.bounds().right());
    });
    cx.simulate_keystrokes("home");
    for _ in 0..2 {
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
    input.read_with(cx, |i, _| {
        assert_eq!(i.table_scrolls[&0].offset().x, px(0.))
    });
}
#[gpui::test]
fn kit_task_marker_pointer_events_use_document_coordinates(cx: &mut TestAppContext) {
    use std::{cell::RefCell, rc::Rc};
    cx.update(bind_keys);
    let events = Rc::new(RefCell::new(vec![]));
    let (input, cx) = cx.add_window_view(|_, cx| {
        let mut input = TextInput::new("", true, 2000, cx);
        input.document_mode = true;
        input.restore(
            InputSnapshot {
                text: "task".into(),
                marks: vec![Mark::default(); 4],
                anchor: 0,
                cursor: 0,
            },
            cx,
        );
        input.regions = vec![TextRegion {
            range: 0..4,
            prefix: "☐".into(),
            ..Default::default()
        }];
        let events = events.clone();
        cx.subscribe(&cx.entity(), move |_, _, event: &InputEvent, _| {
            if let InputEvent::Adornment(at) = event {
                events.borrow_mut().push(*at);
            }
        })
        .detach();
        input
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let point = input.read_with(cx, |i, _| {
        let label = &i.last_layout.labels[0];
        i.last_layout.origin + label.origin + point(label.width / 2., label.height / 2.)
    });
    cx.simulate_click(point, Modifiers::none());
    assert_eq!(*events.borrow(), vec![0]);
    input.update(cx, |i, cx| {
        i.read_only = true;
        cx.notify();
    });
    cx.simulate_click(point, Modifiers::none());
    assert_eq!(*events.borrow(), vec![0]);
}
#[gpui::test]
fn document_layout_hit_testing_and_drag_share_one_coordinate_space(cx: &mut TestAppContext) {
    cx.update(bind_keys);
    let (input, cx) = cx.add_window_view(|w, cx| {
        let mut input = TextInput::new("", true, 2000, cx);
        input.document_mode = true;
        input.font_size = 16.;
        input.restore(
            InputSnapshot {
                text: "Title\nParagraph\nA\tB".into(),
                marks: vec![Mark::default(); 19],
                anchor: 0,
                cursor: 0,
            },
            cx,
        );
        input.regions = vec![
            TextRegion {
                range: 0..5,
                font_size: 32.,
                heading: true,
                after: 18.,
                ..Default::default()
            },
            TextRegion {
                range: 6..15,
                font_size: 16.,
                after: 16.,
                ..Default::default()
            },
            TextRegion {
                range: 16..17,
                font_size: 16.,
                columns: 2,
                column: 0,
                ..Default::default()
            },
            TextRegion {
                range: 18..19,
                font_size: 16.,
                columns: 2,
                column: 1,
                ..Default::default()
            },
        ];
        input.focus_handle.focus(w, cx);
        input
    });
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let (start, end) = input.read_with(cx, |i, _| {
        let layout = &i.last_layout;
        assert_eq!(layout.leaves.len(), 4);
        assert!(layout.leaves[0].geometry.line_height() > layout.leaves[1].geometry.line_height());
        assert!(
            layout.leaves[1].geometry.bounds().top() > layout.leaves[0].geometry.bounds().top()
        );
        assert_eq!(
            layout.leaves[2].geometry.bounds().top(),
            layout.leaves[3].geometry.bounds().top()
        );
        assert!(
            layout.leaves[3].geometry.bounds().left() > layout.leaves[2].geometry.bounds().left()
        );
        let origin = i.last_bounds.unwrap().origin;
        (
            origin + position_at(layout, 2, px(24.)) + point(px(0.), px(5.)),
            origin + position_at(layout, 10, px(24.)) + point(px(0.), px(5.)),
        )
    });
    cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(end, Some(MouseButton::Left), Modifiers::default());
    cx.simulate_mouse_up(end, MouseButton::Left, Modifiers::default());
    let selected = input.read_with(cx, |i, _| i.snapshot());
    assert_eq!((selected.anchor, selected.cursor), (2, 10));
    cx.simulate_keystrokes("cmd-shift-down");
    assert_eq!(input.read_with(cx, |i, _| i.snapshot().cursor), 19);
}
