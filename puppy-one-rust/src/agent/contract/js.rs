//! The JavaScript value semantics of the Agent's wire JSON. Provider
//! protocols, the persisted session files the Electron product shares, and
//! the Agent host's Main-side reducers keep plain JSON objects as
//! [`serde_json::Value`]; this reproduces the language rules they depend on:
//! `Number.isSafeInteger`, truthiness, `String(value)`,
//! `encodeURIComponent` and `Uint8Array` payloads. Text measured in UTF-16
//! code units is [`crate::text`]; time is [`crate::clock`].
use crate::text::trim;
use base64::Engine as _;
use serde_json::{Map, Value};

/// `Number.MAX_SAFE_INTEGER`.
pub const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

/// `Number.isSafeInteger(value)`.
pub fn is_safe_integer(value: &Value) -> bool {
    safe_integer(value).is_some()
}

/// The integer of a `Number.isSafeInteger` value.
pub fn safe_integer(value: &Value) -> Option<i64> {
    let Value::Number(number) = value else {
        return None;
    };
    if let Some(n) = number.as_i64() {
        return (n.abs() <= MAX_SAFE_INTEGER).then_some(n);
    }
    if number.as_u64().is_some() {
        return None;
    }
    let n = number.as_f64()?;
    (n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER as f64).then_some(n as i64)
}

/// `typeof value === "number" && Number.isFinite(value)`.
pub fn finite_number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|n| n.is_finite())
}

/// A JS number as JSON: integral values are integers, so that
/// `JSON.stringify` and equality agree with the product (`1`, never `1.0`).
pub fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER as f64 {
        Value::from(value as i64)
    } else {
        serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
    }
}

/// `Boolean(value)`.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `Boolean(value)` of an optional property.
pub fn truthy_opt(value: Option<&Value>) -> bool {
    value.is_some_and(truthy)
}

/// `value?.[key]`, absent for anything but an object.
pub fn get<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object()?.get(key)
}

/// `value == null` of an optional property (absent or `null`).
pub fn nullish(value: Option<&Value>) -> bool {
    matches!(value, None | Some(Value::Null))
}

/// `typeof value === "string" ? value : ""`.
pub fn str_or_empty(value: Option<&Value>) -> &str {
    value.and_then(Value::as_str).unwrap_or("")
}

/// The string of an optional property.
pub fn opt_str(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str)
}

/// `Number(value)` (`NaN` for an absent value, an object or unparsable
/// text).
pub fn to_number(value: Option<&Value>) -> f64 {
    match value {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let text = trim(s);
            if text.is_empty() {
                0.0
            } else {
                text.parse::<f64>()
                    .ok()
                    .filter(|_| !text.contains(['n', 'N', 'i', 'I']) || text.contains("Infinity"))
                    .unwrap_or(f64::NAN)
            }
        }
        Some(Value::Array(_) | Value::Object(_)) => f64::NAN,
    }
}

