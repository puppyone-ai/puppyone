//! Repository facts for Settings → Git / Host Server. Owns the background
//! read so views stay free of platform access (`RepositorySettingsViews.tsx`).
use super::workspace_config::{self, WorkspaceConfig};
use crate::{
    platform::git::{Remote, RepositoryInfo, repository_info},
    wake::Wake,
};
use gpui::*;
use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool, mpsc},
};
pub struct RepositorySettings {
    root: Option<PathBuf>,
    pub loading: bool,
    pub info: Option<RepositoryInfo>,
    pub error: Option<String>,
    pending: Option<(u64, mpsc::Receiver<Result<RepositoryInfo, String>>)>,
    generation: u64,
    /// Dev-capture: fixed facts that no background read may replace.
    fixed: bool,
    /// `.puppyone/config.json` (`workspaceConfig`): the saved document, a
    /// read/write in flight and its last error.
    pub config: Option<WorkspaceConfig>,
    pub config_saving: bool,
    pub config_error: Option<String>,
    config_pending: Option<(u64, mpsc::Receiver<Result<WorkspaceConfig, String>>)>,
    wake: Wake,
}
impl RepositorySettings {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (wake, rx) = Wake::channel();
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this.update_in(cx, |s, _, cx| s.receive(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            root: None,
            loading: false,
            info: None,
            error: None,
            pending: None,
            generation: 0,
            fixed: false,
            config: None,
            config_saving: false,
            config_error: None,
            config_pending: None,
            wake,
        }
    }
    /// Track the open project; a different root discards earlier facts.
    pub fn set_root(&mut self, root: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.root != root {
            self.root = root;
            self.info = None;
            self.error = None;
            self.config = None;
            self.config_error = None;
            self.refresh(cx);
        }
    }
    /// Dev-capture: the reference repository of
    /// `tools/reference-settings-entry.tsx`: one commit on `main`, no
    /// upstream; `with_remotes` (the `git-remotes` case) adds a PuppyOne
    /// project remote and a GitHub remote whose push URL differs.
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(&mut self, with_remotes: bool, cx: &mut Context<Self>) {
        let remotes = if with_remotes {
            let puppyone = "https://git.puppyone.ai/git/p7k2m9x4.git";
            vec![
                Remote {
                    name: "origin".into(),
                    fetch_url: Some(puppyone.into()),
                    push_url: Some(puppyone.into()),
                    branches: 2,
                },
                Remote {
                    name: "github".into(),
                    fetch_url: Some("git@github.com:acme/desktop.git".into()),
                    push_url: Some("https://github.com/acme/desktop.git".into()),
                    branches: 1,
                },
            ]
        } else {
            vec![]
        };
        let info = RepositoryInfo {
            is_repo: true,
            branch: Some("main".into()),
            local_branches: 1,
            remote_branches: remotes.iter().map(|r| r.branches).sum(),
            upstream: None,
            ahead: 0,
            behind: 0,
            head: Some("4f2c9a1e7b3d5c6a8e9f0b1c2d3e4f5a6b7c8d9e".into()),
            remotes,
        };
        self.fixed = true;
        self.generation += 1;
        self.pending = None;
        self.loading = false;
        self.error = None;
        self.info = Some(info);
        self.config = Some(WorkspaceConfig::default());
        self.config_pending = None;
        cx.notify();
    }
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.fixed {
            return;
        }
        let Some(root) = self.root.clone() else {
            self.loading = false;
            self.pending = None;
            return;
        };
        self.generation += 1;
        let generation = self.generation;
        let (tx, rx) = mpsc::sync_channel(1);
        self.pending = Some((generation, rx));
        self.loading = true;
        let wake = self.wake.clone();
        let config_root = root.clone();
        crate::localization::spawn(move || {
            let cancel = Arc::new(AtomicBool::new(false));
            let _ = tx.send(repository_info(&root, &cancel));
            wake.notify();
        });
        self.run_config(move || workspace_config::read(&config_root));
        cx.notify();
    }
    /// `onPuppyoneConfigChange`: write the draft; the saved document returns.
    pub fn save_config(&mut self, config: WorkspaceConfig, cx: &mut Context<Self>) {
        let Some(root) = self.root.clone() else {
            return;
        };
        if self.config_saving || self.fixed {
            return;
        }
        self.config_saving = true;
        self.config_error = None;
        self.run_config(move || workspace_config::write(&root, &config));
        cx.notify();
    }
    fn run_config(
        &mut self,
        work: impl FnOnce() -> Result<WorkspaceConfig, String> + Send + 'static,
    ) {
        let (tx, rx) = mpsc::sync_channel(1);
        self.config_pending = Some((self.generation, rx));
        let wake = self.wake.clone();
        crate::localization::spawn(move || {
            let _ = tx.send(work());
            wake.notify();
        });
    }
    fn receive(&mut self, cx: &mut Context<Self>) {
        if let Some((generation, rx)) = &self.config_pending
            && let Ok(result) = rx.try_recv()
        {
            if *generation == self.generation {
                self.config_saving = false;
                match result {
                    Ok(config) => {
                        self.config = Some(config);
                        self.config_error = None;
                    }
                    Err(error) => self.config_error = Some(error),
                }
            }
            self.config_pending = None;
            cx.notify();
        }
        let Some((generation, rx)) = &self.pending else {
            return;
        };
        if let Ok(result) = rx.try_recv() {
            if *generation == self.generation {
                self.loading = false;
                match result {
                    Ok(info) => {
                        self.info = Some(info);
                        self.error = None;
                    }
                    Err(error) => self.error = Some(error),
                }
            }
            self.pending = None;
            cx.notify();
        }
    }
}

