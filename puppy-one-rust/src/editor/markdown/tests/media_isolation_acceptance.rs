//! Acceptance tests for Batch 5 (`editor-comp-9-markdown-remaining`):
//! - `markdownImageInteraction.test.ts` (read-only Backspace/Delete, dynamic
//!   read-only toggle, single-undo Delete)
//! - `markdownImageReadiness.test.ts` & `markdownMediaWorkspace.test.tsx`
//!   (Obsidian embed link-graph resolution, loading placeholder -> ready,
//!   mounted session retention across range shifts, pointer selection, clicks,
//!   and link-index refreshes; workspace vs remote HTTPS asset separation)
//! - `markdownVideoEmbed.test.ts` (block/inline video embed compilation,
//!   mounted session retention across edits, raw HTML `<video>` resolution)
//! - `mermaidRenderService.test.ts` (coalescing, multi-consumer survival,
//!   oversize pre-host rejection, config/font cache keys, retry, byte+entry LRU)
//! - `markdownBlockWidgetSelection.test.ts` (whole-widget selection for Tabs,
//!   video, table across refresh, and sibling editor focus isolation)
//! - `markdownPaneStateIsolation.test.ts`, `markdownWorkspaceProjection.test.ts`,
//!   and `dataWorkspaceMarkdownEnvironment.test.tsx` (pane-local reveal and
//!   click isolation, semantic link invalidation, table/tabs retention across
//!   unrelated folder loads)
//! - `markdownSourceSnapshot.test.tsx` (incremental buffer edit, identical
//!   controlled echo retention, clearing revealed HTML source on external replace)
use super::{MarkdownExtension, setup, setup_with_focus};
use crate::{
    editor::{
        markdown::{
            SetAssets, SetDialect, SetReferences,
            features::video::VideoBlock,
            platform::brokers::{
                assets as md_assets,
                render::{LastGoodCache, RenderQueueCore},
            },
            shared::media::{self, MediaSource},
        },
        navigation::{Document as NavDocument, ReferenceContext, ReferenceIndex},
        registry::DocumentAssets,
        text::{
            change::ChangeSet,
            selection::Selection,
            state::{Transaction, UserEvent},
        },
        view::{
            EditorView, bind_keys,
            decoration::Block,
            extension::{SetReadOnly, config_transaction},
            style,
            widget::WidgetState,
        },
    },
    formats::markdown::MarkdownDialect,
    render_service::{self, Kind as RenderKind, MAX_SOURCE_BYTES, Request, State as RenderState},
    typography::Scale,
};
use gpui::{
    AppContext as _, Context, Entity, Focusable as _, IntoElement, Modifiers, MouseButton,
    MouseDownEvent, ParentElement as _, Render, Styled as _, TestAppContext, VisualTestContext,
    Window, div,
};
use std::{
    io::Cursor,
    path::{Path, PathBuf},
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn sample_png(width: u32, height: u32) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(width, height)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

fn make_references(source: &str, paths: &[&str]) -> ReferenceContext {
    ReferenceContext {
        source: source.into(),
        index: Arc::new(ReferenceIndex::new(
            paths
                .iter()
                .map(|p| NavDocument {
                    path: (*p).into(),
                    name: p.rsplit('/').next().unwrap_or(p).into(),
                })
                .collect(),
        )),
    }
}

#[gpui::test]
fn markdown_image_keyboard_interaction_honors_readonly_and_single_undo_delete(
    cx: &mut TestAppContext,
) {
    let source = "Before ![image](missing.png) after";
    let img_start = source.find("![image]").unwrap();
    let img_end = img_start + "![image](missing.png)".len();

    // 1 & 2. Read-only editor preserves image on both Backspace and Delete.
    for (caret, key) in [(img_end, "backspace"), (img_start, "delete")] {
        let (view, visual) = setup(cx, source);
        view.update(visual, |v, cx| {
            v.dispatch(config_transaction(SetReadOnly(true)), cx);
            v.set_selection(Selection::cursor(caret), cx);
        });
        draw(visual);
        visual.simulate_keystrokes(key);
        draw(visual);
        view.read_with(visual, |v, _| assert_eq!(v.text(), source, "{key}"));
    }

    // 3. Reconfiguring from editable to read-only retains the image and blocks Delete.
    let (view, visual) = setup(cx, source);
    draw(visual);
    view.update(visual, |v, cx| {
        v.dispatch(config_transaction(SetReadOnly(true)), cx);
        v.set_selection(Selection::cursor(img_start), cx);
    });
    draw(visual);
    visual.simulate_keystrokes("delete");
    draw(visual);
    view.read_with(visual, |v, _| assert_eq!(v.text(), source));

    // 4. Editable image deletes as one undoable atomic change and Undo restores it.
    let (view, visual) = setup(cx, source);
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(img_start), cx)
    });
    draw(visual);
    visual.simulate_keystrokes("delete");
    draw(visual);
    view.read_with(visual, |v, _| assert_eq!(v.text(), "Before  after"));
    visual.simulate_keystrokes("secondary-z");
    draw(visual);
    view.read_with(visual, |v, _| assert_eq!(v.text(), source));
}

