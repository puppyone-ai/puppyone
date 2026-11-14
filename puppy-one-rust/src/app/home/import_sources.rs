//! `OnboardingImportDialog`'s source list and app folders (v0.4.4): every
//! way in, as tiles, then the chosen one's step. GitHub and GitLab clone a
//! repository ([`import_repository`](super::import_repository)); with the
//! Experimental "Other app imports" switch, the folders another app already
//! records (Obsidian, VS Code, Cursor, Typora) are listed and added to the
//! Homepage where they are — nothing is copied or opened. What cannot be
//! used yet says why, after what can.
use super::*;
use crate::{
    features::project_import::{Mode, SOURCES, Source, visible},
    platform::app_folders::{self, AppFolder},
    ui::components::{Dialog, Icon, IconButton, tinted_checkbox},
};
use std::collections::{BTreeSet, HashMap};

/// An app's folders: asked once when the list opens.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum Folders {
    Loading,
    Failed,
    Found(Vec<AppFolder>),
}

/// The dialog's list and the app step's choices.
pub(in crate::app) struct ImportPicker {
    /// The chosen source; `None` shows the list.
    pub source: Option<&'static Source>,
    pub folders: HashMap<&'static str, Folders>,
    pub chosen: BTreeSet<PathBuf>,
    pub adding: bool,
    pub error: Option<String>,
    /// Which listing is current; a retry replaces it.
    attempt: u64,
}

