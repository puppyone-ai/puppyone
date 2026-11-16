use super::{
    CodeSurface, CodeView, FindEvent, Language, Scale, SurfaceEvent, SurfaceInput, SurfaceRequest,
    ViewerSurface,
};
use crate::editor::{
    code::{extension::CodeExtension, highlight::SyntaxColors},
    csv::CsvEditor,
    registry::{self, EditorDocument, PaneSegmentId, SourceKind},
    text::selection::Selection,
    view::{
        decoration::{Block, packed},
        plugins::ConflictBannerPlugin,
        style::{self, Paint},
    },
    viewers::text::open_markdown,
};
use gpui::{
    Context, Entity, EntityInputHandler, Focusable, IntoElement, Render, TestAppContext,
    VisualTestContext, Window,
};
use std::{cell::RefCell, rc::Rc};

struct SurfaceHost(Box<dyn ViewerSurface>);
impl Render for SurfaceHost {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.0.element()
    }
}

fn setup<'a>(
    cx: &'a mut TestAppContext,
    name: &str,
    text: &str,
) -> (
    Entity<CodeView>,
    Rc<RefCell<Vec<SurfaceEvent>>>,
    &'a mut VisualTestContext,
) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::ime::init(cx);
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
    });
    let resolved = registry::resolve(&EditorDocument::local(name));
    let (view, cx) = cx.add_window_view(|w, cx| {
        CodeView::new(
            &SurfaceRequest {
                id: "code",
                name,
                input: SurfaceInput::Text(text),
                format: resolved.format,
                resolved_extension: None,
                dark: true,
                scale: Scale::Medium,
                workspace: None,
                file_mode: false,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: SourceKind::Local,
            },
            w,
            cx,
        )
    });
    let events: Rc<RefCell<Vec<SurfaceEvent>>> = Rc::default();
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, e: &SurfaceEvent, _| {
            sink.borrow_mut().push(e.clone())
        })
        .detach()
    });
    view.update_in(cx, |v, w, cx| {
        let fh = v.editor.read(cx).focus_handle(cx);
        fh.focus(w, cx);
    });
    draw(cx);
    (view, events, cx)
}

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}

fn text(view: &Entity<CodeView>, cx: &mut VisualTestContext) -> String {
    view.read_with(cx, |v, cx| v.text(cx))
}

#[gpui::test]
fn code_ime_is_provisional_until_commit_or_cancel(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "value.json", "🐶");
    view.update_in(cx, |v, w, cx| {
        v.set_selected_text_range(2..2, w, cx);
        v.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        assert_eq!(v.marked_text_range(w, cx), Some(2..4));
        assert!(v.composing(cx));
        assert_eq!(v.text(cx), "🐶");
    });
    draw(cx);
    assert!(events.borrow().is_empty());
    view.update_in(cx, |v, w, cx| v.replace_text_in_range(None, "你", w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "🐶你");
    assert_eq!(events.borrow().len(), 1);
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "hao", Some(3..3), w, cx)
    });
    draw(cx);
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "", Some(0..0), w, cx)
    });
    draw(cx);
    assert_eq!(text(&view, cx), "🐶你");
    assert_eq!(
        events.borrow().len(),
        2,
        "cancel wakes pending snapshot even without a text change"
    );
}

#[gpui::test]
fn code_unmark_preserves_single_undo_transaction(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "value.json", "");
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "n", Some(1..1), w, cx);
        v.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        v.unmark_text(w, cx);
    });
    draw(cx);
    assert_eq!(text(&view, cx), "ni");
    assert_eq!(events.borrow().len(), 1);
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "");
    view.update_in(cx, |v, w, cx| v.history(true, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "ni");
}

#[gpui::test]
fn code_external_reload_abandons_preedit_and_readonly_blocks_input(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "value.json", "");
    view.update_in(cx, |v, w, cx| {
        v.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        v.replace("{\"remote\":true}", w, cx);
    });
    draw(cx);
    assert!(events.borrow().is_empty());
    let editor = view.read_with(cx, |v, _| v.editor.clone());
    let surface = CodeSurface {
        view: view.clone(),
        editor,
    };
    cx.update(|w, cx| surface.apply(true, false, Scale::Large, w, cx));
    view.update_in(cx, |v, w, cx| {
        assert!(!v.composing(cx));
        v.replace_text_in_range(None, "lost", w, cx);
        v.replace_and_mark_text_in_range(None, "lost", Some(4..4), w, cx);
    });
    draw(cx);
    assert_eq!(text(&view, cx), "{\"remote\":true}");
    assert!(events.borrow().is_empty());
}

