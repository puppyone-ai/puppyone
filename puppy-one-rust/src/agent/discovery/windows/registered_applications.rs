//! `platform/windows/registered-applications.mjs`: resolve Windows desktop
//! applications from OS-owned registration instead of install-directory
//! guesses.
use crate::agent::discovery::command_environment::EnvMap;
use crate::agent::tasks::CancelSignal;
use crate::platform::paths::flavor::{win32_basename, win32_is_absolute, win32_join};
use crate::text;
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

/// `windowsRegisteredApplicationLimits`.
pub mod limits {
    pub const MAX_APPLICATION_NAMES: usize = 8;
    pub const MAX_REGISTRY_OUTPUT_BYTES: usize = 64 * 1024;
    pub const REGISTRY_QUERY_TIMEOUT_MS: u64 = 1_500;
}

static APPLICATION_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9 ._-]+\.exe$").expect("application name pattern"));
static DEFAULT_VALUE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\sREG_(?:EXPAND_)?SZ\s+(.+)$").expect("registry value pattern"));
static QUOTED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)^"([^"]+\.exe)"(?:\s|$)"#).expect("quoted pattern"));
static UNQUOTED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(.+?\.exe)(?:\s|$)").expect("unquoted pattern"));
static VARIABLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"%([^%]+)%").expect("variable pattern"));

/// One registered application.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegisteredApplication {
    pub application_name: String,
    pub executable_path: String,
    pub source: String,
}

/// `createWindowsRegisteredApplicationLocator({ nodePlatform, environment }).find`.
pub async fn find_registered_applications(
    node_platform: &str,
    environment: &EnvMap,
    application_names: &[String],
    signal: Option<&CancelSignal>,
) -> crate::agent::agent_error::AgentResult<Vec<RegisteredApplication>> {
    if node_platform != "win32" {
        return Ok(Vec::new());
    }
    let names = normalize_application_names(application_names);
    let registry_executable = windows_registry_executable(environment);
    let mut observations = Vec::new();
    let mut seen = HashSet::new();
    for application_name in names {
        if let Some(signal) = signal {
            signal.check()?;
        }
        let values = futures_util::future::join_all(
            registration_keys(&application_name)
                .iter()
                .map(|key| query_default_registry_value(&registry_executable, key)),
        )
        .await;
        if let Some(signal) = signal {
            signal.check()?;
        }
        for value in values {
            let Some(executable_path) = registered_executable_path(value.as_deref(), environment)
            else {
                continue;
            };
            if win32_basename(&executable_path).to_lowercase() != application_name.to_lowercase() {
                continue;
            }
            if !seen.insert(executable_path.to_lowercase()) {
                continue;
            }
            observations.push(RegisteredApplication {
                application_name: application_name.clone(),
                executable_path,
                source: "windows-application-registration".into(),
            });
        }
    }
    Ok(observations)
}

fn registration_keys(application_name: &str) -> [String; 4] {
    [
        format!("HKCU\\Software\\Classes\\Applications\\{application_name}\\shell\\open\\command"),
        format!("HKLM\\Software\\Classes\\Applications\\{application_name}\\shell\\open\\command"),
        format!(
            "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{application_name}"
        ),
        format!(
            "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{application_name}"
        ),
    ]
}

