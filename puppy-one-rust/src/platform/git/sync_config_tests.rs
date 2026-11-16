//! Real Git acceptance with process-local, disposable configuration. No test
//! changes the parent process environment or the developer's Git preferences.
use super::super::{Operation, git, operate};
use super::*;
use crate::platform::process::{self, OutputLimits, OutputOptions};
use std::{path::PathBuf, time::Duration};

fn isolated(name: &str, test: impl FnOnce()) {
    let name = name.split_once("::").unwrap().1;
    if std::env::var("PUPPYONE_SYNC_CONFIG_FIXTURE").as_deref() == Ok(name) {
        test();
        return;
    }
    let executable = std::env::current_exe().unwrap();
    let output = process::run_output_with(
        &executable,
        &[name, "--exact", "--nocapture", "--test-threads=1"],
        &std::env::current_dir().unwrap(),
        None,
        Duration::from_secs(90),
        &AtomicBool::new(false),
        OutputOptions {
            limits: OutputLimits {
                stdout: 128 * 1024,
                stderr: 128 * 1024,
            },
            environment: &[
                ("PUPPYONE_SYNC_CONFIG_FIXTURE", name),
                ("GIT_CONFIG_NOSYSTEM", "1"),
                ("GIT_CONFIG_GLOBAL", "/dev/null"),
                ("GIT_CONFIG_COUNT", "0"),
                ("GIT_EDITOR", "true"),
            ],
        },
    )
    .unwrap_or_else(|error| panic!("isolated Git acceptance failed: {error}"));
    let output = String::from_utf8(output.stdout).unwrap();
    assert!(output.contains("1 passed; 0 failed; 0 ignored"), "{output}");
}

fn run(root: &Path, args: &[&str]) -> String {
    String::from_utf8(git(root, args, None, &AtomicBool::new(false)).unwrap())
        .unwrap()
        .trim()
        .to_owned()
}

fn identity(root: &Path) {
    for (key, value) in [
        ("user.name", "Sync fixture"),
        ("user.email", "sync@example.invalid"),
        ("commit.gpgsign", "false"),
        ("core.editor", "true"),
    ] {
        run(root, &["config", key, value]);
    }
}

fn commit(root: &Path, name: &str, value: &str) -> String {
    std::fs::write(root.join(name), value).unwrap();
    run(root, &["add", "--", name]);
    run(root, &["commit", "-qm", name]);
    run(root, &["rev-parse", "HEAD"])
}

struct Repositories {
    _directory: tempfile::TempDir,
    root: PathBuf,
    bare: PathBuf,
    peer: PathBuf,
}
impl Repositories {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("work");
        let bare = directory.path().join("remote.git");
        let peer = directory.path().join("peer");
        run(directory.path(), &["init", "-q", "-b", "main", "work"]);
        identity(&root);
        commit(&root, "base.txt", "base\n");
        run(
            directory.path(),
            &["init", "-q", "--bare", "-b", "main", "remote.git"],
        );
        run(
            &root,
            &["remote", "add", "puppyone", bare.to_str().unwrap()],
        );
        run(&root, &["push", "-qu", "puppyone", "main"]);
        run(
            directory.path(),
            &["clone", "-q", bare.to_str().unwrap(), "peer"],
        );
        identity(&peer);
        Self {
            _directory: directory,
            root,
            bare,
            peer,
        }
    }
    fn diverge(&self) -> (String, String) {
        let local = commit(&self.root, "local.txt", "local\n");
        let incoming = commit(&self.peer, "incoming.txt", "remote\n");
        run(&self.peer, &["push", "-q"]);
        (local, incoming)
    }
}

