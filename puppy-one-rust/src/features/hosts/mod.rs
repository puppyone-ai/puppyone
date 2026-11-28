//! Folders on the owner's other computers as the window offers them
//! (`useHostCatalog`, `host-ipc.mjs`): the account's computers and what
//! each offers, read while the Homepage shows (again every 30 s and when
//! the window comes forward), and the access side's connections for that
//! account. Opening another computer's folder needs no device key, so it
//! works where this computer cannot share its own. The folders this
//! computer opened recently are kept for restoring a window ([`recents`]).
mod computer_access;
mod link;
mod recents;
mod tools;
pub use computer_access::{SharedRow, no_folders, presence, shared_rows, sharing_status};
#[cfg(test)]
pub use link::HostStatus;
pub use link::{
    HostLink, SharedFolder, global as host_link, read as read_link, start_at_login,
    suspend_leftover,
};
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
    /// Captures: a fixed catalog stands in, whatever the account.
    fixture: bool,
    /// A change on its way (`pending`), and what failed of the last one
    /// (`actionError`) as its message key.
    pub pending: bool,
    pub action_error: Option<&'static str>,
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
        fixture: false,
        pending: false,
        action_error: None,
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
    /// Captures and tests: the catalog of `#homepage-computers-visual-smoke`.
    #[cfg(any(test, feature = "dev-capture"))]
    pub fn install_fixture(&mut self, catalog: &serde_json::Value, this_device: &str) {
        self.devices = crate::workspace::hosts::remote::parse_catalog(catalog).unwrap_or_default();
        self.this_device = Some(this_device.to_owned());
        self.loaded = true;
        self.read_at = Some(Instant::now());
        self.fixture = true;
    }
    pub fn is_fixture(&self) -> bool {
        self.fixture
    }
    pub fn hosts(&self) -> Option<Arc<Hosts>> {
        self.hosts.clone()
    }
    /// Every computer of the owner's, this one too.
    pub fn devices(&self) -> &[Device] {
        &self.devices
    }
    pub fn loaded(&self) -> bool {
        self.loaded
    }
    pub fn reading(&self) -> bool {
        self.reading
    }
    /// `host:revoke-device` after the owner's confirmation: the computer
    /// leaves the owner's computers and the catalog is read again.
    pub fn remove_device(&mut self, device: String, cx: &mut Context<Self>) {
        let Some(hosts) = self.hosts.clone().filter(|_| !self.pending) else {
            return;
        };
        self.pending = true;
        self.action_error = None;
        cx.notify();
        let task = cx
            .background_executor()
            .spawn(async move { runtime().block_on(hosts.revoke(&device)) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                s.pending = false;
                match result {
                    Ok(()) => s.ensure(true, true, true, cx),
                    Err(_) => s.action_error = Some("hosts.settings.removeFailure"),
                }
                cx.notify();
            });
        })
        .detach();
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
            folders.sort_by_key(|f| f.name.to_lowercase());
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use gpui::TestAppContext;
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    const THIS: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";
    const OFFICE: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    fn settle(cx: &mut TestAppContext, ready: impl Fn(&mut TestAppContext) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready(cx) {
            cx.run_until_parked();
            assert!(Instant::now() < deadline, "did not settle");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// `useHostDevices`: a read that failed says so rather than listing no
    /// computers, and a retry reads again; what the account already answered
    /// stays through a later failure; reads asked for while one is under way
    /// are that one read. Removing a computer, another or this one, is the
    /// same request and reads the list again; a removal refused without a
    /// reason says the computer could not be removed.
    #[gpui::test]
    fn the_catalog_keeps_what_it_knew_and_removes_through_one_request(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        crate::localization::set_current("en");
        let failing = Arc::new(Mutex::new(true));
        let refusing = Arc::new(Mutex::new(false));
        let reads = Arc::new(AtomicUsize::new(0));
        let removed = Arc::new(Mutex::new(Vec::<String>::new()));
        let (fail, refuse, read, gone) = (
            failing.clone(),
            refusing.clone(),
            reads.clone(),
            removed.clone(),
        );
        let responder: crate::cloud::auth::Responder = Arc::new(move |request| {
            if request.path == "/hosts" {
                read.fetch_add(1, Ordering::SeqCst);
                if *fail.lock().unwrap() {
                    return Err(crate::cloud::auth::Error::Unavailable);
                }
                let device = |id: &str, name: &str| {
                    serde_json::json!({"id": id, "name": name, "online": true, "state": "active",
                        "revision": 1, "folders": []})
                };
                return Ok(serde_json::json!({"devices": [device(THIS, "MacBook Pro"),
                    device(OFFICE, "Office PC")]}));
            }
            if request.method == reqwest::Method::DELETE {
                gone.lock().unwrap().push(request.path.clone());
                if *refuse.lock().unwrap() {
                    return Err(crate::cloud::auth::Error::Unavailable);
                }
                return Ok(serde_json::json!({"revoked": true}));
            }
            Err(crate::cloud::auth::Error::Unavailable)
        });
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
        cx.update(|cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
        settle(cx, |cx| {
            cx.update(|cx| crate::features::cloud::account::has_account(cx))
        });
        let catalog = cx.update(global);
        let idle = |cx: &mut TestAppContext| {
            catalog.read_with(cx, |c, _| c.loaded && !c.reading && !c.pending)
        };
        catalog.update(cx, |c, cx| {
            c.this_device = Some(THIS.into());
            c.ensure(true, true, true, cx)
        });
        settle(cx, idle);
        catalog.read_with(cx, |c, _| assert!(c.error() && c.devices().is_empty()));
        *failing.lock().unwrap() = false;
        let before = reads.load(Ordering::SeqCst);
        // Asked again while the read is under way: still one read.
        catalog.update(cx, |c, cx| {
            c.ensure(true, true, true, cx);
            c.ensure(true, true, true, cx)
        });
        settle(cx, idle);
        assert_eq!(reads.load(Ordering::SeqCst), before + 1);
        catalog.read_with(cx, |c, _| {
            assert!(!c.error());
            let others: Vec<_> = c.others().map(|d| d.name.as_str()).collect();
            assert_eq!(others, ["Office PC"]);
        });
        // A later failure keeps what the account answered.
        *failing.lock().unwrap() = true;
        catalog.update(cx, |c, cx| c.ensure(true, true, true, cx));
        settle(cx, idle);
        catalog.read_with(cx, |c, _| assert!(c.error() && c.devices().len() == 2));
        *failing.lock().unwrap() = false;
        for device in [OFFICE, THIS] {
            let before = reads.load(Ordering::SeqCst);
            catalog.update(cx, |c, cx| c.remove_device(device.into(), cx));
            settle(cx, |cx| idle(cx) && reads.load(Ordering::SeqCst) > before);
        }
        assert_eq!(
            removed.lock().unwrap().as_slice(),
            [
                format!("/hosts/devices/{OFFICE}"),
                format!("/hosts/devices/{THIS}")
            ]
        );
        *refusing.lock().unwrap() = true;
        catalog.update(cx, |c, cx| c.remove_device(OFFICE.into(), cx));
        settle(cx, idle);
        catalog.read_with(cx, |c, _| {
            let failure = c.action_error.unwrap();
            assert_eq!(
                crate::localization::t(failure),
                "Unable to remove this computer."
            );
        });
    }
}
