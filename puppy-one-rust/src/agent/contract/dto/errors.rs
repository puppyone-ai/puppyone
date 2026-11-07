//! `operation-error.mjs`: a failed operation as plain data
//! (`agentOperationFailure`), and the parameters a known failure carries.
use serde::{Deserialize, Serialize};

/// `{ agentFailure }`: what an operation's failure says.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OperationFailure {
    #[serde(deserialize_with = "super::lenient::count")]
    pub schema_version: u32,
    #[serde(deserialize_with = "super::lenient::text")]
    pub code: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub message: String,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub retryable: bool,
    #[serde(deserialize_with = "super::lenient::list")]
    pub actions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub operation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub status: Option<String>,
}

/// One parameter of a known failure's message (`params.runtime`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErrorParam {
    Text(String),
    Number(i64),
}

/// A known failure's message parameters, in order.
pub type ErrorParams = Vec<(String, ErrorParam)>;
