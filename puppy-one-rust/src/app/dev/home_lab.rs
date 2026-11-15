//! `shell-home-projects-<mode>`: the returning-user Homepage, signed in to a
//! fixture account. Folders on this computer (one holding files, one empty),
//! three spaces (the personal one, a team, and an empty one this account
//! owns), Cloud projects with root files and connected Agents, and Local
//! Agents to start a project with. `-list` shows the List layout, `-agents`
//! opens New project's Agents and `-account` the account menu.
use crate::app::*;

/// The fixture account's spaces and Cloud projects.
fn responder() -> crate::cloud::auth::Responder {
    std::sync::Arc::new(|request| {
        Ok(match request.path.as_str() {
            "/organizations/" => serde_json::json!({"code": 0, "data": [
                {"id": "me", "name": "Guanqun", "is_default": true, "role": "owner",
                 "can_create_projects": true, "can_manage_space": true,
                 "billing_plan_id": "free"},
                {"id": "design", "name": "Design", "role": "owner",
                 "can_create_projects": true, "can_manage_space": true,
                 "billing_plan_id": "team_v2"},
                {"id": "own", "name": "guanqun.real", "role": "owner",
                 "can_create_projects": true, "can_manage_space": true,
                 "billing_plan_id": "free"}]}),
            "/projects/" => serde_json::json!({"code": 0, "data": [
                {"id": "p-0813", "name": "My project 0813", "org_id": "me",
                 "updated_at": "2026-11-13T10:00:00Z"},
                {"id": "p-issues", "name": "puppy-issues", "org_id": "me",
                 "updated_at": "2026-10-26T10:00:00Z"},
                {"id": "p-todo", "name": "To-Do-List", "org_id": "me",
                 "updated_at": "2026-10-11T10:00:00Z"},
                {"id": "p-brand", "name": "Brand guidelines", "org_id": "design",
                 "updated_at": "2026-11-14T08:00:00Z"}]}),
            _ => serde_json::json!({"code": 0, "data": []}),
        })
    })
}

impl Shell {
    pub fn lab_home_projects(&mut self, case: &str, cx: &mut Context<Self>) {
        let root = crate::platform::data_dir().join("lab-projects");
        let folders: [(&str, &[&str]); 2] = [
            ("puppy-issues", &["README.md", "roadmap.md", "index.html"]),
            ("Drafts", &[]),
        ];
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let mut paths = vec![];
        for (name, files) in folders {
            let folder = root.join(name);
            let _ = std::fs::create_dir_all(&folder);
            for file in files {
                let _ = std::fs::write(folder.join(file), "# Fixture\n");
            }
            paths.push(folder);
        }
        self.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            for (index, path) in paths.iter().enumerate() {
                p.state.remember_project(path, now - index as u64 * 3600);
            }
        });
        let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder());
        crate::features::cloud::account::install_fixture(broker, browser, cx);
        let agents = case.ends_with("-agents");
        self.home.update(cx, |h, _| h.lab_projects(agents));
        if case.ends_with("-list") {
            self.prefs.store.update(cx, |p, _| {
                p.state.homepage_project_layout = crate::features::settings::HomepageLayout::List
            });
        }
        if case.ends_with("-account") {
            self.chrome.update(cx, |c, cx| {
                c.set_popover(Some(crate::app::chrome::Popover::Account), cx)
            });
        }
        self.sync_session_view(cx);
    }
}
