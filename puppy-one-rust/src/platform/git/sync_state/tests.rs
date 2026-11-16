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
        let output = std::process::Command::new("/usr/bin/git")
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
        resolve_hosting(&remotes, Some("github"), None, Some(&config)),
        Hosting::Cloud
    );
    let config = serde_json::json!({"sync":{"sourceOfTruth":{"service":"github"}}});
    assert_eq!(
        resolve_hosting(&remotes, Some("backup"), None, Some(&config)),
        Hosting::Github
    );
    let config = serde_json::json!({"git":{"primaryRemote":"backup"}});
    assert_eq!(
        resolve_hosting(&remotes, Some("github"), None, Some(&config)),
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(&remotes, Some("backup"), Some("github/main"), None),
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(&remotes, Some("origin"), Some("backup/main"), None),
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(&remotes, Some("origin"), None, None),
        Hosting::Github
    );
    assert_eq!(
        resolve_hosting(&remotes[..2], Some("origin"), None, None),
        Hosting::Cloud
    );
    assert_eq!(
        resolve_hosting(
            &[remote("Puppyone", "https://example.com/plain.git")],
            None,
            None,
            None
        ),
        Hosting::Generic
    );
    assert_eq!(
        resolve_hosting(
            &[remote("Puppyone", "https://example.com/plain.git")],
            None,
            None,
            Some(&serde_json::json!({"sync":{"sourceOfTruth":{"service":"puppyone"}}}))
        ),
        Hosting::Cloud
    );
    let both = Remote {
        push_url: Some("https://github.com/a/b.git".into()),
        ..remotes[1].clone()
    };
    assert_eq!(
        resolve_hosting(&[both], Some("backup"), None, None),
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
