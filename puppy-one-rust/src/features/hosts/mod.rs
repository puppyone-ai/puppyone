//! Folders on the owner's other computers as the window offers them
//! (`useHostCatalog`, `host-ipc.mjs`): the account's computers and what
//! each offers, read while the Homepage shows (again every 30 s and when
//! the window comes forward), and the access side's connections for that
//! account. Opening another computer's folder needs no device key, so it
//! works where this computer cannot share its own. The folders this
//! computer opened recently are kept for restoring a window ([`recents`]).
mod link;
mod recents;
mod tools;
pub use link::{HostLink, SharedFolder, global as host_link, read as read_link};
pub use recents::Recent;
pub use tools::{HostTools, Target, Tool};

/// `recordRecentHostFolder`: `recent` first, and its account's last open.
pub fn remember(recent: Recent) {
    recents::record(&crate::platform::data_dir(), recent);
}
/// The account's last open folder on another computer, if it has one.
pub fn last_active(api: &str, account: &str) -> Option<Recent> {
    recents::last_active(&crate::platform::data_dir(), api, account)
}
/// `closeRecentHostFolder`: the account left its other computer's folder.
pub fn forget_last_active(api: &str, account: &str) {
    recents::clear_last_active(&crate::platform::data_dir(), api, account);
}

use crate::workspace::cloud::catalog::{Item, RemoteFolder};
use crate::workspace::hosts::remote::{BrokerCloud, Device, Hosts, runtime};
use gpui::*;
use std::{
    collections::HashSet,
    sync::Arc,
    time::{Duration, Instant},
};

/// `CATALOG_REFRESH_MS`: presence changes while the page is open.
pub const REFRESH: Duration = Duration::from_secs(30);

pub struct HostCatalog {
    /// `[api, user, generation]` of the session read for.
    authority: Option<String>,
    /// The access side for that session.
    hosts: Option<Arc<Hosts>>,
    devices: Vec<Device>,
    loaded: bool,
    error: bool,
    reading: bool,
    epoch: u64,
    read_at: Option<Instant>,
    /// This computer's device id, once it shares a folder (its own host
    /// service says so); it is listed first and never as another computer.
    pub this_device: Option<String>,
}

struct Service(Entity<HostCatalog>);
impl Global for Service {}

pub fn global(cx: &mut App) -> Entity<HostCatalog> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    let catalog = cx.new(|_| HostCatalog {
        authority: None,
        hosts: None,
        devices: Vec::new(),
        loaded: false,
        error: false,
        reading: false,
        epoch: 0,
        read_at: None,
        this_device: None,
    });
    cx.set_global(Service(catalog.clone()));
    catalog
}
pub fn read(cx: &App) -> Option<&HostCatalog> {
    cx.try_global::<Service>().map(|s| s.0.read(cx))
}

