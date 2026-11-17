//! Presentation of Git synchronization, shared by the native sidebar and its
//! TS acceptance oracle. This never selects or authorizes a Git mutation;
//! `Snapshot::target` and the operation preflight retain that authority.
use crate::localization::{Arg, bidi_isolate};
use serde::{Deserialize, Serialize};
use serde_json::Value;

type Formatter<'a> = dyn Fn(&str, &[(&str, Arg)]) -> String + 'a;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Metadata {
    pub remotes: Vec<Remote>,
    pub config: Option<Value>,
    pub hosting: Hosting,
    /// Read-only refresh target; independent of push/pull authorization.
    pub fetch_target: Option<FetchTarget>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FetchTarget {
    pub remote: String,
    pub branch: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
pub enum Hosting {
    #[default]
    #[serde(rename = "generic-git", alias = "local-only")]
    Generic,
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "puppyone-cloud")]
    Cloud,
}

#[derive(Default, Deserialize)]
pub struct EffectiveHosting {
    pub kind: Hosting,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub head_commit_id: Option<String>,
    pub remotes: Vec<Remote>,
    pub effective_hosting: EffectiveHosting,
    pub sync_target: Option<Target>,
}

#[derive(Default, Deserialize)]
pub struct Target {
    pub remote: Option<String>,
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub exists: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Default, Deserialize)]
#[serde(default)]
pub struct Branch {
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub branch_label: String,
    pub upstream_label: String,
    pub remote_exists: bool,
    pub setup_required: bool,
    pub setup_title: String,
    pub setup_detail: String,
    pub behind: u32,
    pub ahead: u32,
    pub pull_detail: String,
    pub pull_disabled: bool,
    pub push_disabled: bool,
    pub pull_label: String,
    pub pull_title: String,
    pub push_title: String,
    pub push_label: String,
    pub push_detail: String,
}

impl Metadata {
    pub(super) fn from_git(
        snapshot: &super::Snapshot,
        remotes: &[super::Remote],
        config: Option<Value>,
    ) -> Self {
        let remotes: Vec<Remote> = remotes
            .iter()
            .map(|r| Remote {
                name: r.name.clone(),
                fetch_url: r.fetch_url.clone(),
                push_url: r.push_url.clone(),
            })
            .collect();
        let (hosting, remote) = resolve_hosting(
            &remotes,
            snapshot.target.as_ref().map(|v| v.remote.as_str()),
            snapshot.upstream.as_deref(),
            config.as_ref(),
        );
        let fetch_target = remote.map(|r| FetchTarget {
            remote: r.name.clone(),
            branch: snapshot
                .target
                .as_ref()
                .map(|t| t.branch.as_str())
                .or_else(|| snapshot.current_branch())
                .map(str::to_owned),
        });
        Self {
            remotes,
            config,
            hosting,
            fetch_target,
        }
    }
}

/// The backend hosting classification is distinct from the renderer's unique
/// Cloud identity. Match the established backend precedence, including GitHub
/// before Cloud when both providers are present on the same candidate.
fn resolve_hosting<'a>(
    remotes: &'a [Remote],
    target: Option<&str>,
    upstream: Option<&str>,
    config: Option<&Value>,
) -> (Hosting, Option<&'a Remote>) {
    let configured = configured(
        config,
        &[
            "/sync/sourceOfTruth/remote",
            "/git/primaryRemote",
            "/backup/remote",
        ],
    )
    .and_then(|name| remotes.iter().find(|r| r.name == name));
    let service = config
        .and_then(|c| c.pointer("/sync/sourceOfTruth/service"))
        .and_then(Value::as_str);
    let cloud = |r: &Remote| {
        [&r.fetch_url, &r.push_url]
            .into_iter()
            .flatten()
            .any(|u| super::cloud_locator(u))
    };
    static GITHUB: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)(^|[/:@])github\.com([/:]|$)").unwrap()
    });
    let github = |r: &Remote| {
        [&r.fetch_url, &r.push_url]
            .into_iter()
            .flatten()
            .any(|u| GITHUB.is_match(u))
    };
    if service == Some("puppyone")
        && let Some(remote) = configured
            .filter(|r| cloud(r))
            .or_else(|| remotes.iter().find(|r| cloud(r)))
            .or_else(|| {
                remotes
                    .iter()
                    .find(|r| r.name.eq_ignore_ascii_case("puppyone"))
            })
    {
        return (Hosting::Cloud, Some(remote));
    }
    if service == Some("github")
        && let Some(remote) = configured
            .filter(|r| github(r))
            .or_else(|| remotes.iter().find(|r| github(r)))
    {
        return (Hosting::Github, Some(remote));
    }
    let upstream_remote = upstream
        .and_then(|s| s.split_once('/'))
        .filter(|(a, b)| !a.is_empty() && !b.is_empty())
        .map(|(name, _)| name);
    for candidate in [
        configured,
        target.and_then(|name| remotes.iter().find(|r| r.name == name)),
        upstream_remote.and_then(|name| remotes.iter().find(|r| r.name == name)),
    ]
    .into_iter()
    .flatten()
    {
        if github(candidate) {
            return (Hosting::Github, Some(candidate));
        }
        if cloud(candidate) {
            return (Hosting::Cloud, Some(candidate));
        }
    }
    if let Some(remote) = remotes.iter().find(|r| github(r)) {
        (Hosting::Github, Some(remote))
    } else if let Some(remote) = remotes.iter().find(|r| cloud(r)) {
        (Hosting::Cloud, Some(remote))
    } else {
        // An explicitly present (but unresolved) target does not fall back.
        let remote = match target {
            Some(name) => remotes.iter().find(|r| r.name == name),
            None => preferred(remotes, config),
        };
        (Hosting::Generic, remote)
    }
}

