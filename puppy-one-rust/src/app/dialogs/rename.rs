//! `DesktopNodeRenameDialog`: a file's name without its extension and its
//! Type (the product's file types, plus the current one when it is not
//! among them); a folder's name alone. "Change file type" opens the same
//! dialog (`renameFocus: "type"`). Saving a different type asks first
//! (`workspace.node.confirmTypeChange`, the system's confirmation, as the
//! product's `window.confirm`). The Explorer asks for it; the layer answers
//! with the name ([`DialogEvent::Rename`]) and the shell has the Explorer
//! run it.
use super::*;
use crate::{
    localization::tf,
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, Dialog, Select, SelectOption},
        form_input::{InputEvent, TextInput},
    },
};

/// `DESKTOP_FILE_TYPE_OPTIONS` (the experimental PuppyFlow type aside).
const FILE_TYPES: [(&str, &str); 20] = [
    ("none", ""),
    ("markdown", ".md"),
    ("contextMap", ".contextmap"),
    ("json", ".json"),
    ("jsonLines", ".jsonl"),
    ("text", ".txt"),
    ("csv", ".csv"),
    ("html", ".html"),
    ("whiteboard", ".excalidraw"),
    ("app", ".puppyoneapp"),
    ("javascript", ".js"),
    ("typescript", ".ts"),
    ("tsx", ".tsx"),
    ("yaml", ".yml"),
    ("toml", ".toml"),
    ("pdf", ".pdf"),
    ("png", ".png"),
    ("jpeg", ".jpg"),
    ("zip", ".zip"),
    ("tarball", ".tar.gz"),
];

/// `normalizeDesktopExtension`: lower case, with its dot.
fn normalize_extension(value: &str) -> String {
    let value = value.trim().to_lowercase();
    if value.is_empty() || value.starts_with('.') {
        value
    } else {
        format!(".{value}")
    }
}

/// `getDesktopNodeExtension`: the registered extension a name ends with,
/// as written (`.tar.gz` whole); none for a dotfile or a bare extension.
fn node_extension(name: &str) -> String {
    if name.is_empty() || (name.starts_with('.') && !name[1..].contains('.')) {
        return String::new();
    }
    let Some(extension) = crate::formats::matched_extension(name) else {
        return String::new();
    };
    let suffix = format!(".{extension}");
    if name.len() <= suffix.len() || !name.to_lowercase().ends_with(&suffix) {
        return String::new();
    }
    name[name.len() - suffix.len()..].to_owned()
}

/// `getDesktopFileTypeOptions`: (label, extension), the current extension
/// second when the list lacks it.
fn type_options(current: &str) -> Vec<(String, String)> {
    let mut options: Vec<(String, String)> = FILE_TYPES
        .iter()
        .map(|(id, ext)| {
            (
                tr(&format!("workspace.node.fileType.{id}")).to_owned(),
                (*ext).to_owned(),
            )
        })
        .collect();
    let current = normalize_extension(current);
    if !current.is_empty() && !options.iter().any(|(_, ext)| *ext == current) {
        options.insert(
            1,
            (
                tf(
                    "workspace.node.fileType.current",
                    &[("extension", current.clone().into())],
                ),
                current,
            ),
        );
    }
    options
}

/// `normalizeDesktopRenameName`: the base name with the chosen type (the
/// current one as written when it is kept); an error key when invalid.
fn next_name(
    original: &str,
    folder: bool,
    base: &str,
    extension: &str,
) -> Result<String, &'static str> {
    let valid = |name: &str| {
        if name.is_empty() {
            Err("workspace.node.error.nameRequired")
        } else if name == "." || name == ".." || name.contains(['/', '\\']) {
            Err("workspace.node.error.nameInvalid")
        } else if name.contains('\0') {
            Err("workspace.node.error.nameUnsupported")
        } else {
            Ok(())
        }
    };
    let base = base.trim();
    valid(base)?;
    if folder {
        return Ok(base.to_owned());
    }
    let current = node_extension(original);
    let selected = normalize_extension(extension);
    let extension = if selected == normalize_extension(&current) {
        current
    } else {
        selected
    };
    let base = if !extension.is_empty() && base.to_lowercase().ends_with(&extension.to_lowercase())
    {
        &base[..base.len() - extension.len()]
    } else {
        base
    };
    let name = format!("{base}{extension}");
    valid(&name)?;
    Ok(name)
}

