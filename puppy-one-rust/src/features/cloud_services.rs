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
        graph, history,
        services::{self, Client, Dashboard, Identity, McpEndpoint, Project, Scope, Surface, Tree},
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
        let mut details = Self {
            project: read!(client.project(id)),
            dashboard: read!(client.dashboard(id)),
            tree: read!(client.tree(id)),
            history: read!(read_history(client, id)),
            scopes: read!(client.scopes(id)).unwrap_or_default(),
            surfaces: read!(client.surfaces(id)).unwrap_or_default(),
            endpoints: read!(client.mcp_endpoints(id)).unwrap_or_default(),
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
    /// One-time credential: (surface, value), shown until this view closes.
    issued: Option<(String, String)>,
    confirm_delete: Option<String>,
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
        self.client = Some(client);
        self.project = Some(project);
        self.section = section;
        self.refresh(cx);
        self.enter(section, cx);
        cx.notify();
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
        self.notice = None;
        self.scroll.set_offset(point(px(0.), px(0.)));
        self.enter(section, cx);
        cx.notify();
    }
    fn enter(&mut self, section: Section, cx: &mut Context<Self>) {
        if section == Section::Team && self.team.organizations.is_empty() && !self.team.loading {
            self.load_team(cx);
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
                s.details = Some(details);
                s.loading = false;
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
                    Err(_) => s.notice = Some(tr("cloud.settings.saveFailed").into()),
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
    fn set_paused(&mut self, surface: String, paused: bool, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else {
            return;
        };
        self.mutate(
            move |client| {
                client
                    .set_surface_paused(&project, &surface, paused)
                    .map(|_| None)
            },
            cx,
        );
    }
    fn delete_surface(&mut self, surface: String, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else {
            return;
        };
        self.mutate(
            move |client| client.delete_surface(&project, &surface).map(|_| None),
            cx,
        );
    }
    fn regenerate(&mut self, surface: String, cx: &mut Context<Self>) {
        self.mutate(
            move |client| {
                client
                    .regenerate_key(&surface)
                    .map(|key| Some((surface, key)))
            },
            cx,
        );
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
            (
                "cloud.sidebar.organizationGroup",
                vec![(Section::Team, Icon::new("users"))],
            ),
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
        let task = !matches!(self.section, Section::Mcp | Section::Cli);
        let mut page = v_flex()
            .gap(px(12.))
            .when(task, |d| d.child(self.back(t, cx)));
        page = page.child(self.heading(t));
        for (index, point) in details.rows(&id, catalog).into_iter().enumerate() {
            let surface = point.surface.clone();
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
                .filter(|(issued, _)| Some(issued) == surface.as_ref())
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
            if let Some(surface) = surface {
                let paused = point.status_code == "paused";
                let (a, b, c) = (surface.clone(), surface.clone(), surface.clone());
                let confirming = self.confirm_delete.as_deref() == Some(surface.as_str());
                row = row.child(
                    h_flex()
                        .justify_end()
                        .gap(px(6.))
                        .child(
                            Button::new(("cloud-regenerate", index))
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.access.regenerateRootKey"))
                                .disabled(self.busy)
                                .on_click(
                                    cx.listener(move |s, _, _, cx| s.regenerate(a.clone(), cx)),
                                ),
                        )
                        .child(
                            Button::new(("cloud-pause", index))
                                .variant(ButtonVariant::Secondary)
                                .label(tr(if paused {
                                    "cloud.status.active"
                                } else {
                                    "cloud.status.paused"
                                }))
                                .disabled(self.busy)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.set_paused(b.clone(), !paused, cx)
                                })),
                        )
                        .child(
                            Button::new(("cloud-delete", index))
                                .variant(if confirming {
                                    ButtonVariant::SolidDanger
                                } else {
                                    ButtonVariant::Secondary
                                })
                                .label(tr(if confirming {
                                    "cloud.common.confirm"
                                } else {
                                    "cloud.common.discard"
                                }))
                                .disabled(self.busy)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    if s.confirm_delete.as_deref() == Some(c.as_str()) {
                                        s.delete_surface(c.clone(), cx);
                                    } else {
                                        s.confirm_delete = Some(c.clone());
                                        cx.notify();
                                    }
                                })),
                        ),
                );
            }
            page = page.child(row);
        }
        page.into_any_element()
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
    fn team(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let team = self.team.clone();
        let web = cloud_account::environment(cx).map(|e| e.web().to_owned());
        let mut page = v_flex().gap(px(12.)).child(self.heading(t));
        if team.organizations.len() > 1 {
            page = page.child(h_flex().gap(px(6.)).children(
                team.organizations.iter().enumerate().map(|(index, org)| {
                    let id = org.id.clone();
                    Button::new(("cloud-org", index))
                        .variant(if team.selected.as_deref() == Some(org.id.as_str()) {
                            ButtonVariant::Solid
                        } else {
                            ButtonVariant::Secondary
                        })
                        .label(org.name.clone())
                        .on_click(
                            cx.listener(move |s, _, _, cx| s.select_organization(id.clone(), cx)),
                        )
                }),
            ));
        }
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
struct LabCloud;
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
            "/mcp-endpoints" => json!([]),
            "/projects/lab" => json!({"id": "lab", "name": "Launch notes",
                "updated_at": "2026-10-20T08:00:00Z", "visibility": "org",
                "capabilities": ["project.settings.manage"]}),
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
        self.open_with(Client::new(Arc::new(LabCloud)), "lab".into(), section, cx);
    }
}

#[cfg(test)]
mod tests;
