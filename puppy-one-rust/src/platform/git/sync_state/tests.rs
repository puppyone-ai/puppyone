use super::*;

fn ids(key: &str, args: &[(&str, Arg)]) -> String {
    if args.is_empty() {
        return key.into();
    }
    let values: serde_json::Map<String, Value> = args
        .iter()
        .map(|(key, value)| {
            (
                (*key).into(),
                match value {
                    Arg::Text(s) => Value::String(s.clone()),
                    Arg::Number(n) => (*n).into(),
                },
            )
        })
        .collect();
    format!("{key} {}", Value::Object(values))
}

#[test]
fn all_82_frozen_ts_sync_states_match_every_field_and_bidi_interpolation() {
    #[derive(Deserialize)]
    struct Case {
        name: String,
        status: Option<Status>,
        branch: Option<Branch>,
        config: Option<Value>,
        expected: State,
    }
    #[derive(Deserialize)]
    struct Oracle {
        cases: Vec<Case>,
    }
    let oracle: Oracle = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/git-sync-state-oracle.json"
    )))
    .unwrap();
    assert_eq!(oracle.cases.len(), 82);
    for case in oracle.cases {
        assert_eq!(
            build(
                case.status.as_ref(),
                case.branch.as_ref(),
                case.config.as_ref(),
                &ids
            ),
            case.expected,
            "{}",
            case.name
        );
    }
}

fn remote(name: &str, url: &str) -> Remote {
    Remote {
        name: name.into(),
        fetch_url: Some(url.into()),
        push_url: Some(url.into()),
    }
}

#[test]
fn real_git_status_keeps_remote_metadata_and_config_without_retargeting_the_branch() {
    let dir = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        let output = std::process::Command::new(crate::platform::git::git_executable())
            .args([
                "-c",
                "user.name=Parity",
                "-c",
                "user.email=parity@example.invalid",
            ])
            .args(args)
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["init", "-b", "topic"]);
    run(&["remote", "add", "origin", "https://example.com/repo.git"]);
    run(&[
        "remote",
        "add",
        "backup",
        "https://example.com/git/project.git",
    ]);
    run(&["commit", "--allow-empty", "-m", "initial"]);
    std::fs::create_dir(dir.path().join(".puppyone")).unwrap();
    let config = serde_json::json!({"git":{"primaryRemote":"origin","watchedBranch":"foreign"}});
    std::fs::write(dir.path().join(".puppyone/config.json"), config.to_string()).unwrap();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let snapshot = super::super::status(dir.path(), &cancel).unwrap();
    assert_eq!(snapshot.sync_metadata.config.as_ref(), Some(&config));
    assert_eq!(snapshot.sync_metadata.remotes.len(), 2);
    assert_eq!(
        snapshot.sync_metadata.remotes[0].fetch_url.as_deref(),
        Some("https://example.com/git/project.git")
    );
    assert_eq!(snapshot.sync_metadata.hosting, Hosting::Cloud);
    assert_eq!(
        snapshot.sync_metadata.fetch_target,
        Some(FetchTarget {
            remote: "backup".into(),
            branch: Some("topic".into())
        })
    );
    let target = snapshot.target.as_ref().unwrap();
    assert_eq!(
        (&*target.remote, &*target.branch, target.exists),
        ("origin", "topic", false)
    );
    let state = for_snapshot_with(&snapshot, &ids);
    assert_eq!(state.upstream_label, "origin/topic");
    assert_eq!(state.push_label, "source-control.sync.upload");
    assert!(snapshot.can_publish());
    // A configured remote that was removed must not fall back to the
    // remaining Cloud remote, even though it determines display wording.
    run(&["remote", "remove", "origin"]);
    let snapshot = super::super::status(dir.path(), &cancel).unwrap();
    assert!(snapshot.target.is_none());
    assert!(!snapshot.can_publish());
    assert!(!snapshot.can_push());
    assert!(for_snapshot_with(&snapshot, &ids).setup_required);
}

