//! A scripted Cloud and Git for the first publication, for these tests and
//! the window's (`test-support`).
use super::{
    api::{CloudOps, Credential, Organization},
    git::{GitOps, Identity, Remote, Status},
    journal::{CredentialConfig, Record},
    vault::Memory,
    *,
};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub(super) const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
pub(super) const NEXT: &str = "89abcdef0123456789abcdef0123456789abcdef";
pub(super) const URL: &str = "https://api.puppyone.ai/git/project-a.git";

/// A repository whose Git and Cloud behaviour each test scripts.
pub struct Fake {
    pub git_dir: PathBuf,
    pub(super) state: Mutex<FakeState>,
}
#[derive(Default)]
pub(super) struct FakeState {
    pub remote: Option<String>,
    pub head: String,
    pub branch: String,
    /// Cloud `refs/heads/main`.
    pub cloud_main: Option<String>,
    /// Scripted push failures, in order.
    pub push_failures: VecDeque<Code>,
    /// The push failure still landed (a lost receipt).
    pub push_lands: bool,
    pub creates: usize,
    pub create_fails_after_creating: bool,
    pub credentials: usize,
    pub abandons: usize,
    pub abandon_refused: bool,
    pub revokes: usize,
    pub cleaned: bool,
    pub finalized: bool,
    pub dirty: bool,
    /// The credential is issued but its response is lost, once.
    pub credential_lost: bool,
    /// Every secret a credential was requested with.
    pub secrets: Vec<String>,
    /// The checkout drifts while the upload runs: dirty files, a later
    /// commit and another branch.
    pub drift_during_push: bool,
}
impl Fake {
    pub fn new() -> (tempfile::TempDir, Arc<Self>) {
        let temp = tempfile::tempdir().unwrap();
        let git_dir = temp.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        let fake = Arc::new(Self {
            git_dir,
            state: Mutex::new(FakeState {
                head: COMMIT.into(),
                branch: "main".into(),
                ..Default::default()
            }),
        });
        (temp, fake)
    }
    pub(super) fn with<T>(&self, f: impl FnOnce(&mut FakeState) -> T) -> T {
        f(&mut self.state.lock().unwrap())
    }
    pub fn fail_next_push(&self, code: Code) {
        self.with(|s| s.push_failures.push_back(code));
    }
}
impl GitOps for Fake {
    fn identity(&self, root: &Path) -> Result<Identity, PublishError> {
        Ok(Identity {
            git_dir: self.git_dir.clone(),
            common_dir: self.git_dir.clone(),
            top_level: root.to_path_buf(),
        })
    }
    fn status(&self, _: &Path) -> Result<Status, PublishError> {
        Ok(self.with(|s| Status {
            head: Some(s.head.clone()),
            branch: Some(s.branch.clone()),
            commits: 1,
            dirty: s.dirty,
        }))
    }
    fn remote(&self, _: &Path) -> Result<Remote, PublishError> {
        Ok(self.with(|s| match &s.remote {
            Some(url) => Remote::Exact(url.clone()),
            None => Remote::Missing,
        }))
    }
    fn source_commit(&self, _: &Path, branch: &str) -> Result<String, PublishError> {
        self.with(|s| {
            if branch == s.branch {
                Ok(s.head.clone())
            } else {
                Err(PublishError::new(Code::SourceMissing, "missing", false))
            }
        })
    }
    fn preflight(&self, _: &Path, _: &str) -> Result<(), PublishError> {
        Ok(())
    }
    fn commit_exists(&self, _: &Path, _: &str) -> bool {
        true
    }
    fn prepare_credential_config(
        &self,
        _: &Path,
        url: &str,
        _: &str,
    ) -> Result<CredentialConfig, PublishError> {
        Ok(CredentialConfig {
            version: 1,
            scope_url: url.into(),
            helper: "osxkeychain".into(),
            previous_helpers: vec![],
            previous_use_http_path: vec![],
        })
    }
    fn configure_remote(&self, _: &Path, record: &Record, _: &str) -> Result<bool, PublishError> {
        self.with(|s| {
            let created = s.remote.is_none();
            s.remote = record.canonical_remote_url.clone();
            Ok(created)
        })
    }
    fn push(&self, _: &Path, record: &Record, _: &str) -> Result<(), PublishError> {
        self.with(|s| {
            if s.drift_during_push {
                s.dirty = true;
                s.head = NEXT.into();
                s.branch = "feature".into();
            }
            if let Some(code) = s.push_failures.pop_front() {
                if s.push_lands {
                    s.cloud_main = Some(record.attempt.commit_oid.clone());
                }
                return Err(PublishError::new(code, "scripted", true));
            }
            match &s.cloud_main {
                Some(main) if *main != record.attempt.commit_oid => {
                    Err(PublishError::new(Code::RemoteRefConflict, "changed", false))
                }
                _ => {
                    s.cloud_main = Some(record.attempt.commit_oid.clone());
                    Ok(())
                }
            }
        })
    }
    fn remote_main(&self, _: &Path, _: &Record, _: &str) -> Result<Option<String>, PublishError> {
        Ok(self.with(|s| s.cloud_main.clone()))
    }
    fn finalize(&self, _: &Path, _: &Record) -> Result<(), PublishError> {
        self.with(|s| s.finalized = true);
        Ok(())
    }
    fn cleanup(&self, _: &Path, _: &Record) -> Result<(), PublishError> {
        self.with(|s| {
            s.cleaned = true;
            s.remote = None;
        });
        Ok(())
    }
}
impl CloudOps for Fake {
    fn create_project(&self, record: &Record) -> Result<String, PublishError> {
        self.with(|s| {
            s.creates += 1;
            assert_eq!(record.create_payload.org_id, "org-1");
            if s.create_fails_after_creating {
                s.create_fails_after_creating = false;
                return Err(PublishError::new(
                    Code::ProjectCreateFailed,
                    "response lost",
                    true,
                ));
            }
            Ok("project-a".into())
        })
    }
    fn issue_credential(&self, record: &Record, secret: &str) -> Result<Credential, PublishError> {
        assert!(secret.starts_with("pwg_"));
        assert_eq!(record.project_id.as_deref(), Some("project-a"));
        let lost = self.with(|s| {
            s.credentials += 1;
            s.secrets.push(secret.to_owned());
            std::mem::take(&mut s.credential_lost)
        });
        if lost {
            return Err(PublishError::new(
                Code::CredentialFailed,
                "response lost",
                true,
            ));
        }
        Ok(Credential {
            id: "credential-1".into(),
            username: api::GIT_USERNAME.into(),
            remote_url: URL.into(),
        })
    }
    fn revoke_credential(&self, _: &Record) -> Result<(), PublishError> {
        self.with(|s| s.revokes += 1);
        Ok(())
    }
    fn abandon_empty_project(&self, _: &Record) -> Result<bool, PublishError> {
        self.with(|s| {
            s.abandons += 1;
            Ok(!s.abandon_refused)
        })
    }
    fn organizations(&self) -> Result<Vec<Organization>, PublishError> {
        Ok(vec![])
    }
}
pub fn coordinator(fake: &Arc<Fake>) -> (Coordinator, Arc<Memory>) {
    let vault = Arc::new(Memory::default());
    (
        Coordinator {
            git: fake.clone(),
            cloud: fake.clone(),
            vault: vault.clone(),
        },
        vault,
    )
}
