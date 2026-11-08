//! Which folders this computer shares, and where they are
//! (`host-folder-registry.mjs`): folder ID → local root, kept only here; the
//! Cloud never receives a path. What may run in a folder is decided here
//! too: off by default, per folder, only for a folder that may be edited.
//! A removal is denied locally before the Cloud is asked.
use super::{
    files::{Folders, Grant},
    identity::{Owner, save_private},
    protocol::Capability,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

/// What may run in a folder for the owner's other computers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Execution {
    #[serde(default)]
    pub terminal: bool,
    #[serde(default)]
    pub git: bool,
    #[serde(default)]
    pub agent: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub deployment: String,
    pub account_id: String,
    pub device_id: String,
    pub folder_id: String,
    pub root_path: PathBuf,
    pub name: String,
    pub writable: bool,
    /// "pending" until the Cloud confirmed it, then "active"; "removed".
    pub state: String,
    #[serde(default)]
    pub execution: Execution,
}
impl Row {
    /// `capabilitiesOf`: what this computer itself grants for the folder.
    pub fn capabilities(&self) -> Vec<Capability> {
        let mut capabilities = vec![Capability::Read];
        if self.writable {
            capabilities.push(Capability::Write);
            for (on, capability) in [
                (self.execution.terminal, Capability::Shell),
                (self.execution.git, Capability::Git),
                (self.execution.agent, Capability::Agent),
            ] {
                if on {
                    capabilities.push(capability);
                }
            }
        }
        capabilities
    }
}

