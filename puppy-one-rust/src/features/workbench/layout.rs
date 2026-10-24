use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
pub type Id = u64;
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Axis {
    Horizontal,
    Vertical,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Node {
    Group(Id),
    Split {
        id: Id,
        axis: Axis,
        ratio: f32,
        first: Box<Node>,
        second: Box<Node>,
    },
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Group {
    pub tabs: Vec<Id>,
    pub active: Option<Id>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Layout {
    pub tree: Node,
    pub groups: BTreeMap<Id, Group>,
    pub active_group: Id,
    next: Id,
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            tree: Node::Group(0),
            groups: BTreeMap::from([(0, Group::default())]),
            active_group: 0,
            next: 1,
        }
    }
}
impl Layout {
    pub fn valid(&self) -> bool {
        fn visit(
            node: &Node,
            depth: usize,
            nodes: &mut std::collections::HashSet<Id>,
            groups: &mut std::collections::HashSet<Id>,
        ) -> bool {
            if depth > 8 {
                return false;
            }
            match node {
                Node::Group(id) => nodes.insert(*id) && groups.insert(*id),
                Node::Split {
                    id,
                    ratio,
                    first,
                    second,
                    ..
                } => {
                    ratio.is_finite()
                        && (0.1..=0.9).contains(ratio)
                        && nodes.insert(*id)
                        && visit(first, depth + 1, nodes, groups)
                        && visit(second, depth + 1, nodes, groups)
                }
            }
        }
        let mut nodes = std::collections::HashSet::new();
        let mut groups = std::collections::HashSet::new();
        if self.groups.is_empty()
            || self.groups.len() > 16
            || !visit(&self.tree, 0, &mut nodes, &mut groups)
            || groups.len() != self.groups.len()
            || !self.groups.contains_key(&self.active_group)
        {
            return false;
        }
        for (id, g) in &self.groups {
            if !groups.contains(id) || g.active.is_some_and(|id| !g.tabs.contains(&id)) {
                return false;
            }
            for tab in &g.tabs {
                if !nodes.insert(*tab) {
                    return false;
                }
            }
        }
        nodes.len() <= 95 && nodes.iter().all(|id| *id < self.next)
    }

    pub fn remove_empty_group(&mut self, id: Id) -> bool {
        if self.groups.len() == 1 || self.groups.get(&id).is_none_or(|g| !g.tabs.is_empty()) {
            return false;
        }
        fn remove(node: Node, id: Id) -> Option<Node> {
            match node {
                Node::Group(group) => (group != id).then_some(Node::Group(group)),
                Node::Split {
                    id: split,
                    axis,
                    ratio,
                    first,
                    second,
                } => match (remove(*first, id), remove(*second, id)) {
                    (Some(a), Some(b)) => Some(Node::Split {
                        id: split,
                        axis,
                        ratio,
                        first: Box::new(a),
                        second: Box::new(b),
                    }),
                    (a, b) => a.or(b),
                },
            }
        }
        self.tree = remove(self.tree.clone(), id).unwrap();
        self.groups.remove(&id);
        if self.active_group == id {
            self.active_group = *self.groups.keys().next().unwrap();
        }
        true
    }
    pub fn navigate(&mut self, group: Id, key: &str) {
        let Some(g) = self.groups.get_mut(&group) else {
            return;
        };
        if g.tabs.is_empty() {
            return;
        }
        let current = g
            .active
            .and_then(|id| g.tabs.iter().position(|t| *t == id))
            .unwrap_or(0);
        let index = match key {
            "left" => (current + g.tabs.len() - 1) % g.tabs.len(),
            "right" => (current + 1) % g.tabs.len(),
            "home" => 0,
            "end" => g.tabs.len() - 1,
            _ => return,
        };
        g.active = Some(g.tabs[index]);
        self.active_group = group;
    }
    fn id(&mut self) -> Id {
        let id = self.next;
        self.next += 1;
        id
    }
    pub fn add(&mut self, group: Id) -> Id {
        let id = self.id();
        let group = self.groups.get_mut(&group).unwrap();
        group.tabs.push(id);
        group.active = Some(id);
        id
    }
    pub fn activate(&mut self, group: Id, tab: Id) {
        if let Some(g) = self.groups.get_mut(&group)
            && g.tabs.contains(&tab)
        {
            g.active = Some(tab);
            self.active_group = group;
        }
    }
    pub fn remove(&mut self, tab: Id) {
        for g in self.groups.values_mut() {
            if let Some(index) = g.tabs.iter().position(|id| *id == tab) {
                g.tabs.remove(index);
                if g.active == Some(tab) {
                    g.active = g
                        .tabs
                        .get(index.min(g.tabs.len().saturating_sub(1)))
                        .copied();
                }
                break;
            }
        }
    }
    pub fn move_tab(&mut self, tab: Id, target: Id, index: usize) {
        if !self.groups.contains_key(&target)
            || !self.groups.values().any(|g| g.tabs.contains(&tab))
        {
            return;
        }
        self.remove(tab);
        let g = self.groups.get_mut(&target).unwrap();
        g.tabs.insert(index.min(g.tabs.len()), tab);
        g.active = Some(tab);
        self.active_group = target;
    }
    pub fn split(&mut self, target: Id, axis: Axis, after: bool, tab: Option<Id>) -> Id {
        let group = self.id();
        let split = self.id();
        self.groups.insert(group, Group::default());
        fn replace(node: &mut Node, target: Id, group: Id, split: Id, axis: Axis, after: bool) {
            match node {
                Node::Group(id) if *id == target => {
                    let (a, b) = if after {
                        (target, group)
                    } else {
                        (group, target)
                    };
                    *node = Node::Split {
                        id: split,
                        axis,
                        ratio: 0.5,
                        first: Box::new(Node::Group(a)),
                        second: Box::new(Node::Group(b)),
                    };
                }
                Node::Split { first, second, .. } => {
                    replace(first, target, group, split, axis, after);
                    replace(second, target, group, split, axis, after);
                }
                _ => {}
            }
        }
        replace(&mut self.tree, target, group, split, axis, after);
        self.active_group = group;
        if let Some(tab) = tab {
            self.move_tab(tab, group, 0);
        }
        group
    }
    /// `workbenchSplitNodeMinimumSize`: a split adds its children along its
    /// axis (plus the 1px divider) and takes the larger across it.
    pub fn min_size(node: &Node, leaf: &impl Fn(Id) -> (f32, f32)) -> (f32, f32) {
        match node {
            Node::Group(id) => leaf(*id),
            Node::Split {
                axis,
                first,
                second,
                ..
            } => {
                let (a, b) = (Self::min_size(first, leaf), Self::min_size(second, leaf));
                match axis {
                    Axis::Horizontal => (a.0 + DIVIDER + b.0, a.1.max(b.1)),
                    Axis::Vertical => (a.0.max(b.0), a.1 + DIVIDER + b.1),
                }
            }
        }
    }
    /// `splitRatioBounds`: the first child's share that keeps both sides at
    /// their minimum, given the split's size along its axis.
    pub fn ratio_bounds(
        axis: Axis,
        total: f32,
        first: (f32, f32),
        second: (f32, f32),
    ) -> (f32, f32) {
        let available = (total - DIVIDER).max(1.);
        let (a, b) = match axis {
            Axis::Horizontal => (first.0, second.0),
            Axis::Vertical => (first.1, second.1),
        };
        let minimum = (a / available).clamp(0., 1.);
        let maximum = (1. - b / available).clamp(0., 1.);
        if minimum > maximum {
            (0.5, 0.5)
        } else {
            (minimum, maximum)
        }
    }
    pub fn find(&self, id: Id) -> Option<&Node> {
        fn find(node: &Node, id: Id) -> Option<&Node> {
            match node {
                Node::Split {
                    id: own,
                    first,
                    second,
                    ..
                } => {
                    if *own == id {
                        Some(node)
                    } else {
                        find(first, id).or_else(|| find(second, id))
                    }
                }
                Node::Group(_) => None,
            }
        }
        find(&self.tree, id)
    }
    pub fn resize(&mut self, id: Id, value: f32) {
        fn resize(node: &mut Node, id: Id, value: f32) {
            if let Node::Split {
                id: own,
                ratio,
                first,
                second,
                ..
            } = node
            {
                if *own == id {
                    *ratio = (value.clamp(0., 1.) * 1_000.).round() / 1_000.;
                } else {
                    resize(first, id, value);
                    resize(second, id, value);
                }
            }
        }
        resize(&mut self.tree, id, value);
    }
}
/// `WORKBENCH_SPLIT_DIVIDER_SIZE`.
pub const DIVIDER: f32 = 1.;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_bounds_keep_both_sides_at_their_minimum() {
        let mut l = Layout::default();
        let a = l.add(0);
        l.add(0);
        let group = l.split(0, Axis::Horizontal, true, Some(a));
        let leaf = |_: Id| (280., 260.);
        assert_eq!(Layout::min_size(&l.tree, &leaf), (561., 260.));
        let (min, max) = Layout::ratio_bounds(Axis::Horizontal, 701., (280., 260.), (280., 260.));
        assert!((min - 0.4).abs() < 1e-6 && (max - 0.6).abs() < 1e-6);
        assert!(l.groups.contains_key(&group));
    }
    #[test]
    fn launchers_are_independent_and_last_close_is_empty() {
        let mut l = Layout::default();
        let a = l.add(0);
        let b = l.add(0);
        assert_ne!(a, b);
        l.remove(b);
        assert_eq!(l.groups[&0].active, Some(a));
        l.remove(a);
        assert!(l.groups[&0].tabs.is_empty());
        assert_eq!(l.groups[&0].active, None);
    }
    #[test]
    fn move_split_preserves_identity_and_order() {
        let mut l = Layout::default();
        let a = l.add(0);
        let b = l.add(0);
        let c = l.add(0);
        l.move_tab(a, 0, 2);
        assert_eq!(l.groups[&0].tabs, vec![b, c, a]);
        let group = l.split(0, Axis::Vertical, true, Some(c));
        assert_eq!(l.groups[&group].tabs, vec![c]);
        assert_eq!(l.groups[&0].tabs, vec![b, a]);
        l.move_tab(c, 0, 1);
        assert_eq!(l.groups[&0].tabs, vec![b, c, a]);
    }
}