/// `statusOf`: why a source cannot be chosen now, if it cannot.
fn status(source: &Source, folders: &HashMap<&'static str, Folders>) -> Option<&'static str> {
    if !source.operational {
        return Some("onboarding.entry.import.directUnavailable");
    }
    if source.mode != Mode::App {
        return None;
    }
    match folders.get(source.id) {
        None | Some(Folders::Loading) => Some("onboarding.entry.import.app.loading"),
        Some(Folders::Found(found)) if found.is_empty() => {
            Some("onboarding.entry.import.app.notFound")
        }
        Some(Folders::Failed) => Some("onboarding.entry.import.app.readFailed"),
        Some(Folders::Found(_)) => None,
    }
}
/// A failed read stays choosable, to try again from its step.
fn disabled(source: &Source, folders: &HashMap<&'static str, Folders>) -> bool {
    if !source.operational {
        return true;
    }
    source.mode == Mode::App
        && match folders.get(source.id) {
            None | Some(Folders::Loading) => true,
            Some(Folders::Found(found)) => found.is_empty(),
            Some(Folders::Failed) => false,
        }
}

impl Homepage {
    /// `projectEntryFlow.openImport`: the list of sources.
    pub(in crate::app) fn begin_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.import = None;
        self.import_picker = Some(ImportPicker {
            source: None,
            folders: HashMap::new(),
            chosen: BTreeSet::new(),
            adding: false,
            error: None,
            attempt: 0,
        });
        self.list_app_folders(cx);
        self.open_dialog(DialogKey::ImportRepository, cx);
        self.dialog_focus.focus(window, cx);
        cx.notify();
    }
    /// The visible sources, by experiment.
    pub(in crate::app) fn import_sources(&self, cx: &App) -> Vec<&'static Source> {
        let other_apps = self
            .preferences
            .read(cx)
            .state
            .experimental
            .other_app_imports;
        visible(other_apps).collect()
    }
    /// `useAppFolders`: every visible app's folders, read off the main
    /// thread from that app's own record.
    fn list_app_folders(&mut self, cx: &mut Context<Self>) {
        let apps: Vec<&'static str> = self
            .import_sources(cx)
            .into_iter()
            .filter(|s| s.mode == Mode::App)
            .map(|s| s.id)
            .collect();
        let places = self.places();
        let Some(picker) = self.import_picker.as_mut() else {
            return;
        };
        picker.attempt += 1;
        let attempt = picker.attempt;
        for app in apps {
            picker.folders.insert(app, Folders::Loading);
            let places = places.clone();
            let task = cx
                .background_executor()
                .spawn(async move { app_folders::list(app, &places) });
            cx.spawn(async move |this, cx| {
                let result = task.await;
                let _ = this.update(cx, |s, cx| {
                    let Some(picker) = s.import_picker.as_mut().filter(|p| p.attempt == attempt)
                    else {
                        return;
                    };
                    picker
                        .folders
                        .insert(app, result.map_or(Folders::Failed, Folders::Found));
                    cx.notify();
                });
            })
            .detach();
        }
    }
    pub(in crate::app) fn choose_import_source(
        &mut self,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(source) = SOURCES.iter().find(|s| s.id == id) else {
            return;
        };
        let Some(picker) = self.import_picker.as_mut() else {
            return;
        };
        if disabled(source, &picker.folders) {
            return;
        }
        picker.source = Some(source);
        picker.chosen.clear();
        picker.error = None;
        if let Mode::Repository(provider) = source.mode {
            self.begin_repository_import(provider, window, cx);
        }
        cx.notify();
    }
    /// Back to the list, unless something is on its way.
    fn import_back(&mut self, cx: &mut Context<Self>) {
        if self.import_busy() {
            return;
        }
        self.import = None;
        if let Some(picker) = self.import_picker.as_mut() {
            picker.source = None;
            picker.error = None;
        }
        cx.notify();
    }
    /// Where the apps keep their records (a test's own, when it set one).
    fn places(&self) -> app_folders::Places {
        self.app_places
            .clone()
            .unwrap_or_else(app_folders::Places::native)
    }
    pub(in crate::app) fn import_busy(&self) -> bool {
        self.import_picker.as_ref().is_some_and(|p| p.adding) || self.repository_busy()
    }
    /// Whether `path` is already on the Homepage.
    fn listed(&self, path: &Path, cx: &App) -> bool {
        self.preferences
            .read(cx)
            .state
            .recent_projects
            .iter()
            .any(|p| p.path == path)
    }
    pub(in crate::app) fn toggle_app_folder(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        if let Some(picker) = self.import_picker.as_mut().filter(|p| !p.adding)
            && !picker.chosen.remove(&path)
        {
            picker.chosen.insert(path);
        }
        cx.notify();
    }
    /// `onAddAppFolders`: the chosen folders the app still lists join the
    /// Homepage where they are, in the order shown, ahead of the others.
    pub(in crate::app) fn add_app_folders(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(picker) = self.import_picker.as_ref() else {
            return;
        };
        let Some(source) = picker.source.filter(|s| s.mode == Mode::App) else {
            return;
        };
        let Some(Folders::Found(folders)) = picker.folders.get(source.id) else {
            return;
        };
        let paths: Vec<PathBuf> = folders
            .iter()
            .map(|f| f.path.clone())
            .filter(|p| picker.chosen.contains(p) && !self.listed(p, cx))
            .collect();
        if paths.is_empty() || picker.adding {
            return;
        }
        if let Some(picker) = self.import_picker.as_mut() {
            picker.adding = true;
            picker.error = None;
        }
        let app = source.id;
        let places = self.places();
        // The app is asked again: only folders it still lists, still there.
        let task = cx.background_executor().spawn(async move {
            let offered = app_folders::list(app, &places).ok()?;
            let paths: Vec<PathBuf> = paths
                .into_iter()
                .filter(|p| offered.iter().any(|f| &f.path == p))
                .filter_map(|p| p.canonicalize().ok())
                .collect();
            (!paths.is_empty()).then_some(paths)
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |s, window, cx| {
                match result {
                    Some(paths) => {
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map_or(0, |d| d.as_secs());
                        s.preferences.update(cx, |p, cx| {
                            p.change(|p| p.add_recent_projects(&paths, now), cx)
                        });
                        s.close_import(window, cx);
                    }
                    // The app no longer lists them, or they are gone.
                    None => {
                        if let Some(picker) = s.import_picker.as_mut() {
                            picker.adding = false;
                            picker.error =
                                Some(tr("onboarding.entry.import.app.readFailed").into());
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    // ------------------------------------------------------------- drawing
    /// The dialog's heading: back to the list once a source is chosen.
    pub(in crate::app) fn import_heading(
        &self,
        title: String,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let chosen = self
            .import_picker
            .as_ref()
            .is_some_and(|p| p.source.is_some());
        let busy = self.import_busy();
        h_flex()
            .gap(px(6.))
            .min_w_0()
            .when(chosen, |d| {
                d.child(
                    IconButton::new("import-back", "arrow-left")
                        .label(tr("onboarding.entry.import.back"))
                        .with_size(px(24.))
                        .color(t.muted)
                        .disabled(busy)
                        .on_click(cx.listener(|s, _, _, cx| s.import_back(cx))),
                )
            })
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(theme::ty().ui.label))
                    .line_height(px(18.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.muted)
                    .child(title),
            )
            .into_any_element()
    }
    /// `ImportSourceMark`: the source's own mark, or a plain glyph.
    fn import_mark(&self, id: &str, cx: &App) -> AnyElement {
        let t = cx.palette();
        let image = |path: &'static str| img(path).size(px(18.)).into_any_element();
        match id {
            "github" if t.dark => image("integrations/github-inverse.svg"),
            "github" => image("integrations/github.svg"),
            "gitlab" => image("integrations/gitlab.svg"),
            "notion" => image("integrations/notion.svg"),
            "google-drive" => image("integrations/google-drive.svg"),
            "obsidian" => image("integrations/obsidian.svg"),
            "airtable" => image("integrations/airtable.png"),
            "cursor" if t.dark => image("agents/cursor-dark.svg"),
            "cursor" => image("agents/cursor.svg"),
            "vscode" => Icon::new("code-xml")
                .with_size(px(18.))
                .stroke(1.8)
                .color(t.muted)
                .into_any_element(),
            "typora" => Icon::new("type")
                .with_size(px(18.))
                .stroke(1.8)
                .color(t.muted)
                .into_any_element(),
            _ => Icon::new("database")
                .with_size(px(18.))
                .stroke(1.8)
                .color(t.muted)
                .into_any_element(),
        }
    }
    /// `ImportSourceList`: what can be imported now first, two to a row.
    pub(in crate::app) fn import_sources_list(
        &self,
        picker: &ImportPicker,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let mut sources = self.import_sources(cx);
        sources.sort_by_key(|s| status(s, &picker.folders).is_some());
        let tiles: Vec<AnyElement> = sources
            .into_iter()
            .map(|source| {
                let note = status(source, &picker.folders);
                let off = disabled(source, &picker.folders);
                let id = source.id;
                div()
                    .id(SharedString::from(format!("import-source-{id}")))
                    .min_w_0()
                    .min_h(px(52.))
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .pl(px(10.))
                    .pr(px(12.))
                    .py(px(9.))
                    .border_1()
                    .border_color(t.border_subtle)
                    .when(off, |d| d.border_dashed())
                    .rounded(px(10.))
                    .when(!off, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(|d| d.border_color(t.border_strong).bg(t.hover))
                            .on_click(
                                cx.listener(move |s, _, w, cx| s.choose_import_source(id, w, cx)),
                            )
                    })
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .size(px(32.))
                            .items_center()
                            .justify_center()
                            .rounded(px(8.))
                            .border_1()
                            .border_color(theme::alpha(t.text, 0.06))
                            .bg(theme::alpha(t.text, 0.05))
                            .when(off, |d| d.opacity(0.5))
                            .child(self.import_mark(id, cx)),
                    )
                    .child(
                        v_flex()
                            .min_w_0()
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(ty.body))
                                    .line_height(px(if off { 18. } else { 20. }))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .when(off, |d| d.opacity(0.5))
                                    .child(source.label),
                            )
                            .children(note.map(|key| {
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(ty.caption))
                                    .line_height(px(16.))
                                    .text_color(t.subtle)
                                    .child(tr(key))
                            })),
                    )
                    .into_any_element()
            })
            .collect();
        let mut rows = v_flex().gap(px(8.));
        let mut tiles = tiles.into_iter().peekable();
        while tiles.peek().is_some() {
            let mut row = h_flex().gap(px(8.)).items_stretch();
            for _ in 0..2 {
                row = row.child(div().flex_1().min_w_0().children(tiles.next()));
            }
            rows = rows.child(row);
        }
        rows
    }
    /// `AppFoldersStep`: a quiet checklist, name first, place beneath.
    pub(in crate::app) fn app_folders_step(
        &self,
        picker: &ImportPicker,
        source: &'static Source,
        cx: &mut Context<Self>,
    ) -> (Div, usize) {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let folders = picker.folders.get(source.id);
        let mut body = v_flex().child(
            div()
                .text_size(px(ty.meta))
                .line_height(px(18.))
                .text_color(t.muted)
                .child(tr("onboarding.entry.import.app.outcome")),
        );
        let mut selected = 0;
        match folders {
            None | Some(Folders::Loading) => {
                body = body.child(
                    div()
                        .pt(px(14.))
                        .text_size(px(ty.meta))
                        .text_color(t.muted)
                        .child(tr("onboarding.entry.import.app.loading")),
                );
            }
            Some(Folders::Failed) => {
                body = body.child(
                    v_flex()
                        .pt(px(14.))
                        .gap(px(8.))
                        .items_start()
                        .child(
                            div()
                                .text_size(px(ty.meta))
                                .text_color(t.danger)
                                .child(tr("onboarding.entry.import.app.readFailed")),
                        )
                        .child(
                            Button::new("import-app-retry")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.retry"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.list_app_folders(cx);
                                    cx.notify();
                                })),
                        ),
                );
            }
            Some(Folders::Found(found)) if found.is_empty() => {
                body = body.child(
                    div()
                        .pt(px(14.))
                        .text_size(px(ty.meta))
                        .line_height(px(18.))
                        .text_color(t.muted)
                        .child(tf(
                            "onboarding.entry.import.app.empty",
                            &[("provider", source.label.into())],
                        )),
                );
            }
            Some(Folders::Found(found)) => {
                let rows: Vec<AnyElement> = found
                    .iter()
                    .enumerate()
                    .map(|(index, folder)| {
                        let added = self.listed(&folder.path, cx);
                        let checked = added || picker.chosen.contains(&folder.path);
                        if checked && !added {
                            selected += 1;
                        }
                        let path = folder.path.clone();
                        h_flex()
                            .id(("import-app-folder", index))
                            .gap(px(10.))
                            .px(px(8.))
                            .py(px(7.))
                            .rounded(px(6.))
                            .when(!added && !picker.adding, |d| {
                                d.cursor(theme::clickable_cursor())
                                    .hover(|d| d.bg(t.hover))
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        s.toggle_app_folder(path.clone(), cx)
                                    }))
                            })
                            .child(
                                div()
                                    .w(px(16.))
                                    .flex()
                                    .justify_center()
                                    .child(tinted_checkbox(checked, t.text, cx)),
                            )
                            .child(
                                v_flex()
                                    .flex_1()
                                    .min_w_0()
                                    .when(added, |d| d.opacity(0.55))
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(ty.body))
                                            .line_height(px(20.))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.text)
                                            .child(folder.name.clone()),
                                    )
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(ty.caption))
                                            .line_height(px(16.))
                                            .text_color(t.subtle)
                                            .child(folder.path.display().to_string()),
                                    ),
                            )
                            .when(added, |d| {
                                d.child(
                                    div()
                                        .text_size(px(ty.caption))
                                        .text_color(t.subtle)
                                        .child(tr("onboarding.entry.import.app.added")),
                                )
                            })
                            .into_any_element()
                    })
                    .collect();
                body = body.child(
                    div()
                        .id("import-app-folders")
                        .mt(px(14.))
                        .max_h(px(320.))
                        .overflow_y_scroll()
                        .p(px(4.))
                        .border_1()
                        .border_color(t.border_subtle)
                        .rounded(px(10.))
                        .child(v_flex().children(rows)),
                );
            }
        }
        if let Some(error) = &picker.error {
            body = body.child(
                div()
                    .pt(px(10.))
                    .text_size(px(ty.meta))
                    .text_color(t.danger)
                    .child(error.clone()),
            );
        }
        (body, selected)
    }
    /// The list or the app step, in the import dialog.
    pub(in crate::app) fn import_picker_dialog(
        &self,
        picker: &ImportPicker,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let host = self.weak.clone();
        let dialog = Dialog::new("import-sources")
            .width(420.)
            .inset(24.)
            .body_padding(10., 22.)
            .leading(Icon::new("download").stroke(1.8), t.accent)
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_import(w, cx));
            });
        let Some(source) = picker.source.filter(|s| s.mode == Mode::App) else {
            return dialog
                .heading(self.import_heading(tr("onboarding.entry.import.title").to_owned(), cx))
                .child(self.import_sources_list(picker, cx));
        };
        let title = tf(
            "onboarding.entry.import.app.title",
            &[("provider", source.label.into())],
        );
        let (body, selected) = self.app_folders_step(picker, source, cx);
        let adding = picker.adding;
        dialog
            .heading(self.import_heading(title, cx))
            .child(body)
            .footer(
                Button::new("import-app-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(adding)
                    .on_click(cx.listener(|s, _, w, cx| s.close_import(w, cx))),
            )
            .footer(
                Button::new("import-app-add")
                    .variant(ButtonVariant::Solid)
                    .label(tf(
                        "onboarding.entry.import.app.submit",
                        &[("count", (selected as i64).into())],
                    ))
                    .disabled(adding || selected == 0)
                    .on_click(cx.listener(|s, _, w, cx| s.add_app_folders(w, cx))),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_experiment_opens_the_other_apps_and_coming_soon_stays_last() {
        let ready: Vec<_> = visible(false).map(|s| s.id).collect();
        assert_eq!(ready, ["github", "gitlab"]);
        assert_eq!(visible(true).count(), SOURCES.len());
        let mut folders = HashMap::new();
        let source = |id| SOURCES.iter().find(|s| s.id == id).unwrap();
        assert_eq!(status(source("github"), &folders), None);
        assert_eq!(
            status(source("notion"), &folders),
            Some("onboarding.entry.import.directUnavailable")
        );
        assert!(disabled(source("obsidian"), &folders), "still reading");
        folders.insert("obsidian", Folders::Found(vec![]));
        assert_eq!(
            status(source("obsidian"), &folders),
            Some("onboarding.entry.import.app.notFound")
        );
        assert!(disabled(source("obsidian"), &folders));
        folders.insert("obsidian", Folders::Failed);
        assert!(
            !disabled(source("obsidian"), &folders),
            "a failed read can be retried"
        );
        folders.insert(
            "obsidian",
            Folders::Found(vec![AppFolder {
                path: "/v".into(),
                name: "v".into(),
                last_used_at: None,
            }]),
        );
        assert_eq!(status(source("obsidian"), &folders), None);
        assert!(!disabled(source("obsidian"), &folders));
    }
}
