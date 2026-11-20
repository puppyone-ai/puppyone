//! The TypeScript publish-coordinator cases (`electron.cloud-publish-*`)
//! against the real `git` CLI and a smart-HTTP Cloud Git, with a scripted
//! Cloud API. A crash is a panic at one of the coordinator's durable points:
//! it unwinds without another journal write, and a fresh coordinator over
//! the same journal, keychain and Cloud resumes.
use super::git_push_tests::Server;
use super::*;
use crate::workspace::cloud::publish::{Action as Offer, Cleanup, Local, Project, Push};
use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex},
};

/// Where the process stops.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Point {
    /// Cloud created the Project; its response never arrived.
    AfterProjectResponse,
    /// The journal holds the Project; nothing else was sent.
    AfterProjectCreated,
    /// Cloud issued the credential; its response never arrived.
    AfterCredentialResponse,
    /// The journal holds the issued credential.
    AfterCredentialIssued,
    /// The credential scope is journaled; no remote yet.
    AfterCredentialConfig,
    /// The remote exists; its checkpoint is not journaled.
    AfterRemoteAdd,
    /// `remote-configured` is journaled; nothing was sent.
    AfterRemoteConfigured,
    /// The upload is journaled; nothing was sent.
    BeforePush,
    /// Cloud main holds the commit; the result never arrived.
    AfterPush,
    /// Cloud deleted the Project; its response never arrived.
    AfterAbandonResponse,
    /// Cleanup removed the remote; nothing was journaled after.
    AfterRemoteRemoved,
}
struct Crash;

/// What the scripted Cloud saw and how it answers.
#[derive(Default)]
struct Log {
    /// `(Idempotency-Key, body)` of each Project creation.
    creates: Vec<(String, serde_json::Value)>,
    /// `(Idempotency-Key, secret)` of each credential issue.
    credentials: Vec<(String, String)>,
    /// The Idempotency-Key of each discard.
    abandons: Vec<String>,
    revokes: usize,
    abandon_failures: usize,
    abandon_refused: bool,
    on_abandon: Option<Box<dyn FnOnce() + Send>>,
    unavailable: bool,
    /// Holds Project creation until opened.
    gate: Option<Arc<(Mutex<bool>, Condvar)>>,
}

#[derive(Default)]
struct World {
    crash: Mutex<Option<Point>>,
    log: Mutex<Log>,
    /// Run just before the upload.
    before_push: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    /// A definite failure in place of the next uploads.
    push_errors: Mutex<VecDeque<PublishError>>,
    /// Uploads attempted (`git push`).
    pushes: Mutex<Vec<String>>,
    /// Cloud main reads (`git ls-remote`).
    remote_reads: Mutex<usize>,
    secret_reads: Mutex<usize>,
}
impl World {
    fn stop_at(&self, point: Point) {
        *self.crash.lock().unwrap() = Some(point);
    }
    /// Stops the process at `point`, once.
    fn at(&self, point: Point) {
        let hit = {
            let mut slot = self.crash.lock().unwrap();
            if *slot == Some(point) {
                *slot = None;
                true
            } else {
                false
            }
        };
        if hit {
            std::panic::panic_any(Crash);
        }
    }
    fn log<T>(&self, f: impl FnOnce(&mut Log) -> T) -> T {
        f(&mut self.log.lock().unwrap())
    }
}

struct Git {
    cli: Cli,
    world: Arc<World>,
}
impl GitOps for Git {
    fn identity(&self, root: &Path) -> Result<git::Identity, PublishError> {
        self.cli.identity(root)
    }
    fn status(&self, root: &Path) -> Result<git::Status, PublishError> {
        self.cli.status(root)
    }
    fn remote(&self, root: &Path) -> Result<Remote, PublishError> {
        let paused =
            self.world.crash.lock().unwrap().as_ref() == Some(&Point::AfterRemoteConfigured);
        if paused
            && let Ok(identity) = self.cli.identity(root)
            && let Ok(Some(record)) = Journal::in_git_dir(&identity.git_dir).read()
            && record.checkpoint == "remote-configured"
        {
            self.world.at(Point::AfterRemoteConfigured);
        }
        self.cli.remote(root)
    }
    fn source_commit(&self, root: &Path, branch: &str) -> Result<String, PublishError> {
        self.cli.source_commit(root, branch)
    }
    fn preflight(&self, root: &Path, commit: &str) -> Result<(), PublishError> {
        self.cli.preflight(root, commit)
    }
    fn commit_exists(&self, root: &Path, commit: &str) -> bool {
        self.cli.commit_exists(root, commit)
    }
    fn prepare_credential_config(
        &self,
        root: &Path,
        url: &str,
        operation: &str,
    ) -> Result<journal::CredentialConfig, PublishError> {
        self.world.at(Point::AfterCredentialIssued);
        self.cli.prepare_credential_config(root, url, operation)
    }
    fn configure_remote(
        &self,
        root: &Path,
        record: &Record,
        secret: &str,
    ) -> Result<bool, PublishError> {
        self.world.at(Point::AfterCredentialConfig);
        let created = self.cli.configure_remote(root, record, secret)?;
        self.world.at(Point::AfterRemoteAdd);
        Ok(created)
    }
    fn push(&self, root: &Path, record: &Record, secret: &str) -> Result<(), PublishError> {
        self.world.at(Point::BeforePush);
        let hook = self.world.before_push.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
        self.world
            .pushes
            .lock()
            .unwrap()
            .push(record.attempt.commit_oid.clone());
        let injected = self.world.push_errors.lock().unwrap().pop_front();
        if let Some(error) = injected {
            return Err(error);
        }
        self.cli.push(root, record, secret)?;
        self.world.at(Point::AfterPush);
        Ok(())
    }
    fn remote_main(
        &self,
        root: &Path,
        record: &Record,
        secret: &str,
    ) -> Result<Option<String>, PublishError> {
        *self.world.remote_reads.lock().unwrap() += 1;
        self.cli.remote_main(root, record, secret)
    }
    fn finalize(&self, root: &Path, record: &Record) -> Result<(), PublishError> {
        self.cli.finalize(root, record)
    }
    fn cleanup(&self, root: &Path, record: &Record) -> Result<(), PublishError> {
        self.cli.cleanup(root, record)?;
        self.world.at(Point::AfterRemoteRemoved);
        Ok(())
    }
}