#[gpui::test]
fn code_language_rebind_keeps_entity_selection_and_history(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "main.ts", "");
    let id = view.read_with(cx, |v, _| v.editor.entity_id());
    view.update_in(cx, |v, w, cx| {
        v.replace_text_in_range(None, "const answer = 42;", w, cx);
        v.rebind("main.py", cx);
        assert_eq!(v.editor.entity_id(), id);
        assert_eq!(v.language(), Language("python"));
        assert_eq!(v.selected_text_range(false, w, cx).unwrap().range, 18..18);
    });
    draw(cx);
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "");
    view.update_in(cx, |v, w, cx| v.history(true, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "const answer = 42;");
}

#[gpui::test]
fn code_platform_typing_autocloses_and_indents_json(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "value.json", "");
    view.update_in(cx, |v, w, cx| v.replace_text_in_range(None, "{", w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "{}");
    cx.simulate_keystrokes("enter");
    draw(cx);
    assert_eq!(text(&view, cx), "{\n  \n}");
    view.update_in(cx, |v, w, cx| {
        assert_eq!(v.selected_text_range(false, w, cx).unwrap().range, 4..4);
    });
}

#[gpui::test]
fn code_multicursor_edits_are_one_undo_transaction(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "main.ts", "one\ntwo");
    view.update_in(cx, |v, w, cx| {
        v.editor.update(cx, |e, cx| {
            e.set_selection(Selection::cursor(3), cx);
            e.add_selection(Selection::cursor(7), cx);
        });
        v.replace_text_in_range(None, "!", w, cx);
    });
    draw(cx);
    assert_eq!(text(&view, cx), "one!\ntwo!");
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    draw(cx);
    assert_eq!(text(&view, cx), "one\ntwo");
}

#[gpui::test]
fn code_find_wraps_without_changing_the_document(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "main.ts", "alpha beta\nAlpha gamma\nalphabet\n");
    view.update_in(cx, |v, w, cx| {
        assert_eq!(
            v.find(FindEvent::Query("ALPHA".into()), w, cx),
            Some((1, 3))
        );
        assert_eq!(
            v.find(FindEvent::Move { forward: false }, w, cx),
            Some((3, 3))
        );
        assert_eq!(v.editor.read(cx).state().selection.as_range(), 23..28);
        assert_eq!(
            v.find(FindEvent::Move { forward: true }, w, cx),
            Some((1, 3))
        );
        assert_eq!(v.find(FindEvent::Close, w, cx), None);
        assert!(v.editor.read(cx).find_marks().query.is_empty());
    });
    draw(cx);
    assert!(!events.borrow().contains(&SurfaceEvent::Changed));
}

#[gpui::test]
fn code_find_starts_at_selection_and_updates_after_edits(cx: &mut TestAppContext) {
    let (view, events, cx) = setup(cx, "main.ts", "Café\nCAFE\u{301}\nCafé");
    view.update_in(cx, |v, w, cx| {
        v.set_selected_text_range(5..5, w, cx);
        assert_eq!(v.find(FindEvent::Query("CAFÉ".into()), w, cx), Some((2, 3)));
        assert_eq!(v.editor.read(cx).state().selection.as_range(), 6..12);
        v.replace_text_in_range(None, "gone", w, cx);
    });
    draw(cx);
    assert!(events.borrow().contains(&SurfaceEvent::FindResult {
        current: 2,
        total: 2
    }));
}

#[gpui::test]
fn conflict_banner_resolves_blocks_as_an_undoable_local_edit(cx: &mut TestAppContext) {
    use super::conflicts;
    let initial = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature\nb";
    let (view, events, cx) = setup(cx, "notes.txt", initial);
    draw(cx);
    view.read_with(cx, |v, cx| {
        assert_eq!(conflicts::parse(&v.text(cx)).len(), 1);
    });
    view.update_in(cx, |v, w, cx| {
        let cur = v.text(cx);
        let resolved = conflicts::resolve_all(&cur, conflicts::Side::Theirs);
        v.resolve_conflicts(resolved, w, cx);
    });
    assert_eq!(text(&view, cx), "a\ntheirs\nb");
    assert!(events.borrow().contains(&SurfaceEvent::Changed));
    // Undo restores the markers.
    view.update_in(cx, |v, w, cx| v.history(false, w, cx));
    assert_eq!(text(&view, cx), initial);
}

#[gpui::test]
fn undo_history_keeps_the_policy_s_newest_entries(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "notes.txt", "");
    // Separate edits (not adjacent typing): the oldest beyond 200 are gone.
    for i in 0..(super::HISTORY_ENTRIES + 5) {
        view.update_in(cx, |v, w, cx| {
            assert!(v.edit_utf16(&[(0..0, format!("{}\n", i % 10))], w, cx));
        });
    }
    for _ in 0..(super::HISTORY_ENTRIES + 5) {
        view.update_in(cx, |v, w, cx| v.replay(false, w, cx));
    }
    assert_eq!(text(&view, cx), "4\n3\n2\n1\n0\n");
}

