//! `useCloudSpaces` with `homepageCloudCatalogCache`'s spaces: the spaces
//! of the signed-in account, which decide each Cloud project's Homepage
//! group. Read for one account, deployment and session generation; a late
//! answer for another is dropped. The spaces an account last saw stand in
//! until it answers (names only; signing out removes them), and a failed
//! read keeps what the account already answered.
use crate::workspace::cloud::spaces::{self, Kind, Space};
use gpui::*;

/// `status` of `useCloudSpaces`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    SignedOut,
    Loading,
    Ready,
    Error,
}

pub struct CloudSpaces {
    /// `[api, user, generation]` of the session read for.
    authority: Option<String>,
    /// What that authority answered, and whether the last read failed.
    own: Option<(String, Vec<Space>, bool)>,
    /// `[api, user]`'s spaces as the account last saw them.
    cached: Option<(String, Vec<Space>)>,
    epoch: u64,
    /// The authority a read is on its way for.
    reading: Option<String>,
    /// Where the account's last spaces are kept; none in tests unless given.
    pub cache_dir: Option<std::path::PathBuf>,
}

mod cache {
    use super::{Kind, Space};
    use serde_json::{Value, json};
    use std::path::Path;

    const FILE: &str = "cloud-spaces.v1.json";

    pub fn read(dir: &Path, scope: &str) -> Option<Vec<Space>> {
        let value: Value = serde_json::from_slice(&std::fs::read(dir.join(FILE)).ok()?).ok()?;
        if value["scope"].as_str() != Some(scope) {
            return None;
        }
        Some(
            value["spaces"]
                .as_array()?
                .iter()
                .filter_map(|s| {
                    Some(Space {
                        id: s["id"].as_str()?.to_owned(),
                        name: s["name"].as_str()?.to_owned(),
                        kind: match s["kind"].as_str()? {
                            "personal" => Kind::Personal,
                            "team" => Kind::Team,
                            _ => return None,
                        },
                        can_create_projects: s["canCreateProjects"].as_bool()?,
                    })
                })
                .collect(),
        )
    }
    pub fn write(dir: &Path, scope: &str, spaces: &[Space]) {
        let spaces: Vec<Value> = spaces
            .iter()
            .map(|s| {
                json!({"id": s.id, "name": s.name,
                    "kind": if s.kind == Kind::Personal { "personal" } else { "team" },
                    "canCreateProjects": s.can_create_projects})
            })
            .collect();
        // Without the cache the next launch waits for the spaces.
        if std::fs::create_dir_all(dir).is_ok()
            && let Ok(bytes) = serde_json::to_vec(&json!({"scope": scope, "spaces": spaces}))
        {
            let _ = std::fs::write(dir.join(FILE), bytes);
        }
    }
    pub fn clear(dir: &Path) {
        let _ = std::fs::remove_file(dir.join(FILE));
    }
}

struct Service(Entity<CloudSpaces>);
impl Global for Service {}

pub fn global(cx: &mut App) -> Entity<CloudSpaces> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    let spaces = cx.new(|_| CloudSpaces {
        authority: None,
        own: None,
        cached: None,
        epoch: 0,
        reading: None,
        cache_dir: (!cfg!(test)).then(|| crate::platform::data_dir().join("cloud")),
    });
    cx.set_global(Service(spaces.clone()));
    spaces
}

/// The spaces, when the service has been made.
pub fn read(cx: &App) -> Option<&CloudSpaces> {
    cx.try_global::<Service>().map(|s| s.0.read(cx))
}

impl CloudSpaces {
    /// `[api, user]`: the account, across its sessions.
    fn scope(binding: &crate::cloud::auth::model::Binding) -> String {
        serde_json::json!([binding.environment.api(), binding.user]).to_string()
    }
    /// Reads the spaces for the signed-in account once per authority while
    /// `enabled` and `visible`; `retry` reads again.
    pub fn ensure(&mut self, enabled: bool, visible: bool, retry: bool, cx: &mut Context<Self>) {
        let Some((broker, binding)) =
            crate::features::cloud::account::broker_and_binding(cx).filter(|_| enabled)
        else {
            if enabled
                && crate::features::cloud::account::status(cx)
                    == Some(crate::cloud::auth::Status::SignedOut)
                && let Some(dir) = &self.cache_dir
            {
                cache::clear(dir);
                self.cached = None;
            }
            if self.authority.take().is_some() {
                self.own = None;
                cx.notify();
            }
            return;
        };
        let authority =
            serde_json::json!([binding.environment.api(), binding.user, binding.epoch]).to_string();
        let scope = Self::scope(&binding);
        if self.cached.as_ref().map(|(s, _)| s) != Some(&scope) {
            self.cached = self
                .cache_dir
                .as_deref()
                .and_then(|dir| cache::read(dir, &scope))
                .map(|spaces| (scope.clone(), spaces));
        }
        let same = self.authority.as_ref() == Some(&authority);
        self.authority = Some(authority.clone());
        let answered = self.own.as_ref().is_some_and(|o| o.0 == authority);
        let asking = self.reading.as_ref() == Some(&authority);
        if !visible || (same && !retry && (answered || asking)) {
            if !same {
                cx.notify();
            }
            return;
        }
        self.reading = Some(authority.clone());
        self.epoch += 1;
        let epoch = self.epoch;
        let task = cx.background_executor().spawn(async move {
            let client = crate::workspace::cloud::services::Client::new(std::sync::Arc::new(
                crate::workspace::cloud::services::BrokerTransport {
                    broker,
                    binding,
                    cancel: Default::default(),
                },
            ));
            spaces::discover(&client)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch != epoch || s.authority.as_ref() != Some(&authority) {
                    return;
                }
                s.reading = None;
                match result {
                    Ok(spaces) => {
                        if let Some(dir) = &s.cache_dir {
                            cache::write(dir, &scope, &spaces);
                        }
                        s.cached = Some((scope, spaces.clone()));
                        s.own = Some((authority, spaces, false));
                    }
                    // Keep what this account already answered.
                    Err(_) => {
                        let kept = s
                            .own
                            .take()
                            .filter(|o| o.0 == authority)
                            .map(|o| o.1)
                            .unwrap_or_default();
                        s.own = Some((authority, kept, true));
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// The spaces to group by: this session's answer, else the account's
    /// last ones, else none.
    pub fn spaces(&self) -> &[Space] {
        let own = self
            .own
            .as_ref()
            .filter(|o| Some(&o.0) == self.authority.as_ref() && !o.1.is_empty());
        match (own, &self.cached) {
            (Some(own), _) => &own.1,
            (None, Some((_, cached))) if self.authority.is_some() => cached,
            _ => &[],
        }
    }
    pub fn status(&self) -> Status {
        if self.authority.is_none() {
            return Status::SignedOut;
        }
        match self
            .own
            .as_ref()
            .filter(|o| Some(&o.0) == self.authority.as_ref())
        {
            Some((_, _, true)) => Status::Error,
            Some(_) => Status::Ready,
            None if self.cached.is_some() => Status::Ready,
            None => Status::Loading,
        }
    }
    /// The session the spaces were read for (`authority`), which fixes a
    /// publication intent.
    pub fn authority(&self) -> Option<&str> {
        self.authority.as_deref()
    }
    /// The space with `id`, when it is one of these.
    pub fn space(&self, id: &str) -> Option<&Space> {
        self.spaces().iter().find(|s| s.id == id)
    }
}
