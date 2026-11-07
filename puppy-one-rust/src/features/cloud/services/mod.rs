//! The Cloud services dialog (`CloudDialog`, `CloudServiceSidebar`,
//! `CloudServiceMainView`): a 960px task over the workspace, for one linked
//! Project. Homepage, MCP, CLI and the organization's Team are permanent
//! navigation; History, Access, Git and Settings open from the Homepage.
//! Every read is bound to the Project and account it asked for: a load that
//! a newer one replaced is dropped. A one-time credential lives in this view
//! only, until it closes.
use crate::{
    features::{cloud::account, cloud::publish::Publication},
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Dialog, Icon, ProductIcon},
        form_input::TextInput,
    },
    workspace::cloud::{
        access_points::{self as access, Catalog, CommandId, Kind, Point, Status},
        graph, history, permissions,
        services::{self, Client, Dashboard, Identity, McpEndpoint, Project, Scope, Surface, Tree},
        share,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
#[cfg(feature = "dev-capture")]
use serde_json::json;
use std::sync::Arc;

/// `CloudWorkspaceSection`, without the routes nothing leads to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Section {
    Contents,
    Mcp,
    Cli,
    GitSync,
    Access,
    History,
    Settings,
    Team,
    /// `openCloudShare`: where the Header's Share lands.
    Share,
    /// Behind `flags::CLOUD_BILLING`.
    Billing,
}
impl Section {
    fn catalog(self) -> Option<Catalog> {
        Some(match self {
            Self::Access => Catalog::All,
            Self::Mcp => Catalog::Mcp,
            Self::Cli => Catalog::Cli,
            Self::GitSync => Catalog::Git,
            _ => return None,
        })
    }
    fn route(self) -> &'static str {
        match self {
            Self::Contents => "contents",
            Self::Mcp => "mcp",
            Self::Cli => "cli",
            Self::GitSync => "git-sync",
            Self::Access => "access",
            Self::History => "history",
            Self::Settings => "settings",
            Self::Team => "cloud-team",
            Self::Share => "share",
            Self::Billing => "cloud-billing",
        }
    }
    fn title(self) -> String {
        tr(&format!("cloud.route.{}.title", self.route())).into()
    }
    fn description(self) -> String {
        tr(&format!("cloud.route.{}.description", self.route())).into()
    }
    /// The permanent navigation entry a task page belongs to.
    fn nav(self) -> Section {
        match self {
            Self::History | Self::Settings | Self::Access | Self::GitSync => Self::Contents,
            other => other,
        }
    }
}

/// `CloudProjectDetailsData`: each resource fails on its own.
#[derive(Clone, Debug, Default)]
pub struct Details {
    pub project: Option<Project>,
    pub dashboard: Option<Dashboard>,
    pub tree: Option<Tree>,
    pub history: Option<history::History>,
    pub scopes: Vec<Scope>,
    pub surfaces: Vec<Surface>,
    pub endpoints: Vec<McpEndpoint>,
    /// The list above was not read, which is not the same as being empty.
    endpoints_failed: bool,
    pub identity: Option<Identity>,
    pub failed: bool,
}
impl Details {
    fn load(client: &Client, id: &str) -> Self {
        let mut failed = false;
        let mut seen = |ok: bool| failed |= !ok;
        macro_rules! read {
            ($call:expr) => {{
                let result = $call;
                seen(result.is_ok());
                result.ok()
            }};
        }
        let endpoints = client.mcp_endpoints(id);
        let endpoints_failed = endpoints.is_err();
        let mut details = Self {
            project: read!(client.project(id)),
            dashboard: read!(client.dashboard(id)),
            tree: read!(client.tree(id)),
            history: read!(read_history(client, id)),
            scopes: read!(client.scopes(id)).unwrap_or_default(),
            surfaces: read!(client.surfaces(id)).unwrap_or_default(),
            endpoints: read!(endpoints).unwrap_or_default(),
            endpoints_failed,
            identity: read!(client.identity(id)),
            failed: false,
        };
        details.failed = failed;
        details
    }
    fn rows(&self, id: &str, catalog: Catalog) -> Vec<Point> {
        access::rows(
            id,
            &self.scopes,
            &self.surfaces,
            &self.endpoints,
            self.identity.as_ref(),
            catalog,
        )
    }
}
fn read_history(client: &Client, id: &str) -> services::Result<history::History> {
    let request = history::page_request(id, None).ok_or(services::Error::Invalid("history"))?;
    history::parse_page(&client.raw(request)?, id, false)
        .map_err(|_| services::Error::Invalid("history"))
}

