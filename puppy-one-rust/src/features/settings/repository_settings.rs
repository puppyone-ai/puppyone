//! Repository facts for Settings → Git / Host Server. Owns the background
//! read so views stay free of platform access (`RepositorySettingsViews.tsx`).
use crate::{
    platform::git::{RepositoryInfo, repository_info},
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
            wake,
        }
    }
    /// Track the open project; a different root discards earlier facts.
    pub fn set_root(&mut self, root: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.root != root {
            self.root = root;
            self.info = None;
            self.error = None;
            self.refresh(cx);
        }
    }
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
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
        crate::localization::spawn(move || {
            let cancel = Arc::new(AtomicBool::new(false));
            let _ = tx.send(repository_info(&root, &cancel));
            wake.notify();
        });
        cx.notify();
    }
    fn receive(&mut self, cx: &mut Context<Self>) {
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
    } else if !url.contains("://") && url.contains('@') && url.contains(':') {
        "SSH"
    } else {
        "git"
    }
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
        assert_eq!(
            mask_remote_url("https://user:token@example.com/a.git"),
            "https://••••:••••@example.com/a.git"
        );
        assert_eq!(
            mask_remote_url("git@github.com:a/b.git"),
            "git@github.com:a/b.git"
        );
    }
}
