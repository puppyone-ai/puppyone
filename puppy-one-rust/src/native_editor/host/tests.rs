use super::{protocol, session::Session};
use crate::{
    documents::ClientMessage,
    native_editor::core::{
        projection::Projection,
        selection::Selection,
        text::Text,
        transaction::{Command, InputEdit, InsertKind, TableCommand},
    },
};
fn session(source: &str) -> Session {
    Session::open("doc".into(), "note.md", source, source.into(), 0)
}
fn caret(offset: usize) -> Selection {
    Selection {
        anchor: offset,
        cursor: offset,
    }
}
#[test]
fn table_commands_and_paste_share_atomic_document_history() {
    let mut s = session("# Before\n\nTail\n");
    let original = s.state.clone();
    s.execute(Command::Insert(InsertKind::Table));
    let inserted = s.state.clone();
    s.execute(Command::Table(TableCommand::AddColumn));
    let expanded = s.state.clone();
    assert!(s.paste_table("中\t🐶\nC\tD"));
    let pasted = s.state.clone();
    assert_eq!(s.revision, 3);
    s.execute(Command::Undo);
    assert_eq!(s.state, expanded);
    s.execute(Command::Undo);
    assert_eq!(s.state, inserted);
    s.execute(Command::Undo);
    assert_eq!(s.state, original);
    for _ in 0..3 {
        s.execute(Command::Redo);
    }
    assert_eq!(s.state, pasted);
}
#[test]
fn table_navigation_and_rejected_edits_do_not_create_history() {
    let mut s = session("| A | B |\n| --- | --- |\n| x | y |\n");
    s.execute(Command::Table(TableCommand::DeleteRow)); // Header cannot be removed.
    assert_eq!(s.revision, 0);
    s.navigate_table(false, false);
    assert_eq!(s.state.selection.cursor, 2);
    assert!(!s.can_undo());
    let before = s.state.clone();
    assert!(!s.paste_table(&"x\t".repeat(25)));
    assert_eq!(s.state, before);
    assert_eq!(s.revision, 0);
    s.state.selection = caret(Projection::new(&s.state.document).text.text.len());
    let before = s.state.clone();
    s.navigate_table(false, false); // Last-cell Tab adds a row as one edit.
    assert_eq!(s.revision, 1);
    s.execute(Command::Undo);
    assert_eq!(s.state, before);
}
#[test]
fn ime_preedit_blocks_features_and_commits_once_even_when_host_frozen() {
    let mut current = Some(session(""));
    current.as_mut().unwrap().edit(InputEdit {
        selection: caret(3),
        replacement: Some((0..0, Text::plain("中"))),
        soft: false,
        composing: true,
    });
    let before = current.as_ref().unwrap().state.clone();
    for command in [
        Command::Insert(InsertKind::Table),
        Command::Source,
        Command::Undo,
    ] {
        current.as_mut().unwrap().execute(command);
    }
    assert_eq!(current.as_ref().unwrap().state, before);
    let reply = protocol::receive(
        &mut current,
        &serde_json::json!({"kind":"snapshot","request":1}),
    );
    assert!(matches!(&reply.messages[0], ClientMessage::Deferred { .. }));
    let s = current.as_mut().unwrap();
    assert_eq!(s.revision, 0);
    s.frozen = true;
    s.edit(InputEdit {
        selection: caret(6),
        replacement: Some((0..3, Text::plain("中文"))),
        soft: false,
        composing: false,
    });
    assert_eq!(s.revision, 1);
    assert!(s.pending_ime.is_none());
    s.frozen = false;
    s.execute(Command::Undo);
    assert_eq!(s.text(), "");
}
#[test]
fn source_and_typing_style_are_not_document_transactions() {
    let mut s = session("Hello\n");
    assert_eq!(
        s.execute(Command::ToggleMark { bold: true }).typing_mark,
        Some(true)
    );
    assert_eq!(s.revision, 0);
    s.execute(Command::Source);
    s.execute(Command::Source);
    assert_eq!(s.text(), "Hello\n");
    assert!(!s.can_undo());
    s.frozen = true;
    s.execute(Command::Insert(InsertKind::Table));
    assert_eq!(s.text(), "Hello\n");
}
#[test]
fn identical_host_open_retains_history_and_saved_receipt_checks_revision() {
    let mut current = Some(session("Hello\n"));
    current.as_mut().unwrap().execute(Command::SetStyle(
        crate::native_editor::core::document::Style::Heading(1),
    ));
    let s = current.as_ref().unwrap();
    let text = s.text();
    let revision = s.revision;
    let reply = protocol::receive(
        &mut current,
        &serde_json::json!({
            "kind":"open","id":"doc","name":"note.md","text":text,"baseline":"Hello\n","revision":revision
        }),
    );
    assert!(!reply.reset_input);
    assert!(matches!(
        &reply.messages[0],
        ClientMessage::Loaded { .. }
    ));
    assert!(current.as_ref().unwrap().can_undo());
    protocol::receive(
        &mut current,
        &serde_json::json!({"kind":"saved","id":"doc","revision":revision+1}),
    );
    assert!(current.as_ref().unwrap().dirty());
    protocol::receive(
        &mut current,
        &serde_json::json!({"kind":"saved","id":"doc","revision":revision}),
    );
    assert!(!current.as_ref().unwrap().dirty());
    current.as_mut().unwrap().execute(Command::Undo);
    assert_eq!(current.as_ref().unwrap().text(), "Hello\n");
}
