//! `runtimes/codex/codex-native-values.mjs`: Codex app-server values read
//! into the provider-neutral shapes.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::clock;
use crate::text;
use serde_json::{Map, Value, json};

const CODEX_REASONING_EFFORTS: &[&str] = &["none", "minimal", "low", "medium", "high", "xhigh"];

/// `normalizeProviderSession(result)`.
pub fn normalize_provider_session(result: &Value) -> Value {
    let thread = &result["thread"];
    json!({
        "providerSessionId": thread["id"],
        "title": title(thread),
        "model": result.get("model").filter(|m| js::truthy(m)).cloned().unwrap_or(Value::Null),
        "createdAt": to_iso_from_seconds(thread.get("createdAt")),
        "updatedAt": to_iso_from_seconds(thread.get("updatedAt")),
    })
}

/// `thread.name || thread.preview || "Codex session"`.
fn title(thread: &Value) -> Value {
    ["name", "preview"]
        .iter()
        .filter_map(|key| thread.get(*key))
        .find(|value| js::truthy(value))
        .cloned()
        .unwrap_or_else(|| Value::from("Codex session"))
}

/// `normalizeAccount(result)`.
pub fn normalize_account(result: &Value) -> Value {
    let requires_openai_auth = js::truthy_opt(result.get("requiresOpenaiAuth"));
    let Some(account) = result.get("account").filter(|a| a.is_object()) else {
        return Obj::new()
            .set("account", Value::Null)
            .set("requiresOpenaiAuth", requires_openai_auth)
            .opt(
                "setupReason",
                requires_openai_auth.then_some("authentication-required"),
            )
            .build();
    };
    let text = |key: &str| account.get(key).filter(|v| v.is_string()).cloned();
    json!({
        "account": {
            "type": text("type").unwrap_or_else(|| Value::from("unknown")),
            "email": text("email").unwrap_or(Value::Null),
            "planType": text("planType").unwrap_or(Value::Null),
        },
        "requiresOpenaiAuth": requires_openai_auth,
    })
}

/// `value ?? fallback` over a chain of properties.
fn coalesce<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .filter_map(|key| value.get(*key))
        .find(|entry| !entry.is_null())
}

/// `normalizeModels(result)`.
pub fn normalize_models(result: &Value) -> Vec<Value> {
    let Some(data) = result.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    data.iter()
        .filter(|model| !js::truthy_opt(model.get("hidden")))
        .take(100)
        .map(|model| {
            let mut variants: Vec<String> = Vec::new();
            if let Some(efforts) = model
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
            {
                for entry in efforts {
                    if let Some(effort) =
                        normalize_codex_reasoning_effort(entry.get("reasoningEffort"))
                        && !variants.contains(&effort)
                    {
                        variants.push(effort);
                    }
                }
                variants.truncate(20);
            }
            let advertised = normalize_codex_reasoning_effort(model.get("defaultReasoningEffort"));
            let default_variant = match advertised {
                Some(effort) if variants.contains(&effort) => Some(effort),
                _ if variants.iter().any(|v| v == "medium") => Some("medium".to_string()),
                _ => variants.first().cloned(),
            };
            json!({
                "id": js::string_or_empty(coalesce(model, &["id", "model"])),
                "model": js::string_or_empty(coalesce(model, &["model", "id"])),
                "displayName": coalesce(model, &["displayName", "model", "id"])
                    .map_or_else(|| "Codex".to_string(), |v| js::to_js_string(Some(v))),
                "description": js::string_or_empty(model.get("description")),
                "isDefault": js::truthy_opt(model.get("isDefault")),
                "variants": variants,
                "defaultVariant": default_variant,
            })
        })
        .filter(|model| model["id"].as_str().is_some_and(|id| !id.is_empty()))
        .collect()
}

/// `normalizeCodexReasoningEffort(value)`.
pub fn normalize_codex_reasoning_effort(value: Option<&Value>) -> Option<String> {
    let normalized = value?.as_str()?.trim().to_lowercase();
    // Older catalogs/configs used `max`; the app-server wire value is `xhigh`.
    let compatible = if normalized == "max" {
        "xhigh".to_string()
    } else {
        normalized
    };
    CODEX_REASONING_EFFORTS
        .contains(&compatible.as_str())
        .then_some(compatible)
}

