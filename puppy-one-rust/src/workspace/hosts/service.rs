//! PuppyOne Host (`host-service/service.mjs`): what serves this computer's
//! shared folders to the owner's other computers. It owns the device key,
//! the folder registry (folder ID → local root, kept only here), the file
//! service, remote execution and the outbound device connection, and keeps
//! sharing after the App quits. The App lends it the signed-in person only
//! for the Cloud calls that need one ([`Person`]); that credential never
//! enters the host.
use super::{
    connector::{Connector, Gateway, HttpGateway, Status as Connection},
    exec::{FolderSandbox, Mechanism},
    git::{GitService, SandboxedGit},
    identity::{DeviceIdentity, KeyStore, Owner},
    registry::{Execution, Registry, Shared},
    remote::runtime,
    ssh::{Authorities, HostIdentity, HostSsh},
};
use russh::keys::PublicKey;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// Who is signed in on the App, never a credential.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonSession {
    pub user_id: String,
    pub session_generation: String,
    pub api_base_url: String,
}
/// What the host asks of the App for the signed-in person.
pub trait Person: Send + Sync {
    fn session(&self) -> Option<PersonSession>;
    /// One host route (`isHostServiceRoute`), as that person.
    fn api(&self, method: &str, route: &str, body: Option<Value>) -> Result<Value, String>;
}
/// `process.platform`, as the Cloud names it.
pub fn platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        _ => "linux",
    }
}
/// `HOST_ROUTE`: the only routes the host may ask the App to call.
pub fn is_host_route(route: &str) -> bool {
    let Some(rest) = route.strip_prefix("/hosts/devices") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('/').skip(1).collect();
    let id = |s: &str| s.len() == 36 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-');
    match parts.as_slice() {
        [] => rest.is_empty(),
        [device] => id(device),
        [device, "folders"] => id(device),
        [device, "folders", folder] => id(device) && id(folder),
        _ => false,
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Sharing {
    deployment: Option<String>,
    #[serde(default)]
    paused: bool,
    active: Option<Owner>,
}

/// The Cloud's SSH certificate authority: public, fetched, refreshed when
/// a certificate names one this host has not seen.
struct CachedAuthorities {
    gateway: Arc<dyn Gateway>,
    keys: Mutex<Vec<PublicKey>>,
}
impl CachedAuthorities {
    async fn fetch(&self) -> bool {
        let Ok(lines) = self.gateway.authorities().await else {
            return false;
        };
        let keys: Vec<PublicKey> = lines
            .iter()
            .filter_map(|l| PublicKey::from_openssh(l.trim()).ok())
            .collect();
        let found = !keys.is_empty();
        if found {
            *self.keys.lock().unwrap() = keys;
        }
        found
    }
}
impl Authorities for CachedAuthorities {
    fn keys(&self, refresh: bool) -> Vec<PublicKey> {
        if refresh || self.keys.lock().unwrap().is_empty() {
            let fetch = self.fetch();
            match tokio::runtime::Handle::try_current() {
                Ok(handle) => {
                    tokio::task::block_in_place(|| handle.block_on(fetch));
                }
                Err(_) => {
                    runtime().block_on(fetch);
                }
            }
        }
        self.keys.lock().unwrap().clone()
    }
}

struct Services {
    deployment: String,
    identity: Arc<DeviceIdentity>,
    registry: Arc<Registry>,
    owner: Arc<Mutex<Option<Owner>>>,
    connector: Connector,
    authorities: Arc<CachedAuthorities>,
    ssh: Mutex<Option<HostSsh>>,
}

pub type Notify = Arc<dyn Fn(&str, Value) + Send + Sync>;
pub type Gateways = Arc<dyn Fn(&str) -> Arc<dyn Gateway> + Send + Sync>;
pub type Keys = Arc<dyn Fn() -> Box<dyn KeyStore> + Send + Sync>;

pub struct HostService {
    dir: PathBuf,
    keys: Keys,
    gateways: Gateways,
    person: Mutex<Option<Arc<dyn Person>>>,
    sharing: Mutex<Option<Sharing>>,
    services: Mutex<Option<Arc<Services>>>,
    sandbox: Option<Arc<FolderSandbox>>,
    app_version: String,
    /// `status` and `revoked`, for whoever watches the host.
    notify: Mutex<Option<Notify>>,
    serial: Mutex<()>,
}

/// The search path a login shell would have, for Agents' launchers.
fn search_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|d| !d.is_empty())
        .map(str::to_owned)
        .collect();
    for extra in [
        "/opt/homebrew/bin".to_owned(),
        "/usr/local/bin".into(),
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
        format!("{home}/.bun/bin"),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
        "/sbin".into(),
    ] {
        if !dirs.contains(&extra) {
            dirs.push(extra);
        }
    }
    dirs.join(":")
}

