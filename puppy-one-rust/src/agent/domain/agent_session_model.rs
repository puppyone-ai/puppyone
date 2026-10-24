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
    /// Allow this request and the same kind for the rest of the session.
    AcceptForSession,
    Decline,
    Cancel,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub text: String,
    pub options: Vec<String>,
    /// `AgentQuestionPrompt.header` (the fieldset legend).
    #[serde(default)]
    pub header: String,
    /// Option descriptions, parallel to `options`.
    #[serde(default)]
    pub descriptions: Vec<String>,
    #[serde(default)]
    pub multiple: bool,
    /// Free-text answers are allowed beside the options ("Other…").
    #[serde(default)]
    pub custom: bool,
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
        /// `AgentApproval.title`, `command`, `cwd` and `reason`.
        #[serde(default)]
        title: String,
        #[serde(default)]
        command_line: Option<String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        reason: Option<String>,
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
/// `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)` to Unix milliseconds (ACP
/// `SessionInfo.updatedAt`); anything else is an unknown time.
pub fn parse_rfc3339_ms(value: &str) -> Option<i64> {
    let b = value.trim().as_bytes();
    let num = |range: std::ops::Range<usize>| -> Option<i64> {
        std::str::from_utf8(b.get(range)?).ok()?.parse().ok()
    };
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't' | b' ') {
        return None;
    }
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let mut i = 19;
    let mut millis = 0;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        let digits = std::str::from_utf8(&b[start..i]).ok()?;
        let padded = format!("{:0<3}", &digits[..digits.len().min(3)]);
        millis = padded.parse::<i64>().ok()?;
    }
    let offset = match b.get(i)? {
        b'Z' | b'z' if i + 1 == b.len() => 0,
        sign @ (b'+' | b'-') if i + 6 == b.len() && b[i + 3] == b':' => {
            let minutes = num(i + 1..i + 3)? * 60 + num(i + 4..i + 6)?;
            if *sign == b'+' { minutes } else { -minutes }
        }
        _ => return None,
    };
    // Howard Hinnant's days-from-civil.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + hour) * 60 + minute - offset) * 60_000 + second * 1000 + millis)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub title: String,
    /// Last update in Unix milliseconds when the provider reports it
    /// (`AgentSessionListItem.updatedAt`, `updatedAtKnown`).
    #[serde(default)]
    pub updated_at: Option<i64>,
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
    /// Bumped whenever a history page (or its failure) has been applied, so
    /// locator-only listings can tell a pending scan from an empty one.
    #[serde(default)]
    pub history_listed: u64,
    /// The thread whose oldest output fell outside the live display window
    /// (`displayWindow.truncated`); its transcript says it shows recent messages.
    #[serde(default)]
    pub truncated_thread: Option<Option<String>>,
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
            history_listed: 0,
            truncated_thread: None,
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
            self.truncated_thread = Some(self.thread.clone());
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

#[cfg(test)]
mod tests {
    use super::parse_rfc3339_ms;
    use core::prelude::v1::test;

    #[test]
    fn rfc3339_timestamps_become_unix_milliseconds() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            parse_rfc3339_ms("2027-01-15T08:00:00.000Z"),
            Some(1_800_000_000_000)
        );
        assert_eq!(
            parse_rfc3339_ms("2027-01-15T16:00:00.5+08:00"),
            Some(1_800_000_000_500)
        );
        assert_eq!(
            parse_rfc3339_ms("2000-02-29T12:30:00-01:30"),
            Some(951_832_800_000)
        );
        assert_eq!(parse_rfc3339_ms("yesterday"), None);
        assert_eq!(parse_rfc3339_ms("2027-13-15T08:00:00Z"), None);
    }
}