/// `remoteKindLabel` from `settings/utils.ts`.
pub fn remote_kind_label(url: Option<&str>) -> &'static str {
    let Some(url) = url else { return "git" };
    let lower = url.to_lowercase();
    if lower.contains("puppyone") {
        "puppyone"
    } else if lower.contains("github.com") {
        "GitHub"
    } else if lower.contains("gitlab.com") {
        "GitLab"
    } else if lower.contains("bitbucket.org") {
        "Bitbucket"
    } else if is_scp_like(url) {
        "SSH"
    } else {
        "git"
    }
}
/// `/^[\w.-]+@[\w.-]+:/`: an scp-style `user@host:path` remote.
fn is_scp_like(url: &str) -> bool {
    let word = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-');
    let Some((user, rest)) = url.split_once('@') else {
        return false;
    };
    let host_len = rest.find(|c: char| !word(c)).unwrap_or(rest.len());
    !user.is_empty() && user.chars().all(word) && host_len > 0 && rest[host_len..].starts_with(':')
}
/// What a PuppyOne remote names (`PuppyoneRemoteInfo["kind"]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PuppyoneRemoteKind {
    AccessPoint,
    Project,
    Scope,
}
/// `PuppyoneRemoteInfo`: the remote's host, what it names and how that
/// reads (an access key masked).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PuppyoneRemoteInfo {
    pub kind: PuppyoneRemoteKind,
    /// `url.host`: the host name and any explicit port.
    pub host: String,
    pub display_id: String,
    /// `remoteIdentity`: one target per origin, kind and IDs.
    identity: String,
}
/// `parsePuppyoneRemote` from `source-control/remotes.ts`: a credential-free
/// http(s) URL whose path is an access point (`/git/ap/<key>.git`), a scope
/// (`/git/<project>/scopes/<scope>.git`) or a project (`/git/<project>.git`).
pub fn parse_puppyone_remote(url: Option<&str>) -> Option<PuppyoneRemoteInfo> {
    let url = url::Url::parse(url?).ok()?;
    let canonical = matches!(url.scheme(), "http" | "https") && url.has_host();
    let credential = !url.username().is_empty()
        || url.password().is_some_and(|p| !p.is_empty())
        || url.query().is_some_and(|q| !q.is_empty())
        || url.fragment().is_some_and(|f| !f.is_empty());
    if !canonical || credential {
        return None;
    }
    // `CANONICAL_GIT_ID`: `[A-Za-z0-9][A-Za-z0-9_-]{0,199}`.
    let id = |s: &str| {
        let mut chars = s.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
            && s.len() <= 200
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
    };
    let path = url.path().strip_prefix("/git/")?.strip_suffix(".git")?;
    let origin = url.origin().ascii_serialization().to_lowercase();
    let host = match url.port() {
        Some(port) => format!("{}:{port}", url.host_str()?),
        None => url.host_str()?.to_owned(),
    };
    let (kind, display_id, ids) = if let Some(key) = path.strip_prefix("ap/") {
        if key.is_empty() || key.contains('/') {
            return None;
        }
        (
            PuppyoneRemoteKind::AccessPoint,
            mask_secret(key),
            key.to_owned(),
        )
    } else if let Some((project, scope)) = path.split_once("/scopes/") {
        if !id(project) || !id(scope) {
            return None;
        }
        let ids = format!("{project}/{scope}");
        (
            PuppyoneRemoteKind::Scope,
            ids.clone(),
            ids.replace('/', "\n"),
        )
    } else if id(path) {
        (
            PuppyoneRemoteKind::Project,
            path.to_owned(),
            path.to_owned(),
        )
    } else {
        return None;
    };
    Some(PuppyoneRemoteInfo {
        identity: format!("{origin}\n{kind:?}\n{ids}"),
        kind,
        host,
        display_id,
    })
}
/// `parsePuppyoneRemote(url) !== null`.
pub fn is_puppyone_remote(url: Option<&str>) -> bool {
    parse_puppyone_remote(url).is_some()
}
/// `getPuppyoneRemote`: the one PuppyOne target of the remotes — its remote,
/// URL (the fetch URL first) and info. A remote whose fetch and push URLs
/// disagree on being PuppyOne, or two different targets, is a conflict and
/// yields none.
pub fn puppyone_remote(remotes: &[Remote]) -> Option<(&Remote, &str, PuppyoneRemoteInfo)> {
    let mut candidates = vec![];
    for remote in remotes {
        let fetch = parse_puppyone_remote(remote.fetch_url.as_deref());
        let push = parse_puppyone_remote(remote.push_url.as_deref());
        if fetch.is_some() != push.is_some() {
            return None;
        }
        for (url, info) in [(&remote.fetch_url, fetch), (&remote.push_url, push)] {
            if let (Some(url), Some(info)) = (url, info) {
                candidates.push((remote, url.as_str(), info));
            }
        }
    }
    let first = candidates.first()?;
    candidates
        .iter()
        .all(|(_, _, info)| info.identity == first.2.identity)
        .then(|| first.clone())
}
/// `maskSecret` from `source-control/remotes.ts`.
pub fn mask_secret(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 8 {
        return "••••".into();
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}
/// `maskRemoteUrl`: access-point keys, passwords and usernames never appear in full.
pub fn mask_remote_url(url: &str) -> String {
    let mut masked = url.to_owned();
    if let Some(start) = masked.find("/git/ap/")
        && let Some(end) = masked[start + 8..].find(".git")
    {
        let key = masked[start + 8..start + 8 + end].to_owned();
        if !key.contains('/') {
            masked.replace_range(start + 8..start + 8 + end, &mask_secret(&key));
        }
    }
    if let Some((scheme, rest)) = masked.split_once("://")
        && let Some((userinfo, host)) = rest.split_once('@')
        && !userinfo.contains('/')
    {
        let (user, password) = match userinfo.split_once(':') {
            Some((u, p)) => (u, Some(p)),
            None => (userinfo, None),
        };
        let user = if user.is_empty() {
            String::new()
        } else {
            mask_secret(user)
        };
        let auth = match password {
            Some(p) if !p.is_empty() => format!("{user}:••••"),
            _ => user,
        };
        return format!("{scheme}://{auth}@{host}");
    }
    masked
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn remote_labels_and_masking() {
        assert_eq!(remote_kind_label(Some("git@github.com:a/b.git")), "GitHub");
        assert_eq!(remote_kind_label(Some("me@host:repo.git")), "SSH");
        assert_eq!(remote_kind_label(None), "git");
        assert_eq!(remote_kind_label(Some("a b@host:repo.git")), "git");
        assert_eq!(remote_kind_label(Some("ssh://me@host:22/repo.git")), "git");
        assert_eq!(
            mask_remote_url("https://user:token@example.com/a.git"),
            "https://••••:••••@example.com/a.git"
        );
        assert_eq!(
            mask_remote_url("git@github.com:a/b.git"),
            "git@github.com:a/b.git"
        );
    }
    #[test]
    fn puppyone_remotes_follow_the_product_parser() {
        let yes = [
            "https://git.puppyone.ai/git/p7k2m9x4.git",
            "http://localhost:8080/git/proj_1/scopes/main-scope.git",
            "https://git.puppyone.ai/git/ap/0123456789abcdef.git",
        ];
        for url in yes {
            assert!(is_puppyone_remote(Some(url)), "{url}");
        }
        let no = [
            "https://user:token@git.puppyone.ai/git/p7k2m9x4.git",
            "https://git.puppyone.ai/git/p7k2m9x4.git?x=1",
            "https://git.puppyone.ai/git/_bad.git",
            "https://git.puppyone.ai/git/a/b.git",
            "https://git.puppyone.ai/git/ap/a/b.git",
            "ssh://git.puppyone.ai/git/p7k2m9x4.git",
            "git@github.com:puppyone/desktop.git",
            "not a url",
        ];
        for url in no {
            assert!(!is_puppyone_remote(Some(url)), "{url}");
        }
        assert!(!is_puppyone_remote(None));
    }
    /// `cloudRepositoryContextResolver.test.ts`: classification, the fetch
    /// and push pair, conflicts and masked access keys.
    #[test]
    fn the_puppyone_remote_is_one_target_or_none() {
        let project =
            parse_puppyone_remote(Some("https://cloud.example/git/project-1.git")).unwrap();
        assert_eq!(
            (
                project.kind,
                project.host.as_str(),
                project.display_id.as_str()
            ),
            (PuppyoneRemoteKind::Project, "cloud.example", "project-1")
        );
        let scope = parse_puppyone_remote(Some(
            "http://localhost:8080/git/project-1/scopes/scope-docs.git",
        ))
        .unwrap();
        assert_eq!(
            (scope.kind, scope.host.as_str(), scope.display_id.as_str()),
            (
                PuppyoneRemoteKind::Scope,
                "localhost:8080",
                "project-1/scope-docs"
            )
        );
        let access = parse_puppyone_remote(Some(
            "https://cloud.example/git/ap/pwg_secret-value-1234567890.git",
        ))
        .unwrap();
        assert_eq!(
            (access.kind, access.display_id.as_str()),
            (PuppyoneRemoteKind::AccessPoint, "pwg_…7890")
        );
        assert!(
            parse_puppyone_remote(Some(
                "https://cloud.example/git/project-1/scopes/scope%2Fchild.git"
            ))
            .is_none()
        );
        let remote = |name: &str, fetch: &str, push: &str| Remote {
            name: name.into(),
            fetch_url: Some(fetch.into()),
            push_url: Some(push.into()),
            branches: 0,
        };
        let one = "https://cloud.example/git/project-1.git";
        let other = "https://cloud.example/git/project-2.git";
        let github = "https://github.com/acme/desktop.git";
        let remotes = [
            remote("github", github, github),
            remote("puppyone", one, one),
        ];
        let (found, url, info) = puppyone_remote(&remotes).unwrap();
        assert_eq!(
            (found.name.as_str(), url, info.kind),
            ("puppyone", one, PuppyoneRemoteKind::Project)
        );
        // The same target under two names is still one target.
        assert!(puppyone_remote(&[remote("a", one, one), remote("b", one, one)]).is_some());
        assert!(puppyone_remote(&[remote("puppyone", one, other)]).is_none());
        assert!(puppyone_remote(&[remote("puppyone", one, github)]).is_none());
        assert!(puppyone_remote(&[remote("a", one, one), remote("b", other, other)]).is_none());
        assert!(puppyone_remote(&[remote("github", github, github)]).is_none());
    }
}
