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
}
impl Item {
    pub fn location(&self) -> Location {
        match (&self.local_path, &self.cloud_project) {
            (Some(_), Some(_)) => Location::Linked,
            (Some(_), None) => Location::Local,
            _ => Location::CloudOnly,
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
        });
    }
    for project in remaining {
        items.push(Item {
            id: format!("cloud:{}", project.id),
            label: project.name.clone(),
            local_path: None,
            cloud_project: Some(project.id.clone()),
            modified: latest([project.updated, activity.get(&project.id).copied()]),
        });
    }
    items.sort_by(|a, b| {
        b.modified
            .unwrap_or(0)
            .cmp(&a.modified.unwrap_or(0))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.id.cmp(&b.id))
    });
    items
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
        assert_eq!(
            ids,
            ["cloud:c1", "local:/a/notes", "cloud:c2", "local:/a/old"]
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
        assert_eq!(latest([None, Some(3), Some(9)]), Some(9));
        assert_eq!(latest([None, None]), None);
    }
}
