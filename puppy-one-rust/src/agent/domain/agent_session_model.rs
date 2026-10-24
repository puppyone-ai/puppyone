//! Provider-independent values exposed to the native application and presentation.
//! This is the implemented contract subset, not full shared/agent-contract parity.
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum State {
    Starting,
    History,
    Idle,
    Running,
    Stopping,
    Failed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    /// Content; for a tool call, its result.
    pub text: String,
    pub status: String,
    /// The tool request (arguments JSON or command line), kept beside the
    /// result so evidence shows both (`detail.input` in the product contract).
    #[serde(default)]
    pub input: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Decision {
    Accept,
    Decline,
    Cancel,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub text: String,
    pub options: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum InteractionKind {
    Form {
        prompt: String,
        fields: Vec<super::interaction_form::Field>,
        url: Option<String>,
    },
    Permission {
        prompt: String,
        options: Vec<(String, String)>,
    },
    Approval {
        command: bool,
        prompt: String,
        decisions: Vec<Decision>,
    },
    Questions(Vec<Question>),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Interaction {
    pub id: Value,
    pub thread: String,
    pub turn: String,
    pub kind: InteractionKind,
}
pub enum Resolution {
    Form {
        decision: Decision,
        values: std::collections::BTreeMap<String, String>,
    },
    Choice(String),
    Approval(Decision),
    Answers(std::collections::BTreeMap<String, Vec<String>>),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub runtime: String,
    pub capabilities: Capabilities,
    pub modes: Vec<(String, String)>,
    pub mode: Option<String>,
    pub efforts: Vec<String>,
    pub effort: Option<String>,
    pub account: String,
    pub commands: Vec<(String, String)>,
    pub notice: Option<String>,
    pub thread: Option<String>,
    pub turn: Option<String>,
    pub state: State,
    pub messages: Vec<Message>,
    pub interactions: Vec<Interaction>,
    pub error: Option<String>,
    pub models: Vec<(String, String)>,
    pub model: Option<String>,
    pub history: Vec<HistoryEntry>,
    pub cursor: Option<String>,
    pub history_mode: bool,
    pub usage: String,
    pub title: String,
    pub revision: u64,
}
impl SessionSnapshot {
    pub fn busy(&self) -> bool {
        matches!(
            self.state,
            State::Starting | State::Running | State::Stopping
        ) || (self.state == State::Failed && self.turn.is_some())
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Capabilities {
    pub history: bool,
    pub models: bool,
    pub modes: bool,
    pub fork: bool,
    pub steer: bool,
    pub compact: bool,
    pub archive: bool,
    pub rename: bool,
    pub images: bool,
    pub text_references: bool,
}
impl SessionSnapshot {
    pub fn new(runtime: &str, history: bool) -> Self {
        Self {
            runtime: runtime.into(),
            capabilities: Capabilities::default(),
            modes: vec![],
            mode: None,
            efforts: vec![],
            effort: None,
            account: String::new(),
            commands: vec![],
            notice: None,
            thread: None,
            turn: None,
            state: State::Starting,
            messages: vec![],
            interactions: vec![],
            error: None,
            models: vec![],
            model: None,
            history: vec![],
            cursor: None,
            history_mode: history,
            usage: String::new(),
            title: runtime.into(),
            revision: 0,
        }
    }
    pub fn fail(&mut self, error: impl Into<String>) {
        self.error = Some(error.into());
        self.state = State::Failed;
        self.revision += 1;
    }
    pub fn upsert(
        &mut self,
        id: impl Into<String>,
        role: impl Into<String>,
        text: impl Into<String>,
        status: impl Into<String>,
    ) {
        let id = id.into();
        let text = bounded_text(text.into(), 2 * 1024 * 1024);
        let status = status.into();
        if let Some(m) = self.messages.iter_mut().find(|m| m.id == id) {
            m.text = text;
            m.status = status;
        } else {
            self.messages.push(Message {
                id,
                role: role.into(),
                text,
                status,
                input: None,
            });
        }
        self.bound();
        self.revision += 1;
    }
    pub fn delta(&mut self, id: &str, role: &str, delta: &str) {
        if let Some(m) = self.messages.iter_mut().find(|m| m.id == id) {
            let remaining = (2 * 1024 * 1024usize).saturating_sub(m.text.len());
            m.text.push_str(&bounded_text(delta.into(), remaining));
        } else {
            self.messages.push(Message {
                id: id.into(),
                role: role.into(),
                text: bounded_text(delta.into(), 2 * 1024 * 1024),
                status: "running".into(),
                input: None,
            });
        }
        self.bound();
        self.revision += 1;
    }
    /// A tool call starts (or its request is revised). Later results keep it.
    pub fn tool_call(
        &mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        input: impl Into<String>,
        status: impl Into<String>,
    ) {
        let id = id.into();
        let input = bounded_text(input.into(), 256 * 1024);
        let status = status.into();
        if let Some(m) = self.messages.iter_mut().find(|m| m.id == id) {
            m.input = Some(input);
            m.status = status;
        } else {
            self.messages.push(Message {
                id,
                role: name.into(),
                text: String::new(),
                status,
                input: Some(input),
            });
        }
        self.bound();
        self.revision += 1;
    }
    /// Streamed tool arguments (Claude `input_json_delta`).
    pub fn tool_input_delta(&mut self, id: &str, name: &str, delta: &str) {
        if let Some(m) = self.messages.iter_mut().find(|m| m.id == id) {
            let input = m.input.get_or_insert_with(String::new);
            let remaining = (256 * 1024usize).saturating_sub(input.len());
            input.push_str(&bounded_text(delta.into(), remaining));
            self.revision += 1;
        } else {
            self.tool_call(id, name, delta, "running");
        }
    }
    /// A tool result; the request recorded by `tool_call` is preserved.
    pub fn tool_result(
        &mut self,
        id: impl Into<String>,
        name: impl Into<String>,
        output: impl Into<String>,
        status: impl Into<String>,
    ) {
        let id = id.into();
        let output = bounded_text(output.into(), 2 * 1024 * 1024);
        let status = status.into();
        if let Some(m) = self.messages.iter_mut().find(|m| m.id == id) {
            m.text = output;
            m.status = status;
        } else {
            self.messages.push(Message {
                id,
                role: name.into(),
                text: output,
                status,
                input: None,
            });
        }
        self.bound();
        self.revision += 1;
    }
    pub fn bound(&mut self) {
        let mut bytes: usize = self.messages.iter().map(|m| m.text.len()).sum();
        let mut remove = 0;
        while self.messages.len() - remove > 2000 || bytes > 16 * 1024 * 1024 {
            bytes -= self.messages[remove].text.len();
            remove += 1;
        }
        if remove > 0 {
            self.messages.drain(..remove);
            self.notice=Some("Older output is outside the live display limit. Reopen native history to inspect the conversation.".into());
        }
    }
    pub fn finish(&mut self, status: &str) {
        self.turn = None;
        self.interactions.clear();
        self.state = State::Idle;
        self.usage = status.into();
        for m in &mut self.messages {
            if m.status == "running" {
                m.status = status.into();
            }
        }
        self.revision += 1;
    }
}
pub fn bounded_text(mut text: String, limit: usize) -> String {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}