#[test]
fn explicit_merge_policy_keeps_both_original_parents() {
    isolated(
        concat!(
            module_path!(),
            "::explicit_merge_policy_keeps_both_original_parents"
        ),
        || {
            for key in ["pull.rebase", "branch.main.rebase"] {
                let repos = Repositories::new();
                run(&repos.root, &["config", "pull.rebase", "true"]);
                run(&repos.root, &["config", key, "false"]);
                let (local, incoming) = repos.diverge();
                operate(&repos.root, &Operation::Pull, &AtomicBool::new(false)).unwrap();
                assert_eq!(
                    run(&repos.root, &["show", "-s", "--format=%P", "HEAD"]),
                    format!("{local} {incoming}")
                );
                assert_eq!(run(&repos.bare, &["rev-parse", "main"]), incoming);
            }
        },
    );
}

#[test]
fn empty_push_remote_is_rejected_before_publication() {
    isolated(
        concat!(
            module_path!(),
            "::empty_push_remote_is_rejected_before_publication"
        ),
        || {
            for key in ["remote.pushDefault", "branch.main.pushRemote"] {
                let repos = Repositories::new();
                run(&repos.root, &["branch", "--unset-upstream"]);
                run(&repos.root, &["config", key, ""]);
                let before = run(&repos.bare, &["rev-parse", "main"]);
                commit(&repos.root, "private.txt", "unpublished\n");
                let result = operate(&repos.root, &Operation::Publish, &AtomicBool::new(false));
                assert!(result.is_err(), "empty {key} incorrectly published");
                assert!(result.unwrap_err().contains("push remote is empty"));
                assert_eq!(run(&repos.bare, &["rev-parse", "main"]), before);
            }
        },
    );
}

#[test]
fn defaults_apply_only_when_all_relevant_policy_keys_are_absent() {
    assert_eq!(
        Config::parse(b"").pull_policy("feature/work"),
        ["--rebase", "--autostash"]
    );
    for key in ["branch.feature/work.rebase", "pull.rebase", "pull.ff"] {
        for value in ["false", "", "only"] {
            let bytes = format!("{key}\n{value}\0");
            assert_eq!(
                Config::parse(bytes.as_bytes()).pull_policy("feature/work"),
                ["--autostash"],
                "{key}={value}"
            );
        }
    }
    for key in ["rebase.autostash", "merge.autostash", "pull.autostash"] {
        for value in ["false", "true", ""] {
            let bytes = format!("{key}\n{value}\0");
            assert_eq!(
                Config::parse(bytes.as_bytes()).pull_policy("feature/work"),
                ["--rebase"],
                "{key}={value}"
            );
        }
    }
    assert!(
        Config::parse(b"pull.ff\nonly\0rebase.autostash\nfalse\0")
            .pull_policy("main")
            .is_empty()
    );
    // Branch subsections are case-sensitive and unrelated policy stays unrelated.
    assert_eq!(
        Config::parse(b"branch.Feature.rebase\nfalse\0").pull_policy("feature"),
        ["--rebase", "--autostash"]
    );
}

#[test]
fn real_configuration_preserves_includes_empty_values_and_multivars() {
    isolated(
        concat!(
            module_path!(),
            "::real_configuration_preserves_includes_empty_values_and_multivars"
        ),
        || {
            let repos = Repositories::new();
            let included = repos._directory.path().join("included.config");
            std::fs::write(
                &included,
                "[pull]\n rebase = false\n[rebase]\n autoStash = false\n",
            )
            .unwrap();
            run(
                &repos.root,
                &[
                    "config",
                    "includeIf.onbranch:main.path",
                    included.to_str().unwrap(),
                ],
            );
            run(
                &repos.root,
                &["config", "--add", "fixture.repeated", "first\nline"],
            );
            run(&repos.root, &["config", "--add", "fixture.repeated", ""]);
            let config = Config::load(&repos.root, &AtomicBool::new(false)).unwrap();
            assert!(config.pull_policy("main").is_empty());
            assert_eq!(config.get("fixture.repeated"), Some(""));
            assert_eq!(config.all("fixture.repeated"), Some("first\nline\n".into()));
            run(&repos.root, &["switch", "-qc", "Feature"]);
            let config = Config::load(&repos.root, &AtomicBool::new(false)).unwrap();
            assert_eq!(config.pull_policy("Feature"), ["--rebase", "--autostash"]);
            run(&repos.root, &["config", "branch.Feature.rebase", "false"]);
            run(&repos.root, &["config", "rebase.autoStash", "false"]);
            let config = Config::load(&repos.root, &AtomicBool::new(false)).unwrap();
            assert!(config.pull_policy("Feature").is_empty());
            assert_eq!(config.pull_policy("feature"), ["--rebase"]);
        },
    );
}

