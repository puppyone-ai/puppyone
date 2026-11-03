//! `homepageCloudProjects.ts` / `homepageCloudActivity.ts`: the one flat
//! Homepage / Header project list.
//!
//! A local folder and its Cloud project are two projects (puppy-issues
//! ADR-001), so an entry is either a local folder or a Cloud project, never
//! both. A folder whose freshly hydrated, trusted Project-root locator names
//! a Project in this account's catalog carries a link to it: a mark and a
//! way to open that other project, never a merge. Location decides the icon
//! and actions, never the rank; entries sort by the latest actual
//! modification (unknown last), then name and identity.

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
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CloudEntry {
    pub id: String,
    pub name: String,
    pub updated: Option<i64>,
    /// `projectAllows(project, "project.settings.manage")`.
    pub can_rename: bool,
    /// `projectAllows(project, "project.delete")`.
    pub can_delete: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Location {
    /// A local folder.
    Local,
    /// A local folder that has its own Cloud project.
    Linked,
    /// A Cloud project.
    CloudOnly,
}
/// `linkedCloudProject`: the Cloud project a folder was put in the Cloud as.
#[derive(Clone, Debug, PartialEq)]
pub struct Linked {
    pub id: String,
    pub name: String,
}
/// `cloudActions`: what this account may do to a Cloud project's entry.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Actions {
    pub rename: bool,
    pub delete: bool,
}
/// `ProjectHomeItem`.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    pub label: String,
    /// Present only on a local folder's entry.
    pub local_path: Option<String>,
    /// Present only on a Cloud project's own entry.
    pub cloud_project: Option<String>,
    /// A local folder's link to its own Cloud project.
    pub linked: Option<Linked>,
    /// A Cloud project's permitted changes.
    pub actions: Option<Actions>,
    pub modified: Option<i64>,
}
impl Item {
    pub fn location(&self) -> Location {
        match (&self.local_path, &self.linked) {
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
    let mut items: Vec<Item> = local
        .iter()
        .map(|entry| {
            // A scoped checkout is not linked to the catalog's project root.
            let linked = entry
                .trusted_locator
                .as_ref()
                .filter(|l| l.scope.is_none())
                .and_then(|l| cloud.iter().find(|c| c.id == l.project))
                .map(|c| Linked {
                    id: c.id.clone(),
                    name: c.name.clone(),
                });
            Item {
                id: format!("local:{}", entry.path),
                label: entry.name.clone(),
                local_path: Some(entry.path.clone()),
                cloud_project: None,
                linked,
                actions: None,
                modified: entry.modified,
            }
        })
        .collect();
    for project in cloud {
        items.push(Item {
            id: format!("cloud:{}", project.id),
            label: project.name.clone(),
            local_path: None,
            cloud_project: Some(project.id.clone()),
            linked: None,
            actions: Some(Actions {
                rename: project.can_rename,
                delete: project.can_delete,
            }),
            modified: latest([project.updated, activity.get(&project.id).copied()]),
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
            ..Default::default()
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
    fn a_folder_and_its_cloud_project_are_two_entries() {
        let items = build(
            &[
                local("/x/older", Some(10), locator("p", None)),
                local("/x/newer", Some(20), locator("p", None)),
                local("/x/scoped", Some(30), locator("p", Some("s"))),
            ],
            &[cloud("p", "Project", Some(5))],
            &[("p".to_string(), 40)].into_iter().collect(),
        );
        let ids: Vec<_> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "cloud:p",
                "local:/x/scoped",
                "local:/x/newer",
                "local:/x/older"
            ]
        );
        // Every folder whose root locator names the Project links to it, and
        // keeps its own time; the Project keeps its entry.
        for path in ["local:/x/newer", "local:/x/older"] {
            let folder = items.iter().find(|i| i.id == path).unwrap();
            assert_eq!(folder.location(), Location::Linked);
            assert_eq!(folder.cloud_project, None);
            assert_eq!(
                folder.linked,
                Some(Linked {
                    id: "p".into(),
                    name: "Project".into()
                })
            );
        }
        assert_eq!(items[2].modified, Some(20));
        assert_eq!(items[0].location(), Location::CloudOnly);
        assert_eq!(items[0].modified, Some(40));
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
    fn a_cloud_entry_offers_only_what_the_account_may_do() {
        let mut entry = cloud("p", "Project", None);
        entry.can_rename = true;
        let items = build(&[], &[entry], &Default::default());
        assert_eq!(
            items[0].actions,
            Some(Actions {
                rename: true,
                delete: false
            })
        );
        let unknown = local("/x/unknown", None, locator("gone", None));
        let items = build(&[unknown], &[], &Default::default());
        assert_eq!(items[0].location(), Location::Local);
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
