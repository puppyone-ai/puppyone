//! `electron.cloud-publish-git-credentials`: the URL-scoped credential
//! saga against real `git config`. The system keychain is never touched: a
//! private `store` file stands in for the secure helper the snapshot names.
use super::*;
use std::panic::{AssertUnwindSafe, catch_unwind};

const REMOTE: &str = "https://api.puppyone.ai/git/project-1.git";
const OPERATION: &str = "11111111-1111-4111-8111-111111111111";

#[cfg(unix)]
const GIT_BIN: &str = "/usr/bin/git";
#[cfg(not(unix))]
const GIT_BIN: &str = "git";

fn git(root: &Path, args: &[&str]) {
    let out = std::process::Command::new(GIT_BIN)
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(out.status.success(), "{args:?}");
}
fn values(root: &Path, key: &str) -> Vec<String> {
    let out = std::process::Command::new(GIT_BIN)
        .args(["config", "--local", "--get-all", key])
        .current_dir(root)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::to_owned)
        .collect()
}
fn helper(root: &Path) -> Vec<String> {
    values(root, &format!("credential.{REMOTE}.helper"))
}
/// A pending operation's credential state, its snapshot taken now; `store`
/// replaces the secure helper the snapshot chose.
fn pending(root: &Path, store: &Path) -> Record {
    let default_helper = if crate::platform::os::Os::current().is_macos() {
        None
    } else if crate::platform::os::Os::current().is_windows() {
        Some("manager".into())
    } else {
        Some("libsecret".into())
    };
    let cli = Cli {
        helper: default_helper,
    };
    let commit = cli.source_commit(root, "main").unwrap();
    let mut record = super::super::initial_record(&request(root), "fixture", &commit);
    record.operation_id = OPERATION.into();
    record.project_id = Some("project-1".into());
    record.credential_id = Some("credential-1".into());
    record.canonical_remote_url = Some(REMOTE.into());
    record.credential_username = Some(api::GIT_USERNAME.into());
    let mut config = cli
        .prepare_credential_config(root, REMOTE, OPERATION)
        .unwrap();
    config.helper = format!("store --file={}", store.display());
    record.credential_config_snapshot = Some(config);
    record
}
fn config(record: &Record) -> &journal::CredentialConfig {
    record.credential_config_snapshot.as_ref().unwrap()
}

#[test]
fn an_unknown_helper_is_reset_only_for_the_canonical_url_and_restored_on_abandon() {
    let temp = repository();
    let root = temp.path();
    let store = tempfile::tempdir().unwrap();
    git(
        root,
        &[
            "config",
            "--local",
            "--add",
            "credential.helper",
            "!malicious-capture",
        ],
    );
    git(
        root,
        &[
            "config",
            "--local",
            "--add",
            &format!("credential.{REMOTE}.helper"),
            "store --file=/tmp/old",
        ],
    );
    git(
        root,
        &[
            "config",
            "--local",
            "--add",
            &format!("credential.{REMOTE}.useHttpPath"),
            "false",
        ],
    );
    // Only an allowlisted helper is chosen: macOS defaults to `osxkeychain`;
    // on Linux/Windows configure an allowlisted helper in local git config so
    // the URL-scoped snapshot/reset/restore saga runs against real `git config`.
    let expected_helper = if crate::platform::os::Os::current().is_macos() {
        "osxkeychain"
    } else if crate::platform::os::Os::current().is_windows() {
        git(
            root,
            &["config", "--local", "--add", "credential.helper", "manager"],
        );
        "manager"
    } else {
        git(
            root,
            &[
                "config",
                "--local",
                "--add",
                "credential.helper",
                "libsecret",
            ],
        );
        "libsecret"
    };
    let snapshot = Cli { helper: None }
        .prepare_credential_config(root, REMOTE, OPERATION)
        .unwrap();
    assert_eq!(snapshot.helper, expected_helper);
    assert_eq!(snapshot.previous_helpers, ["store --file=/tmp/old"]);
    assert_eq!(snapshot.previous_use_http_path, ["false"]);
    let record = pending(root, &store.path().join("credentials"));
    let cli = Cli { helper: None };
    cli.approve(root, &record, "pwg_top_secret").unwrap();
    assert_eq!(
        helper(root),
        ["".to_owned(), config(&record).helper.clone()]
    );
    let expected_general: Vec<String> = if crate::platform::os::Os::current().is_macos() {
        vec!["!malicious-capture".into()]
    } else {
        vec!["!malicious-capture".into(), expected_helper.into()]
    };
    assert_eq!(values(root, "credential.helper"), expected_general);
    // The secret goes to the pinned helper on standard input, never argv.
    let stored = std::fs::read_to_string(store.path().join("credentials")).unwrap();
    assert!(stored.contains("pwg_top_secret"));
    let args = git::secure_args(REMOTE, config(&record), &["credential", "approve"]).unwrap();
    assert!(args.contains(&format!("credential.{REMOTE}.helper=")));
    assert!(args.contains(&format!(
        "credential.{REMOTE}.helper={}",
        config(&record).helper
    )));
    assert!(!args.join(" ").contains("pwg_top_secret"));
    cli.cleanup(root, &record).unwrap();
    assert_eq!(helper(root), ["store --file=/tmp/old"]);
    assert_eq!(
        values(root, &format!("credential.{REMOTE}.useHttpPath")),
        ["false"]
    );
    assert_eq!(values(root, "credential.helper"), expected_general);
}

