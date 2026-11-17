//! Table media must use the same document capabilities and native inline renderer.
use super::setup_with_focus;
use crate::editor::{
    markdown::SetAssets,
    registry::DocumentAssets,
    view::{decoration::Block, extension::config_transaction},
};
use gpui::{Modifiers, TestAppContext};
use std::{
    io::Cursor,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[gpui::test]
fn table_images_read_once_from_the_document_capability_and_render_ready(cx: &mut TestAppContext) {
    for (index, image) in [
        "![alt](assets/pic.png)",
        "![alt][pic]",
        "![pic][]",
        "![pic]",
    ]
    .iter()
    .enumerate()
    {
        let source = format!(
            "| Media | Text |\n| --- | --- |\n| {image} | **neighbor** |\n\n[pic]: assets/pic.png"
        );
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(24, 12)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let png = png.into_inner();
        let reads = Arc::new(Mutex::new(Vec::new()));
        let observed = reads.clone();
        let (view, visual) = setup_with_focus(cx, &source, false);
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetAssets(Some(DocumentAssets {
                    workspace: format!("table-media-acceptance-{index}"),
                    document: "notes/note.md".into(),
                    read: Arc::new(move |path| {
                        observed.lock().unwrap().push(path.to_path_buf());
                        Some(png.clone())
                    }),
                }))),
                cx,
            );
        });
        for _ in 0..3 {
            visual.run_until_parked();
            visual.update(|w, cx| {
                w.draw(cx).clear(cx);
            });
        }
        assert_eq!(
            *reads.lock().unwrap(),
            [PathBuf::from("notes/assets/pic.png")]
        );
        let painted = visual
            .debug_bounds("editor-inline-image")
            .expect("image painted inside the cell");
        assert_eq!(
            (
                f32::from(painted.size.width),
                f32::from(painted.size.height)
            ),
            (24., 12.)
        );
        let draw_image = view.read_with(visual, |v, _| {
            let decorations = v.decorations();
            let images: Vec<_> = decorations
                .inline_widgets
                .iter()
                .filter_map(|w| w.as_image())
                .collect();
            assert_eq!(images.len(), 1);
            assert_eq!(images[0].0.as_ref(), if index < 2 { "alt" } else { "pic" });
            assert_eq!(
                v.decorations()
                    .blocks
                    .iter()
                    .filter(|b| matches!(b, Block::Widget { .. }))
                    .count(),
                1
            );
            assert!(
                v.decorations()
                    .blocks
                    .iter()
                    .all(|b| !matches!(b, Block::Line {style, ..} if style.embed.is_some()))
            );
            let leaves = &v.layout().unwrap().leaves;
            assert!(leaves.iter().all(|l| !l.entry.text.text.contains("![")));
            assert!(leaves.iter().any(|l| l.entry.text.text == "neighbor"
                && l.entry.text.marks.iter().any(|(_, s)| s.bold)));
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
            images[0].1.draw.clone()
        });
        visual.update(|window, app| {
            let rendered = draw_image(None, 400., 16., window, app).expect("decoded native image");
            assert_eq!((rendered.width, rendered.height), (24., 12.));
        });
        assert_eq!(
            reads.lock().unwrap().len(),
            1,
            "redraw must reuse the brokered asset"
        );
    }
}