/// Projection used by the native view. A missing tracking ref never becomes
/// mutation permission just because the presentation calls it an upstream.
pub fn for_snapshot(snapshot: &super::Snapshot) -> State {
    for_snapshot_with(snapshot, &crate::localization::tf)
}

fn for_snapshot_with(snapshot: &super::Snapshot, formatter: &Formatter<'_>) -> State {
    let remotes = if snapshot.sync_metadata.remotes.is_empty() {
        snapshot
            .remotes
            .iter()
            .map(|name| Remote {
                name: name.clone(),
                ..Remote::default()
            })
            .collect()
    } else {
        snapshot.sync_metadata.remotes.clone()
    };
    let status = Status {
        is_repo: true,
        branch: snapshot.current_branch().map(str::to_owned),
        head_commit_id: (!snapshot.head.is_empty()).then(|| snapshot.head.clone()),
        remotes,
        effective_hosting: EffectiveHosting {
            kind: snapshot.sync_metadata.hosting,
        },
        sync_target: snapshot.target.as_ref().map(|v| Target {
            remote: Some(v.remote.clone()),
            reference: Some(format!("{}/{}", v.remote, v.branch)),
            exists: v.exists,
            ahead: if v.exists { snapshot.ahead } else { 0 },
            behind: if v.exists { snapshot.behind } else { 0 },
        }),
    };
    let branch = Branch {
        upstream: snapshot.upstream.clone(),
        ahead: snapshot.ahead,
        behind: snapshot.behind,
    };
    let legacy = serde_json::json!({"backup": {"enabled": snapshot.cloud_backup}});
    build(
        Some(&status),
        Some(&branch),
        snapshot.sync_metadata.config.as_ref().or(Some(&legacy)),
        formatter,
    )
}

fn message(t: &Formatter<'_>, key: &str, args: &[(&str, Arg)]) -> String {
    t(key, args)
}

fn configured<'a>(config: Option<&'a Value>, paths: &[&str]) -> Option<&'a str> {
    paths
        .iter()
        .find_map(|path| config?.pointer(path)?.as_str())
}

fn preferred<'a>(remotes: &'a [Remote], config: Option<&Value>) -> Option<&'a Remote> {
    configured(
        config,
        &[
            "/sync/sourceOfTruth/remote",
            "/git/primaryRemote",
            "/backup/remote",
        ],
    )
    .and_then(|name| remotes.iter().find(|r| r.name == name))
    .or_else(|| remotes.iter().find(|r| r.name == "origin"))
    .or_else(|| {
        remotes
            .iter()
            .find(|r| r.name.eq_ignore_ascii_case("puppyone"))
    })
    .or(remotes.first())
}

