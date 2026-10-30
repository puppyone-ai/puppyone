//! `graph/cloudTopology.ts` and `graph/shared.ts`: History rows with their
//! lanes, from the commits' ancestry (newest first). Pure; colours index
//! `CLOUD_GRAPH_COLORS`.
use super::history::{Commit, History, RefKind};
use std::collections::HashMap;

/// `CLOUD_GRAPH_COLORS.length`.
pub const COLORS: usize = 8;
/// `CLOUD_REF_MARKER_COLORS`, as palette indices.
const CLOUD_MARKER: usize = 5;
const TAG_MARKER: usize = 4;
/// `HISTORY_GRAPH_LANE_WIDTH`, `_LEFT_PAD`, `_RIGHT_PAD`.
pub const LANE_WIDTH: f32 = 12.;
pub const LEFT_PAD: f32 = 11.;
pub const RIGHT_PAD: f32 = 3.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    Top,
    Middle,
    Bottom,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Segment {
    pub from_lane: usize,
    pub to_lane: usize,
    pub color: usize,
    pub from: Anchor,
    pub to: Anchor,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
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
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefMarker {
    pub lane: usize,
    pub color: usize,
    pub label: String,
    pub kind: LabelKind,
    pub count: usize,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    /// The commit, or `ref:<commit>:<names>` for a head outside the page.
    pub id: String,
    pub commit: bool,
    pub labels: Vec<Label>,
    pub lane_count: usize,
    pub node_lane: usize,
    pub node_color: usize,
    pub segments: Vec<Segment>,
    pub ref_markers: Vec<RefMarker>,
}

/// `getHistoryGraphLaneX`.
pub fn lane_x(lane: usize) -> f32 {
    LEFT_PAD + lane as f32 * LANE_WIDTH
}
/// `getHistoryGraphWidth`.
pub fn width(rows: &[Row]) -> f32 {
    let lanes = rows
        .iter()
        .flat_map(|row| {
            [row.lane_count, row.node_lane + 1]
                .into_iter()
                .chain(row.ref_markers.iter().map(|m| m.lane + 1))
        })
        .max()
        .unwrap_or(1)
        .max(1);
    LEFT_PAD + lanes as f32 * LANE_WIDTH + RIGHT_PAD
}

/// `sortCloudBranchLabels`: the current one, then by kind and stable name.
fn sort_labels(labels: &mut [Label]) {
    let key = |name: &str| name.to_lowercase();
    labels.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then(a.kind.cmp(&b.kind))
            .then_with(|| key(&a.name).cmp(&key(&b.name)))
            .then_with(|| a.name.cmp(&b.name))
    });
}
/// `buildGroupedRefMarkers`.
fn grouped_markers(labels: &[Label], first: usize) -> Vec<RefMarker> {
    [
        (LabelKind::Cloud, CLOUD_MARKER),
        (LabelKind::Tag, TAG_MARKER),
    ]
    .into_iter()
    .filter_map(|(kind, color)| {
        let names: Vec<&str> = labels
            .iter()
            .filter(|l| l.kind == kind)
            .map(|l| l.name.as_str())
            .collect();
        (!names.is_empty()).then(|| (kind, color, names.join(", "), names.len()))
    })
    .enumerate()
    .map(|(index, (kind, color, label, count))| RefMarker {
        lane: first + index,
        color,
        label,
        kind,
        count,
    })
    .collect()
}
/// `isCloudGraphCommitId`.
fn graph_id(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn ref_name(name: &str) -> &str {
    name.strip_prefix("refs/heads/")
        .or_else(|| name.strip_prefix("refs/tags/"))
        .unwrap_or(name)
}

/// `buildCloudTopologyGraphRows`.
pub fn rows(history: &History) -> Vec<Row> {
    let known: HashMap<&str, &Commit> =
        history.commits.iter().map(|c| (c.id.as_str(), c)).collect();
    let mut labels_by_commit: HashMap<&str, Vec<Label>> = HashMap::new();
    let mut outside: Vec<(&str, Vec<Label>)> = vec![];
    for r in &history.refs {
        let label = Label {
            name: ref_name(&r.name).to_owned(),
            kind: if r.kind == RefKind::Tag {
                LabelKind::Tag
            } else {
                LabelKind::Cloud
            },
            current: r.name == "refs/heads/main"
                && history.head.as_deref() == Some(r.commit.as_str()),
        };
        if known.contains_key(r.commit.as_str()) {
            labels_by_commit.entry(&r.commit).or_default().push(label);
        } else if let Some((_, labels)) = outside.iter_mut().find(|(c, _)| *c == r.commit) {
            labels.push(label);
        } else {
            outside.push((&r.commit, vec![label]));
        }
    }
    if let Some(head) = history.head.as_deref().filter(|h| known.contains_key(h)) {
        let labels = labels_by_commit.entry(head).or_default();
        if !labels.iter().any(|l| l.current) {
            labels.push(Label {
                name: "HEAD".into(),
                kind: LabelKind::Cloud,
                current: true,
            });
        }
    }
    let mut lanes: Vec<(String, usize)> = vec![];
    let mut next = 0;
    let mut color = move || {
        let c = next % COLORS;
        next += 1;
        c
    };
    let mut out: Vec<Row> = history
        .commits
        .iter()
        .map(|commit| {
            let mut labels = labels_by_commit
                .remove(commit.id.as_str())
                .unwrap_or_default();
            sort_labels(&mut labels);
            let incoming_at = lanes.iter().position(|(id, _)| *id == commit.id);
            let had_incoming = incoming_at.is_some();
            let node_lane = incoming_at.unwrap_or_else(|| {
                lanes.push((commit.id.clone(), color()));
                lanes.len() - 1
            });
            let incoming = lanes.clone();
            let node_color = incoming[node_lane].1;
            let mut parents: Vec<&str> = vec![];
            for parent in &commit.parents {
                if graph_id(parent) && !parents.contains(&parent.as_str()) {
                    parents.push(parent);
                }
            }
            let mut outgoing: Vec<(String, usize)> = incoming
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != node_lane)
                .map(|(_, l)| l.clone())
                .collect();
            for (index, parent) in parents.iter().enumerate() {
                if let Some(existing) = outgoing.iter().position(|(id, _)| id == parent) {
                    if index == 0 {
                        outgoing[existing].1 = node_color;
                    }
                    continue;
                }
                let lane = (node_lane + index).min(outgoing.len());
                let c = if index == 0 { node_color } else { color() };
                outgoing.insert(lane, ((*parent).to_owned(), c));
            }
            let at = |id: &str| outgoing.iter().position(|(c, _)| c == id);
            let mut segments = vec![];
            for (lane, (id, c)) in incoming.iter().enumerate() {
                if lane == node_lane {
                    continue;
                }
                if let Some(to) = at(id) {
                    segments.push(Segment {
                        from_lane: lane,
                        to_lane: to,
                        color: *c,
                        from: Anchor::Top,
                        to: Anchor::Bottom,
                    });
                }
            }
            if had_incoming {
                segments.push(Segment {
                    from_lane: node_lane,
                    to_lane: node_lane,
                    color: node_color,
                    from: Anchor::Top,
                    to: Anchor::Middle,
                });
            }
            for parent in &parents {
                if let Some(to) = at(parent) {
                    segments.push(Segment {
                        from_lane: node_lane,
                        to_lane: to,
                        color: outgoing[to].1,
                        from: Anchor::Middle,
                        to: Anchor::Bottom,
                    });
                }
            }
            let graph_lanes = incoming.len().max(outgoing.len()).max(node_lane + 1).max(1);
            let unmarked: Vec<Label> = labels.iter().filter(|l| !l.current).cloned().collect();
            let ref_markers = grouped_markers(&unmarked, graph_lanes.max(node_lane + 1));
            segments.extend(ref_markers.iter().map(|m| Segment {
                from_lane: node_lane,
                to_lane: m.lane,
                color: m.color,
                from: Anchor::Middle,
                to: Anchor::Middle,
            }));
            lanes = outgoing;
            Row {
                id: commit.id.clone(),
                commit: true,
                labels,
                lane_count: ref_markers
                    .iter()
                    .map(|m| m.lane + 1)
                    .max()
                    .unwrap_or(0)
                    .max(graph_lanes),
                node_lane,
                node_color,
                segments,
                ref_markers,
            }
        })
        .collect();
    // `buildRefOnlyGraphRows`: heads outside the loaded page; none has a
    // known time, so they keep a stable name order.
    let mut groups: Vec<(&str, Vec<Label>)> = outside;
    for (_, labels) in &mut groups {
        sort_labels(labels);
    }
    groups.sort_by(|a, b| a.1[0].name.to_lowercase().cmp(&b.1[0].name.to_lowercase()));
    for (commit, labels) in groups {
        let ref_markers = grouped_markers(&labels, 0);
        let names: Vec<&str> = labels.iter().map(|l| l.name.as_str()).collect();
        out.push(Row {
            id: format!("ref:{commit}:{}", names.join("|")),
            commit: false,
            lane_count: ref_markers.iter().map(|m| m.lane + 1).max().unwrap_or(1),
            node_lane: 0,
            node_color: ref_markers.first().map_or(2, |m| m.color),
            segments: vec![],
            ref_markers,
            labels,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::cloud::history::Ref;
    use core::prelude::v1::test;

    fn id(c: char) -> String {
        c.to_string().repeat(40)
    }
    fn commit(c: char, parents: &[char]) -> Commit {
        Commit {
            id: id(c),
            parents: parents.iter().map(|p| id(*p)).collect(),
            who: String::new(),
            message: String::new(),
            changes: vec![],
            changes_loaded: true,
            created_at: None,
        }
    }
    fn history(commits: Vec<Commit>, refs: Vec<Ref>, head: Option<char>) -> History {
        History {
            project: "p".into(),
            commits,
            head: head.map(id),
            refs,
            refs_included: true,
            snapshot: "s".into(),
            next_cursor: None,
            has_more: false,
            total: 0,
            degraded: false,
            unreadable: vec![],
        }
    }

    #[test]
    fn a_linear_history_stays_on_one_lane() {
        let rows = rows(&history(
            vec![commit('a', &['b']), commit('b', &['c']), commit('c', &[])],
            vec![],
            Some('a'),
        ));
        assert!(rows.iter().all(|r| r.node_lane == 0 && r.lane_count == 1));
        // The tip has no line above it; the root none below.
        assert_eq!(rows[0].segments.len(), 1);
        assert_eq!(rows[0].segments[0].from, Anchor::Middle);
        assert_eq!(rows[1].segments.len(), 2);
        assert_eq!(rows[2].segments.len(), 1);
        assert_eq!(rows[2].segments[0].to, Anchor::Middle);
        // The Head label is current, so it takes no marker lane.
        assert_eq!(rows[0].labels[0].name, "HEAD");
        assert!(rows[0].ref_markers.is_empty());
    }

    #[test]
    fn a_merge_opens_a_lane_and_closes_it_at_the_common_parent() {
        let rows = rows(&history(
            vec![
                commit('d', &['b', 'c']),
                commit('b', &['a']),
                commit('c', &['a']),
                commit('a', &[]),
            ],
            vec![],
            None,
        ));
        assert_eq!(rows[0].node_lane, 0);
        assert_eq!(rows[0].lane_count, 2);
        // Two lines leave the merge: its first parent keeps the colour.
        let down: Vec<_> = rows[0]
            .segments
            .iter()
            .filter(|s| s.from == Anchor::Middle)
            .collect();
        assert_eq!(down.len(), 2);
        assert_eq!(down[0].color, rows[0].node_color);
        assert_ne!(down[1].color, rows[0].node_color);
        assert_eq!((down[1].from_lane, down[1].to_lane), (0, 1));
        assert_eq!(rows[2].node_lane, 1);
        // Both sides meet at the root: one lane again.
        assert_eq!(rows[3].node_lane, 0);
        assert_eq!(rows[3].lane_count, 1);
    }

    #[test]
    fn duplicate_or_foreign_parents_draw_nothing_extra() {
        let mut c = commit('a', &['b', 'b']);
        c.parents.push("not-a-commit".into());
        let rows = rows(&history(vec![c, commit('b', &[])], vec![], None));
        assert_eq!(rows[0].lane_count, 1);
        assert_eq!(rows[0].segments.len(), 1);
    }

    #[test]
    fn refs_become_markers_beside_the_graph_and_outside_heads_get_their_own_rows() {
        let reference = |name: &str, kind, commit: char| Ref {
            name: name.into(),
            kind,
            commit: id(commit),
        };
        let rows = rows(&history(
            vec![commit('a', &[])],
            vec![
                reference("refs/heads/main", RefKind::Branch, 'a'),
                reference("refs/heads/draft", RefKind::Branch, 'a'),
                reference("refs/tags/v1", RefKind::Tag, 'a'),
                reference("refs/heads/old", RefKind::Branch, 'f'),
            ],
            Some('a'),
        ));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].labels[0].name, "main");
        assert!(rows[0].labels[0].current);
        assert_eq!(rows[0].ref_markers.len(), 2);
        assert_eq!(rows[0].ref_markers[0].label, "draft");
        assert_eq!(rows[0].ref_markers[0].lane, 1);
        assert_eq!(rows[0].ref_markers[1].lane, 2);
        assert_eq!(rows[0].lane_count, 3);
        assert!(!rows[1].commit);
        assert!(rows[1].id.starts_with("ref:"));
        assert_eq!(width(&rows), LEFT_PAD + 3. * LANE_WIDTH + RIGHT_PAD);
        assert_eq!(lane_x(1), 23.);
    }
}