#[test]
fn configuration_errors_and_cancellation_cannot_become_absence() {
    isolated(
        concat!(
            module_path!(),
            "::configuration_errors_and_cancellation_cannot_become_absence"
        ),
        || {
            let repos = Repositories::new();
            let cancelled = AtomicBool::new(true);
            assert!(
                Config::load(&repos.root, &cancelled)
                    .err()
                    .unwrap()
                    .contains("cancelled")
            );
            assert!(binding(&repos.root, &cancelled).is_err());
            assert!(pull_args(&repos.root, &cancelled).is_err());
            let cancel = AtomicBool::new(false);
            assert!(Config::load(&repos.root.join("missing-directory"), &cancel).is_err());
            let config = repos.root.join(".git/config");
            let before = std::fs::read(&config).unwrap();
            std::fs::write(&config, b"[broken configuration\n").unwrap();
            for error in [
                Config::load(&repos.root, &cancel).err(),
                binding(&repos.root, &cancel).err(),
                pull_args(&repos.root, &cancel).err(),
            ] {
                assert!(error.unwrap().contains("bad config line"));
            }
            std::fs::write(config, before).unwrap();
            assert!(Config::load(&repos.root, &cancel).is_ok());
        },
    );
}

#[test]
fn incomplete_or_ambiguous_upstreams_cannot_publish_to_a_fallback() {
    isolated(
        concat!(
            module_path!(),
            "::incomplete_or_ambiguous_upstreams_cannot_publish_to_a_fallback"
        ),
        || {
            let cases: &[&[(&str, &str)]] = &[
                &[("branch.main.remote", "removed")],
                &[("branch.main.remote", "")],
                &[("branch.main.merge", "refs/heads/topic")],
                &[
                    ("branch.main.remote", "puppyone"),
                    ("branch.main.merge", "refs/tags/tag"),
                ],
                &[
                    ("branch.main.remote", "puppyone"),
                    ("branch.main.merge", "refs/heads/one\nrefs/heads/two"),
                ],
                &[
                    ("branch.main.remote", "puppyone"),
                    ("branch.main.merge", "refs/heads/one"),
                    ("branch.main.merge", "refs/heads/two"),
                ],
                &[
                    ("branch.main.remote", ""),
                    ("branch.main.merge", "refs/heads/main"),
                ],
            ];
            for settings in cases {
                let repos = Repositories::new();
                run(&repos.root, &["branch", "--unset-upstream"]);
                for (key, value) in *settings {
                    run(&repos.root, &["config", "--add", key, value]);
                }
                let before = run(&repos.bare, &["rev-parse", "main"]);
                let local = commit(&repos.root, "local.txt", "unpublished\n");
                let configuration = std::fs::read(repos.root.join(".git/config")).unwrap();
                let cancel = AtomicBool::new(false);
                assert!(
                    binding(&repos.root, &cancel)
                        .err()
                        .unwrap()
                        .contains("upstream")
                );
                assert!(
                    operate(&repos.root, &Operation::Publish, &cancel).is_err(),
                    "{settings:?}"
                );
                assert_eq!(run(&repos.bare, &["rev-parse", "main"]), before);
                assert_eq!(run(&repos.root, &["rev-parse", "HEAD"]), local);
                assert_eq!(
                    std::fs::read(repos.root.join(".git/config")).unwrap(),
                    configuration
                );
            }
        },
    );
}

