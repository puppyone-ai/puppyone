//! Cached explorer projection. Capability-scoped I/O lives in workspace.rs;
//! selecting a row never supplies an arbitrary path to the editor.
//! Visibility and display-name rules mirror `data-workspace/explorer.ts` and
//! `shared-ui/data/explorer/explorerVisibleModel.ts`.
use serde::Deserialize;
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

/// Process-wide, so a replaced tree never reuses a revision.
static NEXT_REVISION: AtomicU64 = AtomicU64::new(1);

pub const MAX_DIRECTORY_ENTRIES: usize =
    crate::workspace::contracts::Limits::LOCAL.directory_entries;

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
    /// The read failure of the folder this status row stands under.
    pub error: Option<String>,
    /// `ExplorerVisibleMetaRow` with `retryPath`: the failed folder's own
    /// line under it (error text and Retry). Its `path` is synthetic and
    /// never selected, opened or dragged; [`Row::status_of`] names the folder.
    pub status: bool,
}
impl Row {
    /// The folder a status row reports on.
    pub fn status_of(&self) -> Option<&Path> {
        self.status.then(|| self.path.parent()).flatten()
    }
}
/// A status row's path: a child no real entry can have.
fn status_path(folder: &Path) -> PathBuf {
    folder.join("\u{0}error")
}

/// `DEFAULT_EXPLORER_EXCLUDE_PATTERNS`: what the Explorer hides unless hidden
/// files are shown.
pub const DEFAULT_EXCLUDE_PATTERNS: [&str; 6] = [
    "**/.git",
    "**/.puppyone",
    "**/.svn",
    "**/.hg",
    "**/.DS_Store",
    "**/Thumbs.db",
];
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
            crate::formats::glob(&target, &text)
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
    /// Changes whenever `rows` is rebuilt (the Explorer's motion keys on it).
    pub revision: u64,
    /// Identifies this tree: a replaced tree (another project, the first
    /// load) is new content, not a disclosure.
    pub id: u64,
}

