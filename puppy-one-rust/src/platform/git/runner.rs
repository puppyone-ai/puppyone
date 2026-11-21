//! Native counterpart of `electron/local-api/git/runner.mjs`. Command owners
//! choose read/mutation/network/clone budgets and only reads suppress optional
//! index refresh locks. Child-specific environment never leaks to other tasks.
use crate::platform::process::{self, OutputLimits, OutputOptions};
use std::{path::Path, sync::atomic::AtomicBool, time::Duration};

pub const MAX_BUFFER: usize = 4 * 1024 * 1024;
pub(super) const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Read,
    Mutation,
    Network,
    Clone,
}
impl Kind {
    fn timeout(self) -> Duration {
        Duration::from_secs(match self {
            Self::Read => 5,
            Self::Mutation => 120,
            Self::Network => 60,
            Self::Clone => 600,
        })
    }
}

/// Platform-appropriate `git` executable path.
pub fn git_executable() -> &'static Path {
    #[cfg(windows)]
    {
        Path::new("git")
    }
    #[cfg(not(windows))]
    {
        Path::new("/usr/bin/git")
    }
}

pub(super) fn execute(
    root: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    cancel: &AtomicBool,
    kind: Kind,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let args = arguments(args);
    execute_prepared(
        root,
        Invocation {
            program: git_executable(),
            args: &args,
            environment: &[],
        },
        input,
        cancel,
        kind,
        max_bytes,
    )
}

/// Git options belong inside any OS sandbox wrapper, before the subcommand.
/// Paths remain literal even when a filename contains Git pathspec syntax.
pub fn arguments<'a>(args: &[&'a str]) -> Vec<&'a str> {
    let mut all = vec![
        "--literal-pathspecs",
        "-c",
        "color.ui=false",
        "-c",
        "core.quotepath=false",
        "-c",
        "core.pager=cat",
    ];
    all.extend(args);
    all
}

/// A command already wrapped by the owner's execution policy. The wrapper's
/// argv and environment are preserved; it cannot bypass the Git I/O budget.
pub struct Invocation<'a> {
    pub program: &'a Path,
    pub args: &'a [&'a str],
    pub environment: &'a [(&'a str, &'a str)],
}
pub fn execute_prepared(
    root: &Path,
    invocation: Invocation<'_>,
    input: Option<&[u8]>,
    cancel: &AtomicBool,
    kind: Kind,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut environment = invocation.environment.to_vec();
    environment.extend([("LANG", "C"), ("GCM_INTERACTIVE", "never")]);
    if kind == Kind::Read {
        environment.push(("GIT_OPTIONAL_LOCKS", "0"));
    }
    process::run_output_with(
        invocation.program,
        invocation.args,
        root,
        input,
        kind.timeout(),
        cancel,
        OutputOptions {
            limits: OutputLimits {
                stdout: max_bytes,
                stderr: MAX_BUFFER,
            },
            environment: &environment,
        },
    )
    .map(|result| result.stdout)
}

#[cfg(test)]
mod tests {
    use super::super::{git, git_read, git_read_bounded, status};
    use super::*;