/// Renderer remote resolution rejects split fetch/push identities and multiple
/// distinct Cloud targets. Equal locators under multiple names are harmless.
fn unique_cloud(remotes: &[Remote]) -> Option<&Remote> {
    let mut identity = None;
    let mut chosen = None;
    for remote in remotes {
        let parse = |raw: &Option<String>| {
            let raw = raw.as_deref()?;
            if !super::cloud_locator(raw) {
                return None;
            }
            let url = url::Url::parse(raw.trim()).ok()?;
            Some((
                url.origin().ascii_serialization().to_lowercase(),
                url.path().to_owned(),
            ))
        };
        let fetch = parse(&remote.fetch_url);
        let push = parse(&remote.push_url);
        if fetch.is_some() != push.is_some() {
            return None;
        }
        for candidate in [fetch, push].into_iter().flatten() {
            if identity.as_ref().is_some_and(|old| old != &candidate) {
                return None;
            }
            identity = Some(candidate);
            chosen.get_or_insert(remote);
        }
    }
    chosen
}

pub fn build(
    status: Option<&Status>,
    branch: Option<&Branch>,
    config: Option<&Value>,
    formatter: &Formatter<'_>,
) -> State {
    let t = |key: &str, args: &[(&str, Arg)]| message(formatter, key, args);
    let Some(status) = status.filter(|s| s.is_repo) else {
        return State {
            branch_label: t("source-control.sync.noBranch", &[]),
            upstream_label: t("source-control.history.inactive", &[]),
            remote_exists: false,
            setup_required: true,
            setup_title: t("source-control.sync.chooseTarget", &[]),
            setup_detail: t("source-control.sync.initializeThenCloud", &[]),
            ahead: 0,
            behind: 0,
            pull_detail: t("source-control.sync.noLocalRepository", &[]),
            pull_disabled: true,
            push_disabled: true,
            pull_label: t("source-control.sync.pullRemote", &[]),
            pull_title: t("source-control.sync.initializeBeforePull", &[]),
            push_title: t("source-control.sync.initializeBeforePush", &[]),
            push_label: t("source-control.sync.push", &[]),
            push_detail: t("source-control.sync.noLocalRepository", &[]),
        };
    };
    let branch_label = status
        .branch
        .as_deref()
        .filter(|s| !s.is_empty() && *s != "detached")
        .map(str::to_owned)
        .unwrap_or_else(|| t("source-control.branch.initial", &[]));
    if status.effective_hosting.kind == Hosting::Cloud {
        return cloud(status, branch_label, formatter);
    }
    if let Some(branch) = branch.filter(|b| b.upstream.as_deref().is_some_and(|s| !s.is_empty())) {
        return tracked(status, branch, branch_label, formatter);
    }
    if let Some(remote) = preferred(&status.remotes, config) {
        let cloud_remote = unique_cloud(&status.remotes).or_else(|| {
            status
                .remotes
                .iter()
                .find(|r| r.name.eq_ignore_ascii_case("puppyone"))
        });
        let is_cloud = remote.name.eq_ignore_ascii_case("puppyone")
            || cloud_remote.is_some_and(|r| std::ptr::eq(r, remote));
        let backup_branch = configured(
            config,
            &[
                "/sync/sourceOfTruth/branch",
                "/backup/branch",
                "/git/watchedBranch",
            ],
        )
        .unwrap_or(&branch_label);
        let fallback = format!("{}/{}", remote.name, backup_branch);
        return publish(status, remote, is_cloud, branch_label, &fallback, formatter);
    }
    let backup = config
        .and_then(|c| c.pointer("/backup/enabled"))
        .and_then(Value::as_bool)
        == Some(true);
    State {
        upstream_label: if backup {
            "Puppyone Cloud".into()
        } else {
            t("source-control.sync.localOnly", &[])
        },
        remote_exists: false,
        setup_required: !backup,
        setup_title: t(
            if backup {
                "source-control.sync.target"
            } else {
                "source-control.sync.chooseTarget"
            },
            &[],
        ),
        setup_detail: if backup {
            t("source-control.sync.cloudBackupEnabled", &[])
        } else {
            t(
                "source-control.sync.backupLocalBranch",
                &[("branch", bidi_isolate(&branch_label).into())],
            )
        },
        branch_label,
        ahead: 0,
        behind: 0,
        pull_disabled: true,
        push_disabled: true,
        pull_detail: t(
            if backup {
                "source-control.sync.configureBeforePull"
            } else {
                "source-control.sync.noTrackingBranch"
            },
            &[],
        ),
        pull_title: t(
            if backup {
                "source-control.sync.configureBeforePull"
            } else {
                "source-control.sync.chooseBeforePull"
            },
            &[],
        ),
        push_title: t(
            if backup {
                "source-control.sync.configureBeforePush"
            } else {
                "source-control.sync.chooseBeforePush"
            },
            &[],
        ),
        pull_label: t("source-control.sync.pullRemote", &[]),
        push_label: t(
            if backup {
                "source-control.sync.publish"
            } else {
                "source-control.sync.push"
            },
            &[],
        ),
        push_detail: t(
            if backup {
                "source-control.sync.noConfiguredRemote"
            } else {
                "source-control.sync.chooseFirst"
            },
            &[],
        ),
    }
}

