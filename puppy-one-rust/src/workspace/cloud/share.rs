//! `share/shareTargets.ts`, `useProjectShares` and `shareHandoff`: who a
//! Project is shared with. A share is an MCP endpoint plus the last time a
//! client used it, the only evidence the other side connected. Revoking
//! deletes the endpoint. A person or a chat bot gets a link under their own
//! permissions, never a key.
use super::services::{Dashboard, McpEndpoint};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Mcp,
    Link,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target {
    pub id: &'static str,
    pub channel: Channel,
    /// Brand names are proper nouns and stay untranslated.
    pub brand: Option<&'static str>,
    /// `cloud.share.handoff.<id>.step<n>` messages.
    pub steps: usize,
    pub docs: Option<&'static str>,
}
/// `SHARE_TARGETS`.
pub const TARGETS: [Target; 8] = [
    Target {
        id: "viktor",
        channel: Channel::Mcp,
        brand: Some("Viktor"),
        steps: 3,
        docs: Some(
            "https://viktor.com/blog/how-to-connect-tools-your-ai-employee-doesnt-support-yet",
        ),
    },
    Target {
        id: "manus",
        channel: Channel::Mcp,
        brand: Some("Manus"),
        steps: 2,
        docs: None,
    },
    Target {
        id: "claude",
        channel: Channel::Mcp,
        brand: Some("Claude"),
        steps: 3,
        docs: Some(
            "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp",
        ),
    },
    Target {
        id: "chatgpt",
        channel: Channel::Mcp,
        brand: Some("ChatGPT"),
        steps: 3,
        docs: Some("https://platform.openai.com/docs/mcp"),
    },
    Target {
        id: "slack-bot",
        channel: Channel::Link,
        brand: None,
        steps: 2,
        docs: None,
    },
    Target {
        id: "grok",
        channel: Channel::Link,
        brand: Some("Grok"),
        steps: 2,
        docs: None,
    },
    Target {
        id: "person",
        channel: Channel::Link,
        brand: None,
        steps: 1,
        docs: None,
    },
    Target {
        id: "mcp",
        channel: Channel::Mcp,
        brand: None,
        steps: 2,
        docs: Some("https://modelcontextprotocol.io/docs/concepts/transports"),
    },
];

