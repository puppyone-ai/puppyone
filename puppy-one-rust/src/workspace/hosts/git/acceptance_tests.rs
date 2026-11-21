//! Real repositories and the actual JSONL request boundary. All data is private.
use super::*;
use crate::workspace::hosts::{
    files::{FileService, Folders, Grant},
    lines::{FilesClient, serve},
    protocol::{Capability, Request},
};
use std::sync::atomic::{AtomicBool, Ordering};

fn request(op: &str) -> GitRequest {
    GitRequest {
        op: op.into(),
        ..Default::default()
    }
}
fn invoke(git: &dyn Git, root: &Path, args: &[&str]) -> Vec<u8> {
    git.git(root, args, None).unwrap()
}
fn repository(root: &Path) {
    for args in [
        vec!["init", "-q", "-b", "main"],
        vec!["config", "user.name", "Host"],
        vec!["config", "user.email", "host@example.invalid"],
        vec!["config", "commit.gpgsign", "false"],
        vec!["config", "core.autocrlf", "false"],
    ] {
        invoke(&PlainGit, root, &args);
    }
}

#[test]
fn a_host_push_preserves_remote_changes_that_arrived_after_its_last_status() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("work");
    let bare = temp.path().join("remote.git");
    let peer = temp.path().join("peer");
    std::fs::create_dir(&root).unwrap();
    repository(&root);
    invoke(
        &PlainGit,
        temp.path(),
        &["init", "-q", "--bare", "-b", "main", "remote.git"],
    );
    let commit = |cwd: &Path, name: &str| {
        std::fs::write(cwd.join(name), name).unwrap();
        invoke(&PlainGit, cwd, &["add", "--", name]);
        invoke(
            &PlainGit,
            cwd,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                name,
            ],
        );
        invoke(&PlainGit, cwd, &["rev-parse", "HEAD"])
    };
    commit(&root, "base.md");
    invoke(
        &PlainGit,
        &root,
        &["remote", "add", "origin", bare.to_str().unwrap()],
    );
    invoke(&PlainGit, &root, &["push", "-qu", "origin", "main"]);
    invoke(
        &PlainGit,
        temp.path(),
        &["clone", "-q", bare.to_str().unwrap(), "peer"],
    );
    let local = commit(&root, "local.md");
    let service = GitService::new(Arc::new(PlainGit));
    service.run(&root, &request("status")).unwrap();
    let remote = commit(&peer, "remote.md");
    invoke(&PlainGit, &peer, &["push", "-q"]);
    assert!(service.run(&root, &request("push")).is_err());
    assert_eq!(invoke(&PlainGit, &bare, &["rev-parse", "main"]), remote);
    assert_eq!(invoke(&PlainGit, &root, &["rev-parse", "HEAD"]), local);
    assert!(invoke(&PlainGit, &root, &["status", "--porcelain"]).is_empty());
    invoke(&PlainGit, &root, &["push", "--force", "origin", "main"]);
    assert_eq!(invoke(&PlainGit, &bare, &["rev-parse", "main"]), local);
}

#[test]
fn literal_file_names_cannot_stage_another_matching_path() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    repository(root);
    for name in ["note[1].md", "note1.md", "--all"] {
        std::fs::write(root.join(name), name).unwrap();
    }
    let service = GitService::new(Arc::new(PlainGit));
    service
        .run(
            root,
            &GitRequest {
                paths: vec!["note[1].md".into(), "--all".into()],
                ..request("stage")
            },
        )
        .unwrap();
    let names = invoke(&PlainGit, root, &["diff", "--cached", "--name-only", "-z"]);
    assert_eq!(names, b"--all\0note[1].md\0");
}

#[test]
fn host_git_keeps_binary_stdin_but_refuses_oversized_output() {
    let temp = tempfile::tempdir().unwrap();
    repository(temp.path());
    let bytes: Vec<u8> = (0..4 * 1024 * 1024 + 1).map(|i| (i % 256) as u8).collect();
    let oid = PlainGit
        .git(temp.path(), &["hash-object", "-w", "--stdin"], Some(&bytes))
        .unwrap();
    let oid = std::str::from_utf8(&oid).unwrap().trim();
    assert!(
        PlainGit
            .git(temp.path(), &["cat-file", "blob", oid], None)
            .is_err(),
        "the host must share the ordinary Git output budget"
    );
    let binary = b"\0\xff\r\nno text conversion";
    let oid = PlainGit
        .git(temp.path(), &["hash-object", "-w", "--stdin"], Some(binary))
        .unwrap();
    let oid = std::str::from_utf8(&oid).unwrap().trim();
    assert_eq!(
        invoke(&PlainGit, temp.path(), &["cat-file", "blob", oid]),
        binary
    );
}

