//! The Explorer as the window hosts it: menus, keys, selection, virtual rows, fades, motion.
use super::*;
use core::prelude::v1::test;
use std::path::Path;

#[gpui::test]
fn explorer_row_menus_light_their_trigger_and_dismiss(cx: &mut TestAppContext) {
    use explorer::{MenuAt, RowTrigger};
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    let (index, path) = session.read_with(cx, |e, _| {
        let index = e.tree().rows.iter().position(|r| !r.folder).unwrap();
        (index, e.tree().rows[index].path.clone())
    });
    // "⋮" leaves the selection alone and lights its own trigger.
    explorer.update(cx, |e, cx| {
        let before = session.read(cx).tree().selected.clone();
        e.open_node_menu(index, MenuAt::Row(path.clone(), RowTrigger::More), cx);
        assert_eq!(session.read(cx).tree().selected, before);
        let menu = e.menu().unwrap();
        assert_eq!(menu.row_trigger(&path), Some(RowTrigger::More));
    });
    draw(cx);
    // GPUI Kit dismisses the popover on a press outside it.
    cx.simulate_click(point(px(900.), px(500.)), Modifiers::none());
    explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
    // A right click selects the row and pins the menu at the pointer.
    explorer.update(cx, |e, cx| {
        e.open_node_menu(index, MenuAt::Pointer(point(px(100.), px(100.))), cx);
        let tree = session.read(cx).tree();
        assert_eq!(tree.selected, path);
        assert!(tree.selection.contains(&path));
    });
    draw(cx);
    cx.simulate_keystrokes("escape");
    explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
}
#[gpui::test]
fn explorer_keys_move_the_selection_and_fill_the_clipboard(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    session.update(cx, |e, cx| {
        let first = e.tree().rows[0].path.clone();
        e.select(&first, false, false, cx);
    });
    explorer.update_in(cx, |e, w, cx| e.focus_handle(cx).focus(w, cx));
    draw(cx);
    cx.simulate_keystrokes("down");
    session.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, e.tree().rows[1].path)
    });
    cx.simulate_keystrokes("end");
    session.read_with(cx, |e, _| {
        assert_eq!(e.tree().selected, e.tree().rows.last().unwrap().path)
    });
    cx.simulate_keystrokes("secondary-x");
    session.read_with(cx, |e, _| {
        let selected = e.tree().selected.clone();
        assert_eq!(
            e.clipboard(),
            Some(&explorer::FileClipboard::Cut(vec![selected]))
        );
    });
}
#[gpui::test]
fn folder_selection_expands_tree_without_resetting_to_editor(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    let (index, path, before) = session.read_with(cx, |e, _| {
        let index = e.tree().rows.iter().position(|r| r.folder).unwrap();
        let row = &e.tree().rows[index];
        (index, row.path.clone(), row.expanded)
    });
    explorer.update(cx, |e, cx| e.open_row(index, cx));
    session.update(cx, |e, _| {
        assert_eq!(e.tree().selected, path);
        assert_eq!(e.tree_mut().find_mut(&path).unwrap().expanded, !before);
    });
    view.update_in(cx, |s, w, cx| s.receive(w, cx));
    session.read_with(cx, |e, _| assert_eq!(e.tree().selected, path));
}
#[gpui::test]
fn large_tree_uses_gpui_virtual_rows(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    session_of(&view, cx).update(cx, |e, cx| {
        e.tree_mut().rows = (0..100_000)
            .map(|i| crate::model::Row {
                path: format!("{i}.txt").into(),
                name: format!("{i}.txt"),
                folder: false,
                expanded: false,
                depth: i % 200,
                display: format!("{i}"),
                extension: None,
                error: None,
                status: false,
            })
            .collect();
        cx.notify();
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    explorer.read_with(cx, |e, _| {
        assert!(e.painted_rows > 0);
        assert!(e.painted_rows < 1000, "painted {}", e.painted_rows);
    });
}
#[test]
fn sidebar_tree_fade_follows_use_scroll_edge_state() {
    use explorer::bottom_fade;
    // Not scrollable (overflow within the 1px threshold): no fade.
    assert_eq!(bottom_fade(0., 0.), 0.);
    assert_eq!(bottom_fade(0., 1.), 0.);
    // Rows remain below: full fade until within 24px of the end.
    assert_eq!(bottom_fade(0., 400.), 1.);
    assert_eq!(bottom_fade(-376., 400.), 1.);
    assert_eq!(bottom_fade(-388., 400.), 0.5);
    assert_eq!(bottom_fade(-400., 400.), 0.);
    // Overscroll is clamped like `scrollTop`.
    assert_eq!(bottom_fade(-480., 400.), 0.);
    assert_eq!(bottom_fade(30., 400.), 1.);
}
#[gpui::test]
fn sidebar_tree_fades_into_the_footer_only_while_rows_remain_below(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = session_of(&view, cx);
    explorer.update(cx, |e, cx| {
        e.tree_mut().rows = (0..500)
            .map(|i| crate::model::Row {
                path: format!("{i}.txt").into(),
                name: format!("{i}.txt"),
                folder: false,
                expanded: false,
                depth: 0,
                display: format!("{i}"),
                extension: None,
                error: None,
                status: false,
            })
            .collect();
        cx.notify();
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    let fade = |explorer: &Entity<ExplorerSession>, cx: &mut VisualTestContext| {
        explorer.read_with(cx, |e, _| {
            let state = e.scroll().0.borrow();
            explorer::bottom_fade(
                f32::from(state.base_handle.offset().y),
                f32::from(state.base_handle.max_offset().y),
            )
        })
    };
    assert_eq!(fade(&explorer, cx), 1.);
    explorer.update(cx, |e, cx| {
        e.scroll().scroll_to_bottom();
        cx.notify();
    });
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    assert_eq!(fade(&explorer, cx), 0.);
}
#[gpui::test]
fn opening_a_folder_animates_its_rows_unless_motion_is_reduced(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    // A collapsed fixture folder whose children are already loaded.
    let folder = session.read_with(cx, |e, _| {
        e.tree()
            .rows
            .iter()
            .position(|r| r.folder && !r.expanded)
            .unwrap()
    });
    let started = std::time::Instant::now();
    session.update(cx, |e, cx| {
        let path = e.tree().rows[folder].path.clone();
        assert!(!e.tree_mut().toggle(&path));
        cx.notify();
    });
    draw(cx);
    // Motion runs on the real clock: a stalled machine may be past half way.
    if started.elapsed() < MOTION_EARLY {
        explorer.read_with(cx, |e, _| {
            // The first child starts hidden and the marker starts closed.
            assert!(e.motion().row(folder + 1).reveal.unwrap() < 0.5);
            assert!(e.motion().disclosure(folder).unwrap() < 0.5);
        });
    }
    // With reduced motion the same disclosure lands at once.
    cx.update(|_, cx| cx.set_reduce_motion(true));
    session.update(cx, |e, cx| {
        let path = e.tree().rows[folder].path.clone();
        e.tree_mut().toggle(&path);
        cx.notify();
    });
    draw(cx);
    explorer.read_with(cx, |e, _| {
        assert_eq!(e.motion().disclosure(folder), None);
        assert_eq!(e.motion().row(folder + 1), Default::default());
    });
}

#[gpui::test]
fn explorer_copy_path_and_copy_link_preserve_clipboard_and_targets(cx: &mut TestAppContext) {
    use explorer::{FileClipboard, MenuAt, MenuKind, RowTrigger};
    use std::sync::Arc;
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("docs")).unwrap();
    std::fs::write(dir.path().join("docs/笔记 #1.md"), "# Note").unwrap();
    std::fs::write(dir.path().join("photo.png"), b"\x89PNG").unwrap();
    std::fs::write(dir.path().join("other.md"), "other").unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    let events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let seen = events.clone();
    let session_events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let seen_session = session_events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&explorer, move |_, event: &explorer::ExplorerEvent, _| {
            seen.borrow_mut().push(event.clone());
        })
        .detach();
        cx.subscribe(&session, move |_, event: &explorer::SessionEvent, _| {
            seen_session.borrow_mut().push(event.clone());
        })
        .detach();
    });
    session.update(cx, |s, cx| {
        s.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx);
        let children = ws.list(Path::new("docs")).unwrap();
        s.children_loaded(Path::new("docs"), Ok(children), cx);
    });
    draw(cx);
    let idx = |path: &str, cx: &mut VisualTestContext| {
        session.read_with(cx, |s, _| s.tree().index_of(Path::new(path)).unwrap())
    };
    // Nested selection collapses to the parent folder while retaining the clicked child as primary launcher.
    session.update(cx, |s, cx| {
        s.select(Path::new("docs"), false, false, cx);
        s.select(Path::new("docs/笔记 #1.md"), true, false, cx);
    });
    let nested_idx = idx("docs/笔记 #1.md", cx);
    explorer.update(cx, |e, cx| {
        e.open_node_menu(
            nested_idx,
            MenuAt::Row("docs/笔记 #1.md".into(), RowTrigger::More),
            cx,
        );
        let menu = e.menu().unwrap();
        assert_eq!(
            menu.row_trigger(Path::new("docs/笔记 #1.md")),
            Some(RowTrigger::More)
        );
        assert_eq!(
            menu.kind,
            MenuKind::Node {
                paths: vec![PathBuf::from("docs")],
                primary: PathBuf::from("docs/笔记 #1.md"),
            }
        );
    });
    let copy_path_label = crate::localization::t("workspace.node.copyPath");
    let copy_link_label = crate::localization::t("workspace.node.copyLink");
    let paste_label = crate::localization::t("workspace.node.pasteIntoFolder");
    // Local folder: Copy Path is first, Paste into folder is offered, Copy Link is absent.
    let docs_idx = idx("docs", cx);
    session.update(cx, |s, cx| s.select(Path::new("docs"), false, false, cx));
    explorer.update(cx, |e, cx| {
        e.open_node_menu(docs_idx, MenuAt::Pointer(point(px(80.), px(80.))), cx);
        let labels = e.open_menu_labels(cx);
        assert_eq!(labels.first().map(String::as_str), Some(copy_path_label));
        assert!(!labels.iter().any(|l| l == copy_link_label));
        assert!(labels.iter().any(|l| l == paste_label));
    });
    draw(cx);
    let copy_selector: &'static str =
        Box::leak(format!("menu-item:{copy_path_label}").into_boxed_str());
    for target in ["docs", "docs/笔记 #1.md", "photo.png"] {
        let row_idx = idx(target, cx);
        session.update(cx, |s, cx| s.select(Path::new(target), false, false, cx));
        explorer.update(cx, |e, cx| {
            e.open_node_menu(row_idx, MenuAt::Pointer(point(px(80.), px(80.))), cx);
        });
        draw(cx);
        let btn = cx.debug_bounds(copy_selector).unwrap();
        cx.simulate_click(btn.center(), Modifiers::none());
        draw(cx);
        explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
        let expected = ws
            .absolute(Path::new(target))
            .unwrap()
            .display()
            .to_string();
        assert_eq!(
            cx.read_from_clipboard().and_then(|c| c.text()),
            Some(expected)
        );
    }
    // Multi-selection Copy Path copies the clicked row's path without disturbing the file clipboard.
    session.update(cx, |s, cx| {
        s.set_clipboard(FileClipboard::Cut(vec!["other.md".into()]), cx);
        s.select(Path::new("other.md"), false, false, cx);
        s.select(Path::new("docs/笔记 #1.md"), true, false, cx);
    });
    let nested_idx = idx("docs/笔记 #1.md", cx);
    explorer.update(cx, |e, cx| {
        e.open_node_menu(nested_idx, MenuAt::Pointer(point(px(80.), px(80.))), cx);
    });
    draw(cx);
    let btn = cx.debug_bounds(copy_selector).unwrap();
    cx.simulate_click(btn.center(), Modifiers::none());
    draw(cx);
    assert_eq!(
        cx.read_from_clipboard().and_then(|c| c.text()),
        Some(
            ws.absolute(Path::new("docs/笔记 #1.md"))
                .unwrap()
                .display()
                .to_string()
        )
    );
    session.read_with(cx, |s, _| {
        assert_eq!(
            s.clipboard(),
            Some(&FileClipboard::Cut(vec!["other.md".into()]))
        );
    });
    assert!(
        !session_events
            .borrow()
            .iter()
            .any(|e| matches!(e, explorer::SessionEvent::ResourceOperation(_)))
    );
    // Hosted (non-local) workspace offers Copy Link beside Copy Path and emits CopyLink.
    let memory = Arc::new(crate::workspace::testing::Memory::new(
        "memory://copy-link/project/",
    ));
    let hosted = crate::workspace::Workspace::from_provider(memory).unwrap();
    session.update(cx, |s, cx| {
        s.load_workspace(
            hosted.clone(),
            vec![crate::model::Node {
                name: "docs".into(),
                path: "docs".into(),
                folder: true,
                loaded: true,
                ..Default::default()
            }],
            cx,
        );
    });
    explorer.update(cx, |e, cx| {
        e.open_node_menu(0, MenuAt::Pointer(point(px(80.), px(80.))), cx);
        let labels = e.open_menu_labels(cx);
        assert_eq!(labels[0], copy_path_label);
        assert_eq!(labels[1], copy_link_label);
    });
    draw(cx);
    let link_selector: &'static str =
        Box::leak(format!("menu-item:{copy_link_label}").into_boxed_str());
    let btn = cx.debug_bounds(link_selector).unwrap();
    cx.simulate_click(btn.center(), Modifiers::none());
    draw(cx);
    assert!(events.borrow().iter().any(|e| {
        *e == explorer::ExplorerEvent::CopyLink {
            path: PathBuf::from("docs"),
            folder: true,
        }
    }));
}

