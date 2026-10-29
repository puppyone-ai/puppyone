//! Cloud Project history (`project-history.md`): `cloudHistoryApi.ts`,
//! `history/pagination.ts`, the commit labels of `graph/cloudTopology.ts`
//! and the bounded snapshot cache behind `historyRepository.ts`.
//!
//! Summaries and commit detail are separate reads. Every page is checked
//! against the topology contract: the Project matches, ancestry is present,
//! the snapshot id is 64 hex digits, only the first page carries refs, and
//! `has_more` agrees with the cursor. Pages merge only within one snapshot;
//! a different snapshot, ancestry that changed between pages, a page that
//! made no progress, or HTTP 409 restarts from the first page.
use crate::cloud_auth::model::ApiRequest;
use reqwest::Method;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::{Duration, Instant},
};

/// Commits per page in the History sidebar (`acquireHistoryPage`).
pub const PAGE_SIZE: usize = 80;
/// `historyRepository` keeps a snapshot reusable for 30 s and paints a stale
/// one while a fresh read revalidates it.
pub const TTL: Duration = Duration::from_secs(30);
/// `cloudCache`'s entry bound.
pub const CACHE_ENTRIES: usize = 320;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
}
/// `DesktopCloudHistoryChange`, resolved through `action` or `op`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change {
    pub path: String,
    pub kind: ChangeKind,
}
/// `DesktopCloudHistoryCommit`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub id: String,
    pub parents: Vec<String>,
    pub who: String,
    pub message: String,
    pub changes: Vec<Change>,
    /// A summary page leaves the paths to the detail read.
    pub changes_loaded: bool,
    pub created_at: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefKind {
    Branch,
    Tag,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ref {
    pub name: String,
    pub kind: RefKind,
    pub commit: String,
}
/// `DesktopCloudHistory`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct History {
    pub project: String,
    pub commits: Vec<Commit>,
    pub head: Option<String>,
    pub refs: Vec<Ref>,
    pub refs_included: bool,
    pub snapshot: String,
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub total: u64,
    /// `graph_health: "degraded"` or unreadable commits.
    pub degraded: bool,
    pub unreadable: Vec<String>,
}
impl History {
    /// `hasMore`: a further page exists and can be addressed.
    pub fn more(&self) -> bool {
        self.has_more && self.next_cursor.is_some()
    }
    /// `getHistoryHealthWarning`: `None` while complete, else the count of
    /// unreadable commits (zero when the server gave none).
    pub fn warning(&self) -> Option<usize> {
        self.degraded.then_some(self.unreadable.len())
    }
}

/// Why a response was refused. Server prose never reaches the view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Invalid {
    Envelope,
    Commit,
    Change,
    Ref,
    Duplicate,
    Project,
    Topology,
    Snapshot,
    Refs,
    Pagination,
    Detail,
}
/// The loaded pages no longer describe one snapshot: restart from the first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapshotChanged;

/// The Project id goes into the path as is; anything that would need
/// escaping is refused before a request is built.
fn path_segment(id: &str) -> Option<&str> {
    (!id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        && id != "."
        && id != "..")
        .then_some(id)
}
/// `getCloudHistory(…, 80, …, cursor, { summary: true })`.
pub fn page_request(project: &str, cursor: Option<&str>) -> Option<ApiRequest> {
    let project = path_segment(project)?;
    let mut query = vec![
        ("limit".to_owned(), PAGE_SIZE.to_string()),
        ("order".to_owned(), "topo".to_owned()),
    ];
    if let Some(cursor) = cursor {
        query.push(("cursor".to_owned(), cursor.to_owned()));
    }
    query.push(("summary".to_owned(), "true".to_owned()));
    Some(ApiRequest {
        idempotency_key: None,
        method: Method::GET,
        path: format!("/content/{project}/commits"),
        query,
        body: None,
    })
}
/// `getCloudHistoryDetail`.
pub fn detail_request(project: &str, commit: &str) -> Option<ApiRequest> {
    let project = path_segment(project)?;
    Some(ApiRequest {
        idempotency_key: None,
        method: Method::GET,
        path: format!("/content/{project}/commit-detail"),
        query: vec![("commit_id".to_owned(), commit.to_owned())],
        body: None,
    })
}