pub struct Registry {
    file: PathBuf,
    deployment: String,
    serial: Mutex<()>,
}
impl Registry {
    pub fn new(file: PathBuf, deployment: &str) -> Self {
        Self {
            file,
            deployment: deployment.to_owned(),
            serial: Mutex::new(()),
        }
    }
    fn load(&self) -> Result<Vec<Row>, String> {
        match std::fs::read(&self.file) {
            Ok(bytes) => {
                let rows: Vec<Row> =
                    serde_json::from_slice(&bytes).map_err(|_| "Invalid host folder registry.")?;
                if rows.len() > 1024 {
                    return Err("Invalid host folder registry.".into());
                }
                Ok(rows)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.to_string()),
        }
    }
    fn save(&self, rows: &[Row]) -> Result<(), String> {
        save_private(
            &self.file,
            &serde_json::to_vec(rows).map_err(|e| e.to_string())?,
        )
    }
    fn mine(&self, row: &Row, owner: &Owner) -> bool {
        row.deployment == self.deployment
            && row.account_id == owner.account_id
            && row.device_id == owner.device_id
    }
    pub fn has_active(&self, owner: &Owner) -> bool {
        self.load().is_ok_and(|rows| {
            rows.iter()
                .any(|r| self.mine(r, owner) && r.state == "active")
        })
    }
    /// The owner's active folders here, for its own status.
    pub fn list(&self, owner: &Owner) -> Vec<Row> {
        self.load()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| self.mine(r, owner) && r.state == "active")
            .collect()
    }
    pub fn resolve(&self, owner: &Owner, folder: &str) -> Option<Row> {
        self.load()
            .ok()?
            .into_iter()
            .find(|r| self.mine(r, owner) && r.folder_id == folder && r.state == "active")
    }
    /// Shares `root` as `name`; `confirm(folder_id, name, writable)` is the
    /// Cloud's `POST /hosts/devices/{device}/folders`. The ID is kept before
    /// asking, so a lost reply registers the same folder again.
    pub fn register(
        &self,
        owner: &Owner,
        root: &Path,
        name: &str,
        writable: bool,
        confirm: impl FnOnce(&str, &str, bool) -> Result<String, String>,
    ) -> Result<(String, PathBuf), String> {
        let _serial = self.serial.lock().unwrap();
        let name = name.trim();
        if name.is_empty() {
            return Err("Invalid host folder.".into());
        }
        let meta = std::fs::symlink_metadata(root).map_err(|e| e.to_string())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Select a real directory.".into());
        }
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if root
            .components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case(".git"))
        {
            return Err("Git metadata cannot be shared as a folder.".into());
        }
        let mut rows = self.load()?;
        let index = match rows
            .iter()
            .position(|r| self.mine(r, owner) && r.root_path == root && r.state != "removed")
        {
            Some(index) => {
                if rows[index].name != name || rows[index].writable != writable {
                    return Err("This folder is already registered with different settings.".into());
                }
                index
            }
            None => {
                rows.push(Row {
                    deployment: self.deployment.clone(),
                    account_id: owner.account_id.clone(),
                    device_id: owner.device_id.clone(),
                    folder_id: uuid::Uuid::new_v4().to_string(),
                    root_path: root.clone(),
                    name: name.to_owned(),
                    writable,
                    state: "pending".into(),
                    execution: Execution::default(),
                });
                self.save(&rows)?;
                rows.len() - 1
            }
        };
        let folder = rows[index].folder_id.clone();
        if rows[index].state == "active" {
            return Ok((folder, root));
        }
        if confirm(&folder, name, writable)? != folder {
            return Err("Folder registration returned a different identity.".into());
        }
        rows[index].state = "active".into();
        self.save(&rows)?;
        Ok((folder, root))
    }
    /// Local enforcement follows the narrower access; view-only also ends
    /// every permission to run things.
    pub fn set_access(
        &self,
        owner: &Owner,
        folder: &str,
        name: &str,
        writable: bool,
    ) -> Result<bool, String> {
        let _serial = self.serial.lock().unwrap();
        let mut rows = self.load()?;
        let Some(row) = rows
            .iter_mut()
            .find(|r| self.mine(r, owner) && r.folder_id == folder && r.state == "active")
        else {
            return Ok(false);
        };
        if name.trim().is_empty() {
            return Err("Invalid folder update.".into());
        }
        row.name = name.trim().to_owned();
        row.writable = writable;
        if !writable {
            row.execution = Execution::default();
        }
        self.save(&rows)?;
        Ok(true)
    }
    pub fn set_execution(
        &self,
        owner: &Owner,
        folder: &str,
        execution: Execution,
    ) -> Result<Option<Vec<Capability>>, String> {
        let _serial = self.serial.lock().unwrap();
        let mut rows = self.load()?;
        let Some(row) = rows
            .iter_mut()
            .find(|r| self.mine(r, owner) && r.folder_id == folder && r.state == "active")
        else {
            return Ok(None);
        };
        if (execution.terminal || execution.git || execution.agent) && !row.writable {
            return Err("Allow editing before running anything in this folder.".into());
        }
        row.execution = execution;
        let capabilities = row.capabilities();
        self.save(&rows)?;
        Ok(Some(capabilities))
    }
    /// A revoked device's folders are denied here; nothing is left to tell.
    pub fn forget_device(&self, owner: &Owner) -> Vec<PathBuf> {
        let _serial = self.serial.lock().unwrap();
        let Ok(mut rows) = self.load() else {
            return Vec::new();
        };
        let mut roots = Vec::new();
        for row in rows.iter_mut() {
            if self.mine(row, owner) && row.state != "removed" {
                row.state = "removed".into();
                roots.push(row.root_path.clone());
            }
        }
        if !roots.is_empty() {
            let _ = self.save(&rows);
        }
        roots
    }
    /// Stops sharing `folder`: denied here first, then `revoke` asks the
    /// Cloud (`DELETE`), which a lost reply may repeat.
    pub fn remove(
        &self,
        owner: &Owner,
        folder: &str,
        revoke: impl FnOnce() -> Result<(), String>,
    ) -> Result<Option<PathBuf>, String> {
        let root = {
            let _serial = self.serial.lock().unwrap();
            let mut rows = self.load()?;
            let Some(row) = rows
                .iter_mut()
                .find(|r| self.mine(r, owner) && r.folder_id == folder)
            else {
                return Ok(None);
            };
            let root = row.root_path.clone();
            if row.state != "removed" {
                row.state = "removed".into();
                self.save(&rows)?;
            }
            root
        };
        revoke()?;
        Ok(Some(root))
    }
}
/// The folders an active owner shares, as the file service and SSH server
/// admit them.
pub struct Shared {
    pub registry: std::sync::Arc<Registry>,
    pub owner: std::sync::Arc<Mutex<Option<Owner>>>,
}
impl Folders for Shared {
    fn resolve(&self, folder: &str) -> Option<Grant> {
        let owner = self.owner.lock().unwrap().clone()?;
        let row = self.registry.resolve(&owner, folder)?;
        Some(Grant {
            capabilities: row.capabilities(),
            root: row.root_path,
            active: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner() -> Owner {
        Owner {
            account_id: "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f".into(),
            device_id: "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f".into(),
        }
    }

    /// A folder is shared once under one ID, runs nothing until allowed,
    /// loses everything with editing, and is denied before the Cloud hears.
    #[test]
    fn a_shared_folder_keeps_its_id_and_its_consent_here() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("notes");
        std::fs::create_dir(&root).unwrap();
        let registry = Registry::new(
            temp.path().join("reg.json"),
            "https://api.puppyone.ai/api/v1",
        );
        let owner = owner();
        let mut asked = Vec::new();
        assert!(
            registry
                .register(&owner, &root, "notes", true, |id, _, _| {
                    asked.push(id.to_owned());
                    Err("lost".into())
                })
                .is_err()
        );
        let (folder, _) = registry
            .register(&owner, &root, "notes", true, |id, _, _| {
                asked.push(id.to_owned());
                Ok(id.to_owned())
            })
            .unwrap();
        assert_eq!(asked, [folder.clone(), folder.clone()]);
        assert!(registry.has_active(&owner));
        assert_eq!(
            registry.resolve(&owner, &folder).unwrap().capabilities(),
            [Capability::Read, Capability::Write]
        );
        let all = Execution {
            terminal: true,
            git: true,
            agent: true,
        };
        registry.set_execution(&owner, &folder, all).unwrap();
        assert_eq!(
            registry
                .resolve(&owner, &folder)
                .unwrap()
                .capabilities()
                .len(),
            5
        );
        registry
            .set_access(&owner, &folder, "notes", false)
            .unwrap();
        assert_eq!(
            registry.resolve(&owner, &folder).unwrap().capabilities(),
            [Capability::Read]
        );
        assert!(registry.set_execution(&owner, &folder, all).is_err());
        // Denied here even when the Cloud cannot be told.
        assert!(
            registry
                .remove(&owner, &folder, || Err("offline".into()))
                .is_err()
        );
        assert!(registry.resolve(&owner, &folder).is_none());
        assert!(
            !std::fs::read_to_string(temp.path().join("reg.json"))
                .unwrap()
                .is_empty()
        );
        let git = root.join(".git");
        std::fs::create_dir(&git).unwrap();
        assert!(
            registry
                .register(&owner, &git, "x", false, |id, _, _| Ok(id.into()))
                .is_err()
        );
    }
}