fn push_disabled(status: &Status, exists: bool, ahead: u32, behind: u32) -> bool {
    if exists {
        ahead == 0 || behind > 0
    } else {
        status.head_commit_id.as_deref().is_none_or(str::is_empty)
    }
}

fn cloud(status: &Status, branch_label: String, formatter: &Formatter<'_>) -> State {
    let t = |key: &str, args: &[(&str, Arg)]| message(formatter, key, args);
    let target = status.sync_target.as_ref();
    let label = target
        .and_then(|v| v.reference.as_deref())
        .unwrap_or("Puppyone Cloud");
    let remote = target
        .and_then(|v| v.remote.as_deref())
        .is_some_and(|s| !s.is_empty());
    let exists = target.is_some_and(|v| v.exists);
    let ahead = target.map_or(0, |v| v.ahead);
    let behind = target.map_or(0, |v| v.behind);
    let location = [("target", bidi_isolate(label).into())];
    State {
        branch_label,
        upstream_label: label.into(),
        remote_exists: exists,
        setup_required: !remote,
        setup_title: "Puppyone Cloud".into(),
        setup_detail: if remote {
            t("source-control.sync.syncingWith", &location)
        } else {
            t("source-control.sync.configureCloudRemote", &[])
        },
        ahead,
        behind,
        pull_detail: if exists {
            t(
                "source-control.sync.cloudCommitsOn",
                &[("count", behind.into()), location[0].clone()],
            )
        } else {
            t("source-control.sync.noCloudBranch", &location)
        },
        pull_disabled: !exists || behind == 0,
        push_disabled: push_disabled(status, exists, ahead, behind),
        pull_label: if behind > 0 {
            t(
                "source-control.sync.downloadCount",
                &[("count", behind.into())],
            )
        } else {
            t("source-control.action.download", &[])
        },
        pull_title: if !exists {
            t("source-control.sync.cloudBranchMissing", &[])
        } else if behind == 0 {
            t("source-control.cloud.upToDate", &[])
        } else {
            t(
                "source-control.sync.downloadFrom",
                &[("count", behind.into()), location[0].clone()],
            )
        },
        push_title: if behind > 0 {
            t("source-control.sync.downloadBeforeUpload", &[])
        } else if ahead == 0 {
            t("source-control.sync.noCommittedToUpload", &[])
        } else {
            t(
                "source-control.sync.uploadTo",
                &[("count", ahead.into()), location[0].clone()],
            )
        },
        push_label: t("source-control.sync.upload", &[]),
        push_detail: waiting(ahead, formatter),
    }
}

fn waiting(ahead: u32, formatter: &Formatter<'_>) -> String {
    if ahead > 0 {
        message(
            formatter,
            "source-control.sync.committedWaiting",
            &[("count", ahead.into())],
        )
    } else {
        message(formatter, "source-control.sync.noCommittedWaiting", &[])
    }
}