/// `cloudApiRequest`: the envelope's `data`, or the body itself.
pub fn payload(value: &Value) -> &Value {
    match value.get("data") {
        Some(data) if value.is_object() => data,
        _ => value,
    }
}

fn hex(value: &str, lengths: &[usize]) -> bool {
    lengths.contains(&value.len()) && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn commit_id(value: &Value) -> Result<String, Invalid> {
    value
        .as_str()
        .filter(|v| hex(v, &[40, 64]))
        .map(str::to_ascii_lowercase)
        .ok_or(Invalid::Commit)
}
fn array(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}
fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_owned()
}
fn unique(values: impl Iterator<Item = String>) -> Result<(), Invalid> {
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(Invalid::Duplicate);
        }
    }
    Ok(())
}

fn change(value: &Value) -> Result<Change, Invalid> {
    let path = value["path"]
        .as_str()
        .filter(|p| !p.is_empty())
        .ok_or(Invalid::Change)?;
    let kind = match (value["action"].as_str(), value["op"].as_str()) {
        (Some("add"), _) | (_, Some("added")) => ChangeKind::Added,
        (Some("delete"), _) | (_, Some("deleted")) => ChangeKind::Deleted,
        _ => ChangeKind::Modified,
    };
    Ok(Change {
        path: path.to_owned(),
        kind,
    })
}
/// `normalizeCommit`.
fn commit(value: &Value) -> Result<Commit, Invalid> {
    if !value.is_object() {
        return Err(Invalid::Commit);
    }
    let mut parents = Vec::new();
    for parent in array(&value["parent_ids"]) {
        let parent = commit_id(parent)?;
        if !parents.contains(&parent) {
            parents.push(parent);
        }
    }
    if array(&value["conflicts"]).iter().any(|c| !c.is_object()) {
        return Err(Invalid::Commit);
    }
    Ok(Commit {
        id: commit_id(&value["commit_id"])?,
        parents,
        who: text(&value["who"]),
        message: text(&value["message"]),
        changes: array(&value["changes"])
            .iter()
            .map(change)
            .collect::<Result<_, _>>()?,
        changes_loaded: value["changes_loaded"] != Value::Bool(false),
        created_at: value["created_at"].as_str().map(str::to_owned),
    })
}
/// `normalizeRef`: `refs/heads/…` branches and `refs/tags/…` tags only.
fn reference(value: &Value) -> Result<Ref, Invalid> {
    let name = value["ref_name"]
        .as_str()
        .filter(|n| !n.is_empty())
        .ok_or(Invalid::Ref)?;
    let (kind, prefix) = match value["ref_type"].as_str() {
        Some("branch") => (RefKind::Branch, "refs/heads/"),
        Some("tag") => (RefKind::Tag, "refs/tags/"),
        _ => return Err(Invalid::Ref),
    };
    if !name.starts_with(prefix) || name == prefix {
        return Err(Invalid::Ref);
    }
    Ok(Ref {
        name: name.to_owned(),
        kind,
        commit: commit_id(&value["commit_id"]).map_err(|_| Invalid::Ref)?,
    })
}