    #[test]
    fn actual_git_stdin_and_binary_reads_preserve_bytes_and_domain_output_limits() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        git(dir.path(), &["init", "-q"], None, &cancel).unwrap();
        assert_eq!(
            git_read(
                dir.path(),
                &["hash-object", "--stdin"],
                Some(b"puppyone-credential-probe"),
                &cancel
            )
            .unwrap(),
            b"04fb22962ed642a59edde7609247cfb9127542cd\n"
        );
        // Above the ordinary command cap; Word revision reads own their
        // larger budget. NUL and invalid UTF-8 never pass through String.
        let bytes: Vec<u8> = (0..MAX_BUFFER + 17).map(|i| (i % 256) as u8).collect();
        let oid = git(
            dir.path(),
            &["hash-object", "-w", "--stdin"],
            Some(&bytes),
            &cancel,
        )
        .unwrap();
        let oid = std::str::from_utf8(&oid).unwrap().trim();
        assert!(git_read(dir.path(), &["cat-file", "blob", oid], None, &cancel).is_err());
        assert_eq!(
            git_read_bounded(
                dir.path(),
                &["cat-file", "blob", oid],
                None,
                &cancel,
                bytes.len()
            )
            .unwrap(),
            bytes
        );
    }

    #[cfg(unix)]
    #[test]
    fn optional_locks_apply_only_to_reads_and_the_child_environment_stays_isolated() {
        let dir = tempfile::tempdir().unwrap();
        let cancel = AtomicBool::new(false);
        let inherited = std::env::var("GIT_OPTIONAL_LOCKS").unwrap_or_else(|_| "unset".into());
        git(dir.path(), &["init", "-q"], None, &cancel).unwrap();
        let alias = "!printf '%s|%s|%s|%s|%s' \"$LC_ALL\" \"$LANG\" \"$GCM_INTERACTIVE\" \"$GIT_TERMINAL_PROMPT\" \"${GIT_OPTIONAL_LOCKS-unset}\"";
        git(
            dir.path(),
            &["config", "alias.native-env", alias],
            None,
            &cancel,
        )
        .unwrap();
        assert_eq!(
            git_read(dir.path(), &["native-env"], None, &cancel).unwrap(),
            b"C|C|never|0|0"
        );
        assert_eq!(
            git(dir.path(), &["native-env"], None, &cancel).unwrap(),
            format!("C|C|never|0|{inherited}").as_bytes()
        );
        assert_eq!(
            std::env::var("GIT_OPTIONAL_LOCKS").unwrap_or_else(|_| "unset".into()),
            inherited
        );
    }

    #[test]
    fn background_status_keeps_index_metadata_read_only_while_explicit_staging_updates_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let cancel = AtomicBool::new(false);
        git(root, &["init", "-q", "-b", "main"], None, &cancel).unwrap();
        git(root, &["config", "user.name", "Parity"], None, &cancel).unwrap();
        git(
            root,
            &["config", "user.email", "parity@example.invalid"],
            None,
            &cancel,
        )
        .unwrap();
        git(root, &["config", "commit.gpgsign", "false"], None, &cancel).unwrap();
        let file = root.join("tracked");
        std::fs::write(&file, b"unchanged content\n").unwrap();
        git(root, &["add", "tracked"], None, &cancel).unwrap();
        git(root, &["commit", "-qm", "initial"], None, &cancel).unwrap();
        let index = root.join(".git/index");
        let before = std::fs::read(&index).unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(std::time::UNIX_EPOCH + Duration::from_secs(1_000))
            .unwrap();
        assert!(status(root, &cancel).unwrap().changes.is_empty());
        assert_eq!(
            std::fs::read(&index).unwrap(),
            before,
            "background status must not take an optional index update"
        );
        git(root, &["add", "tracked"], None, &cancel).unwrap();
        assert_ne!(
            std::fs::read(&index).unwrap(),
            before,
            "explicit staging still updates the index"
        );
    }

    #[test]
    fn git_command_budgets_match_the_frozen_runner_and_cancel_before_spawning() {
        // Independent contract values from the pinned TS runner. Long-running
        // hooks must not inherit the status query's short deadline.
        for (kind, seconds) in [
            (Kind::Read, 5),
            (Kind::Mutation, 120),
            (Kind::Network, 60),
            (Kind::Clone, 600),
        ] {
            assert_eq!(kind.timeout(), Duration::from_secs(seconds));
        }
        assert_eq!(MAX_BUFFER, 4 * 1024 * 1024);
        assert_eq!(MAX_STREAM_BYTES, 8 * 1024 * 1024);
        let dir = tempfile::tempdir().unwrap();
        let result = execute(
            dir.path(),
            &["clone", "must-not-be-opened", "destination"],
            None,
            &AtomicBool::new(true),
            Kind::Clone,
            MAX_BUFFER,
        );
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(!dir.path().join("destination").exists());
    }
}
