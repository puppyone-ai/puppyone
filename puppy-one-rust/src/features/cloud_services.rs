//! The Cloud services dialog (`CloudDialog`, `CloudServiceSidebar`,
//! `CloudServiceMainView`): a 960px task over the workspace, for one linked
//! Project. Homepage, MCP, CLI and the organization's Team are permanent
//! navigation; History, Access, Git and Settings open from the Homepage.
//! Every read is bound to the Project and account it asked for: a load that
//! a newer one replaced is dropped. A one-time credential lives in this view
//! only, until it closes.
use crate::{
    features::cloud_account,
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
            Self::History | Self::Settings | Self::Access | Self::GitSync | Self::Share => {
                Self::Contents
            }
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

/// The signed-in account's billing requests (Settings → Plan).
pub fn billing_client(cx: &App) -> Option<crate::workspace::cloud::billing::Client> {
    let (broker, binding) = cloud_account::broker_and_binding(cx)?;
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
    /// Opens on `section` of `project` for the signed-in account.
    pub fn open(&mut self, project: String, section: Section, cx: &mut Context<Self>) {
        let Some((broker, binding)) = cloud_account::broker_and_binding(cx) else {
            return;
        };
        let client = Client::new(Arc::new(services::BrokerTransport {
            broker,
            binding,
            cancel: Default::default(),
        }));
        self.open_with(client, project, section, cx);
    }
    pub fn open_with(
        &mut self,
        client: Client,
        project: String,
        section: Section,
        cx: &mut Context<Self>,
    ) {
        self.reset();
        if self
            .pending_share
            .as_ref()
            .is_some_and(|(owner, _)| *owner != project)
        {
            self.pending_share = None;
        }
        self.client = Some(client);
        self.project = Some(project);
        self.section = section;
        self.refresh(cx);
        self.enter(section, cx);
        self.watch_pending(cx);
        cx.notify();
    }
    /// `openShareWizard(null, path)`: the next share starts from `path`, past
    /// the readers an empty path would show first.
    pub fn start_from(&mut self, path: String, cx: &mut Context<Self>) {
        self.share_path = path;
        self.share_readers = false;
        cx.notify();
    }
    #[cfg(test)]
    pub fn share_start(&self) -> &str {
        &self.share_path
    }
    /// `enabled` of `useProjectShareActivity`, and the effect that leaves the
    /// Share section when onboarding ends. An account ending ends a wait too.
    pub fn sync_sharing(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if enabled {
            return;
        }
        self.pending_share = None;
        self.pending_epoch += 1;
        if self.project.is_some() && self.section == Section::Share {
            self.select(Section::Contents, cx);
        }
    }
    fn reset(&mut self) {
        self.epoch += 1;
        self.team_epoch += 1;
        self.detail_epoch += 1;
        self.details = None;
        self.team = Team::default();
        self.commit = None;
        self.detail = None;
        self.issued = None;
        self.confirm_delete = None;
        self.creating = None;
        self.folder_epoch += 1;
        self.share_flow = None;
        self.share_path.clear();
        self.share_readers = false;
        self.expanded = None;
        self.scope_edit = None;
        self.share_epoch += 1;
        self.shares_epoch += 1;
        self.pending_epoch += 1;
        self.stop_failed = false;
        self.billing.reset();
        self.notice = None;
        self.busy = false;
    }
    /// Closing forgets everything, a one-time credential first of all.
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.reset();
        self.client = None;
        self.project = None;
        cx.emit(Close);
        cx.notify();
    }
    pub fn select(&mut self, section: Section, cx: &mut Context<Self>) {
        self.section = section;
        self.confirm_delete = None;
        self.creating = None;
        self.share_flow = None;
        self.share_path.clear();
        self.share_readers = false;
        self.expanded = None;
        self.scope_edit = None;
        self.share_epoch += 1;
        self.notice = None;
        self.scroll.set_offset(point(px(0.), px(0.)));
        self.enter(section, cx);
        cx.notify();
    }
    fn enter(&mut self, section: Section, cx: &mut Context<Self>) {
        if matches!(section, Section::Team | Section::Billing)
            && self.team.organizations.is_empty()
            && !self.team.loading
        {
            self.load_team(cx);
        }
        if section == Section::Billing
            && self.team.selected.is_some()
            && self.billing.membership == billing::Membership::Unknown
        {
            self.load_billing(cx);
        }
        if section == Section::Settings {
            self.fill_settings(cx);
        }
    }
    /// `loadCloudProjectDetails`: dropped if a newer load or project began.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(id)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        self.epoch += 1;
        let epoch = self.epoch;
        self.loading = true;
        let task = cx.background_spawn(async move { Details::load(&client, &id) });
        cx.spawn(async move |this, cx| {
            let details = task.await;
            this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                let mut details = details;
                // `useProjectShares`: a failed read keeps what was known, so
                // one bad answer neither empties the list nor ends a wait.
                if let Some(known) = s.details.take() {
                    if details.endpoints_failed {
                        details.endpoints = known.endpoints;
                    }
                    details.dashboard = details.dashboard.or(known.dashboard);
                }
                s.details = Some(details);
                s.loading = false;
                s.settle_pending(cx);
                if s.section == Section::Settings {
                    s.fill_settings(cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn fill_settings(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.details.as_ref().and_then(|d| d.project.clone()) else {
            return;
        };
        self.name.update(cx, |i, cx| i.set_text(&project.name, cx));
        self.description.update(cx, |i, cx| {
            i.set_text(project.description.as_deref().unwrap_or(""), cx)
        });
        self.branch.update(cx, |i, cx| {
            i.set_text(project.bound_git_branch.as_deref().unwrap_or("main"), cx)
        });
    }
    fn load_team(&mut self, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            return;
        };
        self.team_epoch += 1;
        let epoch = self.team_epoch;
        self.team.loading = true;
        let task = cx.background_spawn(async move { client.organizations() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.team_epoch != epoch {
                    return;
                }
                s.team.loading = false;
                match result {
                    Ok(organizations) => {
                        // One organization is the choice; several need an
                        // explicit one, never the first.
                        let only = (organizations.len() == 1).then(|| organizations[0].id.clone());
                        s.team.organizations = organizations;
                        if let Some(id) = only {
                            s.select_organization(id, cx);
                        }
                    }
                    Err(_) => s.team.failed = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub fn select_organization(&mut self, id: String, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            return;
        };
        self.team_epoch += 1;
        let epoch = self.team_epoch;
        self.team.selected = Some(id.clone());
        // Another Organization is another billing context.
        self.billing.reset();
        if self.section == Section::Billing {
            self.load_billing(cx);
        }
        self.team.members.clear();
        self.team.entitlements = None;
        self.team.seats = None;
        self.team.failed = false;
        self.team.loading = true;
        let task = cx.background_spawn(async move {
            (
                client.members(&id),
                client.entitlements(&id),
                client.seat_usage(&id),
            )
        });
        cx.spawn(async move |this, cx| {
            let (members, entitlements, seats) = task.await;
            this.update(cx, |s, cx| {
                if s.team_epoch != epoch {
                    return;
                }
                s.team.loading = false;
                s.team.failed = members.is_err();
                s.team.members = members.unwrap_or_default();
                s.team.entitlements = entitlements.ok();
                s.team.seats = seats.ok();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn open_commit(&mut self, id: String, cx: &mut Context<Self>) {
        let (Some(client), Some(project)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        self.commit = Some(id.clone());
        self.detail = None;
        self.detail_epoch += 1;
        let epoch = self.detail_epoch;
        let task = cx.background_spawn(async move {
            let request = history::detail_request(&project, &id)
                .ok_or(services::Error::Invalid("history"))?;
            history::parse_detail(&client.raw(request)?, &id)
                .map_err(|_| services::Error::Invalid("history"))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.detail_epoch == epoch {
                    s.detail = result.ok();
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }
    /// A mutation, then a reread; its outcome is never replayed.
    fn mutate(
        &mut self,
        action: impl FnOnce(&Client) -> services::Result<Option<(String, String)>> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        self.mutate_or("cloud.settings.saveFailed", action, cx);
    }
    /// One change at a time; a failure reports `failed` and changes nothing.
    fn mutate_or(
        &mut self,
        failed: &'static str,
        action: impl FnOnce(&Client) -> services::Result<Option<(String, String)>> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        let Some(client) = self.client.clone() else {
            return;
        };
        if self.busy {
            return;
        }
        self.busy = true;
        self.notice = None;
        let epoch = self.epoch;
        let task = cx.background_spawn(async move { action(&client) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                s.busy = false;
                s.confirm_delete = None;
                match result {
                    Ok(issued) => {
                        if issued.is_some() {
                            s.issued = issued;
                        }
                        s.refresh(cx);
                    }
                    Err(_) => s.notice = Some(tr(failed).into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn save_general(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else {
            return;
        };
        let name = self.name.read(cx).text().trim().to_owned();
        let branch = self.branch.read(cx).text().trim().to_owned();
        let description = self.description.read(cx).text().trim().to_owned();
        if name.is_empty() || branch.is_empty() {
            return;
        }
        let description = (!description.is_empty()).then_some(description);
        let fields = json!({"name": name, "description": description, "bound_git_branch": branch});
        self.mutate(
            move |client| client.update_project(&project, fields).map(|_| None),
            cx,
        );
    }
    fn set_visibility(&mut self, visibility: &'static str, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else {
            return;
        };
        self.mutate(
            move |client| {
                client
                    .update_project(&project, json!({"visibility": visibility}))
                    .map(|_| None)
            },
            cx,
        );
    }
    /// `handleCreateMcpEndpoint`: its key is shown here, once.
    fn create_mcp(&mut self, view: access::View, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone().filter(|_| self.can_manage()) else {
            return;
        };
        let readonly = self
            .details
            .as_ref()
            .and_then(|d| d.scopes.iter().find(|s| s.id == view.id))
            .is_some_and(|s| s.max_mode != "rw");
        self.mutate(
            move |client| {
                let endpoint =
                    client.create_mcp_endpoint(&project, "MCP Server", &view.path, readonly)?;
                Ok(endpoint.api_key.map(|key| (endpoint.id, key)))
            },
            cx,
        );
    }
    /// `canManage`: the capability the server granted on this Project.
    fn can_manage(&self) -> bool {
        self.details
            .as_ref()
            .and_then(|d| d.project.as_ref())
            .is_some_and(|p| p.can("access_surface.manage"))
    }
    /// A delete needs a second press within four seconds.
    fn arm_delete(&mut self, id: String, cx: &mut Context<Self>) {
        self.confirm_delete = Some(id.clone());
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(DELETE_CONFIRM).await;
            this.update(cx, |s, cx| {
                if s.confirm_delete.as_deref() == Some(id.as_str()) && !s.busy {
                    s.confirm_delete = None;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
        cx.notify();
    }
    fn delete_scope(&mut self, scope: String, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone().filter(|_| self.can_manage()) else {
            return;
        };
        self.mutate_or(
            "cloud.message.delete-access-failed",
            move |client| client.delete_scope(&project, &scope).map(|_| None),
            cx,
        );
    }
    /// The settings of one Scope at a time, filled from what the server holds.
    fn toggle_scope_settings(&mut self, scope: &Scope, cx: &mut Context<Self>) {
        let open = self
            .scope_edit
            .as_ref()
            .is_some_and(|(id, _)| *id == scope.id);
        self.confirm_delete = None;
        if open {
            self.scope_edit = None;
        } else {
            self.fill_scope_form(scope, cx);
        }
        cx.notify();
    }
    fn fill_scope_form(&mut self, scope: &Scope, cx: &mut Context<Self>) {
        let mode = if scope.max_mode == "rw" { "rw" } else { "r" };
        self.scope_edit = Some((scope.id.clone(), mode));
        self.scope_edit_name
            .update(cx, |i, cx| i.set_text(&scope.name, cx));
        self.scope_exclude
            .update(cx, |i, cx| i.set_text(scope.exclude.join("\n"), cx));
    }
    fn scope_dirty(&self, scope: &Scope, cx: &App) -> bool {
        let Some((id, mode)) = &self.scope_edit else {
            return false;
        };
        *id == scope.id
            && (self.scope_edit_name.read(cx).text().trim() != scope.name
                || *mode != scope.max_mode
                || permissions::parse_exclude(self.scope_exclude.read(cx).text()) != scope.exclude)
    }
    fn save_scope(&mut self, scope: Scope, cx: &mut Context<Self>) {
        let Some((_, mode)) = self.scope_edit.clone().filter(|_| self.can_manage()) else {
            return;
        };
        let typed = self.scope_edit_name.read(cx).text().trim().to_owned();
        let name = if typed.is_empty() {
            scope.name.clone()
        } else {
            typed
        };
        let exclude = permissions::parse_exclude(self.scope_exclude.read(cx).text());
        self.mutate_or(
            "cloud.message.save-scope-failed",
            move |client| {
                client
                    .update_scope(&scope.project_id, &scope.id, &name, mode, &exclude)
                    .map(|_| None)
            },
            cx,
        );
    }
    /// `handleUpdateAccessPointPermissions`: the whole record goes back with
    /// its permissions replaced.
    fn set_permissions(
        &mut self,
        point: &access::Point,
        allowed: &permissions::Allowed,
        cx: &mut Context<Self>,
    ) {
        let (Some(project), Some(details), Some(id)) = (
            self.project.clone().filter(|_| self.can_manage()),
            self.details.as_ref(),
            point.surface.clone(),
        ) else {
            return;
        };
        let failed = "cloud.message.update-config-failed";
        match point.kind {
            Kind::Cli => {
                let Some(surface) = details.surfaces.iter().find(|s| s.id == id) else {
                    return;
                };
                let config = permissions::cli_config(&surface.config, allowed);
                self.mutate_or(
                    failed,
                    move |client| {
                        client
                            .update_surface_config(&project, &id, config)
                            .map(|_| None)
                    },
                    cx,
                );
            }
            Kind::Mcp => {
                let Some(endpoint) = details.endpoints.iter().find(|e| e.id == id) else {
                    return;
                };
                let tools = permissions::mcp_config(&endpoint.tools_config, allowed);
                self.mutate_or(
                    failed,
                    move |client| client.update_mcp_tools(&project, &id, tools).map(|_| None),
                    cx,
                );
            }
            Kind::Git => {}
        }
    }
    /// `CreateAccessDialog`: choosing a path reads its folders on demand.
    fn begin_create(&mut self, cx: &mut Context<Self>) {
        if !self.can_manage() {
            return;
        }
        self.creating = Some(Create::default());
        self.read_folder(String::new(), cx);
        cx.notify();
    }
    fn read_folder(&mut self, path: String, cx: &mut Context<Self>) {
        let (Some(client), Some(project)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        if let Some(create) = &mut self.creating {
            create.browsing = path.clone();
            create.folders.clear();
            create.failed = false;
        }
        self.folder_epoch += 1;
        let epoch = self.folder_epoch;
        let task = cx.background_spawn(async move { client.folder(&project, &path) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.folder_epoch != epoch {
                    return;
                }
                if let Some(create) = &mut s.creating {
                    match result {
                        Ok(tree) => {
                            create.folders = tree
                                .entries
                                .into_iter()
                                .filter(|e| e.kind == "folder")
                                .map(|e| e.path)
                                .collect();
                        }
                        Err(_) => create.failed = true,
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// `defaultScopeName` fills the name until someone types one.
    fn choose_path(&mut self, path: String, cx: &mut Context<Self>) {
        let last = path
            .rsplit('/')
            .find(|p| !p.is_empty())
            .unwrap_or("")
            .to_owned();
        if let Some(create) = &mut self.creating {
            create.path = Some(path);
        }
        self.scope_name.update(cx, |i, cx| i.set_text(&last, cx));
        cx.notify();
    }
    /// `createDesktopCloudAccess`: a path with access is never doubled.
    fn create_access(&mut self, cx: &mut Context<Self>) {
        let (Some(project), Some(create)) = (self.project.clone(), self.creating.clone()) else {
            return;
        };
        let Some(path) = create.path.clone().filter(|p| !p.is_empty()) else {
            return;
        };
        let name = self.scope_name.read(cx).text().trim().to_owned();
        let taken = self.details.as_ref().is_some_and(|d| {
            d.scopes
                .iter()
                .any(|s| s.path.trim_matches('/') == path.trim_matches('/'))
        });
        if taken {
            self.notice = Some(tr("cloud.access.create.pathAlreadyHasAccess").into());
            cx.notify();
            return;
        }
        if name.is_empty() {
            return;
        }
        let mode = create.mode;
        let mcp = self.section == Section::Mcp;
        self.creating = None;
        self.mutate(
            move |client| {
                let scope = client.create_scope(&project, &name, &path, mode)?;
                if !mcp {
                    return Ok(None);
                }
                let endpoint = client.create_mcp_endpoint(
                    &project,
                    "MCP Server",
                    &scope.path,
                    scope.max_mode != "rw",
                )?;
                Ok(endpoint.api_key.map(|key| (endpoint.id, key)))
            },
            cx,
        );
    }
    fn share_rows(&self) -> Vec<share::Share> {
        self.details
            .as_ref()
            .map(|d| share::shares(&d.endpoints, d.dashboard.as_ref()))
            .unwrap_or_default()
    }
    fn begin_share(&mut self, target: share::Target, cx: &mut Context<Self>) {
        self.share_flow = Some(ShareFlow {
            target,
            path: self.share_path.clone(),
            mode: "r",
            phase: SharePhase::Choose,
        });
        cx.notify();
    }
    /// `ShareWizardDialog`'s issue step: a link needs no request; the same
    /// active share is reused without a new key; otherwise the Scope exists
    /// first, then the endpoint.
    fn issue_share(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(project), Some(flow)) = (
            self.client.clone(),
            self.project.clone(),
            self.share_flow.clone(),
        ) else {
            return;
        };
        let target = flow.target;
        if target.channel == share::Channel::Link {
            self.set_share_phase(
                SharePhase::Ready {
                    endpoint: None,
                    key: None,
                    issued_at: None,
                    reused: false,
                },
                cx,
            );
            return;
        }
        let name = target_label(&target);
        let (path, mode) = (flow.path.clone(), flow.mode);
        if let Some(existing) = share::reusable(&self.share_rows(), &name, &path, mode == "r") {
            let (endpoint, issued_at) = (existing.id.clone(), existing.created_at.clone());
            self.set_share_phase(
                SharePhase::Ready {
                    endpoint: Some(endpoint.clone()),
                    key: None,
                    issued_at: issued_at.clone(),
                    reused: true,
                },
                cx,
            );
            self.await_first_read(target, endpoint, issued_at, cx);
            return;
        }
        self.set_share_phase(SharePhase::Issuing, cx);
        self.share_epoch += 1;
        let epoch = self.share_epoch;
        let task = cx.background_spawn(async move {
            if !path.is_empty() && !client.scopes(&project)?.iter().any(|s| s.path == path) {
                let folder = path.rsplit('/').find(|p| !p.is_empty()).unwrap_or(&path);
                client.create_scope(&project, folder, &path, mode)?;
            }
            client.create_mcp_endpoint(&project, &name, &path, mode == "r")
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.share_epoch != epoch {
                    return;
                }
                match result {
                    Ok(endpoint) => {
                        let issued_at =
                            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        s.set_share_phase(
                            SharePhase::Ready {
                                endpoint: Some(endpoint.id.clone()),
                                key: endpoint.api_key,
                                issued_at: Some(issued_at.clone()),
                                reused: false,
                            },
                            cx,
                        );
                        // The read starts first: the list before it has no
                        // such share, and that must not end the wait.
                        s.refresh(cx);
                        s.await_first_read(target, endpoint.id, Some(issued_at), cx);
                    }
                    Err(_) => s.set_share_phase(SharePhase::Failed, cx),
                }
            })
            .ok();
        })
        .detach();
    }
    fn set_share_phase(&mut self, phase: SharePhase, cx: &mut Context<Self>) {
        if let Some(flow) = &mut self.share_flow {
            flow.phase = phase;
        }
        cx.notify();
    }
    /// Whether the issued share has been used since it was issued.
    fn share_connected(&self, flow: &ShareFlow) -> bool {
        let SharePhase::Ready {
            endpoint: Some(endpoint),
            issued_at,
            ..
        } = &flow.phase
        else {
            return false;
        };
        let rows = self.share_rows();
        share::has_receipt(
            rows.iter().find(|s| s.id == *endpoint),
            issued_at.as_deref(),
        )
    }
    /// `closeShareWizard`: the next share starts over from the whole Project.
    fn finish_share(&mut self, cx: &mut Context<Self>) {
        self.share_epoch += 1;
        self.share_flow = None;
        self.share_path.clear();
        cx.notify();
    }
    /// `onIssued`: the wait outlives the wizard. A share with no issue time
    /// cannot be awaited.
    fn await_first_read(
        &mut self,
        target: share::Target,
        endpoint: String,
        issued_at: Option<String>,
        cx: &mut Context<Self>,
    ) {
        let (Some(project), Some(issued_at)) = (self.project.clone(), issued_at) else {
            return;
        };
        let pending = share::Pending {
            target,
            endpoint,
            issued_at,
        };
        self.pending_share = Some((project, pending));
        self.settle_pending(cx);
        self.watch_pending(cx);
    }
    /// The effect in `useProjectShareActivity`, with one difference: only a
    /// list that was actually read can end a wait. Time ends it regardless.
    fn settle_pending(&mut self, cx: &mut Context<Self>) {
        let Some((_, pending)) = &self.pending_share else {
            return;
        };
        let read = !self.loading && self.details.as_ref().is_some_and(|d| !d.endpoints_failed);
        if pending.expired(chrono::Utc::now()) || (read && !pending.live(&self.share_rows())) {
            self.pending_share = None;
            self.pending_epoch += 1;
            cx.notify();
        }
    }
    /// `pollIntervalMs`: reread while a share is awaited and this dialog is
    /// open; opening it again picks the wait back up.
    fn watch_pending(&mut self, cx: &mut Context<Self>) {
        self.pending_epoch += 1;
        if self.pending_share.is_none() {
            return;
        }
        let epoch = self.pending_epoch;
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(RECEIPT_POLL).await;
                let waiting = this
                    .update(cx, |s, cx| {
                        if s.pending_epoch != epoch {
                            return false;
                        }
                        s.settle_pending(cx);
                        // Ending a wait moves the epoch.
                        let waiting = s.pending_epoch == epoch;
                        if waiting {
                            s.reload_shares(cx);
                        }
                        waiting
                    })
                    .unwrap_or(false);
                if !waiting {
                    break;
                }
            }
        })
        .detach();
    }
    /// `useProjectShares.reload`: only what a share's state needs, so a wait
    /// never touches the page being edited or an action in flight.
    fn reload_shares(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(project)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        self.shares_epoch += 1;
        let epoch = self.shares_epoch;
        let task = cx.background_spawn(async move {
            (client.mcp_endpoints(&project), client.dashboard(&project))
        });
        cx.spawn(async move |this, cx| {
            let (endpoints, dashboard) = task.await;
            this.update(cx, |s, cx| {
                if s.shares_epoch != epoch {
                    return;
                }
                if let Some(details) = &mut s.details {
                    details.endpoints_failed = endpoints.is_err();
                    if let Ok(endpoints) = endpoints {
                        details.endpoints = endpoints;
                    }
                    if let Ok(dashboard) = dashboard {
                        details.dashboard = Some(dashboard);
                    }
                }
                s.settle_pending(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn stop_share(&mut self, id: String, cx: &mut Context<Self>) {
        self.stop_failed = false;
        let Some(client) = self.client.clone() else {
            return;
        };
        if self.busy {
            return;
        }
        self.busy = true;
        let epoch = self.epoch;
        let task = cx.background_spawn(async move { client.delete_mcp_endpoint(&id) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                s.busy = false;
                match result {
                    Ok(()) => {
                        s.confirm_delete = None;
                        s.refresh(cx);
                    }
                    Err(_) => s.stop_failed = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn copy(&mut self, value: String, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(value));
        self.notice = Some(tr("cloud.status.copied").into());
        cx.notify();
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
impl CloudServices {
    fn navigation(&self, t: Theme, cx: &mut Context<Self>) -> impl IntoElement {
        let ty = theme::ty().ui;
        let active = self.section.nav();
        let mut nav = v_flex()
            .id("cloud-services-navigation")
            .w(px(208.))
            .h_full()
            .flex_shrink_0()
            .p(px(8.))
            .gap(px(2.))
            .border_r_1()
            .border_color(t.divider);
        let groups = [
            (
                "cloud.sidebar.projectGroup",
                vec![(Section::Contents, Icon::product(ProductIcon::Home))],
            ),
            (
                "cloud.sidebar.connectionsGroup",
                vec![
                    (Section::Mcp, Icon::new("plug")),
                    (Section::Cli, Icon::new("square-terminal")),
                ],
            ),
            ("cloud.sidebar.organizationGroup", {
                let mut entries = vec![(Section::Team, Icon::new("users"))];
                if crate::features::flags::CLOUD_BILLING {
                    entries.push((Section::Billing, Icon::new("credit-card")));
                }
                entries
            }),
        ];
        for (group, entries) in groups {
            nav = nav.child(
                div()
                    .px(px(8.))
                    .pt(px(10.))
                    .pb(px(4.))
                    .text_size(px(ty.caption))
                    .text_color(t.subtle)
                    .child(tr(group)),
            );
            for (section, icon) in entries {
                let selected = section == active;
                nav = nav.child(
                    h_flex()
                        .id(SharedString::from(format!("cloud-nav-{}", section.route())))
                        .h(px(30.))
                        .px(px(8.))
                        .gap(px(8.))
                        .rounded(px(6.))
                        .text_size(px(ty.meta))
                        .text_color(if selected { t.text } else { t.muted })
                        .when(selected, |d| d.bg(t.selected))
                        .hover(|d| d.bg(t.hover))
                        .on_click(cx.listener(move |s, _, _, cx| s.select(section, cx)))
                        .child(icon.with_size(px(14.)))
                        .child(tr(&format!("cloud.route.{}.label", section.route()))),
                );
            }
        }
        nav
    }
    fn content(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let notice = self.notice.clone().map(|text| {
            div()
                .text_size(px(theme::ty().ui.caption))
                .text_color(t.muted)
                .child(text)
                .into_any_element()
        });
        let page = match self.section {
            Section::Contents => self.contents(t, cx),
            Section::History => self.history(t, cx),
            Section::Settings => self.settings(t, cx),
            Section::Team => self.team(t, cx),
            Section::Share => self.share_page(t, cx),
            Section::Billing => self.billing_view(t, cx),
            _ => self.access(t, cx),
        };
        v_flex()
            .gap(px(16.))
            .children(notice)
            .child(page)
            .into_any_element()
    }
    fn heading(&self, t: Theme) -> Div {
        let ty = theme::ty().ui;
        v_flex()
            .gap(px(4.))
            .child(
                div()
                    .text_size(px(ty.body + 2.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(self.section.title()),
            )
            .child(
                div()
                    .text_size(px(ty.meta))
                    .text_color(t.muted)
                    .child(self.section.description()),
            )
    }
    fn back(&self, t: Theme, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex().child(
            Button::new("cloud-back")
                .variant(ButtonVariant::Secondary)
                .icon(Icon::new("arrow-left").with_size(px(13.)).color(t.muted))
                .label(tr("cloud.route.contents.label"))
                .on_click(cx.listener(|s, _, _, cx| s.select(Section::Contents, cx))),
        )
    }
    fn loading_row(&self, t: Theme) -> AnyElement {
        div()
            .text_size(px(theme::ty().ui.meta))
            .text_color(t.muted)
            .child(tr("cloud.common.loading"))
            .into_any_element()
    }
    fn contents(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let id = self.project.clone().unwrap_or_default();
        let name = details
            .project
            .as_ref()
            .map_or(id.clone(), |p| p.name.clone());
        let manage = details
            .project
            .as_ref()
            .is_some_and(|p| p.can("project.settings.manage"));
        let rows = details.rows(&id, Catalog::All);
        let (_, active) = access::metrics(&rows);
        let storage = details
            .dashboard
            .as_ref()
            .and_then(|d| d.nodes.storage_bytes)
            .map_or("—".to_owned(), format_bytes);
        let updated = latest_update(&details).unwrap_or_else(|| "—".into());
        let fact = |id: &'static str, label: &str, value: String| {
            v_flex()
                .id(id)
                .gap(px(2.))
                .px(px(10.))
                .py(px(6.))
                .rounded(px(6.))
                .hover(|d| d.bg(t.hover))
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.subtle)
                        .child(tr(label)),
                )
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(value),
                )
        };
        let card = |id: &'static str,
                    title: &str,
                    detail: &str,
                    section: Section,
                    cx: &mut Context<Self>| {
            v_flex()
                .id(id)
                .flex_1()
                .min_w_0()
                .gap(px(4.))
                .p(px(12.))
                .border_1()
                .border_color(t.border)
                .rounded(px(8.))
                .hover(|d| d.bg(t.hover))
                .on_click(cx.listener(move |s, _, _, cx| s.select(section, cx)))
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(tr(title)),
                )
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(tr(detail)),
                )
        };
        let mut entries: Vec<services::TreeEntry> = details
            .tree
            .as_ref()
            .map(|tree| tree.entries.clone())
            .unwrap_or_default();
        entries.sort_by(|a, b| {
            (a.kind != "folder")
                .cmp(&(b.kind != "folder"))
                .then_with(|| a.name.cmp(&b.name))
        });
        let list = v_flex().children(entries.into_iter().take(50).enumerate().map(|(i, entry)| {
            h_flex()
                .id(("cloud-entry", i))
                .h(px(28.))
                .gap(px(8.))
                .text_size(px(ty.meta))
                .text_color(t.text)
                .child(
                    (if entry.kind == "folder" {
                        Icon::product(ProductIcon::Folder)
                    } else {
                        Icon::new("file")
                    })
                    .with_size(px(14.))
                    .color(t.muted),
                )
                .child(entry.name)
        }));
        v_flex()
            .gap(px(16.))
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(px(ty.body + 4.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.text)
                            .child(name),
                    )
                    .when(manage, |h| {
                        h.child(
                            Button::new("cloud-open-settings")
                                .variant(ButtonVariant::Secondary)
                                .icon(Icon::new("settings").with_size(px(13.)).color(t.muted))
                                .accessibility_label(tr("cloud.route.settings.title"))
                                .on_click(
                                    cx.listener(|s, _, _, cx| s.select(Section::Settings, cx)),
                                ),
                        )
                    })
                    .child(
                        Button::new("cloud-refresh")
                            .variant(ButtonVariant::Secondary)
                            .icon(Icon::new("refresh-cw").with_size(px(13.)).color(t.muted))
                            .accessibility_label(tr("cloud.common.refresh"))
                            .on_click(cx.listener(|s, _, _, cx| s.refresh(cx))),
                    ),
            )
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(fact(
                        "cloud-fact-storage",
                        "cloud.overview.storageUsed",
                        storage,
                    ))
                    .child(
                        fact("cloud-fact-updated", "cloud.overview.lastUpdated", updated)
                            .on_click(cx.listener(|s, _, _, cx| s.select(Section::History, cx))),
                    )
                    .child(
                        fact(
                            "cloud-fact-connections",
                            "cloud.overview.activeConnections",
                            active.to_string(),
                        )
                        .on_click(cx.listener(|s, _, _, cx| s.select(Section::Access, cx))),
                    ),
            )
            .when(details.failed, |d| {
                d.child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.danger)
                                .child(tr("cloud.team.loadFailed")),
                        )
                        .child(
                            Button::new("cloud-retry")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.retry"))
                                .on_click(cx.listener(|s, _, _, cx| s.refresh(cx))),
                        ),
                )
            })
            .child(
                div()
                    .text_size(px(ty.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(tr("cloud.access.create.intentQuestion")),
            )
            .child(
                h_flex()
                    .items_start()
                    .gap(px(8.))
                    .child(card(
                        "cloud-action-mcp",
                        "cloud.access.create.intent.agent.label",
                        "cloud.access.create.intent.agent.preview",
                        Section::Mcp,
                        cx,
                    ))
                    .child(card(
                        "cloud-action-cli",
                        "cloud.access.create.intent.cli.label",
                        "cloud.route.cli.description",
                        Section::Cli,
                        cx,
                    ))
                    .child(card(
                        "cloud-action-git",
                        "cloud.access.create.intent.git.label",
                        "cloud.route.git-sync.description",
                        Section::GitSync,
                        cx,
                    )),
            )
            .child(list)
            .into_any_element()
    }
    fn access(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let catalog = self.section.catalog().unwrap_or(Catalog::All);
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let id = self.project.clone().unwrap_or_default();
        let manage = self.can_manage();
        let task = !matches!(self.section, Section::Mcp | Section::Cli);
        let server = cloud_account::environment(cx)
            .map(|e| services::mcp_server_url(e.api()))
            .unwrap_or_default();
        let mut page = v_flex()
            .gap(px(12.))
            .when(task, |d| d.child(self.back(t, cx)));
        page = page.child(self.heading(t));
        page = match self.creating.clone().filter(|_| manage) {
            Some(create) => page.child(self.create_form(create, t, cx)),
            None if manage => page.child(
                h_flex().justify_end().child(
                    Button::new("cloud-create-access")
                        .variant(ButtonVariant::Solid)
                        .label(tr(if catalog == Catalog::Mcp {
                            "cloud.access.create.intent.agent.label"
                        } else {
                            "cloud.access.new"
                        }))
                        .disabled(self.busy)
                        .on_click(cx.listener(|s, _, _, cx| s.begin_create(cx))),
                ),
            ),
            None => page,
        };
        for (index, point) in details.rows(&id, catalog).into_iter().enumerate() {
            let title = if !point.title.is_empty() {
                point.title.clone()
            } else {
                tr(match point.kind {
                    Kind::Cli => "cloud.access.surface.cli.title",
                    Kind::Git => "cloud.access.surface.git.title",
                    Kind::Mcp => "cloud.access.surface.mcp.title",
                })
                .to_owned()
            };
            let scope = point
                .view
                .name
                .clone()
                .unwrap_or_else(|| tr("cloud.scope.workspaceRoot").to_owned());
            let mut row = v_flex()
                .gap(px(8.))
                .p(px(12.))
                .border_1()
                .border_color(t.border)
                .rounded(px(8.))
                .child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .child(
                                    div()
                                        .text_size(px(ty.meta))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.text)
                                        .child(title),
                                )
                                .child(div().text_size(px(ty.caption)).text_color(t.muted).child(
                                    if point.subtitle.is_empty() {
                                        scope
                                    } else {
                                        point.subtitle.clone()
                                    },
                                )),
                        )
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(if point.status == Status::Error {
                                    t.danger
                                } else {
                                    t.muted
                                })
                                .child(status_label(&point.status_code)),
                        ),
                );
            for command in point
                .commands
                .iter()
                .filter(|c| c.id != CommandId::Explore || point.surface.is_some())
            {
                let value = command.value.clone();
                let label = match command.id {
                    CommandId::Explore => "cloud.access.command.explore",
                    CommandId::ExistingFolder => "cloud.access.command.existing-folder",
                    CommandId::Clone => "cloud.access.command.clone",
                };
                row = row.child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .gap(px(2.))
                                .child(
                                    div()
                                        .text_size(px(ty.caption))
                                        .text_color(t.muted)
                                        .child(tr(label)),
                                )
                                .child(
                                    div()
                                        .text_size(px(ty.caption))
                                        .font_family("Geist Mono")
                                        .text_color(t.text)
                                        .child(command.value.clone()),
                                ),
                        )
                        .child(
                            Button::new(("cloud-copy", index * 8 + command.id as usize))
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.copyValue"))
                                .disabled(command.disabled)
                                .on_click(
                                    cx.listener(move |s, _, _, cx| s.copy(value.clone(), cx)),
                                ),
                        ),
                );
            }
            if let Some((_, credential)) = self
                .issued
                .as_ref()
                .filter(|(issued, _)| Some(issued) == point.surface.as_ref())
            {
                let value = credential.clone();
                row = row.child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .text_size(px(ty.caption))
                                .font_family("Geist Mono")
                                .text_color(t.text)
                                .child(credential.clone()),
                        )
                        .child(
                            Button::new(("cloud-copy-key", index))
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.copyAccessKey"))
                                .on_click(
                                    cx.listener(move |s, _, _, cx| s.copy(value.clone(), cx)),
                                ),
                        ),
                );
            }
            if !point.placeholder && matches!(point.kind, Kind::Cli | Kind::Mcp) {
                let open = self.expanded.as_deref() == Some(point.id.as_str());
                let toggle = point.id.clone();
                row = row.child(
                    h_flex().justify_end().child(
                        Button::new(("cloud-permissions", index))
                            .variant(ButtonVariant::Secondary)
                            .label(tr(match (open, point.kind) {
                                (true, _) => "cloud.access.method.hideConfig",
                                (false, Kind::Cli) => "cloud.access.method.cli.action",
                                (false, _) => "cloud.access.method.mcp.viewConnection",
                            }))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.expanded = (s.expanded.as_deref() != Some(toggle.as_str()))
                                    .then(|| toggle.clone());
                                cx.notify();
                            })),
                    ),
                );
                if open {
                    row = row.child(self.permissions_panel(&point, &details, manage, index, t, cx));
                }
            }
            // A Scope's own settings; the Project root keeps its name and
            // has nothing to change or delete, so it has none.
            if point.kind == Kind::Cli
                && manage
                && let Some(scope) = details
                    .scopes
                    .iter()
                    .find(|s| s.id == point.view.id)
                    .cloned()
            {
                let open = self
                    .scope_edit
                    .as_ref()
                    .is_some_and(|(id, _)| *id == scope.id);
                let toggle = scope.clone();
                row =
                    row.child(
                        h_flex().justify_end().child(
                            Button::new(("cloud-scope-settings", index))
                                .variant(ButtonVariant::Secondary)
                                .label(tr(if open {
                                    "cloud.common.closeSettings"
                                } else {
                                    "cloud.common.openSettings"
                                }))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.toggle_scope_settings(&toggle, cx)
                                })),
                        ),
                    );
                if open {
                    row = row.child(self.scope_settings(&scope, t, cx));
                }
            }
            if point.kind == Kind::Mcp {
                if point.placeholder {
                    let view = point.view.clone();
                    row = row.when(manage, |row| {
                        row.child(
                            h_flex().justify_end().child(
                                Button::new(("cloud-mcp-create", index))
                                    .variant(ButtonVariant::Solid)
                                    .label(tr("cloud.access.method.mcp.create"))
                                    .disabled(self.busy)
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        s.create_mcp(view.clone(), cx)
                                    })),
                            ),
                        )
                    });
                } else if !server.is_empty() {
                    let value = server.clone();
                    row = row.child(
                        h_flex().justify_end().child(
                            Button::new(("cloud-mcp-url", index))
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.access.command.server-url"))
                                .on_click(
                                    cx.listener(move |s, _, _, cx| s.copy(value.clone(), cx)),
                                ),
                        ),
                    );
                }
            }
            page = page.child(row);
        }
        page.into_any_element()
    }
    /// `DesktopCloudPermissionPanel`. It shows what is allowed to everyone;
    /// only someone who manages access can change it.
    fn permissions_panel(
        &self,
        point: &access::Point,
        details: &Details,
        manage: bool,
        row: usize,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Div {
        let ty = theme::ty().ui;
        let mode = details
            .scopes
            .iter()
            .find(|s| s.id == point.view.id)
            .map_or("rw", |s| s.max_mode.as_str());
        let surface = point.surface.as_deref();
        let (title, groups, allowed, available, unavailable, footer) = if point.kind == Kind::Cli {
            let connector = surface.and_then(|id| details.surfaces.iter().find(|s| s.id == id));
            (
                "cloud.access.permissions.title",
                permissions::cli_groups(mode),
                permissions::parse_cli(connector.map_or(&serde_json::Value::Null, |s| &s.config)),
                connector.is_some(),
                "cloud.access.permissions.cliUnavailable",
                None,
            )
        } else {
            let endpoint = surface.and_then(|id| details.endpoints.iter().find(|e| e.id == id));
            (
                "cloud.access.permissions.mcpTools",
                permissions::mcp_groups(permissions::mcp_writable(
                    endpoint.map_or(&[], |e| e.accesses.as_slice()),
                    mode,
                )),
                permissions::parse_mcp(
                    endpoint.map_or(&serde_json::Value::Null, |e| &e.tools_config),
                ),
                endpoint.is_some(),
                "cloud.access.permissions.mcpUnavailable",
                Some("cloud.access.permissions.mcpPolicyFooter"),
            )
        };
        let can_update = manage && available;
        let caption = |color: Hsla, text: SharedString| {
            div()
                .text_size(px(ty.caption))
                .text_color(color)
                .child(text)
        };
        let mut panel = v_flex().gap(px(8.)).child(
            div()
                .text_size(px(ty.meta))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .child(tr(title)),
        );
        for (index, group) in groups.into_iter().enumerate() {
            let disabled = !can_update || self.busy || group.muted;
            let meta = if group.muted {
                tr("cloud.access.permissions.blockedByScope").to_owned()
            } else {
                tf(
                    "cloud.access.permissions.groupMeta",
                    &[
                        ("allowed", (group.count(&allowed) as i64).into()),
                        ("total", (group.keys.len() as i64).into()),
                    ],
                )
            };
            let next = group.toggled(&allowed);
            let target = point.clone();
            let all = Button::new(("cloud-permission-all", row * 8 + index))
                .variant(if group.all(&allowed) {
                    ButtonVariant::Solid
                } else {
                    ButtonVariant::Secondary
                })
                .label(tr("cloud.common.all"))
                .disabled(disabled)
                .on_click(cx.listener(move |s, _, _, cx| s.set_permissions(&target, &next, cx)));
            let pills = group.keys.iter().enumerate().map(|(position, key)| {
                let key = *key;
                let enabled = !group.muted && allowed.contains(key);
                let next = permissions::toggled(&allowed, key);
                let target = point.clone();
                Button::new(("cloud-permission", row * 256 + index * 32 + position))
                    .variant(match (enabled, group.danger) {
                        (true, true) => ButtonVariant::SolidDanger,
                        (true, false) => ButtonVariant::Solid,
                        _ => ButtonVariant::Secondary,
                    })
                    .label(key)
                    .disabled(disabled)
                    .on_click(cx.listener(move |s, _, _, cx| s.set_permissions(&target, &next, cx)))
            });
            panel = panel.child(
                v_flex()
                    .gap(px(6.))
                    .child(
                        h_flex()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .text_size(px(ty.caption))
                                    .text_color(t.text)
                                    .child(tr(group.title)),
                            )
                            .child(caption(t.muted.into(), meta.into()))
                            .child(all),
                    )
                    .child(h_flex().flex_wrap().gap(px(4.)).children(pills)),
            );
        }
        panel
            .when(!can_update, |d| {
                d.child(caption(t.muted.into(), tr(unavailable).into()))
            })
            .children(footer.map(|key| caption(t.muted.into(), tr(key).into())))
    }
    /// `CloudScopeSettingsBlock`.
    fn scope_settings(&self, scope: &Scope, t: Theme, cx: &mut Context<Self>) -> Div {
        let ty = theme::ty().ui;
        let dirty = self.scope_dirty(scope, cx);
        let mode = self.scope_edit.as_ref().map_or("r", |(_, mode)| *mode);
        let label = |key: &'static str| {
            div()
                .text_size(px(ty.caption))
                .text_color(t.muted)
                .child(tr(key))
        };
        let mode_button = |id: &'static str, value: &'static str, key: &'static str| {
            Button::new(id)
                .variant(if mode == value {
                    ButtonVariant::Solid
                } else {
                    ButtonVariant::Secondary
                })
                .label(tr(key))
                .disabled(self.busy)
                .on_click(cx.listener(move |s, _, _, cx| {
                    if let Some(edit) = &mut s.scope_edit {
                        edit.1 = value;
                    }
                    cx.notify();
                }))
        };
        let read_only = mode_button("cloud-scope-read", "r", "cloud.scope.readOnly");
        let read_write = mode_button("cloud-scope-write", "rw", "cloud.scope.readWrite");
        let confirming = self.confirm_delete.as_deref() == Some(scope.id.as_str());
        let (remove, discard, save) = (scope.id.clone(), scope.clone(), scope.clone());
        v_flex()
            .gap(px(8.))
            .pt(px(4.))
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("cloud.common.settings")),
                    )
                    .when(dirty, |d| d.child(label("cloud.common.unsaved"))),
            )
            .child(label("cloud.common.name"))
            .child(self.scope_edit_name.clone())
            .child(label("cloud.common.permission"))
            .child(h_flex().gap(px(6.)).child(read_only).child(read_write))
            .child(label("cloud.scope.exclude"))
            .child(self.scope_exclude.clone())
            .child(label("cloud.scope.excludeHelp"))
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(px(ty.caption))
                            .text_color(t.danger)
                            .child(tr("cloud.scope.deleteHelp")),
                    )
                    .child(
                        Button::new("cloud-scope-delete")
                            .variant(if confirming {
                                ButtonVariant::SolidDanger
                            } else {
                                ButtonVariant::Secondary
                            })
                            .label(tr(if confirming {
                                "cloud.common.confirmDelete"
                            } else {
                                "cloud.scope.deleteAccess"
                            }))
                            .disabled(self.busy)
                            .on_click(cx.listener(move |s, _, _, cx| {
                                if s.confirm_delete.as_deref() == Some(remove.as_str()) {
                                    s.delete_scope(remove.clone(), cx);
                                } else {
                                    s.arm_delete(remove.clone(), cx);
                                }
                            })),
                    ),
            )
            .when(dirty, |d| {
                d.child(
                    h_flex()
                        .gap(px(6.))
                        .justify_end()
                        .child(label("cloud.common.unsavedChanges"))
                        .child(
                            Button::new("cloud-scope-discard")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.discard"))
                                .disabled(self.busy)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.fill_scope_form(&discard, cx);
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("cloud-scope-save")
                                .variant(ButtonVariant::Solid)
                                .label(tr(if self.busy {
                                    "cloud.common.saving"
                                } else {
                                    "cloud.common.saveChanges"
                                }))
                                .disabled(self.busy)
                                .on_click(
                                    cx.listener(move |s, _, _, cx| s.save_scope(save.clone(), cx)),
                                ),
                        ),
                )
            })
    }
    /// `CloudShareHome`: who can read the Project, and who else could.
    fn share_page(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        if let Some(flow) = self.share_flow.clone() {
            return self.share_wizard(flow, &details, t, cx);
        }
        if self.share_readers {
            return self.share_readers_step(t, cx);
        }
        let name = details
            .project
            .as_ref()
            .map_or(String::new(), |p| p.name.clone());
        let mut page = v_flex()
            .gap(px(12.))
            .child(
                div()
                    .text_size(px(ty.body + 2.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.text)
                    .child(tr("cloud.share.location.shareAction")),
            )
            .child(
                div()
                    .text_size(px(ty.meta))
                    .text_color(t.muted)
                    .child(tf("cloud.share.readers.title", &[("project", name.into())])),
            );
        page = page.child(self.share_status_card(t, cx));
        page = page.child(
            div()
                .pt(px(8.))
                .text_size(px(ty.meta))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .child(tr("cloud.share.target.question")),
        );
        let mut grid = h_flex().flex_wrap().items_start().gap(px(8.));
        for (index, target) in share::TARGETS.iter().copied().enumerate() {
            grid = grid.child(
                v_flex()
                    .id(("cloud-share-target", index))
                    .w(px(320.))
                    .gap(px(2.))
                    .p(px(10.))
                    .border_1()
                    .border_color(t.border)
                    .rounded(px(8.))
                    .hover(|d| d.bg(t.hover))
                    .on_click(cx.listener(move |s, _, _, cx| s.begin_share(target, cx)))
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(target_label(&target)),
                    )
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(tr(&format!("cloud.share.target.{}.preview", target.id))),
                    ),
            );
        }
        page.child(grid).into_any_element()
    }
    fn share_wizard(
        &mut self,
        flow: ShareFlow,
        details: &Details,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty().ui;
        let label = target_label(&flow.target);
        let heading = div()
            .text_size(px(ty.body + 2.))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(t.text)
            .child(label.clone());
        let back = Button::new("cloud-share-back")
            .variant(ButtonVariant::Secondary)
            .icon(Icon::new("arrow-left").with_size(px(13.)).color(t.muted))
            .label(tr("cloud.share.action.back"))
            .on_click(cx.listener(|s, _, _, cx| {
                s.share_epoch += 1;
                s.share_flow = None;
                cx.notify();
            }));
        let page = v_flex()
            .gap(px(12.))
            .child(h_flex().child(back))
            .child(heading);
        match flow.phase.clone() {
            SharePhase::Choose => {
                let folders = scope_folders(details, &self.share_path);
                let option = |id: (&'static str, usize),
                              path: String,
                              text: String,
                              cx: &mut Context<Self>| {
                    let chosen = flow.path == path;
                    Button::new(id)
                        .variant(if chosen {
                            ButtonVariant::Solid
                        } else {
                            ButtonVariant::Secondary
                        })
                        .label(text)
                        .on_click(cx.listener(move |s, _, _, cx| {
                            if let Some(flow) = &mut s.share_flow {
                                flow.path = path.clone();
                            }
                            cx.notify();
                        }))
                };
                let mut scope = h_flex().flex_wrap().gap(px(6.)).child(option(
                    ("cloud-share-path", 0),
                    String::new(),
                    tr("cloud.share.scope.whole").to_owned(),
                    cx,
                ));
                for (index, folder) in folders.into_iter().enumerate() {
                    let text = access::path_label(&folder);
                    scope = scope.child(option(("cloud-share-path", index + 1), folder, text, cx));
                }
                let page = page
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(tr("cloud.share.scope.question")),
                    )
                    .child(scope);
                let page = if flow.target.channel == share::Channel::Mcp {
                    let mode = |id: &'static str,
                                value: &'static str,
                                key: &str,
                                cx: &mut Context<Self>| {
                        Button::new(id)
                            .variant(if flow.mode == value {
                                ButtonVariant::Solid
                            } else {
                                ButtonVariant::Secondary
                            })
                            .label(tr(key))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                if let Some(flow) = &mut s.share_flow {
                                    flow.mode = value;
                                }
                                cx.notify();
                            }))
                    };
                    let read = mode("cloud-share-read", "r", "cloud.share.scope.readOnly", cx);
                    let write = mode("cloud-share-write", "rw", "cloud.share.scope.readWrite", cx);
                    page.child(h_flex().gap(px(6.)).child(read).child(write))
                } else {
                    page
                };
                page.child(
                    h_flex().justify_end().child(
                        Button::new("cloud-share-next")
                            .variant(ButtonVariant::Solid)
                            .label(tr("cloud.share.action.next"))
                            .on_click(cx.listener(|s, _, _, cx| s.issue_share(cx))),
                    ),
                )
                .into_any_element()
            }
            SharePhase::Issuing => page
                .child(div().text_size(px(ty.meta)).text_color(t.muted).child(tf(
                    "cloud.share.publish.issuing",
                    &[("target", label.clone().into())],
                )))
                .into_any_element(),
            SharePhase::Failed => page
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .text_color(t.danger)
                        .child(tr("cloud.share.error.issueFailed")),
                )
                .child(
                    h_flex().child(
                        Button::new("cloud-share-retry")
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.share.action.retry"))
                            .on_click(cx.listener(|s, _, _, cx| s.issue_share(cx))),
                    ),
                )
                .into_any_element(),
            SharePhase::Ready { key, reused, .. } => {
                let connected = self.share_connected(&flow);
                let copy_row =
                    |id: &'static str, title: &str, value: String, cx: &mut Context<Self>| {
                        let copied = value.clone();
                        h_flex()
                            .gap(px(8.))
                            .child(
                                v_flex()
                                    .flex_1()
                                    .min_w_0()
                                    .child(
                                        div()
                                            .text_size(px(ty.caption))
                                            .text_color(t.muted)
                                            .child(tr(title)),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(ty.caption))
                                            .font_family("Geist Mono")
                                            .text_color(t.text)
                                            .child(value),
                                    ),
                            )
                            .child(
                                Button::new(id)
                                    .variant(ButtonVariant::Secondary)
                                    .label(tr("cloud.share.action.copy"))
                                    .on_click(
                                        cx.listener(move |s, _, _, cx| s.copy(copied.clone(), cx)),
                                    ),
                            )
                    };
                let mut page = page.child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(tf(
                            "cloud.share.handoff.title",
                            &[("target", label.clone().into())],
                        )),
                );
                for step in 1..=flow.target.steps {
                    page = page.child(div().text_size(px(ty.meta)).text_color(t.text).child(
                        format!(
                            "{step}. {}",
                            tr(&format!(
                                "cloud.share.handoff.{}.step{step}",
                                flow.target.id
                            ))
                        ),
                    ));
                }
                let landed = connected || flow.target.channel == share::Channel::Link;
                let environment = cloud_account::environment(cx);
                if flow.target.channel == share::Channel::Mcp {
                    let server = environment
                        .as_ref()
                        .map(|e| services::mcp_server_url(e.api()))
                        .unwrap_or_default();
                    page = page.child(copy_row(
                        "cloud-share-url",
                        "cloud.share.handoff.serverUrl",
                        server,
                        cx,
                    ));
                    page = match key {
                        Some(key) => page.child(copy_row(
                            "cloud-share-key",
                            "cloud.share.handoff.apiKey",
                            key,
                            cx,
                        )),
                        None if reused => page.child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.muted)
                                .child(tr("cloud.share.handoff.apiKeyReused")),
                        ),
                        None => page,
                    };
                    page = page.child(div().text_size(px(ty.caption)).text_color(t.muted).child(
                        tf(
                            if connected {
                                "cloud.share.receipt.connected"
                            } else {
                                "cloud.share.receipt.waiting"
                            },
                            &[("target", label.clone().into())],
                        ),
                    ));
                } else if let Some(link) = environment.as_ref().and_then(|e| {
                    let project = self.project.as_deref()?;
                    crate::workspace::cloud::locator::resource_url(
                        e.web(),
                        project,
                        &flow.path,
                        true,
                    )
                    .ok()
                }) {
                    page = page
                        .child(copy_row(
                            "cloud-share-link",
                            "cloud.share.handoff.link",
                            link,
                            cx,
                        ))
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .text_color(t.muted)
                                .child(tr("cloud.share.handoff.linkNote")),
                        );
                }
                let docs = flow.target.docs;
                page.children(docs.map(|url| {
                    Button::new("cloud-share-docs")
                        .variant(ButtonVariant::Secondary)
                        .label(tf(
                            "cloud.share.handoff.docs",
                            &[("target", label.clone().into())],
                        ))
                        .on_click(move |_, _, cx| cx.open_url(url))
                }))
                .child(
                    h_flex()
                        .justify_end()
                        .gap(px(8.))
                        .child(
                            Button::new("cloud-share-another")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.share.action.shareAnother"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.share_epoch += 1;
                                    s.share_flow = None;
                                    s.share_readers =
                                        s.share_rows().iter().any(share::Share::active);
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("cloud-share-done")
                                .variant(if landed {
                                    ButtonVariant::Solid
                                } else {
                                    ButtonVariant::Secondary
                                })
                                .label(tr("cloud.share.action.done"))
                                .on_click(cx.listener(|s, _, _, cx| s.finish_share(cx))),
                        ),
                )
                .into_any_element()
            }
        }
    }
    /// `CreateAccessDialog`: a folder, a name and a permission.
    fn create_form(
        &mut self,
        create: Create,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let ty = theme::ty().ui;
        let selected = create.path.clone();
        let label = selected.as_deref().map_or(
            tr("cloud.access.create.choosePath").to_owned(),
            access::path_label,
        );
        let up = (!create.browsing.is_empty()).then(|| {
            let parent = create
                .browsing
                .rsplit_once('/')
                .map_or(String::new(), |(p, _)| p.to_owned());
            Button::new("cloud-folder-up")
                .variant(ButtonVariant::Secondary)
                .icon(Icon::new("arrow-left").with_size(px(13.)).color(t.muted))
                .label(access::path_label(&parent))
                .on_click(cx.listener(move |s, _, _, cx| s.read_folder(parent.clone(), cx)))
        });
        let rows: Vec<_> = create
            .folders
            .iter()
            .enumerate()
            .map(|(index, path)| {
                let (open, choose) = (path.clone(), path.clone());
                let chosen = selected.as_deref() == Some(path.as_str());
                h_flex()
                    .id(("cloud-folder", index))
                    .h(px(28.))
                    .px(px(6.))
                    .gap(px(8.))
                    .rounded(px(6.))
                    .text_size(px(ty.meta))
                    .text_color(t.text)
                    .when(chosen, |d| d.bg(t.selected))
                    .hover(|d| d.bg(t.hover))
                    .on_click(cx.listener(move |s, _, _, cx| s.choose_path(choose.clone(), cx)))
                    .child(
                        Icon::product(ProductIcon::Folder)
                            .with_size(px(14.))
                            .color(t.muted),
                    )
                    .child(div().flex_1().min_w_0().child(access::path_label(path)))
                    .child(
                        Button::new(("cloud-folder-open", index))
                            .variant(ButtonVariant::Secondary)
                            .icon(Icon::new("chevron-right").with_size(px(13.)).color(t.muted))
                            .accessibility_label(tr("cloud.common.open"))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                cx.stop_propagation();
                                s.read_folder(open.clone(), cx)
                            })),
                    )
            })
            .collect();
        let mode = create.mode;
        let mode_button = |id: &'static str, value: &'static str, key: &str| {
            Button::new(id)
                .variant(if mode == value {
                    ButtonVariant::Solid
                } else {
                    ButtonVariant::Secondary
                })
                .label(tr(key))
                .on_click(cx.listener(move |s, _, _, cx| {
                    if let Some(create) = &mut s.creating {
                        create.mode = value;
                    }
                    cx.notify();
                }))
        };
        let read = mode_button("cloud-create-read", "r", "cloud.scope.readOnly");
        let write = mode_button("cloud-create-write", "rw", "cloud.scope.readWrite");
        let ready = create.path.is_some() && !self.scope_name.read(cx).text().trim().is_empty();
        v_flex()
            .gap(px(8.))
            .p(px(12.))
            .border_1()
            .border_color(t.border)
            .rounded(px(8.))
            .child(
                div()
                    .text_size(px(ty.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(tr("cloud.access.create.title")),
            )
            .children(up)
            .when(create.failed, |d| {
                d.child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.danger)
                        .child(tr("cloud.access.create.folderLoadFailed")),
                )
            })
            .children(rows)
            .child(
                div()
                    .text_size(px(ty.caption))
                    .text_color(t.muted)
                    .child(label),
            )
            .child(
                v_flex()
                    .gap(px(4.))
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(tr("cloud.access.create.name")),
                    )
                    .child(self.scope_name.clone()),
            )
            .child(
                h_flex()
                    .gap(px(6.))
                    .child(read)
                    .child(write)
                    .child(div().flex_1())
                    .child(
                        Button::new("cloud-create-cancel")
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.common.cancel"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.creating = None;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("cloud-create-submit")
                            .variant(ButtonVariant::Solid)
                            .label(tr("cloud.access.create.action"))
                            .disabled(self.busy || !ready)
                            .on_click(cx.listener(|s, _, _, cx| s.create_access(cx))),
                    ),
            )
    }
    fn history(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let Some(history) = details.history else {
            return v_flex()
                .gap(px(12.))
                .child(self.back(t, cx))
                .child(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(ty.meta))
                                .text_color(t.muted)
                                .child(tr("cloud.team.loadFailed")),
                        )
                        .child(
                            Button::new("cloud-history-retry")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.retry"))
                                .on_click(cx.listener(|s, _, _, cx| s.refresh(cx))),
                        ),
                )
                .into_any_element();
        };
        let rows = graph::rows(&history);
        let width = graph::width(&rows);
        let list = v_flex()
            .id("cloud-history-list")
            .w(px(380.))
            .flex_shrink_0()
            .overflow_y_scroll()
            .track_scroll(&self.list_scroll)
            .children(rows.into_iter().enumerate().map(|(index, row)| {
                let id = row.id.clone();
                let commit = history.commits.iter().find(|c| c.id == row.id);
                let message = commit.map_or(String::new(), |c| {
                    if c.message.is_empty() {
                        tr("cloud.history.updateWorkspace").to_owned()
                    } else {
                        c.message.clone()
                    }
                });
                let selected = self.commit.as_deref() == Some(id.as_str());
                let clickable = row.commit;
                h_flex()
                    .id(("cloud-history-row", index))
                    .h(px(GRAPH_ROW))
                    .gap(px(6.))
                    .when(selected, |d| d.bg(t.selected))
                    .hover(|d| d.bg(t.hover))
                    .when(clickable, |d| {
                        d.on_click(cx.listener(move |s, _, _, cx| s.open_commit(id.clone(), cx)))
                    })
                    .child(graph_cell(&row, width, t))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(ty.meta))
                            .text_color(t.text)
                            .child(message),
                    )
                    .children(row.labels.first().map(|label| {
                        div()
                            .flex_shrink_0()
                            .px(px(6.))
                            .rounded(px(4.))
                            .bg(t.control)
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(label.name.clone())
                    }))
            }));
        let detail = v_flex()
            .flex_1()
            .min_w_0()
            .gap(px(6.))
            .pl(px(16.))
            .children(self.detail.as_ref().map(|commit| {
                v_flex()
                    .gap(px(4.))
                    .child(
                        div()
                            .text_size(px(ty.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text)
                            .child(commit.message.clone()),
                    )
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(commit.who.clone()),
                    )
                    .children(commit.changes.iter().take(200).map(|change| {
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.text)
                            .child(change.path.clone())
                    }))
            }));
        v_flex()
            .gap(px(12.))
            .child(self.back(t, cx))
            .child(self.heading(t))
            .child(h_flex().items_start().child(list).child(detail))
            .into_any_element()
    }
    fn settings(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let project = details.project.clone().unwrap_or_default();
        if !project.can("project.settings.manage") {
            return v_flex()
                .gap(px(8.))
                .child(self.back(t, cx))
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(tr("cloud.settings.restrictedTitle")),
                )
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(tr("cloud.settings.restrictedDetail")),
                )
                .into_any_element();
        }
        let field = |label: &str, input: Entity<TextInput>| {
            v_flex()
                .gap(px(4.))
                .child(
                    div()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(tr(label)),
                )
                .child(input)
        };
        let visibility = project.visibility.as_deref().unwrap_or("org");
        let id = project.id.clone();
        let remote = details.identity.as_ref().map(|i| i.url.clone());
        v_flex()
            .gap(px(12.))
            .child(self.back(t, cx))
            .child(self.heading(t))
            .child(field("cloud.common.name", self.name.clone()))
            .child(field(
                "cloud.settings.description",
                self.description.clone(),
            ))
            .child(field("cloud.git.branch", self.branch.clone()))
            .child(
                div()
                    .text_size(px(ty.caption))
                    .text_color(t.muted)
                    .child(tr("cloud.settings.branchHelp")),
            )
            .child(
                h_flex().justify_end().child(
                    Button::new("cloud-settings-save")
                        .variant(ButtonVariant::Solid)
                        .label(tr(if self.busy {
                            "cloud.common.saving"
                        } else {
                            "cloud.common.saveChanges"
                        }))
                        .disabled(self.busy)
                        .on_click(cx.listener(|s, _, _, cx| s.save_general(cx))),
                ),
            )
            .child(
                div()
                    .text_size(px(ty.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(tr("cloud.settings.visibilityTitle")),
            )
            .child(
                h_flex()
                    .gap(px(6.))
                    .child(
                        Button::new("cloud-visibility-org")
                            .variant(if visibility == "org" {
                                ButtonVariant::Solid
                            } else {
                                ButtonVariant::Secondary
                            })
                            .label(tr("cloud.settings.visibilityOrganization"))
                            .disabled(self.busy || visibility == "org")
                            .on_click(cx.listener(|s, _, _, cx| s.set_visibility("org", cx))),
                    )
                    .child(
                        Button::new("cloud-visibility-private")
                            .variant(if visibility == "private" {
                                ButtonVariant::Solid
                            } else {
                                ButtonVariant::Secondary
                            })
                            .label(tr("cloud.settings.visibilityPrivate"))
                            .disabled(self.busy || visibility == "private")
                            .on_click(cx.listener(|s, _, _, cx| s.set_visibility("private", cx))),
                    ),
            )
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(ty.caption))
                                    .text_color(t.muted)
                                    .child(tr("cloud.project.id")),
                            )
                            .child(
                                div()
                                    .text_size(px(ty.caption))
                                    .font_family("Geist Mono")
                                    .text_color(t.text)
                                    .child(id.clone()),
                            ),
                    )
                    .child(
                        Button::new("cloud-copy-id")
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.common.copyValue"))
                            .on_click(cx.listener(move |s, _, _, cx| s.copy(id.clone(), cx))),
                    ),
            )
            .children(remote.map(|url| {
                v_flex()
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .text_color(t.muted)
                            .child(tr("cloud.overview.repositoryRemote")),
                    )
                    .child(
                        div()
                            .text_size(px(ty.caption))
                            .font_family("Geist Mono")
                            .text_color(t.text)
                            .child(url),
                    )
            }))
            .into_any_element()
    }
    /// `CloudOrganizationSelector`: only when there is a choice to make.
    fn organization_chooser(&self, cx: &mut Context<Self>) -> Option<Div> {
        (self.team.organizations.len() > 1).then(|| {
            let selected = self.team.selected.clone();
            let buttons: Vec<_> = self
                .team
                .organizations
                .iter()
                .enumerate()
                .map(|(index, org)| {
                    let id = org.id.clone();
                    Button::new(("cloud-org", index))
                        .variant(if selected.as_deref() == Some(org.id.as_str()) {
                            ButtonVariant::Solid
                        } else {
                            ButtonVariant::Secondary
                        })
                        .label(org.name.clone())
                        .on_click(
                            cx.listener(move |s, _, _, cx| s.select_organization(id.clone(), cx)),
                        )
                })
                .collect();
            h_flex().gap(px(6.)).children(buttons)
        })
    }
    fn team(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let team = self.team.clone();
        let web = cloud_account::environment(cx).map(|e| e.web().to_owned());
        let mut page = v_flex().gap(px(12.)).child(self.heading(t));
        page = page.children(self.organization_chooser(cx));
        let invite = Button::new("cloud-invite")
            .variant(ButtonVariant::Solid)
            .icon(Icon::new("mail").with_size(px(14.)))
            .label(tr("cloud.team.inviteMember"))
            .disabled(team.selected.is_none())
            .on_click(move |_, _, cx| {
                if let Some(web) = &web {
                    cx.open_url(&format!("{}/team", web.trim_end_matches('/')));
                }
            });
        page = page.child(h_flex().justify_end().child(invite));
        if team.failed {
            return page
                .child(
                    div()
                        .text_size(px(ty.meta))
                        .text_color(t.danger)
                        .child(tr("cloud.team.loadFailed")),
                )
                .into_any_element();
        }
        if team.loading {
            return page.child(self.loading_row(t)).into_any_element();
        }
        if let (Some(entitlements), Some(seats)) = (&team.entitlements, &team.seats) {
            page = page.child(
                div()
                    .text_size(px(ty.caption))
                    .text_color(t.muted)
                    .child(tf(
                        "cloud.team.seatsUsed",
                        &[
                            ("used", (seats.billable_seat_quantity as i64).into()),
                            ("limit", (entitlements.seat_quantity as i64).into()),
                            ("plan", entitlements.plan_id.clone().into()),
                        ],
                    )),
            );
        }
        page.children(team.members.iter().map(|member| {
            let name = member
                .display_name
                .clone()
                .or_else(|| member.email.clone())
                .unwrap_or_else(|| tr("cloud.team.cloudUser").to_owned());
            h_flex()
                .h(px(32.))
                .gap(px(8.))
                .text_size(px(ty.meta))
                .text_color(t.text)
                .child(div().flex_1().min_w_0().child(name))
                .child(div().text_size(px(ty.caption)).text_color(t.muted).child(
                    match member.role.as_str() {
                        "owner" => tr("cloud.team.role.owner"),
                        "member" => tr("cloud.team.role.member"),
                        "viewer" => tr("cloud.team.role.viewer"),
                        _ => "",
                    },
                ))
        }))
        .into_any_element()
    }
}