#[test]
fn cloud_presentation_rejects_split_and_conflicting_locators_without_changing_targets() {
    let cloud = remote("backup", "https://example.com/git/project.git");
    let same = remote("copy", "https://example.com/git/project.git");
    let other = remote("other", "https://example.com/git/foreign.git");
    assert_eq!(unique_cloud(&[cloud.clone(), same]).unwrap().name, "backup");
    assert!(unique_cloud(&[cloud.clone(), other]).is_none());
    let split = Remote {
        push_url: Some("https://example.com/generic.git".into()),
        ..cloud.clone()
    };
    assert!(unique_cloud(&[split]).is_none());
    let no_push = Remote {
        push_url: None,
        ..cloud
    };
    assert!(unique_cloud(&[no_push]).is_none());
    for url in [
        "https://secret@example.com/git/project.git",
        "https://example.com/git/project.git?token=x",
        "https://example.com/git/project.git#secret",
        "ssh://example.com/git/project.git",
    ] {
        assert!(unique_cloud(&[remote("backup", url)]).is_none());
    }
}

#[test]
fn hosting_priority_keeps_configuration_target_upstream_and_provider_fallback_distinct() {
    let generic = remote("origin", "https://example.com/repo.git");
    let cloud = remote("backup", "https://example.com/git/project.git");
    let github = remote("github", "git@github.com:owner/repo.git");
    let remotes = [generic, cloud, github];
    let config =
        serde_json::json!({"sync":{"sourceOfTruth":{"service":"puppyone","remote":"origin"}}});
    assert_eq!(
        resolve_hosting(&remotes, Some("github"), None, Some(&config)).0,
        Hosting::Cloud
    );
    let config = serde_json::json!({"sync":{"sourceOfTruth":{"service":"github"}}});
    assert_eq!(
        resolve_hosting(&remotes, Some("backup"), None, Some(&config)).0,
        Hosting::Github
    );
    let config = serde_json::json!({"git":{"primaryRemote":"backup"}});
    assert_eq!(
        resolve_hosting(&remotes, Some("github"), None, Some(&config)).0,
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(&remotes, Some("backup"), Some("github/main"), None).0,
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(&remotes, Some("origin"), Some("backup/main"), None).0,
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(&remotes, Some("origin"), None, None).0,
        Hosting::Github
    );
    assert_eq!(
        resolve_hosting(&remotes[..2], Some("origin"), None, None).0,
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(
            &[remote("Puppyone", "https://example.com/plain.git")],
            None,
            None,
            None
        )
        .0,
        Hosting::Generic
    );
    assert_eq!(
        resolve_hosting(
            &[remote("Puppyone", "https://example.com/plain.git")],
            None,
            None,
            Some(&serde_json::json!({"sync":{"sourceOfTruth":{"service":"puppyone"}}}))
        )
        .0,
        Hosting::Cloud
    );
    let both = Remote {
        push_url: Some("https://github.com/a/b.git".into()),
        ..remotes[1].clone()
    };
    assert_eq!(
        resolve_hosting(&[both], Some("backup"), None, None).0,
        Hosting::Github
    );
}

