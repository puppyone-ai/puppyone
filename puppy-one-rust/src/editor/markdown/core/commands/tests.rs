use super::*;
use crate::editor::{
    markdown::core::{plans, state::PreviewState, syntax::Syntax},
    text::state::EditorState,
    view::extension::EditIntent,
};

/// Run `intent` on `text` with the caret / selection marked by `|` (and an
/// optional second `|`); returns the text with the resulting selection.
fn run(text: &str, intent: EditIntent) -> String {
    let marks: Vec<usize> = text.match_indices('|').map(|(i, _)| i).collect();
    let clean = text.replace('|', "");
    let (anchor, head) = match marks.as_slice() {
        [a] => (*a, *a),
        [a, b] => (*a, *b - 1),
        _ => panic!("mark the caret with |"),
    };
    let mut state = EditorState::new(&clean);
    state.selection = Selection::range(anchor, head);
    let syntax = Syntax::parse(&state.doc);
    let plans = plans::compile(&state.doc, &syntax, crate::editor::markdown::composition::FEATURES);
    let preview = PreviewState::default();
    let Some(tr) = intercept(intent, &Cx { state: &state, syntax: &syntax, plans: &plans, preview: &preview, read_only: false }) else {
        return "<default>".into();
    };
    state.apply(tr);
    let mut out = state.doc.as_str().to_owned();
    let s = state.selection;
    if s.is_empty() {
        out.insert(s.head, '|');
    } else {
        out.insert(s.to(), '|');
        out.insert(s.from(), '|');
    }
    out
}

#[test]
fn enter_continues_and_ends_lists() {
    assert_eq!(run("- one|", EditIntent::Enter), "- one\n- |");
    assert_eq!(run("- [x] done|", EditIntent::Enter), "- [x] done\n- [ ] |");
    assert_eq!(run("1. a|\n2. b\n3. c", EditIntent::Enter), "1. a\n2. |\n3. b\n4. c");
    assert_eq!(run("- one\n- |", EditIntent::Enter), "- one\n|");
    assert_eq!(run("- a\n  - b\n  - |", EditIntent::Enter), "- a\n  - b\n- |");
    assert_eq!(run("> quote|", EditIntent::Enter), "> quote\n> |");
    assert_eq!(run("> |", EditIntent::Enter), "|");
    assert_eq!(run("plain|", EditIntent::Enter), "<default>");
}

#[test]
fn tab_moves_whole_items() {
    assert_eq!(run("- a\n- b|", EditIntent::Tab), "- a\n  - b|");
    assert_eq!(run("- a\n  - b|", EditIntent::BackTab), "- a\n- b|");
    // A first item has no previous sibling: Tab is still owned.
    assert_eq!(run("- a|", EditIntent::Tab), "- a|");
    assert_eq!(run("text|", EditIntent::Tab), "<default>");
}

#[test]
fn block_toggles_follow_the_product() {
    assert_eq!(run("## Title|", EditIntent::Heading(1)), "# Title|");
    assert_eq!(run("Title|", EditIntent::Heading(3)), "### Title|");
    assert_eq!(run("# Title|", EditIntent::Heading(0)), "Title|");
    assert_eq!(run("|a\nb|", EditIntent::OrderedList), "|1. a\n2. b|");
    assert_eq!(run("- a|", EditIntent::BulletList), "a|");
    assert_eq!(run("a|", EditIntent::TaskList), "- [ ] a|");
    assert_eq!(run("a|", EditIntent::Quote), "> a|");
    assert_eq!(run("> a|", EditIntent::Quote), "a|");
}

#[test]
fn inline_formats_wrap_and_unwrap() {
    assert_eq!(run("say he|llo now", EditIntent::Bold), "say **|hello|** now");
    assert_eq!(run("say **he|llo** now", EditIntent::Bold), "say he|llo now");
    assert_eq!(run("|a b|", EditIntent::Italic), "*|a b|*");
    assert_eq!(run("x |", EditIntent::Code), "x `|`");
    assert_eq!(run("go |here| x", EditIntent::Link), "go [here](|) x");
    assert_eq!(run("|", EditIntent::Underline), "<u>|</u>");
}

#[test]
fn markers_delete_as_units() {
    // Backspace at a heading's visible start removes the whole marker.
    assert_eq!(run("## |Title", EditIntent::Backspace), "|Title");
    assert_eq!(run("- |item", EditIntent::Backspace), "|item");
    // A collapsed closing delimiter goes as one unit.
    assert_eq!(run("**bold**|", EditIntent::Backspace), "**bold|");
    assert_eq!(run("|**bold**", EditIntent::Delete), "|bold**");
}
