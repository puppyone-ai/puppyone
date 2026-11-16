//! `requireGitRepository` + the Git import source (`project-entry-service.mjs`,
//! `project-import/service.mjs`): a GitHub or GitLab repository cloned into a
//! fresh staging folder beside its destination, then renamed into place.
//! An existing destination is never touched; a cancelled or failed clone
//! leaves nothing behind.
use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

mod publication;
pub use publication::Publication;

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
    clone_into_with(parent, repository, cancel, super::git::clone_repository)
}

/// UI-owned clone: cancellation and publication share one atomic boundary.
pub fn clone_with_publication(
    parent: &Path,
    repository: &Repository,
    publication: &Publication,
) -> Result<PathBuf, String> {
    clone_into_using(
        parent,
        repository,
        publication.cancellation(),
        super::git::clone_repository,
        Some(publication),
    )
}

fn clone_into_with(
    parent: &Path,
    repository: &Repository,
    cancel: &AtomicBool,
    clone: impl FnOnce(&Path, &str, &AtomicBool) -> Result<(), String>,
) -> Result<PathBuf, String> {
    clone_into_using(parent, repository, cancel, clone, None)
}

fn clone_into_using(
    parent: &Path,
    repository: &Repository,
    cancel: &AtomicBool,
    clone: impl FnOnce(&Path, &str, &AtomicBool) -> Result<(), String>,
    publication: Option<&Publication>,
) -> Result<PathBuf, String> {
    let check_cancel = || {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            Err("Repository cloning was cancelled.".to_owned())
        } else {
            Ok(())
        }
    };
    check_cancel()?;
    super::templates::require_project_name(&repository.name)?;
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
    clone(staging.path(), &repository.url, cancel).map_err(|error| {
        let diagnostic = error.to_ascii_lowercase();
        if ["authentication failed", "could not read username", "permission denied (publickey)", "terminal prompts disabled"]
            .iter().any(|message| diagnostic.contains(message))
        {
            return format!("{} authentication failed. Use an SSH URL with a configured key or sign in with your Git credential helper.", repository.provider.label());
        }
        let line = error
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("Clone failed");
        line.trim().chars().take(300).collect::<String>()
    })?;
    check_cancel()?;
    let publish = || {
        super::templates::publish(staging.path(), &target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!(
                    "A file or folder named “{}” already exists in that location.",
                    repository.name
                )
            } else {
                error.to_string()
            }
        })
    };
    match publication {
        Some(publication) => publication.commit(publish)?,
        None => publish()?,
    }
    // Ownership moves only after the exclusive publication succeeds. On any
    // failure the TempDir still owns and removes only our staged directory.
    let _ = staging.keep();
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn entries(parent: &Path) -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn cloning_keeps_the_destination_private_and_publishes_only_the_complete_directory() {
        let parent = tempfile::tempdir().unwrap();
        let repository = parse("https://github.com/owner/repository.git").unwrap();
        let target = parent.path().join("repository");
        let result = clone_into_with(
            parent.path(),
            &repository,
            &AtomicBool::new(false),
            |staging, url, _| {
                assert!(!target.exists());
                assert_eq!(url, "https://github.com/owner/repository.git");
                assert_eq!(staging.parent(), Some(parent.path()));
                assert!(
                    staging
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(".puppyone-import-repository-")
                );
                std::fs::write(staging.join("README.md"), b"hello\n").unwrap();
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(result, target);
        assert_eq!(std::fs::read(target.join("README.md")).unwrap(), b"hello\n");
        assert_eq!(entries(parent.path()), ["repository"]);
    }

    #[test]
    fn cancellation_before_or_after_clone_cleans_only_its_own_staging_directory() {
        let parent = tempfile::tempdir().unwrap();
        std::fs::write(parent.path().join("keep.txt"), "keep").unwrap();
        let repository = parse("https://github.com/owner/repository.git").unwrap();
        let cancel = AtomicBool::new(false);
        let result = clone_into_with(parent.path(), &repository, &cancel, |staging, _, cancel| {
            std::fs::write(staging.join("partial"), "partial").unwrap();
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        });
        assert_eq!(result.unwrap_err(), "Repository cloning was cancelled.");
        assert_eq!(entries(parent.path()), ["keep.txt"]);
        let result = clone_into_with(parent.path(), &repository, &cancel, |_, _, _| {
            panic!("cancelled import started cloning")
        });
        assert_eq!(result.unwrap_err(), "Repository cloning was cancelled.");
        assert_eq!(entries(parent.path()), ["keep.txt"]);
        assert_eq!(
            std::fs::read_to_string(parent.path().join("keep.txt")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn controlled_cancellation_after_materialization_cleans_staging_without_publishing() {
        let parent = tempfile::tempdir().unwrap();
        std::fs::write(parent.path().join("keep.txt"), "keep").unwrap();
        let repository = parse("https://github.com/owner/repository.git").unwrap();
        let cancelled = std::sync::Arc::new(AtomicBool::new(false));
        let (publication, _) = Publication::new(cancelled.clone());
        let result = clone_into_using(
            parent.path(),
            &repository,
            &cancelled,
            |staging, _, _| {
                std::fs::write(staging.join("complete.md"), "complete").unwrap();
                assert!(publication.cancel());
                Ok(())
            },
            Some(&publication),
        );
        assert!(result.is_err());
        assert_eq!(entries(parent.path()), ["keep.txt"]);
    }

    #[test]
    fn a_destination_created_during_clone_is_preserved_even_when_empty() {
        for empty in [true, false] {
            let parent = tempfile::tempdir().unwrap();
            let repository = parse("https://github.com/owner/repository.git").unwrap();
            let target = parent.path().join("repository");
            let result = clone_into_with(
                parent.path(),
                &repository,
                &AtomicBool::new(false),
                |staging, _, _| {
                    std::fs::write(staging.join("README.md"), "cloned").unwrap();
                    std::fs::create_dir(&target).unwrap();
                    if !empty {
                        std::fs::write(target.join("keep.txt"), "keep").unwrap();
                    }
                    Ok(())
                },
            );
            assert!(result.unwrap_err().contains("already exists"));
            assert_eq!(entries(parent.path()), ["repository"]);
            assert!(!target.join("README.md").exists());
            if empty {
                assert!(entries(&target).is_empty());
            } else {
                assert_eq!(
                    std::fs::read_to_string(target.join("keep.txt")).unwrap(),
                    "keep"
                );
            }
        }
    }

    #[test]
    fn clone_failures_keep_provider_authentication_advice_and_bound_other_diagnostics() {
        for (provider, url) in [
            ("GitHub", "https://github.com/o/repository.git"),
            ("GitLab", "https://gitlab.com/o/repository.git"),
        ] {
            for failure in [
                "authentication failed",
                "could not read Username",
                "Permission denied (publickey)",
                "terminal prompts disabled",
            ] {
                let parent = tempfile::tempdir().unwrap();
                std::fs::write(parent.path().join("keep.txt"), "keep").unwrap();
                let repository = parse(url).unwrap();
                let error = clone_into_with(
                    parent.path(),
                    &repository,
                    &AtomicBool::new(false),
                    |staging, _, _| {
                        std::fs::write(staging.join("partial"), "partial").unwrap();
                        Err(format!("progress\nfatal: {failure}"))
                    },
                )
                .unwrap_err();
                assert_eq!(
                    error,
                    format!(
                        "{provider} authentication failed. Use an SSH URL with a configured key or sign in with your Git credential helper."
                    )
                );
                assert_eq!(entries(parent.path()), ["keep.txt"]);
            }
        }
        let parent = tempfile::tempdir().unwrap();
        let repository = parse("https://github.com/o/repository.git").unwrap();
        for (diagnostic, expected) in [
            (
                "progress\nfatal: repository not found\n".into(),
                "fatal: repository not found".into(),
            ),
            (format!("progress\n{}", "错".repeat(301)), "错".repeat(300)),
        ] {
            let error = clone_into_with(
                parent.path(),
                &repository,
                &AtomicBool::new(false),
                |_, _, _| Err(diagnostic),
            )
            .unwrap_err();
            assert_eq!(error, expected);
            assert!(entries(parent.path()).is_empty());
        }
    }

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
        let (publication, _) = Publication::new(std::sync::Arc::new(AtomicBool::new(false)));
        let cloned = clone_with_publication(&parent, &repository, &publication).unwrap();
        assert!(!publication.publishing());
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