/// The page after `cursor`, of the snapshot the first page began.
fn read_history_page(
    client: &Client,
    id: &str,
    cursor: &str,
) -> services::Result<history::History> {
    let request =
        history::page_request(id, Some(cursor)).ok_or(services::Error::Invalid("history"))?;
    history::parse_page(&client.raw(request)?, id, true)
        .map_err(|_| services::Error::Invalid("history"))
}

/// `useCloudOrganizationData`.
#[derive(Clone, Debug, Default)]
pub struct Team {
    pub organizations: Vec<services::Organization>,
    pub selected: Option<String>,
    pub members: Vec<services::Member>,
    pub entitlements: Option<services::Entitlements>,
    pub seats: Option<services::SeatUsage>,
    pub failed: bool,
    pub loading: bool,
}

pub struct Close;
impl EventEmitter<Close> for CloudServices {}
/// `publish.start`: a share needs the first push finished before it can go on.
pub struct ResumePublication;
impl EventEmitter<ResumePublication> for CloudServices {}

/// The signed-in account's Project requests (Homepage rename and delete).
pub fn services_client(cx: &App) -> Option<Client> {
    let (broker, binding) = account::broker_and_binding(cx)?;
    Some(Client::new(Arc::new(services::BrokerTransport {
        broker,
        binding,
        cancel: Default::default(),
    })))
}

/// The signed-in account's billing requests (Settings → Plan).
pub fn billing_client(cx: &App) -> Option<crate::workspace::cloud::billing::Client> {
    let (broker, binding) = account::broker_and_binding(cx)?;
    Some(crate::workspace::cloud::billing::Client::new(Arc::new(
        services::BrokerTransport {
            broker,
            binding,
            cancel: Default::default(),
        },
    )))
}

/// `pollIntervalMs` while a share waits for its first read.
const RECEIPT_POLL: std::time::Duration = std::time::Duration::from_secs(5);
const DELETE_CONFIRM: std::time::Duration = std::time::Duration::from_secs(4);

/// `ShareWizardDialog`'s state.
#[derive(Clone, Debug)]
struct ShareFlow {
    target: share::Target,
    /// The Project root (empty) or a folder.
    path: String,
    mode: &'static str,
    phase: SharePhase,
}
#[derive(Clone, Debug)]
enum SharePhase {
    Choose,
    /// `publishing`: the Project's first push comes first.
    Publishing,
    Issuing,
    Ready {
        endpoint: Option<String>,
        /// Only from a fresh issue; a reused share shows none.
        key: Option<String>,
        issued_at: Option<String>,
        reused: bool,
    },
    Failed,
}
fn target_label(target: &share::Target) -> String {
    target.brand.map_or_else(
        || tr(&format!("cloud.share.target.{}.label", target.id)).to_owned(),
        str::to_owned,
    )
}

/// `visibleFolders`: the Project's top level, led by the folder the share
/// started from when that is deeper.
fn scope_folders(details: &Details, initial: &str) -> Vec<String> {
    let mut folders: Vec<String> = details
        .tree
        .iter()
        .flat_map(|tree| tree.entries.iter())
        .filter(|e| e.kind == "folder")
        .map(|e| e.path.clone())
        .collect();
    if !initial.is_empty() && !folders.iter().any(|f| f == initial) {
        folders.insert(0, initial.to_owned());
    }
    folders
}

