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

/// `markdownListEditing.test.ts`: `indents below a two-digit parent using
/// its content column and restores with Shift-Tab`.
#[test]
fn tab_indents_under_a_two_digit_parent_and_back_tab_restores() {
    let flat = "9. nine\n10. ten\n- child\n  co|ntinued\n  - grandchild";
    let nested = run(flat, EditIntent::Tab);
    assert_eq!(
        nested,
        "9. nine\n10. ten\n    - child\n      co|ntinued\n      - grandchild"
    );
    assert_eq!(run(&nested, EditIntent::BackTab), flat);
}

/// `does not turn a first nested child into a continuation on Tab`.
#[test]
fn tab_keeps_a_first_nested_child_in_place() {
    let doc = "- parent\n    - [ ] child|";
    assert_eq!(run(doc, EditIntent::Tab), doc);
}

/// `moves a selected sibling group and its children once`.
#[test]
fn tab_moves_a_selected_sibling_group_with_its_children_once() {
    assert_eq!(
        run("- parent\n|- one\n  - nested\n- two|", EditIntent::Tab).replace('|', ""),
        "- parent\n  - one\n    - nested\n  - two"
    );
}

/// `continues ordered tasks locally in one undo transaction`;
/// `continues a source continuation without inventing another list item`.
#[test]
fn enter_continues_ordered_tasks_and_source_continuations_locally() {
    assert_eq!(
        run(
            "9. [x] first|\n10. [ ] second\n\n100. unrelated",
            EditIntent::Enter
        ),
        "9. [x] first\n10. [ ] |\n11. [ ] second\n\n100. unrelated"
    );
    assert_eq!(
        run("- item\n  continued|", EditIntent::Enter),
        "- item\n  continued\n  |"
    );
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
