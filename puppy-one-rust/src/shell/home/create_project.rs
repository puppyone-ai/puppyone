//! "Create a project" (`OnboardingProjectEntryDialog`): a name, prefilled,
//! and a location, prefilled with the built-in `Documents/PuppyOne` folder,
//! so the default path is a single Create. A new project starts with the
//! built-in Getting started guide in the app's language, which opens first
//! (`project-catalog.mjs`). "Paste template link" hands a template store
//! link on the clipboard to its own card (`template_import`).
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
pub(in crate::shell) struct Destination {
    pub(in crate::shell) name: Entity<TextInput>,
    pub(in crate::shell) location: Option<PathBuf>,
    pub(in crate::shell) choosing: bool,
}
pub(in crate::shell) struct CreateProject {
    pub(in crate::shell) destination: Destination,
    pub(in crate::shell) error: Option<String>,
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
    pub(in crate::shell) fn project_name_input(
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
    pub(in crate::shell) fn begin_create_project(
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
        });
        self.open_dialog(DialogKey::CreateProject, cx);
        cx.notify();
    }
    /// The destination of the entry dialog on top.
    pub(in crate::shell) fn destination(&mut self, cx: &App) -> Option<&mut Destination> {
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
    pub(in crate::shell) fn close_create_project(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.create = None;
        if self.close_dialog(DialogKey::CreateProject, cx) {
            self.window_focus.focus(window, cx);
            cx.notify();
        }
    }
    /// Browse for another parent folder.
    pub(in crate::shell) fn choose_project_location(
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
    pub(in crate::shell) fn submit_create_project(
        &mut self,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(create) = self.create.as_mut() else {
            return;
        };
        let Some(location) = create.destination.location.clone() else {
            return;
        };
        if create.destination.choosing {
            return;
        }
        let value = create.destination.name.read(cx).text().to_owned();
        let created = validate_name(&value)
            .and_then(|name| create_folder(&location, name, &crate::localization::current_code()));
        match created {
            Ok((path, open)) => {
                self.create = None;
                self.close_dialog(DialogKey::CreateProject, cx);
                self.open_created_project(path, open.map(PathBuf::from), false, cx);
            }
            Err(error) => {
                create.error = Some(error);
                cx.notify();
            }
        }
    }
    /// A project just created opens here — or, when `new_window`, in a
    /// window of its own — on its first document.
    pub(in crate::shell) fn open_created_project(
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
    /// "Paste template link": the clipboard is read only now, when asked,
    /// and only a template link is acted on.
    pub(in crate::shell) fn paste_template_link(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let text = cx
            .read_from_clipboard()
            .and_then(|item| item.text())
            .unwrap_or_default();
        if templates::link::looks_like(&text) {
            self.open_template_link(text.trim().to_owned(), window, cx);
        } else if let Some(create) = self.create.as_mut() {
            create.error = Some(tr("onboarding.template.noLink").into());
            cx.notify();
        }
    }
    /// `.onboarding-entry-create-fields`: the name, and the folder it goes in.
    pub(in crate::shell) fn destination_fields(
        &self,
        destination: &Destination,
        locked: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = cx.palette();
        let ty = theme::ty();
        let label = |text: &'static str| {
            div()
                .text_size(px(ty.ui.body))
                .line_height(px(18.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .child(tr(text))
        };
        // `.onboarding-entry-create-input` / `.onboarding-entry-location-picker`.
        let field = || {
            h_flex()
                .w_full()
                .h(px(theme::control()))
                .border_1()
                .border_color(t.border_strong)
                .rounded(px(8.))
                .bg(t.input)
                .text_size(px(ty.ui.body))
                .when(locked, |d| d.opacity(0.58))
        };
        let location = destination
            .location
            .as_ref()
            .map(|path| path.display().to_string());
        v_flex()
            .gap(px(18.))
            .child(
                v_flex()
                    .gap(px(8.))
                    .child(label("onboarding.entry.create.nameLabel"))
                    .child(
                        field().px(px(8.)).child(
                            div()
                                .w_full()
                                .text_color(t.text)
                                .child(destination.name.clone()),
                        ),
                    ),
            )
            .child(
                v_flex()
                    .gap(px(8.))
                    .child(label("onboarding.entry.create.locationLabel"))
                    .child(
                        field()
                            .id("create-project-location")
                            .px(px(11.))
                            .gap(px(10.))
                            .when(!destination.choosing && !locked, |d| {
                                d.cursor(theme::clickable_cursor()).on_click(
                                    cx.listener(|s, _, w, cx| s.choose_project_location(w, cx)),
                                )
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
                    ),
            )
    }
    pub(in crate::shell) fn create_project_dialog(
        &self,
        create: &CreateProject,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty();
        let host = self.weak.clone();
        let destination = &create.destination;
        let can_create = destination.location.is_some() && !destination.choosing;
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
                    .child(self.destination_fields(destination, false, cx))
                    .children(create.error.clone().map(|error| {
                        div()
                            .mt(px(8.))
                            .text_size(px(ty.ui.meta))
                            .line_height(px(18.))
                            .text_color(t.danger)
                            .child(error)
                    })),
            )
            // `.onboarding-entry-paste-template`: apart, at the start.
            .footer(
                div().mr_auto().child(
                    Button::new("create-project-paste-template")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("onboarding.template.paste"))
                        .disabled(destination.choosing)
                        .on_click(cx.listener(|s, _, w, cx| s.paste_template_link(w, cx))),
                ),
            )
            .footer(
                Button::new("create-project-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .on_click(cx.listener(|s, _, w, cx| s.close_create_project(w, cx))),
            )
            .footer(
                Button::new("create-project-submit")
                    .variant(ButtonVariant::Solid)
                    .label(tr("onboarding.entry.create.submit"))
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