fn publish(
    status: &Status,
    remote: &Remote,
    is_cloud: bool,
    branch_label: String,
    fallback: &str,
    formatter: &Formatter<'_>,
) -> State {
    let t = |key: &str, args: &[(&str, Arg)]| message(formatter, key, args);
    let target = status.sync_target.as_ref();
    let label = target
        .and_then(|v| v.reference.as_deref())
        .unwrap_or(fallback);
    let exists = target.is_some_and(|v| v.exists);
    let ahead = target.filter(|v| v.exists).map_or(0, |v| v.ahead);
    let behind = target.filter(|v| v.exists).map_or(0, |v| v.behind);
    let action = t(
        if is_cloud {
            "source-control.sync.publish"
        } else {
            "source-control.sync.push"
        },
        &[],
    );
    let location = ("target", bidi_isolate(label).into());
    let labels = [
        ("action", action.clone().into()),
        ("branch", bidi_isolate(&branch_label).into()),
        location.clone(),
    ];
    let push_title = if status.head_commit_id.as_deref().is_none_or(str::is_empty) {
        t(
            if is_cloud {
                "source-control.sync.commitBeforePublish"
            } else {
                "source-control.sync.commitBeforePush"
            },
            &[],
        )
    } else if exists && behind > 0 {
        t(
            "source-control.sync.sendDiverged",
            &[
                ("action", action.clone().into()),
                ("count", ahead.into()),
                location.clone(),
            ],
        )
    } else {
        t("source-control.sync.sendBranch", &labels)
    };
    State {
        branch_label,
        upstream_label: label.into(),
        remote_exists: exists,
        setup_required: false,
        setup_title: t("source-control.sync.target", &[]),
        setup_detail: t(
            "source-control.sync.primaryRemote",
            &[("remote", bidi_isolate(&remote.name).into())],
        ),
        ahead,
        behind,
        pull_detail: if exists {
            t(
                "source-control.sync.remoteCommitsOn",
                &[("count", behind.into()), location.clone()],
            )
        } else {
            t(
                "source-control.sync.noRemoteBranch",
                std::slice::from_ref(&location),
            )
        },
        pull_disabled: !exists || behind == 0,
        push_disabled: push_disabled(status, exists, ahead, behind),
        pull_label: t("source-control.sync.pullRemote", &[]),
        pull_title: if !exists {
            t("source-control.sync.remoteBranchMissing", &[])
        } else if behind == 0 {
            t("source-control.sync.upToDate", &[])
        } else {
            t(
                "source-control.sync.pullFrom",
                &[("count", behind.into()), location.clone()],
            )
        },
        push_title,
        push_label: action,
        push_detail: if !exists {
            t("source-control.sync.createRemote", &labels)
        } else if ahead > 0 {
            t(
                "source-control.sync.localWaiting",
                &[("count", ahead.into())],
            )
        } else {
            t("source-control.sync.noLocalWaiting", &[location])
        },
    }
}

fn tracked(
    status: &Status,
    branch: &Branch,
    branch_label: String,
    formatter: &Formatter<'_>,
) -> State {
    let t = |key: &str, args: &[(&str, Arg)]| message(formatter, key, args);
    let upstream = branch.upstream.as_deref().unwrap_or_default();
    let remote_name = upstream
        .find('/')
        .filter(|i| *i > 0)
        .map_or(upstream, |i| &upstream[..i]);
    let is_cloud = status
        .remotes
        .iter()
        .find(|r| r.name == remote_name)
        .and_then(|r| r.push_url.as_deref().or(r.fetch_url.as_deref()))
        .is_some_and(super::cloud_locator);
    let ahead = branch.ahead;
    let behind = branch.behind;
    let action = t(
        if is_cloud {
            "source-control.sync.publish"
        } else {
            "source-control.sync.push"
        },
        &[],
    );
    let location = ("target", bidi_isolate(upstream).into());
    State {
        branch_label,
        upstream_label: upstream.into(),
        remote_exists: true,
        setup_required: false,
        setup_title: t("source-control.sync.target", &[]),
        setup_detail: t(
            "source-control.sync.tracking",
            std::slice::from_ref(&location),
        ),
        ahead,
        behind,
        pull_detail: if ahead > 0 && behind > 0 {
            t(
                "source-control.sync.pullBeforeSend",
                &[("count", behind.into()), ("action", action.clone().into())],
            )
        } else {
            t(
                "source-control.sync.commitsOn",
                &[("count", behind.into()), location.clone()],
            )
        },
        pull_disabled: behind == 0,
        push_disabled: ahead == 0 || behind > 0,
        pull_label: if behind > 0 {
            t("source-control.sync.pullCount", &[("count", behind.into())])
        } else {
            t("source-control.sync.pullRemote", &[])
        },
        pull_title: if behind == 0 {
            t("source-control.sync.upToDate", &[])
        } else {
            t(
                "source-control.sync.pullFrom",
                &[("count", behind.into()), location.clone()],
            )
        },
        push_title: if ahead == 0 {
            t("source-control.sync.noLocalToPush", &[])
        } else {
            t(
                if behind > 0 {
                    "source-control.sync.sendDiverged"
                } else {
                    "source-control.sync.sendTo"
                },
                &[
                    ("action", action.clone().into()),
                    ("count", ahead.into()),
                    location,
                ],
            )
        },
        push_label: action,
        push_detail: waiting(ahead, formatter),
    }
}

#[cfg(test)]
mod tests;
