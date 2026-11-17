//! Code editing behaviours (`CE-01`):
//! - Auto-closing brackets and quotes (`{}` `[]` `()` `""` `''` `` `` ``),
//!   closing-delimiter skip-over, and empty-pair `Backspace` deletion.
//! - Smart `Enter` auto-indentation (including `{|}` -> `{\n  |\n}` block
//!   expansion) and `Tab` / `Shift+Tab` space indentation using `Language::tab_size`.
use super::language::Language;
use crate::editor::{
    text::{
        change::{Change, ChangeSet},
        selection::Selection,
        state::{Annotation, EditorState, Transaction, UserEvent},
    },
    view::{editor::SYNC_COMPANION_ANNOTATION, extension::EditIntent},
};

fn matching_close(open: char) -> Option<char> {
    match open {
        '{' => Some('}'),
        '[' => Some(']'),
        '(' => Some(')'),
        '"' => Some('"'),
        '\'' => Some('\''),
        '`' => Some('`'),
        _ => None,
    }
}

fn is_closing_delim(ch: char) -> bool {
    matches!(ch, '}' | ']' | ')' | '"' | '\'' | '`')
}

fn is_pair(before: Option<char>, after: Option<char>) -> bool {
    matches!(
        (before, after),
        (Some('{'), Some('}'))
            | (Some('['), Some(']'))
            | (Some('('), Some(')'))
            | (Some('"'), Some('"'))
            | (Some('\''), Some('\''))
            | (Some('`'), Some('`'))
    )
}

fn is_open_block_pair(before: Option<char>, after: Option<char>) -> bool {
    matches!(
        (before, after),
        (Some('{'), Some('}')) | (Some('['), Some(']')) | (Some('('), Some(')'))
    )
}

fn char_before(state: &EditorState, offset: usize) -> Option<char> {
    if offset == 0 {
        return None;
    }
    let from = state.doc.clamp(offset.saturating_sub(4));
    state.doc.slice_cow(from..offset).chars().next_back()
}

fn char_after(state: &EditorState, offset: usize) -> Option<char> {
    if offset >= state.doc.len() {
        return None;
    }
    let to = state.doc.clamp((offset + 4).min(state.doc.len()));
    state.doc.slice_cow(offset..to).chars().next()
}

/// Filter user typing transactions for auto-close and skip-over (`CE-01`).
pub fn filter_typing_transaction(
    language: Language,
    tr: &mut Transaction,
    state: &EditorState,
    read_only: bool,
) {
    if read_only
        || language.0 == "plaintext"
        || !tr.is_annotation(Annotation::INPUT_TYPE)
        || tr.is_annotation(Annotation::INPUT_COMPOSE)
        || tr.is_annotation(Annotation::INPUT_PASTE)
        || tr.is_annotation(SYNC_COMPANION_ANNOTATION)
    {
        return;
    }
    let [single] = tr.changes.changes() else {
        return;
    };
    if !single.range.is_empty() || single.insert.chars().count() != 1 {
        return;
    }
    let typed = single.insert.chars().next().unwrap();
    let pos = single.range.start;
    let next = char_after(state, pos);

    // Skip over an existing closing delimiter when typed directly before it.
    if is_closing_delim(typed) && next == Some(typed) {
        tr.changes = ChangeSet::default();
        tr.selection = Some(Selection::cursor(pos + typed.len_utf8()));
        return;
    }

    let Some(close) = matching_close(typed) else {
        return;
    };
    // Quotes do not auto-close immediately after an alphanumeric/quote character.
    if matches!(typed, '"' | '\'' | '`') {
        let prev = char_before(state, pos);
        if prev.is_some_and(|c| c.is_alphanumeric() || c == typed || c == '\\') {
            return;
        }
    }
    let allow_after = next.is_none_or(|c| {
        c.is_whitespace() || matches!(c, ')' | ']' | '}' | ',' | ';' | ':' | '"' | '\'' | '`')
    });
    if !allow_after {
        return;
    }
    let mut pair = String::with_capacity(typed.len_utf8() + close.len_utf8());
    pair.push(typed);
    pair.push(close);
    tr.changes = ChangeSet::replace(pos..pos, pair);
    tr.selection = Some(Selection::cursor(pos + typed.len_utf8()));
}

