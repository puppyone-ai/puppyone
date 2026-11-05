//! The product's Agent failures are `Error` objects carrying optional
//! properties (`code`, `retryable`, `actions`, `runtimeId`, `operation`,
//! `stage`, `status`, `deliveryOutcome`, …) that callers read and IPC
//! serializes (`agentOperationFailure`). [`AgentError`] is that object.
use crate::agent::contract::ContractError;
use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AgentError {
    /// `error.message`.
    pub message: String,
    /// Every other property, read through `Deref` (`error.code`).
    pub props: Box<ErrorProps>,
}

/// The optional properties of an [`AgentError`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ErrorProps {
    /// `error.name`.
    pub name: Option<String>,
    pub code: Option<String>,
    pub retryable: Option<bool>,
    pub actions: Vec<String>,
    pub runtime_id: Option<String>,
    pub operation: Option<String>,
    pub stage: Option<String>,
    pub status: Option<String>,
    /// `error.deliveryOutcome` (`"unknown"` when a native request may have run).
    pub delivery_outcome: Option<String>,
    /// `error.clientUserMessageId`.
    pub client_user_message_id: Option<String>,
    /// Any other property an adapter attached.
    pub extra: Option<Value>,
}

impl std::ops::Deref for AgentError {
    type Target = ErrorProps;
    fn deref(&self) -> &ErrorProps {
        &self.props
    }
}

impl std::ops::DerefMut for AgentError {
    fn deref_mut(&mut self) -> &mut ErrorProps {
        &mut self.props
    }
}

pub type AgentResult<T> = Result<T, AgentError>;

impl AgentError {
    /// `new Error(message)`.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            props: Box::default(),
        }
    }

    /// `Object.assign(new Error(message), { code })`.
    pub fn coded(code: &str, message: impl Into<String>) -> Self {
        Self::new(message).with_code(code)
    }

    pub fn with_code(mut self, code: &str) -> Self {
        self.code = Some(code.into());
        self
    }

    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = Some(retryable);
        self
    }

    pub fn with_name(mut self, name: &str) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_stage(mut self, stage: &str) -> Self {
        self.stage = Some(stage.into());
        self
    }

    /// `error.code === code`.
    pub fn is(&self, code: &str) -> bool {
        self.code.as_deref() == Some(code)
    }
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AgentError {}

impl From<ContractError> for AgentError {
    fn from(error: ContractError) -> Self {
        Self::new(error.0).with_name("TypeError")
    }
}

impl From<crate::agent::domain::agent_session_actor::ActorError> for AgentError {
    fn from(error: crate::agent::domain::agent_session_actor::ActorError) -> Self {
        Self::new(error.0)
    }
}

impl From<std::io::Error> for AgentError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => Some("ENOENT"),
            std::io::ErrorKind::PermissionDenied => Some("EACCES"),
            std::io::ErrorKind::AlreadyExists => Some("EEXIST"),
            _ => None,
        };
        let message = error.to_string();
        let error = Self::new(message);
        match code {
            Some(code) => error.with_code(code),
            None => error,
        }
    }
}
