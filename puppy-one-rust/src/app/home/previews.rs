//! Top-level asset previews (`useProjectPreviews.ts` and
//! `selectProjectAssetPreviews` in `workspace-navigation-ipc.mjs`).
//!
//! Up to three non-dot regular files from a project's root directory are ranked
//! by preview priority (`html` → `md` → `csv` → `other`) and collated by name,
//! so a project folder on Home shows calm sheets for what lives inside it.
use super::projects::collate;
use crate::workspace::cloud::services::TreeEntry;
use std::path::Path;

pub const MAX_PROJECT_PREVIEWS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum PreviewKind {
    Html,
    Md,
    Csv,
    Other,
}

impl PreviewKind {
    pub fn from_name_and_type(name: &str, entry_type: Option<&str>) -> Self {
        let lower = name.to_ascii_lowercase();
        if entry_type == Some("html") || lower.ends_with(".html") || lower.ends_with(".htm") {
            return Self::Html;
        }
        if entry_type == Some("markdown")
            || lower.ends_with(".md")
            || lower.ends_with(".markdown")
            || lower.ends_with(".mdx")
        {
            return Self::Md;
        }
        if lower.ends_with(".csv") || lower.ends_with(".tsv") {
            return Self::Csv;
        }
        Self::Other
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectAssetPreview {
    pub name: String,
    pub kind: PreviewKind,
}

fn finish_previews(mut items: Vec<ProjectAssetPreview>) -> Vec<ProjectAssetPreview> {
    items.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| collate(&left.name, &right.name))
    });
    items.truncate(MAX_PROJECT_PREVIEWS);
    items
}

/// Reads up to three top-level file previews from a local project root.
pub fn select_local_previews(root: &Path) -> Vec<ProjectAssetPreview> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let items = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if name.is_empty() || name.starts_with('.') {
                return None;
            }
            let is_file = entry
                .file_type()
                .ok()
                .and_then(|ft| {
                    if ft.is_dir() {
                        Some(false)
                    } else if ft.is_file() {
                        Some(true)
                    } else {
                        None
                    }
                })
                .unwrap_or_else(|| entry.path().is_file());
            if !is_file {
                return None;
            }
            Some(ProjectAssetPreview {
                kind: PreviewKind::from_name_and_type(&name, None),
                name,
            })
        })
        .collect();
    finish_previews(items)
}

/// Selects up to three top-level file previews from `listCloudRoot` entries.
pub fn select_cloud_previews(entries: &[TreeEntry]) -> Vec<ProjectAssetPreview> {
    let items = entries
        .iter()
        .filter(|entry| {
            !entry.name.is_empty()
                && !entry.name.starts_with('.')
                && !matches!(entry.kind.as_str(), "folder" | "dir" | "directory")
        })
        .map(|entry| ProjectAssetPreview {
            name: entry.name.clone(),
            kind: PreviewKind::from_name_and_type(&entry.name, Some(entry.kind.as_str())),
        })
        .collect();
    finish_previews(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn cloud_previews_rank_html_md_csv_other_and_skip_dotfiles_and_folders() {
        let entries = vec![
            TreeEntry {
                name: ".env".into(),
                kind: "file".into(),
            },
            TreeEntry {
                name: "docs".into(),
                kind: "folder".into(),
            },
            TreeEntry {
                name: "notes.txt".into(),
                kind: "file".into(),
            },
            TreeEntry {
                name: "revenue.tsv".into(),
                kind: "file".into(),
            },
            TreeEntry {
                name: "README.md".into(),
                kind: "markdown".into(),
            },
            TreeEntry {
                name: "dashboard.html".into(),
                kind: "html".into(),
            },
        ];
        let previews = select_cloud_previews(&entries);
        assert_eq!(
            previews,
            vec![
                ProjectAssetPreview {
                    name: "dashboard.html".into(),
                    kind: PreviewKind::Html,
                },
                ProjectAssetPreview {
                    name: "README.md".into(),
                    kind: PreviewKind::Md,
                },
                ProjectAssetPreview {
                    name: "revenue.tsv".into(),
                    kind: PreviewKind::Csv,
                },
            ]
        );
    }

    #[test]
    fn local_previews_read_only_visible_top_level_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("subdir")).unwrap();
        std::fs::write(dir.path().join(".hidden.md"), "secret").unwrap();
        std::fs::write(dir.path().join("zeta.md"), "# Zeta").unwrap();
        std::fs::write(dir.path().join("alpha.md"), "# Alpha").unwrap();
        std::fs::write(dir.path().join("index.htm"), "<h1>Hi</h1>").unwrap();
        let previews = select_local_previews(dir.path());
        assert_eq!(
            previews,
            vec![
                ProjectAssetPreview {
                    name: "index.htm".into(),
                    kind: PreviewKind::Html,
                },
                ProjectAssetPreview {
                    name: "alpha.md".into(),
                    kind: PreviewKind::Md,
                },
                ProjectAssetPreview {
                    name: "zeta.md".into(),
                    kind: PreviewKind::Md,
                },
            ]
        );
    }
}