struct Cloud {
    url: String,
    world: Arc<World>,
}
impl CloudOps for Cloud {
    fn create_project(&self, record: &Record) -> Result<String, PublishError> {
        let gate = self.world.log(|log| {
            log.creates.push((
                record.operation_id.clone(),
                serde_json::to_value(&record.create_payload).unwrap(),
            ));
            log.gate.clone()
        });
        if let Some(gate) = gate {
            let (open, changed) = &*gate;
            let mut open = open.lock().unwrap();
            while !*open {
                open = changed.wait(open).unwrap();
            }
        }
        self.world.at(Point::AfterProjectResponse);
        Ok("project-1".into())
    }
    fn issue_credential(
        &self,
        record: &Record,
        secret: &str,
    ) -> Result<api::Credential, PublishError> {
        self.world.at(Point::AfterProjectCreated);
        if self.world.log(|log| log.unavailable) {
            return Err(PublishError::new(
                Code::ProjectUnavailable,
                "The Cloud Project no longer exists or is unavailable.",
                false,
            ));
        }
        self.world.log(|log| {
            log.credentials
                .push((record.operation_id.clone(), secret.to_owned()))
        });
        self.world.at(Point::AfterCredentialResponse);
        Ok(api::Credential {
            id: "credential-1".into(),
            username: api::GIT_USERNAME.into(),
            remote_url: self.url.clone(),
        })
    }
    fn revoke_credential(&self, _: &Record) -> Result<(), PublishError> {
        self.world.log(|log| log.revokes += 1);
        Ok(())
    }
    fn abandon_empty_project(&self, record: &Record) -> Result<bool, PublishError> {
        let hook = self.world.log(|log| {
            log.abandons.push(record.operation_id.clone());
            log.on_abandon.take()
        });
        if let Some(hook) = hook {
            hook();
        }
        let (failed, refused) = self.world.log(|log| {
            let failed = log.abandon_failures > 0;
            log.abandon_failures = log.abandon_failures.saturating_sub(1);
            (failed, log.abandon_refused)
        });
        if failed {
            return Err(PublishError::new(
                Code::CleanupFailed,
                "Unable to delete the empty Cloud Project. Finish cleanup to retry.",
                true,
            ));
        }
        self.world.at(Point::AfterAbandonResponse);
        Ok(!refused)
    }
    fn organizations(&self) -> Result<Vec<api::Organization>, PublishError> {
        Ok(vec![])
    }
    fn trusts_remote(&self, url: &str, project: &str, _: &str) -> bool {
        url == self.url && project == "project-1"
    }
}

/// The keychain, counting reads.
struct Vault {
    memory: Memory,
    world: Arc<World>,
}
impl SecretVault for Vault {
    fn put(&self, reference: &str, secret: &str) -> Result<(), String> {
        self.memory.put(reference, secret)
    }
    fn get(&self, reference: &str) -> Result<Option<String>, String> {
        *self.world.secret_reads.lock().unwrap() += 1;
        self.memory.get(reference)
    }
    fn clear(&self, reference: &str) -> Result<(), String> {
        self.memory.clear(reference)
    }
}