impl HostService {
    /// The host for `dir` (its state), with `app_data` hidden from the folder
    /// tier. `gateways` and `keys` are the real ones outside tests.
    pub fn new(
        dir: PathBuf,
        app_data: Vec<PathBuf>,
        app_version: &str,
        gateways: Option<Gateways>,
        keys: Keys,
        sandbox: Option<Mechanism>,
    ) -> Arc<Self> {
        let sandbox = sandbox.map(|mechanism| {
            let mut sandbox = FolderSandbox::detect(
                PathBuf::from(std::env::var("HOME").unwrap_or_default()),
                app_data,
                search_path(),
            );
            sandbox.mechanism = Some(mechanism);
            Arc::new(sandbox)
        });
        Arc::new(Self {
            dir,
            keys,
            gateways: gateways.unwrap_or_else(|| {
                Arc::new(|deployment: &str| {
                    Arc::new(HttpGateway::new(deployment)) as Arc<dyn Gateway>
                })
            }),
            person: Mutex::new(None),
            sharing: Mutex::new(None),
            services: Mutex::new(None),
            sandbox,
            app_version: app_version.to_owned(),
            notify: Mutex::new(None),
            serial: Mutex::new(()),
        })
    }
    pub fn set_notify(&self, notify: Notify) {
        *self.notify.lock().unwrap() = Some(notify);
    }
    /// The App connected (or left): the person it lends, if any.
    pub fn set_person(&self, person: Option<Arc<dyn Person>>) {
        *self.person.lock().unwrap() = person;
    }
    fn emit(&self, event: &str, data: Value) {
        let notify = self.notify.lock().unwrap().clone();
        if let Some(notify) = notify {
            notify(event, data);
        }
    }
    fn sharing_file(&self) -> PathBuf {
        self.dir.join("host-sharing.json")
    }
    /// True once this computer has shared something.
    pub fn has_state(dir: &Path) -> bool {
        dir.join("host-sharing.json").exists()
    }
    fn sharing(&self) -> Sharing {
        let mut sharing = self.sharing.lock().unwrap();
        sharing
            .get_or_insert_with(|| {
                std::fs::read(self.sharing_file())
                    .ok()
                    .and_then(|b| serde_json::from_slice(&b).ok())
                    .unwrap_or_default()
            })
            .clone()
    }
    fn save(&self, change: impl FnOnce(&mut Sharing)) -> Result<Sharing, String> {
        let mut current = self.sharing();
        change(&mut current);
        super::identity::save_private(
            &self.sharing_file(),
            &serde_json::to_vec(&current).map_err(|e| e.to_string())?,
        )?;
        *self.sharing.lock().unwrap() = Some(current.clone());
        Ok(current)
    }
    fn person(&self) -> Result<Arc<dyn Person>, String> {
        self.person
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "Open PuppyOne and sign in to change what this computer shares.".into())
    }
    /// The signed-in person on this host's deployment.
    fn session(&self, services: &Services) -> Result<(Arc<dyn Person>, PersonSession), String> {
        let person = self.person()?;
        let session = person
            .session()
            .filter(|s| s.api_base_url.trim_end_matches('/') == services.deployment)
            .ok_or("Sign in to the current Cloud deployment first.")?;
        Ok((person, session))
    }
    fn services(&self) -> Result<Arc<Services>, String> {
        self.services
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "PuppyOne Host is not configured for a Cloud deployment.".into())
    }
    fn build(self: &Arc<Self>, deployment: &str) -> Arc<Services> {
        let gateway = (self.gateways)(deployment);
        let identity = Arc::new(DeviceIdentity::new(
            self.dir.join("host-device-identity.json"),
            (self.keys)(),
            deployment,
        ));
        let registry = Arc::new(Registry::new(
            self.dir.join("host-folder-registry.json"),
            deployment,
        ));
        let (status, revoked) = (Arc::downgrade(self), Arc::downgrade(self));
        let connector = Connector::new(
            gateway.clone(),
            identity.clone(),
            registry.clone(),
            &self.app_version,
            move |_| {
                if let Some(host) = status.upgrade() {
                    host.emit("status", host.status_value(false));
                }
            },
            move |owner| {
                if let Some(host) = revoked.upgrade() {
                    host.forget_revoked(owner);
                }
            },
        );
        Arc::new(Services {
            deployment: deployment.to_owned(),
            identity,
            registry,
            owner: Arc::default(),
            connector,
            authorities: Arc::new(CachedAuthorities {
                gateway,
                keys: Mutex::default(),
            }),
            ssh: Mutex::new(None),
        })
    }
    /// Deny locally first, then drop the key: a later share registers anew.
    fn forget_revoked(&self, owner: &Owner) {
        let Ok(services) = self.services() else {
            return;
        };
        if self.sharing().active.as_ref() == Some(owner) {
            let _ = self.save(|s| s.active = None);
        }
        *services.owner.lock().unwrap() = None;
        let roots = services.registry.forget_device(owner);
        services.identity.forget(owner);
        self.emit(
            "revoked",
            json!({"accountId": owner.account_id, "deviceId": owner.device_id, "roots": roots}),
        );
        self.emit("status", self.status_value(false));
    }
    fn connect_active(&self, services: &Services) {
        let sharing = self.sharing();
        let Some(owner) = sharing.active.clone().filter(|_| !sharing.paused) else {
            return;
        };
        if services.connector.is_active() || !services.registry.has_active(&owner) {
            return;
        }
        let Ok(key) = services.identity.key(&owner) else {
            return;
        };
        // The first certificate need not wait for the authority's keys.
        let authorities = services.authorities.clone();
        runtime().spawn(async move {
            authorities.fetch().await;
        });
        *services.owner.lock().unwrap() = Some(owner.clone());
        let mut ssh = HostSsh::new(
            Arc::new(HostIdentity {
                account: owner.account_id.clone(),
                device: owner.device_id.clone(),
                key,
            }),
            services.authorities.clone(),
            Arc::new(Shared {
                registry: services.registry.clone(),
                owner: services.owner.clone(),
            }),
            self.sandbox
                .clone()
                .map(|s| s as Arc<dyn super::exec::Execution>),
        );
        ssh.git = self
            .sandbox
            .clone()
            .map(|sandbox| Arc::new(GitService::new(Arc::new(SandboxedGit(sandbox)))));
        *services.ssh.lock().unwrap() = Some(ssh.clone());
        services.connector.connect(owner, ssh);
    }
    fn enforce(&self, services: &Services, folder: &str) {
        if let Some(ssh) = services.ssh.lock().unwrap().as_ref() {
            ssh.enforce(folder);
        }
    }

    // ------------------------------------------------------------ methods
    /// On launch: resume sharing if it was sharing and not paused.
    pub fn start(self: &Arc<Self>) {
        let _serial = self.serial.lock().unwrap();
        if let Some(deployment) = self.sharing().deployment {
            let services = self.build(&deployment);
            *self.services.lock().unwrap() = Some(services.clone());
            self.connect_active(&services);
        }
    }
    /// The App tells the host which Cloud it belongs to; another deployment
    /// never inherits the previous one's sharing.
    pub fn configure(self: &Arc<Self>, api: &str) -> Result<Value, String> {
        let _serial = self.serial.lock().unwrap();
        let deployment = api.trim_end_matches('/').to_owned();
        let current = self.services.lock().unwrap().clone();
        if current.as_ref().map(|s| &s.deployment) != Some(&deployment) {
            if let Some(previous) = current {
                previous.connector.stop();
            }
            if self.sharing().deployment.as_ref() != Some(&deployment) {
                self.save(|s| {
                    s.deployment = Some(deployment.clone());
                    s.active = None;
                })?;
            }
            *self.services.lock().unwrap() = Some(self.build(&deployment));
        }
        let services = self.services()?;
        self.connect_active(&services);
        Ok(self.status_value(false))
    }
    fn status_value(&self, folders: bool) -> Value {
        let sharing = self.sharing();
        let services = self.services.lock().unwrap().clone();
        let connection = services
            .as_ref()
            .map(|s| s.connector.status())
            .unwrap_or_default();
        let Connection {
            state,
            device,
            tunnels,
            last_access,
        } = connection;
        let mut status = json!({
            "state": state.as_str(), "deviceId": device, "activeRequests": 0, "watching": 0,
            "tunnels": tunnels, "lastAccessAt": last_access, "running": [],
            "paused": sharing.paused, "active": sharing.active, "deployment": sharing.deployment,
            "sandbox": self.sandbox.as_ref().and_then(|s| s.mechanism.as_ref()).map(|m| m.name()),
        });
        if folders {
            let rows = match (&services, &sharing.active) {
                (Some(services), Some(owner)) => services.registry.list(owner),
                _ => vec![],
            };
            status["folders"] = rows
                .into_iter()
                .map(|r| {
                    json!({"folderId": r.folder_id, "name": r.name, "writable": r.writable,
                        "rootPath": r.root_path, "execution": r.execution})
                })
                .collect();
        }
        status
    }
    pub fn status(&self) -> Value {
        self.status_value(true)
    }
    pub fn identity_existing(&self, account: &str) -> Result<Option<Owner>, String> {
        Ok(self.services()?.identity.existing_for(account))
    }
    /// Registers this computer for the signed-in person (`POST /hosts/devices`).
    pub fn identity_register(&self, name: &str, platform: &str) -> Result<Owner, String> {
        let services = self.services()?;
        let (person, session) = self.session(&services)?;
        let name: String = name.chars().take(120).collect();
        services.identity.register(&session.user_id, |public_key| {
            let reply = person.api(
                "POST",
                "/hosts/devices",
                Some(json!({"public_key": public_key, "name": name, "platform": platform})),
            )?;
            reply["device_id"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "Device registration returned an invalid ID.".into())
        })
    }
    pub fn registry_has_active(&self, owner: &Owner) -> Result<bool, String> {
        Ok(self.services()?.registry.has_active(owner))
    }
    /// Shares `root` for the signed-in person's registered device.
    pub fn registry_register(
        &self,
        device: &str,
        root: &Path,
        name: &str,
        writable: bool,
    ) -> Result<Value, String> {
        let services = self.services()?;
        let (person, session) = self.session(&services)?;
        let owner = Owner {
            account_id: session.user_id,
            device_id: device.to_owned(),
        };
        let (folder, root) =
            services
                .registry
                .register(&owner, root, name, writable, |id, name, writable| {
                    let reply = person.api(
                        "POST",
                        &format!("/hosts/devices/{device}/folders"),
                        Some(json!({"folder_id": id, "name": name, "writable": writable})),
                    )?;
                    reply["folder_id"]
                        .as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| "Folder registration returned a different identity.".into())
                })?;
        self.emit("status", self.status_value(false));
        Ok(json!({"folderId": folder, "rootPath": root}))
    }
    /// The folder's name and editing here; view-only ends what runs there.
    pub fn registry_set_access(
        &self,
        owner: &Owner,
        folder: &str,
        name: &str,
        writable: bool,
    ) -> Result<bool, String> {
        let services = self.services()?;
        let changed = services
            .registry
            .set_access(owner, folder, name, writable)?;
        if !writable {
            self.enforce(&services, folder);
        }
        Ok(changed)
    }
    pub fn registry_set_execution(
        &self,
        owner: &Owner,
        folder: &str,
        execution: Execution,
    ) -> Result<bool, String> {
        let services = self.services()?;
        services.registry.set_execution(owner, folder, execution)?;
        self.enforce(&services, folder);
        Ok(true)
    }
    /// Stops sharing a folder: denied here, sessions end, then the Cloud is told.
    pub fn registry_remove(&self, device: &str, folder: &str) -> Result<Option<PathBuf>, String> {
        let _serial = self.serial.lock().unwrap();
        let services = self.services()?;
        let (person, session) = self.session(&services)?;
        let owner = Owner {
            account_id: session.user_id,
            device_id: device.to_owned(),
        };
        let removed = services.registry.remove(&owner, folder, || {
            person
                .api(
                    "DELETE",
                    &format!("/hosts/devices/{device}/folders/{folder}"),
                    None,
                )
                .map(|_| ())
        });
        self.enforce(&services, folder);
        if self.sharing().active.as_ref() == Some(&owner) && !services.registry.has_active(&owner) {
            services.connector.stop();
        }
        self.emit("status", self.status_value(false));
        removed
    }
    /// Start (or resume) sharing for this account's registered device.
    pub fn connect(&self, owner: &Owner) -> Result<Value, String> {
        let _serial = self.serial.lock().unwrap();
        let services = self.services()?;
        if self.sharing().active.as_ref() != Some(owner) {
            services.connector.stop();
            self.save(|s| s.active = Some(owner.clone()))?;
        }
        if self.sharing().paused {
            self.emit("status", self.status_value(false));
            return Ok(json!({"deviceId": owner.device_id, "paused": true}));
        }
        self.connect_active(&services);
        Ok(json!({"deviceId": owner.device_id}))
    }
    /// The person here signed out or switched accounts: stop until they return.
    pub fn stop_sharing(&self) -> Result<bool, String> {
        let _serial = self.serial.lock().unwrap();
        if let Ok(services) = self.services() {
            services.connector.stop();
            if let Some(ssh) = services.ssh.lock().unwrap().take() {
                ssh.close_all();
            }
            *services.owner.lock().unwrap() = None;
        }
        self.save(|s| s.active = None)?;
        self.emit("status", self.status_value(false));
        Ok(true)
    }
    pub fn set_paused(&self, paused: bool) -> Result<Value, String> {
        let _serial = self.serial.lock().unwrap();
        self.save(|s| s.paused = paused)?;
        if let Ok(services) = self.services() {
            if paused {
                services.connector.stop();
                if let Some(ssh) = services.ssh.lock().unwrap().as_ref() {
                    ssh.close_all();
                }
            } else {
                self.connect_active(&services);
            }
        }
        self.emit("status", self.status_value(false));
        Ok(json!({"paused": paused}))
    }
    /// "Stop all": every remote session here ends.
    pub fn exec_stop_all(&self) -> bool {
        if let Ok(services) = self.services()
            && let Some(ssh) = services.ssh.lock().unwrap().as_ref()
        {
            ssh.close_all();
        }
        true
    }
    pub fn dispose(&self) {
        // Stopping reports its status, which reads the services again.
        let services = self.services.lock().unwrap().take();
        if let Some(services) = services {
            services.connector.stop();
            let ssh = services.ssh.lock().unwrap().take();
            if let Some(ssh) = ssh {
                ssh.close_all();
            }
        }
    }

    /// One control-channel call by its TypeScript name (`methods`).
    pub fn call(self: &Arc<Self>, method: &str, params: &Value) -> Result<Value, String> {
        let owner = || -> Result<Owner, String> {
            serde_json::from_value(params.clone()).map_err(|_| "Invalid device.".to_owned())
        };
        let text = |key: &str| params[key].as_str().unwrap_or_default().to_owned();
        fn value<T: Serialize>(result: Result<T, String>) -> Result<Value, String> {
            result.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
        }
        match method {
            "configure" => self.configure(&text("apiBase")),
            "status" => Ok(self.status()),
            "identityExisting" => value(self.identity_existing(&text("accountId"))),
            "identityRegister" => value(self.identity_register(&text("name"), &text("platform"))),
            "registryList" => {
                let services = self.services()?;
                Ok(serde_json::to_value(services.registry.list(&owner()?)).unwrap_or_default())
            }
            "registryHasActive" => value(self.registry_has_active(&owner()?)),
            "registryRegister" => self.registry_register(
                &text("deviceId"),
                Path::new(&text("rootPath")),
                &text("name"),
                params["writable"] == true,
            ),
            "registrySetAccess" => value(self.registry_set_access(
                &owner()?,
                &text("folderId"),
                &text("name"),
                params["writable"] == true,
            )),
            "registrySetExecution" => value(self.registry_set_execution(
                &owner()?,
                &text("folderId"),
                Execution {
                    terminal: params["terminal"] == true,
                    git: params["git"] == true,
                    agent: params["agent"] == true,
                },
            )),
            "registryRemove" => value(
                self.registry_remove(&text("deviceId"), &text("folderId"))
                    .map(|r| r.is_some()),
            ),
            "connect" => self.connect(&owner()?),
            "stopSharing" => value(self.stop_sharing()),
            "setPaused" => self.set_paused(params["paused"] == true),
            "execStopAll" => Ok(json!(self.exec_stop_all())),
            "execEnforce" => {
                let services = self.services()?;
                self.enforce(&services, &text("folderId"));
                Ok(json!(true))
            }
            _ => Err("Unknown method.".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::identity::MemoryKeys;
    use super::*;

    const ACCOUNT: &str = "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f";
    const DEVICE: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";
    const API: &str = "https://api.puppyone.ai/api/v1";

    /// The App's person in memory: what the host asked of the Cloud.
    #[derive(Default)]
    struct App(Mutex<Vec<(String, String, Option<Value>)>>);
    impl Person for App {
        fn session(&self) -> Option<PersonSession> {
            Some(PersonSession {
                user_id: ACCOUNT.into(),
                session_generation: "g1".into(),
                api_base_url: API.into(),
            })
        }
        fn api(&self, method: &str, route: &str, body: Option<Value>) -> Result<Value, String> {
            assert!(is_host_route(route), "{route}");
            self.0
                .lock()
                .unwrap()
                .push((method.into(), route.into(), body.clone()));
            Ok(match (method, route) {
                ("POST", "/hosts/devices") => json!({"device_id": DEVICE}),
                ("POST", _) => json!({"folder_id": body.unwrap()["folder_id"]}),
                _ => json!({}),
            })
        }
    }

    /// Sharing a folder from here: this computer registers once, the folder
    /// is registered without its path, its consent stays here, and removing
    /// it denies here before the Cloud is told.
    #[test]
    fn this_computer_shares_a_folder_through_the_apps_person() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("notes");
        std::fs::create_dir(&root).unwrap();
        let keys: Keys = {
            let shared = Arc::new(MemoryKeys::default());
            Arc::new(move || {
                let shared = shared.clone();
                struct Same(Arc<MemoryKeys>);
                impl KeyStore for Same {
                    fn put(&self, item: &str, secret: &[u8]) -> Result<(), String> {
                        self.0.put(item, secret)
                    }
                    fn get(&self, item: &str) -> Result<Option<Vec<u8>>, String> {
                        self.0.get(item)
                    }
                    fn delete(&self, item: &str) -> Result<(), String> {
                        self.0.delete(item)
                    }
                }
                Box::new(Same(shared)) as Box<dyn KeyStore>
            })
        };
        let host = HostService::new(temp.path().join("host"), vec![], "0.4.0", None, keys, None);
        assert!(
            host.identity_register("Mac", "darwin").is_err(),
            "not configured"
        );
        host.configure(API).unwrap();
        assert!(
            host.identity_register("Mac", "darwin")
                .unwrap_err()
                .contains("sign in")
        );
        let app = Arc::new(App::default());
        host.set_person(Some(app.clone()));
        let owner = host.identity_register("Mac", "darwin").unwrap();
        assert_eq!(owner.device_id, DEVICE);
        let registered = host
            .registry_register(DEVICE, &root, "notes", true)
            .unwrap();
        let folder = registered["folderId"].as_str().unwrap().to_owned();
        let asked = app.0.lock().unwrap().clone();
        assert_eq!(asked[1].1, format!("/hosts/devices/{DEVICE}/folders"));
        assert!(
            !asked[1].2.as_ref().unwrap().to_string().contains("notes/"),
            "no path leaves this computer"
        );
        host.set_paused(true).unwrap();
        host.connect(&owner).unwrap();
        let status = host.status();
        assert_eq!(status["paused"], true);
        assert_eq!(status["folders"][0]["folderId"], folder.as_str());
        assert_eq!(status["folders"][0]["execution"]["terminal"], false);
        host.call(
            "registrySetExecution",
            &json!({"accountId": ACCOUNT, "deviceId": DEVICE, "folderId": folder, "terminal": true}),
        )
        .unwrap();
        assert_eq!(host.status()["folders"][0]["execution"]["terminal"], true);
        assert_eq!(
            host.call(
                "registryRemove",
                &json!({"deviceId": DEVICE, "folderId": folder})
            )
            .unwrap(),
            json!(true)
        );
        assert_eq!(app.0.lock().unwrap().last().unwrap().0, "DELETE");
        assert!(host.status()["folders"].as_array().unwrap().is_empty());
        assert!(HostService::has_state(&temp.path().join("host")));
    }

    #[test]
    fn the_host_asks_the_app_only_for_its_own_routes() {
        let device = DEVICE;
        for route in [
            "/hosts/devices".to_owned(),
            format!("/hosts/devices/{device}"),
            format!("/hosts/devices/{device}/folders"),
            format!("/hosts/devices/{device}/folders/{device}"),
        ] {
            assert!(is_host_route(&route), "{route}");
        }
        for route in [
            "/projects/".to_owned(),
            "/hosts".into(),
            format!("/hosts/devices/{device}/ssh-certificate"),
            format!("/hosts/devices/{device}/folders/{device}/x"),
            "/hosts/devicesX".into(),
        ] {
            assert!(!is_host_route(&route), "{route}");
        }
    }
}
