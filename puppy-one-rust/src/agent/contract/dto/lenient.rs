//! Reading the product's JSON as JavaScript does: a `null` where a string,
//! flag or number is expected reads as its empty value, and an integral
//! number reads as an integer whichever way it was written.
use serde::{Deserialize, Deserializer};
use serde_json::Value;

pub fn text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::String(text) => text,
        _ => String::new(),
    })
}

pub fn flag<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(Value::deserialize(deserializer)? == Value::Bool(true))
}

pub fn integer<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| {
                number
                    .as_f64()
                    .filter(|n| n.fract() == 0.)
                    .map(|n| n as i64)
            })
            .unwrap_or(0),
        _ => 0,
    })
}

pub fn number<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    Ok(Value::deserialize(deserializer)?.as_f64().unwrap_or(0.))
}

pub fn count<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    Ok(Value::deserialize(deserializer)?
        .as_u64()
        .map_or(0, |n| n.min(u32::MAX as u64) as u32))
}

pub fn index<'de, D: Deserializer<'de>>(deserializer: D) -> Result<usize, D::Error> {
    Ok(Value::deserialize(deserializer)?
        .as_u64()
        .map_or(0, |n| n as usize))
}

/// An optional integer: absent, `null` or not a number reads as `None`.
pub fn optional_integer<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<i64>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_f64()
                .filter(|n| n.fract() == 0.)
                .map(|n| n as i64)
        }),
        _ => None,
    })
}

/// An optional string: anything but a string reads as `None`.
pub fn optional_text<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(deserializer)? {
        Value::String(text) => Some(text),
        _ => None,
    })
}

/// An optional flag: anything but a boolean reads as `None`.
pub fn optional_flag<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<bool>, D::Error> {
    Ok(Value::deserialize(deserializer)?.as_bool())
}

/// An optional number: anything but a number reads as `None`.
pub fn optional_number<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<f64>, D::Error> {
    Ok(Value::deserialize(deserializer)?.as_f64())
}

/// A list: `null` or anything but a list reads as empty; entries that do
/// not read as `T` are an error.
pub fn list<'de, D: Deserializer<'de>, T: serde::de::DeserializeOwned>(
    deserializer: D,
) -> Result<Vec<T>, D::Error> {
    match Value::deserialize(deserializer)? {
        Value::Array(items) => items
            .into_iter()
            .map(|item| serde_json::from_value(item).map_err(serde::de::Error::custom))
            .collect(),
        _ => Ok(Vec::new()),
    }
}

/// A number as JavaScript writes it: integral values without a fraction
/// (`5`, never `5.0`).
pub fn write_number<S: serde::Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    use serde::Serialize;
    super::super::js::number(*value).serialize(serializer)
}

/// [`write_number`] of an optional number.
pub fn write_optional_number<S: serde::Serializer>(
    value: &Option<f64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::Serialize;
    value.map(super::super::js::number).serialize(serializer)
}
