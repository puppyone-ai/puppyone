//! MCP form validation. UI values are never forwarded as unvalidated provider payloads.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Field {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub required: bool,
    pub options: Vec<String>,
}
pub fn fields(schema: &Value) -> Result<Vec<Field>, String> {
    let properties = schema["properties"]
        .as_object()
        .ok_or("Form has no properties")?;
    if properties.len() > 32 {
        return Err("Form exceeds the field limit".into());
    }
    properties
        .iter()
        .map(|(id, v)| {
            let kind = v["type"].as_str().unwrap_or("string");
            if !matches!(kind, "string" | "boolean" | "integer" | "number" | "array") {
                return Err(format!("Unsupported form field type: {kind}"));
            }
            Ok(Field {
                id: id.clone(),
                label: v["title"]
                    .as_str()
                    .or(v["description"].as_str())
                    .unwrap_or(id)
                    .chars()
                    .take(500)
                    .collect(),
                kind: kind.into(),
                required: schema["required"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == id)),
                options: v["enum"]
                    .as_array()
                    .or(v["items"]["enum"].as_array())
                    .into_iter()
                    .flatten()
                    .map(|v| {
                        v.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .collect(),
            })
        })
        .collect()
}
pub fn validate(schema: &Value, answers: &BTreeMap<String, String>) -> Result<Value, String> {
    let mut out = serde_json::Map::new();
    for f in fields(schema)? {
        let raw = answers.get(&f.id).map(String::as_str).unwrap_or("");
        if raw.is_empty() {
            if f.required {
                return Err(format!("{} is required", f.label));
            }
            continue;
        }
        let value = match f.kind.as_str() {
            "boolean" => match raw.trim() {
                "true" => json!(true),
                "false" => json!(false),
                _ => return Err(format!("{} must be true or false", f.label)),
            },
            "integer" => json!(
                raw.parse::<i64>()
                    .map_err(|_| format!("{} must be an integer", f.label))?
            ),
            "number" => {
                let n = raw
                    .parse::<f64>()
                    .map_err(|_| format!("{} must be a number", f.label))?;
                if !n.is_finite() {
                    return Err("A finite number is required".into());
                }
                json!(n)
            }
            "array" => {
                let value: Value = serde_json::from_str(raw)
                    .map_err(|_| format!("{} must be a JSON array", f.label))?;
                if !value.is_array() {
                    return Err("A JSON array is required".into());
                }
                value
            }
            _ => json!(raw),
        };
        let spec = &schema["properties"][&f.id];
        if let Some(options) = spec["enum"].as_array()
            && !options.contains(&value)
        {
            return Err(format!("{} is not an offered value", f.label));
        }
        if let Some(array) = value.as_array()
            && (array.len() > 128
                || array.iter().any(|v| {
                    !v.is_string()
                        || spec["items"]["enum"]
                            .as_array()
                            .is_some_and(|a| !a.contains(v))
                }))
        {
            return Err(format!("{} contains an invalid selection", f.label));
        }
        if let Some(n) = value.as_f64()
            && (spec["minimum"].as_f64().is_some_and(|m| n < m)
                || spec["maximum"].as_f64().is_some_and(|m| n > m))
        {
            return Err(format!("{} is outside the allowed range", f.label));
        }
        if let Some(s) = value.as_str() {
            let n = s.chars().count() as u64;
            if n > 8000
                || spec["minLength"].as_u64().is_some_and(|m| n < m)
                || spec["maxLength"].as_u64().is_some_and(|m| n > m)
            {
                return Err(format!("{} has an invalid length", f.label));
            }
        }
        out.insert(f.id, value);
    }
    Ok(Value::Object(out))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn forms_enforce_required_enum_and_numeric_bounds() {
        let schema = json!({"properties":{"mode":{"type":"string","enum":["a","b"]},"count":{"type":"integer","minimum":1,"maximum":3}},"required":["mode"]});
        assert!(validate(&schema, &BTreeMap::new()).is_err());
        assert!(validate(&schema, &BTreeMap::from([("mode".into(), "c".into())])).is_err());
        let v = validate(
            &schema,
            &BTreeMap::from([("mode".into(), "b".into()), ("count".into(), "2".into())]),
        )
        .unwrap();
        assert_eq!(v["count"], 2);
    }
}