#[test]
fn default_pull_rebases_and_restores_dirty_and_untracked_files() {
    isolated(
        concat!(
            module_path!(),
            "::default_pull_rebases_and_restores_dirty_and_untracked_files"
        ),
        || {
            let repos = Repositories::new();
            let (local, incoming) = repos.diverge();
            std::fs::write(repos.root.join("base.txt"), "private dirty bytes\n").unwrap();
            std::fs::write(
                repos.root.join("untracked.txt"),
                "private untracked bytes\n",
            )
            .unwrap();
            let snapshot = operate(&repos.root, &Operation::Pull, &AtomicBool::new(false)).unwrap();
            assert_ne!(run(&repos.root, &["rev-parse", "HEAD"]), local);
            assert_eq!(
                run(&repos.root, &["show", "-s", "--format=%P", "HEAD"]),
                incoming
            );
            assert_eq!((snapshot.ahead, snapshot.behind), (1, 0));
            assert!(snapshot.operation.is_none());
            for (file, text) in [
                ("base.txt", "private dirty bytes\n"),
                ("untracked.txt", "private untracked bytes\n"),
                ("local.txt", "local\n"),
                ("incoming.txt", "remote\n"),
            ] {
                assert_eq!(
                    std::fs::read_to_string(repos.root.join(file)).unwrap(),
                    text
                );
            }
            assert_eq!(run(&repos.root, &["stash", "list"]), "");
            assert_eq!(run(&repos.bare, &["rev-parse", "main"]), incoming);
            assert_eq!(
                run(&repos.root, &["rev-parse", "--abbrev-ref", "@{u}"]),
                "puppyone/main"
            );
        },
    );
}

#[test]
fn explicit_autostash_false_leaves_dirty_work_and_commits_untouched() {
    isolated(
        concat!(
            module_path!(),
            "::explicit_autostash_false_leaves_dirty_work_and_commits_untouched"
        ),
        || {
            for key in ["rebase.autoStash", "merge.autoStash", "pull.autoStash"] {
                let repos = Repositories::new();
                run(&repos.root, &["config", key, "false"]);
                let (local, incoming) = repos.diverge();
                std::fs::write(repos.root.join("base.txt"), "keep my edit\n").unwrap();
                let dirty = run(&repos.root, &["status", "--porcelain"]);
                let error =
                    operate(&repos.root, &Operation::Pull, &AtomicBool::new(false)).unwrap_err();
                assert!(
                    error.contains("unstaged changes") || error.contains("uncommitted changes"),
                    "{key}: {error}"
                );
                assert_eq!(run(&repos.root, &["rev-parse", "HEAD"]), local);
                assert_eq!(run(&repos.bare, &["rev-parse", "main"]), incoming);
                assert_eq!(run(&repos.root, &["status", "--porcelain"]), dirty);
                assert_eq!(
                    std::fs::read_to_string(repos.root.join("base.txt")).unwrap(),
                    "keep my edit\n"
                );
                assert_eq!(run(&repos.root, &["stash", "list"]), "");
            }
        },
    );
}

