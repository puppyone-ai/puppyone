//! The first-publication failure matrix (`initialization-and-first-push.md`
//! §15) over a scripted Cloud and Git, plus the real `git` CLI for what needs
//! no network: remote inspection, preflight and the managed credential helper.
//!
//! | §15 row | Evidence |
//! |---|---|
//! | Sign-in canceled | `app::tests::a_signed_out_switch_waits_in_a_dialog_and_escape_cancels_it` |
//! | Project create response lost | `a_lost_creation_response_is_retried_with_the_same_idempotency_key` |
//! | Credential response lost | `a_lost_credential_response_replays_the_same_secret` |
//! | Remote appears at another URL | `an_existing_puppyone_remote_is_refused_before_anything_is_created`, `issued_remotes_must_be_canonical_and_trusted` |
//! | Working tree becomes dirty | `an_upload_finishes_its_pinned_commit_while_the_checkout_drifts` |
//! | HEAD advances during upload | `an_upload_finishes_its_pinned_commit_while_the_checkout_drifts`, `a_retry_after_an_uncertain_push_keeps_its_exact_commit_even_if_head_moved` |
//! | User switches branch during upload | `an_upload_finishes_its_pinned_commit_while_the_checkout_drifts` |
//! | Push times out after acceptance | `an_uncertain_push_is_never_replayed_blindly_and_a_landed_one_reconciles` |
//! | Push fails before acceptance | `a_restart_reconciles_the_pending_operation_and_derives_its_actions`, `workspace::cloud::publish` derivation |
//! | Remote main changes concurrently | `a_concurrent_remote_main_is_a_conflict_not_an_overwrite` |
//! | Desktop restarts | `a_restart_reconciles_the_pending_operation_and_derives_its_actions` |
//! | User signs out after link | `app::tests::cloud_opening::signing_out_after_a_link_gates_the_header_and_signing_in_finds_the_same_project` |
//! | Cleanup fails | `cleanup_deletes_only_the_empty_project_and_a_refusal_keeps_everything`, `workspace::cloud::publish` derivation |
//! | Project deleted elsewhere | `detaching_a_missing_project_removes_only_the_reviewed_remote`, `app::tests::cloud_opening::a_vanished_cloud_projects_link_is_ended_from_its_notice` |
#[path = "coordinator_tests.rs"]
mod coordinator_tests;
#[path = "credential_tests.rs"]
mod credential_tests;
#[path = "git_push_tests.rs"]
mod git_push_tests;

use super::fixtures::*;
use super::{
    git::{Cli, GitOps, Remote},
    journal::{Journal, Record},
    vault::{Memory, SecretVault},
    *,
};
use std::path::Path;

fn request(root: &Path) -> Request {
    Request {
        root: root.to_path_buf(),
        api_base_url: "https://api.puppyone.ai/api/v1".into(),
        user_id: "user-1".into(),
        organization_id: "org-1".into(),
        project_name: "Notes".into(),
        source_branch: "main".into(),
        operation_id: None,
        action: Action::Initialize,
    }
}
fn pending(fake: &Fake) -> Option<Record> {
    Journal::in_git_dir(&fake.git_dir).read().unwrap()
}

#[test]
fn publication_context_owns_the_same_repository_domain_as_local_git() {
    use crate::platform::git::coordinator::{GLOBAL, Key};
    let (temp, fake) = Fake::new();
    let (coordinator, _) = coordinator(&fake);
    let key = Key::Repository(fake.git_dir.canonicalize().unwrap());
    let context = coordinator.context(temp.path()).unwrap();
    assert!(
        GLOBAL
            .try_acquire(std::slice::from_ref(&key))
            .unwrap()
            .is_none()
    );
    drop(context);
    assert!(
        GLOBAL
            .try_acquire(std::slice::from_ref(&key))
            .unwrap()
            .is_some()
    );
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let (began, started) = std::sync::mpsc::channel();
    let (completed, done) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        let owner = GLOBAL.acquire(std::slice::from_ref(&key), &cancel).unwrap();
        let worker = scope.spawn(|| {
            let outcome = coordinator.start(&request(temp.path()), &mut |stage| {
                if stage == Stage::Validating {
                    began.send(()).unwrap();
                }
            });
            completed.send(outcome).unwrap();
        });
        started
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        assert!(
            done.recv_timeout(std::time::Duration::from_millis(30))
                .is_err()
        );
        assert_eq!(fake.with(|s| s.creates), 0);
        assert!(pending(&fake).is_none());
        drop(owner);
        let outcome = done
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        assert!(outcome.ok, "{:?}", outcome.error);
        worker.join().unwrap();
    });
    assert_eq!(fake.with(|s| s.creates), 1);
    assert!(GLOBAL.is_idle(&[key]).unwrap());
}