#[gpui::test]
fn explorer_create_menu_follows_configured_order_submenu_and_divider_rules(
    cx: &mut TestAppContext,
) {
    use crate::features::create_new::{Entry, MenuSettings};
    use explorer::{ExplorerEvent, MenuAt, MenuKind, RowTrigger};
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("docs")).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    let events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let seen = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&explorer, move |_, event: &ExplorerEvent, _| {
            seen.borrow_mut().push(event.clone());
        })
        .detach();
    });
    session.update(cx, |s, cx| {
        s.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx);
    });
    // Configured main-menu order with CustomFiles in the middle and custom submenu items.
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.state.create_new = MenuSettings {
                main: vec![Entry::Html, Entry::CustomFiles, Entry::Markdown, Entry::Csv],
                submenu: vec![Entry::ContextMap],
                hidden: vec![
                    Entry::Text,
                    Entry::Json,
                    Entry::Whiteboard,
                    Entry::Slides,
                    Entry::App,
                    Entry::Puppyflow,
                ],
            };
            cx.notify();
        });
    });
    explorer.update(cx, |e, cx| {
        e.open_create_menu(
            "docs".into(),
            MenuAt::Row("docs".into(), RowTrigger::Create),
            cx,
        );
        assert_eq!(
            e.menu().unwrap().row_trigger(Path::new("docs")),
            Some(RowTrigger::Create)
        );
        let labels = e.open_menu_labels(cx);
        assert_eq!(
            labels,
            vec![
                crate::localization::t(Entry::Folder.label_key()),
                crate::localization::t(Entry::Html.label_key()),
                crate::localization::t("workspace.node.customFiles"),
                crate::localization::t(Entry::Markdown.label_key()),
                crate::localization::t(Entry::Csv.label_key()),
            ]
        );
        assert_eq!(e.open_menu_separator_count(cx), 1);
    });
    // Click CSV from main menu -> ExplorerEvent::Create { entry: Csv, parent: "docs" }.
    explorer.update(cx, |e, cx| {
        e.open_create_menu("docs".into(), MenuAt::Pointer(point(px(60.), px(60.))), cx);
    });
    draw(cx);
    let csv_sel: &'static str = Box::leak(
        format!(
            "menu-item:{}",
            crate::localization::t(Entry::Csv.label_key())
        )
        .into_boxed_str(),
    );
    let btn = cx.debug_bounds(csv_sel).unwrap();
    cx.simulate_click(btn.center(), Modifiers::none());
    draw(cx);
    assert!(events.borrow().iter().any(|e| {
        *e == ExplorerEvent::Create {
            entry: Entry::Csv,
            parent: PathBuf::from("docs"),
        }
    }));
    command(&view, cx, Command::Escape);
    // Open Custom files submenu and pick Context Map.
    explorer.update(cx, |e, cx| {
        e.open_create_menu("docs".into(), MenuAt::Pointer(point(px(60.), px(60.))), cx);
        e.set_menu_submenu_open(true, cx);
    });
    draw(cx);
    draw(cx);
    let cmap_sel: &'static str = Box::leak(
        format!(
            "menu-item:{}",
            crate::localization::t(Entry::ContextMap.label_key())
        )
        .into_boxed_str(),
    );
    let btn = cx.debug_bounds(cmap_sel).unwrap();
    cx.simulate_click(btn.center(), Modifiers::none());
    draw(cx);
    assert!(events.borrow().iter().any(|e| {
        *e == ExplorerEvent::Create {
            entry: Entry::ContextMap,
            parent: PathBuf::from("docs"),
        }
    }));
    command(&view, cx, Command::Escape);
    // Submenu keeps only configured types without hidden defaults.
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.state.create_new = MenuSettings {
                main: vec![Entry::Markdown, Entry::CustomFiles],
                submenu: vec![Entry::Json],
                hidden: vec![
                    Entry::Csv,
                    Entry::Html,
                    Entry::Text,
                    Entry::Whiteboard,
                    Entry::ContextMap,
                    Entry::Slides,
                    Entry::App,
                    Entry::Puppyflow,
                ],
            };
            cx.notify();
        });
    });
    explorer.update(cx, |e, cx| {
        e.open_create_menu("docs".into(), MenuAt::Pointer(point(px(60.), px(60.))), cx);
        e.set_menu_submenu_open(true, cx);
        assert_eq!(
            e.open_menu_labels(cx),
            vec![
                crate::localization::t(Entry::Folder.label_key()),
                crate::localization::t(Entry::Markdown.label_key()),
                crate::localization::t("workspace.node.customFiles"),
            ]
        );
    });
    draw(cx);
    draw(cx);
    let json_sel: &'static str = Box::leak(
        format!(
            "menu-item:{}",
            crate::localization::t(Entry::Json.label_key())
        )
        .into_boxed_str(),
    );
    assert!(cx.debug_bounds(json_sel).is_some());
    assert!(cx.debug_bounds(csv_sel).is_none());
    // No divider when Folder is the only visible entry.
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.state.create_new = MenuSettings {
                main: vec![],
                submenu: vec![],
                hidden: Entry::ITEMS.to_vec(),
            };
            cx.notify();
        });
    });
    explorer.update(cx, |e, cx| {
        e.open_create_menu(PathBuf::new(), MenuAt::NewRow, cx);
        assert_eq!(
            e.open_menu_labels(cx),
            vec![crate::localization::t(Entry::Folder.label_key())]
        );
        assert_eq!(e.open_menu_separator_count(cx), 0);
        assert_eq!(
            e.menu().unwrap().kind,
            MenuKind::Create {
                parent: PathBuf::new()
            }
        );
        assert_eq!(e.menu().unwrap().row_trigger(Path::new("docs")), None);
    });
}

