//! `shared/agent-contract/validation.mjs`: the primitive checks every
//! contract schema is built from. A failure is the product's `TypeError`
//! (`Invalid Agent contract: <path> <reason>.`).
use super::js::{self, Obj};
use crate::text;
use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

static RUNTIME_ID_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]{1,39}$").expect("runtime id pattern"));
static OPAQUE_ID_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9:._-]{1,256}$").expect("opaque id pattern"));

/// A contract violation (`TypeError`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContractError(pub String);

impl std::fmt::Display for ContractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ContractError {}

pub type Contract<T> = Result<T, ContractError>;

/// `new TypeError(message)`.
pub fn type_error(message: impl Into<String>) -> ContractError {
    ContractError(message.into())
}

/// `contractError(path, reason)`.
pub fn contract_error(path: &str, reason: &str) -> ContractError {
    ContractError(format!("Invalid Agent contract: {path} {reason}."))
}

/// `optionalRecord(value, label)`: absent or `null` reads as `{}`.
pub fn optional_record(value: Option<&Value>, label: &str) -> Contract<Map<String, Value>> {
    match value {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(value) => assert_record(Some(value), &format!("{label} request")).cloned(),
    }
}

/// `assertRecord(value, label)`.
pub fn assert_record<'a>(
    value: Option<&'a Value>,
    label: &str,
) -> Contract<&'a Map<String, Value>> {
    value
        .and_then(Value::as_object)
        .ok_or_else(|| contract_error(label, "must be an object"))
}

/// `assertArray(value, label)`.
pub fn assert_array<'a>(value: Option<&'a Value>, label: &str) -> Contract<&'a Vec<Value>> {
    value
        .and_then(Value::as_array)
        .ok_or_else(|| contract_error(label, "must be an array"))
}

/// `requiredString` options.
#[derive(Clone, Copy, Default)]
pub struct StringRule {
    pub allow_empty: bool,
    pub preserve_whitespace: bool,
}

impl StringRule {
    /// `{ allowEmpty: true, preserveWhitespace: true }`.
    pub const VERBATIM: Self = Self {
        allow_empty: true,
        preserve_whitespace: true,
    };
}

/// `requiredString(value, label, limit)`.
pub fn required_string(value: Option<&Value>, label: &str, limit: usize) -> Contract<String> {
    required_string_with(value, label, limit, StringRule::default())
}

/// `requiredString(value, label, limit, options)`.
pub fn required_string_with(
    value: Option<&Value>,
    label: &str,
    limit: usize,
    rule: StringRule,
) -> Contract<String> {
    let Some(text) = value.and_then(Value::as_str) else {
        return Err(contract_error(label, "must be text"));
    };
    let normalized = if rule.preserve_whitespace {
        text
    } else {
        text::trim(text)
    };
    if !rule.allow_empty && text::trim(normalized).is_empty() {
        return Err(contract_error(label, "must not be empty"));
    }
    if text::len16(normalized) > limit {
        return Err(contract_error(
            label,
            &format!("exceeds {limit} characters"),
        ));
    }
    Ok(normalized.to_string())
}

/// `optionalString(value, label, limit)`: absent, `null` and `""` read as
/// `undefined`.
pub fn optional_string(
    value: Option<&Value>,
    label: &str,
    limit: usize,
) -> Contract<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(_) => required_string(value, label, limit).map(Some),
    }
}

/// `isRuntimeId(value)`.
pub fn is_runtime_id(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|s| RUNTIME_ID_PATTERN.is_match(s))
}

/// `assertRuntimeId(value, label)`.
pub fn assert_runtime_id(value: Option<&Value>, label: &str) -> Contract<String> {
    if !is_runtime_id(value) {
        return Err(contract_error(label, "is invalid"));
    }
    Ok(value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string())
}

/// `optionalRuntimeId(value)`.
pub fn optional_runtime_id(value: Option<&Value>) -> Contract<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(_) => assert_runtime_id(value, "runtimeId").map(Some),
    }
}

/// `requiredOpaqueId(value, label)`.
pub fn required_opaque_id(value: Option<&Value>, label: &str) -> Contract<String> {
    if !is_opaque_id(value) {
        return Err(contract_error(label, "is invalid"));
    }
    Ok(value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string())
}