/// `CreateAccessDialog`'s draft.
#[derive(Clone, Debug)]
struct Create {
    /// The folder listed, and its subfolders.
    browsing: String,
    folders: Vec<String>,
    failed: bool,
    path: Option<String>,
    mode: &'static str,
}
impl Default for Create {
    fn default() -> Self {
        Self {
            browsing: String::new(),
            folders: vec![],
            failed: false,
            path: None,
            mode: "r",
        }
    }
}

pub struct CloudServices {
    client: Option<Client>,
    project: Option<String>,
    /// The Share experiment is on: Share is the second Project destination
    /// (`withSharePageSidebarRoutes`).
    pub share: bool,
    pub section: Section,
    pub details: Option<Details>,
    pub loading: bool,
    epoch: u64,
    team: Team,
    team_epoch: u64,
    /// The commit the History page shows, and its detail once read.
    commit: Option<String>,
    detail: Option<history::Commit>,
    detail_epoch: u64,
    /// One-time credential: (endpoint, value), shown until this view closes.
    issued: Option<(String, String)>,
    confirm_delete: Option<String>,
    /// The open Create access form.
    creating: Option<Create>,
    /// The access point whose permissions are showing.
    expanded: Option<String>,
    /// The open `ScopeSettingsBlock`: its Scope and the mode being chosen.
    scope_edit: Option<(String, &'static str)>,
    scope_edit_name: Entity<TextInput>,
    scope_exclude: Entity<TextInput>,
    folder_epoch: u64,
    billing: billing::BillingPage,
    /// The Share wizard, and the issue or receipt watch that may report.
    share_flow: Option<ShareFlow>,
    /// `initialPath`: the folder the next share starts from; empty is the
    /// Project. Only the Explorer sets it.
    share_path: String,
    /// The wizard's `readers` step.
    share_readers: bool,
    /// `useProjectShareActivity`: the share awaited, with its Project. It
    /// outlives the wizard and this dialog.
    pending_share: Option<(String, share::Pending)>,
    /// Ends the reread that watches `pending_share`.
    pending_epoch: u64,
    /// Drops a share list that a newer read or Project replaced.
    shares_epoch: u64,
    /// `loadingMore` of the History page.
    history_loading_more: bool,
    /// `history-load-more-failed`.
    history_more_failed: bool,
    /// Drops a page that a newer one or another Project replaced.
    history_epoch: u64,
    /// The next refresh starts the list over instead of keeping its pages.
    history_restart: bool,
    /// The Project's first publication, as the Shell last reported it.
    publication: Publication,
    /// `publishRequestedRef`: this share asked for the run in progress, so
    /// its stopping stops the share.
    publish_requested: bool,
    /// `formatCloudPublishFailure` of the last run.
    publish_failure: Option<String>,
    share_epoch: u64,
    stop_failed: bool,
    scope_name: Entity<TextInput>,
    notice: Option<SharedString>,
    busy: bool,
    name: Entity<TextInput>,
    description: Entity<TextInput>,
    branch: Entity<TextInput>,
    scroll: ScrollHandle,
    list_scroll: ScrollHandle,
}
impl CloudServices {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = |multi: bool, window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| TextInput::new(SharedString::default(), multi, 500, window, cx))
        };
        Self {
            client: None,
            project: None,
            share: false,
            section: Section::Contents,
            details: None,
            loading: false,
            epoch: 0,
            team: Team::default(),
            team_epoch: 0,
            commit: None,
            detail: None,
            detail_epoch: 0,
            issued: None,
            confirm_delete: None,
            creating: None,
            expanded: None,
            scope_edit: None,
            scope_edit_name: field(false, window, cx),
            scope_exclude: cx
                .new(|cx| TextInput::new("dist\n.cache\n*.tmp", true, 4000, window, cx)),
            folder_epoch: 0,
            billing: Default::default(),
            share_flow: None,
            share_path: String::new(),
            share_readers: false,
            pending_share: None,
            pending_epoch: 0,
            shares_epoch: 0,
            history_loading_more: false,
            history_more_failed: false,
            history_epoch: 0,
            history_restart: false,
            publication: Publication::Clear,
            publish_requested: false,
            publish_failure: None,
            share_epoch: 0,
            stop_failed: false,
            scope_name: field(false, window, cx),
            notice: None,
            busy: false,
            name: field(false, window, cx),
            description: field(true, window, cx),
            branch: field(false, window, cx),
            scroll: ScrollHandle::new(),
            list_scroll: ScrollHandle::new(),
        }
    }
}