#[gpui::test]
fn explorer_menu_handoff_switches_targets_and_resets_submenu_without_clearing_selection(
    cx: &mut TestAppContext,
) {
    use explorer::{MenuAt, MenuKind, RowTrigger};
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("docs")).unwrap();
    std::fs::create_dir(dir.path().join("notes")).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    session.update(cx, |s, cx| {
        s.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx);
    });
    let before = session.read_with(cx, |s, _| s.tree().selected.clone());
    explorer.update(cx, |e, cx| {
        // Open More on docs -> handoff to Create on docs -> handoff to More on notes.
        e.open_node_menu(0, MenuAt::Row("docs".into(), RowTrigger::More), cx);
        assert_eq!(
            e.menu().unwrap().row_trigger(Path::new("docs")),
            Some(RowTrigger::More)
        );
        e.open_create_menu(
            "docs".into(),
            MenuAt::Row("docs".into(), RowTrigger::Create),
            cx,
        );
        e.set_menu_submenu_open(true, cx);
        assert!(e.menu().unwrap().submenu_open);
        assert_eq!(
            e.menu().unwrap().row_trigger(Path::new("docs")),
            Some(RowTrigger::Create)
        );
        // Switching to another creation target resets submenu_open without intermediate empty state.
        e.open_create_menu(
            "notes".into(),
            MenuAt::Row("notes".into(), RowTrigger::Create),
            cx,
        );
        assert!(!e.menu().unwrap().submenu_open);
        assert_eq!(e.menu().unwrap().row_trigger(Path::new("docs")), None);
        assert_eq!(
            e.menu().unwrap().row_trigger(Path::new("notes")),
            Some(RowTrigger::Create)
        );
        // Handoff to NewRow launcher and then dismiss.
        e.open_create_menu(PathBuf::new(), MenuAt::NewRow, cx);
        assert_eq!(
            e.menu().unwrap().kind,
            MenuKind::Create {
                parent: PathBuf::new()
            }
        );
        assert!(e.dismiss_menu(cx));
        assert!(e.menu().is_none());
    });
    session.read_with(cx, |s, _| assert_eq!(s.tree().selected, before));
}

