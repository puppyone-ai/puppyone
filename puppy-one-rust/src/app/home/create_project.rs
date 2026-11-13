//! "Create a project" (`OnboardingProjectEntryDialog`): a name, prefilled,
//! who can open it, and where it is kept, which follows: this computer and
//! all my devices keep a folder here (prefilled with the built-in
//! `Documents/PuppyOne` folder), the latter opened to my other computers; a
//! team's project is an empty Cloud project in that team's space. The
//! default path is a single Create. A new folder starts with the built-in
//! Getting started guide in the app's language, which opens first
//! (`project-catalog.mjs`).
use super::*;
use crate::{
    platform::templates::{self, builtin},
    ui::{
        components::{Dialog, Icon},
        form_input::{InputEvent, TextInput},
    },
};
use std::path::Path;

/// `PROJECT_NAME_MAX_LENGTH`.
const NAME_MAX: usize = templates::NAME_MAX;
/// `DEFAULT_PROJECTS_FOLDER_NAME`, under the user's Documents folder.
const DEFAULT_FOLDER: &str = "PuppyOne";

/// Where a new project goes: its name and the folder it goes in.
pub(in crate::app) struct Destination {
    pub(in crate::app) name: Entity<TextInput>,
    pub(in crate::app) location: Option<PathBuf>,
    pub(in crate::app) choosing: bool,
}
pub(in crate::app) struct CreateProject {
    pub(in crate::app) destination: Destination,
    pub(in crate::app) error: Option<String>,
    pub(in crate::app) audience: Audience,
    /// The team chosen among several; the first one otherwise.
    pub(in crate::app) team: Option<String>,
    /// `cloudOperationRef`: `(space and name, operation)`; a retry of the
    /// same project repeats its operation, so the Cloud makes it once.
    pub(in crate::app) cloud_operation: Option<(String, String)>,
    pub(in crate::app) submitting: bool,
}

/// Who can open the new project: the Homepage's three audiences.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum Audience {
    Local,
    Devices,
    Team,
}
impl Audience {
    fn label(self) -> &'static str {
        match self {
            Self::Local => "onboarding.entry.create.audience.local",
            Self::Devices => "onboarding.entry.create.audience.devices",
            Self::Team => "onboarding.entry.create.audience.team",
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Devices => "devices",
            Self::Team => "team",
        }
    }
}
/// The audiences offered: this computer always; my devices when this
/// window can open the folder to them; a team when one can take projects.
pub(in crate::app) fn audiences(devices: bool, teams: usize) -> Vec<Audience> {
    let mut list = vec![Audience::Local];
    if devices {
        list.push(Audience::Devices);
    }
    if teams > 0 {
        list.push(Audience::Team);
    }
    list
}
/// The team spaces a project can start in, `(id, name)`.
pub(in crate::app) fn creatable_teams(
    spaces: &[crate::workspace::cloud::spaces::Space],
) -> Vec<(String, String)> {
    spaces
        .iter()
        .filter(|s| s.can_create_projects)
        .map(|s| (s.id.clone(), s.name.clone()))
        .collect()
}
/// The creation's operation: the same for the same space and name, a new
/// one otherwise.
fn operation(current: &mut Option<(String, String)>, space: &str, name: &str) -> String {
    let attempt = format!("{space}\n{name}");
    if current.as_ref().map(|(a, _)| a) != Some(&attempt) {
        *current = Some((attempt, uuid::Uuid::new_v4().to_string()));
    }
    current
        .as_ref()
        .map(|(_, id)| id.clone())
        .unwrap_or_default()
}
/// What the server's answer means to the person creating it.
fn create_error(error: &crate::workspace::cloud::services::Error) -> String {
    use crate::workspace::cloud::services::Error;
    match error {
        Error::Status(401) => tr("cloud.auth.signInRequired").into(),
        Error::Status(403) => tr("cloud.initialize.permissionDenied").into(),
        Error::Unavailable => tr("cloud.message.connection-unreachable").into(),
        _ => tr("cloud.catalog.createFailed").into(),
    }
}

