//! `@anthropic-ai/claude-agent-sdk@0.3.159`: the part of the official SDK
//! the product's Claude runtime uses. `query()` drives the native Claude
//! Code CLI over its stream-json control protocol (`process_transport`,
//! `query`); `listSessions`, `getSessionInfo`, `getSessionMessages` and
//! `forkSession` read the CLI's own transcript store (`sessions`).
pub mod process_transport;
pub mod query;
pub mod sessions;
#[cfg(test)]
mod tests;

use crate::agent::agent_error::AgentResult;
use crate::agent::event_loop::{AbortController, AbortSignal};
use crate::agent::transports::jsonl_rpc_connection::ProcessIo;
use crate::platform::common::command_environment::EnvMap;
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::rc::Rc;

/// The SDK's own version (`CLAUDE_AGENT_SDK_VERSION`).
pub const CLAUDE_AGENT_SDK_VERSION: &str = "0.3.159";

/// `options.stderr(data)` / a spawn hook's stderr sink.
pub type StderrSink = Rc<dyn Fn(&str)>;

/// `canUseTool(toolName, input, options)`: resolves with a
/// `PermissionResult` (`{ behavior: "allow", updatedInput, … }` or
/// `{ behavior: "deny", message, interrupt }`).
pub type CanUseTool =
    Rc<dyn Fn(String, Value, PermissionOptions) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// `canUseTool`'s options, from a `can_use_tool` control request.
#[derive(Clone, Default)]
pub struct PermissionOptions {
    pub signal: Option<AbortSignal>,
    pub suggestions: Option<Value>,
    pub blocked_path: Option<Value>,
    pub decision_reason: Option<Value>,
    pub title: Option<Value>,
    pub display_name: Option<Value>,
    pub description: Option<Value>,
    pub tool_use_id: Option<Value>,
    pub agent_id: Option<Value>,
}

impl PermissionOptions {
    /// The options object as JavaScript callers pass it
    /// (`{ toolUseID, title, suggestions, … }`).
    pub fn from_json(value: &Value, signal: Option<AbortSignal>) -> Self {
        let field = |key: &str| value.get(key).filter(|v| !v.is_null()).cloned();
        Self {
            signal,
            suggestions: field("suggestions"),
            blocked_path: field("blockedPath"),
            decision_reason: field("decisionReason"),
            title: field("title"),
            display_name: field("displayName"),
            description: field("description"),
            tool_use_id: field("toolUseID"),
            agent_id: field("agentID"),
        }
    }
}

/// `options.systemPrompt`.
#[derive(Clone, Debug, PartialEq)]
pub enum SystemPrompt {
    Text(String),
    /// `{ type: "preset", preset, append }`.
    Preset {
        preset: String,
        append: Option<String>,
    },
}

/// `spawnClaudeCodeProcess(options)`'s options.
pub struct SpawnOptions {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: EnvMap,
    pub signal: AbortSignal,
}

/// `options.spawnClaudeCodeProcess`: launches the native CLI.
pub trait SpawnClaudeCodeProcess {
    fn launch(&self, options: SpawnOptions) -> AgentResult<ProcessIo>;
    /// `spawnClaudeCodeProcess.waitForExit?.({ signal })`.
    fn wait_for_exit(
        &self,
        _signal: Option<AbortSignal>,
    ) -> LocalBoxFuture<'static, AgentResult<()>> {
        Box::pin(async { Ok(()) })
    }
}

/// `query({ prompt, options })`'s `options`.
#[derive(Clone, Default)]
pub struct QueryOptions {
    pub abort_controller: Option<AbortController>,
    pub cwd: Option<String>,
    /// `None` inherits the host environment.
    pub env: Option<EnvMap>,
    pub path_to_claude_code_executable: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub resume: Option<String>,
    pub session_id: Option<String>,
    /// `permissionMode` (default `"default"`).
    pub permission_mode: Option<String>,
    pub can_use_tool: Option<CanUseTool>,
    pub spawn_claude_code_process: Option<Rc<dyn SpawnClaudeCodeProcess>>,
    pub stderr: Option<StderrSink>,
    pub include_partial_messages: bool,
    pub setting_sources: Option<Vec<String>>,
    pub system_prompt: Option<SystemPrompt>,
}

/// An `AsyncIterable<SDKUserMessage>` prompt.
pub trait PromptSource {
    /// The iterator's `next()`: `None` once it is done.
    fn next(&self) -> LocalBoxFuture<'static, Option<Value>>;
}