#[test]
fn ff_only_and_stale_push_preserve_exact_refs_worktree_and_upstream() {
    isolated(
        concat!(
            module_path!(),
            "::ff_only_and_stale_push_preserve_exact_refs_worktree_and_upstream"
        ),
        || {
            let repos = Repositories::new();
            let initial = run(&repos.bare, &["rev-parse", "main"]);
            run(&repos.root, &["switch", "-qc", "feature/race"]);
            run(&repos.root, &["push", "-qu", "puppyone", "feature/race"]);
            run(&repos.peer, &["fetch", "-q", "origin"]);
            run(
                &repos.peer,
                &["switch", "-q", "--track", "origin/feature/race"],
            );
            run(&repos.root, &["config", "pull.ff", "only"]);
            let (local, incoming) = repos.diverge();
            std::fs::write(repos.root.join("base.txt"), "keep dirty\n").unwrap();
            std::fs::write(repos.root.join("private.txt"), "keep private\n").unwrap();
            let dirty = run(&repos.root, &["status", "--porcelain"]);
            for operation in [Operation::Push, Operation::Pull] {
                assert!(operate(&repos.root, &operation, &AtomicBool::new(false)).is_err());
                assert_eq!(run(&repos.root, &["rev-parse", "HEAD"]), local);
                assert_eq!(run(&repos.bare, &["rev-parse", "feature/race"]), incoming);
                assert_eq!(run(&repos.bare, &["rev-parse", "main"]), initial);
                assert_eq!(run(&repos.root, &["status", "--porcelain"]), dirty);
                assert_eq!(
                    run(&repos.root, &["rev-parse", "--abbrev-ref", "@{u}"]),
                    "puppyone/feature/race"
                );
                assert_eq!(
                    std::fs::read_to_string(repos.root.join("base.txt")).unwrap(),
                    "keep dirty\n"
                );
                assert_eq!(
                    std::fs::read_to_string(repos.root.join("private.txt")).unwrap(),
                    "keep private\n"
                );
            }
        },
    );
}

#[test]
fn pull_target_uses_upstream_or_current_branch_and_never_push_preferences() {
    isolated(
        concat!(
            module_path!(),
            "::pull_target_uses_upstream_or_current_branch_and_never_push_preferences"
        ),
        || {
            let repos = Repositories::new();
            let cancel = AtomicBool::new(false);
            run(
                &repos.root,
                &["remote", "add", "outbound", repos.bare.to_str().unwrap()],
            );
            run(
                &repos.root,
                &["config", "branch.main.pushRemote", "outbound"],
            );
            assert_eq!(
                pull_args(&repos.root, &cancel).unwrap(),
                ["pull", "--rebase", "--autostash", "puppyone", "main"]
            );
            run(
                &repos.root,
                &["config", "branch.main.merge", "refs/heads/release/work"],
            );
            assert_eq!(
                pull_args(&repos.root, &cancel).unwrap().last().unwrap(),
                "release/work"
            );
            run(&repos.root, &["config", "branch.main.remote", "removed"]);
            assert!(
                pull_args(&repos.root, &cancel)
                    .unwrap_err()
                    .contains("not configured")
            );
            run(&repos.root, &["switch", "-qc", "feature/current"]);
            assert_eq!(
                pull_args(&repos.root, &cancel).unwrap(),
                [
                    "pull",
                    "--rebase",
                    "--autostash",
                    "puppyone",
                    "feature/current"
                ]
            );
            run(&repos.root, &["switch", "--detach", "-q"]);
            let initial = run(&repos.bare, &["rev-parse", "main"]);
            assert!(
                pull_args(&repos.root, &cancel)
                    .unwrap_err()
                    .contains("not on a branch")
            );
            assert!(
                super::super::status(&repos.root, &cancel)
                    .unwrap()
                    .target
                    .is_none()
            );
            assert!(operate(&repos.root, &Operation::Push, &cancel).is_err());
            assert_eq!(run(&repos.bare, &["rev-parse", "main"]), initial);
        },
    );
}