pub(in crate::app) struct RenameDialog {
    path: PathBuf,
    /// The entry's current name.
    original: String,
    folder: bool,
    input: Entity<TextInput>,
    /// The Type chosen (an extension with its dot, or none).
    extension: String,
    change_type: bool,
    layer: WeakEntity<DialogLayer>,
}

impl DialogLayer {
    /// Rename `path` (or change its type).
    pub fn rename(
        &mut self,
        path: PathBuf,
        change_type: bool,
        folder: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let layer = cx.weak_entity();
        let dialog = cx.new(|cx| RenameDialog::new(path, change_type, folder, layer, window, cx));
        let (shown, dismissed) = (dialog.clone(), dialog.downgrade());
        self.open_owned(
            DialogKey::Rename,
            move |_, _, _| shown.clone().into_any_element(),
            move |window, cx| {
                let _ = dismissed.update(cx, |d, cx| d.cancel(window, cx));
            },
            cx,
        );
    }
}

impl RenameDialog {
    fn new(
        path: PathBuf,
        change_type: bool,
        folder: bool,
        layer: WeakEntity<DialogLayer>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let original = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        // `getDesktopRenameDraft`: a file's name without its extension.
        let extension = if folder {
            String::new()
        } else {
            node_extension(&original)
        };
        let base = original[..original.len() - extension.len()].to_owned();
        let input = cx.new(|cx| {
            let mut input = TextInput::new("", false, 255, window, cx);
            input.submit_on_enter = true;
            input.set_text(base, cx);
            input
        });
        cx.subscribe_in(&input, window, |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                s.submit(w, cx)
            }
        })
        .detach();
        input.read(cx).focus_handle(cx).focus(window, cx);
        Self {
            path,
            original,
            folder,
            input,
            extension,
            change_type,
            layer,
        }
    }
    /// Closes the dialog and hands the layer's answer to the shell.
    fn answer(&self, event: Option<DialogEvent>, cx: &mut Context<Self>) {
        let _ = self.layer.update(cx, |layer, cx| {
            layer.close(DialogKey::Rename, cx);
            cx.emit(event.unwrap_or(DialogEvent::Closed));
        });
    }
    pub(in crate::app) fn cancel(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.answer(None, cx);
    }
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let base = self.input.read(cx).text().to_owned();
        let name = match next_name(&self.original, self.folder, &base, &self.extension) {
            Ok(name) => name,
            Err(key) => return self.answer(Some(DialogEvent::Error(tr(key).into())), cx),
        };
        if name == self.original {
            return self.answer(None, cx);
        }
        let rename = DialogEvent::Rename {
            path: self.path.clone(),
            name: name.clone(),
        };
        let (previous, next) = (node_extension(&self.original), node_extension(&name));
        if self.folder || normalize_extension(&previous) == normalize_extension(&next) {
            return self.answer(Some(rename), cx);
        }
        let label = |extension: String| {
            if extension.is_empty() {
                tr("workspace.node.fileType.noExtensionShort").to_owned()
            } else {
                extension
            }
        };
        let message = tf(
            "workspace.node.confirmTypeChange",
            &[
                ("previous", label(previous).into()),
                ("next", label(next).into()),
            ],
        );
        let asked = window.prompt(
            PromptLevel::Warning,
            &message,
            None,
            &[
                PromptButton::new(tr("common.action.confirm")),
                PromptButton::new(tr("common.action.cancel")),
            ],
            cx,
        );
        cx.spawn_in(window, async move |this, cx| {
            if matches!(asked.await, Ok(0)) {
                let _ = this.update(cx, |this, cx| this.answer(Some(rename), cx));
            }
        })
        .detach();
    }
}