#[test]
fn native_snapshot_projection_retains_urls_config_and_separate_mutation_authority() {
    let mut snapshot = super::super::Snapshot {
        branch: "topic".into(),
        head: "head".into(),
        ahead: 2,
        behind: 3,
        upstream: Some("removed/main".into()),
        remotes: vec!["origin".into()],
        ..Default::default()
    };
    let state = for_snapshot_with(&snapshot, &ids);
    assert_eq!(state.upstream_label, "removed/main");
    assert_eq!((state.ahead, state.behind), (2, 3));
    assert!(state.remote_exists);
    assert!(!snapshot.can_push());
    assert!(!snapshot.can_publish());
    snapshot.upstream = None;
    snapshot.sync_metadata.config =
        Some(serde_json::json!({"git":{"primaryRemote":"missing", "watchedBranch":"watch"}}));
    assert_eq!(
        for_snapshot_with(&snapshot, &ids).upstream_label,
        "origin/watch"
    );
    assert!(
        snapshot.target.is_none(),
        "display fallback must not authorize a target"
    );
    snapshot.sync_metadata.remotes = vec![remote("backup", "https://example.com/git/project.git")];
    assert_eq!(
        for_snapshot_with(&snapshot, &ids).push_label,
        "source-control.sync.publish"
    );
    snapshot.sync_metadata.hosting = Hosting::Cloud;
    snapshot.target = Some(super::super::SyncTarget {
        remote: "backup".into(),
        branch: "topic".into(),
        exists: true,
    });
    let state = for_snapshot_with(&snapshot, &ids);
    assert_eq!(state.upstream_label, "backup/topic");
    assert_eq!(state.push_label, "source-control.sync.upload");
    assert!(state.push_disabled);
    snapshot.branch = "HEAD (no branch)".into();
    assert_eq!(
        for_snapshot_with(&snapshot, &ids).branch_label,
        "source-control.branch.initial"
    );
}

#[test]
fn effective_fetch_target_keeps_provider_identity_and_detached_read_authority() {
    let remotes = [
        remote("origin", "https://example.org/repository.git"),
        remote("cloud-first", "https://example.org/git/first.git"),
        remote("cloud-chosen", "https://example.org/git/chosen.git"),
        remote("github-first", "git@github.com:a/first.git"),
        remote("github-chosen", "git@github.com:a/chosen.git"),
    ];
    for (config, target, upstream, expected) in [
        (
            serde_json::json!({"sync":{"sourceOfTruth":{"service":"puppyone", "remote":"cloud-chosen"}}}),
            Some("origin"),
            None,
            "cloud-chosen",
        ),
        (
            serde_json::json!({"sync":{"sourceOfTruth":{"service":"puppyone", "remote":"origin"}}}),
            Some("origin"),
            None,
            "cloud-first",
        ),
        (
            serde_json::json!({"sync":{"sourceOfTruth":{"service":"github", "remote":"github-chosen"}}}),
            Some("origin"),
            None,
            "github-chosen",
        ),
        (
            serde_json::json!({"sync":{"sourceOfTruth":{"service":"github", "remote":"origin"}}}),
            Some("origin"),
            None,
            "github-first",
        ),
        (
            serde_json::json!({"git":{"primaryRemote":"cloud-chosen"}}),
            Some("github-first"),
            None,
            "cloud-chosen",
        ),
        (
            serde_json::json!({}),
            Some("cloud-chosen"),
            Some("github-first/main"),
            "cloud-chosen",
        ),
        (
            serde_json::json!({}),
            Some("origin"),
            Some("cloud-chosen/main"),
            "cloud-chosen",
        ),
        (serde_json::json!({}), Some("origin"), None, "github-first"),
    ] {
        assert_eq!(
            resolve_hosting(&remotes, target, upstream, Some(&config))
                .1
                .unwrap()
                .name,
            expected
        );
    }
    let native: Vec<_> = remotes
        .iter()
        .map(|r| super::super::Remote {
            name: r.name.clone(),
            fetch_url: r.fetch_url.clone(),
            push_url: r.push_url.clone(),
            branches: 0,
        })
        .collect();
    let mut snapshot = super::super::Snapshot {
        branch: "topic".into(),
        ..Default::default()
    };
    for (kind, index) in [
        (Hosting::Generic, 0),
        (Hosting::Cloud, 1),
        (Hosting::Github, 3),
    ] {
        let metadata = Metadata::from_git(&snapshot, &native[index..=index], None);
        assert_eq!(metadata.hosting, kind);
        assert_eq!(
            metadata.fetch_target,
            Some(FetchTarget {
                remote: native[index].name.clone(),
                branch: Some("topic".into())
            })
        );
    }
    snapshot.branch = "HEAD (no branch)".into();
    let metadata = Metadata::from_git(&snapshot, &native[..1], None);
    assert_eq!(
        metadata.fetch_target,
        Some(FetchTarget {
            remote: "origin".into(),
            branch: None
        })
    );
    assert!(snapshot.target.is_none());
    assert!(!snapshot.can_push() && !snapshot.can_publish());
    assert!(
        Metadata::from_git(&snapshot, &[], None)
            .fetch_target
            .is_none()
    );
    // Missing configured names fall back for hosting, while an explicitly
    // unresolved sync target remains unresolved for generic hosts.
    let config = serde_json::json!({"git":{"primaryRemote":"removed"}});
    assert_eq!(
        Metadata::from_git(&snapshot, &native[..1], Some(config))
            .fetch_target
            .unwrap()
            .remote,
        "origin"
    );
    snapshot.target = Some(super::super::SyncTarget {
        remote: "removed".into(),
        branch: "topic".into(),
        exists: false,
    });
    assert!(
        Metadata::from_git(&snapshot, &native[..1], None)
            .fetch_target
            .is_none()
    );
}

