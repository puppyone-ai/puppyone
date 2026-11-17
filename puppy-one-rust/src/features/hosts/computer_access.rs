//! `OtherComputersSettings.tsx` as data: what Settings › Computer access
//! says of this computer's sharing and of the owner's other computers.
//! The page is behind `HOST_DEVICES_AVAILABLE`.
use super::link::HostStatus;
use crate::localization::{self, TimeUnit, t, tf};
use crate::workspace::hosts::remote::Device;

/// A folder this computer shares; `manageable` ones open their settings.
#[derive(Clone, Debug, PartialEq)]
pub struct SharedRow {
    pub id: String,
    pub name: String,
    pub writable: bool,
    pub manageable: bool,
}

/// This computer's shared folders: as its host reports them, else as the
/// catalog lists this computer's active ones; `None` until either is known.
pub fn shared_rows(sharing: Option<&HostStatus>, mine: Option<&Device>) -> Option<Vec<SharedRow>> {
    let manageable = |id: &str| {
        mine.is_some_and(|d| d.folders.iter().any(|f| f.id == id && f.state == "active"))
    };
    let rows: Vec<(String, String, bool)> = match (sharing, mine) {
        (Some(sharing), _) => sharing
            .folders
            .iter()
            .map(|f| (f.folder_id.clone(), f.name.clone(), f.writable))
            .collect(),
        (None, Some(mine)) => mine
            .folders
            .iter()
            .filter(|f| f.state == "active")
            .map(|f| (f.id.clone(), f.name.clone(), f.writable()))
            .collect(),
        (None, None) => return None,
    };
    Some(
        rows.into_iter()
            .map(|(id, name, writable)| SharedRow {
                manageable: manageable(&id),
                id,
                name,
                writable,
            })
            .collect(),
    )
}

/// `noFolders`: nothing shared, or sharing off on a computer not yet known.
pub fn no_folders(
    rows: Option<&[SharedRow]>,
    sharing: Option<&HostStatus>,
    this_device: Option<&str>,
) -> bool {
    rows.is_some_and(|r| r.is_empty())
        || (sharing.is_some_and(|s| s.state == "off") && this_device.is_none())
}

/// `SharingStatus`: the words under this computer's name.
pub fn sharing_status(sharing: Option<&HostStatus>, count: Option<usize>) -> String {
    let Some(sharing) = sharing else {
        return t("common.status.loading").into();
    };
    let key = match sharing.state.as_str() {
        "outdated" => "hosts.sharing.outdated",
        _ if sharing.paused => "hosts.sharing.paused",
        "off" => "hosts.settings.sharingOff",
        "connecting" => "hosts.sharing.connecting",
        "offline" => "hosts.sharing.reconnecting",
        _ => match count {
            Some(0) => "hosts.settings.sharingOff",
            Some(count) => {
                return tf("hosts.settings.folderCount", &[("count", count.into())]);
            }
            None => "hosts.settings.sharingOn",
        },
    };
    t(key).into()
}

/// `ComputerPresence`: online, or when it was last seen (`now` in seconds).
pub fn presence(online: bool, last_seen_at: Option<&str>, now: i64) -> String {
    if online {
        return t("hosts.catalog.online").into();
    }
    let Some(seen) = last_seen_at
        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
        .map(|at| at.timestamp())
    else {
        return t("hosts.catalog.offline").into();
    };
    let minutes = ((now - seen) as f64 / 60.).round() as i64;
    let time = if minutes.abs() < 60 {
        if minutes == 0 {
            localization::relative_now().to_owned()
        } else {
            localization::relative_past(minutes, TimeUnit::Minute)
        }
    } else {
        let hours = (minutes as f64 / 60.).round() as i64;
        if hours.abs() < 48 {
            localization::relative_past(hours, TimeUnit::Hour)
        } else {
            match (hours as f64 / 24.).round() as i64 {
                1 => localization::relative_day(-1),
                days => localization::relative_past(days, TimeUnit::Day),
            }
        }
    };
    tf("hosts.catalog.lastSeen", &[("time", time.into())])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::hosts::SharedFolder;

    fn device(folders: serde_json::Value) -> Device {
        serde_json::from_value(serde_json::json!({
            "id": "d", "name": "Studio Mac", "folders": folders
        }))
        .unwrap()
    }
    fn status(state: &str, paused: bool, folders: Vec<SharedFolder>) -> HostStatus {
        HostStatus {
            state: state.into(),
            paused,
            folders,
            ..Default::default()
        }
    }

    #[test]
    fn the_host_says_what_is_shared_and_the_catalog_says_what_opens_settings() {
        let mine = device(serde_json::json!([
            {"id": "a", "name": "notes", "state": "active", "capabilities": ["folder.write"]},
            {"id": "b", "name": "old", "state": "paused"}
        ]));
        assert_eq!(shared_rows(None, None), None);
        let from_catalog = shared_rows(None, Some(&mine)).unwrap();
        assert_eq!(from_catalog.len(), 1, "only active folders");
        assert!(from_catalog[0].writable && from_catalog[0].manageable);
        let host = status(
            "online",
            false,
            vec![SharedFolder {
                folder_id: "c".into(),
                name: "new".into(),
                ..Default::default()
            }],
        );
        let rows = shared_rows(Some(&host), Some(&mine)).unwrap();
        assert_eq!(rows[0].name, "new");
        assert!(!rows[0].manageable, "not in the catalog yet");
        assert!(!no_folders(Some(&rows), Some(&host), Some("d")));
        assert!(no_folders(Some(&[]), Some(&host), Some("d")));
        assert!(no_folders(None, Some(&status("off", false, vec![])), None));
    }

    #[test]
    fn sharing_status_and_presence_follow_the_page() {
        assert_eq!(sharing_status(None, None), t("common.status.loading"));
        let paused = status("online", true, vec![]);
        assert_eq!(
            sharing_status(Some(&paused), Some(2)),
            t("hosts.sharing.paused")
        );
        let outdated = status("outdated", true, vec![]);
        assert_eq!(
            sharing_status(Some(&outdated), None),
            t("hosts.sharing.outdated")
        );
        let online = status("online", false, vec![]);
        assert_eq!(
            sharing_status(Some(&online), Some(0)),
            t("hosts.settings.sharingOff")
        );
        assert_eq!(
            sharing_status(Some(&online), Some(2)),
            tf("hosts.settings.folderCount", &[("count", 2i64.into())])
        );
        let now = 1_800_000_000;
        assert_eq!(presence(true, None, now), t("hosts.catalog.online"));
        assert_eq!(presence(false, None, now), t("hosts.catalog.offline"));
        assert_eq!(
            presence(false, Some("never"), now),
            t("hosts.catalog.offline")
        );
        let at = |seconds: i64| {
            chrono::DateTime::from_timestamp(now - seconds, 0)
                .unwrap()
                .to_rfc3339()
        };
        let seen = |time: String| tf("hosts.catalog.lastSeen", &[("time", time.into())]);
        assert_eq!(
            presence(false, Some(&at(5 * 60)), now),
            seen(localization::relative_past(5, TimeUnit::Minute))
        );
        assert_eq!(
            presence(false, Some(&at(3 * 3600)), now),
            seen(localization::relative_past(3, TimeUnit::Hour))
        );
        assert_eq!(
            presence(false, Some(&at(5 * 86_400)), now),
            seen(localization::relative_past(5, TimeUnit::Day))
        );
    }
}