#[gpui::test]
fn an_edit_beyond_the_history_byte_budget_is_not_undoable(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "notes.txt", "");
    view.update_in(cx, |v, w, cx| {
        assert!(v.edit_utf16(&[(0..0, "small\n".into())], w, cx));
        // 4.5 Mi UTF-16 units are 9 MiB of retained text.
        let big = "x".repeat(super::HISTORY_BYTES / 2 + 512 * 1024);
        assert!(v.edit_utf16(&[(6..6, big)], w, cx));
        v.replay(false, w, cx);
    });
    assert!(text(&view, cx).len() > super::HISTORY_BYTES / 2);
}

/// CE-02 & CE-03: keystrokes do not flatten multi-chunk ropes into a String, and
/// derived conflict/syntax state is cached per committed revision across redraws.
#[gpui::test]
fn keystrokes_avoid_flat_string_copy_and_cache_derived_data_by_revision(cx: &mut TestAppContext) {
    let body = "const item = [1, 2, 3];\n".repeat(1_000);
    let (view, events, cx) = setup(cx, "main.ts", &body);
    let (recomputes_0, parses_0) = view.read_with(cx, |v, cx| {
        let ed = v.editor.read(cx);
        (
            ed.extension::<CodeExtension>()
                .unwrap()
                .derived_recompute_count(),
            ed.plugin::<ConflictBannerPlugin>().unwrap().parse_count(),
        )
    });
    draw(cx);
    draw(cx);
    view.read_with(cx, |v, cx| {
        let ed = v.editor.read(cx);
        assert_eq!(
            ed.extension::<CodeExtension>()
                .unwrap()
                .derived_recompute_count(),
            recomputes_0,
            "redraws at unchanged revision must reuse cached derived state"
        );
        assert_eq!(
            ed.plugin::<ConflictBannerPlugin>().unwrap().parse_count(),
            parses_0,
            "redraws at unchanged revision must not rescan conflict markers"
        );
    });

    // Type at offset 0 and verify `committed_buffer` never flattens the multi-leaf rope.
    view.update_in(cx, |v, w, cx| {
        v.set_selected_text_range(0..0, w, cx);
        v.replace_text_in_range(None, "// top\n", w, cx);
        let snap = v.committed_buffer(cx);
        assert!(!snap.has_materialized_flat());
    });
    assert_eq!(events.borrow().len(), 1);
}

/// CE-10 (`TODO-49`), CE-11, CE-12: Markdown source panel highlights via the
/// Markdown pipeline's own `Syntax`, Sub Theme `--po-md-syntax-*` overrides take
/// effect at runtime, and code indent guides render up to 16 columns.
#[gpui::test]
fn markdown_source_highlighting_subtheme_tokens_and_indent_guides(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::ime::init(cx);
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
    });
    // 1. CE-10: Markdown source panel (`language_override = Some("markdown")`)
    let resolved = registry::resolve(&EditorDocument::local("guide.md"));
    let (md_host, cx) = cx.add_window_view(|w, cx| {
        SurfaceHost(super::open_with(
            &SurfaceRequest {
                id: "md-src",
                name: "guide.md",
                input: SurfaceInput::Text(
                    "# Heading\n\nUse `code` and [link](https://a.example).\n",
                ),
                format: resolved.format,
                resolved_extension: None,
                dark: true,
                scale: Scale::Medium,
                workspace: None,
                file_mode: true,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: SourceKind::Local,
            },
            Some("markdown"),
            true,
            w,
            cx,
        ))
    });
    draw(cx);
    md_host.read_with(cx, |host, cx| {
        let colors = SyntaxColors::resolve(true, Scale::Medium);
        let ed = host.0.as_test_probe().unwrap().editor_view().unwrap();
        let decos = ed.read(cx).decorations();
        assert!(
            decos
                .marks
                .iter()
                .any(|m| m.style.bold && m.style.color == Some(packed(colors.keyword))),
            "Markdown source must highlight headings via Markdown Syntax: {:?}",
            decos.marks
        );
    });

    // 2. CE-11 & CE-12: Sub Theme syntax token override + indent guides
    let ts_resolved = registry::resolve(&EditorDocument::local("guide.ts"));
    let (ts_view, cx) = cx.add_window_view(|w, cx| {
        CodeView::new(
            &SurfaceRequest {
                id: "ts-src",
                name: "guide.ts",
                input: SurfaceInput::Text("const x = {\n    value: 1,\n};\n"),
                format: ts_resolved.format,
                resolved_extension: None,
                dark: true,
                scale: Scale::Medium,
                workspace: None,
                file_mode: false,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: SourceKind::Local,
            },
            w,
            cx,
        )
    });
    draw(cx);
    ts_view.read_with(cx, |v, cx| {
        let decos = v.editor.read(cx).decorations();
        let Block::Line { style, .. } = &decos.blocks[1] else {
            panic!("expected line block");
        };
        let guides = style
            .overlays
            .iter()
            .filter(|p| matches!(p, Paint::Quad { rect, .. } if rect.width == 1.))
            .count();
        assert_eq!(
            guides, 2,
            "4 spaces with tab_size=2 produces 2 indent guides"
        );
    });

    // Install a custom Sub Theme overriding `--po-md-syntax-keyword` and verify runtime update!
    let mut custom_doc = crate::platform::themes::document::Document::default();
    custom_doc.markdown[1].push(("--po-md-syntax-keyword".into(), "#ff2288".into()));
    crate::editor::tokens::set_installed(vec![("test.pink".into(), custom_doc)]);
    crate::theme::set_pack("test.pink");
    draw(cx);
    let overridden_kw = SyntaxColors::resolve(true, Scale::Medium).keyword;
    ts_view.read_with(cx, |v, cx| {
        let decos = v.editor.read(cx).decorations();
        assert!(
            decos
                .marks
                .iter()
                .any(|m| m.style.color == Some(packed(overridden_kw))),
            "Sub Theme override on --po-md-syntax-keyword must recolour keywords"
        );
    });
    crate::theme::set_pack(crate::theme::DEFAULT_PACK);
    crate::editor::tokens::set_installed(Vec::new());
}

