//! Observable acceptance from the pinned TS markdownInlineSyntax suite.
//! Text and marks come from drawn native leaves; resource loading is local.
use super::setup_with_focus;
use crate::{
    editor::{
        markdown::{
            MarkdownExtension,
            core::syntax::Kind,
            features::{code_block::CodeBlock, math::MathBlock},
            style::MarkdownTheme,
        },
        text::{selection::Selection, state::EditorState},
        view::{
            EditorView,
            decoration::{Block, MarkStyle, packed},
            extension::{DecorateInput, EditorExtension},
        },
    },
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn lines(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<String> {
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

fn marks(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<(String, MarkStyle)> {
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

fn unchanged(view: &Entity<EditorView>, cx: &mut VisualTestContext, source: &str) {
    view.read_with(cx, |v, _| {
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn bare_links_preserve_text_and_never_double_link_or_activate_inside_code(cx: &mut TestAppContext) {
    for (source, expected, href) in [
        (
            "see https://example.com/a now",
            "see https://example.com/a now",
            Some("https://example.com/a"),
        ),
        (
            "see www.example.com now",
            "see www.example.com now",
            Some("https://www.example.com"),
        ),
        (
            "ask a@example.com now",
            "ask a@example.com now",
            Some("mailto:a@example.com"),
        ),
        ("`https://example.com`", "https://example.com", None),
        ("[x](https://example.com)", "x", Some("https://example.com")),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        assert_eq!(lines(&view, visual), [expected]);
        let links: Vec<_> = marks(&view, visual)
            .into_iter()
            .filter_map(|(_, s)| s.link.map(|h| h.to_string()))
            .collect();
        assert_eq!(links, href.into_iter().collect::<Vec<_>>(), "{source}");
        unchanged(&view, visual, source);
    }
}

#[gpui::test]
fn reference_links_resolve_all_forms_keep_definitions_visible_and_leave_missing_labels_literal(
    cx: &mut TestAppContext,
) {
    for (form, label) in [
        ("[text][ref]", "text"),
        ("[ref][]", "ref"),
        ("[ref]", "ref"),
    ] {
        let source = format!("{form}\n\n[Ref]: https://example.com/r \"T\"");
        let (view, visual) = setup_with_focus(cx, &source, false);
        assert_eq!(lines(&view, visual)[0], label);
        assert!(
            marks(&view, visual).iter().any(
                |(text, s)| text == label && s.link.as_deref() == Some("https://example.com/r")
            )
        );
        unchanged(&view, visual, &source);
    }
    let source = "[x][r]\n\n[r]: https://example.com/r";
    let (view, visual) = setup_with_focus(cx, source, false);
    assert_eq!(lines(&view, visual), ["x", "", "r https://example.com/r"]);
    assert!(
        marks(&view, visual)
            .iter()
            .any(|(text, s)| text == "https://example.com/r"
                && s.link.as_deref() == Some("https://example.com/r"))
    );
    unchanged(&view, visual, source);
    let source = "[x][missing]";
    let (view, visual) = setup_with_focus(cx, source, false);
    assert_eq!(lines(&view, visual), [source]);
    assert!(marks(&view, visual).iter().all(|(_, s)| s.link.is_none()));
    unchanged(&view, visual, source);
}

#[test]
fn reference_images_generate_one_native_embed_for_full_collapsed_and_shortcut_forms() {
    for (form, alt) in [("![alt][r]", "alt"), ("![r][]", "r"), ("![r]", "r")] {
        let source = format!("{form}\n\n[r]: https://example.com/a.png");
        let state = EditorState::new(&source);
        let mut markdown = MarkdownExtension::new(true, Scale::Medium);
        let (syntax, _) = markdown.parse(&state);
        let images: Vec<_> = syntax
            .elements
            .iter()
            .filter(|e| e.kind == Kind::Image)
            .collect();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].href.as_deref(), Some("https://example.com/a.png"));
        assert_eq!(state.doc.slice(images[0].content.clone().unwrap()), alt);
        // Build the actual production embed without executing its remote loader.
        let decorations = markdown.decorate(&DecorateInput {
            state: &state,
            focused: false,
            pointer_selecting: false,
            dark: true,
        });
        assert_eq!(
            decorations
                .blocks
                .iter()
                .filter(|b| matches!(b, Block::Line { style, .. } if style.embed.is_some()))
                .count(),
            1
        );
        assert!(
            decorations
                .hidden
                .iter()
                .any(|r| r.start == 0 && r.end == form.len())
        );
        assert_eq!(state.doc.as_str(), source);
        assert_eq!(state.revision, 0);
    }
}

#[gpui::test]
fn reference_image_forms_render_through_the_document_resource_reader(cx: &mut TestAppContext) {
    use crate::editor::{
        markdown::SetAssets, registry::DocumentAssets, view::extension::config_transaction,
    };
    use std::{
        io::Cursor,
        sync::{Arc, Mutex},
    };
    for (index, form) in ["![alt][r]", "![r][]", "![r]"].iter().enumerate() {
        let source = format!("{form}\n\n[r]: a.png");
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let png = png.into_inner();
        let reads = Arc::new(Mutex::new(Vec::new()));
        let observed = reads.clone();
        let (view, visual) = setup_with_focus(cx, &source, false);
        view.update(visual, |v, cx| {
            v.dispatch(
                config_transaction(SetAssets(Some(DocumentAssets {
                    workspace: format!("reference-inline-image-{index}"),
                    document: "notes/note.md".into(),
                    read: Arc::new(move |path| {
                        observed.lock().unwrap().push(path.to_path_buf());
                        Some(png.clone())
                    }),
                }))),
                cx,
            )
        });
        draw(visual);
        assert!(!lines(&view, visual).join("\n").contains("!["));
        assert_eq!(
            *reads.lock().unwrap(),
            [std::path::PathBuf::from("notes/a.png")]
        );
        view.read_with(visual, |v, _| {
            assert_eq!(
                v.decorations()
                    .blocks
                    .iter()
                    .filter(|b| matches!(b, Block::Line { style, .. } if style.embed.is_some()))
                    .count(),
                1
            )
        });
        unchanged(&view, visual, &source);
    }
}

#[gpui::test]
fn entity_and_emoji_atoms_preserve_authored_source_and_code_literals(cx: &mut TestAppContext) {
    for (source, expected) in [
        ("a &copy; b", "a © b"),
        ("a &#35; b", "a # b"),
        ("a &#x1F600; b", "a 😀 b"),
        ("a :smile: b", "a 😄 b"),
        ("a :+1: b", "a 👍 b"),
        ("12:30:45 :not_an_emoji:", "12:30:45 :not_an_emoji:"),
        ("`&copy;`", "&copy;"),
        ("`:smile:`", ":smile:"),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        assert_eq!(lines(&view, visual), [expected], "{source}");
        unchanged(&view, visual, source);
    }
}

#[gpui::test]
fn entity_source_reveals_on_caret_touch_and_restores_without_edits(cx: &mut TestAppContext) {
    let source = "a &copy; b";
    let (view, visual) = setup_with_focus(cx, source, false);
    assert_eq!(lines(&view, visual), ["a © b"]);
    for caret in [2, 3, 8] {
        view.update_in(visual, |v, w, cx| {
            v.focus(w, cx);
            v.set_selection(Selection::cursor(caret), cx);
        });
        assert_eq!(lines(&view, visual), [source], "caret {caret}");
        unchanged(&view, visual, source);
        view.update(visual, |v, cx| v.set_selection(Selection::cursor(0), cx));
        assert_eq!(lines(&view, visual), ["a © b"]);
    }
    view.update(visual, |v, cx| {
        v.set_read_only(true, cx);
        v.set_selection(Selection::cursor(3), cx);
    });
    assert_eq!(lines(&view, visual), ["a © b"]);
    unchanged(&view, visual, source);
}

#[gpui::test]
fn inline_marks_hide_only_valid_delimiters_and_preserve_hard_line_breaks(cx: &mut TestAppContext) {
    let source = "a\\\nb";
    let (view, visual) = setup_with_focus(cx, source, false);
    assert_eq!(lines(&view, visual), ["a", "b"]);
    unchanged(&view, visual, source);
    for (source, visible, strike, highlight) in [
        ("a ~b~ c", "a b c", true, false),
        ("a ==b== c\n\nTitle\n===", "a b c", false, true),
        ("a == b == c", "a == b == c", false, false),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        assert_eq!(lines(&view, visual)[0], visible);
        let marks = marks(&view, visual);
        assert_eq!(
            marks.iter().any(|(text, s)| text == "b" && s.strike),
            strike
        );
        let highlights: Vec<_> = marks
            .iter()
            .filter(|(_, s)| s.highlight.is_some())
            .map(|(text, _)| text.as_str())
            .collect();
        assert_eq!(highlights, if highlight { vec!["b"] } else { vec![] });
        unchanged(&view, visual, source);
    }
}

#[gpui::test]
fn html_and_percent_comments_stay_visible_and_dimmed_in_every_context(cx: &mut TestAppContext) {
    let dimmed = packed(
        MarkdownTheme::resolve(true, Scale::Medium)
            .inline
            .markup_color,
    );
    for (source, expected) in [
        ("<!-- hidden -->\n\nVisible", "<!-- hidden -->"),
        ("<!--\nhidden\n-->\n\nVisible", "hidden"),
        ("a <!-- hidden --> b", "<!-- hidden -->"),
        ("a %%hidden%% b", "%%hidden%%"),
    ] {
        let (view, visual) = setup_with_focus(cx, source, false);
        assert!(lines(&view, visual).join("\n").contains(expected));
        let text: String = marks(&view, visual)
            .into_iter()
            .filter(|(_, s)| s.color == Some(dimmed))
            .map(|(text, _)| text)
            .collect();
        assert!(
            text.contains(expected),
            "comment {source:?} missing dimmed text: {text:?}"
        );
        unchanged(&view, visual, source);
    }
}

#[test]
fn backtick_math_and_math_fences_have_math_plans_while_other_fences_remain_code() {
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    let state = EditorState::new("a $`x^2`$ b");
    let (syntax, plans) = markdown.parse(&state);
    let formulas: Vec<_> = plans
        .iter()
        .filter(|p| {
            p.element
                .is_some_and(|i| syntax.elements[i].kind == Kind::FeatureInline("math"))
        })
        .collect();
    assert_eq!(formulas.len(), 1, "backtick math must have a math plan");
    let element = &syntax.elements[formulas[0].element.unwrap()];
    assert_eq!(state.doc.slice(element.content.clone().unwrap()), "x^2");
    assert_eq!(element.text.as_deref(), Some("x²"));
    assert!(!syntax.elements.iter().any(|e| e.kind == Kind::InlineCode));
    for (language, math) in [("math", true), ("js", false)] {
        let state = EditorState::new(&format!("```{language}\nx^2\n```"));
        let mut markdown = MarkdownExtension::new(true, Scale::Medium);
        let (_, plans) = markdown.parse(&state);
        assert_eq!(
            plans
                .iter()
                .filter(|p| p.embed().is_some_and(|e| e.model::<MathBlock>().is_some()))
                .count(),
            usize::from(math)
        );
        assert_eq!(
            plans
                .iter()
                .filter(|p| p.embed().is_some_and(|e| e.model::<CodeBlock>().is_some()))
                .count(),
            usize::from(!math)
        );
    }
}

#[test]
fn math_code_ownership_is_exact_and_incremental_fence_plans_keep_one_owner() {
    use crate::editor::{
        markdown::{
            composition::FEATURES,
            core::{plans, state::FeatureStateStore, syntax::Syntax},
        },
        text::{
            buffer::Buffer,
            change::ChangeSet,
            state::{Transaction, UserEvent},
        },
    };
    for source in ["`$x$`", "`` $`x^2`$ ``", "$x `y`$", "$``x``$", r"\$`x`$"] {
        let doc = Buffer::new(source);
        let syntax = Syntax::parse_with(&doc, FEATURES);
        assert!(
            !syntax
                .elements
                .iter()
                .any(|e| e.kind == Kind::FeatureInline("math")),
            "code must remain literal: {source}"
        );
        assert!(syntax.elements.iter().any(|e| e.kind == Kind::InlineCode));
    }
    let mut state = EditorState::new(
        "before\n\n```math\nx^2\n```\n\nafter\n\nguard one\n\nguard two\n\nguard three\n\nguard four",
    );
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    for (needle, replacement, expected) in [
        ("math", "js", "code-block"),
        ("js", "math", "math"),
        ("x^2", "", "code-block"),
        ("```math\n\n", "```math\ny^2\n", "math"),
    ] {
        markdown.parse(&state);
        let at = state.doc.as_str().find(needle).unwrap();
        state
            .apply(Transaction::edit(
                ChangeSet::replace(at..at + needle.len(), replacement),
                None,
                UserEvent::Input,
            ))
            .unwrap();
        let (syntax, cached) = markdown.parse(&state);
        let full_syntax = Syntax::parse_with(&state.doc, FEATURES);
        assert_eq!(*syntax, full_syntax);
        let full = plans::compile(
            &state.doc,
            &full_syntax,
            &FeatureStateStore::default(),
            FEATURES,
        );
        assert_eq!(*cached, full, "fence edit {needle:?}");
        let owners: Vec<_> = cached
            .iter()
            .filter_map(|p| p.embed().map(|e| e.feature))
            .collect();
        assert_eq!(owners, [expected]);
        let window = plans::compile_blocks_in_window(
            &state.doc,
            &syntax,
            &FeatureStateStore::default(),
            FEATURES,
            0..state.doc.len(),
            0..state.doc.line_count(),
        );
        assert_eq!(
            window
                .iter()
                .filter_map(|p| p.embed().map(|e| e.feature))
                .collect::<Vec<_>>(),
            [expected]
        );
    }
}