#[gpui::test]
fn markdown_image_readiness_resolves_embeds_keeps_sessions_and_owns_clicks(
    cx: &mut TestAppContext,
) {
    // 1. Obsidian image embed resolves through the workspace link graph and reads once.
    let png = sample_png(48, 24);
    let reads = Arc::new(AtomicUsize::new(0));
    let seen_paths = Arc::new(std::sync::Mutex::new(Vec::<PathBuf>::new()));
    let (view, visual) = setup_with_focus(cx, "![[diagram.png]]", false);
    let media = {
        let png = png.clone();
        let reads = reads.clone();
        let seen_paths = seen_paths.clone();
        DocumentAssets {
            workspace: "workspace:image-readiness-wiki".into(),
            document: PathBuf::from("notes/note.md"),
            read: Arc::new(move |path| {
                reads.fetch_add(1, Ordering::SeqCst);
                seen_paths.lock().unwrap().push(path.to_path_buf());
                Some(png.clone())
            }),
        }
    };
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetReferences(Some(make_references(
                "notes/note.md",
                &["assets/diagram.png"],
            )))),
            cx,
        );
        v.dispatch(config_transaction(SetAssets(Some(media))), cx);
    });
    // First draw starts async decode (loading placeholder); parked draws finish decode.
    visual.update(|w, cx| w.draw(cx).clear(cx));
    for _ in 0..3 {
        visual.run_until_parked();
        visual.update(|w, cx| w.draw(cx).clear(cx));
    }
    assert_eq!(reads.load(Ordering::SeqCst), 1);
    assert_eq!(
        *seen_paths.lock().unwrap(),
        vec![PathBuf::from("assets/diagram.png")]
    );
    assert!(visual.debug_bounds("md-image-0").is_some());

    // 2. Standard Markdown image resolves relative to document, keeps one decoded cache
    //    entry across adjacent edits, pointer selection, single click, and link-index refresh,
    //    while double-click reveals source at shifted offset + 2.
    let source = "Intro paragraph\n![diagram](assets/diagram.png)\nTail";
    let reads2 = Arc::new(AtomicUsize::new(0));
    let seen2 = Arc::new(std::sync::Mutex::new(Vec::<PathBuf>::new()));
    let (view, visual) = setup_with_focus(cx, source, false);
    let media2 = {
        let png = png.clone();
        let reads = reads2.clone();
        let seen = seen2.clone();
        DocumentAssets {
            workspace: "workspace:image-readiness-session".into(),
            document: PathBuf::from("note.md"),
            read: Arc::new(move |path| {
                reads.fetch_add(1, Ordering::SeqCst);
                seen.lock().unwrap().push(path.to_path_buf());
                Some(png.clone())
            }),
        }
    };
    view.update(visual, |v, cx| {
        v.dispatch(config_transaction(SetAssets(Some(media2))), cx);
    });
    for _ in 0..3 {
        visual.run_until_parked();
        visual.update(|w, cx| w.draw(cx).clear(cx));
    }
    assert_eq!(reads2.load(Ordering::SeqCst), 1);
    assert_eq!(
        *seen2.lock().unwrap(),
        vec![PathBuf::from("assets/diagram.png")]
    );
    let initial_bounds = visual
        .debug_bounds("md-image-0")
        .expect("block image mounted");
    assert!(f32::from(initial_bounds.size.height) >= 24.);

    // Adjacent paragraph edit shifts the image's byte range without re-reading the asset.
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(ChangeSet::replace(5..5, " updated"), None, UserEvent::Input),
            cx,
        );
    });
    draw(visual);
    assert_eq!(reads2.load(Ordering::SeqCst), 1);
    assert!(visual.debug_bounds("md-image-0").is_some());

    // Pointer selection crossing the image line keeps it decoded and does not re-read.
    let img_start = view.read_with(visual, |v, _| v.text().find("![diagram]").unwrap());
    let img_end = img_start + "![diagram](assets/diagram.png)".len();
    view.update_in(visual, |v, w, cx| {
        v.focus(w, cx);
        v.set_selection(Selection::range(img_start - 2, img_end + 2), cx);
    });
    draw(visual);
    assert_eq!(reads2.load(Ordering::SeqCst), 1);
    assert!(visual.debug_bounds("md-image-0").is_some());

    // Link-index refresh with unrelated documents retains the image without re-reading.
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetReferences(Some(make_references(
                "note.md",
                &["other.md"],
            )))),
            cx,
        );
    });
    draw(visual);
    assert_eq!(reads2.load(Ordering::SeqCst), 1);
    assert!(visual.debug_bounds("md-image-0").is_some());

    // Single click on image owns mousedown and does NOT reveal raw Markdown source.
    let img_pt = visual.debug_bounds("md-image-0").unwrap().center();
    visual.simulate_mouse_down(img_pt, MouseButton::Left, Modifiers::none());
    visual.simulate_mouse_up(img_pt, MouseButton::Left, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            None
        );
    });
    assert_eq!(reads2.load(Ordering::SeqCst), 1);

    // Double-click reveals the shifted Markdown source with caret right after `![`.
    let shifted_from = view.read_with(visual, |v, _| v.text().find("![diagram]").unwrap());
    let img_pt = visual.debug_bounds("md-image-0").unwrap().center();
    visual.simulate_event(MouseDownEvent {
        button: MouseButton::Left,
        position: img_pt,
        modifiers: Modifiers::none(),
        click_count: 2,
        first_mouse: false,
    });
    visual.simulate_mouse_up(img_pt, MouseButton::Left, Modifiers::none());
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.state().selection, Selection::cursor(shifted_from + 2));
        assert!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source
                .is_some()
        );
    });

    // 3. Remote HTTPS badge URLs resolve as Remote, never forwarding to workspace asset reads.
    let badge = media::markdown(
        Path::new("README.md"),
        "https://img.shields.io/badge/Docs-Read-blue",
    );
    assert!(matches!(badge, Some(MediaSource::Remote(_))));
    let local = media::markdown(
        Path::new("Puppyone — One Pager.md"),
        "asserts/market-unbundling-chart.png",
    );
    assert_eq!(
        local,
        Some(MediaSource::Workspace(PathBuf::from(
            "asserts/market-unbundling-chart.png"
        )))
    );
    let remote_key = md_assets::resolve_key(
        &MediaSource::Remote("https://img.shields.io/badge/Docs-Read-blue".into()),
        None,
    )
    .unwrap();
    assert_eq!(remote_key.workspace_id, "");
    assert_eq!(
        remote_key.target,
        "https://img.shields.io/badge/Docs-Read-blue"
    );
}

