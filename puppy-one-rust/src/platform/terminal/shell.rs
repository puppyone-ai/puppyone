//! `terminal-shell-host.mjs`: a trusted Agent is the shell's first foreground
//! command. Quoting preserves arguments and exit leaves a usable prompt.
use super::LaunchCommand;
use crate::platform::paths::flavor::{posix_basename, win32_basename};
use std::collections::BTreeMap;

pub type Environment = BTreeMap<String, String>;
#[derive(Clone, Debug)]
pub struct AgentCommand {
    pub executable_path: String,
    pub args: Vec<String>,
    pub display_name: Option<String>,
    /// Some means discovery has initialized this environment already.
    pub environment: Option<Environment>,
}
#[derive(Clone, Debug)]
pub struct ShellHost {
    pub command: LaunchCommand,
    pub bootstrap_input: Option<String>,
    pub display_shell: String,
    pub login_shell: bool,
}
impl ShellHost {
    pub fn system(agent: Option<&AgentCommand>) -> Result<Self, String> {
        let platform = if cfg!(windows) {
            "win32"
        } else if cfg!(target_os = "macos") {
            "darwin"
        } else {
            "linux"
        };
        Self::build(agent, &std::env::vars().collect(), platform)
    }
    pub fn build(
        agent: Option<&AgentCommand>,
        inherited: &Environment,
        platform: &str,
    ) -> Result<Self, String> {
        let captured = agent.and_then(|a| a.environment.as_ref());
        let environment = captured.unwrap_or(inherited);
        let read = |key: &str| environment.get(key).filter(|s| !s.is_empty()).cloned();
        let file = if platform == "win32" {
            read("ComSpec")
                .or_else(|| read("COMSPEC"))
                .unwrap_or_else(|| "cmd.exe".into())
        } else {
            read("SHELL").unwrap_or_else(|| {
                if platform == "darwin" {
                    "/bin/zsh".into()
                } else {
                    "/bin/bash".into()
                }
            })
        };
        let shell = if platform == "win32" {
            win32_basename(&file)
        } else {
            posix_basename(&file)
        };
        let mut args: Vec<String> = if platform != "win32" && matches!(shell, "bash" | "zsh") {
            vec!["-l".into()]
        } else {
            vec![]
        };
        let mut bootstrap_input = agent.map(|a| serialize(a, platform, &file)).transpose()?;
        if captured.is_some() {
            args = match shell {
                "bash" => vec!["--noprofile".into(), "--norc".into()],
                "zsh" => vec!["-f".into()],
                "fish" => vec!["--no-config".into()],
                _ if platform == "win32" && powershell(shell) => vec!["-NoProfile".into()],
                _ if platform == "win32" => vec!["/d".into(), "/v:off".into()],
                _ => args,
            };
        }
        if platform != "win32" && matches!(shell, "bash" | "zsh") {
            if let Some(command) = bootstrap_input.take() {
                args.extend([
                    "-i".into(),
                    "-c".into(),
                    format!(
                        "if {}; then :; fi; exec {} -l",
                        command.trim_end_matches('\r'),
                        quote_posix(&file)
                    ),
                ]);
            }
        } else if shell == "fish"
            && captured.is_some()
            && let Some(command) = bootstrap_input.take()
        {
            args.extend([
                "--interactive".into(),
                "--command".into(),
                format!(
                    "{}; exec {} --login",
                    command.trim_end_matches('\r'),
                    quote_posix(&file)
                ),
            ]);
        }
        let login_shell = captured.is_none() && !args.is_empty();
        let display_shell = agent
            .and_then(|a| a.display_name.clone())
            .unwrap_or_else(|| shell.into());
        let mut environment = environment.clone();
        if agent.is_some() && shell == "zsh" {
            environment.insert("DISABLE_AUTO_UPDATE".into(), "true".into());
        }
        Ok(Self {
            command: LaunchCommand {
                executable: file.into(),
                arguments: args,
                environment: environment.into_iter().collect(),
            },
            bootstrap_input,
            display_shell,
            login_shell,
        })
    }
}
fn powershell(value: &str) -> bool {
    value.eq_ignore_ascii_case("powershell.exe") || value.eq_ignore_ascii_case("pwsh.exe")
}
fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
fn quote_batch(value: &str) -> Result<String, String> {
    if value.contains(['"', '%', '\r', '\n', '\0']) {
        return Err("This Windows batch entrypoint cannot preserve the requested argument. Use a native executable.".into());
    }
    Ok(format!("\"{value}\""))
}
fn quote_windows(value: &str) -> String {
    let mut quoted = String::from("\"");
    let mut slashes = 0;
    for character in value.chars() {
        if character == '\\' {
            slashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(slashes * 2 + 1));
            quoted.push('"');
            slashes = 0;
            continue;
        }
        quoted.push_str(&"\\".repeat(slashes));
        quoted.push(character);
        slashes = 0;
    }
    quoted.push_str(&"\\".repeat(slashes * 2));
    quoted.push('"');
    quoted
}
/// Inert shell words; the path and fixed arguments have already passed the
/// host's installation boundary. Batch formats reject lossy cmd expansion.
pub fn serialize(agent: &AgentCommand, platform: &str, shell: &str) -> Result<String, String> {
    let command: Vec<&str> = std::iter::once(agent.executable_path.as_str())
        .chain(agent.args.iter().map(String::as_str))
        .collect();
    if platform != "win32" {
        return Ok(format!(
            "{}\r",
            command
                .iter()
                .map(|v| quote_posix(v))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    let batch = [".cmd", ".bat"].iter().any(|extension| {
        agent
            .executable_path
            .to_ascii_lowercase()
            .ends_with(extension)
    });
    if batch {
        for value in &command {
            quote_batch(value)?;
        }
    }
    if powershell(win32_basename(shell)) {
        return Ok(format!(
            "& {}\r",
            command
                .iter()
                .map(|v| quote_powershell(v))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    let words = command
        .iter()
        .map(|v| {
            if batch {
                quote_batch(v)
            } else {
                Ok(quote_windows(v))
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(format!("{}\r", words.join(" ")))
}

#[cfg(test)]
mod tests;

#[cfg(all(test, target_os = "macos"))]
mod pty_tests;

#[cfg(all(test, unix))]
mod bootstrap_tests;
