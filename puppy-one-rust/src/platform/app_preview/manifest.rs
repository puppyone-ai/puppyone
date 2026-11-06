//! `shared/appPreviewManifest.js`: the `.puppyoneapp` manifest the runtime
//! trusts — strict fields, relative paths that stay inside the workspace,
//! `${port}` as the only template variable.
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const APP_PREVIEW_TYPE: &str = "puppyone.app";
pub const APP_PREVIEW_VERSION: u64 = 1;
pub const APP_PREVIEW_EXTENSION: &str = ".puppyoneapp";

/// `AppPreviewManifestError`: a message and its code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManifestError {
    pub message: String,
    pub code: &'static str,
}
impl ManifestError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: "manifest-invalid",
        }
    }
}
impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
type Result<T> = std::result::Result<T, ManifestError>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Health {
    pub path: String,
    pub expect_status: u16,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Launch {
    LocalServer {
        command: Vec<String>,
        cwd: String,
        env: BTreeMap<String, String>,
        url: String,
        health: Health,
    },
    StaticFile {
        path: String,
    },
    ExistingUrl {
        url: String,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub id: Option<String>,
    pub name: String,
    pub launch: Option<Launch>,
    /// `permissions.workspace`: `read` / `write`.
    pub workspace_permissions: Vec<String>,
}

/// `parseAppPreviewManifest(content, { appPath })`.
pub fn parse(content: &str, app_path: &str) -> Result<Manifest> {
    let value: Value = serde_json::from_str(content).map_err(|error| ManifestError {
        message: format!("App manifest is not valid JSON. {error}"),
        code: "manifest-json-invalid",
    })?;
    normalize(&value, app_path)
}

/// `normalizeAppPreviewManifest(value, { appPath })`.
pub fn normalize(value: &Value, app_path: &str) -> Result<Manifest> {
    let record = record(value, "App manifest")?;
    known_fields(
        record,
        &["id", "name", "type", "version", "launch", "permissions"],
        "App manifest",
    )?;
    if record.get("type").and_then(Value::as_str) != Some(APP_PREVIEW_TYPE) {
        return Err(ManifestError::new(format!(
            "App manifest type must be \"{APP_PREVIEW_TYPE}\"."
        )));
    }
    if js_number(record.get("version")) != Some(APP_PREVIEW_VERSION as f64) {
        return Err(ManifestError {
            message: "Unsupported PuppyOne App manifest version.".into(),
            code: "manifest-version-unsupported",
        });
    }
    Ok(Manifest {
        id: optional_string(record.get("id"), 160),
        name: optional_string(record.get("name"), 120)
            .unwrap_or_else(|| basename_without_extension(app_path)),
        launch: match record.get("launch") {
            None | Some(Value::Null) => None,
            Some(launch) => Some(normalize_launch(launch)?),
        },
        workspace_permissions: permissions(record.get("permissions"))?,
    })
}

/// `Number(value)` for the version field (a numeric string counts).
fn js_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// `interpolateAppPreviewTemplate(value, { port }, label)`.
pub fn interpolate(value: &str, port: u16, label: &str) -> Result<String> {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match template_name(after) {
            Some(name) => {
                if name != "port" {
                    return Err(ManifestError::new(format!(
                        "{label} uses unsupported variable ${{{name}}}."
                    )));
                }
                out.push_str(&port.to_string());
                rest = &after[name.len() + 1..];
            }
            None => {
                out.push_str("${");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}
/// `interpolateAppPreviewCommand(command, { port })`.
pub fn interpolate_command(command: &[String], port: u16) -> Result<Vec<String>> {
    if command.is_empty() {
        return Err(ManifestError::new(
            "App preview command must be a non-empty array.",
        ));
    }
    command
        .iter()
        .enumerate()
        .map(|(index, part)| {
            interpolate(
                part,
                port,
                &format!("App preview command argument {}", index + 1),
            )
        })
        .collect()
}

/// `TEMPLATE_PATTERN`'s name after `${`, when it closes with `}`.
fn template_name(after: &str) -> Option<&str> {
    let end = after.find('}')?;
    let name = &after[..end];
    let mut chars = name.chars();
    let first = chars.next()?;
    (first.is_ascii_alphabetic() && chars.all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .then_some(name)
}
fn assert_templates(value: &str, label: &str) -> Result<()> {
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        let after = &rest[start + 2..];
        if let Some(name) = template_name(after) {
            if name != "port" {
                return Err(ManifestError::new(format!(
                    "{label} uses unsupported variable ${{{name}}}."
                )));
            }
            rest = &after[name.len() + 1..];
        } else {
            rest = after;
        }
    }
    Ok(())
}

fn normalize_launch(value: &Value) -> Result<Launch> {
    let record = record(value, "App manifest launch config")?;
    match record.get("kind").and_then(Value::as_str) {
        Some("static-file") => {
            known_fields(
                record,
                &["kind", "path"],
                "App manifest static-file launch config",
            )?;
            let path = portable_relative_path(record.get("path"), "App preview HTML file")?;
            if path == "." {
                return Err(ManifestError::new(
                    "App preview HTML file must point to a file.",
                ));
            }
            Ok(Launch::StaticFile { path })
        }
        Some("existing-url") => {
            known_fields(
                record,
                &["kind", "url"],
                "App manifest existing-url launch config",
            )?;
            Ok(Launch::ExistingUrl {
                url: external_url(record.get("url"))?,
            })
        }
        Some("local-server") => {
            known_fields(
                record,
                &["kind", "command", "cwd", "env", "url", "health"],
                "App manifest local-server launch config",
            )?;
            let command = match record.get("command") {
                Some(Value::Array(parts)) if !parts.is_empty() => {
                    parts.iter().map(command_part).collect::<Result<Vec<_>>>()?
                }
                _ => {
                    return Err(ManifestError::new(
                        "App preview command must be a non-empty array.",
                    ));
                }
            };
            let cwd = portable_relative_path(
                Some(record.get("cwd").unwrap_or(&Value::String(".".into()))),
                "App preview cwd",
            )?;
            let url = required_template(record.get("url"), "App preview URL")?;
            if !url.contains("${port}") {
                return Err(ManifestError::new("App preview URL must include ${port}."));
            }
            Ok(Launch::LocalServer {
                command,
                cwd,
                env: env(record.get("env"))?,
                url,
                health: health(record.get("health"))?,
            })
        }
        _ => Err(ManifestError::new("Unsupported app preview launch kind.")),
    }
}

fn external_url(value: Option<&Value>) -> Result<String> {
    let invalid = || ManifestError::new("App preview URL must be a valid HTTP or HTTPS URL.");
    let text = value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && !s.contains('\0'))
        .ok_or_else(invalid)?;
    let parsed = url::Url::parse(text.trim()).map_err(|_| invalid())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(ManifestError::new(
            "App preview URL must be a credential-free HTTP or HTTPS URL.",
        ));
    }
    Ok(parsed.to_string())
}

fn health(value: Option<&Value>) -> Result<Health> {
    let default = Health {
        path: "/".into(),
        expect_status: 200,
    };
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(Value::String(path)) => Ok(Health {
            path: health_path(Some(&Value::String(path.clone())))?,
            ..default
        }),
        Some(value) => {
            let record = record(value, "App preview health config")?;
            known_fields(
                record,
                &["path", "expectStatus"],
                "App preview health config",
            )?;
            let path = match record.get("path") {
                None | Some(Value::Null) => "/".to_owned(),
                path => health_path(path)?,
            };
            let status = match record.get("expectStatus") {
                None | Some(Value::Null) => 200.,
                status => js_number(status).unwrap_or(f64::NAN),
            };
            if status.fract() != 0. || !(100. ..=599.).contains(&status) {
                return Err(ManifestError::new(
                    "App preview expected health status is invalid.",
                ));
            }
            Ok(Health {
                path,
                expect_status: status as u16,
            })
        }
    }
}
fn health_path(value: Option<&Value>) -> Result<String> {
    match value.and_then(Value::as_str) {
        Some(path) if path.starts_with('/') && !path.contains('\0') => Ok(path.to_owned()),
        _ => Err(ManifestError::new(
            "App preview health path must start with /.",
        )),
    }
}

fn permissions(value: Option<&Value>) -> Result<Vec<String>> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(vec![]);
    };
    let record = record(value, "App preview permissions")?;
    known_fields(record, &["workspace"], "App preview permissions")?;
    let workspace = match record.get("workspace") {
        None | Some(Value::Null) => return Ok(vec![]),
        Some(Value::Array(items)) => items,
        Some(_) => {
            return Err(ManifestError::new(
                "App preview workspace permissions must be an array.",
            ));
        }
    };
    let mut normalized = Vec::new();
    for permission in workspace {
        match permission.as_str() {
            Some(p @ ("read" | "write")) => {
                if !normalized.iter().any(|n| n == p) {
                    normalized.push(p.to_owned());
                }
            }
            _ => {
                return Err(ManifestError::new(format!(
                    "Unsupported app preview workspace permission: {}",
                    js_string(permission)
                )));
            }
        }
    }
    Ok(normalized)
}