#[test]
fn hosted_push_honors_every_upstream_name_without_changing_either_main() {
    isolated(
        concat!(
            module_path!(),
            "::hosted_push_honors_every_upstream_name_without_changing_either_main"
        ),
        || {
            for remote in ["origin", "puppyone", "team/cloud"] {
                let repos = Repositories::new();
                let origin = repos._directory.path().join("origin.git");
                run(
                    repos._directory.path(),
                    &["init", "-q", "--bare", "-b", "main", "origin.git"],
                );
                run(
                    &repos.root,
                    &["remote", "add", "origin", origin.to_str().unwrap()],
                );
                run(&repos.root, &["push", "-q", "origin", "main"]);
                if remote == "team/cloud" {
                    run(
                        &repos.root,
                        &["remote", "add", remote, repos.bare.to_str().unwrap()],
                    );
                }
                let initial = run(&repos.root, &["rev-parse", "HEAD"]);
                run(&repos.root, &["switch", "-qc", "feature/work"]);
                run(
                    &repos.root,
                    &["push", "-qu", remote, "HEAD:refs/heads/release/one"],
                );
                std::fs::create_dir(repos.root.join(".puppyone")).unwrap();
                std::fs::write(repos.root.join(".puppyone/config.json"), r#"{"sync":{"sourceOfTruth":{"service":"puppyone","remote":"puppyone","branch":"main"}}}"#).unwrap();
                let head = commit(&repos.root, "work.txt", "private branch work\n");
                let snapshot =
                    operate(&repos.root, &Operation::Push, &AtomicBool::new(false)).unwrap();
                let destination = if remote == "origin" {
                    &origin
                } else {
                    &repos.bare
                };
                assert_eq!(run(destination, &["rev-parse", "release/one"]), head);
                for bare in [&origin, &repos.bare] {
                    assert_eq!(run(bare, &["rev-parse", "main"]), initial);
                }
                assert_eq!(
                    run(&repos.root, &["rev-parse", "--abbrev-ref", "@{u}"]),
                    format!("{remote}/release/one")
                );
                let target = snapshot.target.unwrap();
                assert_eq!(
                    (target.remote.as_str(), target.branch.as_str()),
                    (remote, "release/one")
                );
            }
        },
    );
}

#[test]
fn checkout_during_publication_cannot_change_the_upload_or_rebind_either_branch() {
    isolated(
        concat!(
            module_path!(),
            "::checkout_during_publication_cannot_change_the_upload_or_rebind_either_branch"
        ),
        || {
            use std::os::unix::fs::PermissionsExt;
            let repos = Repositories::new();
            let initial = run(&repos.bare, &["rev-parse", "main"]);
            run(&repos.root, &["switch", "-qc", "feature/captured"]);
            let captured = commit(&repos.root, "captured.txt", "authorized upload\n");
            let marker = repos.bare.join("receiving");
            let release = repos.bare.join("release");
            let hook = repos.bare.join("hooks/pre-receive");
            std::fs::write(&hook, "#!/bin/sh\ntouch receiving\ni=0\nwhile [ ! -f release ] && [ \"$i\" -lt 200 ]; do sleep 0.05; i=$((i+1)); done\ntest -f release\n").unwrap();
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
            // Release even if an assertion fails while the upload is in flight.
            struct Release(PathBuf);
            impl Drop for Release {
                fn drop(&mut self) {
                    let _ = std::fs::write(&self.0, "release");
                }
            }
            let (later, outcome) = std::thread::scope(|scope| {
                let pending = scope
                    .spawn(|| operate(&repos.root, &Operation::Publish, &AtomicBool::new(false)));
                let release_guard = Release(release);
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                while !marker.exists() {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "owned receive hook did not start"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                run(&repos.root, &["switch", "-qc", "another-branch"]);
                let later = commit(&repos.root, "later.txt", "not authorized by the push\n");
                drop(release_guard);
                (later, pending.join().unwrap())
            });
            assert!(outcome.unwrap_err().contains(
                "Push completed for the captured commit, but local branch state changed"
            ));
            assert_eq!(
                run(&repos.bare, &["rev-parse", "feature/captured"]),
                captured
            );
            assert_eq!(run(&repos.bare, &["rev-parse", "main"]), initial);
            assert_eq!(run(&repos.root, &["rev-parse", "HEAD"]), later);
            assert_eq!(
                run(&repos.root, &["branch", "--show-current"]),
                "another-branch"
            );
            assert!(
                !run(
                    &repos.bare,
                    &["ls-tree", "-r", "--name-only", "feature/captured"]
                )
                .contains("later.txt")
            );
            for branch in ["feature/captured", "another-branch"] {
                assert!(
                    git(
                        &repos.root,
                        &["config", "--get", &format!("branch.{branch}.remote")],
                        None,
                        &AtomicBool::new(false)
                    )
                    .is_err()
                );
            }
        },
    );
}