#[gpui::test]
fn table_image_failures_keep_alt_text_and_never_load_code_or_blocked_paths(
    cx: &mut TestAppContext,
) {
    let source = "| Missing | Blocked | Code |\n| --- | --- | --- |\n| ![missing](absent.png) | ![blocked](../../outside.png) | `![literal](code.png)` |";
    let (view, visual) = setup_with_focus(cx, source, false);
    let reads = Arc::new(Mutex::new(Vec::new()));
    let observed = reads.clone();
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetAssets(Some(DocumentAssets {
                workspace: "table-media-failure".into(),
                document: "notes/note.md".into(),
                read: Arc::new(move |path| {
                    observed.lock().unwrap().push(path.to_path_buf());
                    None
                }),
            }))),
            cx,
        );
    });
    for _ in 0..3 {
        visual.run_until_parked();
        visual.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    }
    assert_eq!(*reads.lock().unwrap(), [PathBuf::from("notes/absent.png")]);
    view.read_with(visual, |v, _| {
        let text: Vec<_> = v
            .layout()
            .unwrap()
            .leaves
            .iter()
            .map(|l| l.entry.text.text.as_str())
            .collect();
        assert!(text.contains(&"missing"));
        assert!(
            text.iter()
                .any(|s| s.contains("blocked") && !s.contains("outside.png"))
        );
        assert!(text.contains(&"![literal](code.png)"));
        assert_eq!(
            v.decorations()
                .inline_widgets
                .iter()
                .filter(|w| w.as_image().is_some())
                .count(),
            1
        );
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
    assert!(visual.debug_bounds("editor-inline-image").is_none());
}

#[gpui::test]
fn table_images_follow_workspace_rebinding_and_expand_aligned_cell_geometry(
    cx: &mut TestAppContext,
) {
    for (column, separator) in ["---", ":---:", "---:"].iter().enumerate() {
        let source = format!(
            "| Wide column heading | Neighbor |\n| {separator} | --- |\n| ![alt](pic.png) | **next** |\n| bottom | end |"
        );
        let (view, visual) = setup_with_focus(cx, &source, false);
        let reads = Arc::new(Mutex::new(Vec::new()));
        for (workspace, width, height) in [("one", 24, 80), ("two", 40, 96)] {
            let mut png = Cursor::new(Vec::new());
            image::DynamicImage::new_rgba8(width, height)
                .write_to(&mut png, image::ImageFormat::Png)
                .unwrap();
            let png = png.into_inner();
            let observed = reads.clone();
            view.update(visual, |v, cx| {
                v.dispatch(
                    config_transaction(SetAssets(Some(DocumentAssets {
                        workspace: format!("table-media-rebinding-{column}-{workspace}"),
                        document: "nested/note.md".into(),
                        read: Arc::new(move |path| {
                            observed
                                .lock()
                                .unwrap()
                                .push((workspace, path.to_path_buf()));
                            Some(png.clone())
                        }),
                    }))),
                    cx,
                );
            });
            for _ in 0..3 {
                visual.run_until_parked();
                visual.update(|w, cx| {
                    w.draw(cx).clear(cx);
                });
            }
            let start = source.find("![alt]").unwrap();
            let painted = visual
                .debug_bounds("editor-inline-image")
                .expect("painted cell image");
            assert_eq!(
                (
                    f32::from(painted.size.width),
                    f32::from(painted.size.height)
                ),
                (width as f32, height as f32)
            );
            view.read_with(visual, |v, _| {
                let layout = v.layout().unwrap();
                let room = layout.range_boxes(start..start + "![alt](pic.png)".len())[0];
                assert!(
                    (f32::from(painted.left()) - f32::from(room.left())).abs() < 1.5,
                    "aligned image must cover its shaped room: {painted:?} / {room:?}"
                );
                let bottom = source.find("bottom").unwrap();
                assert!(
                    layout.range_boxes(bottom..bottom + 6)[0].top() >= painted.bottom(),
                    "image height must expand the row"
                );
                assert_eq!(v.text(), source);
                assert_eq!(v.state().revision, 0);
            });
        }
        assert_eq!(
            *reads.lock().unwrap(),
            [
                ("one", PathBuf::from("nested/pic.png")),
                ("two", PathBuf::from("nested/pic.png"))
            ]
        );
    }
}

#[gpui::test]
fn native_link_clicks_honor_policy_and_drag_cancellation_in_tables_and_prose(
    cx: &mut TestAppContext,
) {
    use gpui::{MouseButton, point, px};
    for table in [false, true] {
        for (href, drag) in [
            ("javascript:alert%281%29", false),
            ("https://example.com", true),
        ] {
            let link = format!("[label]({href})");
            let source = if table {
                format!("| Link |\n| --- |\n| {link} |\n\nafter")
            } else {
                format!("{link}\n\nafter")
            };
            let (view, visual) = setup_with_focus(cx, &source, false);
            visual.update(|w, cx| {
                w.draw(cx).clear(cx);
            });
            let at = source.find("label").unwrap();
            let position = view.read_with(visual, |v, _| {
                v.layout().unwrap().range_boxes(at..at + 5)[0].center()
            });
            if drag {
                visual.simulate_mouse_down(position, MouseButton::Left, Modifiers::none());
                visual.simulate_mouse_move(
                    position + point(px(8.), px(0.)),
                    MouseButton::Left,
                    Modifiers::none(),
                );
                visual.simulate_mouse_move(position, MouseButton::Left, Modifiers::none());
                visual.simulate_mouse_up(position, MouseButton::Left, Modifiers::none());
            } else {
                visual.simulate_click(position, Modifiers::none());
            }
            assert_eq!(visual.opened_url(), None, "{table} / {href} / drag={drag}");
            view.read_with(visual, |v, _| {
                assert_eq!(v.text(), source);
                assert_eq!(v.state().revision, 0);
            });
        }
    }
}

#[test]
fn panicking_inline_content_hooks_discard_partial_output_and_preserve_healthy_media() {
    use crate::{
        editor::{
            markdown::{
                MarkdownExtension,
                core::{
                    decorations::InlineDecoration,
                    feature::{Features, MarkdownFeature},
                },
                features::{image, table},
            },
            text::state::EditorState,
            view::{
                decoration::InlineImage,
                extension::{DecorateInput, EditorExtension},
            },
        },
        typography::Scale,
    };
    use std::rc::Rc;
    struct Broken;
    impl MarkdownFeature for Broken {
        fn id(&self) -> &'static str {
            "broken-inline-content-acceptance"
        }
        fn decorate_inline_content(&self, cx: &mut InlineDecoration) {
            cx.replaced.push((cx.range.clone(), "CORRUPTED".into()));
            cx.inline_images.push(InlineImage {
                range: cx.range.clone(),
                pad: 0.,
                radius: 0.,
                draw: Rc::new(|_, _, _, _, _| panic!("discarded loader must never run")),
            });
            panic!("partial inline output");
        }
    }
    static BROKEN: Broken = Broken;
    static FEATURES: Features = &[&table::FEATURE, &BROKEN, &image::FEATURE];
    let source = "| Image |\n| --- |\n| ![alt](a.png) |";
    let state = EditorState::new(source);
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    markdown.test_features = Some(FEATURES);
    let decorations = markdown.decorate(&DecorateInput {
        state: &state,
        focused: false,
        pointer_selecting: false,
        dark: true,
    });
    assert_eq!(decorations.inline_widgets.len(), 1);
    assert_eq!(decorations.inline_widgets[0].display_text().as_ref(), "alt");
    assert!(decorations.inline_widgets[0].as_image().is_some());
    assert_eq!(
        decorations
            .blocks
            .iter()
            .filter(|b| matches!(b, Block::Widget { .. }))
            .count(),
        1
    );
    assert_eq!(state.doc.as_str(), source);
    assert_eq!(state.revision, 0);
}

