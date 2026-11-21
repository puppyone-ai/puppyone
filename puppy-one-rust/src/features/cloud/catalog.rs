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
    cloud::auth::model::ApiRequest,
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
                        org: p["org_id"].as_str().map(str::to_owned),
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
                json!({"id": e.id, "name": e.name, "org_id": e.org, "updated": e.updated,
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

/// The space holding `project`, as the account's catalog names it
/// (`ProjectHomeItem.cloudOrganizationId`).
pub fn owner_of(project: &str, cx: &App) -> Option<String> {
    let catalog = cx.try_global::<Service>()?.0.read(cx);
    match &catalog.state {
        State::Ready(entries) => entries
            .iter()
            .find(|entry| entry.id == project)
            .and_then(|entry| entry.org.clone()),
        _ => None,
    }
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
                        org: p["org_id"].as_str().map(str::to_owned),
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
        let (_, binding) = crate::features::cloud::account::broker_and_binding(cx)?;
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
            crate::features::cloud::account::broker_and_binding(cx).filter(|_| enabled)
        else {
            // Signed out (not merely restoring): the names leave with it.
            if enabled
                && crate::features::cloud::account::status(cx)
                    == Some(crate::cloud::auth::Status::SignedOut)
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
        let offline = crate::features::cloud::account::status(cx)
            == Some(crate::cloud::auth::Status::Offline);
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
        broker: std::sync::Arc<crate::cloud::auth::Broker>,
        binding: crate::cloud::auth::model::Binding,
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
    use crate::cloud::auth::Status;
    use core::prelude::v1::test;
    use serde_json::{Value, json};
    use std::{
        rc::Rc,
        sync::{Arc, Mutex},
    };

    /// The Cloud's answers, path by path; a path with no answer fails. The
    /// test scheduler runs requests on the test's own thread, so answers
    /// are given before the work runs, never awaited.
    #[derive(Default)]
    struct Script {
        answers: Mutex<HashMap<String, Value>>,
    }
    impl Script {
        fn answer(&self, path: &str, value: Option<Value>) {
            let mut answers = self.answers.lock().unwrap();
            match value {
                Some(value) => answers.insert(path.into(), value),
                None => answers.remove(path),
            };
        }
        fn responder(self: &Arc<Self>) -> crate::cloud::auth::Responder {
            let script = self.clone();
            Arc::new(move |request| {
                script
                    .answers
                    .lock()
                    .unwrap()
                    .get(&request.path)
                    .cloned()
                    .ok_or(crate::cloud::auth::Error::Unavailable)
            })
        }
    }
    const LISTING: &str = "/projects/";
    fn listing(ids: &[&str]) -> Value {
        json!({"code": 0, "data": ids.iter().map(|id| json!({
            "id": id, "name": format!("cloud-{id}"), "org_id": "org",
            "description": "private notes", "updated_at": "2026-05-01T00:00:00Z"
        })).collect::<Vec<_>>()})
    }
    fn history(date: &str) -> Value {
        json!({"code": 0, "data": {"commits": [{"created_at": date}]}})
    }
    fn commits(id: &str) -> String {
        format!("/content/{id}/commits")
    }
    struct Fixture {
        script: Arc<Script>,
        catalog: Entity<CloudCatalog>,
        broker: Arc<crate::cloud::auth::Broker>,
        dir: tempfile::TempDir,
    }
    fn fixture(cx: &mut TestAppContext) -> Fixture {
        cx.executor().allow_parking();
        let script = Arc::new(Script::default());
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(script.responder());
        let dir = tempfile::tempdir().unwrap();
        let catalog = cx.update(|cx| {
            crate::features::cloud::account::install_fixture(broker.clone(), browser, cx);
            global(cx)
        });
        settle(cx, crate::features::cloud::account::has_account);
        catalog.update(cx, |c, _| c.cache_dir = Some(dir.path().to_path_buf()));
        Fixture {
            script,
            catalog,
            broker,
            dir,
        }
    }
    #[track_caller]
    fn settle(cx: &mut TestAppContext, mut done: impl FnMut(&App) -> bool) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !cx.update(|cx| done(cx)) {
            cx.run_until_parked();
            assert!(
                std::time::Instant::now() < deadline,
                "the catalog did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }
    fn ids(f: &Fixture, cx: &mut TestAppContext) -> Option<Vec<String>> {
        f.catalog.read_with(cx, |c, _| match &c.state {
            State::Ready(entries) => Some(entries.iter().map(|e| e.id.clone()).collect()),
            _ => None,
        })
    }
    fn ensure(f: &Fixture, cx: &mut TestAppContext) {
        f.catalog.update(cx, |c, cx| c.ensure(true, false, cx));
    }
    fn set_status(status: Status, signed_in: bool, cx: &mut TestAppContext) {
        cx.update(|cx| {
            crate::features::cloud::account::account(cx)
                .unwrap()
                .update(cx, |a, cx| {
                    let snapshot = a.snapshot.as_mut().unwrap();
                    snapshot.status = status;
                    if !signed_in {
                        snapshot.account = None;
                    }
                    cx.notify();
                })
        });
    }

    /// `remembers only what the list and the Header's place need from the
    /// catalog`, `shows the list once, in final order`: a first listing
    /// keeps nothing on screen until it answers, its order is real only
    /// once every project's history has answered, and the account keeps
    /// the list (names, place and permissions only) and the dates.
    #[gpui::test]
    fn a_fresh_list_is_real_once_its_dates_arrive_and_is_kept_for_its_account(
        cx: &mut TestAppContext,
    ) {
        let f = fixture(cx);
        let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
        let _watch = cx.update(|cx| {
            let seen = seen.clone();
            cx.observe(&f.catalog, move |c, cx| {
                let c = c.read(cx);
                seen.borrow_mut().push((
                    matches!(c.state, State::Ready(_)),
                    c.fresh,
                    c.activity.len(),
                ));
            })
        });
        f.script.answer(LISTING, Some(listing(&["old", "new"])));
        f.script
            .answer(&commits("old"), Some(history("2026-10-01T00:00:00Z")));
        f.script
            .answer(&commits("new"), Some(history("2026-07-01T00:00:00Z")));
        ensure(&f, cx);
        f.catalog.read_with(cx, |c, _| {
            assert_eq!((&c.state, c.fresh), (&State::Loading, false))
        });
        settle(cx, |cx| f.catalog.read(cx).fresh);
        // Listed but not yet dated is never the real order.
        assert!(
            seen.borrow()
                .iter()
                .any(|&(ready, fresh, _)| ready && !fresh)
        );
        assert!(
            seen.borrow()
                .iter()
                .all(|&(_, fresh, dated)| !fresh || dated == 2)
        );
        let scope = cx.update(|cx| CloudCatalog::scope(cx)).unwrap();
        let stored: Value = serde_json::from_slice(
            &std::fs::read(f.dir.path().join("cloud-project-catalog.v1.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(stored["scope"], scope.as_str());
        assert_eq!(stored["projects"][0]["org_id"], "org");
        assert!(!stored.to_string().contains("private notes"));
        assert_eq!(cache::activity(f.dir.path(), &scope).unwrap().len(), 2);
    }

    /// `holds a returning account's list until its real order is known`,
    /// `never dates a project from another account's cache`, `holds again
    /// for another account`, `does not trust a cached list it cannot read`,
    /// `does not let unknown or malformed cache data hold or break the
    /// list`, `does not show a cached list offline`, `shows local projects
    /// at once when the Cloud listing fails`: an account's kept list stands
    /// in at once but is not the real order until its own listing and dates
    /// answer; a list kept for another account, or one that cannot be read,
    /// is never shown; offline nothing kept is shown, and a failed listing
    /// settles with no Cloud rows.
    #[gpui::test]
    fn a_kept_list_stands_in_only_for_its_own_account_online(cx: &mut TestAppContext) {
        let f = fixture(cx);
        let scope = cx.update(|cx| CloudCatalog::scope(cx)).unwrap();
        let entries = parse_projects(&listing(&["old", "new"]));
        cache::write_catalog(f.dir.path(), &scope, &entries);
        cache::write_activity(
            f.dir.path(),
            &scope,
            &HashMap::from([("old".into(), 1), ("new".into(), 2)]),
        );
        f.script.answer(LISTING, Some(listing(&["old", "new"])));
        f.script
            .answer(&commits("old"), Some(history("2026-10-01T00:00:00Z")));
        f.script
            .answer(&commits("new"), Some(history("2026-07-01T00:00:00Z")));
        ensure(&f, cx);
        assert_eq!(ids(&f, cx), Some(vec!["old".into(), "new".into()]));
        f.catalog.read_with(cx, |c, _| {
            assert!(!c.fresh);
            assert_eq!(c.activity.len(), 2);
        });
        settle(cx, |cx| f.catalog.read(cx).fresh);
        // Another account's list, or one that cannot be read, never shows.
        let bob = serde_json::json!([serde_json::from_str::<Value>(&scope).unwrap()[0], "bob"])
            .to_string();
        for (scope, bytes) in [(Some(bob.as_str()), None), (None, Some(&b"{"[..]))] {
            f.catalog.update(cx, |c, _| c.forget());
            match (scope, bytes) {
                (Some(scope), _) => cache::write_catalog(f.dir.path(), scope, &entries),
                (_, Some(bytes)) => {
                    std::fs::write(f.dir.path().join("cloud-project-catalog.v1.json"), bytes)
                        .unwrap()
                }
                _ => unreachable!(),
            }
            f.script.answer(LISTING, Some(listing(&[])));
            ensure(&f, cx);
            f.catalog
                .read_with(cx, |c, _| assert_eq!(c.state, State::Loading));
            settle(cx, |cx| f.catalog.read(cx).fresh);
        }
        // Offline: nothing kept shows, and the failed listing settles.
        cache::write_catalog(f.dir.path(), &scope, &entries);
        f.catalog.update(cx, |c, _| c.forget());
        set_status(Status::Offline, true, cx);
        f.script.answer(LISTING, None);
        ensure(&f, cx);
        f.catalog
            .read_with(cx, |c, _| assert_eq!(c.state, State::Loading));
        settle(cx, |cx| f.catalog.read(cx).fresh);
        f.catalog
            .read_with(cx, |c, _| assert_eq!(c.state, State::Failed));
    }

    /// `keeps a project's last known date when its history read fails`,
    /// `keeps cached dates across a new session generation`, `keeps the
    /// list through a new session generation of one account`, `takes rows
    /// the fresh list adds or removes, without emptying the list`: a failed
    /// history read keeps the date the project had; a new sign-in of the
    /// same account keeps its list on screen while it lists again; a fresh
    /// list takes and drops rows, and the kept list follows it.
    #[gpui::test]
    fn known_dates_and_rows_survive_failures_and_a_new_session(cx: &mut TestAppContext) {
        let f = fixture(cx);
        let scope = cx.update(|cx| CloudCatalog::scope(cx)).unwrap();
        cache::write_catalog(
            f.dir.path(),
            &scope,
            &parse_projects(&listing(&["old", "new"])),
        );
        cache::write_activity(
            f.dir.path(),
            &scope,
            &HashMap::from([("old".into(), 1_000), ("new".into(), 2_000)]),
        );
        f.script.answer(LISTING, Some(listing(&["old", "new"])));
        f.script
            .answer(&commits("new"), Some(history("2026-07-01T00:00:00Z")));
        ensure(&f, cx);
        settle(cx, |cx| f.catalog.read(cx).fresh);
        f.catalog
            .read_with(cx, |c, _| assert_eq!(c.activity["old"], 1_000));
        // A new sign-in of the same account keeps the list while it lists.
        let epoch = |cx: &App| {
            crate::features::cloud::account::broker_and_binding(cx).map(|(_, b)| b.epoch)
        };
        let before = cx.update(|cx| epoch(cx));
        crate::cloud::auth::sign_in_again(&f.broker, "alice");
        settle(cx, |cx| epoch(cx).is_some_and(|now| Some(now) != before));
        f.script.answer(LISTING, Some(listing(&["new"])));
        ensure(&f, cx);
        assert_eq!(ids(&f, cx), Some(vec!["old".into(), "new".into()]));
        settle(cx, |cx| f.catalog.read(cx).fresh);
        assert_eq!(ids(&f, cx), Some(vec!["new".into()]));
        f.catalog
            .read_with(cx, |c, _| assert!(!c.activity.contains_key("old")));
        let kept = cache::catalog(f.dir.path(), &scope).unwrap();
        assert_eq!(
            kept.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["new"]
        );
    }

    /// `forgets the names when the account signs out, not while its session
    /// restores`, `drops that list if the session turns out to be gone`:
    /// while a session restores the kept list stays on disk; signing out
    /// removes it and the Cloud rows.
    #[gpui::test]
    fn signing_out_forgets_the_list_and_restoring_does_not(cx: &mut TestAppContext) {
        let f = fixture(cx);
        let scope = cx.update(|cx| CloudCatalog::scope(cx)).unwrap();
        cache::write_catalog(f.dir.path(), &scope, &parse_projects(&listing(&["old"])));
        let kept = || f.dir.path().join("cloud-project-catalog.v1.json").exists();
        set_status(Status::Restoring, false, cx);
        ensure(&f, cx);
        assert!(kept());
        set_status(Status::SignedOut, false, cx);
        ensure(&f, cx);
        assert!(!kept());
        f.catalog
            .read_with(cx, |c, _| assert_eq!(c.state, State::Idle));
    }

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