fn env(value: Option<&Value>) -> Result<BTreeMap<String, String>> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(BTreeMap::new());
    };
    let record = record(value, "App preview env")?;
    let mut env = BTreeMap::new();
    for (key, raw) in record {
        let mut chars = key.chars();
        let valid = chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid {
            return Err(ManifestError::new(format!(
                "Invalid app preview env key: {key}"
            )));
        }
        let Some(text) = raw.as_str().filter(|s| !s.contains('\0')) else {
            return Err(ManifestError::new(format!(
                "App preview env value for {key} must be a string."
            )));
        };
        assert_templates(text, &format!("App preview env value for {key}"))?;
        env.insert(key.clone(), text.to_owned());
    }
    Ok(env)
}

fn command_part(value: &Value) -> Result<String> {
    let Some(text) = value
        .as_str()
        .filter(|s| !s.trim().is_empty() && !s.contains('\0'))
    else {
        return Err(ManifestError::new(
            "App preview command contains an invalid value.",
        ));
    };
    let normalized = text.trim().to_owned();
    assert_templates(&normalized, "App preview command")?;
    Ok(normalized)
}

fn required_template(value: Option<&Value>, label: &str) -> Result<String> {
    let Some(text) = value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && !s.contains('\0'))
    else {
        return Err(ManifestError::new(format!(
            "{label} must be a non-empty string."
        )));
    };
    let normalized = text.trim().to_owned();
    assert_templates(&normalized, label)?;
    Ok(normalized)
}

