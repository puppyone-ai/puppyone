//! The PTY environment is an owned snapshot, not a merge with ambient process
//! state. Remove launcher metadata while preserving user configuration.
use super::shell::Environment;
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DefaultColors {
    pub foreground: [u8; 3],
    pub background: [u8; 3],
}
impl DefaultColors {
    pub fn color_fg_bg(self) -> &'static str {
        let linear = self.background.map(|channel| {
            let value = f64::from(channel) / 255.;
            if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        });
        if linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 < 0.5 {
            "15;0"
        } else {
            "0;15"
        }
    }
}
const HOST_KEYS: [&str; 2] = ["PUPPYONE_APP_PATH", "PUPPYONE_CLI_ENDPOINT"];

pub fn build(
    source: &Environment,
    app_version: &str,
    host: &Environment,
    colors: Option<DefaultColors>,
    fresh_login_shell: bool,
    platform: &str,
) -> Environment {
    let conda_prefixes: Vec<_> = source
        .iter()
        .filter(|(key, value)| {
            fresh_login_shell && !value.is_empty() && conda_prefix(&key.to_ascii_uppercase())
        })
        .map(|(_, value)| value.as_str())
        .collect();
    let mut environment: Environment = source
        .iter()
        .filter(|(key, _)| {
            let key = key.to_ascii_uppercase();
            !matches!(
                key.as_str(),
                "NO_COLOR"
                    | "COLORFGBG"
                    | "INIT_CWD"
                    | "NPM_COMMAND"
                    | "NPM_EXECPATH"
                    | "NPM_NODE_EXECPATH"
                    | "NPM_CONFIG_PREFIX"
                    | "PREFIX"
            ) && !HOST_KEYS.contains(&key.as_str())
                && !key.starts_with("NPM_LIFECYCLE_")
                && !key.starts_with("NPM_PACKAGE_")
                && !(fresh_login_shell && conda_activation(&key))
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    if !conda_prefixes.is_empty()
        && let Some(path) = environment.get_mut("PATH")
    {
        *path = remove_conda_paths(path, &conda_prefixes, platform);
    }
    for (key, value) in [
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("TERM_PROGRAM", "PuppyOne"),
        ("TERM_PROGRAM_VERSION", app_version),
        ("PUPPYONE_TERMINAL", "1"),
    ] {
        environment.insert(key.into(), value.into());
    }
    if environment.get("CLICOLOR").is_none_or(String::is_empty) {
        environment.insert("CLICOLOR".into(), "1".into());
    }
    for key in HOST_KEYS {
        if let Some(value) = host.get(key).filter(|v| !v.is_empty()) {
            environment.insert(key.into(), value.clone());
        }
    }
    if let Some(colors) = colors {
        environment.insert("COLORFGBG".into(), colors.color_fg_bg().into());
    }
    environment
}
fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())
}
fn conda_prefix(key: &str) -> bool {
    key == "CONDA_PREFIX" || key.strip_prefix("CONDA_PREFIX_").is_some_and(digits)
}
fn conda_activation(key: &str) -> bool {
    conda_prefix(key)
        || matches!(
            key,
            "CONDA_SHLVL"
                | "CONDA_DEFAULT_ENV"
                | "CONDA_PROMPT_MODIFIER"
                | "CONDA_PATH_BACKUP"
                | "CONDA_PS1_BACKUP"
        )
        || key.strip_prefix("CONDA_STACKED_").is_some_and(digits)
        || key
            .strip_prefix("__CONDA_SHLVL_")
            .and_then(|v| v.split_once('_'))
            .is_some_and(|(level, _)| digits(level))
}
fn normalize_entry(path: &str, windows: bool) -> String {
    let value = path.trim_end_matches(['\\', '/']);
    if windows {
        value.to_ascii_lowercase()
    } else {
        value.into()
    }
}
fn remove_conda_paths(path: &str, prefixes: &[&str], platform: &str) -> String {
    let windows = platform == "win32";
    let separator = if windows { ';' } else { ':' };
    let mut targets = BTreeSet::new();
    for prefix in prefixes {
        if windows {
            for tail in [
                "",
                "Library\\mingw-w64\\bin",
                "Library\\usr\\bin",
                "Library\\bin",
                "Scripts",
                "bin",
            ] {
                let joined = crate::platform::paths::flavor::win32_join(&[prefix, tail]);
                targets.insert(normalize_entry(&joined, true));
            }
        } else {
            // Node path.posix.join normalizes repeated separators and dot segments.
            let joined = format!("{prefix}/bin");
            let mut parts = Vec::new();
            for part in joined.split('/') {
                match part {
                    "" | "." => (),
                    ".." if parts.last().is_some_and(|p| *p != "..") => {
                        parts.pop();
                    }
                    ".." if joined.starts_with('/') => (),
                    _ => parts.push(part),
                }
            }
            let joined = format!(
                "{}{}",
                if joined.starts_with('/') { "/" } else { "" },
                parts.join("/")
            );
            targets.insert(normalize_entry(&joined, false));
        }
    }
    path.split(separator)
        .filter(|entry| !targets.contains(&normalize_entry(entry, windows)))
        .collect::<Vec<_>>()
        .join(&separator.to_string())
}

#[cfg(test)]
mod tests;

#[cfg(all(test, target_os = "macos"))]
mod pty_tests;
