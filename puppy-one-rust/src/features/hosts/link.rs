//! The App's half of sharing this computer's folders (`host-ipc.mjs`):
//! PuppyOne Host runs on its own and serves them; the App finds it (and
//! starts it when the person shares something), lends it the signed-in
//! person for the few Cloud calls that need one, asks the person before
//! anything is widened, and shows its status. Changing what a folder
//! allows is done here, on this computer, never from another.
use crate::cloud::auth::{
    Broker, Cancellation,
    model::{ApiRequest, Binding},
};
use crate::workspace::hosts::{
    control::{self, Handler, Peer},
    process::{HOST_ARGUMENT, state_dir},
    registry::Execution,
    remote::runtime,
};
use gpui::*;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

/// A folder this computer shares, as its host reports it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFolder {
    pub folder_id: String,
    pub name: String,
    pub writable: bool,
    pub root_path: PathBuf,
    #[serde(default)]
    pub execution: Execution,
}
/// `HostSharingStatus`.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    #[serde(default)]
    pub state: String,
    pub device_id: Option<String>,
    #[serde(default)]
    pub paused: bool,
    pub active: Option<crate::workspace::hosts::identity::Owner>,
    pub sandbox: Option<String>,
    #[serde(default)]
    pub folders: Vec<SharedFolder>,
    /// Terminals and Agents other computers run here now.
    #[serde(default)]
    pub running: Vec<Value>,
}

type Account = Arc<Mutex<Option<(Arc<Broker>, Binding)>>>;

pub struct HostLink {
    peer: Option<Peer>,
    connecting: bool,
    /// The account the host may borrow, as the App last saw it.
    account: Account,
    pub status: Option<HostStatus>,
    /// Shares and stops the host reported, by root (`markWorkspaceShared`).
    pub marks: Vec<(PathBuf, Option<String>)>,
    /// The person last signed in here, once known.
    last_user: Option<Option<String>>,
    /// The host's state, beside the App's.
    dir: PathBuf,
}

struct Service(Entity<HostLink>);
impl Global for Service {}
pub fn global(cx: &mut App) -> Entity<HostLink> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    let link = cx.new(|_| HostLink {
        peer: None,
        connecting: false,
        account: Arc::default(),
        status: None,
        marks: Vec::new(),
        last_user: None,
        // Tests bring a host of their own, never this user's.
        dir: if cfg!(test) {
            std::env::temp_dir().join(format!("puppyone-no-host-{}", std::process::id()))
        } else {
            state_dir(&crate::platform::data_dir())
        },
    });
    cx.set_global(Service(link.clone()));
    link
}
pub fn read(cx: &App) -> Option<&HostLink> {
    cx.try_global::<Service>().map(|s| s.0.read(cx))
}

/// `registerHostIpcHandlers` with the release gate closed: a host an
/// earlier build left running is paused, its executions stopped and then
/// shut down, without starting one, deleting registrations or touching
/// files.
pub fn suspend_leftover(cx: &App) {
    if crate::workspace::hosts::AVAILABLE || cfg!(test) {
        return;
    }
    let dir = state_dir(&crate::platform::data_dir());
    cx.background_executor()
        .spawn(async move {
            runtime().block_on(async move {
                let unavailable: Handler = Arc::new(|_, _| {
                    Box::pin(async { Err("Other computers is unavailable in this build.".into()) })
                });
                let Ok(peer) =
                    control::connect(&dir, "desktop", unavailable, Arc::new(|_, _| {}), || {})
                        .await
                else {
                    return;
                };
                let paused = peer.call("setPaused", json!({"paused": true})).await;
                let stopped = peer.call("execStopAll", json!({})).await;
                let shut = peer.call("shutdown", json!({})).await;
                if let Some(error) = [paused, stopped, shut].into_iter().find_map(Result::err) {
                    eprintln!("Unable to suspend Host during rollout: {error}");
                }
            })
        })
        .detach();
}

