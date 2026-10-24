//! Native implementation of the existing document host protocol; never writes files.
use super::session::Session;
use crate::{documents::ClientMessage, native_editor::core::transaction::Command};
#[derive(Default)]
pub struct Reply {
    pub messages: Vec<ClientMessage>,
    pub reset_input: bool,
    pub command: Option<Command>,
}
pub fn receive(current: &mut Option<Session>, message: &serde_json::Value) -> Reply {
    let mut reply = Reply::default();
    match message["kind"].as_str().unwrap_or("") {
        "open" => {
            let id = message["id"].as_str().unwrap_or_default().to_owned();
            let text = message["text"].as_str().unwrap_or_default();
            if let Some(session) = current
                && session.id == id
                && session.text() == text
                && message["external"] != true
            {
                session.baseline = message["baseline"].as_str().unwrap_or(text).into();
                session.revision = message["revision"].as_u64().unwrap_or(0);
                session.frozen = false;
            } else {
                *current = Some(Session::open(
                    id.clone(),
                    message["name"].as_str().unwrap_or_default(),
                    text,
                    message["baseline"].as_str().unwrap_or(text).into(),
                    message["revision"].as_u64().unwrap_or(0),
                ));
                reply.reset_input = true;
            }
            reply.messages.push(ClientMessage::Loaded { id });
        }
        "clear" => {
            *current = None;
            reply.reset_input = true;
        }
        "snapshot" => {
            if let Some(session) = current {
                if session.pending_ime.is_some() {
                    reply.messages.push(ClientMessage::Deferred {
                        request: message["request"].as_u64().unwrap_or(0),
                        id: session.id.clone(),
                    });
                } else {
                    session.frozen = message["freeze"].as_bool().unwrap_or(true);
                    reply.messages.push(ClientMessage::Snapshot {
                        request: message["request"].as_u64().unwrap_or(0),
                        id: session.id.clone(),
                        revision: session.revision,
                        text: session.text(),
                    });
                }
            }
        }
        "thaw" => {
            if let Some(session) = current {
                session.frozen = false;
            }
        }
        "saved" => {
            if let Some(session) = current
                && message["id"] == session.id
            {
                if let Some(text) = message["text"].as_str()
                    && message["revision"]
                        .as_u64()
                        .is_some_and(|r| r <= session.revision)
                {
                    session.baseline = text.into();
                } else if message["revision"].as_u64() == Some(session.revision) {
                    session.baseline = session.text();
                }
            }
        }
        "history" => {
            reply.command = Command::from_name(message["direction"].as_str().unwrap_or_default())
        }
        _ => {}
    }
    reply
}
