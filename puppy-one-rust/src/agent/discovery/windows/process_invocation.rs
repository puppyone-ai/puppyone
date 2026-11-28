//! `platform/windows/process-invocation.mjs`: Windows batch entrypoints
//! need cmd.exe; native binaries keep argv semantics.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::discovery::command_environment::EnvMap;
use crate::platform::paths::flavor::{win32_is_absolute, win32_join};

/// A resolved launch: file, arguments and whether they are verbatim.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessInvocation {
    pub file: String,
    pub args: Vec<String>,
    /// `windowsVerbatimArguments`.
    pub verbatim_arguments: bool,
}

/// `resolveProcessInvocation(file, args, { platform, env })`.
pub fn resolve_process_invocation(
    file: &str,
    args: &[String],
    platform: &str,
    env: &EnvMap,
) -> AgentResult<ProcessInvocation> {
    let lower = file.to_lowercase();
    if platform != "win32" || !(lower.ends_with(".cmd") || lower.ends_with(".bat")) {
        return Ok(ProcessInvocation {
            file: file.to_string(),
            args: args.to_vec(),
            verbatim_arguments: false,
        });
    }
    let read = |key: &str| env.get(key).filter(|v| !v.is_empty()).cloned();
    let root = read("SystemRoot")
        .or_else(|| read("SYSTEMROOT"))
        .unwrap_or_else(|| "C:\\Windows".into());
    let shell = read("ComSpec")
        .or_else(|| read("COMSPEC"))
        .unwrap_or_else(|| win32_join(&[&root, "System32", "cmd.exe"]));
    if !win32_is_absolute(&shell) {
        return Err(AgentError::new(
            "A Windows batch launcher requires an absolute command processor.",
        ));
    }
    let command = std::iter::once(file)
        .chain(args.iter().map(String::as_str))
        .map(quote_windows_batch_argument)
        .collect::<AgentResult<Vec<_>>>()?
        .join(" ");
    Ok(ProcessInvocation {
        file: shell,
        args: vec![
            "/d".into(),
            "/s".into(),
            "/v:off".into(),
            "/c".into(),
            format!("\"{command}\""),
        ],
        verbatim_arguments: true,
    })
}

/// `quoteWindowsBatchArgument(value)`: cmd expands percent variables even
/// inside quotes, and embedded quotes can end a quoted word. Unsupported
/// inputs are refused instead of executing altered argv.
pub fn quote_windows_batch_argument(value: &str) -> AgentResult<String> {
    if value.contains(['"', '%', '\r', '\n', '\0']) {
        return Err(AgentError::new(
            "This Windows batch entrypoint cannot preserve the requested argument. Use a native executable.",
        ));
    }
    Ok(format!("\"{value}\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_plans_quote_paths_disable_expansion_and_native_plans_preserve_argv() {
        let environment = EnvMap::from([("SystemRoot".into(), r"C:\Windows".into())]);
        assert_eq!(
            resolve_process_invocation(
                r"C:\CLI tools\codex.cmd",
                &["--version".into()],
                "win32",
                &environment
            )
            .unwrap(),
            ProcessInvocation {
                file: r"C:\Windows\System32\cmd.exe".into(),
                args: [
                    "/d",
                    "/s",
                    "/v:off",
                    "/c",
                    r#"""C:\CLI tools\codex.cmd" "--version"""#
                ]
                .map(String::from)
                .into(),
                verbatim_arguments: true,
            }
        );
        for platform in ["win32", "linux", "darwin"] {
            let file = if platform == "win32" {
                r"C:\tools\codex.exe"
            } else {
                "/tools/codex"
            };
            let args = vec!["a b".into(), "&literal".into()];
            assert_eq!(
                resolve_process_invocation(file, &args, platform, &environment).unwrap(),
                ProcessInvocation {
                    file: file.into(),
                    args,
                    verbatim_arguments: false
                }
            );
        }
    }

    #[test]
    fn batch_plans_reject_paths_and_arguments_cmd_cannot_preserve() {
        for file in [r"C:\%expanded%\codex.cmd", "C:\\bad\"path\\codex.cmd"] {
            assert!(
                resolve_process_invocation(file, &[], "win32", &EnvMap::new())
                    .unwrap_err()
                    .message
                    .contains("cannot preserve")
            );
        }
        for argument in ["%PATH%", "a\"b", "a\rb", "a\nb", "a\0b"] {
            assert!(
                resolve_process_invocation(
                    r"C:\tools\codex.cmd",
                    &[argument.into()],
                    "win32",
                    &EnvMap::new()
                )
                .is_err()
            );
        }
    }
}
