use super::*;
use serde_json::{Value, json};

fn push_contract(index: &Value) -> Result<(), String> {
    let mut pushes = std::collections::BTreeMap::<String, Vec<Value>>::new();
    let mut bindings = Vec::new();
    for file in index["files"].as_array().ok_or("missing AST files")? {
        if file["verificationOnly"] == true {
            continue;
        }
        let admitted =
            |row: &Value| {
                let line = row["line"].as_u64().unwrap();
                !file["excluded"].as_array().unwrap().iter().any(|s| {
                    s["start"].as_u64().unwrap() <= line && s["end"].as_u64().unwrap() >= line
                })
            };
        let path = file["path"].as_str().unwrap();
        for row in file["pushes"]
            .as_array()
            .ok_or("missing AST push inventory")?
            .iter()
            .filter(|r| admitted(r))
        {
            pushes
                .entry(path.to_owned())
                .or_default()
                .push(row["args"].clone());
        }
        if path == "src/cloud/publication/git.rs" {
            for row in file["pushBindings"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| admitted(r))
            {
                bindings.push(json!({"name":row["name"],"value":row["value"]}));
            }
        }
    }
    let expected = std::collections::BTreeMap::from([
        (
            "src/platform/git.rs".into(),
            vec![
                json!(["push"]),
                json!(["push", {"borrow":{"path":"remote"}}, {"borrow":{"macro":"format","tokens":"\"{head}:refs/heads/{target}\""}}]),
            ],
        ),
        ("src/workspace/hosts/git.rs".into(), vec![json!(["push"])]),
        (
            "src/cloud/publication/git.rs".into(),
            vec![
                // `--progress` only asks Git to report the transfer.
                json!(["-c", {"borrow":{"path":"header"}}, "push", "--porcelain", "--progress", {"borrow":{"path":"lease"}}, {"path":"url"}, {"borrow":{"path":"refspec"}}]),
            ],
        ),
    ]);
    if pushes != expected {
        return Err(format!("Review every changed or new push site: {pushes:?}"));
    }
    let expected_bindings = vec![
        json!({"name":"DESTINATION_REF","value":"refs/heads/main"}),
        json!({"name":"lease","value":{"macro":"format","tokens":"\"--force-with-lease={DESTINATION_REF}:\""}}),
        json!({"name":"refspec","value":{"macro":"format","tokens":"\"{}:{DESTINATION_REF}\" , record . attempt . commit_oid"}}),
    ];
    if bindings != expected_bindings {
        return Err(format!(
            "First publication must create absent main from the pinned commit: {bindings:?}"
        ));
    }
    Ok(())
}

#[test]
fn every_production_push_site_preserves_the_reviewed_non_overwrite_contract() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    // Exact gates execute libtest directly and may have no Rust tools on PATH.
    // Keep the nested offline tool on the same toolchain that built this test.
    let cargo = Path::new(env!("CARGO"));
    let rustc = cargo.parent().unwrap().join("rustc");
    let output = crate::platform::process::run_output_with(
        cargo,
        &[
            "run",
            "--locked",
            "--offline",
            "--manifest-path",
            "tools/source-index/Cargo.toml",
            "--",
            root.to_str().unwrap(),
        ],
        &root,
        None,
        std::time::Duration::from_secs(120),
        &AtomicBool::new(false),
        crate::platform::process::OutputOptions {
            limits: crate::platform::process::OutputLimits {
                stdout: 16 * 1024 * 1024,
                stderr: 1024 * 1024,
            },
            environment: &[("RUSTC", rustc.to_str().unwrap())],
        },
    )
    .unwrap();
    let index: Value = serde_json::from_slice(&output.stdout).unwrap();
    push_contract(&index).unwrap();
    // Guard the guard with failures for a force flag, replacing refspec,
    // newly introduced sending site and loss of the explicit empty lease.
    for mutation in 0..4 {
        let mut changed = index.clone();
        let files = changed["files"].as_array_mut().unwrap();
        if mutation == 2 {
            files.push(json!({"path":"src/new_sender.rs","verificationOnly":false,"excluded":[],"pushes":[{"line":1,"args":["push"]}]}));
        } else {
            let path = if mutation == 3 {
                "src/cloud/publication/git.rs"
            } else {
                "src/platform/git.rs"
            };
            let file = files.iter_mut().find(|f| f["path"] == path).unwrap();
            if mutation == 3 {
                let lease = file["pushBindings"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|b| b["name"] == "lease")
                    .unwrap();
                lease["value"]["tokens"] = json!("\"--force-with-lease={DESTINATION_REF}\"");
            } else {
                file["pushes"][0]["args"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(if mutation == 0 {
                        "--force"
                    } else {
                        "+HEAD:refs/heads/main"
                    }));
            }
        }
        assert!(
            push_contract(&changed).is_err(),
            "mutation {mutation} escaped the architecture guard"
        );
    }
}

#[test]
fn pushing_and_publishing_cannot_replace_a_remote_commit_that_arrived_after_refresh() {
    for (operation, untrack) in [
        (Operation::Push, false),
        (Operation::Publish, true),
        (Operation::Push, true),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("work");
        let bare = temp.path().join("remote.git");
        let peer = temp.path().join("peer");
        let cancel = AtomicBool::new(false);
        let run = |cwd: &Path, args: &[&str]| {
            String::from_utf8(git(cwd, args, None, &cancel).unwrap())
                .unwrap()
                .trim()
                .to_owned()
        };
        run(temp.path(), &["init", "-q", "-b", "main", "work"]);
        run(
            temp.path(),
            &["init", "-q", "--bare", "-b", "main", "remote.git"],
        );
        let commit = |cwd: &Path, name: &str| {
            std::fs::write(cwd.join(name), name).unwrap();
            run(cwd, &["add", "--", name]);
            run(
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
            run(cwd, &["rev-parse", "HEAD"])
        };
        commit(&root, "base.md");
        run(&root, &["remote", "add", "origin", bare.to_str().unwrap()]);
        run(&root, &["push", "-qu", "origin", "main"]);
        run(
            temp.path(),
            &["clone", "-q", bare.to_str().unwrap(), "peer"],
        );
        let local = commit(&root, "local.md");
        let snapshot = status(&root, &cancel).unwrap();
        assert_eq!((snapshot.ahead, snapshot.behind), (1, 0));
        let remote = commit(&peer, "remote.md");
        run(&peer, &["push", "-q"]);
        if untrack {
            run(&root, &["branch", "--unset-upstream"]);
        }
        let error = operate(&root, &operation, &cancel).unwrap_err();
        assert!(
            error.contains("rejected")
                || error.contains("fetch first")
                || error.contains("non-fast-forward"),
            "{error}"
        );
        assert_eq!(run(&bare, &["rev-parse", "main"]), remote);
        assert_eq!(run(&root, &["rev-parse", "HEAD"]), local);
        assert_eq!(run(&root, &["status", "--porcelain"]), "");
        // The server itself allows a forced overwrite. Production must not
        // obtain a passing result just from a restrictive server setting.
        run(&root, &["push", "--force", "origin", "main"]);
        assert_eq!(run(&bare, &["rev-parse", "main"]), local);
    }
}
