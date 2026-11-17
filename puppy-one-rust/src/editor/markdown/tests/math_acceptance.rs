//! Production plans, registered native widgets, and fallback acceptance from
//! the pinned TS markdownMath suite. TeX raster pixels belong to renderer gates.
use crate::{
    editor::{
        markdown::{
            MarkdownExtension,
            core::{plans::Presentation, syntax::Kind},
            features::math::MathBlock,
        },
        text::state::EditorState,
        view::{
            decoration::Block,
            extension::{DecorateInput, EditorExtension},
        },
    },
    typography::Scale,
};

fn formulas(source: &str) -> Vec<String> {
    let state = EditorState::new(source);
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    let (syntax, plans) = markdown.parse(&state);
    plans
        .iter()
        .filter_map(|p| {
            if let Some(block) = p.embed().and_then(|e| e.model::<MathBlock>()) {
                return Some(block.source.clone());
            }
            let e = syntax.elements.get(p.element?)?;
            (e.kind == Kind::FeatureInline("math"))
                .then(|| state.doc.slice(e.content.clone().unwrap()).to_owned())
        })
        .collect()
}

#[test]
fn display_and_inline_math_preserve_exact_source_ranges_and_register_native_widgets() {
    let formula = r"E = \sum_{i=1}^{n} \frac{1}{2} m_i v_i^2 + \frac{1}{2} k x^2";
    let source = format!("$$\n{formula}\n$$");
    let state = EditorState::new(&source);
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    let (_, plans) = markdown.parse(&state);
    let math: Vec<_> = plans
        .iter()
        .filter_map(|p| p.embed()?.model::<MathBlock>())
        .collect();
    assert_eq!(math.len(), 1);
    assert_eq!(math[0].range, 0..source.len());
    assert_eq!(math[0].content, 3..3 + formula.len());
    assert_eq!(math[0].source, formula);
    let decorated = markdown.decorate(&DecorateInput {
        state: &state,
        focused: false,
        pointer_selecting: false,
        dark: true,
    });
    assert_eq!(
        decorated
            .blocks
            .iter()
            .filter(|b| matches!(b, Block::Widget { .. }))
            .count(),
        1
    );
    assert_eq!(state.doc.as_str(), source);
    assert_eq!(state.revision, 0);

    let source = "Einstein wrote $E = mc^2$ in 1905.";
    let state = EditorState::new(source);
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    let (syntax, plans) = markdown.parse(&state);
    let math: Vec<_> = plans
        .iter()
        .filter(|p| {
            p.element
                .is_some_and(|i| syntax.elements[i].kind == Kind::FeatureInline("math"))
        })
        .collect();
    assert_eq!(math.len(), 1);
    assert_eq!(math[0].source, 15..25);
    assert!(matches!(&math[0].presentation, Presentation::InlineAtom(_)));
    let e = &syntax.elements[math[0].element.unwrap()];
    assert_eq!(e.content, Some(16..24));
    assert_eq!(state.doc.slice(e.content.clone().unwrap()), "E = mc^2");
    let decorated = markdown.decorate(&DecorateInput {
        state: &state,
        focused: false,
        pointer_selecting: false,
        dark: true,
    });
    assert_eq!(
        decorated
            .inline_widgets
            .iter()
            .filter(|w| w.as_image().is_some())
            .count(),
        1
    );
    assert_eq!(state.doc.as_str(), source);
    assert_eq!(state.revision, 0);
}

#[test]
fn code_escapes_currency_and_unclosed_display_delimiters_do_not_become_math() {
    for source in [
        r"`$code$` and \$escaped$ cost $5 and later $10",
        "Costs range from $5-$10.",
        "Outside $x `inside$` tail",
        "$$\nx\n```text\n$$\n```",
        "$$\nE = mc^2",
    ] {
        assert!(formulas(source).is_empty(), "{source:?}");
    }
}

#[test]
fn adjacent_code_html_and_digits_preserve_each_separate_formula() {
    for source in [
        "$x$`code`",
        "`code`$x$",
        "$x$<b>label</b>",
        "<b>label</b>$x$",
        "$x$5",
    ] {
        assert_eq!(formulas(source), ["x"], "{source:?}");
    }
    assert_eq!(formulas("$x$2 + $y$"), ["x", "y"]);
    assert_eq!(formulas("Costs $5-$10 and math $y$."), ["y"]);
}