#[gpui::test]
fn explorer_virtual_window_navigation_empty_root_and_move_import_routing(cx: &mut TestAppContext) {
    use crate::editor::workbench::resource_operations::Operation as FileOp;
    use explorer::SessionEvent;
    let dir = tempfile::tempdir().unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    // Empty listed root has 0 tree rows and still paints the list-end New launcher slot.
    session.update(cx, |s, cx| {
        s.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx);
    });
    draw(cx);
    session.read_with(cx, |s, _| assert!(s.tree().rows.is_empty()));
    explorer.read_with(cx, |e, _| {
        assert!(e.painted_rows > 0 && e.painted_rows < 10)
    });
    // Virtual row stride follows application typography scale.
    let stride_default = crate::theme::sidebar_stride();
    assert!(stride_default > 0.);
    // 1,000 rows scrolled to offscreen row 900 keeps painted rows bounded.
    session.update(cx, |s, cx| {
        s.tree_mut().rows = (0..1_000)
            .map(|i| crate::model::Row {
                path: format!("document-{i}.md").into(),
                name: format!("document-{i}.md"),
                folder: false,
                expanded: false,
                depth: 0,
                display: format!("document-{i}"),
                extension: None,
                error: None,
                status: false,
            })
            .collect();
        s.select(Path::new("document-900.md"), false, false, cx);
        s.scroll().scroll_to_item(900, gpui::ScrollStrategy::Center);
        cx.notify();
    });
    draw(cx);
    explorer.read_with(cx, |e, _| {
        assert!(e.painted_rows > 0 && e.painted_rows < 200);
    });
    // Enter activates selected file and emits ExplorerEvent::Open.
    let opened = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let seen_open = opened.clone();
    let session_events = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let seen_session = session_events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&explorer, move |_, event: &explorer::ExplorerEvent, _| {
            seen_open.borrow_mut().push(event.clone());
        })
        .detach();
        cx.subscribe(&session, move |_, event: &SessionEvent, _| {
            seen_session.borrow_mut().push(event.clone());
        })
        .detach();
    });
    explorer.update_in(cx, |e, w, cx| e.focus_handle(cx).focus(w, cx));
    draw(cx);
    cx.simulate_keystrokes("enter");
    assert!(
        opened
            .borrow()
            .iter()
            .any(|e| { *e == explorer::ExplorerEvent::Open(PathBuf::from("document-900.md")) })
    );
    // Nested file move back to its parent folder routes through ResourceOperation(FileOp::Move).
    session.update(cx, |s, cx| {
        s.move_into(
            &[PathBuf::from("parent/child/drag-me.txt")],
            Path::new("parent"),
            cx,
        );
    });
    assert!(session_events.borrow().iter().any(|e| {
        *e == SessionEvent::ResourceOperation(FileOp::Move(
            vec![PathBuf::from("parent/child/drag-me.txt")],
            PathBuf::from("parent"),
        ))
    }));
    // Complete op so external drop import can run once.
    let owner =
        crate::editor::workbench::catalog::resource_key(&ws.resource_id(Path::new("")).unwrap());
    session.update(cx, |s, cx| {
        s.finish_op(&owner, Default::default(), cx);
    });
    session_events.borrow_mut().clear();
    let external = [PathBuf::from("/tmp/outside-note.md")];
    explorer.update(cx, |e, cx| {
        e.drop_external(&external, Path::new(""), cx);
    });
    assert_eq!(
        session_events
            .borrow()
            .iter()
            .filter(|e| {
                **e == SessionEvent::ResourceOperation(FileOp::Import(
                    vec![PathBuf::from("/tmp/outside-note.md")],
                    PathBuf::new(),
                ))
            })
            .count(),
        1
    );
}