struct Fixture {
    local: tempfile::TempDir,
    server: Server,
    world: Arc<World>,
    cloud: Arc<Cloud>,
    vault: Arc<Vault>,
    branch: String,
    head: String,
}
fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("/usr/bin/git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}
impl Fixture {
    fn new(branch: &str) -> Self {
        let local = repository();
        if branch != "main" {
            run_git(local.path(), &["switch", "-qc", branch]).unwrap();
        }
        let server = Server::new();
        let world = Arc::new(World::default());
        let cloud = Arc::new(Cloud {
            url: server.url(),
            world: world.clone(),
        });
        let vault = Arc::new(Vault {
            memory: Memory::default(),
            world: world.clone(),
        });
        let head = run_git(local.path(), &["rev-parse", "HEAD"]).unwrap();
        Self {
            local,
            server,
            world,
            cloud,
            vault,
            branch: branch.into(),
            head,
        }
    }
    fn root(&self) -> PathBuf {
        self.local.path().to_path_buf()
    }
    fn coordinator(&self) -> Coordinator {
        Coordinator {
            git: Arc::new(Git {
                cli: Cli {
                    helper: Some(format!(
                        "store --file={}",
                        self.server.root.path().join("credentials").display()
                    )),
                },
                world: self.world.clone(),
            }),
            cloud: self.cloud.clone(),
            vault: self.vault.clone(),
        }
    }
    fn request(&self) -> Request {
        Request {
            root: self.root(),
            api_base_url: "https://api.puppyone.ai/api/v1".into(),
            user_id: "user-1".into(),
            organization_id: "org-1".into(),
            project_name: "Publish fixture".into(),
            source_branch: self.branch.clone(),
            operation_id: None,
            action: Action::Initialize,
        }
    }
    fn with(&self, action: Action, operation: &str) -> Request {
        Request {
            action,
            operation_id: Some(operation.into()),
            ..self.request()
        }
    }
    fn start(&self, request: &Request) -> Outcome {
        self.coordinator().start(request, &mut |_| {})
    }
    /// Runs until the process stops at `point`.
    fn stop(&self, point: Point, run: impl FnOnce(&Self) -> Outcome) {
        self.world.stop_at(point);
        let stopped = catch_unwind(AssertUnwindSafe(|| run(self)))
            .expect_err("the process stops before finishing");
        assert!(stopped.downcast_ref::<Crash>().is_some(), "{point:?}");
    }
    fn journal(&self) -> Journal {
        Journal::in_git_dir(&self.local.path().join(".git"))
    }
    fn journal_text(&self) -> Option<String> {
        std::fs::read_to_string(
            self.local
                .path()
                .join(".git/puppyone")
                .join(journal::FILENAME),
        )
        .ok()
    }
    fn pending(&self) -> Record {
        self.journal().read().unwrap().expect("a pending operation")
    }
    fn sh(&self, args: &[&str]) -> String {
        run_git(self.local.path(), args).unwrap()
    }
    fn commit(&self, name: &str, body: &str) -> String {
        std::fs::write(self.local.path().join(name), body).unwrap();
        self.sh(&["add", name]);
        self.sh(&["commit", "-qm", name]);
        self.sh(&["rev-parse", "HEAD"])
    }
    fn cloud_main(&self) -> Option<String> {
        run_git(&self.server.bare(), &["rev-parse", "refs/heads/main"]).ok()
    }
    /// Puts `commit` on Cloud main directly, as another writer would.
    fn land(&self, commit: &str) {
        self.sh(&[
            "push",
            "-q",
            self.server.bare().to_str().unwrap(),
            &format!("{commit}:refs/heads/main"),
        ]);
    }
    fn remote(&self) -> Option<String> {
        run_git(self.local.path(), &["remote", "get-url", "puppyone"]).ok()
    }
    fn creates(&self) -> usize {
        self.world.log(|log| log.creates.len())
    }
    fn abandons(&self) -> Vec<String> {
        self.world.log(|log| log.abandons.clone())
    }
    /// What a person's checkout is: HEAD, branch, index, worktree and
    /// untracked bytes.
    fn snapshot(&self) -> Vec<String> {
        let mut state = vec![
            self.sh(&["rev-parse", "HEAD"]),
            run_git(self.local.path(), &["symbolic-ref", "-q", "HEAD"]).unwrap_or_default(),
            self.sh(&["status", "--porcelain=v1", "--untracked-files=all"]),
            self.sh(&["diff", "--cached", "--binary"]),
            self.sh(&["diff", "--binary"]),
        ];
        for line in self
            .sh(&["ls-files", "--others", "--exclude-standard"])
            .lines()
        {
            state.push(format!(
                "{line}: {:?}",
                std::fs::read(self.local.path().join(line)).unwrap()
            ));
        }
        state
    }
}
fn state(outcome: &Outcome) -> &crate::workspace::cloud::publish::State {
    outcome.state.as_ref().expect("a projected state")
}
fn code(outcome: &Outcome) -> Option<Code> {
    outcome.error.as_ref().map(|e| e.code)
}

// ---------------------------------------------------- creating the Project

#[test]
fn an_unborn_branch_is_refused_before_anything_is_created() {
    let f = Fixture::new("main");
    f.sh(&["update-ref", "-d", "refs/heads/main"]);
    let outcome = f.start(&f.request());
    assert!(!outcome.ok);
    assert_eq!(code(&outcome), Some(Code::CommitRequired));
    assert!(!outcome.error.unwrap().retryable);
    assert!(outcome.state.is_none());
    assert_eq!(f.creates(), 0);
    assert!(f.journal_text().is_none());
}

#[test]
fn a_feature_branch_is_created_once_and_lands_on_cloud_main() {
    let f = Fixture::new("feature/design");
    let mut stages = vec![];
    let outcome = f.coordinator().start(&f.request(), &mut |stage| {
        if stages.last() != Some(&stage) {
            stages.push(stage)
        }
    });
    assert!(outcome.ok, "{:?}", outcome.error);
    let published = state(&outcome);
    assert_eq!(
        (published.project, published.push, published.cleanup),
        (Project::Published, Push::Accepted, Cleanup::None)
    );
    assert!(published.actions.is_empty());
    assert_eq!(
        f.world.log(|log| log.creates.clone()),
        [(
            f.world.log(|log| log.creates[0].0.clone()),
            serde_json::json!({"org_id": "org-1", "name": "Publish fixture", "description": null})
        )]
    );
    let secrets = f.world.log(|log| log.credentials.clone());
    assert_eq!(secrets.len(), 1);
    assert!(secrets[0].1.starts_with("pwg_"));
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
    assert_eq!(
        f.sh(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
        "puppyone/main"
    );
    assert!(f.journal_text().is_none());
    assert_eq!(f.vault.memory.0.lock().unwrap().len(), 0);
    assert_eq!(
        stages,
        [
            Stage::Validating,
            Stage::CreatingProject,
            Stage::SecuringCredential,
            Stage::ConfiguringRemote,
            Stage::CheckingRemote,
            Stage::Uploading,
            Stage::Confirming,
            Stage::Finalizing,
            Stage::Completed,
        ]
    );
    assert!(!format!("{outcome:?}").contains("pwg_"));
}

#[test]
fn a_crash_right_after_the_remote_is_added_resumes_without_another_project() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteAdd, |f| f.start(&f.request()));
    assert_eq!(f.remote().as_deref(), Some(f.server.url().as_str()));
    let resumed = f.start(&f.request());
    assert!(resumed.ok, "{:?}", resumed.error);
    assert_eq!(f.creates(), 1);
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
}

