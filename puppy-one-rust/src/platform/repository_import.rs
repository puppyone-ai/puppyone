//! `requireGitRepository` + the Git import source (`project-entry-service.mjs`,
//! `project-import/service.mjs`): a GitHub or GitLab repository cloned into a
//! fresh staging folder beside its destination, then renamed into place.
//! An existing destination is never touched; a cancelled or failed clone
//! leaves nothing behind.
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Duration,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    GitHub,
    GitLab,
}
impl Provider {
    pub fn label(self) -> &'static str {
        match self {
            Self::GitHub => "GitHub",
            Self::GitLab => "GitLab",
        }
    }
    fn for_host(host: &str) -> Option<Self> {
        match host.to_ascii_lowercase().as_str() {
            "github.com" => Some(Self::GitHub),
            "gitlab.com" => Some(Self::GitLab),
            _ => None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Repository {
    pub url: String,
    pub provider: Provider,
    pub name: String,
}

fn portable(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}
fn result(url: &str, provider: Provider, segments: &[&str]) -> Option<Repository> {
    let count_ok = match provider {
        Provider::GitHub => segments.len() == 2,
        Provider::GitLab => segments.len() >= 2,
    };
    if !count_ok || !segments.iter().all(|s| portable(s)) {
        return None;
    }
    let last = segments.last()?;
    let name = last.strip_suffix(".git").unwrap_or(last);
    portable(name).then(|| Repository {
        url: url.to_owned(),
        provider,
        name: name.to_owned(),
    })
}
/// `detectRepositoryProvider`.
pub fn detect(value: &str) -> Option<Provider> {
    let value = value.trim().to_ascii_lowercase();
    if value.contains("github.com") {
        Some(Provider::GitHub)
    } else if value.contains("gitlab.com") {
        Some(Provider::GitLab)
    } else {
        None
    }
}
/// `requireGitRepository`: HTTPS or SSH (`git@host:` or `ssh://git@host/`),
/// no credentials, port, query or fragment; GitHub `owner/name`, GitLab
/// `group/…/name`.
pub fn parse(value: &str) -> Option<Repository> {
    let url = value.trim();
    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_control) {
        return None;
    }
    if let Some(rest) = url.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        let provider = Provider::for_host(host)?;
        let path = path.trim_end_matches('/');
        let segments: Vec<&str> = path.split('/').collect();
        return result(url, provider, &segments);
    }
    let parsed = url::Url::parse(url).ok()?;
    let provider = Provider::for_host(parsed.host_str()?)?;
    let credentials_ok = match parsed.scheme() {
        "https" => parsed.username().is_empty() && parsed.password().is_none(),
        "ssh" => parsed.password().is_none() && matches!(parsed.username(), "" | "git"),
        _ => return None,
    };
    if !credentials_ok
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    result(url, provider, &segments)
}

/// Clone `repository` into `parent/<name>`; `cancel` stops it.
pub fn clone_into(
    parent: &Path,
    repository: &Repository,
    cancel: &AtomicBool,
) -> Result<PathBuf, String> {
    let target = parent.join(&repository.name);
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(format!(
            "A file or folder named “{}” already exists in that location.",
            repository.name
        ));
    }
    let staging = tempfile::Builder::new()
        .prefix(&format!(".puppyone-import-{}-", repository.name))
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    super::process::run(
        Path::new("/usr/bin/git"),
        &["clone", "--progress", "--", &repository.url, "."],
        staging.path(),
        None,
        Duration::from_secs(30 * 60),
        cancel,
    )
    .map_err(|error| {
        let line = error
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("Clone failed");
        line.trim().chars().take(300).collect::<String>()
    })?;
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(format!(
            "A file or folder named “{}” already exists in that location.",
            repository.name
        ));
    }
    let staged = staging.keep();
    std::fs::rename(&staged, &target).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staged);
        e.to_string()
    })?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn repository_urls_follow_the_product_rules() {
        let ok = |url: &str, name: &str, provider: Provider| {
            let repo = parse(url).unwrap_or_else(|| panic!("{url}"));
            assert_eq!(
                (repo.name.as_str(), repo.provider),
                (name, provider),
                "{url}"
            );
        };
        ok(
            "https://github.com/puppyone-ai/puppyone",
            "puppyone",
            Provider::GitHub,
        );
        ok(
            "https://github.com/puppyone-ai/puppyone.git",
            "puppyone",
            Provider::GitHub,
        );
        ok("git@github.com:owner/repo.git", "repo", Provider::GitHub);
        ok(
            "ssh://git@gitlab.com/group/sub/project.git",
            "project",
            Provider::GitLab,
        );
        ok(
            "https://gitlab.com/group/sub/project",
            "project",
            Provider::GitLab,
        );
        for bad in [
            "http://github.com/a/b",
            "https://user:pw@github.com/a/b",
            "https://github.com:444/a/b",
            "https://github.com/a/b?x=1",
            "https://github.com/a/b/c",
            "https://example.com/a/b",
            "https://github.com/a/..",
            "-c core.sshCommand=x",
            "file:///tmp/repo",
        ] {
            assert!(parse(bad).is_none(), "{bad}");
        }
        assert_eq!(detect("  https://GitLab.com/x"), Some(Provider::GitLab));
    }

    #[test]
    fn a_clone_lands_in_place_and_never_replaces_an_existing_folder() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        std::fs::create_dir(&source).unwrap();
        let git = |dir: &Path, args: &[&str]| {
            std::process::Command::new("/usr/bin/git")
                .args(args)
                .current_dir(dir)
                .output()
                .unwrap()
        };
        git(&source, &["init", "-q", "-b", "main"]);
        git(&source, &["config", "user.email", "t@example.com"]);
        git(&source, &["config", "user.name", "T"]);
        std::fs::write(source.join("a.md"), "a").unwrap();
        git(&source, &["add", "a.md"]);
        git(&source, &["commit", "-q", "-m", "a"]);
        let parent = temp.path().join("projects");
        std::fs::create_dir(&parent).unwrap();
        let repository = Repository {
            url: source.display().to_string(),
            provider: Provider::GitHub,
            name: "notes".into(),
        };
        let cloned = clone_into(&parent, &repository, &AtomicBool::new(false)).unwrap();
        assert!(cloned.join("a.md").exists());
        assert!(clone_into(&parent, &repository, &AtomicBool::new(false)).is_err());
        // No staging folder is left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(".puppyone-import")
            })
            .collect();
        assert!(leftovers.is_empty());
    }
}