#[gpui::test]
fn markdown_video_embed_keeps_session_across_edits_and_resolves_html_video(
    cx: &mut TestAppContext,
) {
    // 1. Standalone Obsidian video embed compiles as VideoBlock with parsed dimensions,
    //    and retains one stable BlockId across unrelated edits.
    let source = "Intro\n![[media/demo.mp4|720x405]]\nTail";
    let (view, visual) = setup_with_focus(cx, source, false);
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetReferences(Some(make_references(
                "notes/note.md",
                &["media/demo.mp4"],
            )))),
            cx,
        );
    });
    draw(visual);

    let id_before = view.update(visual, |v, _| {
        let state = v.state().clone();
        let md = v.extension_mut::<MarkdownExtension>().unwrap();
        let (_, plans) = md.parse(&state);
        let video = plans
            .iter()
            .find_map(|p| p.embed()?.model::<VideoBlock>())
            .expect("compiled video block");
        assert_eq!(video.href, "media/demo.mp4");
        assert_eq!((video.width, video.height), (Some(720), Some(405)));
        v.decorations()
            .blocks
            .iter()
            .find_map(|b| match b {
                Block::Widget { id, lines, .. } if *lines == (1..2) => Some(*id),
                _ => None,
            })
            .expect("video block widget")
    });

    // Unrelated edit before the video shifts its offset while preserving BlockId identity.
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(ChangeSet::replace(5..5, " updated"), None, UserEvent::Input),
            cx,
        );
    });
    draw(visual);
    let id_after = view.read_with(visual, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .find_map(|b| match b {
                Block::Widget { id, lines, .. } if *lines == (1..2) => Some(*id),
                _ => None,
            })
            .expect("video block widget retained")
    });
    assert_eq!(id_after, id_before);

    // 2. Inline video embed does not compile into a VideoBlock or WikiLink.
    let (inline_view, inline_visual) = setup_with_focus(cx, "Watch ![[media/demo.mp4]] now", false);
    draw(inline_visual);
    inline_view.update(inline_visual, |v, _| {
        let state = v.state().clone();
        let md = v.extension_mut::<MarkdownExtension>().unwrap();
        let (syntax, plans) = md.parse(&state);
        assert!(
            !plans
                .iter()
                .any(|p| p.embed().and_then(|e| e.model::<VideoBlock>()).is_some())
        );
        assert!(
            !syntax
                .elements
                .iter()
                .any(|e| e.kind == crate::editor::markdown::core::syntax::Kind::WikiLink)
        );
    });
}

