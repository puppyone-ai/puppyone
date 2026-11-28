//! Project-scoped preparation admission, before a contribution allocates resources.
use super::*;
use std::rc::Weak;

/// A preparation owns one contribution kind and one launcher until it settles.
/// Dropping an abandoned future releases admission without leaving a live lock.
pub struct CreationPermit {
    root: PathBuf,
    tab: Id,
    kind: ItemKind,
    identity: Rc<()>,
}
struct Pending {
    kind: ItemKind,
    identity: Weak<()>,
}
#[derive(Default)]
pub(super) struct Preparations(HashMap<Id, Pending>);
impl Preparations {
    pub(super) fn has_kind(&self, kind: ItemKind) -> bool {
        self.0
            .values()
            .any(|p| p.kind == kind && p.identity.strong_count() > 0)
    }
    pub(super) fn has_tab(&self, tab: Id) -> bool {
        self.0
            .get(&tab)
            .is_some_and(|p| p.identity.strong_count() > 0)
    }
    pub(super) fn remove(&mut self, tab: Id) {
        self.0.remove(&tab);
    }
    fn owns(&self, permit: &CreationPermit) -> bool {
        self.0.get(&permit.tab).is_some_and(|p| {
            p.kind == permit.kind && p.identity.ptr_eq(&Rc::downgrade(&permit.identity))
        })
    }
}
impl Workbench {
    /// Whether a click can still replace this launcher before allocating a runtime.
    pub fn launcher_available(&self, root: &std::path::Path, tab: Id) -> bool {
        self.is_launcher(root, tab) && self.project().is_some_and(|p| !p.preparing.has_tab(tab))
    }
    pub fn reserve_creation(
        &mut self,
        kind: ItemKind,
        tab: Id,
        cx: &mut Context<Self>,
    ) -> Option<CreationPermit> {
        let root = self.root.clone()?;
        if !self.can_create(kind) || !self.launcher_available(&root, tab) {
            return None;
        }
        let identity = Rc::new(());
        let p = self.project_mut()?;
        // Explicit user preparation supersedes pending saved-state restoration.
        p.loading = false;
        p.preparing.0.retain(|_, p| p.identity.strong_count() > 0);
        p.preparing.0.insert(
            tab,
            Pending {
                kind,
                identity: Rc::downgrade(&identity),
            },
        );
        self.clear_creation_failure(cx);
        cx.notify();
        Some(CreationPermit {
            root,
            tab,
            kind,
            identity,
        })
    }
    /// Recheck after the asynchronous preparation, before transferring ownership.
    pub fn creation_is_current(&self, permit: &CreationPermit) -> bool {
        self.is_launcher(&permit.root, permit.tab)
            && self.project().is_some_and(|p| {
                p.preparing.owns(permit)
                    && p.content
                        .values()
                        .filter(|c| c.kind() == Some(permit.kind))
                        .count()
                        < permit.kind.maximum_items()
            })
    }
    /// A failed or stale preparation releases only its own reservation.
    pub fn cancel_creation(&mut self, permit: CreationPermit, cx: &mut Context<Self>) {
        if let Some(p) = self.projects.get_mut(&permit.root)
            && p.preparing.owns(&permit)
        {
            p.preparing.remove(permit.tab);
            cx.notify();
        }
    }
    /// Follow the launcher's current group and preserve the user's selection.
    pub fn commit_creation(
        &mut self,
        permit: CreationPermit,
        item: Rc<dyn WorkbenchItem>,
        cx: &mut Context<Self>,
    ) -> Option<Id> {
        let valid = item.kind() == permit.kind && self.creation_is_current(&permit);
        let group = self.group_of(permit.tab);
        let tab = permit.tab;
        self.cancel_creation(permit, cx);
        if !valid {
            return None;
        }
        self.place(group?, Some(tab), item, cx)
    }
}

#[cfg(test)]
mod tests;