#[gpui::test]
fn table_links_activate_the_host_external_link_path(cx: &mut TestAppContext) {
    for (separator, href, expected) in [
        ("---", "https://example.com", "https://example.com/"),
        (
            ":---:",
            "https://example.com?center",
            "https://example.com/?center",
        ),
        (
            "---:",
            "https://example.com?right",
            "https://example.com/?right",
        ),
    ] {
        let source =
            format!("| Wide column header |\n| {separator} |\n| [docs]({href}) |\n\nafter");
        let (view, visual) = setup_with_focus(cx, &source, false);
        visual.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        let at = source.find("docs").unwrap();
        let position = view.read_with(visual, |v, _| {
            v.layout().unwrap().range_boxes(at..at + 4)[0].center()
        });
        assert_ne!(visual.opened_url().as_deref(), Some(expected));
        visual.simulate_click(position, Modifiers::none());
        visual.run_until_parked();
        assert_eq!(visual.opened_url().as_deref(), Some(expected));
        view.read_with(visual, |v, _| {
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}

#[gpui::test]
fn table_wrapped_cell_geometry_uses_painted_alignment_for_hit_testing(cx: &mut TestAppContext) {
    use gpui::{point, px};
    let cell = "a sequence of words for wrapped table text ".repeat(18) + "short ending";
    for separator in [":---:", "---:"] {
        let source = format!("| Content |\n| {separator} |\n| {cell} |\n\nafter");
        let (view, visual) = setup_with_focus(cx, &source, false);
        visual.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        view.read_with(visual, |v, _| {
            let leaf = v
                .layout()
                .unwrap()
                .leaves
                .iter()
                .find(|l| l.entry.text.text == cell)
                .expect("wrapped table cell");
            assert!(leaf.entry.rows >= 3);
            let geometry = &leaf.geometry;
            let first = geometry.position_for_index(0);
            let last = geometry.position_for_index(cell.len());
            assert!(last.y > first.y);
            let mut starts = Vec::new();
            let mut row = first.y - px(1.);
            for (index, _) in cell
                .char_indices()
                .chain(std::iter::once((cell.len(), ' ')))
            {
                let caret = geometry.position_for_index(index);
                if caret.y > row {
                    starts.push(caret.x);
                    row = caret.y;
                }
                let hit = geometry
                    .index_for_position(point(caret.x, caret.y + geometry.line_height() / 2.));
                assert_eq!(
                    geometry.position_for_index(hit),
                    caret,
                    "{separator}: {index} -> {hit}"
                );
            }
            assert!(
                starts.windows(2).any(|w| (w[0] - w[1]).abs() > px(2.)),
                "short and full rows have different aligned origins"
            );
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}
