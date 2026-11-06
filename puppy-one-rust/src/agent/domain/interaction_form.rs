//! An MCP form field as the hosted Agent's chat view renders it.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Field {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub required: bool,
    pub options: Vec<String>,
}
