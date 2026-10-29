//! `useHomepageCloudProjects`: the shared account catalog for the Homepage
//! and Header project menu. Loads automatically when Cloud is enabled and an
//! account is signed in; account/session changes revalidate it; failures
//! keep local rows usable and offer Retry. Activity dates enrich the rows
//! with at most four concurrent single-commit history reads.
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
    epoch: u64,
    loaded_for: Option<(String, u64)>,
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
        epoch: 0,
        loaded_for: None,
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
                    Some(CloudEntry {
                        id: p["id"].as_str()?.to_owned(),
                        name: p["name"].as_str().unwrap_or("Project").to_owned(),
                        updated: parse_time(&p["updated_at"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

impl CloudCatalog {
    /// Loads for the current account once; `retry` forces a reload.
    pub fn ensure(&mut self, enabled: bool, retry: bool, cx: &mut Context<Self>) {
        let Some((broker, binding)) =
            crate::features::cloud_account::broker_and_binding(cx).filter(|_| enabled)
        else {
            if self.state != State::Idle {
                self.state = State::Idle;
                self.loaded_for = None;
                cx.notify();
            }
            return;
        };
        let key = (binding.user.clone(), binding.epoch);
        if !retry && self.loaded_for.as_ref() == Some(&key) {
            return;
        }
        self.loaded_for = Some(key);
        self.epoch += 1;
        let epoch = self.epoch;
        self.state = State::Loading;
        cx.notify();
        let request = ApiRequest {
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
                        c.enrich(&projects, broker, binding, epoch, cx);
                        c.state = State::Ready(projects);
                    }
                    Err(_) => c.state = State::Failed,
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
        for chunk in ids.chunks(ids.len().div_ceil(ACTIVITY_CONCURRENCY).max(1)) {
            let chunk = chunk.to_vec();
            let (broker, binding) = (broker.clone(), binding.clone());
            let task = cx.background_executor().spawn(async move {
                chunk
                    .into_iter()
                    .filter_map(|id| {
                        let request = ApiRequest {
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
                        c.activity.extend(found);
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
