//! `runtimes/claude/claude-message-channel.mjs`: the Agent SDK's async
//! input channel that keeps one Claude Code query alive across turns.
use super::claude_agent_sdk::PromptSource;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::text;
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::LazyLock;
use tokio::sync::oneshot;

const MAX_QUEUED_MESSAGES: usize = 4;
const MAX_MESSAGE_CHARACTERS: usize = 128 * 1024;
/// `Math.ceil(5 MiB * 4 / 3) + 4`.
const MAX_IMAGE_BASE64_CHARACTERS: usize = (5usize * 1024 * 1024 * 4).div_ceil(3) + 4;
const IMAGE_MIME_TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];

static BASE64: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9+/]+={0,2}$").expect("pattern"));

/// `claudeMessageChannelPolicy`.
pub mod policy {
    pub const MAX_QUEUED_MESSAGES: usize = super::MAX_QUEUED_MESSAGES;
    pub const MAX_MESSAGE_CHARACTERS: usize = super::MAX_MESSAGE_CHARACTERS;
    pub const MAX_IMAGE_BASE64_CHARACTERS: usize = super::MAX_IMAGE_BASE64_CHARACTERS;
}

/// `new ClaudeMessageChannel({ onWarning })`.
#[derive(Clone)]
pub struct ClaudeMessageChannel(Rc<Inner>);

struct Inner {
    on_warning: Rc<dyn Fn(&str)>,
    queue: RefCell<VecDeque<Value>>,
    waiter: RefCell<Option<oneshot::Sender<Option<Value>>>>,
    turn_active: Cell<bool>,
    closed: Cell<bool>,
    session_id: RefCell<String>,
}

impl ClaudeMessageChannel {
    pub fn new(on_warning: Rc<dyn Fn(&str)>) -> Self {
        Self(Rc::new(Inner {
            on_warning,
            queue: RefCell::default(),
            waiter: RefCell::default(),
            turn_active: Cell::new(false),
            closed: Cell::new(false),
            session_id: RefCell::default(),
        }))
    }

    /// `channel.setSessionId(sessionId)`.
    pub fn set_session_id(&self, session_id: &str) {
        *self.0.session_id.borrow_mut() = session_id.to_string();
    }

    pub fn session_id(&self) -> String {
        self.0.session_id.borrow().clone()
    }

    /// `channel.enqueue(message)`.
    pub fn enqueue(&self, message: Value) -> AgentResult<()> {
        let inner = &self.0;
        if inner.closed.get() {
            return Err(AgentError::new("Claude message channel is closed."));
        }
        if inner.turn_active.get() {
            return Err(AgentError::new(
                "Claude message channel already has an active turn.",
            ));
        }
        if let Some(waiter) = inner.waiter.borrow_mut().take() {
            inner.turn_active.set(true);
            let _ = waiter.send(Some(message));
            return Ok(());
        }
        if inner.queue.borrow().len() >= MAX_QUEUED_MESSAGES {
            (inner.on_warning)("Claude message channel reached its bounded queue limit.");
            return Err(AgentError::new("Claude message queue is full."));
        }
        inner.queue.borrow_mut().push_back(message);
        Ok(())
    }

    /// `channel.onTurnComplete()`.
    pub fn on_turn_complete(&self) {
        self.0.turn_active.set(false);
    }

    /// `channel.close()`.
    pub fn close(&self) {
        let inner = &self.0;
        if inner.closed.replace(true) {
            return;
        }
        inner.queue.borrow_mut().clear();
        inner.turn_active.set(false);
        if let Some(waiter) = inner.waiter.borrow_mut().take() {
            let _ = waiter.send(None);
        }
    }
}

impl PromptSource for ClaudeMessageChannel {
    fn next(&self) -> LocalBoxFuture<'static, Option<Value>> {
        let inner = self.0.clone();
        Box::pin(async move {
            if inner.closed.get() {
                return None;
            }
            if !inner.turn_active.get() {
                let next = inner.queue.borrow_mut().pop_front();
                if let Some(message) = next {
                    inner.turn_active.set(true);
                    return Some(message);
                }
            }
            let (sender, receiver) = oneshot::channel();
            *inner.waiter.borrow_mut() = Some(sender);
            receiver.await.ok().flatten()
        })
    }
}

/// `createClaudeUserMessage(content, sessionId)`.
pub fn create_claude_user_message(content: &Value, session_id: &str) -> AgentResult<Value> {
    if !valid_claude_content(content) {
        return Err(AgentError::new(
            "Claude Code prompt is invalid or exceeds the safety limit.",
        ));
    }
    Ok(json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
        "session_id": session_id,
    }))
}

fn valid_claude_content(value: &Value) -> bool {
    if let Some(text) = value.as_str() {
        return !text::trim(text).is_empty() && text::len16(text) <= MAX_MESSAGE_CHARACTERS;
    }
    let Some(blocks) = value.as_array() else {
        return false;
    };
    if blocks.is_empty() || blocks.len() > 33 {
        return false;
    }
    let mut text_characters = 0;
    let mut has_text = false;
    for block in blocks {
        let kind = block.get("type").and_then(Value::as_str);
        if kind == Some("text")
            && let Some(text) = block.get("text").and_then(Value::as_str)
        {
            text_characters += text::len16(text);
            has_text |= !text::trim(text).is_empty();
            continue;
        }
        let source = block.get("source");
        let data = source
            .and_then(|s| s.get("data"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if kind == Some("image")
            && source.and_then(|s| s.get("type")).and_then(Value::as_str) == Some("base64")
            && source
                .and_then(|s| s.get("media_type"))
                .and_then(Value::as_str)
                .is_some_and(|mime| IMAGE_MIME_TYPES.contains(&mime))
            && !data.is_empty()
            && data.len() <= MAX_IMAGE_BASE64_CHARACTERS
            && BASE64.is_match(data)
        {
            continue;
        }
        return false;
    }
    has_text && text_characters <= MAX_MESSAGE_CHARACTERS
}