/// What the host asks of the App: who is signed in (never a credential),
/// and its own routes, as that person.
fn desktop(account: Account) -> Handler {
    Arc::new(move |method, params| {
        let account = account.lock().unwrap().clone();
        Box::pin(async move {
            let Some((broker, binding)) = account else {
                return match method.as_str() {
                    "session" => Ok(Value::Null),
                    _ => Err("Sign in before changing what this computer shares.".into()),
                };
            };
            match method.as_str() {
                "session" => Ok(json!({
                    "user_id": binding.user,
                    "session_generation": format!("{}:{}", binding.instance, binding.epoch),
                    "api_base_url": binding.environment.api(),
                })),
                "api" => {
                    let route = params["route"].as_str().unwrap_or_default().to_owned();
                    let method = params["init"]["method"]
                        .as_str()
                        .unwrap_or("GET")
                        .to_owned();
                    if !crate::workspace::hosts::service::is_host_route(&route) {
                        return Err("This request is not available to the host service.".into());
                    }
                    let method = reqwest::Method::from_bytes(method.as_bytes())
                        .ok()
                        .filter(|m| ["GET", "POST", "PATCH", "DELETE"].contains(&m.as_str()))
                        .ok_or("This request is not available to the host service.")?;
                    let request = ApiRequest {
                        idempotency_key: None,
                        method,
                        path: route,
                        query: vec![],
                        body: Some(params["init"]["body"].clone()).filter(|b| !b.is_null()),
                    };
                    tokio::task::spawn_blocking(move || {
                        broker
                            .request_scoped(&binding, &request, &Cancellation::default())
                            .map_err(|e| format!("{e:?}"))
                    })
                    .await
                    .map_err(|e| e.to_string())?
                }
                _ => Err("Unknown method.".into()),
            }
        })
    })
}