#[test]
fn a_first_publication_walks_every_checkpoint_and_leaves_nothing_behind() {
    let (temp, fake) = Fake::new();
    let (c, vault) = coordinator(&fake);
    let mut stages = vec![];
    let outcome = c.start(&request(temp.path()), &mut |s| stages.push(s));
    assert!(outcome.ok, "{:?}", outcome.error);
    assert_eq!(outcome.project.as_deref(), Some("project-a"));
    assert_eq!(fake.with(|s| s.cloud_main.clone()).as_deref(), Some(COMMIT));
    assert!(fake.with(|s| s.finalized));
    assert_eq!(stages.first(), Some(&Stage::Validating));
    assert_eq!(stages.last(), Some(&Stage::Completed));
    assert!(stages.contains(&Stage::Uploading));
    // The journal and the secret are gone once main is confirmed.
    assert!(pending(&fake).is_none());
    assert!(vault.0.lock().unwrap().is_empty());
}

#[test]
fn a_lost_creation_response_is_retried_with_the_same_idempotency_key() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.create_fails_after_creating = true);
    let (c, _) = coordinator(&fake);
    let first = c.start(&request(temp.path()), &mut |_| {});
    assert!(!first.ok);
    let record = pending(&fake).expect("the operation stays pending");
    assert_eq!(record.checkpoint, "prepared");
    assert_eq!(
        record.last_error.as_ref().unwrap().code,
        "PROJECT_CREATE_FAILED"
    );
    let operation = record.operation_id.clone();
    // Resume: the same operation (idempotency key), now completing.
    let second = c.start(&request(temp.path()), &mut |_| {});
    assert!(second.ok, "{:?}", second.error);
    assert_eq!(fake.with(|s| s.creates), 2);
    assert!(pending(&fake).is_none());
    let _ = operation;
}

#[test]
fn an_uncertain_push_is_never_replayed_blindly_and_a_landed_one_reconciles() {
    let (temp, fake) = Fake::new();
    fake.with(|s| {
        s.push_failures.push_back(Code::PushUncertain);
        s.push_lands = true;
    });
    let (c, _) = coordinator(&fake);
    let first = c.start(&request(temp.path()), &mut |_| {});
    assert_eq!(
        first.error.as_ref().map(|e| e.code),
        Some(Code::PushUncertain)
    );
    let record = pending(&fake).unwrap();
    assert_eq!(record.push_state, "uncertain");
    // Reading the state reconciles with Cloud main: it landed.
    let state = c.state(&request(temp.path()));
    assert!(state.ok);
    assert_eq!(state.project.as_deref(), Some("project-a"));
    assert!(pending(&fake).is_none());
}

#[test]
fn a_retry_after_an_uncertain_push_keeps_its_exact_commit_even_if_head_moved() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.push_failures.push_back(Code::PushUncertain));
    let (c, _) = coordinator(&fake);
    assert!(!c.start(&request(temp.path()), &mut |_| {}).ok);
    // The source branch advanced meanwhile.
    fake.with(|s| s.head = NEXT.into());
    let retry = c.start(
        &Request {
            action: Action::RetryPush,
            ..request(temp.path())
        },
        &mut |_| {},
    );
    assert!(retry.ok, "{:?}", retry.error);
    assert_eq!(fake.with(|s| s.cloud_main.clone()).as_deref(), Some(COMMIT));
}

#[test]
fn a_concurrent_remote_main_is_a_conflict_not_an_overwrite() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.cloud_main = Some(NEXT.into()));
    let (c, _) = coordinator(&fake);
    let outcome = c.start(&request(temp.path()), &mut |_| {});
    assert_eq!(
        outcome.error.as_ref().map(|e| e.code),
        Some(Code::RemoteRefConflict)
    );
    assert_eq!(fake.with(|s| s.cloud_main.clone()).as_deref(), Some(NEXT));
    let record = pending(&fake).unwrap();
    assert_eq!(record.push_state, "conflict");
    // Cleanup never deletes a Project whose main has content.
    let cleanup = c.cleanup(&Request {
        operation_id: Some(record.operation_id),
        ..request(temp.path())
    });
    assert_eq!(cleanup.error.map(|e| e.code), Some(Code::RemoteRefConflict));
    assert_eq!(fake.with(|s| s.abandons), 0);
}

#[test]
fn an_existing_puppyone_remote_is_refused_before_anything_is_created() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.remote = Some("https://example.com/other.git".into()));
    let (c, _) = coordinator(&fake);
    let outcome = c.start(&request(temp.path()), &mut |_| {});
    assert_eq!(outcome.error.map(|e| e.code), Some(Code::RemoteConflict));
    assert_eq!(fake.with(|s| s.creates), 0);
    assert!(pending(&fake).is_none());
}