#[test]
fn a_pending_operation_meeting_another_remote_fails_closed() {
    let f = Fixture::new("main");
    f.stop(Point::AfterProjectCreated, |f| f.start(&f.request()));
    let wrong = format!("{}-wrong", f.server.url());
    f.sh(&["remote", "add", "puppyone", &wrong]);
    let outcome = f.start(&f.request());
    assert_eq!(code(&outcome), Some(Code::RemoteConflict));
    assert!(!outcome.error.unwrap().retryable);
    assert_eq!(f.remote().as_deref(), Some(wrong.as_str()));
}

#[test]
fn a_crash_journal_never_holds_the_secret() {
    let f = Fixture::new("main");
    f.stop(Point::AfterCredentialIssued, |f| f.start(&f.request()));
    let journal = f.journal_text().unwrap();
    let secrets: Vec<String> = f.vault.memory.0.lock().unwrap().values().cloned().collect();
    assert_eq!(secrets.len(), 1);
    assert!(secrets[0].starts_with("pwg_"));
    assert!(!journal.contains(&secrets[0]));
    assert!(!journal.contains("pwg_"));
}

/// An edited journal cannot send the credential elsewhere: the remote it
/// names is checked before any secret is read or any network Git runs.
#[test]
fn a_tampered_journal_remote_is_refused_before_any_secret_or_network() {
    let f = Fixture::new("main");
    f.stop(Point::AfterCredentialConfig, |f| f.start(&f.request()));
    let path = f.local.path().join(".git/puppyone").join(journal::FILENAME);
    let mut record: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let attacker = "https://attacker.invalid/git/project-1.git";
    record["canonical_remote_url"] = attacker.into();
    record["credential_config_snapshot"]["scope_url"] = attacker.into();
    std::fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
    let reads = *f.world.secret_reads.lock().unwrap();
    let outcome = f.start(&f.request());
    assert_eq!(code(&outcome), Some(Code::RemoteConflict));
    assert_eq!(
        *f.world.secret_reads.lock().unwrap(),
        reads,
        "no secret read"
    );
    assert_eq!(*f.world.remote_reads.lock().unwrap(), 0, "no ls-remote");
    assert!(f.world.pushes.lock().unwrap().is_empty(), "no push");
    // Reading the state is refused the same way.
    assert_eq!(
        code(&f.coordinator().state(&f.request())),
        Some(Code::RemoteConflict)
    );
    assert_eq!(*f.world.remote_reads.lock().unwrap(), 0);
}

#[test]
fn a_lost_project_response_is_replayed_with_the_same_key_and_body() {
    let f = Fixture::new("main");
    f.stop(Point::AfterProjectResponse, |f| f.start(&f.request()));
    let resumed = f.start(&f.request());
    assert!(resumed.ok, "{:?}", resumed.error);
    let creates = f.world.log(|log| log.creates.clone());
    assert_eq!(creates.len(), 2);
    assert_eq!(creates[0], creates[1]);
}

#[test]
fn a_lost_credential_response_is_replayed_with_the_same_key_and_secret() {
    let f = Fixture::new("main");
    f.stop(Point::AfterCredentialResponse, |f| f.start(&f.request()));
    let resumed = f.start(&f.request());
    assert!(resumed.ok, "{:?}", resumed.error);
    let credentials = f.world.log(|log| log.credentials.clone());
    assert_eq!(credentials.len(), 2);
    assert_eq!(credentials[0], credentials[1]);
}

// ---------------------------------------------------------------- pushing

#[test]
fn a_crash_after_the_push_reconciles_without_another_project() {
    let f = Fixture::new("main");
    f.stop(Point::AfterPush, |f| f.start(&f.request()));
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
    let resumed = f.start(&f.request());
    assert!(resumed.ok, "{:?}", resumed.error);
    assert_eq!(
        (state(&resumed).project, state(&resumed).push),
        (Project::Published, Push::Accepted)
    );
    assert_eq!(f.creates(), 1);
}

#[test]
fn accepted_remote_truth_is_reconciled_before_cleanup_can_delete_anything() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let operation = f.pending().operation_id;
    f.land(&f.head);
    let pending = f.coordinator().state(&f.request());
    assert!(pending.ok);
    let found = state(&pending);
    assert_eq!(
        (found.project, found.push, found.actions.clone()),
        (Project::Published, Push::Accepted, vec![])
    );
    let cleaned = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(cleaned.ok && cleaned.state.is_none(), "{:?}", cleaned.error);
    assert!(f.abandons().is_empty());
    assert_eq!(f.remote().as_deref(), Some(f.server.url().as_str()));
}

/// TypeScript continues to the journaled URL when another process repoints
/// the remote after its check; Rust checks the remote again right before
/// sending and fails closed. Either way nothing reaches the other place.
#[test]
fn a_repointed_remote_never_receives_the_upload() {
    let f = Fixture::new("main");
    let attacker = tempfile::tempdir().unwrap();
    run_git(attacker.path(), &["init", "-q", "--bare"]).unwrap();
    let root = f.root();
    let elsewhere = format!("file://{}", attacker.path().display());
    *f.world.before_push.lock().unwrap() = Some(Box::new(move || {
        run_git(&root, &["remote", "set-url", "puppyone", &elsewhere]).unwrap();
    }));
    let outcome = f.start(&f.request());
    assert_eq!(code(&outcome), Some(Code::RemoteConflict));
    assert!(run_git(attacker.path(), &["rev-parse", "refs/heads/main"]).is_err());
    assert_eq!(f.cloud_main(), None);
}

