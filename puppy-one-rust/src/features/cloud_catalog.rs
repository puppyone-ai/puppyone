//! `useHomepageCloudProjects`: the shared account catalog for the Homepage
//! and Header project menu. Loads automatically when Cloud is enabled and an
//! account is signed in; account/session changes revalidate it; failures
//! keep local rows usable and offer Retry. Activity dates enrich the rows
//! with at most four concurrent single-commit history reads.
//!
//! `homepageCloudCatalogCache` / `homepageCloudActivity`: the list (and the
//! dates) an account last saw stand in until its fresh catalog answers, so a
//! Homepage can appear whole at once. They prove nothing (every Cloud open is
//! still authorized), are never used offline, and signing out removes them.
use crate::{
    cloud_auth::model::ApiRequest,
    workspace::cloud::catalog::{ACTIVITY_CONCURRENCY, CloudEntry},
};
use gpui::*;
use reqwest::Method;
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub enum State {
    Idle,
    Loading,
    Ready(Vec<CloudEntry>),
    Failed,
}
pub struct CloudCatalog {
    pub state: State,
    pub activity: HashMap<String, i64>,
    /// This session's own listing and history have arrived, so the order is
    /// the real one (`fresh`).
    pub fresh: bool,
    epoch: u64,
    loaded_for: Option<(String, u64)>,
    /// Where the account's last list is kept; none in tests unless given.
    pub cache_dir: Option<std::path::PathBuf>,
    /// History reads still on their way for this listing.
    enriching: usize,
}

/// `puppyone.desktop.cloud-project-catalog.v1` and
/// `…cloud-project-activity.v1`, keyed by `[api, user]`.
mod cache {
    use super::CloudEntry;
    use serde_json::{Value, json};
    use std::{collections::HashMap, path::Path};

    const CATALOG: &str = "cloud-project-catalog.v1.json";
    const ACTIVITY: &str = "cloud-project-activity.v1.json";