/// `validateCurrentHistoryEnvelope` + `normalizeCloudHistory` + the
/// `getCloudHistory` checks. `continuation` is a page read with a cursor.
pub fn parse_page(raw: &Value, project: &str, continuation: bool) -> Result<History, Invalid> {
    let value = payload(raw);
    let snapshot = value["snapshot_id"]
        .as_str()
        .filter(|s| s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')));
    let envelope = value["project_id"].as_str().is_some_and(|p| !p.is_empty())
        && value["refs_included"].is_boolean()
        && value["has_more"].is_boolean()
        && (value["next_cursor"].is_null() || value["next_cursor"].is_string())
        && value["total"].as_u64().is_some()
        && matches!(
            value["graph_health"].as_str(),
            Some("complete" | "degraded")
        )
        && value["refs"].is_array()
        && value["unreadable_commit_ids"].is_array();
    if !envelope {
        return Err(Invalid::Envelope);
    }
    let snapshot = snapshot.ok_or(Invalid::Snapshot)?.to_owned();
    let raw_commits = value["commits"].as_array().ok_or(Invalid::Envelope)?;
    let topology = raw_commits.iter().all(|c| c["parent_ids"].is_array());
    let commits: Vec<Commit> = raw_commits.iter().map(commit).collect::<Result<_, _>>()?;
    let refs: Vec<Ref> = array(&value["refs"])
        .iter()
        .map(reference)
        .collect::<Result<_, _>>()?;
    unique(commits.iter().map(|c| c.id.clone()))?;
    unique(refs.iter().map(|r| r.name.clone()))?;
    let head = match &value["head_commit_id"] {
        Value::Null => None,
        Value::String(s) if s.is_empty() => None,
        other => Some(commit_id(other)?),
    };
    let mut unreadable = Vec::new();
    for id in array(&value["unreadable_commit_ids"]) {
        let id = commit_id(id)?;
        if !unreadable.contains(&id) {
            unreadable.push(id);
        }
    }
    let history = History {
        project: text(&value["project_id"]),
        total: value["total"]
            .as_u64()
            .unwrap_or(0)
            .max(commits.len() as u64),
        commits,
        head,
        refs,
        refs_included: value["refs_included"] != Value::Bool(false),
        snapshot,
        next_cursor: value["next_cursor"]
            .as_str()
            .filter(|c| !c.is_empty())
            .map(str::to_owned),
        has_more: value["has_more"] == Value::Bool(true),
        degraded: value["graph_health"] == "degraded" || !unreadable.is_empty(),
        unreadable,
    };
    if history.project != project {
        return Err(Invalid::Project);
    }
    if !topology {
        return Err(Invalid::Topology);
    }
    if continuation == history.refs_included || (!history.refs_included && !history.refs.is_empty())
    {
        return Err(Invalid::Refs);
    }
    if history.has_more != history.next_cursor.is_some() {
        return Err(Invalid::Pagination);
    }
    Ok(history)
}
/// `getCloudHistoryDetail`: the requested commit, with its paths.
pub fn parse_detail(raw: &Value, id: &str) -> Result<Commit, Invalid> {
    let commit = commit(payload(raw))?;
    if commit.id != id || !commit.changes_loaded {
        return Err(Invalid::Detail);
    }
    Ok(commit)
}

/// `mergeCloudHistoryPages`.
pub fn merge(current: &History, next: History) -> Result<History, SnapshotChanged> {
    if current.project != next.project
        || current.snapshot != next.snapshot
        || current.head != next.head
        || current.total != next.total
    {
        return Err(SnapshotChanged);
    }
    let mut commits = current.commits.clone();
    let mut index: HashMap<String, usize> = commits
        .iter()
        .enumerate()
        .map(|(i, c)| (c.id.clone(), i))
        .collect();
    for commit in next.commits {
        match index.get(&commit.id) {
            Some(&i) if commits[i].parents != commit.parents => return Err(SnapshotChanged),
            Some(_) => {}
            None => {
                index.insert(commit.id.clone(), commits.len());
                commits.push(commit);
            }
        }
    }
    let progress = commits.len() > current.commits.len();
    if !progress && next.has_more {
        return Err(SnapshotChanged);
    }
    let mut unreadable = current.unreadable.clone();
    for id in next.unreadable {
        if !unreadable.contains(&id) {
            unreadable.push(id);
        }
    }
    Ok(History {
        project: current.project.clone(),
        commits,
        head: current.head.clone(),
        refs: current.refs.clone(),
        refs_included: current.refs_included,
        snapshot: current.snapshot.clone(),
        next_cursor: if progress { next.next_cursor } else { None },
        has_more: progress && next.has_more,
        total: current.total,
        degraded: current.degraded || next.degraded,
        unreadable,
    })
}

/// `CloudBranchGraphLabel` as the History detail shows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LabelKind {
    Cloud,
    Tag,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Label {
    pub name: String,
    pub kind: LabelKind,
    pub current: bool,
}
/// `sortCloudBranchLabels`: current first, then by kind, then by name.
fn sort_labels(labels: &mut [Label]) {
    labels.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then(a.kind.cmp(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
}
/// `buildCloudTopologyGraphRows`' labels for loaded commits: each ref by its
/// short name (`main` is current at the head), and `HEAD` on the head
/// commit when no ref marks it current. Refs whose commit is outside the
/// loaded pages label nothing here.
pub fn labels(history: &History) -> HashMap<String, Vec<Label>> {
    let loaded: HashSet<&str> = history.commits.iter().map(|c| c.id.as_str()).collect();
    let mut labels: HashMap<String, Vec<Label>> = HashMap::new();
    for r in &history.refs {
        if !loaded.contains(r.commit.as_str()) {
            continue;
        }
        let name = r
            .name
            .strip_prefix("refs/heads/")
            .or_else(|| r.name.strip_prefix("refs/tags/"))
            .unwrap_or(&r.name);
        labels.entry(r.commit.clone()).or_default().push(Label {
            name: name.to_owned(),
            kind: match r.kind {
                RefKind::Tag => LabelKind::Tag,
                RefKind::Branch => LabelKind::Cloud,
            },
            current: r.name == "refs/heads/main" && history.head.as_ref() == Some(&r.commit),
        });
    }
    if let Some(head) = history
        .head
        .as_ref()
        .filter(|h| loaded.contains(h.as_str()))
    {
        let entry = labels.entry(head.clone()).or_default();
        if !entry.iter().any(|l| l.current) {
            entry.push(Label {
                name: "HEAD".to_owned(),
                kind: LabelKind::Cloud,
                current: true,
            });
        }
    }
    for entry in labels.values_mut() {
        sort_labels(entry);
    }
    labels
}

/// `cloudCache` for History: one account namespace at a time (another
/// account, session generation or API clears everything), bounded LRU, and
/// stale reads allowed so a view paints the last snapshot while a fresh read
/// revalidates it.
pub struct Cache<V> {
    namespace: Option<String>,
    entries: HashMap<String, (Instant, V)>,
    order: VecDeque<String>,
    capacity: usize,
}
impl<V: Clone> Cache<V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            namespace: None,
            entries: HashMap::new(),
            order: VecDeque::new(),
            capacity,
        }
    }
    /// `activateSession`: a different namespace clears the cache.
    pub fn activate(&mut self, namespace: &str) {
        if self.namespace.as_deref() != Some(namespace) {
            self.namespace = Some(namespace.to_owned());
            self.entries.clear();
            self.order.clear();
        }
    }
    fn touch(&mut self, key: &str) {
        if let Some(i) = self.order.iter().position(|k| k == key) {
            let key = self.order.remove(i).unwrap();
            self.order.push_back(key);
        }
    }
    /// The stored value and whether it is still fresh at `now`.
    pub fn read(&mut self, key: &str, now: Instant) -> Option<(V, bool)> {
        let (stored, value) = self.entries.get(key)?.clone();
        self.touch(key);
        Some((value, now.saturating_duration_since(stored) < TTL))
    }
    pub fn store(&mut self, key: String, value: V, now: Instant) {
        if self.entries.insert(key.clone(), (now, value)).is_some() {
            self.touch(&key);
        } else {
            self.order.push_back(key);
        }
        while self.order.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }
    /// `discard`: a failed read leaves nothing behind.
    pub fn discard(&mut self, key: &str) {
        if self.entries.remove(key).is_some() {
            self.order.retain(|k| k != key);
        }
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    const SNAP: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    fn id(n: u8) -> String {
        format!("{n:02x}").repeat(20)
    }
    fn page(commits: Value, first: bool, cursor: Option<&str>) -> Value {
        json!({"code": 0, "data": {
            "project_id": "p1",
            "commits": commits,
            "head_commit_id": id(1),
            "refs": if first { json!([
                {"ref_name": "refs/heads/main", "ref_type": "branch", "commit_id": id(1)},
                {"ref_name": "refs/tags/v1", "ref_type": "tag", "commit_id": id(2)},
                {"ref_name": "refs/heads/old", "ref_type": "branch", "commit_id": id(9)}
            ]) } else { json!([]) },
            "refs_included": first,
            "snapshot_id": SNAP,
            "next_cursor": cursor,
            "has_more": cursor.is_some(),
            "total": 3,
            "graph_health": "complete",
            "unreadable_commit_ids": []
        }})
    }
    fn commit(n: u8, parents: &[u8]) -> Value {
        json!({"commit_id": id(n), "parent_ids": parents.iter().map(|p| id(*p)).collect::<Vec<_>>(),
               "who": "agent", "message": format!("c{n}"), "changes_loaded": false,
               "created_at": "2026-10-28T10:00:00Z"})
    }

    #[test]
    fn requests_read_eighty_summaries_per_page_and_detail_separately() {
        let first = page_request("p1", None).unwrap();
        assert_eq!(first.path, "/content/p1/commits");
        assert_eq!(
            first.query,
            [
                ("limit".to_owned(), "80".to_owned()),
                ("order".to_owned(), "topo".to_owned()),
                ("summary".to_owned(), "true".to_owned()),
            ]
        );
        let next = page_request("p1", Some("c2")).unwrap();
        assert!(next.query.contains(&("cursor".to_owned(), "c2".to_owned())));
        let detail = detail_request("p1", &id(1)).unwrap();
        assert_eq!(detail.path, "/content/p1/commit-detail");
        assert!(page_request("../x", None).is_none());
        assert!(page_request("a/b", None).is_none());
    }

    #[test]
    fn pages_follow_the_topology_contract() {
        let raw = page(json!([commit(1, &[2]), commit(2, &[3])]), true, Some("n"));
        let history = parse_page(&raw, "p1", false).unwrap();
        assert_eq!(history.commits.len(), 2);
        assert!(history.more());
        assert!(!history.commits[0].changes_loaded);
        // Another Project, refs on a continuation page, a first page without
        // refs, cursor disagreement, missing ancestry: refused.
        assert_eq!(parse_page(&raw, "p2", false), Err(Invalid::Project));
        assert_eq!(parse_page(&raw, "p1", true), Err(Invalid::Refs));
        let bare = page(json!([commit(3, &[])]), false, None);
        assert_eq!(parse_page(&bare, "p1", false), Err(Invalid::Refs));
        assert!(parse_page(&bare, "p1", true).is_ok());
        let mut mismatch = raw.clone();
        mismatch["data"]["next_cursor"] = Value::Null;
        assert_eq!(parse_page(&mismatch, "p1", false), Err(Invalid::Pagination));
        let mut flat = raw.clone();
        flat["data"]["commits"][0]
            .as_object_mut()
            .unwrap()
            .remove("parent_ids");
        assert_eq!(parse_page(&flat, "p1", false), Err(Invalid::Topology));
        let mut snapshot = raw.clone();
        snapshot["data"]["snapshot_id"] = json!("legacy|x");
        assert_eq!(parse_page(&snapshot, "p1", false), Err(Invalid::Snapshot));
        let mut duplicate = raw.clone();
        duplicate["data"]["commits"] = json!([commit(1, &[]), commit(1, &[])]);
        assert_eq!(parse_page(&duplicate, "p1", false), Err(Invalid::Duplicate));
        let mut health = raw;
        health["data"]["graph_health"] = json!("unknown");
        assert_eq!(parse_page(&health, "p1", false), Err(Invalid::Envelope));
    }

    #[test]
    fn degraded_graphs_warn_with_the_unreadable_count() {
        let mut raw = page(json!([commit(1, &[])]), true, None);
        assert_eq!(parse_page(&raw, "p1", false).unwrap().warning(), None);
        raw["data"]["unreadable_commit_ids"] = json!([id(5), id(5)]);
        let history = parse_page(&raw, "p1", false).unwrap();
        assert_eq!(history.warning(), Some(1));
        raw["data"]["unreadable_commit_ids"] = json!([]);
        raw["data"]["graph_health"] = json!("degraded");
        assert_eq!(parse_page(&raw, "p1", false).unwrap().warning(), Some(0));
    }

    #[test]
    fn pages_merge_within_one_snapshot_and_restart_otherwise() {
        let first = parse_page(
            &page(json!([commit(1, &[2]), commit(2, &[3])]), true, Some("n")),
            "p1",
            false,
        )
        .unwrap();
        let next = parse_page(
            &page(json!([commit(2, &[3]), commit(3, &[])]), false, None),
            "p1",
            true,
        )
        .unwrap();
        let merged = merge(&first, next.clone()).unwrap();
        assert_eq!(
            merged
                .commits
                .iter()
                .map(|c| c.id.clone())
                .collect::<Vec<_>>(),
            [id(1), id(2), id(3)]
        );
        assert!(!merged.more());
        assert_eq!(merged.refs, first.refs);
        // A different snapshot, changed ancestry, or a stalled page restarts.
        let mut other = next.clone();
        other.snapshot = "b".repeat(64);
        assert_eq!(merge(&first, other), Err(SnapshotChanged));
        let mut rewritten = next.clone();
        rewritten.commits[0].parents = vec![id(7)];
        assert_eq!(merge(&first, rewritten), Err(SnapshotChanged));
        let mut stalled = next;
        stalled.commits = vec![first.commits[1].clone()];
        stalled.has_more = true;
        stalled.next_cursor = Some("again".into());
        assert_eq!(merge(&first, stalled), Err(SnapshotChanged));
    }

    #[test]
    fn detail_reads_must_match_the_requested_commit() {
        let raw = json!({"data": {"commit_id": id(1), "parent_ids": [], "changes_loaded": true,
            "changes": [{"path": "a.md", "action": "add"}, {"path": "b.md", "op": "deleted"},
                        {"path": "c.md", "action": "update"}]}});
        let detail = parse_detail(&raw, &id(1)).unwrap();
        assert_eq!(
            detail.changes.iter().map(|c| c.kind).collect::<Vec<_>>(),
            [ChangeKind::Added, ChangeKind::Deleted, ChangeKind::Modified]
        );
        assert_eq!(parse_detail(&raw, &id(2)), Err(Invalid::Detail));
        let mut summary = raw.clone();
        summary["data"]["changes_loaded"] = json!(false);
        assert_eq!(parse_detail(&summary, &id(1)), Err(Invalid::Detail));
        let mut pathless = raw;
        pathless["data"]["changes"] = json!([{"path": ""}]);
        assert_eq!(parse_detail(&pathless, &id(1)), Err(Invalid::Change));
    }

    #[test]
    fn labels_mark_refs_and_the_head() {
        let history = parse_page(
            &page(json!([commit(1, &[2]), commit(2, &[])]), true, None),
            "p1",
            false,
        )
        .unwrap();
        let labels = labels(&history);
        assert_eq!(
            labels[&id(1)],
            [Label {
                name: "main".into(),
                kind: LabelKind::Cloud,
                current: true
            }]
        );
        assert_eq!(labels[&id(2)][0].kind, LabelKind::Tag);
        // `old` points outside the loaded pages.
        assert!(!labels.contains_key(&id(9)));
        // Without a current `main`, the head gets `HEAD`.
        let mut detached = history;
        detached.refs.retain(|r| r.kind == RefKind::Tag);
        assert_eq!(super::labels(&detached)[&id(1)][0].name, "HEAD");
    }

    #[test]
    fn the_cache_is_bounded_namespaced_and_serves_stale_snapshots() {
        let mut cache = Cache::new(2);
        let now = Instant::now();
        cache.activate("u1:1:api");
        cache.store("a".into(), 1, now);
        cache.store("b".into(), 2, now);
        assert_eq!(cache.read("a", now), Some((1, true)));
        cache.store("c".into(), 3, now);
        // `b` was least recently used.
        assert_eq!(cache.read("b", now), None);
        assert_eq!(cache.read("a", now + TTL), Some((1, false)));
        cache.discard("a");
        assert_eq!(cache.read("a", now), None);
        cache.activate("u1:2:api");
        assert_eq!(cache.len(), 0);
    }
}