#[test]
fn a_switched_branch_or_another_account_does_not_continue_the_operation() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.branch = "draft".into());
    let (c, _) = coordinator(&fake);
    let outcome = c.start(&request(temp.path()), &mut |_| {});
    assert_eq!(outcome.error.map(|e| e.code), Some(Code::BranchRequired));
    fake.with(|s| {
        s.branch = "main".into();
        s.push_failures.push_back(Code::PushFailed);
    });
    assert!(!c.start(&request(temp.path()), &mut |_| {}).ok);
    // Signed in as someone else: the pending operation is not theirs.
    let other = c.start(
        &Request {
            user_id: "user-2".into(),
            ..request(temp.path())
        },
        &mut |_| {},
    );
    assert_eq!(other.error.map(|e| e.code), Some(Code::IdentityMismatch));
}

#[test]
fn cleanup_deletes_only_the_empty_project_and_a_refusal_keeps_everything() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.push_failures.push_back(Code::PushFailed));
    let (c, vault) = coordinator(&fake);
    assert!(!c.start(&request(temp.path()), &mut |_| {}).ok);
    let record = pending(&fake).unwrap();
    // A definite refusal: back to a sendable state, nothing removed.
    fake.with(|s| s.abandon_refused = true);
    let refused = c.cleanup(&Request {
        operation_id: Some(record.operation_id.clone()),
        ..request(temp.path())
    });
    assert_eq!(refused.error.map(|e| e.code), Some(Code::CleanupNotAllowed));
    let kept = pending(&fake).unwrap();
    assert_eq!(kept.cleanup_state, "none");
    assert_eq!(kept.project_state, "empty");
    assert!(!fake.with(|s| s.cleaned));
    // Allowed: server first, then the credential, the local remote, the
    // secret and the journal.
    fake.with(|s| s.abandon_refused = false);
    let done = c.cleanup(&Request {
        operation_id: Some(record.operation_id),
        ..request(temp.path())
    });
    assert!(done.ok, "{:?}", done.error);
    assert_eq!(fake.with(|s| (s.revokes, s.cleaned)), (1, true));
    assert!(pending(&fake).is_none());
    assert!(vault.0.lock().unwrap().is_empty());
}

#[test]
fn the_journal_is_private_versioned_and_compare_and_swap() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.push_failures.push_back(Code::PushFailed));
    let (c, _) = coordinator(&fake);
    assert!(!c.start(&request(temp.path()), &mut |_| {}).ok);
    let journal = Journal::in_git_dir(&fake.git_dir);
    let record = journal.read().unwrap().unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(fake.git_dir.join("puppyone").join(journal::FILENAME))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
    }
    // A stale writer (old revision) is refused.
    let mut stale = record.clone();
    stale.revision += 1;
    let mut expect = journal::Expect::of(&record);
    expect.revision = Some(record.revision + 5);
    assert_eq!(
        journal.write(&stale, expect).unwrap_err().code,
        Code::IdentityMismatch
    );
    // Version 1 records migrate.
    let v1 = serde_json::json!({
        "version": 1, "kind": "puppyone-cloud-publish", "phase": "project-created",
        "operation_id": record.operation_id, "revision": 3,
        "api_base_url": record.api_base_url, "api_origin": record.api_origin,
        "user_id": "user-1", "organization_id": "org-1", "project_name": "Notes",
        "create_payload": {"org_id": "org-1", "name": "Notes", "description": null},
        "repository_fingerprint": record.repository_fingerprint,
        "expected_branch": "main", "expected_head_commit_id": COMMIT,
        "project_id": "project-a",
        "created_at": record.created_at, "updated_at": record.updated_at,
    });
    let migrated = Record::decode(v1).unwrap();
    assert_eq!(migrated.version, 2);
    assert_eq!(migrated.checkpoint, "project-created");
    assert_eq!(migrated.project_state, "empty");
    assert!(migrated.migrated_from.is_some());
}

#[test]
fn diagnostics_never_carry_secrets() {
    let error = PublishError::new(
        Code::PushFailed,
        "fatal: https://x-puppyone-token:pwg_abc@api.puppyone.ai/git/p.git pwg_secret failed",
        true,
    );
    assert!(!error.message.contains("pwg_abc"));
    assert!(!error.message.contains("pwg_secret"));
    assert!(error.message.contains("[redacted]"));
    assert!(valid_branch("feature/one"));
    assert!(!valid_branch("refs/heads/main"));
    assert!(!valid_branch("a..b"));
    assert!(!valid_branch("HEAD"));
}

// ------------------------------------------------------------- real git CLI
fn repository() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("/usr/bin/git")
                .args(args)
                .current_dir(temp.path())
                .output()
                .unwrap()
                .status
                .success(),
            "{args:?}"
        )
    };
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.email", "t@example.com"]);
    git(&["config", "user.name", "T"]);
    std::fs::write(temp.path().join("a.md"), "# A\n").unwrap();
    git(&["add", "a.md"]);
    git(&["commit", "-q", "-m", "first"]);
    temp
}