/// A helper planted in the local config between the check and the upload
/// never runs: the command pins the secure helper and resets the chain.
#[test]
fn the_secure_helper_is_pinned_across_a_local_config_race() {
    let f = Fixture::new("main");
    let marker = f.server.root.path().join("captured");
    let root = f.root();
    let url = f.server.url();
    let capture = format!("!touch {}", marker.display());
    *f.world.before_push.lock().unwrap() = Some(Box::new(move || {
        run_git(
            &root,
            &[
                "config",
                "--local",
                "--replace-all",
                &format!("credential.{url}.helper"),
                &capture,
            ],
        )
        .unwrap();
    }));
    let outcome = f.start(&f.request());
    assert!(outcome.ok, "{:?}", outcome.error);
    assert!(!marker.exists(), "the planted helper ran");
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
}

#[test]
fn a_remote_added_just_before_a_crash_is_owned_and_removed_on_abandon() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteAdd, |f| f.start(&f.request()));
    assert_eq!(f.remote().as_deref(), Some(f.server.url().as_str()));
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let pending = f.coordinator().state(&f.request());
    assert!(pending.ok, "{:?}", pending.error);
    let found = state(&pending);
    assert_eq!(
        (found.project, found.push),
        (Project::Empty, Push::Preparing)
    );
    assert!(found.actions.contains(&Offer::RetryPush));
    assert!(found.actions.contains(&Offer::DeleteEmptyProject));
    let operation = f.pending().operation_id;
    let abandoned = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(abandoned.ok, "{:?}", abandoned.error);
    assert_eq!(f.remote(), None);
}

#[test]
fn only_the_committed_tree_is_sent_and_the_checkout_is_untouched() {
    let f = Fixture::new("main");
    std::fs::write(f.local.path().join("a.md"), b"dirty\n").unwrap();
    std::fs::write(f.local.path().join("STAGED.md"), "staged version\n").unwrap();
    f.sh(&["add", "STAGED.md"]);
    std::fs::write(f.local.path().join("STAGED.md"), "working version\n").unwrap();
    std::fs::write(
        f.local.path().join("untracked.bin"),
        [0x00, 0xff, 0x41, 0x0a],
    )
    .unwrap();
    let before = f.snapshot();
    let outcome = f.start(&f.request());
    assert!(outcome.ok, "{:?}", outcome.error);
    assert_eq!(
        (state(&outcome).push, state(&outcome).local),
        (Push::Accepted, Local::Dirty)
    );
    assert_eq!(f.snapshot(), before);
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
    let sent = run_git(&f.server.bare(), &["ls-tree", "-r", "--name-only", "main"]).unwrap();
    assert_eq!(sent, "a.md");
}

#[test]
fn an_attempt_finishes_its_commit_after_head_moves_to_another_branch() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    f.sh(&["switch", "-qc", "feature/continued-work"]);
    let advanced = f.commit("continued.md", "new local commit\n");
    let resumed = f.start(&f.request());
    assert!(resumed.ok, "{:?}", resumed.error);
    assert_eq!(
        (state(&resumed).push, state(&resumed).local),
        (Push::Accepted, Local::BranchSwitched)
    );
    assert_eq!(
        f.sh(&["rev-parse", "--abbrev-ref", "HEAD"]),
        "feature/continued-work"
    );
    assert_eq!(f.sh(&["rev-parse", "HEAD"]), advanced);
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
}

#[test]
fn push_latest_starts_a_new_attempt_from_the_branch_tip() {
    let f = Fixture::new("main");
    f.world
        .push_errors
        .lock()
        .unwrap()
        .push_back(PublishError::new(
            Code::PushFailed,
            "definite transport failure",
            true,
        ));
    let failed = f.start(&f.request());
    assert_eq!(code(&failed), Some(Code::PushFailed));
    let found = state(&failed);
    assert_eq!((found.project, found.push), (Project::Empty, Push::Failed));
    assert!(found.actions.contains(&Offer::RetryPush));
    assert!(found.actions.contains(&Offer::DeleteEmptyProject));
    let record = f.pending();
    assert_eq!(record.attempt_count, 1);
    let latest = f.commit("latest.md", "latest committed content\n");
    let retried = f.start(&f.with(Action::PushLatest, &record.operation_id));
    assert!(retried.ok, "{:?}", retried.error);
    assert_eq!(f.cloud_main().as_deref(), Some(latest.as_str()));
    assert_eq!(*f.world.pushes.lock().unwrap(), [f.head.clone(), latest]);
    assert_eq!(f.creates(), 1);
}

#[test]
fn a_cloud_main_that_wins_the_absent_race_is_never_overwritten() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    f.sh(&["switch", "-qc", "contender"]);
    let winner = f.commit("winner.md", "another accepted history\n");
    f.land(&winner);
    let outcome = f.start(&f.request());
    assert_eq!(code(&outcome), Some(Code::RemoteRefConflict));
    assert!(!outcome.error.as_ref().unwrap().retryable);
    let found = state(&outcome);
    assert_eq!(
        (found.project, found.push, found.actions.clone()),
        (Project::Published, Push::Conflict, vec![])
    );
    assert_eq!(f.cloud_main().as_deref(), Some(winner.as_str()));
}

#[test]
fn the_server_lease_refuses_a_competitor_that_lands_after_the_check() {
    let f = Fixture::new("main");
    f.sh(&["switch", "-qc", "race-winner"]);
    let winner = f.commit("race-winner.md", "wins expected-absent CAS\n");
    f.sh(&["switch", "-q", "main"]);
    let root = f.root();
    let bare = f.server.bare();
    let landed = winner.clone();
    *f.world.before_push.lock().unwrap() = Some(Box::new(move || {
        run_git(
            &root,
            &[
                "push",
                "-q",
                bare.to_str().unwrap(),
                &format!("{landed}:refs/heads/main"),
            ],
        )
        .unwrap();
    }));
    let outcome = f.start(&f.request());
    assert_eq!(code(&outcome), Some(Code::RemoteRefConflict));
    assert!(!outcome.error.as_ref().unwrap().retryable);
    assert_eq!(state(&outcome).push, Push::Conflict);
    assert_eq!(f.cloud_main().as_deref(), Some(winner.as_str()));
}