/// `formatBytes`.
fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024. && unit + 1 < UNITS.len() {
        value /= 1024.;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}
/// `getLatestCloudUpdateAt`, as `YYYY-MM-DD`.
fn latest_update(details: &Details) -> Option<String> {
    details
        .history
        .iter()
        .flat_map(|h| h.commits.iter())
        .filter_map(|c| c.created_at.clone())
        .chain(details.project.iter().filter_map(|p| p.updated_at.clone()))
        .max()
        .map(|at| at.chars().take(10).collect())
}
fn status_label(code: &str) -> &'static str {
    match access::status(Some(code)) {
        Status::Ready => tr("cloud.status.active"),
        Status::Syncing => tr("cloud.status.syncing"),
        Status::Error => tr("cloud.status.error"),
        Status::Missing if code == "paused" => tr("cloud.status.paused"),
        Status::Missing => tr("cloud.status.missing"),
    }
}

impl Render for CloudServices {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let viewport = window.viewport_size();
        // `.desktop-cloud-dialog`: `height: min(760px, 100vh - 2 * inset)`.
        let height = f32::from(viewport.height - px(64.)).min(760.) - 41.;
        let host = cx.weak_entity();
        let body = h_flex()
            .h(px(height))
            .items_start()
            .child(self.navigation(t, cx))
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .child(
                        v_flex()
                            .id("cloud-services-content")
                            .size_full()
                            .p(px(24.))
                            .gap(px(16.))
                            .overflow_y_scroll()
                            .track_scroll(&self.scroll)
                            .child(self.content(t, cx)),
                    )
                    .child(crate::ui::scrollbar::vertical(
                        "cloud-services-scrollbar",
                        &self.scroll,
                    )),
            );
        Dialog::new("cloud-services")
            .width(960.)
            .leading(Icon::product(ProductIcon::Cloud), t.accent)
            .title(tr("cloud.productName"))
            .body_inline(0.)
            .body_padding(0., 0.)
            .on_close(move |_, cx| {
                let _ = host.update(cx, |s, cx| s.close(cx));
            })
            .child(body)
    }
}