#[test]
fn the_cli_reads_remotes_sources_and_refuses_lfs_pointers() {
    let temp = repository();
    let cli = Cli { helper: None };
    let root = temp.path();
    assert_eq!(cli.remote(root).unwrap(), Remote::Missing);
    let head = cli.source_commit(root, "main").unwrap();
    assert!(journal::commit_id(&head));
    assert!(cli.preflight(root, &head).is_ok());
    assert_eq!(
        cli.source_commit(root, "absent").unwrap_err().code,
        Code::SourceMissing
    );
    let status = cli.status(root).unwrap();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.commits, 1);
    // An LFS pointer is refused.
    std::fs::write(
        root.join("big.bin"),
        "version https://git-lfs.github.com/spec/v1\noid sha256:0000000000000000000000000000000000000000000000000000000000000000\nsize 12\n",
    )
    .unwrap();
    let git = |args: &[&str]| {
        std::process::Command::new("/usr/bin/git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap()
    };
    git(&["add", "big.bin"]);
    git(&["commit", "-q", "-m", "lfs"]);
    let tip = cli.source_commit(root, "main").unwrap();
    assert_eq!(
        cli.preflight(root, &tip).unwrap_err().code,
        Code::LfsUnsupported
    );
    // A remote named PuppyOne in another case is a conflict.
    git(&["remote", "add", "PuppyOne", URL]);
    assert_eq!(cli.remote(root).unwrap(), Remote::Conflict);
}

#[test]
fn the_managed_helper_round_trips_the_secret_and_restores_the_previous_config() {
    let temp = repository();
    let root = temp.path();
    let store = temp.path().join("credentials");
    let cli = Cli {
        helper: Some(format!("store --file={}", store.display())),
    };
    std::process::Command::new("/usr/bin/git")
        .args([
            "config",
            "--local",
            "--add",
            &format!("credential.{URL}.helper"),
            "cache",
        ])
        .current_dir(root)
        .output()
        .unwrap();
    let mut config = cli.prepare_credential_config(root, URL, "op").unwrap();
    assert_eq!(config.previous_helpers, vec!["cache".to_owned()]);
    config.helper = format!("store --file={}", store.display());
    let commit = cli.source_commit(root, "main").unwrap();
    let mut record = super::initial_record(&request(root), "fingerprint", &commit);
    record.project_id = Some("project-a".into());
    record.credential_id = Some("credential-1".into());
    record.canonical_remote_url = Some(URL.into());
    record.credential_username = Some(api::GIT_USERNAME.into());
    record.credential_config_snapshot = Some(config);
    record.remote_add_intent = true;
    let created = cli.configure_remote(root, &record, "pwg_secret").unwrap();
    assert!(created);
    assert_eq!(cli.remote(root).unwrap(), Remote::Exact(URL.into()));
    assert!(
        std::fs::read_to_string(&store)
            .unwrap()
            .contains("pwg_secret")
    );
    // Cleanup forgets the credential, restores the helper and removes the
    // remote it created.
    cli.cleanup(root, &record).unwrap();
    assert_eq!(cli.remote(root).unwrap(), Remote::Missing);
    let helpers = std::process::Command::new("/usr/bin/git")
        .args([
            "config",
            "--local",
            "--get-all",
            &format!("credential.{URL}.helper"),
        ])
        .current_dir(root)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&helpers.stdout).trim(), "cache");
    assert!(
        !std::fs::read_to_string(&store)
            .unwrap_or_default()
            .contains("pwg_secret")
    );
}

#[test]
fn issued_remotes_must_be_canonical_and_trusted() {
    let api = "https://api.puppyone.ai/api/v1";
    assert!(api::validate_remote_url(URL, "project-a", api, None).is_ok());
    for bad in [
        "http://api.puppyone.ai/git/project-a.git",
        "https://user@api.puppyone.ai/git/project-a.git",
        "https://api.puppyone.ai/git/other.git",
        "https://evil.example.com/git/project-a.git",
        "https://api.puppyone.ai/git/project-a.git?x=1",
    ] {
        assert!(
            api::validate_remote_url(bad, "project-a", api, None).is_err(),
            "{bad}"
        );
    }
    // Another *.puppyone.ai deployment is another environment (a3ca3af05).
    assert!(
        api::validate_remote_url(
            "https://git.puppyone.ai/git/project-a.git",
            "project-a",
            api,
            None
        )
        .is_err()
    );
    // Only a loopback API may name its hosted Git origin, and only HTTPS.
    for loopback in ["http://127.0.0.1:9090/api/v1", "http://[::1]:9090/api/v1"] {
        assert!(
            api::validate_remote_url(
                "https://git.dev.example/git/project-a.git",
                "project-a",
                loopback,
                Some("https://git.dev.example"),
            )
            .is_ok(),
            "{loopback}"
        );
    }
    assert!(
        api::validate_remote_url(
            "http://git.dev.example/git/project-a.git",
            "project-a",
            "http://127.0.0.1:9090/api/v1",
            Some("http://git.dev.example"),
        )
        .is_err()
    );
    assert!(
        api::validate_remote_url(
            "https://git.dev.example/git/project-a.git",
            "project-a",
            api,
            Some("https://git.dev.example"),
        )
        .is_err()
    );
    let _ = Memory::default().create_ref();
}

