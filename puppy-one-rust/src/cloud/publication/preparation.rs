//! `publishPreparation`: what a folder needs before it can be sent, none of
//! which needs an account — version history, a first snapshot and a branch
//! to send. Each step reads the repository first, so a prepared folder is
//! left alone and preparing it twice costs nothing.
use super::Code;
use std::{path::Path, sync::atomic::AtomicBool, time::Duration};

/// A local step, in the order a folder needs them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    EnablingVersionControl,
    CreatingSnapshot,
    CreatingBranch,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    crate::platform::process::run(
        crate::platform::git::git_executable(),
        args,
        root,
        None,
        Duration::from_secs(120),
        &AtomicBool::new(false),
    )
    .map(|out| String::from_utf8_lossy(&out).into_owned())
}

/// `prepareWorkspaceForPublish`. `author` (the account's email) signs the
/// first snapshot; without one Git's own identity does, and when that is
/// missing too the snapshot is still required. A failure is the step that
/// is still missing.
pub fn prepare(root: &Path, author: Option<&str>, step: &mut dyn FnMut(Step)) -> Result<(), Code> {
    let repository =
        git(root, &["rev-parse", "--is-inside-work-tree"]).is_ok_and(|out| out.trim() == "true");
    if !repository {
        step(Step::EnablingVersionControl);
        git(root, &["init"]).map_err(|_| Code::RepositoryRequired)?;
    }
    if git(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).is_err() {
        step(Step::CreatingSnapshot);
        git(root, &["add", "--all"]).map_err(|_| Code::CommitRequired)?;
        let author = author.map(str::trim).filter(|a| !a.is_empty());
        let identity = author.map(|a| (format!("user.name={a}"), format!("user.email={a}")));
        let mut args = Vec::new();
        if let Some((name, email)) = &identity {
            args.extend(["-c", name.as_str(), "-c", email.as_str()]);
        }
        args.extend([
            "commit",
            "--allow-empty",
            "--no-verify",
            "-m",
            "Initial snapshot",
        ]);
        git(root, &args).map_err(|_| Code::CommitRequired)?;
    }
    let named = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .is_some_and(|branch| super::valid_branch(branch.trim()));
    if !named {
        step(Step::CreatingBranch);
        let existing = git(
            root,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        )
        .map_err(|_| Code::BranchRequired)?;
        let name = branch_name(&existing.lines().collect::<Vec<_>>());
        git(root, &["switch", "-c", &name]).map_err(|_| Code::BranchRequired)?;
    }
    Ok(())
}

/// `isIdentityDeferredPreparation`: what is left needs someone to sign it,
/// not a repair.
pub fn waits_for_identity(code: Code) -> bool {
    matches!(code, Code::CommitRequired | Code::BranchRequired)
}

/// `resolveCloudPublishBranchName`: never a name a local branch has.
pub fn branch_name(existing: &[&str]) -> String {
    for candidate in ["main", "puppyone-publish"] {
        if !existing.contains(&candidate) {
            return candidate.into();
        }
    }
    (2..)
        .map(|n| format!("puppyone-publish-{n}"))
        .find(|name| !existing.contains(&name.as_str()))
        .expect("an unused suffix")
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn run(root: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new(crate::platform::git::git_executable())
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(out.status.success(), "{args:?}");
        String::from_utf8(out.stdout).unwrap()
    }

    /// `publishPreparation.test.ts`: a plain folder gets version history, a
    /// first snapshot of its files under the account's identity, and a
    /// named branch, in that order; preparing it again does nothing.
    #[test]
    fn a_plain_folder_is_prepared_once_and_left_alone_after() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.md"), "# Notes").unwrap();
        let mut steps = Vec::new();
        prepare(dir.path(), Some("dev@example.com"), &mut |s| steps.push(s)).unwrap();
        assert_eq!(
            steps[..2],
            [Step::EnablingVersionControl, Step::CreatingSnapshot]
        );
        assert_eq!(
            run(dir.path(), &["log", "-1", "--format=%an <%ae>|%s"]).trim(),
            "dev@example.com <dev@example.com>|Initial snapshot"
        );
        assert_eq!(run(dir.path(), &["ls-files"]).trim(), "notes.md");
        assert!(super::super::valid_branch(
            run(dir.path(), &["symbolic-ref", "--short", "HEAD"]).trim()
        ));
        let head = run(dir.path(), &["rev-parse", "HEAD"]);
        let mut again = Vec::new();
        prepare(dir.path(), Some("dev@example.com"), &mut |s| again.push(s)).unwrap();
        assert!(again.is_empty());
        assert_eq!(run(dir.path(), &["rev-parse", "HEAD"]), head);
    }

    /// Without an account Git's own identity signs the snapshot; a detached
    /// checkout gets a branch whose name no local branch has.
    #[test]
    fn git_identity_signs_without_an_account_and_a_detached_head_gets_a_free_name() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q", "-b", "main"]);
        run(dir.path(), &["config", "user.name", "Local"]);
        run(dir.path(), &["config", "user.email", "local@example.com"]);
        let mut steps = Vec::new();
        prepare(dir.path(), None, &mut |s| steps.push(s)).unwrap();
        assert_eq!(steps, [Step::CreatingSnapshot]);
        assert_eq!(
            run(dir.path(), &["log", "-1", "--format=%ae"]).trim(),
            "local@example.com"
        );
        run(dir.path(), &["branch", "puppyone-publish"]);
        run(dir.path(), &["checkout", "-q", "--detach"]);
        let mut steps = Vec::new();
        prepare(dir.path(), None, &mut |s| steps.push(s)).unwrap();
        assert_eq!(steps, [Step::CreatingBranch]);
        assert_eq!(
            run(dir.path(), &["symbolic-ref", "--short", "HEAD"]).trim(),
            "puppyone-publish-2"
        );
    }

    /// `reports the step that is still missing, and whether an account would
    /// supply it`; `never takes a branch name that already exists`.
    #[test]
    fn the_missing_step_is_reported_and_branch_names_never_collide() {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q", "-b", "main"]);
        // No usable identity: the snapshot is what is still missing.
        run(dir.path(), &["config", "user.useConfigOnly", "true"]);
        run(dir.path(), &["config", "user.name", ""]);
        run(dir.path(), &["config", "user.email", ""]);
        assert_eq!(
            prepare(dir.path(), None, &mut |_| {}),
            Err(Code::CommitRequired)
        );
        assert!(waits_for_identity(Code::CommitRequired));
        assert!(waits_for_identity(Code::BranchRequired));
        assert!(!waits_for_identity(Code::RepositoryRequired));
        assert_eq!(branch_name(&[]), "main");
        assert_eq!(branch_name(&["main"]), "puppyone-publish");
        assert_eq!(
            branch_name(&["main", "puppyone-publish"]),
            "puppyone-publish-2"
        );
        assert_eq!(
            branch_name(&["main", "puppyone-publish", "puppyone-publish-2"]),
            "puppyone-publish-3"
        );
    }
}