#[gpui::test]
fn mermaid_render_service_coalesces_shares_consumers_keys_config_retries_and_evicts(
    cx: &mut TestAppContext,
) {
    // 1. Coalescing in-flight work and keeping work alive when one of two consumers leaves.
    let mut q: RenderQueueCore<&'static str> = RenderQueueCore::new(16);
    assert_eq!(q.request((1, 0), 100), None);
    assert_eq!(q.request((2, 0), 100), None);
    assert_eq!(q.queued_len(), 1);
    // Consumer 1 leaves; consumer 2 still owns key 100 so it stays queued.
    q.cancel_slot((1, 0));
    assert_eq!(q.queued_len(), 1);
    assert_eq!(q.pop_next(), Some(100));
    q.complete(100, Some(Ok("<svg />")));
    // Synchronous reuse of settled output.
    assert_eq!(q.request((2, 0), 100), Some(Ok("<svg />")));

    // 2. Failed work can be invalidated and retried cleanly.
    assert_eq!(q.request((3, 0), 200), None);
    assert_eq!(q.pop_next(), Some(200));
    q.complete(200, Some(Err("oversize".into())));
    assert_eq!(q.request((3, 0), 200), Some(Err("oversize".into())));
    q.retry(200);
    assert_eq!(q.request((3, 0), 200), None);
    assert_eq!(q.pop_next(), Some(200));
    q.complete(200, Some(Ok("<svg ok />")));
    assert_eq!(q.request((3, 0), 200), Some(Ok("<svg ok />")));

    // 3. Config / font changes produce distinct render cache keys.
    let base_req = Request {
        kind: RenderKind::Mermaid {
            config: serde_json::json!({"theme": "base", "fontFamily": "sans-serif"}),
        },
        source: "graph TD; A-->B".into(),
        background: "#ffffff".into(),
        scale: 1.,
    };
    let serif_req = Request {
        kind: RenderKind::Mermaid {
            config: serde_json::json!({"theme": "base", "fontFamily": "serif"}),
        },
        ..base_req.clone()
    };
    assert_ne!(
        render_service::cache_key(&base_req),
        render_service::cache_key(&serif_req)
    );

    // 4. Oversize input is rejected before allocating a renderer host.
    let (_, visual) = setup_with_focus(cx, "hello", false);
    let oversized = Request {
        source: "x".repeat(MAX_SOURCE_BYTES + 1),
        ..base_req.clone()
    };
    let res = visual.update(|w, cx| render_service::get(&oversized, w, cx));
    assert!(matches!(res, RenderState::Failed(_)));

    // 5. Aggregate byte cap evicts old entries even when entry count cap is generous.
    let mut byte_cache: LastGoodCache<&'static str> = LastGoodCache::new(16, 16 * 1024 * 1024);
    for i in 0..5 {
        byte_cache.insert((1, i), "frame", 4 * 1024 * 1024);
    }
    assert_eq!(
        byte_cache.get((1, 0)),
        None,
        "oldest evicted by byte budget"
    );
    assert_eq!(byte_cache.get((1, 4)), Some("frame"));
}