/// `createEntryMenu.test.tsx`: `opens Custom files from focus and returns
/// to its trigger with ArrowLeft`; `sidebarMenuHandoff.test.tsx`: `uses
/// Escape to close the creation submenu before dismissing its parent`. A
/// folder row's "+" menu takes the keyboard.
#[gpui::test]
fn the_create_menu_walks_into_custom_files_and_escape_closes_the_submenu_first(
    cx: &mut TestAppContext,
) {
    use crate::features::create_new::{Entry, MenuSettings};
    use explorer::{MenuAt, RowTrigger};
    use gpui_kit::test::TestQueryExt as _;
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("docs")).unwrap();
    let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    session.update(cx, |s, cx| {
        s.load_workspace(ws.clone(), ws.list(Path::new("")).unwrap(), cx);
    });
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.state.create_new = MenuSettings {
                main: vec![Entry::Markdown, Entry::CustomFiles],
                submenu: vec![Entry::ContextMap],
                hidden: vec![
                    Entry::Csv,
                    Entry::Html,
                    Entry::Text,
                    Entry::Json,
                    Entry::Whiteboard,
                    Entry::Slides,
                    Entry::App,
                    Entry::Puppyflow,
                ],
            };
            cx.notify();
        });
    });
    explorer.update(cx, |e, cx| {
        e.open_create_menu(
            "docs".into(),
            MenuAt::Row("docs".into(), RowTrigger::Create),
            cx,
        )
    });
    draw(cx);
    draw(cx);
    let (folder, custom, map) = (
        crate::localization::t(Entry::Folder.label_key()),
        crate::localization::t("workspace.node.customFiles"),
        crate::localization::t(Entry::ContextMap.label_key()),
    );
    let focused = |cx: &mut VisualTestContext, label: &str| {
        cx.update(|w, _| w.try_find_by_label(label).and_then(|e| e.focused()) == Some(true))
    };
    let shown = |cx: &mut VisualTestContext, label: &str| {
        cx.update(|w, _| w.try_find_by_label(label).is_some())
    };
    let keys = |cx: &mut VisualTestContext, keys: &str| {
        cx.simulate_keystrokes(keys);
        draw(cx);
    };
    assert!(focused(cx, folder), "the menu takes the keyboard");
    // Focus on Custom files opens it; focus stays on the row.
    keys(cx, "down down");
    assert!(focused(cx, custom));
    assert!(shown(cx, map));
    // In with ArrowRight, back to its trigger with ArrowLeft.
    keys(cx, "right");
    assert!(focused(cx, map));
    keys(cx, "left");
    assert!(focused(cx, custom));
    assert!(!shown(cx, map));
    // Escape closes the submenu first, then the menu.
    keys(cx, "enter");
    assert!(focused(cx, map));
    keys(cx, "escape");
    assert!(focused(cx, custom));
    assert!(!shown(cx, map));
    explorer.read_with(cx, |e, _| assert!(e.menu().is_some()));
    keys(cx, "escape");
    explorer.read_with(cx, |e, _| assert!(e.menu().is_none()));
}

