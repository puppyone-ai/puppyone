//! `homepageCloudProjects.ts` / `homepageCloudActivity.ts`: the one flat
//! Homepage / Header project list.
//!
//! Location decides the icon and actions, never the rank. Entries sort by the
//! latest actual modification (unknown last, never opening time), then name
//! and identity. A local checkout merges with a Cloud row only through a
//! freshly hydrated, trusted Project-root locator whose Project is in the
//! current catalog; the most recently modified matching checkout consumes it,
//! and Scope checkouts never do.
// Consumed by the Cloud navigation surface (Homepage catalog, Header switch,
// Share), which stays behind the Cloud experiment until its UI lands.
#![cfg_attr(not(test), allow(dead_code))]

/// A local recent project with its hydrated metadata.
#[derive(Clone, Debug, PartialEq)]
pub struct LocalEntry {
    pub path: String,
    pub name: String,
    /// Milliseconds since the epoch; `None` is unknown.
    pub modified: Option<i64>,
    /// Hydration finished and its locator is trusted for the configured API.
    pub trusted_locator: Option<super::locator::Locator>,
}
/// One authorized Cloud Project from `GET /projects/`.
#[derive(Clone, Debug, PartialEq)]
pub struct CloudEntry {
    pub id: String,
    pub name: String,
    pub updated: Option<i64>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Location {
    /// Neutral folder.
    Local,
    /// Folder with a small Cloud badge.
    Linked,
    /// Outline Cloud.
    CloudOnly,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    pub label: String,
    pub local_path: Option<String>,
    pub cloud_project: Option<String>,
    pub modified: Option<i64>,
    /// `lastOpenedLocation`: where this account last opened the Project
    /// successfully, when that location is still this row's.
    pub last_opened: Option<Opening>,
}
impl Item {
    pub fn location(&self) -> Location {
        match (&self.local_path, &self.cloud_project) {
            (Some(_), Some(_)) => Location::Linked,
            (Some(_), None) => Location::Local,
            _ => Location::CloudOnly,
        }
    }
    /// `projectOpeningLocation`: Cloud when it was last opened there or has
    /// no checkout; otherwise this computer.
    pub fn opening(&self) -> Opening {
        if self.cloud_project.is_some()
            && (self.last_opened == Some(Opening::Cloud) || self.local_path.is_none())
        {
            Opening::Cloud
        } else {
            Opening::Local
        }
    }
}

/// Where a row opens.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Opening {
    Local,
    Cloud,
}

/// `useProjectOpenHistory`: successful openings remembered per account and
/// server, oldest first. It never stores a catalog or grants access; a
/// missing or unavailable location falls back to an accessible one.
pub mod history {
    use super::{Item, Opening};
    use serde::{Deserialize, Serialize};

    /// Remembered Projects per scope (`.slice(-99)` plus the new one).
    pub const LIMIT: usize = 100;

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(tag = "location", rename_all = "lowercase")]
    pub enum Opened {
        Local { path: String },
        Cloud,
    }
    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Entry {
        pub project: String,
        #[serde(flatten)]
        pub opened: Opened,
    }

    /// `JSON.stringify([apiBaseUrl, user_id])`.
    pub fn scope(api: &str, user: &str) -> String {
        serde_json::json!([api, user]).to_string()
    }

    /// The opening this window shows now: a committed hosted Project, else
    /// a local checkout whose row is linked to a Cloud Project.
    pub fn current(
        items: &[Item],
        local_path: Option<&str>,
        cloud_project: Option<&str>,
    ) -> Option<Entry> {
        if let Some(project) = cloud_project {
            return Some(Entry {
                project: project.to_owned(),
                opened: Opened::Cloud,
            });
        }
        let path = local_path?;
        let project = items
            .iter()
            .find(|i| i.local_path.as_deref() == Some(path))?
            .cloud_project
            .clone()?;
        Some(Entry {
            project,
            opened: Opened::Local { path: path.into() },
        })
    }

    /// Remembers `entry` last; `false` when nothing changed.
    pub fn record(history: &mut Vec<Entry>, entry: Entry) -> bool {
        if history.contains(&entry) {
            return false;
        }
        history.retain(|e| e.project != entry.project);
        let excess = history.len().saturating_sub(LIMIT - 1);
        history.drain(..excess);
        history.push(entry);
        true
    }

    /// Marks each row with its remembered location; a local opening counts
    /// only for the same checkout.
    pub fn apply(items: &mut [Item], history: &[Entry]) {
        for item in items {
            let Some(project) = &item.cloud_project else {
                continue;
            };
            item.last_opened =
                history
                    .iter()
                    .find(|e| &e.project == project)
                    .and_then(|e| match &e.opened {
                        Opened::Cloud => Some(Opening::Cloud),
                        Opened::Local { path } => {
                            (item.local_path.as_deref() == Some(path)).then_some(Opening::Local)
                        }
                    });
        }
    }
}

