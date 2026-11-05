//! The JavaScript value semantics the Agent contract is written in. The
//! product's Main process and Renderer exchange plain JSON objects; the
//! port keeps them as [`serde_json::Value`] and reproduces the few language
//! rules the contract depends on: string `length` and `slice` count UTF-16
//! code units, `Number.isSafeInteger`, truthiness, `Date.parse` and
//! `toISOString`, `encodeURIComponent` and `Uint8Array` payloads.
use base64::Engine as _;
use serde_json::{Map, Value};

/// `Number.MAX_SAFE_INTEGER`.
pub const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

/// `value.length` of a JS string.
pub fn len16(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// The byte offset of UTF-16 offset `units`, clamped to the string. A cut
/// inside a surrogate pair keeps the pair out (Rust cannot hold half of it).
fn byte_at(value: &str, units: usize) -> usize {
    let mut count = 0;
    for (index, ch) in value.char_indices() {
        if count + ch.len_utf16() > units {
            return index;
        }
        count += ch.len_utf16();
    }
    value.len()
}

/// `value.slice(0, limit)`.
pub fn head16(value: &str, limit: usize) -> &str {
    &value[..byte_at(value, limit)]
}

/// `value.slice(start, end)` with non-negative bounds.
pub fn slice16(value: &str, start: usize, end: usize) -> &str {
    let from = byte_at(value, start);
    let to = byte_at(value, end).max(from);
    &value[from..to]
}

/// `value.slice(start)`.
pub fn tail16(value: &str, start: usize) -> &str {
    &value[byte_at(value, start)..]
}

/// `String.prototype.trim` (Unicode white space, line terminators and BOM).
pub fn trim(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

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

/// `value && typeof value === "object" && !Array.isArray(value)`.
pub fn is_record(value: &Value) -> bool {
    value.is_object()
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

// ----------------------------------------------------------------- dates

/// `Date.parse(value)` in milliseconds: the ECMAScript date-time string
/// format (date-only forms are UTC), the forms V8 also reads (a space for
/// `T`, RFC 2822). Times without an offset are read as UTC.
pub fn date_parse(value: &str) -> Option<i64> {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime};
    use std::sync::LazyLock;
    static ISO: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$",
        )
        .expect("ISO date pattern")
    });
    let text = trim(value);
    if let Some(captures) = ISO.captures(text) {
        let year: i32 = captures[1].parse().ok()?;
        if &captures[1] == "-000000" {
            return None;
        }
        let part = |index: usize, default: u32| -> Option<u32> {
            captures
                .get(index)
                .map_or(Some(default), |m| m.as_str().parse().ok())
        };
        let date = NaiveDate::from_ymd_opt(year, part(2, 1)?, part(3, 1)?)?;
        let (hour, minute, second) = (part(4, 0)?, part(5, 0)?, part(6, 0)?);
        let millis = captures.get(7).map_or(Some(0), |m| {
            let digits = format!("{:0<3}", m.as_str());
            digits[..3].parse::<u32>().ok()
        })?;
        // `24:00` is the end of the day.
        let (time, carry) = if hour == 24 && minute == 0 && second == 0 && millis == 0 {
            (NaiveTime::from_hms_opt(0, 0, 0)?, 86_400_000)
        } else {
            (
                NaiveTime::from_hms_milli_opt(hour, minute, second, millis)?,
                0,
            )
        };
        let utc = NaiveDateTime::new(date, time).and_utc().timestamp_millis() + carry;
        let offset = match captures.get(8).map(|m| m.as_str()) {
            None | Some("Z") => 0,
            Some(zone) => {
                let sign = if zone.starts_with('-') { -1 } else { 1 };
                let digits: String = zone[1..].chars().filter(char::is_ascii_digit).collect();
                let hours: i64 = digits[..2].parse().ok()?;
                let minutes: i64 = digits[2..].parse().ok()?;
                if hours > 23 || minutes > 59 {
                    return None;
                }
                sign * (hours * 60 + minutes) * 60_000
            }
        };
        return Some(utc - offset);
    }
    DateTime::parse_from_rfc2822(text)
        .ok()
        .map(|date| date.timestamp_millis())
}

/// `new Date(milliseconds).toISOString()`.
pub fn iso_string(milliseconds: i64) -> String {
    let Some(date) = chrono::DateTime::from_timestamp_millis(milliseconds) else {
        return String::new();
    };
    use chrono::Datelike;
    let year = date.year();
    let rest = date.format("-%m-%dT%H:%M:%S%.3fZ");
    if (0..=9999).contains(&year) {
        format!("{year:04}{rest}")
    } else {
        format!(
            "{}{:06}{rest}",
            if year < 0 { '-' } else { '+' },
            year.abs()
        )
    }
}

/// `new Date().toISOString()`.
pub fn now_iso() -> String {
    iso_string(now_ms())
}

/// `Date.now()`.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
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
    fn strings_count_utf16_code_units() {
        assert_eq!(len16("a😀b"), 4);
        assert_eq!(head16("a😀b", 2), "a");
        assert_eq!(head16("a😀b", 3), "a😀");
        assert_eq!(slice16("héllo", 1, 3), "él");
        assert_eq!(tail16("a😀b", 3), "b");
        assert_eq!(trim("\u{feff} x \n"), "x");
    }

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
    fn dates_parse_like_date_parse() {
        assert_eq!(date_parse("1970-01-01T00:00:01.5Z"), Some(1_500));
        assert_eq!(date_parse("1970-01-02"), Some(86_400_000));
        assert_eq!(date_parse("1970-01-01T01:00:00+01:00"), Some(0));
        assert_eq!(date_parse("not-a-date"), None);
        assert_eq!(date_parse("2026-13-01"), None);
        assert_eq!(iso_string(1_500), "1970-01-01T00:00:01.500Z");
        assert_eq!(
            iso_string(date_parse("2026-08-30T00:00:00Z").unwrap()),
            "2026-08-30T00:00:00.000Z"
        );
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