/// CE-20 & CE-21: standalone file-window `40px` chrome inset keeps line 1 below
/// the floating titlebar, and `ConflictMarkerBanner` works across Code, Markdown
/// Source, and CSV Source surfaces.
#[gpui::test]
fn chrome_inset_avoids_titlebar_and_conflict_banner_is_shared_across_surfaces(
    cx: &mut TestAppContext,
) {
    let (view, _, cx) = setup(
        cx,
        "app.ts",
        "const firstLine = 1;\nconst secondLine = 2;\n",
    );
    let baseline_top = view.read_with(cx, |v, cx| {
        f32::from(
            v.editor
                .read(cx)
                .layout()
                .unwrap()
                .first_row_rect(0..5)
                .origin
                .y,
        )
    });
    let surface = CodeSurface {
        view: view.clone(),
        editor: view.read_with(cx, |v, _| v.editor.clone()),
    };
    cx.update(|_, cx| surface.set_chrome_inset(40., cx));
    draw(cx);
    let inset_top = view.read_with(cx, |v, cx| {
        f32::from(
            v.editor
                .read(cx)
                .layout()
                .unwrap()
                .first_row_rect(0..5)
                .origin
                .y,
        )
    });
    assert!(
        (inset_top - baseline_top - 40.).abs() < 1.5,
        "expected +40px top inset (baseline={baseline_top}, inset={inset_top})"
    );
    cx.update(|_, cx| assert_eq!(surface.scroll_state(cx), (0., false)));

    // Verify ConflictBannerPlugin detects conflict markers on Markdown Source and CSV Source too!
    let conflict_doc = "head\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\ntail\n";
    let md_format = registry::resolve(&EditorDocument::local("conflict.md")).format;
    let (md_host, cx) = cx.add_window_view(|w, cx| {
        let surf = open_markdown(
            &SurfaceRequest {
                id: "md-conflict",
                name: "conflict.md",
                input: SurfaceInput::Text(conflict_doc),
                format: md_format,
                resolved_extension: None,
                dark: true,
                scale: Scale::Medium,
                workspace: None,
                file_mode: false,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: SourceKind::Local,
            },
            w,
            cx,
        );
        surf.pane_segment(PaneSegmentId::Source, w, cx);
        SurfaceHost(surf)
    });
    draw(cx);
    md_host.read_with(cx, |host, cx| {
        let ed_entity = host.0.as_test_probe().unwrap().editor_view().unwrap();
        let ed = ed_entity.read(cx);
        let blocks = ed
            .plugin::<ConflictBannerPlugin>()
            .unwrap()
            .blocks_for(ed.committed_doc(), ed.committed_revision());
        assert_eq!(blocks.len(), 1, "Markdown source detects conflict block");
    });

    let (csv_view, cx) = cx.add_window_view(|w, cx| {
        let mut csv = CsvEditor::new(
            "csv-conflict",
            "conflict.csv",
            conflict_doc,
            true,
            Scale::Medium,
            cx,
        );
        csv.source_view = true;
        csv.set_live(false, w, cx);
        csv
    });
    draw(cx);
    csv_view.read_with(cx, |csv, cx| {
        let src = csv.source_editor_entity().unwrap();
        let ed = src.read(cx);
        let blocks = ed
            .plugin::<ConflictBannerPlugin>()
            .unwrap()
            .blocks_for(ed.committed_doc(), ed.committed_revision());
        assert_eq!(blocks.len(), 1, "CSV source detects conflict block");
    });
}