/// `latestProjectModifiedAt`.
pub fn latest(values: impl IntoIterator<Item = Option<i64>>) -> Option<i64> {
    values.into_iter().flatten().max()
}

/// `buildHomepageProjects`; `activity` is the bounded commit-time enrichment.
pub fn build(
    local: &[LocalEntry],
    cloud: &[CloudEntry],
    activity: &std::collections::HashMap<String, i64>,
) -> Vec<Item> {
    let mut remaining: Vec<&CloudEntry> = cloud.iter().collect();
    let mut checkouts: Vec<&LocalEntry> = local.iter().collect();
    checkouts.sort_by(|a, b| {
        b.modified
            .unwrap_or(0)
            .cmp(&a.modified.unwrap_or(0))
            .then(a.path.cmp(&b.path))
    });
    let mut items = Vec::new();
    for entry in checkouts {
        let matched = entry
            .trusted_locator
            .as_ref()
            .filter(|l| l.scope.is_none())
            .and_then(|l| remaining.iter().position(|c| c.id == l.project))
            .map(|i| remaining.remove(i));
        items.push(Item {
            id: format!("local:{}", entry.path),
            label: entry.name.clone(),
            local_path: Some(entry.path.clone()),
            cloud_project: matched.map(|c| c.id.clone()),
            modified: latest([
                entry.modified,
                matched.and_then(|c| c.updated),
                matched.and_then(|c| activity.get(&c.id).copied()),
            ]),
            last_opened: None,
        });
    }
    for project in remaining {
        items.push(Item {
            id: format!("cloud:{}", project.id),
            label: project.name.clone(),
            local_path: None,
            cloud_project: Some(project.id.clone()),
            modified: latest([project.updated, activity.get(&project.id).copied()]),
            last_opened: None,
        });
    }
    items.sort_by(|a, b| {
        b.modified
            .unwrap_or(0)
            .cmp(&a.modified.unwrap_or(0))
            .then_with(|| label_order(&a.label, &b.label))
            .then_with(|| a.id.cmp(&b.id))
    });
    items
}

/// `localeCompare` for names: letters first regardless of case; on a tie
/// lowercase sorts before uppercase, as ICU's tertiary strength does.
fn label_order(a: &str, b: &str) -> std::cmp::Ordering {
    let swapped = |s: &str| -> String {
        s.chars()
            .map(|c| {
                if c.is_uppercase() {
                    c.to_lowercase().next().unwrap_or(c)
                } else {
                    c.to_uppercase().next().unwrap_or(c)
                }
            })
            .collect()
    };
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| swapped(a).cmp(&swapped(b)))
}