impl Tree {
    /// A committed move changes addresses, not disclosure/selection state.
    pub fn rebind(&mut self, from: &Path, to: &Path) {
        fn detach(nodes: &mut Vec<Node>, from: &Path) -> Option<Node> {
            if let Some(index) = nodes.iter().position(|n| n.path == from) {
                return Some(nodes.remove(index));
            }
            nodes
                .iter_mut()
                .find_map(|node| detach(&mut node.children, from))
        }
        fn path(value: &mut PathBuf, from: &Path, to: &Path) {
            if let Ok(rest) = value.strip_prefix(from) {
                *value = if rest.as_os_str().is_empty() {
                    to.into()
                } else {
                    to.join(rest)
                };
            }
        }
        fn nodes(entries: &mut [Node], from: &Path, to: &Path) {
            for node in entries {
                path(&mut node.path, from, to);
                node.name = node
                    .path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                nodes(&mut node.children, from, to);
            }
        }
        if let Some(mut node) = detach(&mut self.roots, from) {
            nodes(std::slice::from_mut(&mut node), from, to);
            let parent = to.parent().unwrap_or(Path::new(""));
            if parent.as_os_str().is_empty() {
                self.roots.push(node);
            } else if let Some(destination) = self.find_mut(parent) {
                destination.children.push(node);
            }
        }
        path(&mut self.selected, from, to);
        self.selection = self
            .selection
            .iter()
            .cloned()
            .map(|mut p| {
                path(&mut p, from, to);
                p
            })
            .collect();
        if let Some(anchor) = &mut self.anchor {
            path(anchor, from, to);
        }
    }
    pub fn remove_selection(&mut self, path: &Path) {
        self.selection.retain(|p| !p.starts_with(path));
        if self.selected.starts_with(path) {
            self.selected = PathBuf::new();
        }
        if self.anchor.as_ref().is_some_and(|p| p.starts_with(path)) {
            self.anchor = None;
        }
    }
    /// Revalidate previously read folders when restoring an Explorer session.
    /// Parent-first reads let removed subtrees disappear before child results.
    pub fn loaded_folders(&self) -> Vec<PathBuf> {
        fn visit(nodes: &[Node], paths: &mut Vec<PathBuf>) {
            for node in nodes.iter().filter(|n| n.folder && n.loaded) {
                paths.push(node.path.clone());
                visit(&node.children, paths);
            }
        }
        let mut paths = vec![PathBuf::new()];
        visit(&self.roots, &mut paths);
        paths
    }
    pub fn new() -> Self {
        Self {
            roots: vec![],
            rows: vec![],
            selected: PathBuf::new(),
            selection: BTreeSet::new(),
            anchor: None,
            visibility: Visibility::default(),
            revision: 0,
            id: NEXT_REVISION.fetch_add(1, Ordering::Relaxed),
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
            // Siblings sharing a primary name show their extensions: count
            // each key once (a folder holds up to 2,000 entries).
            let keys: Vec<String> = names
                .iter()
                .map(|(display, _)| display.trim().to_lowercase())
                .collect();
            let mut counts: HashMap<&str, usize> = HashMap::with_capacity(keys.len());
            for key in &keys {
                *counts.entry(key.as_str()).or_default() += 1;
            }
            for ((n, (display, extension)), key) in visible.iter().zip(&names).zip(&keys) {
                let shared = counts[key.as_str()] > 1;
                rows.push(Row {
                    path: n.path.clone(),
                    name: n.name.clone(),
                    folder: n.folder,
                    expanded: n.expanded,
                    depth,
                    display: display.clone(),
                    extension: if shared { extension.clone() } else { None },
                    error: None,
                    status: false,
                });
                if n.expanded {
                    // `buildExplorerVisibleRows`: the failure first, then
                    // whatever children are still known.
                    if let Some(error) = &n.error {
                        rows.push(Row {
                            path: status_path(&n.path),
                            name: String::new(),
                            folder: false,
                            expanded: false,
                            depth: depth + 1,
                            display: error.clone(),
                            extension: None,
                            error: Some(error.clone()),
                            status: true,
                        });
                    }
                    visit(&n.children, depth + 1, visibility, rows);
                }
            }
        }
        self.rows.clear();
        visit(&self.roots, 0, &self.visibility, &mut self.rows);
        self.revision = NEXT_REVISION.fetch_add(1, Ordering::Relaxed);
        if !self.selection.is_empty() {
            let shown: HashSet<&Path> = self.rows.iter().map(|r| r.path.as_path()).collect();
            self.selection.retain(|p| shown.contains(p.as_path()));
        }
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
    /// A child read failed: the folder stays open and shows the failure on
    /// its own line beneath it, with Retry (`folderErrors`, `onRetryFolder`).
    pub fn fail_children(&mut self, path: &Path, error: String) {
        if let Some(node) = self.find_mut(path).filter(|node| node.folder) {
            node.expanded = true;
            node.error = Some(error);
        }
        self.rebuild();
    }
    /// `onRetryFolder`: forget the failure and read the folder again.
    pub fn retry_folder(&mut self, path: &Path) -> bool {
        let Some(node) = self.find_mut(path).filter(|node| node.folder) else {
            return false;
        };
        node.error = None;
        node.expanded = true;
        self.rebuild();
        true
    }
    /// Replace a folder's children after a mutation without changing its
    /// expansion; descendants that were loaded keep their own children.
    pub fn refresh_children(&mut self, path: &Path, children: Vec<Node>) {
        self.replace_children(path, children);
        self.rebuild();
    }
    /// Rereads of several folders (parent first) and the folders whose
    /// reread failed, projected once.
    pub fn refresh_folders(
        &mut self,
        listings: Vec<(PathBuf, Vec<Node>)>,
        failed: Vec<(PathBuf, String)>,
    ) {
        for (path, children) in listings {
            self.replace_children(&path, children);
        }
        for (path, error) in failed {
            if let Some(node) = self.find_mut(&path) {
                node.error = Some(error);
            }
        }
        self.rebuild();
    }
    fn replace_children(&mut self, path: &Path, mut children: Vec<Node>) {
        // The old listing is dropped: its loaded subtrees move into the
        // entries that are still there instead of being copied.
        fn carry(old: Vec<Node>, new: &mut [Node]) {
            let mut old: HashMap<(PathBuf, bool), Node> = old
                .into_iter()
                .map(|o| ((o.path.clone(), o.folder), o))
                .collect();
            for n in new {
                if let Some(o) = old.remove(&(n.path.clone(), n.folder)) {
                    n.expanded = o.expanded;
                    n.loaded = o.loaded;
                    n.children = o.children;
                }
            }
        }
        if path.as_os_str().is_empty() {
            carry(std::mem::take(&mut self.roots), &mut children);
            self.roots = children;
        } else if let Some(node) = self.find_mut(path).filter(|n| n.folder) {
            carry(std::mem::take(&mut node.children), &mut children);
            node.children = children;
            node.loaded = true;
        }
    }
    pub fn toggle(&mut self, path: &Path) -> bool {
        let load = if let Some(n) = self.find_mut(path) {
            if !n.folder {
                return false;
            }
            if !n.loaded && !n.expanded {
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
        // The folder stays open; its failure is the line beneath it.
        assert_eq!(tree.rows.len(), 2);
        assert!(tree.rows[0].expanded);
        assert!(!tree.rows[0].status);
        assert!(tree.rows[1].status);
        assert_eq!(tree.rows[1].depth, 1);
        assert_eq!(tree.rows[1].error.as_deref(), Some("denied"));
        assert_eq!(tree.rows[1].status_of(), Some(Path::new("folder")));
        assert_eq!(tree.index_of(Path::new("folder")), Some(0));
        // Collapsing hides it; Retry reads again and success clears it.
        assert!(!tree.toggle(Path::new("folder")));
        assert_eq!(tree.rows.len(), 1);
        assert!(tree.retry_folder(Path::new("folder")));
        tree.attach_children(Path::new("folder"), vec![]);
        assert_eq!(tree.rows.len(), 1);
        assert!(tree.rows[0].expanded);
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
    /// A project with a wide folder open (`node_modules`-like) and a few
    /// nested ones: what one watcher burst costs the foreground.
    /// `cargo test --release -p po-contracts model::tests::tree_refresh_cost -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn tree_refresh_cost() {
        let entries = |base: &Path, count: usize| -> Vec<Node> {
            (0..count)
                .map(|i| {
                    let name = if i % 3 == 0 {
                        format!("package-{i}")
                    } else {
                        format!("file-{}.{}", i / 2, if i % 2 == 0 { "md" } else { "js" })
                    };
                    Node {
                        path: base.join(&name),
                        folder: i % 3 == 0,
                        name,
                        ..Default::default()
                    }
                })
                .collect()
        };
        let mut tree = Tree {
            visibility: Visibility {
                show_hidden: false,
                patterns: DEFAULT_EXCLUDE_PATTERNS.map(String::from).to_vec(),
            },
            ..Tree::new()
        };
        tree.roots = entries(Path::new(""), 40);
        tree.roots.push(Node {
            name: "node_modules".into(),
            path: "node_modules".into(),
            folder: true,
            ..Default::default()
        });
        tree.rebuild();
        let wide = PathBuf::from("node_modules");
        tree.attach_children(&wide, entries(&wide, MAX_DIRECTORY_ENTRIES));
        let nested: Vec<PathBuf> = (0..30)
            .map(|i| wide.join(format!("package-{}", i * 3)))
            .collect();
        for path in &nested {
            tree.attach_children(path, entries(path, 200));
        }
        let listings: Vec<(PathBuf, Vec<Node>)> = tree
            .loaded_folders()
            .into_iter()
            .map(|path| {
                let count = match path.as_os_str().len() {
                    0 => 40,
                    _ if path == wide => MAX_DIRECTORY_ENTRIES,
                    _ => 200,
                };
                let mut nodes = entries(&path, count);
                if path.as_os_str().is_empty() {
                    nodes.push(Node {
                        name: "node_modules".into(),
                        path: wide.clone(),
                        folder: true,
                        ..Default::default()
                    });
                }
                (path, nodes)
            })
            .collect();
        let started = std::time::Instant::now();
        tree.rebuild();
        let rebuild = started.elapsed();
        let started = std::time::Instant::now();
        tree.refresh_folders(listings, vec![]);
        let refresh = started.elapsed();
        println!(
            "rows {} · rebuild {rebuild:?} · refresh of {} folders {refresh:?}",
            tree.rows.len(),
            nested.len() + 2
        );
    }
    #[test]
    fn refreshing_folders_keeps_loaded_subtrees_and_drops_removed_entries() {
        let node = |path: &str, folder: bool| Node {
            name: Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into(),
            path: path.into(),
            folder,
            ..Default::default()
        };
        let mut tree = Tree {
            roots: vec![node("a", true), node("b", true), node("gone.md", false)],
            ..Tree::new()
        };
        tree.rebuild();
        tree.attach_children(
            Path::new("a"),
            vec![node("a/x", true), node("a/y.md", false)],
        );
        tree.attach_children(Path::new("a/x"), vec![node("a/x/deep.md", false)]);
        tree.select(Path::new("gone.md"), false, false);
        tree.select(Path::new("a/y.md"), true, false);
        tree.refresh_folders(
            vec![
                (
                    PathBuf::new(),
                    vec![node("a", true), node("b", true), node("new.md", false)],
                ),
                (
                    "a".into(),
                    vec![
                        node("a/x", true),
                        node("a/y.md", false),
                        node("a/z.md", false),
                    ],
                ),
            ],
            // A failed reread under a refreshed parent still shows.
            vec![("a/x".into(), "denied".into())],
        );
        let paths: Vec<_> = tree.rows.iter().map(|r| r.path.to_str().unwrap()).collect();
        assert_eq!(
            paths,
            [
                "a",
                "a/x",
                "a/x/\u{0}error",
                "a/x/deep.md",
                "a/y.md",
                "a/z.md",
                "b",
                "new.md"
            ]
        );
        assert!(
            tree.find_mut(Path::new("a/x"))
                .is_some_and(|n| n.loaded && n.expanded)
        );
        // A selection whose row went away is dropped; the rest stays.
        assert_eq!(
            tree.selection.iter().collect::<Vec<_>>(),
            [Path::new("a/y.md")]
        );
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
                patterns: DEFAULT_EXCLUDE_PATTERNS.map(String::from).to_vec(),
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
