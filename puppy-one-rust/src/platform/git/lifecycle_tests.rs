//! Exercise the native Git owner with disposable repositories and identities.
use super::*;
use crate::platform::{
    git_history,
    process::{self, OutputLimits, OutputOptions},
};
use std::time::Duration;

fn isolated(name: &str, test: impl FnOnce()) {
    let name = name.split_once("::").unwrap().1;
    if std::env::var("PUPPYONE_GIT_LIFECYCLE_FIXTURE").as_deref() == Ok(name) {
        test();
        return;
    }
    let output = process::run_output_with(
        &std::env::current_exe().unwrap(),
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
                ("PUPPYONE_GIT_LIFECYCLE_FIXTURE", name),
                ("GIT_CONFIG_NOSYSTEM", "1"),
                ("GIT_CONFIG_GLOBAL", "/dev/null"),
                ("GIT_CONFIG_COUNT", "0"),
                ("GIT_EDITOR", "true"),
            ],
        },
    )
    .unwrap_or_else(|error| panic!("isolated lifecycle acceptance failed: {error}"));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("1 passed; 0 failed; 0 ignored"), "{text}");
}
struct Repo(tempfile::TempDir);
impl Repo {
    fn new() -> Self {
        let repo = Self(tempfile::tempdir().unwrap());
        repo.apply(Operation::Init);
        for (key, value) in [
            ("user.name", "Lifecycle fixture"),
            ("user.email", "lifecycle@example.invalid"),
            ("commit.gpgsign", "false"),
            ("core.hooksPath", "/dev/null"),
        ] {
            repo.git(&["config", key, value]);
        }
        repo
    }
    fn git(&self, args: &[&str]) {
        git(self.0.path(), args, None, &AtomicBool::new(false)).unwrap();
    }
    fn apply(&self, operation: Operation) -> Snapshot {
        operate(self.0.path(), &operation, &AtomicBool::new(false)).unwrap()
    }
    fn state(&self) -> Snapshot {
        status(self.0.path(), &AtomicBool::new(false)).unwrap()
    }
    fn write(&self, name: &str, content: &str) {
        std::fs::write(self.0.path().join(name), content).unwrap();
    }
    fn history(&self) -> git_history::History {
        git_history::history(self.0.path(), &AtomicBool::new(false)).unwrap()
    }
    fn stage(&self, path: &str) -> Snapshot {
        let change = self
            .state()
            .changes
            .into_iter()
            .find(|change| change.path == path)
            .unwrap();
        self.apply(Operation::Stage(change))
    }
}

#[test]
fn plain_and_newly_initialized_repositories_have_no_invented_head_or_history() {
    isolated(
        concat!(
            module_path!(),
            "::plain_and_newly_initialized_repositories_have_no_invented_head_or_history"
        ),
        || {
            let dir = tempfile::tempdir().unwrap();
            let cancel = AtomicBool::new(false);
            let plain = repository_info(dir.path(), &cancel).unwrap();
            assert!(!plain.is_repo);
            assert!(plain.head.is_none() && plain.branch.is_none());
            assert_eq!((plain.local_branches, plain.remote_branches), (0, 0));
            assert!(plain.remotes.is_empty());
            let initialized = operate(dir.path(), &Operation::Init, &cancel).unwrap();
            assert!(!initialized.branch.is_empty());
            assert!(initialized.head.is_empty() && initialized.changes.is_empty());
            let info = repository_info(dir.path(), &cancel).unwrap();
            assert!(info.is_repo && info.head.is_none());
            assert_eq!(info.branch.as_deref(), Some(initialized.branch.as_str()));
            assert!(
                git_history::history(dir.path(), &cancel)
                    .unwrap()
                    .commits
                    .is_empty()
            );
        },
    );
}

