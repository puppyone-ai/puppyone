//! `shared/agent-contract/native-session-id.mjs`.
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

static NATIVE_SESSION_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._/-]{1,512}$").expect("native session id pattern"));

/// Native conversation identity shared by discovery, restore and live envelopes.
pub fn native_session_id(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| NATIVE_SESSION_ID.is_match(id))
        .map(str::to_string)
}
