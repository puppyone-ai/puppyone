//! Provider-independent pane tree. Mirrors editorPaneLayoutModel/splitTreeModel;
//! leaf lifetime is not document lifetime. No content, storage or UI ownership.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Horizontal,
    Vertical,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    First,
    Second,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Node {
    Pane {
        id: String,
        #[serde(rename = "editorId")]
        editor: Option<String>,
    },
    Split {
        id: String,
        direction: Direction,
        ratio: f64,
        first: Box<Node>,
        second: Box<Node>,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    pub root: Node,
    #[serde(rename = "activePaneId")]
    pub active: String,
}
/// Normalized nearest-edge drop geometry, with TS's stable left/right/top/bottom tie order.
pub fn drop_edge(x: f32, y: f32, width: f32, height: f32) -> (Direction, Placement) {
    let distances = [
        x.abs() / width.max(1.),
        (width - x).abs() / width.max(1.),
        y.abs() / height.max(1.),
        (height - y).abs() / height.max(1.),
    ];
    let mut edge = 0;
    for i in 1..4 {
        if distances[i] < distances[edge] {
            edge = i;
        }
    }
    match edge {
        0 => (Direction::Horizontal, Placement::First),
        1 => (Direction::Horizontal, Placement::Second),
        2 => (Direction::Vertical, Placement::First),
        _ => (Direction::Vertical, Placement::Second),
    }
}
pub fn clamp_ratio(ratio: f64) -> f64 {
    if ratio.is_finite() {
        ((ratio * 1000.).round() / 1000.).clamp(0.15, 0.85)
    } else {
        0.5
    }
}
impl Default for Layout {
    fn default() -> Self {
        Self::new(None)
    }
}
impl Node {
    pub fn id(&self) -> &str {
        match self {
            Self::Pane { id, .. } | Self::Split { id, .. } => id,
        }
    }
    pub fn panes(&self) -> Vec<(&str, Option<&str>)> {
        match self {
            Self::Pane { id, editor } => vec![(id, editor.as_deref())],
            Self::Split { first, second, .. } => [first.panes(), second.panes()].concat(),
        }
    }
    fn find(&self, id: &str) -> Option<&Self> {
        if self.id() == id {
            return Some(self);
        }
        match self {
            Self::Split { first, second, .. } => first.find(id).or_else(|| second.find(id)),
            _ => None,
        }
    }
    fn replace(&mut self, id: &str, replacement: &Self) {
        if self.id() == id {
            *self = replacement.clone();
        } else if let Self::Split { first, second, .. } = self {
            first.replace(id, replacement);
            second.replace(id, replacement);
        }
    }
    fn map_editors(&mut self, f: &mut impl FnMut(&mut Option<String>)) {
        match self {
            Self::Pane { editor, .. } => f(editor),
            Self::Split { first, second, .. } => {
                first.map_editors(f);
                second.map_editors(f);
            }
        }
    }
    fn extract(self, id: &str) -> Option<Self> {
        match self {
            Self::Pane { id: ref own, .. } if own == id => None,
            Self::Split {
                id: own,
                direction,
                ratio,
                first,
                second,
            } => match (first.extract(id), second.extract(id)) {
                (Some(first), Some(second)) => Some(Self::Split {
                    id: own,
                    direction,
                    ratio,
                    first: Box::new(first),
                    second: Box::new(second),
                }),
                (one, other) => one.or(other),
            },
            other => Some(other),
        }
    }
    fn next_id(&self, prefix: &str) -> String {
        fn max(node: &Node, prefix: &str) -> u64 {
            let own = node
                .id()
                .strip_prefix(prefix)
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0);
            match node {
                Node::Split { first, second, .. } => {
                    own.max(max(first, prefix)).max(max(second, prefix))
                }
                _ => own,
            }
        }
        let mut next = max(self, prefix).checked_add(1).unwrap_or(1);
        loop {
            let id = format!("{prefix}{next}");
            if self.find(&id).is_none() {
                return id;
            }
            next = next.checked_add(1).unwrap_or(1);
        }
    }
    fn move_siblings(
        &mut self,
        source: &str,
        target: &str,
        direction: Direction,
        placement: Placement,
    ) -> bool {
        if let Self::Split {
            first,
            second,
            direction: old_direction,
            ratio,
            ..
        } = self
        {
            if matches!(**first, Self::Pane { .. })
                && matches!(**second, Self::Pane { .. })
                && ((first.id() == source && second.id() == target)
                    || (first.id() == target && second.id() == source))
            {
                if (first.id() == source) != (placement == Placement::First) {
                    std::mem::swap(first, second);
                }
                if *old_direction != direction {
                    *ratio = 0.5;
                }
                *old_direction = direction;
                return true;
            }
            return first.move_siblings(source, target, direction, placement)
                || second.move_siblings(source, target, direction, placement);
        }
        false
    }
}
impl Layout {
    pub fn rebind_editor(&mut self, from: &str, to: &str) {
        self.root.map_editors(&mut |editor| {
            if editor.as_deref() == Some(from) {
                *editor = Some(to.into());
            }
        });
    }
    pub fn new(editor: Option<String>) -> Self {
        Self {
            root: Node::Pane {
                id: "editor-pane-1".into(),
                editor,
            },
            active: "editor-pane-1".into(),
        }
    }
    pub fn active_editor(&self) -> Option<&str> {
        self.root
            .panes()
            .into_iter()
            .find(|(id, _)| *id == self.active)
            .and_then(|(_, editor)| editor)
    }
    pub fn focus(&mut self, pane: &str) {
        if matches!(self.root.find(pane), Some(Node::Pane { .. })) {
            self.active = pane.into();
        }
    }
    pub fn assign(&mut self, pane: &str, editor: Option<String>) {
        if matches!(self.root.find(pane), Some(Node::Pane { .. })) {
            self.root.replace(
                pane,
                &Node::Pane {
                    id: pane.into(),
                    editor,
                },
            );
            self.active = pane.into();
        }
    }
    pub fn split(
        &mut self,
        pane: &str,
        direction: Direction,
        placement: Placement,
        editor: Option<String>,
    ) {
        let Some(source @ Node::Pane { .. }) = self.root.find(pane).cloned() else {
            return;
        };
        let id = self.root.next_id("editor-pane-");
        let next = Node::Pane {
            id: id.clone(),
            editor,
        };
        let (first, second) = if placement == Placement::First {
            (next, source)
        } else {
            (source, next)
        };
        let split = Node::Split {
            id: self.root.next_id("editor-split-"),
            direction,
            ratio: 0.5,
            first: Box::new(first),
            second: Box::new(second),
        };
        self.root.replace(pane, &split);
        self.active = id;
    }
    pub fn close(&mut self, pane: &str) {
        if !matches!(self.root.find(pane), Some(Node::Pane { .. })) {
            return;
        }
        self.root = self
            .root
            .clone()
            .extract(pane)
            .unwrap_or_else(|| Node::Pane {
                id: pane.into(),
                editor: None,
            });
        if self.root.find(&self.active).is_none() {
            self.active = self.root.panes()[0].0.into();
        }
    }
    pub fn move_pane(
        &mut self,
        source: &str,
        target: &str,
        direction: Direction,
        placement: Placement,
    ) {
        if source == target || !matches!(self.root.find(target), Some(Node::Pane { .. })) {
            return;
        }
        let Some(leaf @ Node::Pane { .. }) = self.root.find(source).cloned() else {
            return;
        };
        if !self
            .root
            .move_siblings(source, target, direction, placement)
        {
            let split_id = self.root.next_id("editor-split-");
            let Some(mut root) = self.root.clone().extract(source) else {
                return;
            };
            let target_leaf = root.find(target).unwrap().clone();
            let (first, second) = if placement == Placement::First {
                (leaf, target_leaf)
            } else {
                (target_leaf, leaf)
            };
            root.replace(
                target,
                &Node::Split {
                    id: split_id,
                    direction,
                    ratio: 0.5,
                    first: Box::new(first),
                    second: Box::new(second),
                },
            );
            self.root = root;
        }
        self.active = source.into();
    }
    pub fn resize(&mut self, split: &str, ratio: f64) {
        if let Some(mut node @ Node::Split { .. }) = self.root.find(split).cloned() {
            if let Node::Split { ratio: value, .. } = &mut node {
                *value = clamp_ratio(ratio);
            }
            self.root.replace(split, &node);
        }
    }
    pub fn remove_editor(&mut self, id: &str, fallback: Option<&str>) {
        self.root.map_editors(&mut |editor| {
            if editor.as_deref() == Some(id) {
                *editor = fallback.map(str::to_owned);
            }
        });
        // A fallback already visible elsewhere is focused, never cloned into
        // another live editor (the accepted unique-visible-resource contract).
        self.collapse_duplicates();
    }
    pub fn collapse_duplicates(&mut self) {
        let panes: Vec<_> = self
            .root
            .panes()
            .into_iter()
            .map(|(id, editor)| (id.to_owned(), editor.map(str::to_owned)))
            .collect();
        let mut ordered = panes.clone();
        ordered.sort_by_key(|(id, _)| id != &self.active);
        let mut seen = std::collections::HashSet::new();
        for (id, editor) in ordered {
            if let Some(editor) = editor
                && !seen.insert(editor)
            {
                self.close(&id);
            }
        }
    }
    /// Persisted nodes are metadata, not grants. Resource admission is separate.
    pub fn parse(
        value: &serde_json::Value,
        valid: &std::collections::HashSet<String>,
        fallback: Option<String>,
    ) -> Self {
        fn parse_node(
            value: &serde_json::Value,
            valid: &std::collections::HashSet<String>,
            seen: &mut std::collections::HashSet<String>,
            depth: usize,
        ) -> Option<Node> {
            if depth > 12 {
                return None;
            }
            let id = value.get("id")?.as_str()?.to_owned();
            if id.is_empty() || !seen.insert(id.clone()) {
                return None;
            }
            match value.get("kind")?.as_str()? {
                "pane" => Some(Node::Pane {
                    id,
                    editor: value
                        .get("editorId")
                        .and_then(|v| v.as_str())
                        .filter(|v| valid.contains(*v))
                        .map(str::to_owned),
                }),
                "split" => Some(Node::Split {
                    id,
                    direction: serde_json::from_value(value.get("direction")?.clone()).ok()?,
                    ratio: clamp_ratio(value.get("ratio").and_then(|v| v.as_f64()).unwrap_or(0.5)),
                    first: Box::new(parse_node(value.get("first")?, valid, seen, depth + 1)?),
                    second: Box::new(parse_node(value.get("second")?, valid, seen, depth + 1)?),
                }),
                _ => None,
            }
        }
        let Some(root) = value
            .get("root")
            .and_then(|v| parse_node(v, valid, &mut Default::default(), 0))
        else {
            return Self::new(fallback);
        };
        let panes = root.panes();
        let active = value
            .get("activePaneId")
            .and_then(|v| v.as_str())
            .filter(|id| panes.iter().any(|(pane, _)| pane == id))
            .unwrap_or(panes[0].0)
            .to_owned();
        let mut layout = Self { root, active };
        layout.collapse_duplicates();
        layout
    }
}