/// At most four concurrent single-commit history reads per catalog load.
pub const ACTIVITY_CONCURRENCY: usize = 4;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::cloud::locator::Locator;

    fn locator(project: &str, scope: Option<&str>) -> Option<Locator> {
        Some(Locator {
            origin: "https://api.puppyone.ai".into(),
            project: project.into(),
            scope: scope.map(Into::into),
        })
    }
    fn local(path: &str, modified: Option<i64>, l: Option<Locator>) -> LocalEntry {
        LocalEntry {
            path: path.into(),
            name: path.rsplit('/').next().unwrap().into(),
            modified,
            trusted_locator: l,
        }
    }
    fn cloud(id: &str, name: &str, updated: Option<i64>) -> CloudEntry {
        CloudEntry {
            id: id.into(),
            name: name.into(),
            updated,
        }
    }

    #[test]
    fn one_flat_list_ordered_by_actual_modification() {
        let items = build(
            &[
                local("/a/notes", Some(300), None),
                local("/a/old", None, None),
            ],
            &[cloud("c1", "Hosted", Some(500)), cloud("c2", "Quiet", None)],
            &Default::default(),
        );
        let ids: Vec<_> = items.iter().map(|i| i.id.as_str()).collect();
        // Unknown times tie; names compare like `localeCompare` ("old" <
        // "Quiet").
        assert_eq!(
            ids,
            ["cloud:c1", "local:/a/notes", "local:/a/old", "cloud:c2"]
        );
        assert_eq!(items[0].location(), Location::CloudOnly);
        assert_eq!(items[1].location(), Location::Local);
    }

    #[test]
    fn a_trusted_root_locator_merges_and_the_newest_checkout_wins() {
        let items = build(
            &[
                local("/x/older", Some(10), locator("p", None)),
                local("/x/newer", Some(20), locator("p", None)),
                local("/x/scoped", Some(30), locator("p", Some("s"))),
            ],
            &[cloud("p", "Project", Some(5))],
            &[("p".to_string(), 40)].into_iter().collect(),
        );
        let newer = items.iter().find(|i| i.id == "local:/x/newer").unwrap();
        assert_eq!(newer.location(), Location::Linked);
        assert_eq!(newer.modified, Some(40));
        assert_eq!(
            items.iter().filter(|i| i.cloud_project.is_some()).count(),
            1
        );
        assert!(!items.iter().any(|i| i.id == "cloud:p"));
        assert_eq!(
            items
                .iter()
                .find(|i| i.id == "local:/x/scoped")
                .unwrap()
                .location(),
            Location::Local
        );
    }

    #[test]
    fn openings_default_to_this_computer_and_follow_the_last_successful_one() {
        use history::{Entry, Opened};
        let mut items = build(
            &[
                local("/x/linked", Some(20), locator("p", None)),
                local("/x/plain", Some(10), None),
            ],
            &[cloud("p", "Project", None), cloud("q", "Hosted", None)],
            &Default::default(),
        );
        let find = |items: &[Item], id: &str| items.iter().find(|i| i.id == id).unwrap().clone();
        assert_eq!(find(&items, "local:/x/linked").opening(), Opening::Local);
        assert_eq!(find(&items, "local:/x/plain").opening(), Opening::Local);
        assert_eq!(find(&items, "cloud:q").opening(), Opening::Cloud);

        // Only a linked checkout or a committed hosted Project is remembered.
        assert_eq!(history::current(&items, Some("/x/plain"), None), None);
        let mut remembered = vec![];
        let local_open = history::current(&items, Some("/x/linked"), None).unwrap();
        assert!(history::record(&mut remembered, local_open.clone()));
        assert!(!history::record(&mut remembered, local_open));
        history::apply(&mut items, &remembered);
        assert_eq!(
            find(&items, "local:/x/linked").last_opened,
            Some(Opening::Local)
        );
        let cloud_open = history::current(&items, None, Some("p")).unwrap();
        assert!(history::record(&mut remembered, cloud_open));
        assert_eq!(remembered.len(), 1, "one entry per Project");
        history::apply(&mut items, &remembered);
        assert_eq!(find(&items, "local:/x/linked").opening(), Opening::Cloud);

        // A local opening of another checkout does not move this row.
        let other = vec![Entry {
            project: "p".into(),
            opened: Opened::Local {
                path: "/elsewhere".into(),
            },
        }];
        history::apply(&mut items, &other);
        assert_eq!(find(&items, "local:/x/linked").last_opened, None);
        assert_eq!(find(&items, "local:/x/linked").opening(), Opening::Local);
    }

    #[test]
    fn the_open_history_is_bounded_and_stored_like_the_product() {
        use history::{Entry, Opened};
        let mut remembered = vec![];
        for n in 0..150 {
            history::record(
                &mut remembered,
                Entry {
                    project: format!("p{n}"),
                    opened: Opened::Cloud,
                },
            );
        }
        assert_eq!(remembered.len(), history::LIMIT);
        assert_eq!(remembered[0].project, "p50");
        assert_eq!(remembered.last().unwrap().project, "p149");
        let stored = serde_json::to_value(Entry {
            project: "p".into(),
            opened: Opened::Local { path: "/a".into() },
        })
        .unwrap();
        assert_eq!(
            stored,
            serde_json::json!({"project":"p","location":"local","path":"/a"})
        );
        assert_eq!(
            history::scope("https://api.puppyone.ai/api/v1", "u1"),
            r#"["https://api.puppyone.ai/api/v1","u1"]"#
        );
    }

    #[test]
    fn activity_reads_are_bounded() {
        assert_eq!(ACTIVITY_CONCURRENCY, 4);
    }

    #[test]
    fn unknown_times_sort_last_and_ties_use_name_then_identity() {
        let items = build(
            &[],
            &[
                cloud("b", "Same", None),
                cloud("a", "Same", None),
                cloud("z", "Alpha", None),
            ],
            &Default::default(),
        );
        let ids: Vec<_> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["cloud:z", "cloud:a", "cloud:b"]);
        assert_eq!(label_order("alpha", "Alpha"), std::cmp::Ordering::Less);
        assert_eq!(label_order("Alpha", "same"), std::cmp::Ordering::Less);
        assert_eq!(latest([None, Some(3), Some(9)]), Some(9));
        assert_eq!(latest([None, None]), None);
    }
}