/// `compatibleReasoningEffort(model, requested)`.
pub fn compatible_reasoning_effort(
    model: Option<&Value>,
    requested: Option<&Value>,
) -> AgentResult<Option<String>> {
    let requested = requested.filter(|r| js::truthy(r));
    let variants: Vec<&str> = model
        .and_then(|m| m.get("variants"))
        .and_then(Value::as_array)
        .map(|v| v.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let has_variants = model
        .and_then(|m| m.get("variants"))
        .and_then(Value::as_array)
        .is_some_and(|v| !v.is_empty());
    if !has_variants {
        if requested.is_some() {
            return Err(AgentError::new(
                "The selected Codex model does not support configurable reasoning effort.",
            ));
        }
        return Ok(None);
    }
    if let Some(requested) = requested {
        if let Some(normalized) = normalize_codex_reasoning_effort(Some(requested))
            && variants.contains(&normalized.as_str())
        {
            return Ok(Some(normalized));
        }
        return Err(AgentError::new(
            "The selected Codex reasoning effort is no longer available for this model.",
        ));
    }
    if let Some(default) = model
        .and_then(|m| m.get("defaultVariant"))
        .and_then(Value::as_str)
        .filter(|d| !d.is_empty() && variants.contains(d))
    {
        return Ok(Some(default.to_string()));
    }
    Ok(if variants.contains(&"medium") {
        Some("medium".into())
    } else {
        variants.first().map(|v| v.to_string())
    })
}

/// `isApprovalDecision(value)`.
pub fn is_approval_decision(value: &Value) -> bool {
    matches!(
        value.as_str(),
        Some("accept" | "acceptForSession" | "decline" | "cancel")
    )
}

/// `normalizeNetworkApprovalContext(value)`.
pub fn normalize_network_approval_context(value: Option<&Value>) -> Value {
    let Some(value) = value.filter(|v| v.is_object()) else {
        return Value::Null;
    };
    let field = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(text::trim)
            .unwrap_or("")
    };
    let (host, protocol) = (field("host"), field("protocol"));
    if host.is_empty() || protocol.is_empty() {
        return Value::Null;
    }
    json!({ "host": text::head16(host, 512), "protocol": text::head16(protocol, 40) })
}

/// `String(value || fallback)`.
fn or_text(value: Option<&Value>, fallback: impl FnOnce() -> String) -> String {
    match value.filter(|v| js::truthy(v)) {
        Some(value) => js::to_js_string(Some(value)),
        None => fallback(),
    }
}

/// `normalizeCodexQuestions(value)`.
pub fn normalize_codex_questions(value: Option<&Value>) -> Vec<Value> {
    let questions = value.and_then(Value::as_array).cloned().unwrap_or_default();
    questions
        .iter()
        .take(16)
        .enumerate()
        .map(|(index, question)| {
            let options: Vec<Value> = question
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .take(64)
                        .map(|option| {
                            let label = match option.get("label").filter(|l| !l.is_null()) {
                                Some(label) => js::to_js_string(Some(label)),
                                None => js::string_or_empty(Some(option)),
                            };
                            json!({
                                "label": text::head16(&label, 300),
                                "description": text::head16(&js::string_or_empty(option.get("description")), 1_000),
                            })
                        })
                        .filter(|option| option["label"].as_str().is_some_and(|l| !l.is_empty()))
                        .collect()
                })
                .unwrap_or_default();
            json!({
                "id": string_or_null(question.get("id"))
                    .map_or_else(|| format!("question-{}", index + 1), str::to_string),
                "header": text::head16(&or_text(question.get("header"), || format!("Question {}", index + 1)), 160),
                "question": text::head16(&or_text(question.get("question"), || "Input required".into()), 2_000),
                "multiple": js::truthy_opt(question.get("multiple")) || js::truthy_opt(question.get("multiSelect")),
                "custom": question.get("custom") != Some(&Value::Bool(false)),
                "options": options,
            })
        })
        .collect()
}

/// `codexQuestionAnswers(questions, answers)`.
pub fn codex_question_answers(questions: &[Value], answers: Option<&Value>) -> Value {
    let mut entries = Map::new();
    for (index, question) in questions.iter().enumerate() {
        let answer: Vec<String> = answers
            .and_then(|a| a.get(index))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .map(|v| text::head16(&js::to_js_string(Some(v)), 2_000).to_string())
                    .collect()
            })
            .unwrap_or_default();
        entries.insert(
            js::to_js_string(question.get("id")),
            json!({ "answers": answer }),
        );
    }
    Value::Object(entries)
}

/// `requireString(value, message)`.
pub fn require_string(value: Option<&Value>, message: &str) -> AgentResult<String> {
    match value.and_then(Value::as_str) {
        Some(text) if !text.is_empty() => Ok(text.to_string()),
        _ => Err(AgentError::new(message)),
    }
}

/// `stringOrNull(value)`.
pub fn string_or_null(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// `stringOrNull(value)` as a JSON value.
pub fn string_or_null_value(value: Option<&Value>) -> Value {
    string_or_null(value).map_or(Value::Null, Value::from)
}

/// `toIsoFromSeconds(value)`: now when the value is not a finite number.
pub fn to_iso_from_seconds(value: Option<&Value>) -> String {
    match value.and_then(js::finite_number) {
        Some(seconds) if (seconds * 1000.0).abs() <= 8.64e15 => {
            clock::iso_string((seconds * 1000.0).trunc() as i64)
        }
        _ => clock::now_iso(),
    }
}

/// `boundedPageSize(value)`.
pub fn bounded_page_size(value: Option<&Value>) -> i64 {
    match value.and_then(js::safe_integer) {
        Some(n) if n > 0 => n.min(100),
        _ => 50,
    }
}