// ----------------------------------------------------- retry and restart

/// A send whose result is unknown is retried with its exact commit in a
/// fresh attempt, however the checkout moved (Rust reads Cloud main; it has
/// no push receipt to consult).
#[test]
fn an_unresolved_send_is_retried_with_its_commit_in_a_fresh_attempt() {
    let f = Fixture::new("main");
    f.stop(Point::BeforePush, |f| f.start(&f.request()));
    let record = f.pending();
    let later = f.commit("later.md", "later local changes\n");
    let pending = f.coordinator().state(&f.request());
    assert!(state(&pending).actions.contains(&Offer::RetryPush));
    let result = f.start(&f.with(Action::Reconcile, &record.operation_id));
    assert!(result.ok, "{:?}", result.error);
    assert_eq!(
        *f.world.pushes.lock().unwrap(),
        std::slice::from_ref(&f.head)
    );
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
    assert_eq!(f.sh(&["rev-parse", "HEAD"]), later);
    assert_eq!(f.creates(), 1);
    assert_eq!(f.world.log(|log| log.credentials.len()), 1);
}

#[test]
fn a_restart_while_uploading_or_confirming_offers_retry_without_retargeting() {
    for interrupted in ["uploading", "confirming"] {
        let f = Fixture::new("main");
        f.stop(Point::BeforePush, |f| f.start(&f.request()));
        let path = f.local.path().join(".git/puppyone").join(journal::FILENAME);
        let mut record: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        record["push_state"] = interrupted.into();
        record["attempt"]["state"] = interrupted.into();
        std::fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
        let pending = f.coordinator().state(&f.request());
        assert!(pending.ok, "{interrupted}: {:?}", pending.error);
        assert_eq!(state(&pending).push, Push::Uncertain, "{interrupted}");
        assert!(state(&pending).actions.contains(&Offer::RetryPush));
        let retried = f.start(&Request {
            action: Action::RetryPush,
            ..f.request()
        });
        assert!(retried.ok, "{interrupted}: {:?}", retried.error);
        assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
    }
}

#[test]
fn an_old_upload_landing_just_before_retry_is_not_a_failure() {
    let f = Fixture::new("main");
    f.stop(Point::BeforePush, |f| f.start(&f.request()));
    let root = f.root();
    let bare = f.server.bare();
    let head = f.head.clone();
    *f.world.before_push.lock().unwrap() = Some(Box::new(move || {
        run_git(
            &root,
            &[
                "push",
                "-q",
                bare.to_str().unwrap(),
                &format!("{head}:refs/heads/main"),
            ],
        )
        .unwrap();
    }));
    let result = f.start(&Request {
        action: Action::RetryPush,
        ..f.request()
    });
    assert!(result.ok, "{:?}", result.error);
    assert_eq!(
        run_git(&f.server.bare(), &["rev-list", "--count", "main"]).unwrap(),
        "1"
    );
}

#[test]
fn a_second_failure_keeps_the_unresolved_commit_across_later_work() {
    let f = Fixture::new("main");
    f.stop(Point::BeforePush, |f| f.start(&f.request()));
    f.world
        .push_errors
        .lock()
        .unwrap()
        .push_back(PublishError::new(
            Code::PushFailed,
            "receive rejected",
            true,
        ));
    let failed = f.start(&Request {
        action: Action::RetryPush,
        ..f.request()
    });
    assert!(!failed.ok);
    assert_eq!(state(&failed).push, Push::Uncertain);
    assert!(state(&failed).actions.contains(&Offer::RetryPush));
    assert_eq!(f.pending().attempt_count, 2);
    f.commit("later.md", "new work\n");
    let result = f.start(&Request {
        action: Action::PushLatest,
        ..f.request()
    });
    assert!(result.ok, "{:?}", result.error);
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
}

#[test]
fn a_different_commit_landing_concurrently_wins_over_retry() {
    let f = Fixture::new("main");
    f.stop(Point::BeforePush, |f| f.start(&f.request()));
    let other = f.commit("other.md", "another writer\n");
    let root = f.root();
    let bare = f.server.bare();
    let landed = other.clone();
    *f.world.before_push.lock().unwrap() = Some(Box::new(move || {
        run_git(
            &root,
            &[
                "push",
                "-q",
                bare.to_str().unwrap(),
                &format!("{landed}:refs/heads/main"),
            ],
        )
        .unwrap();
    }));
    let result = f.start(&Request {
        action: Action::RetryPush,
        ..f.request()
    });
    assert_eq!(code(&result), Some(Code::RemoteRefConflict));
    assert_eq!(f.cloud_main().as_deref(), Some(other.as_str()));
    assert_eq!(f.sh(&["rev-parse", "HEAD"]), other);
}