/// `explorerTreeSemantics.test.tsx`: `does not advertise file import for
/// read-only drags` — a workspace that cannot take files in offers no
/// import for files dragged from outside and starts none; a local folder
/// takes them in.
#[gpui::test]
fn a_read_only_workspace_offers_no_import_for_dragged_files(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx);
    let explorer = explorer_of(&view, cx);
    let session = session_of(&view, cx);
    let imports = std::rc::Rc::new(std::cell::Cell::new(0));
    let seen = imports.clone();
    cx.update(|_, cx| {
        cx.subscribe(&session, move |_, event: &explorer::SessionEvent, _| {
            if matches!(event, explorer::SessionEvent::ResourceOperation(_)) {
                seen.set(seen.get() + 1);
            }
        })
        .detach();
    });
    let outside = tempfile::tempdir().unwrap();
    let file = outside.path().join("a.md");
    std::fs::write(&file, "a").unwrap();
    let read_only = crate::workspace::Workspace::from_provider(std::sync::Arc::new(
        crate::workspace::testing::Memory::new("memory://read-only/project/"),
    ))
    .unwrap();
    session.update(cx, |s, cx| s.load_workspace(read_only, vec![], cx));
    explorer.update(cx, |e, cx| {
        assert!(!e.takes_files(cx), "no import is offered");
        e.drop_external(std::slice::from_ref(&file), Path::new(""), cx);
    });
    assert_eq!(imports.get(), 0, "none starts");
    let dir = tempfile::tempdir().unwrap();
    let local = crate::workspace::Workspace::open(dir.path()).unwrap();
    session.update(cx, |s, cx| {
        s.load_workspace(local.clone(), local.list(Path::new("")).unwrap(), cx)
    });
    explorer.update(cx, |e, cx| {
        assert!(e.takes_files(cx));
        e.drop_external(std::slice::from_ref(&file), Path::new(""), cx);
    });
    assert_eq!(imports.get(), 1, "a local folder takes them in");
}