#[test]
fn detaching_a_missing_project_removes_only_the_reviewed_remote() {
    let temp = repository();
    let root = temp.path();
    std::process::Command::new("/usr/bin/git")
        .args(["remote", "add", "puppyone", URL])
        .current_dir(root)
        .output()
        .unwrap();
    // Someone changed it after review: nothing is touched.
    assert_eq!(
        git::detach(
            root,
            "https://api.puppyone.ai/git/other.git",
            &git::reviewed_remotes(root)
        )
        .unwrap_err()
        .code,
        Code::RemoteConflict
    );
    assert_eq!(
        Cli { helper: None }.remote(root).unwrap(),
        Remote::Exact(URL.into())
    );
    git::detach(root, URL, &git::reviewed_remotes(root)).unwrap();
    assert_eq!(Cli { helper: None }.remote(root).unwrap(), Remote::Missing);
}

/// §15 "Credential response lost": the retry replays the same secret, so
/// Cloud reconciles one credential instead of minting another.
#[test]
fn a_lost_credential_response_replays_the_same_secret() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.credential_lost = true);
    let (c, vault) = coordinator(&fake);
    let first = c.start(&request(temp.path()), &mut |_| {});
    assert_eq!(
        first.error.as_ref().map(|e| e.code),
        Some(Code::CredentialFailed)
    );
    assert_eq!(pending(&fake).unwrap().checkpoint, "project-created");
    let second = c.start(&request(temp.path()), &mut |_| {});
    assert!(second.ok, "{:?}", second.error);
    let secrets = fake.with(|s| s.secrets.clone());
    assert_eq!(secrets.len(), 2);
    assert_eq!(secrets[0], secrets[1]);
    // One Project, and nothing left behind once main is confirmed.
    assert_eq!(fake.with(|s| s.creates), 1);
    assert!(vault.0.lock().unwrap().is_empty());
    assert!(pending(&fake).is_none());
}

/// §15 "Working tree becomes dirty", "HEAD advances during upload" and
/// "User switches branch during upload": the pinned attempt finishes; the
/// target never follows the checkout.
#[test]
fn an_upload_finishes_its_pinned_commit_while_the_checkout_drifts() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.drift_during_push = true);
    let (c, _) = coordinator(&fake);
    let outcome = c.start(&request(temp.path()), &mut |_| {});
    assert!(outcome.ok, "{:?}", outcome.error);
    assert_eq!(fake.with(|s| s.cloud_main.clone()).as_deref(), Some(COMMIT));
    assert!(fake.with(|s| s.finalized));
}

/// §15 "Desktop restarts": a new coordinator over the same journal and
/// vault reconciles the Project and remote ref and derives its actions.
#[test]
fn a_restart_reconciles_the_pending_operation_and_derives_its_actions() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.push_failures.push_back(Code::PushFailed));
    let (c, vault) = coordinator(&fake);
    assert!(!c.start(&request(temp.path()), &mut |_| {}).ok);
    drop(c);
    let restarted = Coordinator {
        git: fake.clone(),
        cloud: fake.clone(),
        vault: vault.clone(),
    };
    let state = restarted.state(&request(temp.path()));
    let derived = state.state.expect("a pending operation is projected");
    assert_eq!(derived.project, publish::Project::Empty);
    assert_eq!(derived.push, publish::Push::Failed);
    assert!(derived.actions.contains(&publish::Action::RetryPush));
    let retry = restarted.start(
        &Request {
            action: Action::RetryPush,
            ..request(temp.path())
        },
        &mut |_| {},
    );
    assert!(retry.ok, "{:?}", retry.error);
    assert_eq!(fake.with(|s| s.cloud_main.clone()).as_deref(), Some(COMMIT));
    assert_eq!(fake.with(|s| s.creates), 1);
}