#[test]
fn detach_restores_the_values_that_were_there_before() {
    let temp = repository();
    let root = temp.path();
    let store = tempfile::tempdir().unwrap();
    git(
        root,
        &[
            "config",
            "--local",
            "--add",
            &format!("credential.{REMOTE}.helper"),
            "manager-core",
        ],
    );
    let record = pending(root, &store.path().join("credentials"));
    assert_eq!(config(&record).previous_helpers, ["manager-core"]);
    Cli { helper: None }
        .approve(root, &record, "pwg_detach")
        .unwrap();
    git(root, &["remote", "add", "puppyone", REMOTE]);
    git::detach(root, REMOTE, &git::reviewed_remotes(root)).unwrap();
    assert_eq!(helper(root), ["manager-core"]);
    assert!(values(root, &format!("credential.{REMOTE}.puppyonemanaged")).is_empty());
    assert!(values(root, &format!("credential.{REMOTE}.puppyonesnapshot")).is_empty());
    assert!(
        !std::fs::read_to_string(store.path().join("credentials"))
            .unwrap_or_default()
            .contains("pwg_detach"),
        "the credential is rejected"
    );
}

/// Shell and path helpers are never chosen and never receive the secret.
/// (Failing closed with no allowlisted helper is the Linux path; on macOS
/// the system keychain is always one.)
#[test]
fn shell_and_path_helpers_never_receive_the_secret() {
    let temp = repository();
    let root = temp.path();
    let store = tempfile::tempdir().unwrap();
    let captured = store.path().join("captured");
    let script = store.path().join("git-credential-evil");
    std::fs::write(
        &script,
        format!("#!/bin/sh\ntouch {}.path\n", captured.display()),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let shell = format!("!touch {}.shell; true", captured.display());
    git(
        root,
        &["config", "--local", "--add", "credential.helper", &shell],
    );
    git(
        root,
        &[
            "config",
            "--local",
            "--add",
            "credential.helper",
            script.to_str().unwrap(),
        ],
    );
    if crate::platform::os::Os::current().is_macos() {
        let snapshot = Cli { helper: None }
            .prepare_credential_config(root, REMOTE, OPERATION)
            .unwrap();
        assert_eq!(snapshot.helper, "osxkeychain");
    } else {
        // Without a configured allowlisted helper, non-macOS fails closed
        // rather than accepting shell or arbitrary path helpers.
        let err = Cli { helper: None }
            .prepare_credential_config(root, REMOTE, OPERATION)
            .unwrap_err();
        assert_eq!(err.code, Code::RemoteConfigFailed);
    }
    let record = pending(root, &store.path().join("credentials"));
    Cli { helper: None }
        .approve(root, &record, "pwg_never_shared")
        .unwrap();
    for kind in ["shell", "path"] {
        assert!(
            !store.path().join(format!("captured.{kind}")).exists(),
            "the {kind} helper ran"
        );
    }
    assert_eq!(
        values(root, "credential.helper"),
        [shell, script.display().to_string()]
    );
}

#[test]
fn an_oversized_snapshot_is_refused_before_the_config_changes() {
    let temp = repository();
    let root = temp.path();
    for index in 0..20 {
        git(
            root,
            &[
                "config",
                "--local",
                "--add",
                &format!("credential.{REMOTE}.helper"),
                &format!("{index}-{}", "x".repeat(4_080)),
            ],
        );
    }
    let before = helper(root);
    let error = Cli { helper: None }
        .prepare_credential_config(root, REMOTE, OPERATION)
        .unwrap_err();
    assert_eq!(error.code, Code::RemoteConfigFailed);
    assert_eq!(helper(root), before);
    assert!(values(root, &format!("credential.{REMOTE}.puppyonemanaged")).is_empty());
}

#[test]
fn a_helper_that_cannot_read_the_credential_back_fails_closed_and_restores() {
    let temp = repository();
    let root = temp.path();
    let store = tempfile::tempdir().unwrap();
    let mut record = pending(root, &store.path().join("credentials"));
    // A helper that accepts the credential and never returns it.
    record.credential_config_snapshot.as_mut().unwrap().helper =
        "!f() { cat >/dev/null; }; f".into();
    let error = Cli { helper: None }
        .approve(root, &record, "pwg_must_not_appear_in_error")
        .unwrap_err();
    assert_eq!(error.code, Code::RemoteConfigFailed);
    assert!(!error.message.contains("pwg_"));
    assert!(helper(root).is_empty());
    assert!(values(root, &format!("credential.{REMOTE}.puppyonemanaged")).is_empty());
}

#[test]
fn commands_stay_pinned_and_a_concurrent_local_change_is_detected() {
    let temp = repository();
    let root = temp.path();
    let store = tempfile::tempdir().unwrap();
    let record = pending(root, &store.path().join("credentials"));
    Cli { helper: None }
        .approve(root, &record, "pwg_race")
        .unwrap();
    git::assert_managed(root, config(&record), OPERATION).unwrap();
    git(
        root,
        &[
            "config",
            "--local",
            "--replace-all",
            &format!("credential.{REMOTE}.helper"),
            "!malicious-capture",
        ],
    );
    let command = git::secure_args(REMOTE, config(&record), &["ls-remote", REMOTE]).unwrap();
    assert!(command.contains(&format!("credential.{REMOTE}.helper=")));
    assert!(!command.join(" ").contains("malicious-capture"));
    assert_eq!(
        git::assert_managed(root, config(&record), OPERATION)
            .unwrap_err()
            .code,
        Code::RemoteConfigFailed
    );
}

#[test]
fn a_restore_cut_short_resumes_its_multi_value_writes() {
    let temp = repository();
    let root = temp.path();
    let store = tempfile::tempdir().unwrap();
    for value in ["store", "cache"] {
        git(
            root,
            &[
                "config",
                "--local",
                "--add",
                &format!("credential.{REMOTE}.helper"),
                value,
            ],
        );
    }
    let record = pending(root, &store.path().join("credentials"));
    let cli = Cli { helper: None };
    cli.approve(root, &record, "pwg_resume").unwrap();
    // The process stopped halfway through putting ["store", "cache"] back.
    git(
        root,
        &[
            "config",
            "--local",
            "--unset-all",
            &format!("credential.{REMOTE}.helper"),
        ],
    );
    git(
        root,
        &[
            "config",
            "--local",
            "--add",
            &format!("credential.{REMOTE}.helper"),
            "store",
        ],
    );
    cli.cleanup(root, &record).unwrap();
    assert_eq!(helper(root), ["store", "cache"]);
    assert!(values(root, &format!("credential.{REMOTE}.puppyonemanaged")).is_empty());
    assert!(values(root, &format!("credential.{REMOTE}.puppyonesnapshot")).is_empty());
}

/// Every successful config write is a crash boundary of install and of
/// restore; the next attempt always ends with the person's values back.
#[test]
fn every_config_write_crash_point_recovers() {
    for phase in ["install", "restore"] {
        let mut boundaries = 0;
        for crash_after in 1.. {
            let temp = repository();
            let root = temp.path();
            let store = tempfile::tempdir().unwrap();
            for (key, value) in [
                ("helper", "store"),
                ("helper", "cache"),
                ("useHttpPath", "false"),
                ("useHttpPath", "legacy"),
            ] {
                git(
                    root,
                    &[
                        "config",
                        "--local",
                        "--add",
                        &format!("credential.{REMOTE}.{key}"),
                        value,
                    ],
                );
            }
            let record = pending(root, &store.path().join("credentials"));
            let cli = Cli { helper: None };
            if phase == "restore" {
                cli.approve(root, &record, "pwg_stable").unwrap();
            }
            git::CRASH_AFTER_WRITES.with(|left| left.set(Some(crash_after)));
            let interrupted = catch_unwind(AssertUnwindSafe(|| match phase {
                "install" => cli.approve(root, &record, "pwg_crash"),
                _ => cli.cleanup(root, &record),
            }));
            git::CRASH_AFTER_WRITES.with(|left| left.set(None));
            match interrupted {
                Err(stop) => {
                    assert!(stop.downcast_ref::<git::ConfigCrash>().is_some());
                    boundaries += 1;
                }
                // Past the last write: every boundary was tried.
                Ok(result) => {
                    result.unwrap();
                    break;
                }
            }
            if phase == "install" {
                cli.approve(root, &record, "pwg_resume").unwrap();
                git::assert_managed(root, config(&record), OPERATION).unwrap();
            }
            cli.cleanup(root, &record).unwrap();
            assert_eq!(
                helper(root),
                ["store", "cache"],
                "{phase} after {crash_after}"
            );
            assert_eq!(
                values(root, &format!("credential.{REMOTE}.useHttpPath")),
                ["false", "legacy"],
                "{phase} after {crash_after}"
            );
        }
        assert!(boundaries >= 6, "{phase}: {boundaries} crash points");
    }
}