/// The `Query` `query()` returns: an async iterator of SDK messages with
/// its control methods.
pub trait ClaudeQuery {
    /// `for await (const message of query)`: `None` once the stream ends.
    fn next(&self) -> LocalBoxFuture<'static, Option<AgentResult<Value>>>;
    /// `query.initializationResult()`.
    fn initialization_result(&self) -> LocalBoxFuture<'static, AgentResult<Value>>;
    /// `query.setModel(model)`.
    fn set_model(&self, model: Option<String>) -> LocalBoxFuture<'static, AgentResult<()>>;
    /// `query.setPermissionMode(mode)`.
    fn set_permission_mode(&self, mode: String) -> LocalBoxFuture<'static, AgentResult<()>>;
    /// `query.interrupt()`.
    fn interrupt(&self) -> LocalBoxFuture<'static, AgentResult<()>>;
    /// `query.close()`.
    fn close(&self);
}

/// `listSessions({ dir, limit, offset, includeWorktrees })`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ListSessionsOptions {
    pub dir: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub include_worktrees: Option<bool>,
}

/// `getSessionMessages(sessionId, { dir, limit, offset, includeSystemMessages })`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SessionMessagesOptions {
    pub dir: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub include_system_messages: bool,
}

/// `forkSession(sessionId, { dir, upToMessageId, title })`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ForkSessionOptions {
    pub dir: Option<String>,
    pub up_to_message_id: Option<String>,
    pub title: Option<String>,
}

/// The loaded SDK module (`await import("@anthropic-ai/claude-agent-sdk")`).
pub trait ClaudeSdk {
    /// `query({ prompt, options })`.
    fn query(
        &self,
        prompt: Rc<dyn PromptSource>,
        options: QueryOptions,
    ) -> AgentResult<Rc<dyn ClaudeQuery>>;
    /// Whether the export `name` is a function (`typeof sdk.listSessions`).
    fn implements(&self, _name: &str) -> bool {
        true
    }
    /// `listSessions(options)`: `SDKSessionInfo[]`.
    fn list_sessions(
        &self,
        options: ListSessionsOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>>;
    /// `getSessionInfo(sessionId, { dir })`.
    fn get_session_info(
        &self,
        session_id: &str,
        dir: Option<&str>,
    ) -> LocalBoxFuture<'static, AgentResult<Option<Value>>>;
    /// `getSessionMessages(sessionId, options)`.
    fn get_session_messages(
        &self,
        session_id: &str,
        options: SessionMessagesOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>>;
    /// `forkSession(sessionId, options)`: `{ sessionId }`.
    fn fork_session(
        &self,
        session_id: &str,
        options: ForkSessionOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>>;
}

/// The SDK backed by the native CLI and its transcript store.
#[derive(Clone, Default)]
pub struct NativeClaudeSdk {
    /// The transcript store's profile; `None` reads `CLAUDE_CONFIG_DIR` (or
    /// `~/.claude`) at each call, as the SDK does.
    pub config_dir: Option<std::path::PathBuf>,
}

impl NativeClaudeSdk {
    fn root(&self) -> std::path::PathBuf {
        self.config_dir
            .clone()
            .unwrap_or_else(sessions::claude_config_dir)
    }
}

fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> AgentResult<T> + Send + 'static,
) -> LocalBoxFuture<'static, AgentResult<T>> {
    Box::pin(async move {
        tokio::task::spawn_blocking(work)
            .await
            .map_err(|error| crate::agent::agent_error::AgentError::new(error.to_string()))?
    })
}

impl ClaudeSdk for NativeClaudeSdk {
    fn query(
        &self,
        prompt: Rc<dyn PromptSource>,
        options: QueryOptions,
    ) -> AgentResult<Rc<dyn ClaudeQuery>> {
        Ok(Rc::new(query::query(prompt, options)?))
    }
    fn list_sessions(
        &self,
        options: ListSessionsOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>> {
        let root = self.root();
        blocking(move || Ok(sessions::list_sessions(&root, &options)))
    }
    fn get_session_info(
        &self,
        session_id: &str,
        dir: Option<&str>,
    ) -> LocalBoxFuture<'static, AgentResult<Option<Value>>> {
        let (root, session_id, dir) =
            (self.root(), session_id.to_string(), dir.map(str::to_string));
        blocking(move || {
            Ok(sessions::get_session_info(
                &root,
                &session_id,
                dir.as_deref(),
            ))
        })
    }
    fn get_session_messages(
        &self,
        session_id: &str,
        options: SessionMessagesOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<Value>>> {
        let (root, session_id) = (self.root(), session_id.to_string());
        blocking(move || Ok(sessions::get_session_messages(&root, &session_id, &options)))
    }
    fn fork_session(
        &self,
        session_id: &str,
        options: ForkSessionOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let (root, session_id) = (self.root(), session_id.to_string());
        blocking(move || sessions::fork_session(&root, &session_id, &options))
    }
}
