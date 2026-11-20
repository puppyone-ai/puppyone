//! Format models that outlive their views (`DocumentModelOwner`).
//!
//! A working copy owns one [`DocumentModels`] per open document instance. The
//! view that edits the document attaches through a [`ModelHandle`] and, when
//! it is destroyed, leaves its model (text and undo history, or a table model)
//! behind for the next view of the same document. Only one view holds the
//! document at a time: a newer view ends the older one's [`ModelLease`], so a
//! late detach can never install an obsolete undo branch. Dropping the owner
//! (close, another document, a cleared host) retires every retained model.
use std::{
    any::Any,
    cell::RefCell,
    rc::{Rc, Weak},
};

/// The representation a model holds. A view of another representation
/// cannot continue its undo branch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelKind {
    /// An editor view's committed text and its history.
    Text,
    /// The CSV table model and its history.
    Table,
}

#[derive(Default)]
struct Slot {
    /// The attached view's lease; leases are never reused.
    lease: u64,
    issued: u64,
    detached: Option<(ModelKind, Box<dyn Any>)>,
}

/// The owner, held only by the document's working copy (or, while the
/// workbench has released a hidden document's live copy, by its record).
#[derive(Default)]
pub struct DocumentModels(Rc<RefCell<Slot>>);

impl std::fmt::Debug for DocumentModels {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let slot = self.0.borrow();
        f.debug_struct("DocumentModels")
            .field("attached", &(slot.lease != 0))
            .field("retained", &slot.detached.as_ref().map(|(kind, _)| *kind))
            .finish()
    }
}

impl DocumentModels {
    pub fn handle(&self) -> ModelHandle {
        ModelHandle(Rc::downgrade(&self.0))
    }

    /// Whether a view left a model behind (for tests and retention policy).
    pub fn retains(&self, kind: ModelKind) -> bool {
        self.0
            .borrow()
            .detached
            .as_ref()
            .is_some_and(|(k, _)| *k == kind)
    }
}

/// What the host gives the view it opens. It never keeps the models alive.
#[derive(Clone, Default)]
pub struct ModelHandle(Weak<RefCell<Slot>>);

impl PartialEq for ModelHandle {
    fn eq(&self, other: &Self) -> bool {
        self.0.ptr_eq(&other.0)
    }
}

impl std::fmt::Debug for ModelHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("ModelHandle")
            .field(&(self.0.strong_count() > 0))
            .finish()
    }
}

impl ModelHandle {
    /// A view of `kind` takes the document. Returns its lease and the
    /// retained model when one of the same kind `fits` what the view shows;
    /// any other retained model is discarded. `None` without a live owner.
    pub fn attach<T: 'static>(
        &self,
        kind: ModelKind,
        fits: impl FnOnce(&T) -> bool,
    ) -> Option<(ModelLease, Option<T>)> {
        let owner = self.0.upgrade()?;
        let mut slot = owner.borrow_mut();
        slot.issued += 1;
        slot.lease = slot.issued;
        let model = match slot.detached.take() {
            Some((k, model)) if k == kind => model.downcast::<T>().ok().map(|m| *m),
            _ => None,
        }
        .filter(|model| fits(model));
        Some((
            ModelLease {
                owner: self.0.clone(),
                lease: slot.lease,
                kind,
            },
            model,
        ))
    }
}

/// A view's claim on the document's model.
pub struct ModelLease {
    owner: Weak<RefCell<Slot>>,
    lease: u64,
    kind: ModelKind,
}

impl ModelLease {
    /// The view is going away: keep `model` for the document's next view,
    /// unless a newer view took the document or the owner retired.
    pub fn detach<T: 'static>(self, model: T) {
        let Some(owner) = self.owner.upgrade() else {
            return;
        };
        let mut slot = owner.borrow_mut();
        if slot.lease == self.lease {
            slot.lease = 0;
            slot.detached = Some((self.kind, Box::new(model)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_detached_model_reaches_the_next_view_of_the_same_kind_once() {
        let owner = DocumentModels::default();
        let handle = owner.handle();
        let (lease, none) = handle.attach::<String>(ModelKind::Text, |_| true).unwrap();
        assert!(none.is_none());
        lease.detach(String::from("history"));
        assert!(owner.retains(ModelKind::Text));
        let (_, kept) = handle.attach::<String>(ModelKind::Text, |_| true).unwrap();
        assert_eq!(kept.as_deref(), Some("history"));
        assert!(
            !owner.retains(ModelKind::Text),
            "a model is taken, not shared"
        );
    }

    #[test]
    fn mismatched_kinds_and_contents_discard_the_retained_model() {
        let owner = DocumentModels::default();
        let handle = owner.handle();
        let (lease, _) = handle.attach::<String>(ModelKind::Text, |_| true).unwrap();
        lease.detach(String::from("text"));
        let (lease, other) = handle.attach::<String>(ModelKind::Table, |_| true).unwrap();
        assert!(other.is_none());
        assert!(!owner.retains(ModelKind::Text));
        lease.detach(String::from("table"));
        let (_, stale) = handle
            .attach::<String>(ModelKind::Table, |model| model == "changed")
            .unwrap();
        assert!(stale.is_none());
        assert!(!owner.retains(ModelKind::Table));
    }

    #[test]
    fn a_superseded_view_cannot_install_its_history_late() {
        let owner = DocumentModels::default();
        let handle = owner.handle();
        let (old, _) = handle.attach::<String>(ModelKind::Text, |_| true).unwrap();
        let (new, _) = handle.attach::<String>(ModelKind::Text, |_| true).unwrap();
        old.detach(String::from("obsolete"));
        assert!(!owner.retains(ModelKind::Text));
        new.detach(String::from("current"));
        let (_, kept) = handle.attach::<String>(ModelKind::Text, |_| true).unwrap();
        assert_eq!(kept.as_deref(), Some("current"));
    }

    #[test]
    fn a_retired_owner_releases_models_and_refuses_later_views() {
        let owner = DocumentModels::default();
        let handle = owner.handle();
        let (lease, _) = handle.attach::<String>(ModelKind::Text, |_| true).unwrap();
        drop(owner);
        lease.detach(String::from("late"));
        assert!(handle.attach::<String>(ModelKind::Text, |_| true).is_none());
        assert!(
            ModelHandle::default()
                .attach::<String>(ModelKind::Text, |_| true)
                .is_none()
        );
    }
}