impl Render for RenameDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let dialog = cx.weak_entity();
        let field = |label: &str| {
            div()
                .text_size(px(theme::ty().ui.meta))
                .text_color(t.subtle)
                .child(tr(label))
        };
        let options = type_options(&node_extension(&self.original));
        let selected = normalize_extension(&self.extension);
        let value = options
            .iter()
            .find(|(_, ext)| *ext == selected)
            .map(|(label, _)| label.clone())
            .unwrap_or_default();
        let this = cx.weak_entity();
        let kind = Select::new("rename-type", value, move |_| {
            options
                .iter()
                .map(|(label, extension)| {
                    let (this, extension) = (this.clone(), extension.clone());
                    SelectOption::new(label.clone())
                        .selected(*extension == selected)
                        .on_select(move |_, cx| {
                            let _ = this.update(cx, |d, cx| {
                                d.extension = extension.clone();
                                cx.notify();
                            });
                        })
                })
                .collect()
        })
        .width_range(352., 352.);
        Dialog::new("rename-dialog")
            .width(400.)
            .title(tr(if self.change_type && !self.folder {
                "workspace.node.changeType"
            } else {
                "workspace.node.rename"
            }))
            .on_close(move |w, cx| {
                let _ = dialog.update(cx, |d, cx| d.cancel(w, cx));
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(field("workspace.node.name"))
                    .child(self.input.clone())
                    .when(!self.folder, |d| {
                        d.child(div().h(px(6.)))
                            .child(field("workspace.node.type"))
                            .child(kind)
                    }),
            )
            .footer(
                Button::new("cancel-rename")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .on_click(cx.listener(|s, _, w, cx| s.cancel(w, cx))),
            )
            .footer(
                Button::new("save-rename")
                    .variant(ButtonVariant::Solid)
                    .label(tr("common.action.save"))
                    .on_click(cx.listener(|s, _, w, cx| s.submit(w, cx))),
            )
    }
}

#[cfg(test)]
mod helpers {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn extensions_follow_the_registry() {
        assert_eq!(node_extension("Notes.MD"), ".MD");
        assert_eq!(node_extension("archive.tar.gz"), ".tar.gz");
        assert_eq!(node_extension(".env"), "");
        assert_eq!(node_extension("README"), "");
        assert_eq!(normalize_extension("MD"), ".md");
    }

    #[test]
    fn the_next_name_keeps_or_changes_the_type() {
        // Kept type: written as it was.
        assert_eq!(
            next_name("Notes.MD", false, "Plan", ".md").unwrap(),
            "Plan.MD"
        );
        // A new type; a base that already ends with it is not doubled.
        assert_eq!(
            next_name("Notes.md", false, "Notes", ".txt").unwrap(),
            "Notes.txt"
        );
        assert_eq!(
            next_name("Notes.md", false, "Notes.json", ".json").unwrap(),
            "Notes.json"
        );
        assert_eq!(next_name("Notes.md", false, "Notes", "").unwrap(), "Notes");
        assert_eq!(next_name("dir", true, " moved ", ".md").unwrap(), "moved");
        assert_eq!(
            next_name("a.md", false, "  ", ".md"),
            Err("workspace.node.error.nameRequired")
        );
        assert_eq!(
            next_name("a.md", false, "x/y", ".md"),
            Err("workspace.node.error.nameInvalid")
        );
    }

    #[test]
    fn an_unlisted_type_is_offered_as_the_current_one() {
        let options = type_options(".rs");
        assert_eq!(options[1].1, ".rs");
        assert_eq!(
            type_options(".md")
                .iter()
                .filter(|(_, e)| e == ".md")
                .count(),
            1
        );
    }
}