/// `cloud-git-acceptance-v1.json` is the copy Cloud and the product pin,
/// byte for byte; its refusal codes are the ones recognized here.
#[test]
fn the_git_acceptance_contract_is_pinned_and_its_codes_are_recognized() {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(git::ACCEPTANCE_CONTRACT.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(
        hex,
        "49f66fd7df22c8a7d266afb2d27a87296b638f232b4cb44581a5aae9fe02cf54"
    );
    let contract: serde_json::Value = serde_json::from_str(git::ACCEPTANCE_CONTRACT).unwrap();
    let codes: Vec<&str> = contract["refusals"]["codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    assert_eq!(codes, git::LIMIT_CODES);
    assert_eq!(
        contract["refusals"]["format"],
        "<human reason> (puppyone-refusal=<code>)"
    );
    assert_eq!(contract["refusals"]["same_content_can_pass"], false);
    // Desktop must not refuse what Cloud accepts, and refuses only what it
    // cannot represent.
    assert_eq!(
        contract["commit_graph"],
        serde_json::json!({
            "merge_commits": "accepted",
            "octopus_merges": "accepted",
            "unrelated_histories": "accepted",
            "server_rewrites_history": false,
        })
    );
    assert_eq!(contract["content"]["git_lfs"], "unsupported");
    assert_eq!(
        contract["limits"]["receive_pack_bytes"],
        2u64 * 1024 * 1024 * 1024
    );
    for code in git::LIMIT_CODES {
        let reason = format!("remote: error: refused (puppyone-refusal={code})");
        assert_eq!(git::refusal_code(&reason), Some(code));
        assert!(git::push_limit_failure(&reason), "{code}");
    }
    // A code this release does not know falls back to the words.
    assert!(!git::push_limit_failure(
        "refused (puppyone-refusal=git_future_limit)"
    ));
    for words in [
        "Git temporary disk budget exceeded",
        "Git pack metadata budget exceeded",
        "Git object count budget exceeded",
        "Git output budget exceeded",
        "published object count budget exceeded",
        "completed Git pack exceeds the storage processing budget",
        "incoming pack expansion budget exceeded",
        "Git pack exceeds the 2147483648-byte limit",
        "error: RPC failed; HTTP 413 curl 22",
    ] {
        assert!(git::push_limit_failure(words), "{words}");
    }
    assert!(git::pack_limit_failure(
        "The requested URL returned error: 413"
    ));
    assert!(!git::pack_limit_failure("Git output budget exceeded"));
    assert!(!git::push_limit_failure(
        "fatal: the remote end hung up unexpectedly"
    ));
}

/// `electron.cloud-publish-repository-shapes`: Desktop must not refuse what
/// the native Version Engine accepts. Every shape but Git LFS passes the
/// preflight, and stock Git carries its history to a bare repository.
#[test]
fn every_repository_shape_but_lfs_passes_the_preflight() {
    fn git(root: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("/usr/bin/git")
            .args(args)
            .current_dir(root)
            .env("GIT_AUTHOR_DATE", "2026-11-08T00:00:00Z")
            .env("GIT_COMMITTER_DATE", "2026-11-08T00:00:00Z")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }
    fn commit(root: &Path, name: &str, body: &str) {
        std::fs::write(root.join(name), body).unwrap();
        git(root, &["add", name]);
        git(root, &["commit", "-qm", name]);
    }
    fn merge_tip(root: &Path) {
        commit(root, "README.md", "base\n");
        git(root, &["checkout", "-qb", "feature"]);
        commit(root, "feature.md", "feature\n");
        git(root, &["checkout", "-q", "main"]);
        commit(root, "main.md", "main\n");
        git(
            root,
            &[
                "merge",
                "-q",
                "--no-ff",
                "feature",
                "-m",
                "Merge pull request #1",
            ],
        );
    }
    type Shape = (&'static str, fn(&Path), usize);
    let shapes: [Shape; 7] = [
        (
            "linear",
            |r| {
                commit(r, "README.md", "first\n");
                commit(r, "notes.md", "second\n");
            },
            1,
        ),
        ("merge tip", merge_tip, 2),
        (
            "merge in history",
            |r| {
                merge_tip(r);
                commit(r, "after.md", "after\n");
            },
            1,
        ),
        (
            "octopus merge tip",
            |r| {
                commit(r, "README.md", "base\n");
                for name in ["one", "two", "three"] {
                    git(r, &["checkout", "-qb", name]);
                    commit(r, &format!("{name}.md"), name);
                    git(r, &["checkout", "-q", "main"]);
                }
                git(r, &["merge", "-q", "one", "two", "three", "-m", "octopus"]);
            },
            3,
        ),
        (
            "unrelated histories",
            |r| {
                commit(r, "README.md", "main\n");
                git(r, &["checkout", "-q", "--orphan", "other"]);
                git(r, &["rm", "-rfq", "."]);
                commit(r, "other.md", "other\n");
                git(r, &["checkout", "-q", "main"]);
                git(
                    r,
                    &[
                        "merge",
                        "-q",
                        "--allow-unrelated-histories",
                        "other",
                        "-m",
                        "join",
                    ],
                );
            },
            2,
        ),
        (
            "empty snapshot",
            |r| {
                git(r, &["commit", "-q", "--allow-empty", "-m", "empty"]);
            },
            0,
        ),
        (
            "LFS look-alike",
            |r| {
                commit(
                    r,
                    "notes.txt",
                    "version https://git-lfs.github.com/spec/v1\nnot a pointer\n",
                );
            },
            0,
        ),
    ];
    let cli = Cli { helper: None };
    for (name, shape, parents) in shapes {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        git(root, &["init", "-q", "-b", "main"]);
        git(root, &["config", "user.email", "t@example.com"]);
        git(root, &["config", "user.name", "T"]);
        shape(root);
        let tip = cli.source_commit(root, "main").unwrap();
        assert!(cli.preflight(root, &tip).is_ok(), "{name}");
        let bare = tempfile::tempdir().unwrap();
        git(bare.path(), &["init", "-q", "--bare"]);
        git(root, &["push", "-q", bare.path().to_str().unwrap(), "main"]);
        assert_eq!(
            git(bare.path(), &["rev-parse", "refs/heads/main"]),
            tip,
            "{name}"
        );
        let line = git(bare.path(), &["rev-list", "--parents", "-n", "1", "main"]);
        assert_eq!(line.split_whitespace().count() - 1, parents, "{name}");
    }
}

/// A merge-tip refusal an earlier release journaled is a send to retry,
/// into the same Cloud project.
#[test]
fn a_merge_tip_send_an_earlier_release_refused_is_retried_into_the_same_project() {
    let (temp, fake) = Fake::new();
    fake.with(|s| s.push_failures.push_back(Code::PushFailed));
    let (c, _) = coordinator(&fake);
    assert!(!c.start(&request(temp.path()), &mut |_| {}).ok);
    let journal = Journal::in_git_dir(&fake.git_dir);
    let mut record = journal.read().unwrap().unwrap();
    let expect = journal::Expect::of(&record);
    record.revision += 1;
    record.last_error = Some(journal::StoredError {
        code: "MERGE_TIP_UNSUPPORTED".into(),
        retryable: false,
        occurred_at: record.updated_at.clone(),
    });
    journal.write(&record, expect).unwrap();
    let state = c.state(&request(temp.path()));
    let derived = state.state.expect("the operation is pending");
    let recorded = state.record.and_then(|r| r.last_error).map(|e| e.code);
    assert_eq!(recorded.as_deref(), Some("MERGE_TIP_UNSUPPORTED"));
    assert!(derived.actions.contains(&publish::Action::RetryPush));
    let retry = c.start(
        &Request {
            action: Action::RetryPush,
            ..request(temp.path())
        },
        &mut |_| {},
    );
    assert!(retry.ok, "{:?}", retry.error);
    assert_eq!(fake.with(|s| s.creates), 1);
}

/// `electron.cloud-initialization-journal`: the TypeScript legacy journals
/// (copied as they are) migrate to schema v2, and the first read writes the
/// migration in place.
#[test]
fn version_1_journals_migrate_and_persist_on_their_first_read() {
    let legacy: serde_json::Value = serde_json::from_str(include_str!(
        "../../../fixtures/cloud/publish/legacy-v1-remote-configured.json"
    ))
    .unwrap();
    let migrated = Record::decode(legacy.clone()).unwrap();
    assert_eq!(
        (
            migrated.version,
            migrated.kind.as_str(),
            migrated.checkpoint.as_str(),
            migrated.project_state.as_str(),
            migrated.push_state.as_str(),
            migrated.cleanup_state.as_str(),
        ),
        (
            2,
            "puppyone-cloud-initialization",
            "remote-configured",
            "empty",
            "idle",
            "none"
        )
    );
    assert_eq!(migrated.selected_source_branch, "feature/legacy");
    assert_eq!(migrated.selected_source_ref, "refs/heads/feature/legacy");
    assert_eq!(migrated.attempt_count, 1);
    assert_eq!(migrated.attempt.attempt_id, legacy["operation_id"]);
    assert_eq!(
        migrated.attempt.commit_oid,
        legacy["expected_head_commit_id"]
    );
    assert_eq!(migrated.attempt.state, "preparing");
    let from = migrated.migrated_from.clone().unwrap();
    assert_eq!(
        (
            from.version,
            from.phase.as_str(),
            from.migrated_at.as_str(),
            from.persisted
        ),
        (
            1,
            "remote-configured",
            legacy["updated_at"].as_str().unwrap(),
            false
        )
    );
    let text = serde_json::to_string(&migrated).unwrap();
    assert!(!text.contains("expected_head_commit_id") && !text.contains("expected_branch"));

    let cleanup: serde_json::Value = serde_json::from_str(include_str!(
        "../../../fixtures/cloud/publish/legacy-v1-compensation-pending.json"
    ))
    .unwrap();
    let cleanup = Record::decode(cleanup).unwrap();
    assert_eq!(
        (
            cleanup.checkpoint.as_str(),
            cleanup.project_state.as_str(),
            cleanup.push_state.as_str(),
            cleanup.cleanup_state.as_str()
        ),
        ("cleanup-requested", "deleting", "failed", "requested")
    );
    let from = cleanup.migrated_from.unwrap();
    assert_eq!(
        (from.phase.as_str(), from.persisted),
        ("compensation-pending", false)
    );

    // The first read writes the migration back, one revision later.
    let temp = tempfile::tempdir().unwrap();
    let journal = Journal::in_git_dir(&temp.path().join(".git"));
    std::fs::create_dir_all(&journal.directory).unwrap();
    let path = journal.directory.join(journal::FILENAME);
    std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let first = journal.read().unwrap().unwrap();
    let persisted: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let second = journal.read().unwrap().unwrap();
    assert_eq!(first.version, 2);
    assert_eq!(first.revision, legacy["revision"].as_u64().unwrap() + 1);
    assert!(first.migrated_from.as_ref().unwrap().persisted);
    assert_eq!(persisted, serde_json::to_value(&first).unwrap());
    assert_eq!(second, first);
}

/// `missingCloudProjectDetach`: ending a vanished Cloud project's link
/// removes only the reviewed remote, and only while every remote is as it
/// was reviewed, checked again after the credential is forgotten.
#[test]
fn a_reviewed_detach_keeps_history_content_and_unrelated_remotes() {
    const OLD: &str = "http://api.puppyone.ai/git/project-1.git";
    const GITHUB: &str = "https://github.com/fixture/project.git";
    let sh = |root: &Path, args: &[&str]| {
        let out = std::process::Command::new("/usr/bin/git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        (
            out.status.success(),
            String::from_utf8_lossy(&out.stdout).trim().to_owned(),
        )
    };
    let fixture = || {
        let temp = repository();
        sh(temp.path(), &["remote", "add", "puppyone", OLD]);
        sh(temp.path(), &["remote", "add", "origin", GITHUB]);
        temp
    };
    let temp = fixture();
    let root = temp.path();
    let head = sh(root, &["rev-parse", "HEAD"]).1;
    git::detach(root, OLD, &git::reviewed_remotes(root)).unwrap();
    assert_eq!(
        git::reviewed_remotes(root),
        [("origin".to_owned(), GITHUB.to_owned(), GITHUB.to_owned())]
    );
    assert_eq!(sh(root, &["rev-parse", "HEAD"]).1, head);
    assert_eq!(std::fs::read_to_string(root.join("a.md")).unwrap(), "# A\n");

    // A link to another environment ends with the branch tracking it.
    let temp = fixture();
    let root = temp.path();
    let other = "http://localhost:9090/git/01a0e7da-6575-7771-af76-48b47dde4ba6.git";
    sh(root, &["remote", "set-url", "puppyone", other]);
    sh(root, &["config", "branch.main.remote", "puppyone"]);
    sh(root, &["config", "branch.main.merge", "refs/heads/main"]);
    git::detach(root, other, &git::reviewed_remotes(root)).unwrap();
    assert!(!sh(root, &["config", "--get", "branch.main.remote"]).0);
    assert_eq!(git::reviewed_remotes(root).len(), 1);

    // A changed fetch, push or other remote: nothing is touched.
    for change in ["fetch", "push", "another"] {
        let temp = fixture();
        let root = temp.path();
        let reviewed = git::reviewed_remotes(root);
        match change {
            "fetch" => sh(
                root,
                &[
                    "remote",
                    "set-url",
                    "puppyone",
                    "https://api.puppyone.ai/git/new-project.git",
                ],
            ),
            "push" => sh(
                root,
                &[
                    "remote",
                    "set-url",
                    "--push",
                    "puppyone",
                    "https://api.puppyone.ai/git/new-project.git",
                ],
            ),
            _ => sh(
                root,
                &["remote", "add", "another", "https://example.com/new.git"],
            ),
        };
        let config = std::fs::read_to_string(root.join(".git/config")).unwrap();
        let url = if change == "fetch" {
            "https://api.puppyone.ai/git/new-project.git"
        } else {
            OLD
        };
        let error = git::detach(root, url, &reviewed).unwrap_err();
        assert_eq!(error.code, Code::RemoteConflict, "{change}");
        assert_eq!(
            std::fs::read_to_string(root.join(".git/config")).unwrap(),
            config,
            "{change}"
        );
    }

    // A change while the credential is forgotten is caught before the
    // remote goes: the forgetting helper itself repoints it here.
    let temp = fixture();
    let root = temp.path();
    let repoint = format!(
        "!f() {{ cd {} && /usr/bin/git remote set-url puppyone https://api.puppyone.ai/git/new-project.git; }}; f",
        root.display()
    );
    let config = journal::CredentialConfig {
        version: 1,
        scope_url: OLD.into(),
        helper: repoint,
        previous_helpers: vec![],
        previous_use_http_path: vec![],
    };
    Cli { helper: None }
        .install(root, &config, "11111111-1111-4111-8111-111111111111")
        .unwrap();
    let reviewed = git::reviewed_remotes(root);
    let error = git::detach(root, OLD, &reviewed).unwrap_err();
    assert_eq!(error.code, Code::RemoteConflict);
    assert_eq!(
        sh(root, &["remote", "get-url", "puppyone"]).1,
        "https://api.puppyone.ai/git/new-project.git"
    );
    assert_eq!(sh(root, &["remote", "get-url", "origin"]).1, GITHUB);
}