/// Two publications of one repository at once: the repository's mutation
/// owner serializes them, and only one Project is created.
#[test]
fn concurrent_publications_of_one_repository_create_one_project() {
    let f = Fixture::new("main");
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    f.world.log(|log| log.gate = Some(gate.clone()));
    let coordinator = Arc::new(f.coordinator());
    let request = f.request();
    let first = {
        let (c, r) = (coordinator.clone(), request.clone());
        std::thread::spawn(move || c.start(&r, &mut |_| {}))
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while f.creates() == 0 {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let second = {
        let (c, r) = (coordinator.clone(), request.clone());
        std::thread::spawn(move || c.start(&r, &mut |_| {}))
    };
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert_eq!(f.creates(), 1, "the second waits for the repository");
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    let first = first.join().unwrap();
    let second = second.join().unwrap();
    assert!(first.ok, "{:?}", first.error);
    assert!(second.ok, "{:?}", second.error);
    assert_eq!(f.creates(), 1);
}

// ------------------------------------------------- cleanup and migration

#[test]
fn a_failed_cleanup_finishes_after_the_checkout_changes() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let operation = f.pending().operation_id;
    f.world.log(|log| log.abandon_failures = 1);
    let first = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert_eq!(code(&first), Some(Code::CleanupFailed));
    assert!(first.error.as_ref().unwrap().retryable);
    assert_eq!(state(&first).cleanup, Cleanup::Failed);
    assert_eq!(state(&first).actions, [Offer::FinishCleanup]);
    f.sh(&["switch", "-qc", "work-after-cleanup-request"]);
    f.commit("after-request.md", "committed after cleanup intent\n");
    std::fs::write(
        f.local.path().join("dirty-after-request.txt"),
        "must survive cleanup\n",
    )
    .unwrap();
    let before = f.snapshot();
    let finished = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(
        finished.ok && finished.state.is_none(),
        "{:?}",
        finished.error
    );
    assert_eq!(f.snapshot(), before);
    assert_eq!(f.remote(), None);
    assert_eq!(f.abandons().len(), 2);
}

#[test]
fn a_deleted_source_branch_can_be_replaced_by_the_current_one() {
    let f = Fixture::new("main");
    f.stop(Point::AfterProjectCreated, |f| f.start(&f.request()));
    f.sh(&["switch", "-qc", "replacement"]);
    f.sh(&["branch", "-D", "main"]);
    let pending = f.coordinator().state(&f.request());
    assert!(pending.ok, "{:?}", pending.error);
    let found = state(&pending);
    assert_eq!(found.local, Local::SourceMissing);
    assert!(found.actions.contains(&Offer::ChooseSource));
    assert!(found.actions.contains(&Offer::DeleteEmptyProject));
    let operation = f.pending().operation_id;
    let recovered = f.start(&Request {
        source_branch: "replacement".into(),
        ..f.with(Action::ChooseSource, &operation)
    });
    assert!(recovered.ok, "{:?}", recovered.error);
    assert_eq!(state(&recovered).push, Push::Accepted);
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
}

#[test]
fn a_lost_discard_response_is_replayed_with_the_same_key() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let operation = f.pending().operation_id;
    f.stop(Point::AfterAbandonResponse, |f| {
        f.coordinator()
            .cleanup(&f.with(Action::Initialize, &operation))
    });
    let finished = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(
        finished.ok && finished.state.is_none(),
        "{:?}",
        finished.error
    );
    let abandons = f.abandons();
    assert_eq!(abandons.len(), 2);
    assert_eq!(abandons[0], abandons[1]);
}

#[test]
fn local_cleanup_finishes_after_a_crash_right_after_removing_the_remote() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let operation = f.pending().operation_id;
    f.stop(Point::AfterRemoteRemoved, |f| {
        f.coordinator()
            .cleanup(&f.with(Action::Initialize, &operation))
    });
    assert_eq!(f.remote(), None);
    let finished = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(
        finished.ok && finished.state.is_none(),
        "{:?}",
        finished.error
    );
    assert_eq!(f.abandons().len(), 1);
}

#[test]
fn the_server_proves_emptiness_when_the_remote_is_already_gone() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let operation = f.pending().operation_id;
    f.sh(&["remote", "remove", "puppyone"]);
    let finished = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(
        finished.ok && finished.state.is_none(),
        "{:?}",
        finished.error
    );
    assert_eq!(f.abandons().len(), 1);
}

#[test]
fn a_refused_cleanup_reconciles_cloud_main_through_the_canonical_url() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let operation = f.pending().operation_id;
    f.sh(&["remote", "remove", "puppyone"]);
    let root = f.root();
    let bare = f.server.bare();
    let head = f.head.clone();
    f.world.log(|log| {
        log.abandon_refused = true;
        log.on_abandon = Some(Box::new(move || {
            run_git(
                &root,
                &[
                    "push",
                    "-q",
                    bare.to_str().unwrap(),
                    &format!("{head}:refs/heads/main"),
                ],
            )
            .unwrap();
        }));
    });
    let result = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(result.ok, "{:?}", result.error);
    let found = state(&result);
    assert_eq!(
        (found.project, found.push, found.actions.clone()),
        (Project::Published, Push::Accepted, vec![])
    );
    assert_eq!(f.cloud_main().as_deref(), Some(f.head.as_str()));
}