#[derive(Default)]
struct Calls(Mutex<Vec<Vec<String>>>);
impl Git for Calls {
    fn git(&self, _: &Path, args: &[&str], _: Option<&[u8]>) -> Result<Vec<u8>, String> {
        self.0
            .lock()
            .unwrap()
            .push(args.iter().map(|s| s.to_string()).collect());
        Ok(Vec::new())
    }
}
#[test]
fn invalid_requests_are_refused_before_git_and_commit_limits_count_utf16() {
    let calls = Arc::new(Calls::default());
    let service = GitService::new(calls.clone());
    let root = Path::new("/not-executed");
    for message in [" ".into(), "a".repeat(10_001), "😀".repeat(5_001)] {
        assert_eq!(
            service.run(
                root,
                &GitRequest {
                    message: Some(message),
                    ..request("commit")
                }
            ),
            Err("invalid_content")
        );
    }
    for paths in [
        vec![],
        vec!["x".into(); 1_001],
        vec!["../outside".into()],
        vec![".GIT/config".into()],
        vec!["a//b".into()],
        vec!["a/".into()],
        vec!["😀".repeat(2_049)],
        vec!["a\\b".into()],
        vec!["a\0b".into()],
    ] {
        assert_eq!(
            service.run(
                root,
                &GitRequest {
                    paths,
                    ..request("stage")
                }
            ),
            Err("invalid_path")
        );
    }
    assert_eq!(
        service.run(root, &request("config")),
        Err("file_operation_failed")
    );
    assert!(calls.0.lock().unwrap().is_empty());
    service
        .run(
            root,
            &GitRequest {
                message: Some("😀".repeat(5_000)),
                ..request("commit")
            },
        )
        .unwrap();
    service
        .run(
            root,
            &GitRequest {
                paths: vec!["x".into(); 1_000],
                ..request("stage")
            },
        )
        .unwrap();
    assert_eq!(calls.0.lock().unwrap().len(), 2);
}

