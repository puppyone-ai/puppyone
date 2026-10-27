//! Ordered open-document references and MRU, independent of the pane tree.
//! IDs are stable resource keys; neither these metadata nor a pane grants I/O.
use super::layout::{Direction, Layout, Placement};
use crate::workspace::contracts::ResourceId;

pub fn resource_key(resource: &ResourceId) -> String {
    let mut key = resource.storage.as_str().to_owned();
    for (index, component) in resource.path.as_path().components().enumerate() {
        if index > 0 {
            key.push('/');
        }
        for &byte in component.as_os_str().as_encoded_bytes() {
            if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
                key.push(byte as char);
            } else {
                use std::fmt::Write;
                let _ = write!(key, "%{byte:02X}");
            }
        }
    }
    key
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input {
    pub id: String,
    pub label: String,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Catalog {
    pub editors: Vec<Input>,
    pub active: Option<String>,
    pub mru: Vec<String>,
}
impl Catalog {
    pub fn open(&mut self, input: Input) {
        let id = input.id.clone();
        if let Some(existing) = self.editors.iter_mut().find(|e| e.id == id) {
            *existing = input;
        } else {
            let index = self
                .editors
                .iter()
                .position(|e| Some(&e.id) == self.active.as_ref())
                .map_or(self.editors.len(), |i| i + 1);
            self.editors.insert(index, input);
        }
        self.activate(&id);
    }
    pub fn activate(&mut self, id: &str) {
        if !self.editors.iter().any(|e| e.id == id) {
            return;
        }
        self.active = Some(id.into());
        self.mru.retain(|e| e != id);
        self.mru.insert(0, id.into());
    }
    pub fn close(&mut self, id: &str) {
        let Some(index) = self.editors.iter().position(|e| e.id == id) else {
            return;
        };
        self.editors.remove(index);
        self.mru.retain(|e| e != id);
        if self.active.as_deref() == Some(id) {
            self.active = self.mru.first().cloned().or_else(|| {
                self.editors
                    .get(index.min(self.editors.len().saturating_sub(1)))
                    .map(|e| e.id.clone())
            });
            if let Some(id) = self.active.clone() {
                self.activate(&id);
            }
        }
    }
    pub fn move_before(&mut self, source: &str, target: &str) {
        if source == target || !self.editors.iter().any(|e| e.id == target) {
            return;
        }
        let Some(source) = self.editors.iter().position(|e| e.id == source) else {
            return;
        };
        let input = self.editors.remove(source);
        let index = self.editors.iter().position(|e| e.id == target).unwrap();
        self.editors.insert(index, input);
    }
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Workbench {
    pub catalog: Catalog,
    pub layout: Layout,
}
impl Workbench {
    pub fn open(&mut self, input: Input) {
        let id = input.id.clone();
        self.catalog.open(input);
        self.activate(&id);
    }
    pub fn activate(&mut self, id: &str) {
        if !self.catalog.editors.iter().any(|e| e.id == id) {
            return;
        }
        self.catalog.activate(id);
        let pane = self
            .layout
            .root
            .panes()
            .into_iter()
            .find(|(_, editor)| *editor == Some(id))
            .map(|(pane, _)| pane.to_owned());
        if let Some(pane) = pane {
            self.layout.focus(&pane);
        } else {
            self.layout
                .assign(&self.layout.active.clone(), Some(id.into()));
        }
    }
    pub fn focus(&mut self, pane: &str) {
        self.layout.focus(pane);
        if let Some(id) = self.layout.active_editor() {
            self.catalog.activate(id);
        }
    }
    pub fn close(&mut self, id: &str) {
        self.catalog.close(id);
        self.layout
            .remove_editor(id, self.catalog.active.as_deref());
        self.focus(&self.layout.active.clone());
    }
    pub fn close_pane(&mut self, pane: &str) {
        self.layout.close(pane);
        self.focus(&self.layout.active.clone());
    }
    pub fn split(&mut self, direction: Direction) {
        self.layout.split(
            &self.layout.active.clone(),
            direction,
            Placement::Second,
            None,
        );
    }
}