/// `normalizePortableRelativePath(value, label)`.
pub fn portable_relative_path(value: Option<&Value>, label: &str) -> Result<String> {
    let relative = || ManifestError::new(format!("{label} must be a relative path."));
    let text = value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && !s.contains('\0'))
        .ok_or_else(relative)?;
    let portable = text.trim().replace('\\', "/");
    let drive = portable.len() >= 3
        && portable.as_bytes()[0].is_ascii_alphabetic()
        && &portable[1..3] == ":/";
    if portable.starts_with('/') || drive {
        return Err(relative());
    }
    let mut normalized: Vec<&str> = Vec::new();
    for part in portable.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if normalized.pop().is_none() {
                    return Err(ManifestError::new(format!(
                        "{label} must stay inside the workspace."
                    )));
                }
            }
            part => normalized.push(part),
        }
    }
    Ok(if normalized.is_empty() {
        ".".into()
    } else {
        normalized.join("/")
    })
}

fn optional_string(value: Option<&Value>, max: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.encode_utf16().take(max).collect::<Vec<u16>>())
        .map(|units| String::from_utf16_lossy(&units))
}
fn record<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| ManifestError::new(format!("{label} must be a JSON object.")))
}
fn known_fields(record: &Map<String, Value>, allowed: &[&str], label: &str) -> Result<()> {
    let mut unknown: Vec<&str> = record
        .keys()
        .map(String::as_str)
        .filter(|key| !allowed.contains(key))
        .collect();
    if unknown.is_empty() {
        return Ok(());
    }
    unknown.sort_unstable();
    Err(ManifestError::new(format!(
        "{label} contains unsupported fields: {}.",
        unknown.join(", ")
    )))
}
/// `String(value)` for messages.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    }
}
/// `basenameWithoutAppExtension(appPath)`.
pub fn basename_without_extension(app_path: &str) -> String {
    let normalized = app_path.replace('\\', "/");
    let base = normalized.rsplit('/').next().unwrap_or(&normalized);
    if base.to_lowercase().ends_with(APP_PREVIEW_EXTENSION) {
        base[..base.len() - APP_PREVIEW_EXTENSION.len()].to_owned()
    } else {
        base.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn manifests_follow_the_product_contract() {
        let local = parse(
            r#"{"type":"puppyone.app","version":1,"name":" Shop ","launch":{"kind":"local-server",
                "command":["npm","run","dev","--","--port","${port}"],"cwd":"web/./app/..","url":"http://127.0.0.1:${port}/",
                "env":{"VITE_PORT":"${port}"},"health":{"path":"/health","expectStatus":204}},
                "permissions":{"workspace":["read","read"]}}"#,
            "apps/shop.puppyoneapp",
        )
        .unwrap();
        assert_eq!(local.name, "Shop");
        assert_eq!(local.workspace_permissions, ["read"]);
        let Some(Launch::LocalServer {
            command,
            cwd,
            health,
            ..
        }) = &local.launch
        else {
            panic!("local server")
        };
        assert_eq!(cwd, "web");
        assert_eq!(health.expect_status, 204);
        assert_eq!(interpolate_command(command, 5173).unwrap()[5], "5173");
        let unconfigured = parse(
            r#"{"type":"puppyone.app","version":1}"#,
            "a/My App.puppyoneapp",
        )
        .unwrap();
        assert_eq!(unconfigured.name, "My App");
        assert!(unconfigured.launch.is_none());
        for (content, message) in [
            ("{", "App manifest is not valid JSON."),
            (r#"{"type":"x","version":1}"#, "App manifest type must be"),
            (
                r#"{"type":"puppyone.app","version":2}"#,
                "Unsupported PuppyOne App manifest version.",
            ),
            (
                r#"{"type":"puppyone.app","version":1,"extra":1}"#,
                "App manifest contains unsupported fields: extra.",
            ),
            (
                r#"{"type":"puppyone.app","version":1,"launch":{"kind":"local-server","command":["x"],"url":"http://127.0.0.1/"}}"#,
                "App preview URL must include ${port}.",
            ),
            (
                r#"{"type":"puppyone.app","version":1,"launch":{"kind":"static-file","path":"../x.html"}}"#,
                "App preview HTML file must stay inside the workspace.",
            ),
            (
                r#"{"type":"puppyone.app","version":1,"launch":{"kind":"local-server","command":["${host}"],"url":"http://127.0.0.1:${port}"}}"#,
                "App preview command uses unsupported variable ${host}.",
            ),
            (
                r#"{"type":"puppyone.app","version":1,"launch":{"kind":"existing-url","url":"ftp://x"}}"#,
                "credential-free HTTP or HTTPS URL",
            ),
        ] {
            let error = parse(content, "a.puppyoneapp").unwrap_err();
            assert!(
                error.message.contains(message),
                "{content}: {}",
                error.message
            );
        }
        assert_eq!(
            parse(r#"{"type":"puppyone.app","version":1,"launch":{"kind":"existing-url","url":"https://example.com"}}"#, "a.puppyoneapp")
                .unwrap()
                .launch,
            Some(Launch::ExistingUrl { url: "https://example.com/".into() })
        );
    }
}