/// `ProjectShare`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Share {
    pub id: String,
    pub name: String,
    pub path: String,
    pub readonly: bool,
    pub status: String,
    pub created_at: Option<String>,
    pub last_seen: Option<String>,
}
impl Share {
    /// `isActiveShare`.
    pub fn active(&self) -> bool {
        self.status != "disabled"
    }
}
/// `buildProjectShares`: the last read comes from the Project's own dashboard.
pub fn shares(endpoints: &[McpEndpoint], dashboard: Option<&Dashboard>) -> Vec<Share> {
    let seen = |endpoint: &McpEndpoint| {
        let dashboard = dashboard?;
        dashboard.resources.iter().find(|r| {
            r["resource_kind"] == "access"
                && matches!(r["kind"].as_str(), Some("mcp" | "mcp_endpoint"))
                && r["project_id"].as_str() == Some(dashboard.project.id.as_str())
                && r["resource_id"].as_str() == Some(endpoint.id.as_str())
        })?["last_activity_at"]
            .as_str()
            .map(str::to_owned)
    };
    endpoints
        .iter()
        .map(|endpoint| {
            let access = endpoint.accesses.first();
            Share {
                id: endpoint.id.clone(),
                name: endpoint.name.clone(),
                path: access
                    .map(|a| a.path.clone())
                    .or_else(|| endpoint.path.clone())
                    .unwrap_or_default(),
                readonly: access.is_none_or(|a| a.readonly != Some(false)),
                status: if endpoint.status.is_empty() {
                    "active".into()
                } else {
                    endpoint.status.clone()
                },
                created_at: endpoint.created_at.clone(),
                last_seen: seen(endpoint),
            }
        })
        .collect()
}
/// `shareHasReceipt`: used since it was issued. An unreadable time counts as
/// used, as in the product.
pub fn has_receipt(share: Option<&Share>, issued_at: Option<&str>) -> bool {
    let Some(seen) = share.and_then(|s| s.last_seen.as_deref()) else {
        return false;
    };
    let Some(issued) = issued_at else {
        return true;
    };
    match (
        chrono::DateTime::parse_from_rfc3339(seen),
        chrono::DateTime::parse_from_rfc3339(issued),
    ) {
        (Ok(seen), Ok(issued)) => seen >= issued,
        _ => true,
    }
}
/// `PENDING_SHARE_TTL_MS`: the backend may never report a read, so a wait
/// ends instead of polling forever.
const PENDING_TTL_MINUTES: i64 = 10;
/// `PendingShare`: a share handed over and not read yet. It outlives the
/// wizard that issued it, so the Share page keeps saying who is awaited.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pending {
    pub target: Target,
    pub endpoint: String,
    pub issued_at: String,
}
impl Pending {
    /// `isPendingShareLive`: the share exists, is active, and has not been
    /// read since it was issued.
    pub fn live(&self, shares: &[Share]) -> bool {
        let share = shares.iter().find(|s| s.id == self.endpoint);
        share.is_some_and(Share::active) && !has_receipt(share, Some(&self.issued_at))
    }
    /// An unreadable time is already over, as `Number.isNaN(remaining)` is.
    pub fn expired(&self, now: chrono::DateTime<chrono::Utc>) -> bool {
        chrono::DateTime::parse_from_rfc3339(&self.issued_at).map_or(true, |issued| {
            now >= issued + chrono::TimeDelta::minutes(PENDING_TTL_MINUTES)
        })
    }
}
/// `CloudShareStatusKind` as far as the Share page goes: it opens only for a
/// resolved Project, so `local`, `signed-out` and `attention` lead elsewhere
/// (`Command::CloudServices` sends those to the value page).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Published,
    Shared,
    Waiting,
}
/// `resolveCloudShareStatus` for a resolved Project with a loaded list.
pub fn status(shares: &[Share], pending: Option<&Pending>) -> Status {
    if pending.is_some_and(|p| p.live(shares)) {
        Status::Waiting
    } else if shares.iter().any(Share::active) {
        Status::Shared
    } else {
        Status::Published
    }
}
/// The active share a new request for the same target can reuse; its key
/// was only shown when first issued.
pub fn reusable<'a>(
    shares: &'a [Share],
    name: &str,
    path: &str,
    readonly: bool,
) -> Option<&'a Share> {
    shares.iter().find(|s| {
        s.path == path && s.readonly == readonly && s.status == "active" && s.name == name
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    fn waiting_for(issued_at: &str) -> Pending {
        Pending {
            target: TARGETS[2],
            endpoint: "e1".into(),
            issued_at: issued_at.into(),
        }
    }
    fn share(status: &str, last_seen: Option<&str>) -> Share {
        Share {
            id: "e1".into(),
            name: "Claude".into(),
            path: String::new(),
            readonly: true,
            status: status.into(),
            created_at: None,
            last_seen: last_seen.map(str::to_owned),
        }
    }

    #[test]
    fn a_wait_ends_with_the_first_read_or_with_the_share() {
        let pending = waiting_for("2026-10-30T10:00:00Z");
        assert!(pending.live(&[share("active", None)]));
        // A read from before this issue is not this share's first read.
        assert!(pending.live(&[share("active", Some("2026-10-30T09:59:59Z"))]));
        assert!(!pending.live(&[share("active", Some("2026-10-30T10:00:00Z"))]));
        assert!(!pending.live(&[share("disabled", None)]));
        assert!(!pending.live(&[]));
    }

    #[test]
    fn a_wait_ends_ten_minutes_after_the_issue() {
        let at = |text: &str| {
            chrono::DateTime::parse_from_rfc3339(text)
                .unwrap()
                .with_timezone(&chrono::Utc)
        };
        let pending = waiting_for("2026-10-30T10:00:00Z");
        assert!(!pending.expired(at("2026-10-30T10:09:59Z")));
        assert!(pending.expired(at("2026-10-30T10:10:00Z")));
        assert!(waiting_for("not a time").expired(at("2026-10-30T10:00:00Z")));
    }

    #[test]
    fn the_status_says_who_is_awaited_before_who_can_read() {
        let pending = waiting_for("2026-10-30T10:00:00Z");
        assert_eq!(status(&[], None), Status::Published);
        assert_eq!(status(&[share("disabled", None)], None), Status::Published);
        assert_eq!(status(&[share("active", None)], None), Status::Shared);
        assert_eq!(
            status(&[share("active", None)], Some(&pending)),
            Status::Waiting
        );
        // The awaited share was read: it is simply shared now.
        let read = share("active", Some("2026-10-30T10:01:00Z"));
        assert_eq!(status(&[read], Some(&pending)), Status::Shared);
        // A stale wait never outranks the list.
        assert_eq!(status(&[], Some(&pending)), Status::Published);
    }

    fn endpoint(id: &str, name: &str, status: &str) -> McpEndpoint {
        serde_json::from_value(
            json!({"id": id, "project_id": "p", "name": name, "status": status,
            "path": "docs", "created_at": "2026-10-01T00:00:00Z",
            "accesses": [{"path": "docs", "readonly": true}]}),
        )
        .unwrap()
    }

    #[test]
    fn a_share_reads_its_last_use_from_the_projects_dashboard() {
        let dashboard = Dashboard {
            project: serde_json::from_value(json!({"id": "p", "name": "N"})).unwrap(),
            nodes: Default::default(),
            resources: vec![
                json!({"resource_kind": "access", "kind": "mcp", "project_id": "p",
                    "resource_id": "e1", "last_activity_at": "2026-10-02T00:00:00Z"}),
                json!({"resource_kind": "access", "kind": "cli", "project_id": "p",
                    "resource_id": "e2", "last_activity_at": "2026-10-02T00:00:00Z"}),
            ],
        };
        let rows = shares(
            &[
                endpoint("e1", "Claude", "active"),
                endpoint("e2", "Viktor", ""),
            ],
            Some(&dashboard),
        );
        assert_eq!(rows[0].last_seen.as_deref(), Some("2026-10-02T00:00:00Z"));
        assert_eq!(rows[1].last_seen, None);
        assert_eq!(rows[1].status, "active");
        assert!(rows[0].readonly && rows[0].path == "docs");
    }

    #[test]
    fn a_receipt_must_be_newer_than_the_issue() {
        let mut share = shares(&[endpoint("e", "C", "active")], None).remove(0);
        assert!(!has_receipt(Some(&share), None));
        share.last_seen = Some("2026-10-02T00:00:00Z".into());
        assert!(has_receipt(Some(&share), None));
        assert!(has_receipt(Some(&share), Some("2026-10-01T00:00:00Z")));
        assert!(!has_receipt(Some(&share), Some("2026-10-03T00:00:00Z")));
        assert!(!has_receipt(None, None));
    }

    #[test]
    fn only_the_same_active_share_is_reused() {
        let rows = shares(
            &[
                endpoint("a", "Claude", "disabled"),
                endpoint("b", "Claude", "active"),
            ],
            None,
        );
        assert_eq!(reusable(&rows, "Claude", "docs", true).unwrap().id, "b");
        assert!(reusable(&rows, "Claude", "docs", false).is_none());
        assert!(reusable(&rows, "Claude", "", true).is_none());
        assert!(reusable(&rows, "Viktor", "docs", true).is_none());
    }

    #[test]
    fn people_and_chat_bots_get_links_and_every_target_has_steps() {
        assert_eq!(
            TARGETS
                .iter()
                .filter(|t| t.channel == Channel::Link)
                .count(),
            3
        );
        assert!(TARGETS.iter().all(|t| t.steps >= 1));
    }
}
