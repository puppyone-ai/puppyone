//! "Create a project" (`OnboardingProjectEntryDialog`): a name, prefilled,
//! and a location, prefilled with the built-in `Documents/PuppyOne` folder,
//! so the default path is a single Create. A blank project is an empty
//! folder (`project-entry-service.mjs` with the blank template); it opens
//! as soon as it exists. Template links need the template marketplace and
//! are not native yet, so that option is shown inert.
use super::*;
use crate::ui::{
    components::{Checkbox, Dialog, Icon},
    form_input::{InputEvent, TextInput},
};
use std::path::Path;

/// `PROJECT_NAME_MAX_LENGTH`.
const NAME_MAX: usize = 120;
/// `DEFAULT_PROJECTS_FOLDER_NAME`, under the user's Documents folder.
const DEFAULT_FOLDER: &str = "PuppyOne";

pub(in crate::shell) struct CreateProject {
    pub(in crate::shell) name: Entity<TextInput>,
    location: Option<PathBuf>,
    choosing: bool,
    error: Option<String>,
}

/// `requireProjectName`: trimmed, at most 120 characters, a portable file name.
fn validate_name(value: &str) -> Result<&str, &'static str> {
    let name = value.trim();
    if name.is_empty() {
        return Err("Enter a project name.");
    }
    if name.chars().count() > NAME_MAX {
        return Err("Project names must be 120 characters or fewer.");
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_lowercase();
    let reserved = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if name == "."
        || name == ".."
        || name.chars().any(|c| {
            matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control()
        })
        || name.ends_with(['.', ' '])
        || reserved
    {
        return Err(
            "Use a project name without slashes, reserved characters, or a trailing period.",
        );
    }
    Ok(name)
}
/// `Documents/PuppyOne`, created if missing.
fn default_location() -> Option<PathBuf> {
    let documents = std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Documents"))?;
    let folder = documents.join(DEFAULT_FOLDER);
    std::fs::create_dir_all(&folder).ok()?;
    folder.canonicalize().ok()
}
/// Creates the empty project folder; it must not exist yet.
fn create_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let path = parent.join(name);
    match std::fs::create_dir(&path) {
        Ok(()) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(format!(
            "A file or folder named “{name}” already exists in that location."
        )),
        Err(error) => Err(error.to_string()),
    }
}

impl Shell {
    /// `openCreate`: the dialog with a fresh name in the default folder.
    pub(in crate::shell) fn begin_create_project(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let suffix = format!("{:04X}", rand_suffix());
        let name = cx.new(|cx| {
            let mut input = TextInput::new("", false, NAME_MAX, window, cx);
            input.submit_on_enter = true;
            input.appearance = false;
            input.prompt_text = Some((theme::ty().ui.control, 18.));
            input.set_text(
                format!("{} {suffix}", tr("onboarding.entry.create.defaultName")),
                cx,
            );
            input
        });
        cx.subscribe_in(&name, window, |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                s.submit_create_project(w, cx)
            }
        })
        .detach();
        name.read(cx).focus_handle(cx).focus(window, cx);
        self.modals.open(Modal::CreateProject(CreateProject {
            name,
            location: default_location(),
            choosing: false,
            error: None,
        }));
        cx.notify();
    }
    pub(in crate::shell) fn close_create_project(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self
            .modals
            .remove(|m| matches!(m, Modal::CreateProject(_)))
            .is_some()
        {
            self.focus.focus(window, cx);
            cx.notify();
        }
    }
    /// Browse for another parent folder.
    fn choose_project_location(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(create) = self.modals.create_project() else {
            return;
        };
        create.choosing = true;
        create.error = None;
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(tr("onboarding.entry.create.locationLabel").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = prompt.await;
            let _ = this.update(cx, |s, cx| {
                if let Some(create) = s.modals.create_project() {
                    create.choosing = false;
                    match result {
                        Ok(Ok(Some(paths))) => {
                            if let Some(path) = paths.into_iter().next() {
                                create.location = Some(path);
                            }
                        }
                        Ok(Err(error)) => create.error = Some(error.to_string()),
                        Err(error) => create.error = Some(error.to_string()),
                        _ => {}
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    fn submit_create_project(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(create) = self.modals.create_project() else {
            return;
        };
        let Some(location) = create.location.clone() else {
            return;
        };
        let value = create.name.read(cx).text().to_owned();
        let created = validate_name(&value)
            .map_err(str::to_owned)
            .and_then(|name| create_folder(&location, name));
        match created {
            Ok(path) => {
                self.modals.remove(|m| matches!(m, Modal::CreateProject(_)));
                self.open_project(path, window, cx);
            }
            Err(error) => {
                create.error = Some(error);
                cx.notify();
            }
        }
    }
    pub(in crate::shell) fn create_project_dialog(
        &self,
        create: &CreateProject,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty();
        let host = self.weak.clone();
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
        };
        let location = create
            .location
            .as_ref()
            .map(|path| path.display().to_string());
        let can_create = location.is_some() && !create.choosing;
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
                    .gap(px(18.))
                    .child(
                        Checkbox::new("create-project-template")
                            .label(tr("onboarding.template.useLink"))
                            .tooltip(tf(
                                "settings.sidebar.notAvailable",
                                &[("section", tr("onboarding.template.useLink").into())],
                            ))
                            .text_size(px(ty.ui.body))
                            .line_height(px(18.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.text),
                    )
                    .child(
                        v_flex()
                            .gap(px(8.))
                            .child(label("onboarding.entry.create.nameLabel"))
                            .child(field().px(px(8.)).child(
                                div().w_full().text_color(t.text).child(create.name.clone()),
                            )),
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
                                    .when(!create.choosing, |d| d.cursor(theme::clickable_cursor()))
                                    .on_click(
                                        cx.listener(|s, _, w, cx| s.choose_project_location(w, cx)),
                                    )
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
                                            .text_color(if location.is_some() {
                                                t.text
                                            } else {
                                                t.subtle
                                            })
                                            .child(location.unwrap_or_else(|| {
                                                tr("onboarding.entry.create.locationPlaceholder")
                                                    .into()
                                            })),
                                    )
                                    .child(
                                        div()
                                            .flex_shrink_0()
                                            .text_size(px(ty.ui.meta))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.muted)
                                            .child(tr(if create.choosing {
                                                "onboarding.entry.create.browsing"
                                            } else if create.location.is_some() {
                                                "onboarding.entry.create.change"
                                            } else {
                                                "onboarding.entry.create.browse"
                                            })),
                                    ),
                            ),
                    )
                    .children(create.error.clone().map(|error| {
                        div()
                            .text_size(px(ty.ui.meta))
                            .text_color(t.danger)
                            .child(error)
                    })),
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

    #[test]
    fn a_blank_project_is_a_new_empty_folder() {
        let temp = tempfile::tempdir().unwrap();
        let created = create_folder(temp.path(), "Notes").unwrap();
        assert!(created.is_dir());
        assert_eq!(std::fs::read_dir(&created).unwrap().count(), 0);
        assert!(
            create_folder(temp.path(), "Notes")
                .unwrap_err()
                .contains("already exists")
        );
    }
}