struct One {
    root: PathBuf,
    git_allowed: AtomicBool,
}
impl Folders for One {
    fn resolve(&self, id: &str) -> Option<Grant> {
        (id == "folder").then(|| {
            let mut capabilities = vec![Capability::Read, Capability::Write];
            if self.git_allowed.load(Ordering::SeqCst) {
                capabilities.push(Capability::Git);
            }
            Grant {
                root: self.root.clone(),
                active: true,
                capabilities,
            }
        })
    }
}
#[tokio::test]
async fn the_files_protocol_rechecks_git_consent_after_a_real_commit() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    repository(&root);
    std::fs::write(root.join("note.md"), "hello\n").unwrap();
    let folders = Arc::new(One {
        root: root.clone(),
        git_allowed: AtomicBool::new(true),
    });
    let files = Arc::new(FileService::new(folders.clone()));
    let (host, access) = tokio::io::duplex(64 * 1024);
    let granted = folders.clone();
    let served = tokio::spawn(serve(
        host,
        files,
        Some(Arc::new(GitService::new(Arc::new(PlainGit)))),
        "folder".into(),
        Arc::new(move |cap| cap != Capability::Git || granted.git_allowed.load(Ordering::SeqCst)),
    ));
    let client = FilesClient::new(access);
    let status = client
        .request(&Request::Git(request("status")))
        .await
        .unwrap();
    assert_eq!(status["untrackedEntries"][0]["path"], "note.md");
    client
        .request(&Request::Git(GitRequest {
            paths: vec!["note.md".into()],
            ..request("stage")
        }))
        .await
        .unwrap();
    client
        .request(&Request::Git(GitRequest {
            message: Some("From another computer".into()),
            ..request("commit")
        }))
        .await
        .unwrap();
    assert_eq!(
        invoke(&PlainGit, &root, &["log", "-1", "--format=%s"]),
        b"From another computer\n"
    );
    for (req, code) in [
        (
            GitRequest {
                paths: vec!["../outside".into()],
                ..request("stage")
            },
            "invalid_path",
        ),
        (
            GitRequest {
                paths: vec![".git/config".into()],
                ..request("stage")
            },
            "invalid_path",
        ),
        (request("config"), "file_operation_failed"),
        (
            GitRequest {
                message: Some("  ".into()),
                ..request("commit")
            },
            "invalid_content",
        ),
    ] {
        assert_eq!(
            client.request(&Request::Git(req)).await.unwrap_err().code,
            code
        );
    }
    folders.git_allowed.store(false, Ordering::SeqCst);
    for req in [request("status"), request("stage_all")] {
        let error = client.request(&Request::Git(req)).await.unwrap_err();
        assert_eq!(error.code, "folder_unavailable");
        assert!(!error.outcome_unknown);
    }
    served.abort();
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "real macOS Seatbelt; required by the native dependency and parity gates"]
fn git_hooks_in_the_actual_sandbox_cannot_write_outside_the_shared_folder() {
    use crate::workspace::hosts::exec::Mechanism;
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().canonicalize().unwrap();
    let root = home.join("Notes");
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(home.join("Documents")).unwrap();
    repository(&root);
    std::fs::write(root.join("a.md"), "a\n").unwrap();
    let hook = root.join(".git/hooks/pre-commit");
    std::fs::write(&hook, b"#!/bin/sh\necho escaped > \"$HOME/Documents/escaped.txt\" 2>/dev/null\nprintf '%s|%s|%s|%s' \"$LC_ALL\" \"$LANG\" \"$GCM_INTERACTIVE\" \"$GIT_TERMINAL_PROMPT\" > hook-ran.txt\nexit 0\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o700)).unwrap();
    let sandbox = FolderSandbox {
        mechanism: Some(Mechanism::detect().expect("Seatbelt is required")),
        home: home.clone(),
        app_data: vec![],
        search_path: "/usr/bin:/bin".into(),
        temp: vec![],
    };
    let service = GitService::new(Arc::new(SandboxedGit(Arc::new(sandbox))));
    assert_eq!(
        service.run(&root, &request("status")).unwrap()["isRepo"],
        true
    );
    service.run(&root, &request("stage_all")).unwrap();
    service
        .run(
            &root,
            &GitRequest {
                message: Some("From another computer".into()),
                ..request("commit")
            },
        )
        .unwrap();
    assert_eq!(
        invoke(&PlainGit, &root, &["log", "-1", "--format=%s"]),
        b"From another computer\n"
    );
    assert_eq!(
        std::fs::read(root.join("hook-ran.txt")).unwrap(),
        b"C|C|never|0"
    );
    assert!(!home.join("Documents/escaped.txt").exists());
}

#[test]
fn named_mutations_cover_unborn_unstage_diff_discard_and_explicit_index_updates() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    repository(root);
    let service = GitService::new(Arc::new(PlainGit));
    let path = |op| GitRequest {
        paths: vec!["note.md".into()],
        ..request(op)
    };
    let status = || service.run(root, &request("status")).unwrap();
    std::fs::write(root.join("note.md"), "first\n").unwrap();
    service.run(root, &request("stage_all")).unwrap();
    service.run(root, &path("unstage")).unwrap();
    assert_eq!(status()["untrackedEntries"][0]["path"], "note.md");
    service.run(root, &path("stage")).unwrap();
    service.run(root, &request("unstage_all")).unwrap();
    assert!(status()["stagedEntries"].as_array().unwrap().is_empty());
    service.run(root, &request("stage_all")).unwrap();
    let diff = |scope| {
        service
            .run(
                root,
                &GitRequest {
                    path: Some("note.md".into()),
                    scope: Some(scope),
                    ..request("file_diff")
                },
            )
            .unwrap()
    };
    assert!(
        diff("staged".into())["diff"]
            .as_str()
            .unwrap()
            .contains("+first")
    );
    service
        .run(
            root,
            &GitRequest {
                message: Some("initial".into()),
                ..request("commit")
            },
        )
        .unwrap();
    let index = root.join(".git/index");
    let before = std::fs::read(&index).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(root.join("note.md"))
        .unwrap()
        .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000))
        .unwrap();
    assert!(status()["entries"].as_array().unwrap().is_empty());
    assert_eq!(
        std::fs::read(&index).unwrap(),
        before,
        "status must not refresh the index"
    );
    service.run(root, &path("stage")).unwrap();
    assert_ne!(
        std::fs::read(&index).unwrap(),
        before,
        "explicit staging must refresh the index"
    );
    std::fs::write(root.join("note.md"), "second\n").unwrap();
    assert!(
        diff("unstaged".into())["diff"]
            .as_str()
            .unwrap()
            .contains("+second")
    );
    service.run(root, &path("stage")).unwrap();
    service.run(root, &path("unstage")).unwrap();
    assert!(status()["stagedEntries"].as_array().unwrap().is_empty());
    service.run(root, &request("stage_all")).unwrap();
    service.run(root, &request("unstage_all")).unwrap();
    service.run(root, &path("discard")).unwrap();
    assert_eq!(std::fs::read(root.join("note.md")).unwrap(), b"first\n");
    assert!(status()["entries"].as_array().unwrap().is_empty());
}

#[test]
fn constructing_a_sandbox_adapter_cannot_run_git_and_missing_sandbox_has_no_fallback() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    repository(&root);
    std::fs::write(root.join("note.md"), "must remain unstaged").unwrap();
    let adapter = SandboxedGit(Arc::new(FolderSandbox {
        mechanism: None,
        home: root.clone(),
        app_data: vec![],
        search_path: "/usr/bin:/bin".into(),
        temp: vec![],
    }));
    let service = GitService::new(Arc::new(adapter));
    assert!(invoke(&PlainGit, &root, &["diff", "--cached", "--name-only"]).is_empty());
    assert_eq!(
        service.run(&root, &request("stage_all")),
        Err("file_operation_failed")
    );
    assert!(invoke(&PlainGit, &root, &["diff", "--cached", "--name-only"]).is_empty());
}
