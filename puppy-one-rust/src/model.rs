//! Cached explorer projection. Capability-scoped I/O lives in workspace.rs;
//! selecting a row never supplies an arbitrary path to the editor.
//! Visibility and display-name rules mirror `data-workspace/explorer.ts` and
//! `shared-ui/data/explorer/explorerVisibleModel.ts`.
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

pub const MAX_DIRECTORY_ENTRIES: usize = 2_000;

#[derive(Clone, Deserialize, Debug, Default)]
#[serde(default)]
pub struct Node {
    pub name: String,
    pub folder: bool,
    pub expanded: bool,
    pub children: Vec<Node>,
    #[serde(skip)]
    pub path: PathBuf,
    #[serde(skip)]
    pub loaded: bool,
    /// Last failed child read (`tree-folder-error`); cleared by a successful load.
    #[serde(skip)]
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Row {
    pub path: PathBuf,
    pub name: String,
    pub folder: bool,
    pub expanded: bool,
    pub depth: usize,
    /// Name without its matched extension (`getExplorerDisplayName`).
    pub display: String,
    /// Extension shown only when a sibling shares the same primary name.
    pub extension: Option<String>,
    /// Folder whose children could not be read; the row offers Retry.
    pub error: Option<String>,
}

/// Explorer visibility (`createExplorerDataPort`): with hidden files shown no
/// filtering applies; otherwise exclude patterns (bare names match anywhere).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Visibility {
    pub show_hidden: bool,
    pub patterns: Vec<String>,
}
impl Visibility {
    pub fn excluded(&self, path: &Path) -> bool {
        if self.show_hidden {
            return false;
        }
        let text = path.to_string_lossy().replace('\\', "/");
        self.patterns.iter().any(|raw| {
            let pattern = raw.trim().replace('\\', "/");
            let pattern = pattern.trim_start_matches('/');
            if pattern.is_empty() {
                return false;
            }
            let target = if pattern.contains('/') {
                pattern.to_owned()
            } else {
                format!("**/{pattern}")
            };
            crate::file_kind::glob(&target, &text)
        })
    }
}

pub struct Tree {
    pub roots: Vec<Node>,
    pub rows: Vec<Row>,
    /// Active row (`activePath`).
    pub selected: PathBuf,
    /// Multi-selection (`selectedPaths`), always containing `selected` when set.
    pub selection: BTreeSet<PathBuf>,
    /// Range anchor for Shift selection.
    pub anchor: Option<PathBuf>,
    pub visibility: Visibility,
}