/// Intercept `Enter`, `Backspace`, `Tab`, and `BackTab` for code surfaces (`CE-01`).
pub fn intercept_intent(
    language: Language,
    intent: EditIntent,
    state: &EditorState,
    read_only: bool,
) -> Option<Transaction> {
    if read_only {
        return None;
    }
    let tab_size = language.tab_size();
    let sel = state.selection;
    match intent {
        EditIntent::Backspace if sel.is_empty() && language.0 != "plaintext" => {
            let pos = sel.head;
            let prev = char_before(state, pos);
            let next = char_after(state, pos);
            if is_pair(prev, next) {
                let p = prev.unwrap();
                let n = next.unwrap();
                let from = pos - p.len_utf8();
                let to = pos + n.len_utf8();
                return Some(
                    Transaction::edit(
                        ChangeSet::replace(from..to, ""),
                        Some(Selection::cursor(from)),
                        UserEvent::Delete,
                    )
                    .with_annotation(Annotation::DELETE_BACKWARD),
                );
            }
            None
        }
        EditIntent::Enter => {
            let range = sel.as_range();
            let line_idx = state.doc.line_index(range.start);
            let line_range = state.doc.line_range(line_idx);
            let before_cursor = state.doc.slice_cow(line_range.start..range.start);
            let indent_len = before_cursor
                .bytes()
                .take_while(|b| matches!(b, b' ' | b'\t'))
                .count();
            let indent = &before_cursor[..indent_len];

            if language.0 == "plaintext" {
                if indent.is_empty() {
                    return None;
                }
                let insert = format!("\n{indent}");
                let caret = range.start + insert.len();
                return Some(Transaction::edit(
                    ChangeSet::replace(range, insert),
                    Some(Selection::cursor(caret)),
                    UserEvent::Input,
                ));
            }

            let step = " ".repeat(tab_size);
            let prev_non_ws = before_cursor.trim_end().chars().next_back();
            let next_char = char_after(state, range.end);

            if sel.is_empty() && is_open_block_pair(prev_non_ws, next_char) {
                let insert = format!("\n{indent}{step}\n{indent}");
                let caret = range.start + 1 + indent.len() + step.len();
                return Some(Transaction::edit(
                    ChangeSet::replace(range, insert),
                    Some(Selection::cursor(caret)),
                    UserEvent::Input,
                ));
            }

            let opens_indent = matches!(prev_non_ws, Some('{' | '[' | '('))
                || (matches!(language.0, "python" | "yaml") && prev_non_ws == Some(':'));
            let insert = if opens_indent {
                format!("\n{indent}{step}")
            } else {
                format!("\n{indent}")
            };
            let caret = range.start + insert.len();
            Some(Transaction::edit(
                ChangeSet::replace(range, insert),
                Some(Selection::cursor(caret)),
                UserEvent::Input,
            ))
        }
        EditIntent::Tab => {
            let step = " ".repeat(tab_size);
            if sel.is_empty() || state.doc.line_index(sel.from()) == state.doc.line_index(sel.to())
            {
                let range = sel.as_range();
                let caret = range.start + step.len();
                return Some(Transaction::edit(
                    ChangeSet::replace(range, step),
                    Some(Selection::cursor(caret)),
                    UserEvent::Input,
                ));
            }
            let first = state.doc.line_index(sel.from());
            let mut last = state.doc.line_index(sel.to());
            if sel.to() == state.doc.line_range(last).start && last > first {
                last -= 1;
            }
            let mut changes = Vec::new();
            for l in first..=last {
                let lr = state.doc.line_range(l);
                if !lr.is_empty() {
                    changes.push(Change {
                        range: lr.start..lr.start,
                        insert: step.clone(),
                    });
                }
            }
            (!changes.is_empty())
                .then(|| Transaction::edit(ChangeSet::new(changes), None, UserEvent::Command))
        }
        EditIntent::BackTab => {
            let first = state.doc.line_index(sel.from());
            let mut last = state.doc.line_index(sel.to());
            if !sel.is_empty() && sel.to() == state.doc.line_range(last).start && last > first {
                last -= 1;
            }
            let mut changes = Vec::new();
            for l in first..=last {
                let lr = state.doc.line_range(l);
                let line = state.doc.line_cow(l);
                let mut remove = 0usize;
                for b in line.bytes().take(tab_size) {
                    if b == b' ' {
                        remove += 1;
                    } else if b == b'\t' && remove == 0 {
                        remove = 1;
                        break;
                    } else {
                        break;
                    }
                }
                if remove > 0 {
                    changes.push(Change {
                        range: lr.start..lr.start + remove,
                        insert: String::new(),
                    });
                }
            }
            (!changes.is_empty())
                .then(|| Transaction::edit(ChangeSet::new(changes), None, UserEvent::Command))
        }
        _ => None,
    }
}