#[test]
fn oversized_formulas_remain_source_with_utf16_limits_in_inline_display_and_fence_forms() {
    for (formula, rich) in [
        ("x".repeat(32 * 1024), true),
        ("x".repeat(32 * 1024 + 1), false),
        ("😀".repeat(16 * 1024), true),
        (format!("{}x", "😀".repeat(16 * 1024)), false),
        (format!("{}x", "x+".repeat(20_000)), false),
    ] {
        for (source, inline) in [
            (format!("${formula}$"), true),
            (format!("$$\n{formula}\n$$"), false),
            (format!("```math\n{formula}\n```"), false),
        ] {
            let state = EditorState::new(&source);
            let mut markdown = MarkdownExtension::new(true, Scale::Medium);
            let (_, plans) = markdown.parse(&state);
            let matches: Vec<_> = plans
                .iter()
                .filter(|p| p.source == (0..source.len()))
                .collect();
            assert_eq!(matches.len(), 1, "one owner; inline={inline}, rich={rich}");
            if rich {
                assert!(matches!(&matches[0].presentation, Presentation::InlineAtom(_)) == inline);
                assert_eq!(
                    matches[0]
                        .embed()
                        .is_some_and(|e| e.model::<MathBlock>().is_some()),
                    !inline
                );
            } else {
                assert!(
                    matches!(
                        matches[0].presentation,
                        Presentation::SourceFallback {
                            code: "math.source-too-large"
                        }
                    ),
                    "oversized formula must use source; inline={inline}, utf16={}",
                    formula.encode_utf16().count()
                );
                let decorated = markdown.decorate(&DecorateInput {
                    state: &state,
                    focused: false,
                    pointer_selecting: false,
                    dark: true,
                });
                assert!(
                    decorated
                        .blocks
                        .iter()
                        .all(|b| !matches!(b, Block::Widget { .. }))
                );
                assert!(decorated.inline_widgets.is_empty());
                assert!(
                    decorated.hidden.is_empty(),
                    "oversize fallback must keep all delimiters visible"
                );
            }
            assert_eq!(state.doc.as_str(), source);
            assert_eq!(state.revision, 0);
        }
    }
}

#[test]
fn source_fallback_keeps_internal_markers_and_media_literal_but_preserves_neighbor_marks() {
    let empty = EditorState::new("$` `$");
    let mut markdown = MarkdownExtension::new(true, Scale::Medium);
    let (_, plans) = markdown.parse(&empty);
    assert!(plans.iter().any(|p| matches!(
        p.presentation,
        Presentation::SourceFallback {
            code: "math.empty-source"
        }
    )));
    let decorated = markdown.decorate(&DecorateInput {
        state: &empty,
        focused: false,
        pointer_selecting: false,
        dark: true,
    });
    assert!(decorated.inline_widgets.is_empty() && decorated.hidden.is_empty());
    assert_eq!(empty.doc.as_str(), "$` `$");
    assert_eq!(empty.revision, 0);
    let body = format!(
        "{} **literal** ![literal](a.png) :smile: &copy;",
        "x".repeat(32 * 1024)
    );
    for (source, inline) in [
        (format!("**before** ${body}$ **after**"), true),
        (format!("**before**\n\n$$\n{body}\n$$\n\n**after**"), false),
        (
            format!("**before**\n\n```math\n{body}\n```\n\n**after**"),
            false,
        ),
    ] {
        let state = EditorState::new(&source);
        let mut markdown = MarkdownExtension::new(true, Scale::Medium);
        let (_, plans) = markdown.parse(&state);
        let fallback = plans
            .iter()
            .find(|p| matches!(p.presentation, Presentation::SourceFallback { .. }))
            .unwrap();
        let range = fallback.source.clone();
        let decorated = markdown.decorate(&DecorateInput {
            state: &state,
            focused: false,
            pointer_selecting: false,
            dark: true,
        });
        let overlaps = |r: &std::ops::Range<usize>| r.start < range.end && range.start < r.end;
        assert!(
            !decorated.hidden.iter().any(overlaps),
            "source fallback hides nested syntax; inline={inline}"
        );
        assert!(
            !decorated.inline_widgets.iter().any(|w| overlaps(&w.range)),
            "fallback must not load or replace nested media or text atoms"
        );
        assert!(
            decorated
                .blocks
                .iter()
                .all(|b| matches!(b, Block::Line { style, .. } if style.embed.is_none()))
        );
        for word in ["before", "after"] {
            let at = source.find(word).unwrap();
            assert!(
                decorated
                    .marks
                    .iter()
                    .any(|m| m.style.bold && m.range.start <= at && m.range.end >= at + word.len())
            );
        }
        assert_eq!(state.doc.as_str(), source);
        assert_eq!(state.revision, 0);
    }
}
