//! Display names, compact workspace paths, and relative modification times
//! shared by the Homepage and the Header's project menu (`getProjectName`,
//! `getWorkspacePathForDisplay`, `compactDisplayPath`, `formatModificationTime`).
use crate::{
    features::settings::RecentProject,
    localization::{TimeUnit, bidi_isolate, relative_past, t as tr, tf},
    workspace::cloud::catalog::Item,
};
use std::{
    path::Path,
    time::{Duration, SystemTime},
};

/// `getProjectName` for a catalog entry.
pub(in crate::app) fn item_name_or(item: &Item, untitled: &str) -> String {
    let label = item.label.trim();
    if !label.is_empty() && Some(label) != item.local_path.as_deref() {
        return label.to_owned();
    }
    item.local_path
        .as_deref()
        .and_then(|p| Path::new(p).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| {
            if label.is_empty() {
                untitled.to_owned()
            } else {
                label.to_owned()
            }
        })
}

pub(in crate::app::home) fn item_name(item: &Item) -> String {
    item_name_or(item, tr("onboarding.projects.untitled"))
}

/// `useProjectHomeItemCaption`: where an entry's project is; another
/// computer's folder says which computer and what it allows there, or why
/// it cannot open now (`RemoteFolderList`).
pub(in crate::app::home) fn item_caption(item: &Item) -> String {
    if let Some(remote) = &item.remote {
        let host = bidi_isolate(&remote.host);
        if !remote.online {
            return tf("hosts.home.computerOffline", &[("host", host.into())]);
        }
        let access = if remote.paused {
            tr("hosts.sharing.paused")
        } else if remote.writable {
            tr("hosts.catalog.editable")
        } else {
            tr("hosts.catalog.readOnly")
        };
        return format!("{host} · {access}");
    }
    tr(if item.local_path.is_none() {
        "cloud.home.location.cloud"
    } else if cfg!(target_os = "macos") {
        "shell.workspaceSwitcher.location.thisMac"
    } else {
        "shell.workspaceSwitcher.location.thisComputer"
    })
    .to_owned()
}

/// `getProjectName`: the label, else the folder's name.
pub(in crate::app::home) fn project_name(project: &RecentProject) -> String {
    let label = project.name.trim();
    if !label.is_empty() && Path::new(label) != project.path {
        return label.to_owned();
    }
    project
        .path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| tr("onboarding.projects.untitled").to_owned())
}

/// `getWorkspacePathForDisplay`: home as `~`.
pub(in crate::app) fn path_for_display(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    match text.strip_prefix("/Users/") {
        Some(rest) => match rest.split_once('/') {
            Some((_, below)) => format!("~/{below}"),
            None => "~".into(),
        },
        None => text,
    }
}

/// `getWorkspaceParentPathForDisplay`: the parent folder, home as `~`.
pub(in crate::app::home) fn parent_for_display(path: &Path) -> String {
    match path.parent() {
        Some(parent) => path_for_display(parent),
        None => String::new(),
    }
}

/// `compactDisplayPath`: a display path short enough for one line — its root
/// and its last `tail` folders, with the folders between them elided.
pub(in crate::app) fn compact_display_path(display_path: &str, tail: usize) -> String {
    let sep = if display_path.contains('\\') && !display_path.contains('/') {
        '\\'
    } else {
        '/'
    };
    let parts: Vec<&str> = display_path.split(sep).collect();
    if parts.len() <= tail + 2 {
        return display_path.to_owned();
    }
    let mut out = Vec::with_capacity(tail + 2);
    out.push(parts[0]);
    out.push("…");
    out.extend_from_slice(&parts[parts.len().saturating_sub(tail)..]);
    out.join(&sep.to_string())
}

/// `formatModificationTime`: "Just now", then whole minutes, hours or days.
pub(in crate::app::home) fn modification_time(changed: SystemTime, now: SystemTime) -> String {
    const MINUTE: u64 = 60;
    const HOUR: u64 = 60 * MINUTE;
    const DAY: u64 = 24 * HOUR;
    let elapsed = now
        .duration_since(changed)
        .unwrap_or(Duration::ZERO)
        .as_secs();
    if elapsed < MINUTE {
        return tr("onboarding.time.justNow").into();
    }
    let (n, unit) = if elapsed < HOUR {
        (elapsed / MINUTE, TimeUnit::Minute)
    } else if elapsed < DAY {
        (elapsed / HOUR, TimeUnit::Hour)
    } else {
        (elapsed / DAY, TimeUnit::Day)
    };
    relative_past(n.max(1) as i64, unit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::path::PathBuf;

    #[test]
    fn project_names_and_folders_display_like_the_product() {
        let project = |name: &str, path: &str| RecentProject {
            path: PathBuf::from(path),
            name: name.into(),
            opened_at: 0,
            host_folder: None,
            fs_identity: None,
        };
        assert_eq!(project_name(&project("Notes", "/a/notes")), "Notes");
        assert_eq!(project_name(&project("", "/a/notes")), "notes");
        assert_eq!(project_name(&project("/a/notes", "/a/notes")), "notes");
        assert_eq!(
            parent_for_display(Path::new("/Users/ada/project/x")),
            "~/project"
        );
        assert_eq!(parent_for_display(Path::new("/Users/ada/x")), "~");
        assert_eq!(
            parent_for_display(Path::new("/private/tmp/x")),
            "/private/tmp"
        );
        assert_eq!(compact_display_path("~/project", 1), "~/project");
        assert_eq!(
            compact_display_path("~/Documents/Work", 1),
            "~/Documents/Work"
        );
        assert_eq!(
            compact_display_path("~/Documents/Clients/2026", 1),
            "~/…/2026"
        );
        assert_eq!(
            compact_display_path("/Volumes/Disk/Clients/2026", 1),
            "/…/2026"
        );
        assert_eq!(
            compact_display_path("C:\\Users\\ada\\Clients\\2026", 1),
            "C:\\…\\2026"
        );
    }

    #[test]
    fn modification_times_round_down_to_minutes_hours_and_days() {
        let now = SystemTime::now();
        let ago = |secs: u64| modification_time(now - Duration::from_secs(secs), now);
        assert_eq!(ago(5), "Just now");
        assert_eq!(ago(150), "2 minutes ago");
        assert_eq!(ago(3 * 3600 + 5), "3 hours ago");
        assert_eq!(ago(26 * 3600), "1 day ago");
    }
}
