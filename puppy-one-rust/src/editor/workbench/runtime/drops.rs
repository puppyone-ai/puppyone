//! A drop is admitted through the same document runtime as an ordinary open.
//! Captured pane lifetimes reject completions for removed/recreated targets.
use super::*;
use crate::editor::workbench::layout::{Direction, Placement};

pub(super) struct Target {
    pub pane: String,
    pub lifetime: u64,
    pub direction: Direction,
    pub placement: Placement,
}

/// Observe pane creation/removal at the end of each controller action. A resize
/// or focus change preserves lifetimes; reusing a removed pane ID does not.
pub struct StateMut<'a>(pub(super) &'a mut Host);
impl Deref for StateMut<'_> {
    type Target = Workbench;
    fn deref(&self) -> &Workbench {
        &self.0.state
    }
}
impl DerefMut for StateMut<'_> {
    fn deref_mut(&mut self) -> &mut Workbench {
        &mut self.0.state
    }
}
impl Drop for StateMut<'_> {
    fn drop(&mut self) {
        self.0.sync_panes();
    }
}
impl Host {
    pub(super) fn sync_panes(&mut self) {
        let panes = self.state.layout.root.panes();
        self.pane_lifetimes
            .retain(|id, _| panes.iter().any(|(pane, _)| *pane == id));
        for (id, _) in panes {
            if !self.pane_lifetimes.contains_key(id) {
                self.pane_serial += 1;
                self.pane_lifetimes.insert(id.into(), self.pane_serial);
            }
        }
    }
}
impl Runtime {
    pub fn open_at_edge(
        &mut self,
        path: PathBuf,
        pane: &str,
        direction: Direction,
        placement: Placement,
        wake: &Wake,
    ) {
        if self.quitting || self.mutation_blocks(&path) {
            return;
        }
        let Some(owner) = self.active.clone() else {
            return;
        };
        let host = self.hosts.get_mut(&owner).unwrap();
        host.sync_panes();
        let Some(&lifetime) = host.pane_lifetimes.get(pane) else {
            return;
        };
        let Some(workspace) = &host.empty.workspace else {
            return;
        };
        let Ok(resource) = workspace.resource_id(&path) else {
            return;
        };
        if resource.path.is_root() {
            return;
        }
        let key = resource_key(&resource);
        let target = Target {
            pane: pane.into(),
            lifetime,
            direction,
            placement,
        };
        if host
            .slots
            .values()
            .any(|slot| slot.admitted && slot.key == key)
        {
            host.interact();
            host.state.open_at_edge(
                Input {
                    id: key,
                    label: path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                },
                pane,
                direction,
                placement,
            );
            host.sync_panes();
            self.generation += 1;
            wake.notify();
            return;
        }
        self.begin(Intent::OpenFile(path), wake);
        if let Some(slot) = self
            .hosts
            .get_mut(&owner)
            .unwrap()
            .slots
            .values_mut()
            .find(|slot| slot.key == key)
        {
            slot.drop_target = Some(target);
        }
    }
}