/// `optionalOpaqueId(value, label)`: an absent value or `""` passes
/// through unchanged (`Some("")` for `""`).
pub fn optional_opaque_id(value: Option<&Value>, label: &str) -> Contract<Option<String>> {
    match value {
        None => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(Some(String::new())),
        Some(_) => required_opaque_id(value, label).map(Some),
    }
}

/// `optionalOpaqueId(value, label, { nullable: true })`: `null` also
/// passes through (as `Value::Null`).
pub fn optional_nullable_opaque_id(value: Option<&Value>, label: &str) -> Contract<Option<Value>> {
    match value {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(Value::Null)),
        Some(Value::String(s)) if s.is_empty() => Ok(Some(Value::String(String::new()))),
        Some(_) => required_opaque_id(value, label).map(|id| Some(Value::String(id))),
    }
}

/// `optionalOpaqueId(...)` as the request bodies use it: `""` is dropped
/// with `undefined` by `compact`.
pub fn compact_opaque_id(value: Option<&Value>, label: &str) -> Contract<Option<String>> {
    Ok(optional_opaque_id(value, label)?.filter(|id| !id.is_empty()))
}

/// `isOpaqueId(value)`.
pub fn is_opaque_id(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|s| OPAQUE_ID_PATTERN.is_match(s))
}

/// `optionalBoolean(value, label)`.
pub fn optional_boolean(value: Option<&Value>, label: &str) -> Contract<Option<bool>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(contract_error(label, "must be a boolean")),
    }
}

/// `nonNegativeInteger(value, label)`.
pub fn non_negative_integer(value: Option<&Value>, label: &str) -> Contract<i64> {
    match value.and_then(js::safe_integer) {
        Some(n) if n >= 0 => Ok(n),
        _ => Err(contract_error(label, "must be a non-negative integer")),
    }
}

/// `positiveInteger(value, label)`.
pub fn positive_integer(value: Option<&Value>, label: &str) -> Contract<i64> {
    match value.and_then(js::safe_integer) {
        Some(n) if n > 0 => Ok(n),
        _ => Err(contract_error(label, "must be a positive integer")),
    }
}

/// `enumValue(value, label, allowed)`.
pub fn enum_value<'a>(
    value: Option<&Value>,
    label: &str,
    allowed: &[&'a str],
) -> Contract<&'a str> {
    let text = value.and_then(Value::as_str);
    allowed
        .iter()
        .find(|entry| Some(**entry) == text)
        .copied()
        .ok_or_else(|| contract_error(label, &format!("must be one of {}", allowed.join(", "))))
}

/// `compact(value)`: drop `undefined` entries. Builders here never hold
/// `undefined`, so this is [`Obj::build`].
pub fn compact(value: Obj) -> Value {
    value.build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn primitive_checks_match_the_product_messages() {
        assert_eq!(
            required_string(Some(&json!("  ")), "prompt", 10)
                .unwrap_err()
                .0,
            "Invalid Agent contract: prompt must not be empty."
        );
        assert_eq!(required_string(Some(&json!(" a ")), "x", 10).unwrap(), "a");
        assert_eq!(
            required_string_with(Some(&json!(" a ")), "x", 10, StringRule::VERBATIM).unwrap(),
            " a "
        );
        assert!(required_string(Some(&json!("😀😀")), "x", 3).is_err());
        assert!(assert_runtime_id(Some(&json!("codex")), "r").is_ok());
        assert!(assert_runtime_id(Some(&json!("C")), "r").is_err());
        assert_eq!(optional_opaque_id(None, "x").unwrap(), None);
        assert!(optional_opaque_id(Some(&Value::Null), "x").is_err());
        assert_eq!(
            optional_nullable_opaque_id(Some(&Value::Null), "x").unwrap(),
            Some(Value::Null)
        );
        assert!(non_negative_integer(Some(&json!(-1)), "n").is_err());
        assert!(positive_integer(Some(&json!(0)), "n").is_err());
        assert_eq!(
            enum_value(Some(&json!("b")), "e", &["a", "c"])
                .unwrap_err()
                .0,
            "Invalid Agent contract: e must be one of a, c."
        );
    }
}