/// `requireProjectName`.
fn validate_name(value: &str) -> Result<&str, String> {
    templates::require_project_name(value)
}
/// `Documents/PuppyOne`, created if missing.
pub(super) fn default_location() -> Option<PathBuf> {
    let documents = std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Documents"))?;
    let folder = documents.join(DEFAULT_FOLDER);
    std::fs::create_dir_all(&folder).ok()?;
    folder.canonicalize().ok()
}
/// `createProject` with Getting started: the project folder, made whole,
/// and the document it opens on.
fn create_folder(
    parent: &Path,
    name: &str,
    locale: &str,
) -> Result<(PathBuf, Option<String>), String> {
    let plan = builtin::getting_started(locale);
    let path = templates::materialize(parent, name, &plan)?;
    Ok((path, plan.initial_open))
}

impl Homepage {
    /// The project name field, `text` selected for replacing.
    pub(in crate::app) fn project_name_input(
        &mut self,
        text: String,
        window: &mut Window,
        cx: &mut Context<Self>,
        submit: fn(&mut Self, &mut Window, &mut Context<Self>),
    ) -> Entity<TextInput> {
        let name = cx.new(|cx| {
            let mut input = TextInput::new("", false, NAME_MAX, window, cx);
            input.submit_on_enter = true;
            input.appearance = false;
            input.prompt_text = Some((theme::ty().ui.control, 18.));
            input.set_text(text, cx);
            input
        });
        cx.subscribe_in(&name, window, move |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                submit(s, w, cx)
            }
        })
        .detach();
        name
    }
    /// `openCreate`: the dialog with a fresh name in the default folder.
    pub(in crate::app) fn begin_create_project(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let suffix = format!("{:04X}", rand_suffix());
        let name = self.project_name_input(
            format!("{} {suffix}", tr("onboarding.entry.create.defaultName")),
            window,
            cx,
            Self::submit_create_project,
        );
        name.read(cx).focus_handle(cx).focus(window, cx);
        self.create = Some(CreateProject {
            destination: Destination {
                name,
                location: default_location(),
                choosing: false,
            },
            error: None,
            audience: Audience::Local,
            team: None,
            cloud_operation: None,
            submitting: false,
        });
        self.open_dialog(DialogKey::CreateProject, cx);
        cx.notify();
    }
    /// The destination of the entry dialog on top.
    pub(in crate::app) fn destination(&mut self, cx: &App) -> Option<&mut Destination> {
        match self.top_dialog(cx)? {
            DialogKey::CreateProject => self.create.as_mut().map(|c| &mut c.destination),
            DialogKey::TemplateImport => self.template.as_mut().map(|t| &mut t.destination),
            _ => None,
        }
    }
    fn set_destination_error(&mut self, error: Option<String>, cx: &App) {
        match self.top_dialog(cx) {
            Some(DialogKey::CreateProject) => {
                if let Some(create) = self.create.as_mut() {
                    create.error = error
                }
            }
            Some(DialogKey::TemplateImport) => {
                if let Some(import) = self.template.as_mut() {
                    import.error = error
                }
            }
            _ => {}
        }
    }
    pub(in crate::app) fn close_create_project(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.create.as_ref().is_some_and(|c| c.submitting) {
            return;
        }
        self.create = None;
        if self.close_dialog(DialogKey::CreateProject, cx) {
            self.window_focus.focus(window, cx);
            cx.notify();
        }
    }
    /// Browse for another parent folder.
    pub(in crate::app) fn choose_project_location(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(destination) = self.destination(cx) else {
            return;
        };
        if destination.choosing {
            return;
        }
        destination.choosing = true;
        self.set_destination_error(None, cx);
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(tr("onboarding.entry.create.locationLabel").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = prompt.await;
            let _ = this.update(cx, |s, cx| {
                let mut error = None;
                if let Some(destination) = s.destination(cx) {
                    destination.choosing = false;
                    match result {
                        Ok(Ok(Some(paths))) => {
                            if let Some(path) = paths.into_iter().next() {
                                destination.location = path.canonicalize().ok().or(Some(path));
                            }
                        }
                        Ok(Err(e)) => error = Some(e.to_string()),
                        Err(e) => error = Some(e.to_string()),
                        _ => {}
                    }
                }
                if error.is_some() {
                    s.set_destination_error(error, cx);
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    /// The teams this account can start a project in.
    pub(in crate::app) fn creatable_teams(&self, cx: &App) -> Vec<(String, String)> {
        if !crate::features::cloud::account::has_account(cx)
            || !crate::features::flags::cloud_enabled(&self.preferences, cx)
        {
            return vec![];
        }
        creatable_teams(self.spaces.read(cx).spaces())
    }
    /// The audiences the dialog offers now.
    pub(in crate::app) fn create_audiences(&self, cx: &App) -> Vec<Audience> {
        audiences(self.local_share, self.creatable_teams(cx).len())
    }
    pub(in crate::app) fn choose_create_audience(
        &mut self,
        audience: Audience,
        team: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if let Some(create) = self.create.as_mut().filter(|c| !c.submitting) {
            create.audience = audience;
            if team.is_some() {
                create.team = team;
            }
            create.error = None;
            self.menu = None;
            cx.notify();
        }
    }
    /// The team the dialog would create in, when it is one of the teams.
    fn create_team(&self, cx: &App) -> Option<(String, String)> {
        let create = self.create.as_ref()?;
        let teams = self.creatable_teams(cx);
        create
            .team
            .as_ref()
            .and_then(|id| teams.iter().find(|(t, _)| t == id).cloned())
            .or_else(|| teams.into_iter().next())
    }
    pub(in crate::app) fn submit_create_project(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let team = self.create_team(cx);
        let Some(create) = self.create.as_mut() else {
            return;
        };
        if create.destination.choosing || create.submitting {
            return;
        }
        let value = create.destination.name.read(cx).text().to_owned();
        if create.audience == Audience::Team {
            let name = match validate_name(&value) {
                Ok(name) => name.to_owned(),
                Err(error) => {
                    create.error = Some(error);
                    cx.notify();
                    return;
                }
            };
            let Some((space, _)) = team else {
                return;
            };
            let Some(client) = crate::features::cloud::services_client(cx) else {
                create.error = Some(tr("cloud.auth.signInRequired").into());
                cx.notify();
                return;
            };
            let id = operation(&mut create.cloud_operation, &space, &name);
            create.submitting = true;
            create.error = None;
            let task = cx
                .background_executor()
                .spawn(async move { client.create_project(&name, &space, &id) });
            cx.spawn_in(window, async move |this, cx| {
                let result = task.await;
                let _ = this.update_in(cx, |s, w, cx| {
                    let Some(create) = s.create.as_mut() else {
                        return;
                    };
                    create.submitting = false;
                    match result {
                        // An empty Cloud project, opened at once like any other.
                        Ok(project) => {
                            s.create = None;
                            s.close_dialog(DialogKey::CreateProject, cx);
                            s.catalog.update(cx, |c, cx| c.ensure(true, true, cx));
                            s.window_focus.focus(w, cx);
                            cx.emit(HomeEvent::OpenCloud(project.id));
                        }
                        Err(error) => create.error = Some(create_error(&error)),
                    }
                    cx.notify();
                });
            })
            .detach();
            cx.notify();
            return;
        }
        let Some(location) = create.destination.location.clone() else {
            return;
        };
        let devices = create.audience == Audience::Devices;
        let created = validate_name(&value)
            .and_then(|name| create_folder(&location, name, &crate::localization::current_code()));
        match created {
            Ok((path, open)) => {
                self.create = None;
                self.close_dialog(DialogKey::CreateProject, cx);
                self.open_created_project(path.clone(), open.map(PathBuf::from), false, cx);
                // Offered from this window, as the folder it now shows.
                if devices {
                    cx.emit(HomeEvent::ShareFolder { path });
                }
            }
            Err(error) => {
                create.error = Some(error);
                cx.notify();
            }
        }
    }
    /// A project just created opens here — or, when `new_window`, in a
    /// window of its own — on its first document.
    pub(in crate::app) fn open_created_project(
        &mut self,
        path: PathBuf,
        open: Option<PathBuf>,
        new_window: bool,
        cx: &mut Context<Self>,
    ) {
        cx.emit(HomeEvent::OpenCreated {
            path,
            open,
            new_window,
        });
    }
    /// `.onboarding-entry-create-fields`: the name, and the folder it goes in.
    pub(in crate::app) fn destination_fields(
        &self,
        destination: &Destination,
        locked: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        v_flex()
            .gap(px(18.))
            .child(self.name_field(destination, locked, cx))
            .child(self.location_field(
                destination,
                locked,
                "onboarding.entry.create.locationLabel",
                cx,
            ))
    }
    /// `.onboarding-entry-create-label`.
    fn field_label(&self, text: &'static str, cx: &App) -> Div {
        let t = cx.palette();
        div()
            .text_size(px(theme::ty().ui.body))
            .line_height(px(18.))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.text)
            .child(tr(text))
    }
    /// `.onboarding-entry-create-input` / `.onboarding-entry-location-picker`.
    fn field_box(&self, locked: bool, cx: &App) -> Div {
        let t = cx.palette();
        h_flex()
            .w_full()
            .h(px(theme::control()))
            .border_1()
            .border_color(t.border_strong)
            .rounded(px(8.))
            .bg(t.input)
            .text_size(px(theme::ty().ui.body))
            .when(locked, |d| d.opacity(0.58))
    }
    fn name_field(&self, destination: &Destination, locked: bool, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        v_flex()
            .gap(px(8.))
            .child(self.field_label("onboarding.entry.create.nameLabel", cx))
            .child(
                self.field_box(locked, cx).px(px(8.)).child(
                    div()
                        .w_full()
                        .text_color(t.text)
                        .child(destination.name.clone()),
                ),
            )
    }
    fn location_field(
        &self,
        destination: &Destination,
        locked: bool,
        label: &'static str,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = cx.palette();
        let ty = theme::ty();
        let location = destination
            .location
            .as_ref()
            .map(|path| path.display().to_string());
        v_flex()
            .gap(px(8.))
            .child(self.field_label(label, cx))
            .child(
                self.field_box(locked, cx)
                    .id("create-project-location")
                    .px(px(11.))
                    .gap(px(10.))
                    .when(!destination.choosing && !locked, |d| {
                        d.cursor(theme::clickable_cursor())
                            .on_click(cx.listener(|s, _, w, cx| s.choose_project_location(w, cx)))
                    })
                    .child(
                        Icon::product(crate::ui::components::ProductIcon::Folder)
                            .with_size(px(17.))
                            .stroke(1.8)
                            .color(t.muted),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(if location.is_some() { t.text } else { t.subtle })
                            .child(location.unwrap_or_else(|| {
                                tr("onboarding.entry.create.locationPlaceholder").into()
                            })),
                    )
                    .child(
                        div()
                            .flex_shrink_0()
                            .text_size(px(ty.ui.meta))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted)
                            .child(tr(if destination.choosing {
                                "onboarding.entry.create.browsing"
                            } else if destination.location.is_some() {
                                "onboarding.entry.create.change"
                            } else {
                                "onboarding.entry.create.browse"
                            })),
                    ),
            )
    }
    /// `.onboarding-entry-location-picker.is-fixed`: a place that follows
    /// from the audience, shown, not chosen.
    fn cloud_location(&self, cx: &App) -> Div {
        let t = cx.palette();
        v_flex()
            .gap(px(8.))
            .child(self.field_label("onboarding.entry.create.storedLabel", cx))
            .child(
                h_flex()
                    .id("create-project-stored-cloud")
                    .debug_selector(|| "create-project-stored-cloud".into())
                    .gap(px(8.))
                    .text_size(px(theme::ty().ui.body))
                    .text_color(t.text)
                    .child(
                        Icon::product(crate::ui::components::ProductIcon::Cloud)
                            .with_size(px(17.))
                            .stroke(1.8)
                            .color(t.muted),
                    )
                    .child(tr("onboarding.entry.create.stored.cloud")),
            )
    }
    /// `.onboarding-entry-choice-field`: plain choices, a dot and words.
    fn audience_choices(&self, create: &CreateProject, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let ty = theme::ty();
        let teams = self.creatable_teams(cx);
        let team = self.create_team(cx);
        let locked = create.submitting;
        let label = self.field_label("onboarding.entry.create.audienceLabel", cx);
        let choices: Vec<_> = self
            .create_audiences(cx)
            .into_iter()
            .map(|option| {
                let checked = create.audience == option;
                // A native radio in the text's own colour.
                let dot = div()
                    .size(px(14.))
                    .flex_shrink_0()
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .map(|d| {
                        if checked {
                            d.bg(t.text)
                                .child(div().size(px(6.)).rounded_full().bg(t.text_inverse))
                        } else {
                            d.border_1().border_color(t.border_strong).bg(t.input)
                        }
                    });
                let selector = (option == Audience::Team && teams.len() > 1)
                    .then(|| self.create_team_selector(teams.clone(), team.clone(), locked, cx));
                h_flex()
                    .id(SharedString::from(format!(
                        "create-audience-{}",
                        option.key()
                    )))
                    .debug_selector(move || format!("create-audience:{}", option.key()))
                    .min_w_0()
                    .gap(px(8.))
                    .text_size(px(ty.ui.body))
                    .line_height(px(20.))
                    .text_color(if checked { t.text } else { t.muted })
                    .when(!locked, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(|d| d.text_color(t.text))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.choose_create_audience(option, None, cx)
                            }))
                    })
                    .child(dot)
                    .child(div().flex_none().child(tr(option.label())))
                    .children(selector)
            })
            .collect();
        v_flex()
            .gap(px(8.))
            .child(label)
            .child(v_flex().gap(px(6.)).children(choices))
    }
    /// `.onboarding-entry-team-select`: which team, when there are several.
    fn create_team_selector(
        &self,
        teams: Vec<(String, String)>,
        chosen: Option<(String, String)>,
        locked: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let open = self.menu == Some(HomeMenu::CreateTeam) && !locked;
        let (chosen, name) = chosen.unwrap_or_default();
        let host = self.weak.clone();
        let trigger = Button::new("create-team-selector")
            .variant(ButtonVariant::Ghost)
            .label(name)
            .trailing(Icon::new("chevron-down").with_size(px(11.)).stroke(1.85))
            .accessibility_label(tr("onboarding.sharing.selectTeam"))
            .disabled(locked)
            .h(px(22.))
            .px(px(4.))
            .max_w(px(180.))
            .text_size(px(theme::ty().ui.meta))
            .text_color(t.subtle);
        PopoverMenu::new("create-team-selector-menu")
            .anchor(Anchor::TopLeft)
            .offset(px(theme::metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let is = s.menu == Some(HomeMenu::CreateTeam);
                    if *opened != is {
                        s.menu = opened.then_some(HomeMenu::CreateTeam);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu({
                let host = self.weak.clone();
                move |surface, _, _| {
                    surface.items(teams.iter().map(|(id, name)| {
                        let host = host.clone();
                        let id = id.clone();
                        super::projects::checked_item(MenuItem::new(name.clone()), id == chosen)
                            .on_click(move |_, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    s.choose_create_audience(Audience::Team, Some(id.clone()), cx)
                                });
                            })
                    }))
                }
            })
            .into_any_element()
    }
    pub(in crate::app) fn create_project_dialog(
        &self,
        create: &CreateProject,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty();
        let host = self.weak.clone();
        let destination = &create.destination;
        let several = self.create_audiences(cx).len() > 1;
        let in_cloud = create.audience == Audience::Team;
        let busy = destination.choosing || create.submitting;
        let can_create = !busy
            && if in_cloud {
                self.create_team(cx).is_some()
            } else {
                destination.location.is_some()
            };
        let location = if in_cloud {
            self.cloud_location(cx)
        } else {
            self.location_field(
                destination,
                create.submitting,
                if several {
                    "onboarding.entry.create.storedLabel"
                } else {
                    "onboarding.entry.create.locationLabel"
                },
                cx,
            )
        };
        Dialog::new("create-project")
            .width(400.)
            .inset(24.)
            .body_padding(10., 22.)
            .leading(Icon::new("folder-plus").stroke(1.8), t.accent)
            .title(tr("onboarding.entry.create.title"))
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_create_project(w, cx));
            })
            .child(
                v_flex()
                    .child(
                        v_flex()
                            .gap(px(18.))
                            .child(self.name_field(destination, create.submitting, cx))
                            .when(several, |d| d.child(self.audience_choices(create, cx)))
                            .child(location),
                    )
                    .children(create.error.clone().map(|error| {
                        div()
                            .mt(px(8.))
                            .text_size(px(ty.ui.meta))
                            .line_height(px(18.))
                            .text_color(t.danger)
                            .child(error)
                    })),
            )
            .footer(
                Button::new("create-project-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, w, cx| s.close_create_project(w, cx))),
            )
            .footer(
                Button::new("create-project-submit")
                    .variant(ButtonVariant::Solid)
                    .label(tr(if create.submitting {
                        "onboarding.entry.create.submitting"
                    } else {
                        "onboarding.entry.create.submit"
                    }))
                    .disabled(!can_create)
                    .on_click(cx.listener(|s, _, w, cx| s.submit_create_project(w, cx))),
            )
    }
}