    fn read(dir: &Path, name: &str, scope: &str) -> Option<Value> {
        let bytes = std::fs::read(dir.join(name)).ok()?;
        let value: Value = serde_json::from_slice(&bytes).ok()?;
        (value["scope"].as_str() == Some(scope)).then_some(value)
    }
    fn write(dir: &Path, name: &str, value: &Value) {
        // Without the cache the next launch waits for the catalog.
        if std::fs::create_dir_all(dir).is_ok()
            && let Ok(bytes) = serde_json::to_vec(value)
        {
            let _ = std::fs::write(dir.join(name), bytes);
        }
    }
    pub fn catalog(dir: &Path, scope: &str) -> Option<Vec<CloudEntry>> {
        let value = read(dir, CATALOG, scope)?;
        Some(
            value["projects"]
                .as_array()?
                .iter()
                .filter_map(|p| {
                    Some(CloudEntry {
                        id: p["id"].as_str()?.to_owned(),
                        name: p["name"].as_str()?.to_owned(),
                        updated: p["updated"].as_i64(),
                        can_rename: p["can_rename"].as_bool().unwrap_or(false),
                        can_delete: p["can_delete"].as_bool().unwrap_or(false),
                    })
                })
                .collect(),
        )
    }
    pub fn activity(dir: &Path, scope: &str) -> Option<HashMap<String, i64>> {
        let value = read(dir, ACTIVITY, scope)?;
        Some(
            value["activity"]
                .as_object()?
                .iter()
                .filter_map(|(id, at)| Some((id.clone(), at.as_i64()?)))
                .collect(),
        )
    }
    pub fn write_catalog(dir: &Path, scope: &str, entries: &[CloudEntry]) {
        let projects: Vec<Value> = entries
            .iter()
            .map(|e| {
                json!({"id": e.id, "name": e.name, "updated": e.updated,
                    "can_rename": e.can_rename, "can_delete": e.can_delete})
            })
            .collect();
        write(dir, CATALOG, &json!({"scope": scope, "projects": projects}));
    }
    pub fn write_activity(dir: &Path, scope: &str, activity: &HashMap<String, i64>) {
        write(
            dir,
            ACTIVITY,
            &json!({"scope": scope, "activity": activity}),
        );
    }
    pub fn clear(dir: &Path) {
        for name in [CATALOG, ACTIVITY] {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
}
struct Service(Entity<CloudCatalog>);
impl Global for Service {}

pub fn global(cx: &mut App) -> Entity<CloudCatalog> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    let catalog = cx.new(|_| CloudCatalog {
        state: State::Idle,
        activity: HashMap::new(),
        fresh: false,
        epoch: 0,
        loaded_for: None,
        cache_dir: (!cfg!(test)).then(|| crate::platform::data_dir().join("cloud")),
        enriching: 0,
    });
    cx.set_global(Service(catalog.clone()));
    catalog
}

fn parse_time(value: &serde_json::Value) -> Option<i64> {
    let text = value.as_str()?;
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|t| t.timestamp_millis())
}
/// `GET /projects/` envelope `{code, data: [...]}` to catalog entries.
pub fn parse_projects(value: &serde_json::Value) -> Vec<CloudEntry> {
    value["data"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|p| {
                    // `projectAllows`: a capability the server listed.
                    let allows = |capability: &str| {
                        p["capabilities"]
                            .as_array()
                            .is_some_and(|c| c.iter().any(|v| v.as_str() == Some(capability)))
                    };
                    Some(CloudEntry {
                        id: p["id"].as_str()?.to_owned(),
                        name: p["name"].as_str().unwrap_or("Project").to_owned(),
                        updated: parse_time(&p["updated_at"]),
                        can_rename: allows("project.settings.manage"),
                        can_delete: allows("project.delete"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

impl CloudCatalog {
    /// A new launch's catalog: nothing loaded for any account yet.
    #[cfg(test)]
    pub fn forget(&mut self) {
        self.state = State::Idle;
        self.activity.clear();
        self.loaded_for = None;
        self.fresh = false;
    }
    /// The account scope of the cache (`[api, user]`, across sessions).
    fn scope(cx: &App) -> Option<String> {
        let (_, binding) = crate::features::cloud_account::broker_and_binding(cx)?;
        Some(serde_json::json!([binding.environment.api(), binding.user]).to_string())
    }
    /// `applyChange`: the change also reaches the cached list.
    fn cache_change(&self, cx: &App) {
        if let (Some(dir), Some(scope), State::Ready(entries)) =
            (&self.cache_dir, Self::scope(cx), &self.state)
        {
            cache::write_catalog(dir, &scope, entries);
        }
    }
    /// `renameProject`'s effect on the list: the entry takes its new name,
    /// then the catalog reloads (dropping a listing still in flight).
    pub fn apply_rename(&mut self, id: &str, name: &str, cx: &mut Context<Self>) {
        if let State::Ready(entries) = &mut self.state
            && let Some(entry) = entries.iter_mut().find(|e| e.id == id)
        {
            entry.name = name.to_owned();
        }
        self.cache_change(cx);
        self.reload(cx);
    }
    /// `deleteProject`'s effect: the entry leaves, then the catalog reloads.
    pub fn apply_delete(&mut self, id: &str, cx: &mut Context<Self>) {
        if let State::Ready(entries) = &mut self.state {
            entries.retain(|e| e.id != id);
        }
        self.activity.remove(id);
        self.cache_change(cx);
        self.reload(cx);
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        cx.notify();
        if self.loaded_for.is_some() {
            // `setReload`: the same account lists again, keeping the
            // changed entries on screen meanwhile.
            let shown = self.state.clone();
            self.loaded_for = None;
            self.ensure(true, true, cx);
            if let State::Loading = self.state {
                self.state = shown;
            }
        }
    }
    /// Loads for the current account once; `retry` forces a reload.
    pub fn ensure(&mut self, enabled: bool, retry: bool, cx: &mut Context<Self>) {
        let Some((broker, binding)) =
            crate::features::cloud_account::broker_and_binding(cx).filter(|_| enabled)
        else {
            // Signed out (not merely restoring): the names leave with it.
            if enabled
                && crate::features::cloud_account::status(cx)
                    == Some(crate::cloud_auth::Status::SignedOut)
                && let Some(dir) = &self.cache_dir
            {
                cache::clear(dir);
            }
            if self.state != State::Idle {
                self.state = State::Idle;
                self.loaded_for = None;
                self.fresh = false;
                cx.notify();
            }
            return;
        };
        let key = (binding.user.clone(), binding.epoch);
        if !retry && self.loaded_for.as_ref() == Some(&key) {
            return;
        }
        let own = self.loaded_for.as_ref().map(|(user, _)| user) == Some(&key.0);
        self.loaded_for = Some(key);
        self.epoch += 1;
        let epoch = self.epoch;
        self.fresh = false;
        // `beginLoading`: revalidating never empties the list, and an
        // account's cached list stands in for its first answer (never
        // offline, where the listing cannot answer).
        let offline =
            crate::features::cloud_account::status(cx) == Some(crate::cloud_auth::Status::Offline);
        let scope = Self::scope(cx);
        let cached = (!own && !offline)
            .then(|| self.cache_dir.as_deref().zip(scope.as_deref()))
            .flatten()
            .and_then(|(dir, scope)| {
                Some((
                    cache::catalog(dir, scope)?,
                    cache::activity(dir, scope).unwrap_or_default(),
                ))
            });
        if !(own && matches!(self.state, State::Ready(_))) {
            match cached {
                Some((entries, activity)) => {
                    self.state = State::Ready(entries);
                    self.activity = activity;
                }
                None => self.state = State::Loading,
            }
        }
        cx.notify();
        let request = ApiRequest {
            idempotency_key: None,
            method: Method::GET,
            path: "/projects/".into(),
            query: vec![("include_access_counts".into(), "false".into())],
            body: None,
        };
        let (b, bind) = (broker.clone(), binding.clone());
        let task = cx
            .background_executor()
            .spawn(async move { b.request(&bind, &request).map(|v| parse_projects(&v)) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |c, cx| {
                if c.epoch != epoch {
                    return;
                }
                match result {
                    Ok(projects) => {
                        if let (Some(dir), Some(scope)) = (&c.cache_dir, Self::scope(cx)) {
                            cache::write_catalog(dir, &scope, &projects);
                        }
                        // A project the fresh list no longer has loses its
                        // cached date with it.
                        c.activity
                            .retain(|id, _| projects.iter().any(|p| &p.id == id));
                        c.enrich(&projects, broker, binding, epoch, cx);
                        c.state = State::Ready(projects);
                    }
                    // A failed revalidation never presents a stale list.
                    Err(_) => {
                        c.state = State::Failed;
                        c.fresh = true;
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
    /// `loadCloudProjectActivity`: newest commit time, bounded concurrency;
    /// failures keep the Project metadata time.
    fn enrich(
        &mut self,
        projects: &[CloudEntry],
        broker: std::sync::Arc<crate::cloud_auth::Broker>,
        binding: crate::cloud_auth::model::Binding,
        epoch: u64,
        cx: &mut Context<Self>,
    ) {
        let ids: Vec<String> = projects.iter().map(|p| p.id.clone()).collect();
        let chunks: Vec<Vec<String>> = ids
            .chunks(ids.len().div_ceil(ACTIVITY_CONCURRENCY).max(1))
            .map(<[String]>::to_vec)
            .collect();
        self.enriching = chunks.len();
        if chunks.is_empty() {
            self.fresh = true;
        }
        for chunk in chunks {
            let (broker, binding) = (broker.clone(), binding.clone());
            let task = cx.background_executor().spawn(async move {
                chunk
                    .into_iter()
                    .filter_map(|id| {
                        let request = ApiRequest {
                            idempotency_key: None,
                            method: Method::GET,
                            path: format!("/content/{id}/commits"),
                            query: vec![
                                ("limit".into(), "1".into()),
                                ("order".into(), "topo".into()),
                            ],
                            body: None,
                        };
                        let value = broker.request(&binding, &request).ok()?;
                        let commits = value["data"]["commits"]
                            .as_array()
                            .or(value["data"].as_array())?;
                        let time = commits
                            .iter()
                            .filter_map(|c| parse_time(&c["created_at"]))
                            .max()?;
                        Some((id, time))
                    })
                    .collect::<Vec<_>>()
            });
            cx.spawn(async move |this, cx| {
                let found = task.await;
                let _ = this.update(cx, |c, cx| {
                    if c.epoch == epoch {
                        // A failed history read keeps the project's last
                        // known date, so it does not move.
                        c.activity.extend(found);
                        c.enriching = c.enriching.saturating_sub(1);
                        if c.enriching == 0 {
                            c.fresh = true;
                            if let (Some(dir), Some(scope)) = (&c.cache_dir, Self::scope(cx)) {
                                cache::write_activity(dir, &scope, &c.activity);
                            }
                        }
                        cx.notify();
                    }
                });
            })
            .detach();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_project_envelope_parses_into_catalog_entries() {
        let value = serde_json::json!({"code":0,"data":[
            {"id":"p1","name":"Docs","updated_at":"2026-10-01T10:00:00Z"},
            {"id":"p2","name":"NoTime"},
            {"name":"missing id"}
        ]});
        let entries = parse_projects(&value);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "p1");
        assert!(entries[0].updated.is_some());
        assert_eq!(entries[1].updated, None);
        assert!(parse_projects(&serde_json::json!({"code":0})).is_empty());
    }
}