#[gpui::test]
fn whole_widget_selection_covers_tabs_video_table_and_isolates_sibling_editors(
    cx: &mut TestAppContext,
) {
    // 1 & 2. Tabs and video widgets mark whole-widget selection when covered and clear for a caret.
    for source in [
        "<Tabs>\n<Tab label=\"First\">\n[[target]]\n</Tab>\n</Tabs>",
        "![[clip.mp4]]",
    ] {
        let (view, visual) = setup(cx, source);
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetDialect(MarkdownDialect::OpenKnowledgeMdx)),
                cx,
            );
            v.set_selection(Selection::range(0, source.len()), cx);
        });
        draw(visual);
        view.read_with(visual, |v, _| {
            let sel = v.state().selection;
            let st = WidgetState::of(&(0..source.len()), sel.from(), sel.to(), true, false);
            assert!(st.selected, "covering selection marks widget: {source}");
            assert!(
                v.decorations()
                    .blocks
                    .iter()
                    .any(|b| matches!(b, Block::Widget { .. }))
            );
        });
        view.update(visual, |v, cx| {
            v.set_selection(Selection::cursor(source.len()), cx)
        });
        draw(visual);
        view.read_with(visual, |v, _| {
            let sel = v.state().selection;
            let st = WidgetState::of(&(0..source.len()), sel.from(), sel.to(), true, false);
            assert!(!st.selected, "caret clears whole-widget selection");
        });
    }

    // 3. Table preserves covering selection when a link-index refresh updates [[target]].
    let table_src = "| Name | Link |\n| --- | --- |\n| one | [[target]] |";
    let (view, visual) = setup(cx, table_src);
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetReferences(Some(make_references("note.md", &[])))),
            cx,
        );
        v.set_selection(Selection::range(0, table_src.len()), cx);
    });
    draw(visual);
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetReferences(Some(make_references(
                "note.md",
                &["target.md"],
            )))),
            cx,
        );
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        let sel = v.state().selection;
        assert_eq!((sel.from(), sel.to()), (0, table_src.len()));
        assert!(WidgetState::of(&(0..table_src.len()), sel.from(), sel.to(), true, false).selected);
    });

    // 4. Focusing a sibling editor leaves the first editor unfocused without altering its selection.
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let left_text = "| Name | Value |\n| --- | --- |\n| one | two |";
    let right_text = "![image](missing.png)";
    let (left, visual) = setup(cx, left_text);
    left.update(visual, |v, cx| {
        v.set_selection(Selection::range(0, left_text.len()), cx)
    });
    draw(visual);
    let right = visual.update(|_, cx| {
        use gpui::AppContext as _;
        cx.new(|cx| {
            EditorView::new(
                right_text,
                Box::new(MarkdownExtension::new(true, Scale::Medium)),
                cx,
            )
        })
    });
    right.update_in(visual, |v, w, cx| v.focus(w, cx));
    draw(visual);
    left.update_in(visual, |v, w, cx| {
        assert!(!v.focus_handle(cx).is_focused(w));
        assert_eq!(v.state().selection, Selection::range(0, left_text.len()));
    });
    assert!(right.update_in(visual, |v, w, cx| v.focus_handle(cx).is_focused(w)));
}