impl HostCatalog {
    /// Reads the catalog for the signed-in account while `enabled` and
    /// `visible`: once per session, again after [`REFRESH`], and at once on
    /// `retry`. Another account's connections end when it changes.
    pub fn ensure(&mut self, enabled: bool, visible: bool, retry: bool, cx: &mut Context<Self>) {
        let Some((broker, binding)) =
            crate::features::cloud::account::broker_and_binding(cx).filter(|_| enabled)
        else {
            if self.authority.take().is_some() {
                self.reset();
                cx.notify();
            }
            return;
        };
        let authority =
            serde_json::json!([binding.environment.api(), binding.user, binding.epoch]).to_string();
        if self.authority.as_ref() != Some(&authority) {
            self.reset();
            self.authority = Some(authority.clone());
            self.hosts = Some(Hosts::new(Arc::new(BrokerCloud {
                broker,
                binding,
                cancel: Default::default(),
            })));
            cx.notify();
        }
        let stale = self.read_at.is_none_or(|at| at.elapsed() >= REFRESH);
        if !visible || self.reading || !(retry || stale) {
            return;
        }
        let Some(hosts) = self.hosts.clone() else {
            return;
        };
        self.reading = true;
        self.epoch += 1;
        let epoch = self.epoch;
        let task = cx
            .background_executor()
            .spawn(async move { runtime().block_on(hosts.catalog()) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch != epoch || s.authority.as_ref() != Some(&authority) {
                    return;
                }
                s.reading = false;
                s.read_at = Some(Instant::now());
                s.loaded = true;
                match result {
                    Ok(devices) => {
                        s.devices = devices;
                        s.error = false;
                    }
                    // Keep what this account already answered.
                    Err(_) => s.error = true,
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn reset(&mut self) {
        if let Some(hosts) = self.hosts.take() {
            hosts.close_all();
        }
        self.devices.clear();
        self.loaded = false;
        self.error = false;
        self.reading = false;
        self.read_at = None;
        self.epoch += 1;
    }
    /// The access side for the signed-in account, once read for it.
    pub fn hosts(&self) -> Option<Arc<Hosts>> {
        self.hosts.clone()
    }
    /// The last read failed (`hosts.catalog.unavailable`).
    pub fn error(&self) -> bool {
        self.error
    }
    /// Every computer of the owner's but this one.
    pub fn others(&self) -> impl Iterator<Item = &Device> {
        self.devices
            .iter()
            .filter(|d| Some(&d.id) != self.this_device.as_ref())
    }
    /// The folders this computer offers right now, when it is known.
    pub fn offered_here(&self) -> Option<HashSet<String>> {
        let id = self.this_device.as_ref()?;
        let mine = self.devices.iter().find(|d| &d.id == id)?;
        Some(mine.folders.iter().map(|f| f.id.clone()).collect())
    }
    /// The folders other computers offer, as Homepage entries, each
    /// computer's by name; `local` are this computer's own shared folders,
    /// which show as themselves.
    pub fn remote_items(&self, local: &HashSet<String>) -> Vec<Item> {
        let mut items = Vec::new();
        for device in self.others() {
            let mut folders: Vec<_> = device
                .folders
                .iter()
                .filter(|f| !local.contains(&f.id))
                .collect();
            folders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            items.extend(folders.into_iter().map(|folder| {
                Item {
                    id: format!("device-folder:{}", folder.id),
                    label: folder.name.clone(),
                    local_path: None,
                    cloud_project: None,
                    linked: None,
                    actions: None,
                    modified: None,
                    cloud_organization: None,
                    host_folder: None,
                    remote: Some(RemoteFolder {
                        device: device.id.clone(),
                        host: device.name.clone(),
                        folder: folder.id.clone(),
                        writable: folder.writable(),
                        capabilities: folder
                            .capabilities
                            .iter()
                            .filter_map(|c| serde_json::to_value(c).ok())
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect(),
                        online: device.online,
                        paused: device.paused() || folder.paused(),
                    }),
                }
            }));
        }
        items
    }
    /// The tools for `remote` on screen: what its computer allows now, else
    /// what it allowed when it was opened.
    pub fn tools_target(&self, remote: &RemoteFolder) -> Option<Target> {
        let capabilities = self
            .folder(&remote.folder)
            .map(|(_, folder)| {
                folder
                    .capabilities
                    .iter()
                    .filter_map(|c| serde_json::to_value(c).ok()?.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_else(|| remote.capabilities.clone());
        Some(Target {
            hosts: self.hosts()?,
            folder: remote.folder.clone(),
            host: remote.host.clone(),
            capabilities,
        })
    }
    /// What `folder` allows now, if the catalog lists it.
    pub fn folder(
        &self,
        folder: &str,
    ) -> Option<(&Device, &crate::workspace::hosts::remote::Folder)> {
        self.devices
            .iter()
            .find_map(|d| d.folders.iter().find(|f| f.id == folder).map(|f| (d, f)))
    }
    /// Tests: stand in an answer for the signed-in account.
    #[cfg(test)]
    pub fn install(&mut self, hosts: Arc<Hosts>, devices: Vec<Device>, cx: &mut Context<Self>) {
        let (_, binding) = crate::features::cloud::account::broker_and_binding(cx).unwrap();
        self.authority = Some(
            serde_json::json!([binding.environment.api(), binding.user, binding.epoch]).to_string(),
        );
        self.hosts = Some(hosts);
        self.devices = devices;
        self.loaded = true;
        self.read_at = Some(Instant::now());
    }
}
