use super::*;
use crate::editor::{
    markdown::core::{plans, state::PreviewState, syntax::Syntax},
    text::state::EditorState,
    view::extension::EditIntent,
};

fn run_with(text: &str, f: impl FnOnce(&Cx) -> Option<Transaction>) -> String {
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
    let plans = plans::compile(
        &state.doc,
        &syntax,
        &Default::default(),
        crate::editor::markdown::composition::FEATURES,
    );
    let preview = PreviewState::default();
    let Some(tr) = f(&Cx {
        state: &state,
        syntax: &syntax,
        plans: &plans,
        preview: &preview,
        read_only: false,
    }) else {
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

fn run(text: &str, intent: EditIntent) -> String {
    run_with(text, |cx| intercept(intent, cx))
}

fn run_fmt(text: &str, cmd: FormatCommand) -> String {
    run_with(text, |cx| run_format(cmd, cx))
}

#[test]
fn enter_continues_and_ends_lists() {
    assert_eq!(run("- one|", EditIntent::Enter), "- one\n- |");
    assert_eq!(run("- [x] done|", EditIntent::Enter), "- [x] done\n- [ ] |");
    assert_eq!(
        run("1. a|\n2. b\n3. c", EditIntent::Enter),
        "1. a\n2. |\n3. b\n4. c"
    );
    assert_eq!(run("- one\n- |", EditIntent::Enter), "- one\n|");
    assert_eq!(
        run("- a\n  - b\n  - |", EditIntent::Enter),
        "- a\n  - b\n- |"
    );
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
    assert_eq!(run_fmt("## Title|", FormatCommand::Heading(1)), "# Title|");
    assert_eq!(run_fmt("Title|", FormatCommand::Heading(3)), "### Title|");
    assert_eq!(run_fmt("# Title|", FormatCommand::Heading(0)), "Title|");
    assert_eq!(
        run_fmt("|a\nb|", FormatCommand::OrderedList),
        "|1. a\n2. b|"
    );
    assert_eq!(run_fmt("- a|", FormatCommand::BulletList), "a|");
    assert_eq!(run_fmt("a|", FormatCommand::TaskList), "- [ ] a|");
    assert_eq!(run_fmt("a|", FormatCommand::Quote), "> a|");
    assert_eq!(run_fmt("> a|", FormatCommand::Quote), "a|");
}

#[test]
fn inline_formats_wrap_and_unwrap() {
    assert_eq!(
        run_fmt("say he|llo now", FormatCommand::Bold),
        "say **|hello|** now"
    );
    assert_eq!(
        run_fmt("say **he|llo** now", FormatCommand::Bold),
        "say he|llo now"
    );
    assert_eq!(run_fmt("|a b|", FormatCommand::Italic), "*|a b|*");
    assert_eq!(run_fmt("x |", FormatCommand::Code), "x `|`");
    assert_eq!(
        run_fmt("go |here| x", FormatCommand::Link),
        "go [here](|) x"
    );
    assert_eq!(run_fmt("|", FormatCommand::Underline), "<u>|</u>");
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