/// The pixel lab's answers (`shell-cloud-services-*`).
#[cfg(feature = "dev-capture")]
struct LabCloud {
    /// Two readers, one of them scoped to a folder.
    shared: bool,
}
#[cfg(feature = "dev-capture")]
impl services::Transport for LabCloud {
    fn request(
        &self,
        request: crate::cloud::auth::model::ApiRequest,
    ) -> services::Result<serde_json::Value> {
        let surface = |id: &str, kind: &str, status: &str| {
            json!({"id": id, "project_id": "lab", "kind": kind, "status": status, "name": "Claude",
                "target": {"kind": "project_root", "project_id": "lab"}})
        };
        let commit = |id: char, parents: Vec<String>, message: &str| {
            json!({"commit_id": id.to_string().repeat(40), "parent_ids": parents, "who": "Ada",
                "message": message, "created_at": "2026-10-20T08:00:00Z", "changes": [],
                "changes_loaded": false})
        };
        let id = |c: char| c.to_string().repeat(40);
        Ok(match request.path.as_str() {
            p if p.ends_with("/dashboard/resources") => json!({
                "project": {"id": "lab", "name": "Launch notes"}, "resources": [],
                "nodes": {"total": 3, "folders": 1, "files": 2, "storage_bytes": 3_400_000}}),
            p if p.ends_with("/ls") => json!({"path": "", "entries": [
                {"name": "plans", "path": "plans", "type": "folder"},
                {"name": "README.md", "path": "README.md", "type": "file"}]}),
            p if p.ends_with("/access/surfaces") => {
                json!([
                    surface("m1", "mcp", "active"),
                    surface("c1", "cli", "paused")
                ])
            }
            p if p.ends_with("/scopes") => json!([]),
            p if p.ends_with("/access-point") => {
                json!({"project_id": "lab", "url": "https://api.puppyone.ai/git/lab.git", "scopes": []})
            }
            "/mcp-endpoints" if self.shared => json!([
                {"id": "e1", "project_id": "lab", "name": "Claude", "status": "active", "path": "",
                 "created_at": "2026-10-20T08:00:00Z",
                 "accesses": [{"path": "", "readonly": true}]},
                {"id": "e2", "project_id": "lab", "name": "A bot in Slack with a long name",
                 "status": "active", "path": "plans/2026/launch",
                 "created_at": "2026-10-20T08:00:00Z",
                 "accesses": [{"path": "plans/2026/launch", "readonly": false}]}]),
            "/mcp-endpoints" => json!([]),
            "/projects/lab" => json!({"id": "lab", "name": "Launch notes",
                "updated_at": "2026-10-20T08:00:00Z", "visibility": "org",
                "capabilities": ["project.settings.manage", "access_surface.manage"]}),
            p if p.contains("/commits") => json!({"project_id": "lab",
                "snapshot_id": "a".repeat(64), "refs_included": true,
                "graph_health": "complete", "unreadable_commit_ids": [],
                "head_commit_id": id('d'), "refs": [
                    {"ref_name": "refs/heads/main", "ref_type": "branch", "commit_id": id('d')},
                    {"ref_name": "refs/heads/draft", "ref_type": "branch", "commit_id": id('c')}],
                "commits": [
                    commit('d', vec![id('b'), id('c')], "Merge draft"),
                    commit('b', vec![id('a')], "Write the plan"),
                    commit('c', vec![id('a')], "Draft the outline"),
                    commit('a', vec![], "Start")],
                "next_cursor": null, "has_more": false, "total": 4}),
            _ => json!({}),
        })
    }
}
impl CloudServices {
    /// The pixel lab's dialog on `section`.
    #[cfg(feature = "dev-capture")]
    pub fn lab(&mut self, section: Section, cx: &mut Context<Self>) {
        let client = Client::new(Arc::new(LabCloud { shared: false }));
        self.share = true;
        self.open_with(client, "lab".into(), section, cx);
    }
    /// `shell-cloud-services-share-{waiting,readers}`.
    #[cfg(feature = "dev-capture")]
    pub fn lab_share(&mut self, waiting: bool, cx: &mut Context<Self>) {
        let client = Client::new(Arc::new(LabCloud { shared: true }));
        self.share = true;
        self.open_with(client, "lab".into(), Section::Share, cx);
        if waiting {
            let pending = share::Pending {
                target: share::TARGETS[2],
                endpoint: "e1".into(),
                issued_at: chrono::Utc::now().to_rfc3339(),
            };
            self.pending_share = Some(("lab".into(), pending));
        } else {
            self.share_readers = true;
        }
    }
}

mod access_page;
mod billing;
mod contents_page;
mod edit;
mod frame;
mod history_page;
mod load;
mod settings_page;
mod share_flow;
mod share_page;
mod share_status;
#[cfg(test)]
mod tests;