impl HostLink {
    /// The account changed: the host borrows this one now. Signing out or
    /// another person stops sharing; a new session for the same person does not.
    pub fn sync_account(&mut self, cx: &mut Context<Self>) {
        let next = crate::features::cloud::account::broker_and_binding(cx);
        let user = next.as_ref().map(|(_, b)| b.user.clone());
        *self.account.lock().unwrap() = next;
        let previous = self.last_user.replace(user.clone());
        if previous.is_none() || previous.as_ref() == Some(&user) {
            return;
        }
        let sharing_for = self
            .status
            .as_ref()
            .and_then(|s| s.active.as_ref())
            .map(|a| a.account_id.clone());
        if sharing_for.is_some() && sharing_for != user {
            self.call("stopSharing", json!({}), cx, |s, _, cx| s.refresh(cx));
        }
    }
    /// Finds the host (starting it when `start`) and tells it its Cloud.
    pub fn ensure(&mut self, start: bool, cx: &mut Context<Self>) {
        if self.peer.as_ref().is_some_and(|p| !p.is_closed()) || self.connecting {
            return;
        }
        let Some(api) =
            crate::features::cloud::account::environment(cx).map(|e| e.api().to_owned())
        else {
            return;
        };
        // A computer that shares something restarts its host when the App opens.
        let start = start || crate::workspace::hosts::service::HostService::has_state(&self.dir);
        if !start {
            return;
        }
        self.sync_account(cx);
        self.connecting = true;
        let state = self.dir.clone();
        let account = self.account.clone();
        // The host's events arrive on its runtime; the App reads them here.
        let (sender, received) = async_channel::unbounded::<(String, Value)>();
        let events: control::Events = Arc::new(move |event, data| {
            let _ = sender.try_send((event, data));
        });
        cx.spawn(async move |this, cx| {
            while let Ok((event, data)) = received.recv().await {
                if this.update(cx, |s, cx| s.event(&event, data, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        let task = cx.background_executor().spawn(async move {
            runtime().block_on(async move {
                let path = state;
                let connect = || {
                    control::connect(
                        &path,
                        "desktop",
                        desktop(account.clone()),
                        events.clone(),
                        || {},
                    )
                };
                let peer = match connect().await {
                    Ok(peer) => peer,
                    Err(_) if start && !cfg!(test) => {
                        let program = std::env::current_exe().map_err(|e| e.to_string())?;
                        std::process::Command::new(program)
                            .arg(HOST_ARGUMENT)
                            .stdin(std::process::Stdio::null())
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .spawn()
                            .map_err(|e| e.to_string())?;
                        let mut found = None;
                        for _ in 0..100 {
                            tokio::time::sleep(Duration::from_millis(150)).await;
                            if let Ok(peer) = connect().await {
                                found = Some(peer);
                                break;
                            }
                        }
                        found.ok_or("PuppyOne Host did not start.")?
                    }
                    Err(error) => return Err(error),
                };
                peer.call("configure", json!({"apiBase": api})).await?;
                let status = peer.call("status", json!({})).await?;
                Ok::<_, String>((peer, status))
            })
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                s.connecting = false;
                if let Ok((peer, status)) = result {
                    s.peer = Some(peer);
                    s.status = serde_json::from_value(status).ok();
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn event(&mut self, event: &str, data: Value, cx: &mut Context<Self>) {
        match event {
            "status" => {
                // A status event carries no folder list; keep the last one.
                let folders = self.status.as_ref().map(|s| s.folders.clone());
                if let Ok(mut status) = serde_json::from_value::<HostStatus>(data) {
                    if status.folders.is_empty()
                        && let Some(folders) = folders
                    {
                        status.folders = folders;
                    }
                    self.status = Some(status);
                }
                self.refresh(cx);
            }
            "revoked" => {
                for root in data["roots"].as_array().into_iter().flatten() {
                    if let Some(root) = root.as_str() {
                        self.marks.push((PathBuf::from(root), None));
                    }
                }
                self.refresh(cx);
            }
            _ => {}
        }
        cx.notify();
    }
    /// One call to the host; `done` sees its answer here.
    pub fn call(
        &mut self,
        method: &'static str,
        params: Value,
        cx: &mut Context<Self>,
        done: impl FnOnce(&mut Self, Result<Value, String>, &mut Context<Self>) + 'static,
    ) {
        let Some(peer) = self.peer.clone().filter(|p| !p.is_closed()) else {
            done(self, Err("PuppyOne Host is unavailable.".into()), cx);
            return;
        };
        let task = cx
            .background_executor()
            .spawn(async move { runtime().block_on(peer.call(method, params)) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                done(s, result, cx);
                cx.notify();
            });
        })
        .detach();
    }
    /// Reads the host's status again (with its folders).
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        self.call("status", json!({}), cx, |s, result, _| {
            if let Ok(status) =
                result.and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string()))
            {
                s.status = Some(status);
            }
        });
    }
    /// This computer's id once it shares, for the signed-in account.
    pub fn device_for(&self, account: &str) -> Option<String> {
        let status = self.status.as_ref()?;
        (status.active.as_ref()?.account_id == account)
            .then(|| status.device_id.clone())
            .flatten()
            .or_else(|| status.active.as_ref().map(|a| a.device_id.clone()))
    }
    pub fn take_marks(&mut self) -> Vec<(PathBuf, Option<String>)> {
        std::mem::take(&mut self.marks)
    }

    // --------------------------------------------------------- changes
    /// `host:register-folder` after the person allowed it: this computer
    /// registers (once), the folder is registered, and sharing starts.
    pub fn share(
        &mut self,
        root: PathBuf,
        writable: bool,
        cx: &mut Context<Self>,
        done: impl FnOnce(&mut Self, Result<String, String>, &mut Context<Self>) + 'static,
    ) {
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let computer = hostname();
        let platform = crate::workspace::hosts::service::platform();
        self.call(
            "identityRegister",
            json!({"name": computer, "platform": platform}),
            cx,
            move |s, owner, cx| {
                let owner = match owner {
                    Ok(owner) => owner,
                    Err(error) => return done(s, Err(error), cx),
                };
                let device = owner["deviceId"].as_str().unwrap_or_default().to_owned();
                s.call(
                    "registryRegister",
                    json!({"deviceId": device, "rootPath": root, "name": name, "writable": writable}),
                    cx,
                    move |s, registered, cx| {
                        let folder = match registered {
                            Ok(r) => r["folderId"].as_str().unwrap_or_default().to_owned(),
                            Err(error) => return done(s, Err(error), cx),
                        };
                        s.marks.push((root, Some(folder.clone())));
                        // A transport failure retries inside the host.
                        s.call("connect", owner, cx, |s, _, cx| s.refresh(cx));
                        done(s, Ok(folder), cx);
                    },
                );
            },
        );
    }
    /// `host:remove-folder` after the person agreed.
    pub fn stop(
        &mut self,
        folder: String,
        cx: &mut Context<Self>,
        done: impl FnOnce(&mut Self, Result<(), String>, &mut Context<Self>) + 'static,
    ) {
        let Some(device) = self.status.as_ref().and_then(|s| {
            s.device_id
                .clone()
                .or(s.active.as_ref().map(|a| a.device_id.clone()))
        }) else {
            return done(
                self,
                Err("This folder is not shared from this computer.".into()),
                cx,
            );
        };
        let root = self
            .status
            .as_ref()
            .and_then(|s| s.folders.iter().find(|f| f.folder_id == folder))
            .map(|f| f.root_path.clone());
        self.call(
            "registryRemove",
            json!({"deviceId": device, "folderId": folder}),
            cx,
            move |s, result, cx| {
                if result.is_ok()
                    && let Some(root) = root
                {
                    s.marks.push((root, None));
                }
                s.refresh(cx);
                done(s, result.map(|_| ()), cx);
            },
        );
    }
    /// `host:update-folder` (editing) and `host:set-execution`: narrow here
    /// before the Cloud hears, widen here only after it agreed.
    pub fn set_access(
        &mut self,
        folder: &SharedFolder,
        writable: bool,
        execution: Execution,
        cx: &mut Context<Self>,
        done: impl FnOnce(&mut Self, Result<(), String>, &mut Context<Self>) + 'static,
    ) {
        let Some(owner) = self.status.as_ref().and_then(|s| s.active.clone()) else {
            return done(
                self,
                Err("This folder is not shared from this computer.".into()),
                cx,
            );
        };
        let execution = if writable {
            execution
        } else {
            Execution::default()
        };
        let widening = (writable && !folder.writable)
            || (execution.terminal && !folder.execution.terminal)
            || (execution.git && !folder.execution.git)
            || (execution.agent && !folder.execution.agent);
        let account = self.account.lock().unwrap().clone();
        let local = json!({"accountId": owner.account_id, "deviceId": owner.device_id,
            "folderId": folder.folder_id, "name": folder.name, "writable": writable,
            "terminal": execution.terminal, "git": execution.git, "agent": execution.agent});
        let route = format!(
            "/hosts/devices/{}/folders/{}",
            owner.device_id, folder.folder_id
        );
        let body = json!({"name": folder.name, "writable": writable,
            "terminal": execution.terminal, "git": execution.git, "agent": execution.agent});
        let (device, id) = (owner.device_id.clone(), folder.folder_id.clone());
        let cloud = move || -> Result<(), String> {
            let (broker, binding) =
                account.ok_or("Sign in before changing what this computer shares.")?;
            let request = |method: reqwest::Method, path: String, body: Option<Value>| ApiRequest {
                idempotency_key: None,
                method,
                path,
                query: vec![],
                body,
            };
            let failed = |e: crate::cloud::auth::Error| format!("{e:?}");
            // The change is for the folder as the Cloud has it now.
            let catalog = broker
                .request_scoped(
                    &binding,
                    &request(reqwest::Method::GET, "/hosts".into(), None),
                    &Cancellation::default(),
                )
                .map_err(failed)?;
            let revision = crate::workspace::hosts::remote::parse_catalog(&catalog)
                .map_err(|e| e.code)?
                .into_iter()
                .find(|d| d.id == device)
                .and_then(|d| d.folders.into_iter().find(|f| f.id == id))
                .map(|f| f.revision)
                .ok_or("This folder is no longer available from that computer.")?;
            let mut body = body;
            body["expected_revision"] = revision.into();
            broker
                .request_scoped(
                    &binding,
                    &request(reqwest::Method::PATCH, route, Some(body)),
                    &Cancellation::default(),
                )
                .map(|_| ())
                .map_err(failed)
        };
        type Then = Box<dyn FnOnce(&mut HostLink, Result<(), String>, &mut Context<HostLink>)>;
        let apply = move |s: &mut Self, cx: &mut Context<Self>, then: Then| {
            let execution_local = local.clone();
            s.call(
                "registrySetAccess",
                local.clone(),
                cx,
                move |s, result, cx| {
                    if let Err(error) = result {
                        return then(s, Err(error), cx);
                    }
                    s.call(
                        "registrySetExecution",
                        execution_local,
                        cx,
                        move |s, result, cx| {
                            s.refresh(cx);
                            then(s, result.map(|_| ()), cx);
                        },
                    );
                },
            );
        };
        let task = cx.background_executor().spawn(async move { cloud() });
        if widening {
            // The Cloud first: if it refuses, nothing was allowed here either.
            cx.spawn(async move |this, cx| {
                let agreed = task.await;
                let _ = this.update(cx, |s, cx| match agreed {
                    Ok(()) => apply(s, cx, Box::new(done)),
                    Err(error) => done(s, Err(error), cx),
                });
            })
            .detach();
        } else {
            apply(
                self,
                cx,
                Box::new(move |s, local, cx| {
                    cx.spawn(async move |this, cx| {
                        let told = task.await;
                        let _ = this.update(cx, |s, cx| done(s, local.and(told), cx));
                    })
                    .detach();
                    let _ = s;
                }),
            );
        }
    }
    /// Tests: a host of their own.
    #[cfg(test)]
    pub fn use_dir(&mut self, dir: PathBuf) {
        self.dir = dir;
    }
    pub fn set_paused(&mut self, paused: bool, cx: &mut Context<Self>) {
        self.call("setPaused", json!({"paused": paused}), cx, |s, _, cx| {
            s.refresh(cx)
        });
    }
}

/// This computer's name, as the owner's other computers see it.
fn hostname() -> String {
    let mut buffer = [0u8; 256];
    #[cfg(unix)]
    unsafe {
        if libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) == 0 {
            let end = buffer.iter().position(|b| *b == 0).unwrap_or(buffer.len());
            let name = String::from_utf8_lossy(&buffer[..end]).into_owned();
            let name = name.trim_end_matches(".local").to_owned();
            if !name.is_empty() {
                return name.chars().take(120).collect();
            }
        }
    }
    "Computer".into()
}