/// `HISTORY_GRAPH_ROW_HEIGHT`.
const GRAPH_ROW: f32 = 30.;
/// `HistoryGraphVisual`: lanes and the node of one row.
fn graph_cell(row: &graph::Row, width: f32, t: Theme) -> impl IntoElement {
    let row = row.clone();
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let y_of = |anchor: graph::Anchor| match anchor {
                graph::Anchor::Top => 0.,
                graph::Anchor::Middle => GRAPH_ROW / 2.,
                graph::Anchor::Bottom => GRAPH_ROW,
            };
            let at = |x: f32, y: f32| bounds.origin + point(px(x), px(y));
            for segment in &row.segments {
                let (x0, x1) = (
                    graph::lane_x(segment.from_lane),
                    graph::lane_x(segment.to_lane),
                );
                let (y0, y1) = (y_of(segment.from), y_of(segment.to));
                let mut path = PathBuilder::stroke(px(1.5));
                path.move_to(at(x0, y0));
                if x0 == x1 || y0 == y1 {
                    path.line_to(at(x1, y1));
                } else {
                    let middle = y0 + (y1 - y0) / 2.;
                    path.cubic_bezier_to(at(x1, y1), at(x0, middle), at(x1, middle));
                }
                if let Ok(path) = path.build() {
                    window.paint_path(path, theme::history_graph_color(segment.color));
                }
            }
            let square = |lane: usize, half: f32| Bounds {
                origin: at(graph::lane_x(lane) - half, GRAPH_ROW / 2. - half),
                size: size(px(half * 2.), px(half * 2.)),
            };
            for marker in &row.ref_markers {
                window.paint_quad(
                    fill(
                        square(marker.lane, 5.),
                        theme::history_graph_color(marker.color),
                    )
                    .corner_radii(px(3.)),
                );
            }
            let current = row.labels.iter().any(|l| l.current);
            let color = theme::history_graph_color(row.node_color);
            window.paint_quad(fill(square(row.node_lane, 5.5), t.overlay).corner_radii(px(3.)));
            window.paint_quad(quad(
                square(row.node_lane, if current { 4. } else { 3.5 }),
                px(2.),
                if current { color } else { t.overlay },
                px(1.5),
                color,
                BorderStyle::Solid,
            ));
        },
    )
    .w(px(width))
    .h(px(GRAPH_ROW))
    .flex_shrink_0()
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
        request: crate::cloud_auth::model::ApiRequest,
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
        self.open_with(client, "lab".into(), section, cx);
    }
    /// `shell-cloud-services-share-{waiting,readers}`.
    #[cfg(feature = "dev-capture")]
    pub fn lab_share(&mut self, waiting: bool, cx: &mut Context<Self>) {
        let client = Client::new(Arc::new(LabCloud { shared: true }));
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

mod billing;
mod share_status;
#[cfg(test)]
mod tests;