/// `String(value)` (`"undefined"` for an absent value).
pub fn to_js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
            _ => n.to_string(),
        },
        Some(Value::Array(entries)) => entries
            .iter()
            .map(|entry| match entry {
                Value::Null => String::new(),
                entry => to_js_string(Some(entry)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// `String(value ?? "")`.
pub fn string_or_empty(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        value => to_js_string(value),
    }
}

/// `JSON.stringify(value)`.
pub fn stringify(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

/// `new TextEncoder().encode(JSON.stringify(value)).byteLength`.
pub fn json_byte_length(value: &Value) -> usize {
    struct Count(usize);
    impl std::io::Write for Count {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0 += buf.len();
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut count = Count(0);
    let _ = serde_json::to_writer(&mut count, value);
    count.0
}

/// An object literal built in key order; `None` values are left out, as
/// `undefined` properties are by `JSON.stringify` and `compact`.
#[derive(Default, Clone, Debug)]
pub struct Obj(Map<String, Value>);

impl Obj {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn from(value: &Value) -> Self {
        Self(value.as_object().cloned().unwrap_or_default())
    }
    pub fn set(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.0.insert(key.into(), value.into());
        self
    }
    pub fn opt<V: Into<Value>>(mut self, key: &str, value: Option<V>) -> Self {
        if let Some(value) = value {
            self.0.insert(key.into(), value.into());
        }
        self
    }
    /// `...value` of an object.
    pub fn spread(mut self, value: &Value) -> Self {
        if let Some(map) = value.as_object() {
            for (key, entry) in map {
                self.0.insert(key.clone(), entry.clone());
            }
        }
        self
    }
    pub fn insert(&mut self, key: &str, value: impl Into<Value>) {
        self.0.insert(key.into(), value.into());
    }
    pub fn build(self) -> Value {
        Value::Object(self.0)
    }
    pub fn map(self) -> Map<String, Value> {
        self.0
    }
}

/// `{ ...value, key: entry }` without disturbing key order.
pub fn with(value: &Value, key: &str, entry: impl Into<Value>) -> Value {
    let mut map = value.as_object().cloned().unwrap_or_default();
    map.insert(key.into(), entry.into());
    Value::Object(map)
}

/// `delete value[key]`, keeping the remaining keys in order.
pub fn delete(value: &mut Value, key: &str) {
    if let Some(map) = value.as_object_mut() {
        map.shift_remove(key);
    }
}

// ------------------------------------------------------------------ URIs

/// `encodeURIComponent(value)`.
pub fn encode_uri_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// `decodeURIComponent(value)`; `None` where it throws (`URIError`).
pub fn decode_uri_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

// ------------------------------------------------------------ Uint8Array

const BYTES_TAG: &str = "$uint8array";

/// A `Uint8Array` in an in-process request: the contract tells bytes from a
/// plain array or string, so they travel tagged.
pub fn uint8array(bytes: &[u8]) -> Value {
    Obj::new()
        .set(
            BYTES_TAG,
            base64::engine::general_purpose::STANDARD.encode(bytes),
        )
        .build()
}

/// The bytes of a [`uint8array`] value (`value instanceof Uint8Array`).
pub fn as_uint8array(value: &Value) -> Option<Vec<u8>> {
    let map = value.as_object()?;
    if map.len() != 1 {
        return None;
    }
    base64::engine::general_purpose::STANDARD
        .decode(map.get(BYTES_TAG)?.as_str()?)
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    #[test]
    fn safe_integers_follow_number_is_safe_integer() {
        assert!(is_safe_integer(&json!(3)));
        assert!(is_safe_integer(&json!(3.0)));
        assert!(!is_safe_integer(&json!(3.5)));
        assert!(!is_safe_integer(&json!("3")));
        assert!(!is_safe_integer(&json!(9_007_199_254_740_992u64)));
        assert_eq!(number(2.0), json!(2));
        assert!(!truthy(&json!(0)) && !truthy(&json!("")) && truthy(&json!([])));
    }

    #[test]
    fn objects_keep_insertion_order() {
        let value = Obj::new()
            .set("b", 1)
            .set("a", 2)
            .opt::<i64>("c", None)
            .build();
        assert_eq!(stringify(&value), r#"{"b":1,"a":2}"#);
        let mut value = with(&value, "c", 3);
        delete(&mut value, "b");
        assert_eq!(stringify(&value), r#"{"a":2,"c":3}"#);
        assert_eq!(json_byte_length(&json!({"é": 1})), 8);
    }

    #[test]
    fn uri_components_and_bytes_round_trip() {
        assert_eq!(encode_uri_component("a b/é"), "a%20b%2F%C3%A9");
        assert_eq!(decode_uri_component("a%20b%2F%C3%A9").unwrap(), "a b/é");
        assert_eq!(decode_uri_component("%E0%A4%A"), None);
        assert_eq!(as_uint8array(&uint8array(&[1, 2])).unwrap(), vec![1, 2]);
        assert_eq!(as_uint8array(&json!([1, 2])), None);
    }
}