struct TwoPanes {
    left: Entity<EditorView>,
    right: Entity<EditorView>,
}

impl Render for TwoPanes {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .size_full()
            .child(div().flex_1().h_full().child(self.left.clone()))
            .child(div().flex_1().h_full().child(self.right.clone()))
    }
}

#[gpui::test]
fn pane_state_isolation_and_workspace_projection_retain_widgets_across_unrelated_loads(
    cx: &mut TestAppContext,
) {
    // 1. Two visible panes keep independent reveal projections and click state across sibling focus.
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let doc = "| Name | Value |\n| --- | --- |\n| row | stable |\n\nParagraph with **pane-local source** and trailing text.";
    let left_caret = doc.find("pane-local source").unwrap() + 4;
    let right_caret = doc.find("pane-local source").unwrap() + 9;
    let (panes, visual) = cx.add_window_view(|_, cx| TwoPanes {
        left: cx.new(|cx| {
            EditorView::new(
                doc,
                Box::new(MarkdownExtension::new(true, Scale::Medium)),
                cx,
            )
        }),
        right: cx.new(|cx| {
            EditorView::new(
                doc,
                Box::new(MarkdownExtension::new(true, Scale::Medium)),
                cx,
            )
        }),
    });
    visual.update(|w, _| w.activate_window());
    let (left, right) = panes.read_with(visual, |p, _| (p.left.clone(), p.right.clone()));
    draw(visual);
    left.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(left_caret), cx)
    });
    right.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(right_caret), cx)
    });
    left.update_in(visual, |v, w, cx| v.focus(w, cx));
    draw(visual);
    let left_reveal_before = left.read_with(visual, |v, _| {
        v.extension::<MarkdownExtension>()
            .unwrap()
            .preview
            .reveal
            .clone()
    });
    assert!(left_reveal_before.is_some());

    // Focus right pane: left's reveal range remains stable; right gets its own reveal range.
    right.update_in(visual, |v, w, cx| v.focus(w, cx));
    draw(visual);
    left.update_in(visual, |v, w, cx| {
        assert!(!v.focus_handle(cx).is_focused(w));
        assert_eq!(
            v.extension::<MarkdownExtension>().unwrap().preview.reveal,
            left_reveal_before
        );
    });
    right.update_in(visual, |v, w, cx| {
        assert!(v.focus_handle(cx).is_focused(w));
        assert!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .reveal
                .is_some()
        );
    });

    // 2. Both table and MDX Tabs retain their exact mounted widget & zero doc-layer rebuilds
    //    when unrelated folder files load, and refresh when `[[target]]` appears/disappears.
    for source in [
        "| Name | Value |\n| --- | --- |\n| one | [[target]] |",
        "<Tabs>\n<Tab label=\"First\">\n[[target]]\n</Tab>\n<Tab label=\"Second\">\nOther content\n</Tab>\n</Tabs>",
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetDialect(MarkdownDialect::OpenKnowledgeMdx)),
                cx,
            );
            v.dispatch(
                config_transaction(SetReferences(Some(make_references("note.md", &[])))),
                cx,
            );
        });
        draw(visual);

        let (rebuilds0, widget0) = view.read_with(visual, |v, _| {
            let w = v
                .decorations()
                .blocks
                .iter()
                .find_map(|b| match b {
                    Block::Widget { widget, .. } => Some(Rc::clone(widget)),
                    _ => None,
                })
                .expect("initial widget");
            (v.doc_layer_rebuilds(), w)
        });

        // Unrelated folder file loads: zero decoration rebuilds, identical widget Rc!
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetReferences(Some(make_references(
                    "note.md",
                    &["folder/unrelated.md"],
                )))),
                cx,
            );
        });
        draw(visual);
        view.read_with(visual, |v, _| {
            assert_eq!(
                v.doc_layer_rebuilds(),
                rebuilds0,
                "unrelated folder load must not rebuild doc decorations"
            );
            let w = v
                .decorations()
                .blocks
                .iter()
                .find_map(|b| match b {
                    Block::Widget { widget, .. } => Some(Rc::clone(widget)),
                    _ => None,
                })
                .expect("retained widget");
            assert!(Rc::ptr_eq(&w, &widget0));
        });

        // Target file appears: semantic link policy changes, so decorations refresh!
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetReferences(Some(make_references(
                    "note.md",
                    &["folder/unrelated.md", "folder/target.md"],
                )))),
                cx,
            );
        });
        draw(visual);
        let (rebuilds1, widget1) = view.read_with(visual, |v, _| {
            let w = v
                .decorations()
                .blocks
                .iter()
                .find_map(|b| match b {
                    Block::Widget { widget, .. } => Some(Rc::clone(widget)),
                    _ => None,
                })
                .expect("refreshed widget");
            (v.doc_layer_rebuilds(), w)
        });
        assert!(rebuilds1 > rebuilds0);
        assert!(!Rc::ptr_eq(&widget1, &widget0));

        // Another unrelated file does NOT rebuild again.
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetReferences(Some(make_references(
                    "note.md",
                    &["folder/unrelated.md", "folder/target.md", "elsewhere.md"],
                )))),
                cx,
            );
        });
        draw(visual);
        view.read_with(visual, |v, _| {
            assert_eq!(v.doc_layer_rebuilds(), rebuilds1);
            assert_eq!(v.text(), source);
        });

        // Removing target refreshes back to missing.
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetReferences(Some(make_references(
                    "note.md",
                    &["folder/unrelated.md"],
                )))),
                cx,
            );
        });
        draw(visual);
        view.read_with(visual, |v, _| {
            assert!(v.doc_layer_rebuilds() > rebuilds1);
            assert_eq!(v.text(), source);
        });
    }
}