/// Four hex digits to tell default names apart (`crypto.randomUUID().slice(0, 4)`).
fn rand_suffix() -> u16 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default(),
    );
    hasher.finish() as u16
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn project_names_follow_the_product_rules() {
        assert_eq!(validate_name("  My project  "), Ok("My project"));
        // Like `requireProjectName`, surrounding spaces are trimmed first.
        assert_eq!(validate_name("name "), Ok("name"));
        for bad in [
            "",
            "  ",
            ".",
            "..",
            "../escape",
            "a/b",
            "a:b",
            "trailing.",
            "CON",
            "lpt1.txt",
        ] {
            assert!(validate_name(bad).is_err(), "{bad:?}");
        }
        assert!(validate_name(&"x".repeat(121)).is_err());
        assert!(validate_name("COM0").is_ok());
    }

    /// `OnboardingProjectEntryDialog`: who can open it decides what is
    /// offered; a retry of the same project repeats its operation.
    #[test]
    fn the_audience_decides_where_a_new_project_is_kept() {
        use crate::workspace::cloud::spaces::Space;
        assert_eq!(audiences(false, 0), vec![Audience::Local]);
        assert_eq!(
            audiences(true, 2),
            vec![Audience::Local, Audience::Devices, Audience::Team]
        );
        let space = |id: &str, own, can| Space {
            id: id.into(),
            name: id.into(),
            is_default: own,
            can_create_projects: can,
            ..Default::default()
        };
        let teams = creatable_teams(&[
            space("me", true, true),
            space("a", false, true),
            space("b", false, false),
        ]);
        // Every space this account can add to, its own included (v0.4.4).
        assert_eq!(
            teams,
            vec![
                ("me".to_owned(), "me".to_owned()),
                ("a".to_owned(), "a".to_owned())
            ]
        );
        let mut current = None;
        let first = operation(&mut current, "a", "Notes");
        assert_eq!(operation(&mut current, "a", "Notes"), first);
        assert_ne!(operation(&mut current, "a", "Notes 2"), first);
        assert_ne!(operation(&mut current, "b", "Notes"), first);
    }

    /// A new project starts with Getting started, in the app's language,
    /// and opens on it; an existing folder is never reused.
    #[test]
    fn a_new_project_starts_with_its_guide() {
        let temp = tempfile::tempdir().unwrap();
        let (created, open) = create_folder(temp.path(), "Notes", "zh-Hans").unwrap();
        assert_eq!(open.as_deref(), Some("Getting Started.md"));
        let guide = std::fs::read_to_string(created.join("Getting Started.md")).unwrap();
        assert!(guide.starts_with("# "));
        assert_eq!(std::fs::read_dir(&created).unwrap().count(), 1);
        assert!(
            create_folder(temp.path(), "Notes", "en")
                .unwrap_err()
                .contains("already exists")
        );
    }
}