#[test]
fn an_empty_legacy_cloud_access_key_never_claims_cloud_hosting() {
    let remotes = [remote("origin", "https://example.org/git/ap/.git")];
    assert_eq!(
        resolve_hosting(&remotes, None, None, None).0,
        Hosting::Generic
    );
    assert!(unique_cloud(&remotes).is_none());
}

#[test]
fn real_fetch_updates_only_the_effective_hosting_remote_and_preserves_publication_target() {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("seed");
    let work = dir.path().join("work");
    let hosting = dir.path().join("hosting.git");
    for path in [&seed, &work] {
        std::fs::create_dir(path).unwrap();
    }
    let run = |root: &std::path::Path, args: &[&str]| {
        let output = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=Parity",
                "-c",
                "user.email=parity@example.invalid",
            ])
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    };
    run(&seed, &["init", "-b", "topic"]);
    run(&seed, &["commit", "--allow-empty", "-m", "remote-only"]);
    let remote_head = run(&seed, &["rev-parse", "HEAD"]);
    run(
        dir.path(),
        &[
            "clone",
            "--bare",
            seed.to_str().unwrap(),
            hosting.to_str().unwrap(),
        ],
    );
    run(&work, &["init", "-b", "topic"]);
    run(&work, &["commit", "--allow-empty", "-m", "local-only"]);
    run(
        &work,
        &[
            "remote",
            "add",
            "origin",
            dir.path().join("must-not-fetch.git").to_str().unwrap(),
        ],
    );
    run(
        &work,
        &["remote", "add", "puppyone", hosting.to_str().unwrap()],
    );
    std::fs::create_dir(work.join(".puppyone")).unwrap();
    std::fs::write(
        work.join(".puppyone/config.json"),
        r#"{"sync":{"sourceOfTruth":{"service":"puppyone","remote":"origin"}}}"#,
    )
    .unwrap();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let before = super::super::status(&work, &cancel).unwrap();
    assert_eq!(before.target.as_ref().unwrap().remote, "origin");
    assert_eq!(
        before.sync_metadata.fetch_target.as_ref().unwrap().remote,
        "puppyone"
    );
    super::super::fetch(
        &work,
        &before.sync_metadata.fetch_target.as_ref().unwrap().remote,
        &cancel,
    )
    .unwrap();
    let after = super::super::status(&work, &cancel).unwrap();
    assert_eq!(after.target, before.target);
    assert_eq!(after.head, before.head);
    assert_eq!(
        run(&work, &["rev-parse", "refs/remotes/puppyone/topic"]),
        remote_head
    );
    assert!(run(&work, &["for-each-ref", "refs/remotes/origin"]).is_empty());
    assert!(after.can_publish());
}