#[test]
fn a_definitive_discard_refusal_keeps_sending_available_across_a_restart() {
    for point in [Point::AfterProjectCreated, Point::AfterRemoteConfigured] {
        let f = Fixture::new("main");
        f.stop(point, |f| f.start(&f.request()));
        let operation = f.pending().operation_id;
        f.world.log(|log| log.abandon_refused = true);
        std::fs::write(
            f.local.path().join("keep-local.txt"),
            "local work survives\n",
        )
        .unwrap();
        let refused = f
            .coordinator()
            .cleanup(&f.with(Action::Initialize, &operation));
        assert_eq!(code(&refused), Some(Code::CleanupNotAllowed), "{point:?}");
        assert!(!refused.error.as_ref().unwrap().retryable);
        assert_eq!(state(&refused).cleanup, Cleanup::None, "{point:?}");
        assert_eq!(state(&refused).actions, [Offer::RetryPush], "{point:?}");
        let restarted = f.coordinator().state(&f.request());
        assert_eq!(state(&restarted).cleanup, Cleanup::None);
        assert_eq!(state(&restarted).actions, [Offer::RetryPush], "{point:?}");
        assert_eq!(
            f.pending().last_error.map(|e| e.code).as_deref(),
            Some("CLEANUP_NOT_ALLOWED")
        );
        let retried = f.start(&f.with(Action::RetryPush, &operation));
        assert!(retried.ok, "{point:?}: {:?}", retried.error);
        assert_eq!(state(&retried).push, Push::Accepted);
        assert_eq!(
            std::fs::read_to_string(f.local.path().join("keep-local.txt")).unwrap(),
            "local work survives\n"
        );
        assert_eq!(f.abandons().len(), 1);
        assert_eq!(f.creates(), 1);
    }
}

/// `replacePausedOperationWithV1`: the paused operation as an earlier
/// release journaled it.
fn as_version_1(f: &Fixture, phase: &str) -> Record {
    let record = f.pending();
    let v1 = serde_json::json!({
        "version": 1, "kind": "puppyone-cloud-publish",
        "operation_id": record.operation_id, "revision": record.revision, "phase": phase,
        "api_base_url": record.api_base_url, "api_origin": record.api_origin,
        "user_id": record.user_id, "organization_id": record.organization_id,
        "project_name": record.project_name, "create_payload": record.create_payload,
        "repository_fingerprint": record.repository_fingerprint,
        "expected_head_commit_id": record.attempt.commit_oid,
        "expected_branch": record.selected_source_branch, "destination_branch": "main",
        "project_id": record.project_id, "credential_id": record.credential_id,
        "secret_ref": record.secret_ref, "secret_stored": record.secret_stored,
        "canonical_remote_url": record.canonical_remote_url,
        "credential_username": record.credential_username,
        "credential_config_snapshot": record.credential_config_snapshot,
        "remote_add_intent": record.remote_add_intent,
        "remote_created_by_operation": record.remote_created_by_operation,
        "created_at": record.created_at, "updated_at": record.updated_at,
    });
    let path = f.local.path().join(".git/puppyone").join(journal::FILENAME);
    std::fs::write(&path, serde_json::to_vec(&v1).unwrap()).unwrap();
    record
}

#[test]
fn a_version_1_operation_resumes_by_what_cloud_main_says() {
    for remote in ["absent", "accepted", "divergent"] {
        let f = Fixture::new("main");
        f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
        as_version_1(&f, "remote-configured");
        let competing = match remote {
            "accepted" => {
                f.land(&f.head);
                None
            }
            "divergent" => {
                f.sh(&["switch", "-qc", "remote-winner"]);
                let winner = f.commit("remote-winner.md", "remote winner\n");
                f.land(&winner);
                Some(winner)
            }
            _ => None,
        };
        let result = f.coordinator().state(&f.request());
        assert!(result.ok, "{remote}: {:?}", result.error);
        let found = state(&result);
        match remote {
            "absent" => {
                assert_eq!((found.project, found.push), (Project::Empty, Push::Idle));
                assert!(found.actions.contains(&Offer::RetryPush));
                assert!(found.actions.contains(&Offer::DeleteEmptyProject));
            }
            "accepted" => assert_eq!(
                (found.project, found.push, found.actions.clone()),
                (Project::Published, Push::Accepted, vec![])
            ),
            _ => {
                assert_eq!(
                    (found.project, found.push, found.actions.clone()),
                    (Project::Published, Push::Conflict, vec![])
                );
                assert_eq!(f.cloud_main(), competing);
            }
        }
    }
}

#[test]
fn a_migrated_version_1_compensation_finishes_after_the_checkout_changes() {
    let f = Fixture::new("main");
    f.stop(Point::AfterRemoteConfigured, |f| f.start(&f.request()));
    let legacy = as_version_1(&f, "compensation-pending");
    f.sh(&["switch", "-qc", "continued-after-v1"]);
    f.commit("continued.md", "continued work\n");
    std::fs::write(f.local.path().join("dirty-after-v1.txt"), "preserve me\n").unwrap();
    let before = f.snapshot();
    let pending = f.coordinator().state(&f.request());
    assert!(pending.ok, "{:?}", pending.error);
    assert_eq!(state(&pending).cleanup, Cleanup::Requested);
    assert_eq!(state(&pending).actions, [Offer::FinishCleanup]);
    let finished = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &legacy.operation_id));
    assert!(
        finished.ok && finished.state.is_none(),
        "{:?}",
        finished.error
    );
    assert_eq!(f.snapshot(), before);
}

#[test]
fn an_unavailable_project_offers_only_finish_cleanup() {
    let f = Fixture::new("main");
    f.world.log(|log| log.unavailable = true);
    let failed = f.start(&f.request());
    assert_eq!(code(&failed), Some(Code::ProjectUnavailable));
    assert!(!failed.error.as_ref().unwrap().retryable);
    assert_eq!(state(&failed).project, Project::Unavailable);
    assert_eq!(state(&failed).actions, [Offer::FinishCleanup]);
    assert_eq!(f.vault.memory.0.lock().unwrap().len(), 1);
    let operation = f.pending().operation_id;
    let finished = f
        .coordinator()
        .cleanup(&f.with(Action::Initialize, &operation));
    assert!(
        finished.ok && finished.state.is_none(),
        "{:?}",
        finished.error
    );
    assert_eq!(f.vault.memory.0.lock().unwrap().len(), 0);
    assert_eq!(f.abandons().len(), 1);
    assert!(f.journal_text().is_none());
}