async fn query_default_registry_value(registry_executable: &str, key: &str) -> Option<String> {
    let mut command = tokio::process::Command::new(registry_executable);
    command
        .args(["query", key, "/ve"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let output = tokio::time::timeout(
        Duration::from_millis(limits::REGISTRY_QUERY_TIMEOUT_MS),
        command.output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() || output.stdout.len() > limits::MAX_REGISTRY_OUTPUT_BYTES {
        return None;
    }
    parse_windows_registry_default_value(&output.stdout)
}

/// `parseWindowsRegistryDefaultValue(output)`: the default REG_SZ /
/// REG_EXPAND_SZ row, without depending on the localized value label.
pub fn parse_windows_registry_default_value(output: &[u8]) -> Option<String> {
    let text = decode_windows_command_output(output);
    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .find_map(|line| {
            DEFAULT_VALUE
                .captures(line)
                .and_then(|captures| captures.get(1))
                .map(|value| value.as_str().trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

/// `registeredExecutablePath(value, environment)`.
pub fn registered_executable_path(value: Option<&str>, environment: &EnvMap) -> Option<String> {
    let value = value.filter(|v| !v.contains(['\r', '\n', '\0']))?;
    let expanded = expand_windows_environment(value.trim(), environment);
    let executable_path = QUOTED
        .captures(&expanded)
        .or_else(|| UNQUOTED.captures(&expanded))
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().trim().to_string())
        .unwrap_or_default();
    (text::len16(&executable_path) <= 4_096 && win32_is_absolute(&executable_path))
        .then_some(executable_path)
}

fn expand_windows_environment(value: &str, environment: &EnvMap) -> String {
    VARIABLE
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let name = captures[1].to_lowercase();
            environment
                .iter()
                .rev()
                .find(|(key, _)| key.to_lowercase() == name)
                .map(|(_, entry)| entry.clone())
                .filter(|entry| !entry.is_empty())
                .unwrap_or_else(|| captures[0].to_string())
        })
        .into_owned()
}

fn normalize_application_names(values: &[String]) -> Vec<String> {
    values
        .iter()
        .take(limits::MAX_APPLICATION_NAMES)
        .filter(|value| APPLICATION_NAME.is_match(value) && value.len() <= 120)
        .cloned()
        .collect()
}

fn windows_registry_executable(environment: &EnvMap) -> String {
    let root = ["SystemRoot", "SYSTEMROOT", "WINDIR"]
        .iter()
        .find_map(|key| environment.get(*key).filter(|v| !v.is_empty()).cloned())
        .unwrap_or_else(|| "C:\\Windows".into());
    win32_join(&[&root, "System32", "reg.exe"])
}

fn decode_windows_command_output(output: &[u8]) -> String {
    let odd_zeros = output
        .iter()
        .take(80)
        .enumerate()
        .filter(|(index, byte)| index % 2 == 1 && **byte == 0)
        .count();
    let looks_utf16 =
        (output.len() >= 2 && output[0] == 0xff && output[1] == 0xfe) || odd_zeros > 12;
    if looks_utf16 {
        let units: Vec<u16> = output
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        return String::from_utf16_lossy(&units)
            .trim_start_matches('\u{feff}')
            .to_string();
    }
    let utf8 = String::from_utf8_lossy(output);
    if !utf8.contains('\u{fffd}') {
        return utf8.into_owned();
    }
    let (decoded, _, had_errors) = encoding_rs::GBK.decode(output);
    if had_errors {
        utf8.into_owned()
    } else {
        decoded.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn parses_localized_default_values_and_expands_registered_paths() {
        let output = "\r\nHKEY_CURRENT_USER\\Software\\Classes\\Applications\\WorkBuddy.exe\\shell\\open\\command\r\n    (Standard)    REG_SZ    \"%LOCALAPPDATA%\\Programs\\WorkBuddy\\WorkBuddy.exe\" \"%1\"\r\n";
        let value = parse_windows_registry_default_value(output.as_bytes()).unwrap();
        let environment = EnvMap::from([(
            "LocalAppData".to_string(),
            "C:\\Users\\a\\AppData\\Local".to_string(),
        )]);
        assert_eq!(
            registered_executable_path(Some(&value), &environment).as_deref(),
            Some("C:\\Users\\a\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe")
        );
        let utf16: Vec<u8> = "\u{feff}x    REG_EXPAND_SZ    C:\\A\\b.exe\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(
            parse_windows_registry_default_value(&utf16).as_deref(),
            Some("C:\\A\\b.exe")
        );
        assert_eq!(
            registered_executable_path(Some("relative\\b.exe"), &EnvMap::new()),
            None
        );
    }
}