impl Tree {
    pub fn new() -> Self {
        Self {
            roots: vec![],
            rows: vec![],
            selected: PathBuf::new(),
            selection: BTreeSet::new(),
            anchor: None,
            visibility: Visibility::default(),
        }
    }
    pub fn fixture() -> Self {
        let mut roots: Vec<Node> = serde_json::from_str(include_str!("../fixtures/tree.json"))
            .expect("checked-in fixture");
        fn bind(nodes: &mut [Node], base: &Path) {
            for n in nodes {
                n.path = base.join(&n.name);
                n.loaded = true;
                bind(&mut n.children, &n.path);
            }
        }
        bind(&mut roots, Path::new(""));
        let mut tree = Self {
            roots,
            selected: PathBuf::from("document/puppyone-desktop/architecture/02-native-shell.md"),
            ..Self::new()
        };
        tree.rebuild();
        tree
    }
    pub fn rebuild(&mut self) {
        fn visit(nodes: &[Node], depth: usize, visibility: &Visibility, rows: &mut Vec<Row>) {
            let visible: Vec<&Node> = nodes
                .iter()
                .filter(|n| !visibility.excluded(&n.path))
                .collect();
            let names: Vec<(String, Option<String>)> = visible
                .iter()
                .map(|n| crate::file_kind::display_name(&n.name, n.folder))
                .collect();
            for (n, (display, extension)) in visible.iter().zip(&names) {
                let key = display.trim().to_lowercase();
                let shared = names
                    .iter()
                    .filter(|(d, _)| d.trim().to_lowercase() == key)
                    .count()
                    > 1;
                rows.push(Row {
                    path: n.path.clone(),
                    name: n.name.clone(),
                    folder: n.folder,
                    expanded: n.expanded,
                    depth,
                    display: display.clone(),
                    extension: if shared { extension.clone() } else { None },
                    error: n.error.clone(),
                });
                if n.expanded {
                    visit(&n.children, depth + 1, visibility, rows);
                }
            }
        }
        self.rows.clear();
        visit(&self.roots, 0, &self.visibility, &mut self.rows);
        let rows = &self.rows;
        self.selection.retain(|p| rows.iter().any(|r| &r.path == p));
    }
    pub fn find_mut(&mut self, path: &Path) -> Option<&mut Node> {
        fn find<'a>(nodes: &'a mut [Node], path: &Path) -> Option<&'a mut Node> {
            for n in nodes {
                if n.path == path {
                    return Some(n);
                }
                if let Some(found) = find(&mut n.children, path) {
                    return Some(found);
                }
            }
            None
        }
        find(&mut self.roots, path)
    }
    pub fn attach_children(&mut self, path: &Path, children: Vec<Node>) {
        if let Some(node) = self.find_mut(path).filter(|node| node.folder) {
            node.children = children;
            node.loaded = true;
            node.expanded = true;
            node.error = None;
        }
        self.rebuild();
    }
    /// A child read failed: keep the folder collapsed and record the error on
    /// its row so it can be retried in place (`onRetryFolder`).
    pub fn fail_children(&mut self, path: &Path, error: String) {
        if let Some(node) = self.find_mut(path).filter(|node| node.folder) {
            node.expanded = false;
            node.error = Some(error);
        }
        self.rebuild();
    }
    /// Replace a folder's children after a mutation without changing its
    /// expansion; descendants that were loaded keep their own children.
    pub fn refresh_children(&mut self, path: &Path, mut children: Vec<Node>) {
        fn carry(old: &[Node], new: &mut [Node]) {
            for n in new {
                if let Some(o) = old
                    .iter()
                    .find(|o| o.path == n.path && o.folder == n.folder)
                {
                    n.expanded = o.expanded;
                    n.loaded = o.loaded;
                    n.children = o.children.clone();
                }
            }
        }
        if path.as_os_str().is_empty() {
            carry(&self.roots, &mut children);
            self.roots = children;
        } else if let Some(node) = self.find_mut(path).filter(|n| n.folder) {
            carry(&node.children, &mut children);
            node.children = children;
            node.loaded = true;
        }
        self.rebuild();
    }
    pub fn toggle(&mut self, path: &Path) -> bool {
        let load = if let Some(n) = self.find_mut(path) {
            if !n.folder {
                return false;
            }
            if !n.loaded {
                // Admission first, expansion second: never project a temporary
                // empty subtree while the filesystem worker is still reading.
                true
            } else {
                n.expanded = !n.expanded;
                false
            }
        } else {
            false
        };
        if !load {
            self.rebuild();
        }
        load
    }
    pub fn set_expanded(&mut self, path: &Path, expanded: bool) -> bool {
        let Some(n) = self.find_mut(path).filter(|n| n.folder) else {
            return false;
        };
        if expanded && !n.loaded {
            return true;
        }
        n.expanded = expanded;
        self.rebuild();
        false
    }
    pub fn index_of(&self, path: &Path) -> Option<usize> {
        self.rows.iter().position(|r| r.path == path)
    }
    /// `getSelectionIntent`: plain click selects one, ⌘ toggles, ⇧ extends.
    pub fn select(&mut self, path: &Path, additive: bool, range: bool) {
        if range && let Some(anchor) = self.anchor.clone() {
            let (Some(a), Some(b)) = (self.index_of(&anchor), self.index_of(path)) else {
                return;
            };
            let (lo, hi) = (a.min(b), a.max(b));
            if !additive {
                self.selection.clear();
            }
            for row in &self.rows[lo..=hi] {
                self.selection.insert(row.path.clone());
            }
        } else if additive {
            if !self.selection.remove(path) {
                self.selection.insert(path.to_owned());
            }
            self.anchor = Some(path.to_owned());
        } else {
            self.selection.clear();
            self.selection.insert(path.to_owned());
            self.anchor = Some(path.to_owned());
        }
        self.selected = path.to_owned();
    }
    /// Top-level selected paths (descendants of a selected folder collapse into it).
    pub fn selected_roots(&self) -> Vec<PathBuf> {
        let mut paths: Vec<PathBuf> =
            if self.selection.is_empty() && !self.selected.as_os_str().is_empty() {
                vec![self.selected.clone()]
            } else {
                self.selection.iter().cloned().collect()
            };
        paths.sort();
        let all = paths.clone();
        paths.retain(|p| !all.iter().any(|q| q != p && p.starts_with(q)));
        paths
    }
    pub fn is_folder(&self, path: &Path) -> bool {
        self.rows.iter().any(|r| r.path == path && r.folder)
    }
}
impl Default for Tree {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn collapsed_children_are_not_in_projection() {
        let mut t = Tree::fixture();
        let count = t.rows.len();
        assert!(!t.toggle(Path::new("document")));
        assert!(t.rows.len() < count);
        assert!(!t.rows.iter().any(|r| r.depth > 0));
        t.toggle(Path::new("document"));
        assert_eq!(t.rows.len(), count);
    }
    #[test]
    fn failed_folder_read_stays_on_its_row_until_a_retry_succeeds() {
        let mut tree = Tree {
            roots: vec![Node {
                name: "folder".into(),
                path: "folder".into(),
                folder: true,
                ..Default::default()
            }],
            ..Tree::new()
        };
        tree.rebuild();
        assert!(tree.toggle(Path::new("folder")));
        tree.fail_children(Path::new("folder"), "denied".into());
        assert_eq!(tree.rows.len(), 1);
        assert!(!tree.rows[0].expanded);
        assert_eq!(tree.rows[0].error.as_deref(), Some("denied"));
        // Retry asks for a read again; success clears the error.
        assert!(tree.set_expanded(Path::new("folder"), true));
        tree.attach_children(Path::new("folder"), vec![]);
        assert!(tree.rows[0].expanded);
        assert_eq!(tree.rows[0].error, None);
    }
    #[test]
    fn first_expansion_waits_for_loaded_children_and_empty_has_no_fake_row() {
        let mut tree = Tree {
            roots: vec![Node {
                name: "folder".into(),
                path: "folder".into(),
                folder: true,
                ..Default::default()
            }],
            ..Tree::new()
        };
        tree.rebuild();
        assert!(tree.toggle(Path::new("folder")));
        assert!(!tree.rows[0].expanded);
        tree.attach_children(Path::new("folder"), vec![]);
        assert!(tree.rows[0].expanded);
        assert_eq!(tree.rows.len(), 1);
        assert!(!tree.toggle(Path::new("folder")));
        assert!(!tree.rows[0].expanded);
    }
    #[test]
    fn missing_and_file_rows_do_not_request_directory_work() {
        let mut t = Tree::fixture();
        assert!(!t.toggle(Path::new("missing")));
        assert!(!t.toggle(Path::new("README.md")));
    }
    #[test]
    fn visibility_display_names_and_selection_follow_the_product() {
        let node = |name: &str, folder: bool| Node {
            name: name.into(),
            path: name.into(),
            folder,
            loaded: true,
            ..Default::default()
        };
        let mut tree = Tree {
            roots: vec![
                node(".git", true),
                node(".DS_Store", false),
                node("notes.md", false),
                node("notes.txt", false),
                node("README.md", false),
            ],
            visibility: Visibility {
                show_hidden: false,
                patterns: crate::features::settings::preference_types::DEFAULT_EXCLUDE_PATTERNS
                    .map(String::from)
                    .to_vec(),
            },
            ..Tree::new()
        };
        tree.rebuild();
        let names: Vec<_> = tree.rows.iter().map(|r| r.display.as_str()).collect();
        assert_eq!(names, ["notes", "notes", "README"]);
        assert_eq!(tree.rows[0].extension.as_deref(), Some("md"));
        assert_eq!(tree.rows[2].extension, None);
        tree.visibility.show_hidden = true;
        tree.rebuild();
        assert_eq!(tree.rows.len(), 5);
        tree.select(Path::new("notes.md"), false, false);
        tree.select(Path::new("README.md"), false, true);
        assert_eq!(tree.selection.len(), 3);
        tree.select(Path::new("notes.txt"), true, false);
        assert_eq!(tree.selected_roots().len(), 2);
    }
}