#[test]
fn actual_stage_commit_lifecycle_preserves_unstaged_siblings_and_publishes_matching_history() {
    isolated(
        concat!(
            module_path!(),
            "::actual_stage_commit_lifecycle_preserves_unstaged_siblings_and_publishes_matching_history"
        ),
        || {
            let repo = Repo::new();
            repo.write("a.txt", "one\n");
            let state = repo.state();
            assert_eq!(state.changes.len(), 1);
            assert!(state.changes[0].untracked());
            let staged = repo.stage("a.txt");
            assert_eq!(staged.changes.len(), 1);
            assert!(staged.changes[0].staged() && !staged.changes[0].untracked());
            let first = repo.apply(Operation::Commit("first".into()));
            assert!(first.changes.is_empty());
            assert_eq!(first.head.len(), 40);
            let history = repo.history();
            assert_eq!(history.head.as_deref(), Some(first.head.as_str()));
            assert_eq!(history.commits.len(), 1);
            assert_eq!(history.commits[0].message, "first");
            repo.write("a.txt", "one\ntwo\n");
            repo.write("b.txt", "second file\n");
            let staged = repo.stage("b.txt");
            assert_eq!(staged.head, first.head);
            assert_eq!(staged.changes.len(), 2);
            let a = staged.changes.iter().find(|c| c.path == "a.txt").unwrap();
            let b = staged.changes.iter().find(|c| c.path == "b.txt").unwrap();
            assert!(a.unstaged() && !a.staged());
            assert!(b.staged() && !b.unstaged());
            let second = repo.apply(Operation::Commit("second".into()));
            assert_ne!(second.head, first.head);
            assert_eq!(second.changes.len(), 1);
            assert_eq!(second.changes[0].path, "a.txt");
            assert!(second.changes[0].unstaged());
            let history = repo.history();
            assert_eq!(history.commits.len(), 2);
            assert_eq!(history.commits[0].message, "second");
            assert_eq!(history.commits[0].parents, [first.head]);
            assert_eq!(history.commits[0].changes.len(), 1);
            assert_eq!(history.commits[0].changes[0].path, "b.txt");
            assert_eq!(history.commits[1].message, "first");
        },
    );
}

#[test]
fn real_status_bounds_entries_overrides_hidden_untracked_config_and_honors_cancellation() {
    isolated(
        concat!(
            module_path!(),
            "::real_status_bounds_entries_overrides_hidden_untracked_config_and_honors_cancellation"
        ),
        || {
            let repo = Repo::new();
            repo.git(&["config", "status.showUntrackedFiles", "no"]);
            for index in 0..10_000 {
                repo.write(&format!("file-{index:05}.txt"), "");
            }
            let at_limit = repo.state();
            assert_eq!(at_limit.changes.len(), 10_000);
            assert!(!at_limit.truncated);
            assert!(at_limit.changes.iter().all(Change::untracked));
            for name in ["overflow-one.txt", "overflow-two.txt"] {
                repo.write(name, "");
            }
            let over_limit = repo.state();
            assert_eq!(over_limit.changes.len(), 10_000);
            assert!(over_limit.truncated);
            assert!(status(repo.0.path(), &AtomicBool::new(true)).is_err());
            assert!(repo.0.path().join("overflow-two.txt").is_file());
        },
    );
}

#[cfg(unix)]
#[test]
fn a_real_commit_hook_can_outlast_the_read_budget_without_losing_the_commit() {
    use std::os::unix::fs::PermissionsExt;
    isolated(
        concat!(
            module_path!(),
            "::a_real_commit_hook_can_outlast_the_read_budget_without_losing_the_commit"
        ),
        || {
            let repo = Repo::new();
            repo.write("hooked.txt", "saved\n");
            repo.stage("hooked.txt");
            let hooks = repo.0.path().join(".git/test-hooks");
            std::fs::create_dir(&hooks).unwrap();
            let hook = hooks.join("pre-commit");
            std::fs::write(&hook, "#!/bin/sh\nsleep 6\nexit 0\n").unwrap();
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
            repo.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
            let started = std::time::Instant::now();
            let state = repo.apply(Operation::Commit("slow hook commit".into()));
            assert!(started.elapsed() >= Duration::from_millis(5500));
            assert!(!state.head.is_empty() && state.changes.is_empty());
            let history = repo.history();
            assert_eq!(history.commits.len(), 1);
            assert_eq!(history.commits[0].message, "slow hook commit");
            assert_eq!(history.head.as_deref(), Some(state.head.as_str()));
        },
    );
}