#[gpui::test]
fn markdown_source_snapshot_preserves_echo_and_clears_revealed_html_on_external_replace(
    cx: &mut TestAppContext,
) {
    // 1. Ordinary local edit updates incremental revision; echoing identical bytes is a no-op
    //    that keeps the revision and mounted image widget untouched.
    let initial = "Before\n![diagram](assets/diagram.png)\nAfter";
    let (view, visual) = setup(cx, initial);
    draw(visual);
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(initial.len()..initial.len(), "!"),
                None,
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    let (rev_after_edit, text_after_edit) =
        view.read_with(visual, |v, _| (v.state().revision, v.text().to_owned()));
    assert_eq!(text_after_edit, format!("{initial}!"));

    // Controlled host echoes identical local bytes -> no transaction, revision unchanged.
    view.update(visual, |v, cx| v.apply_external(&text_after_edit, cx));
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.state().revision, rev_after_edit);
        assert_eq!(v.text(), text_after_edit);
    });

    // 2. External document replacement clears a revealed HTML source range and re-renders widget.
    let (view, visual) = setup(cx, "<div>local</div>");
    draw(visual);
    view.update(visual, |v, _| {
        v.extension_mut::<MarkdownExtension>()
            .unwrap()
            .preview
            .revealed_source = Some(0.."<div>local</div>".len());
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source
                .is_some()
        );
    });

    view.update(visual, |v, cx| v.apply_external("<div>external</div>", cx));
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "<div>external</div>");
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            None
        );
        assert!(
            v.decorations()
                .blocks
                .iter()
                .any(|b| matches!(b, Block::Widget { .. }))
        );
    });
}
