//! `RepositoryImportStep`, chosen from the import sources (GitHub, GitLab):
//! a repository URL of that provider and a location (the same
//! `Documents/PuppyOne` default as Create); Import clones into the location
//! and opens the project. The clone runs on a worker and can be cancelled;
//! nothing is left behind. A project imported whose folder then can't be
//! opened stays in the dialog to be opened again.
use super::*;
use crate::{
    platform::repository_import::{self, Provider},
    ui::{
        components::{Dialog, Icon},
        form_input::{InputEvent, TextInput},
    },
};
use std::sync::{Arc, atomic::AtomicBool};

#[cfg(test)]
mod tests;

pub(in crate::app) struct ImportRepository {
    /// The source chosen in the list; the URL must be its.
    provider: Provider,
    pub(in crate::app) url: Entity<TextInput>,
    location: Option<PathBuf>,
    /// The clone in flight and its cancellation.
    cloning: Option<Arc<AtomicBool>>,
    publication: Option<Arc<repository_import::Publication>>,
    /// Imported, but its folder could not be opened: Import opens it again.
    pub(in crate::app) imported: Option<PathBuf>,
    error: Option<String>,
}

impl Drop for ImportRepository {
    fn drop(&mut self) {
        if let Some(publication) = &self.publication {
            publication.cancel();
        }
        if let Some(cancel) = &self.cloning {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

impl Homepage {
    pub(in crate::app) fn begin_repository_import(
        &mut self,
        provider: Provider,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let placeholder = match provider {
            Provider::GitHub => "https://github.com/owner/repository",
            Provider::GitLab => "https://gitlab.com/group/project",
        };
        let url = cx.new(|cx| {
            let mut input = TextInput::new(placeholder, false, 512, window, cx);
            input.submit_on_enter = true;
            input.appearance = false;
            input.prompt_text = Some((theme::ty().ui.control, 18.));
            input
        });
        cx.subscribe_in(&url, window, |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                s.submit_import(w, cx)
            } else {
                cx.notify();
            }
        })
        .detach();
        url.read(cx).focus_handle(cx).focus(window, cx);
        self.import = Some(ImportRepository {
            provider,
            url,
            location: create_project::default_location(),
            cloning: None,
            publication: None,
            imported: None,
            error: None,
        });
        cx.notify();
    }
    pub(in crate::app) fn repository_busy(&self) -> bool {
        self.import.as_ref().is_some_and(|i| i.cloning.is_some())
    }
    fn import_state(&mut self) -> Option<&mut ImportRepository> {
        self.import.as_mut()
    }
    pub(in crate::app) fn close_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .import
            .as_ref()
            .and_then(|i| i.publication.as_ref())
            .is_some_and(|p| !p.cancel())
        {
            cx.notify();
            return;
        }
        if let Some(import) = self.import_state()
            && let Some(cancel) = import.cloning.take()
        {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        self.import = None;
        self.import_picker = None;
        self.close_dialog(DialogKey::ImportRepository, cx);
        self.window_focus.focus(window, cx);
        cx.notify();
    }
    fn choose_import_location(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(import) = self
            .import
            .as_ref()
            .filter(|i| i.cloning.is_none() && i.imported.is_none())
        else {
            return;
        };
        let owner = import.url.entity_id();
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(tr("onboarding.entry.import.browse").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = prompt.await;
            let _ = this.update(cx, |s, cx| {
                if let Some(import) = s.import_state()
                    && import.url.entity_id() == owner
                    && import.cloning.is_none()
                    && import.imported.is_none()
                    && let Ok(Ok(Some(paths))) = result
                    && let Some(path) = paths.into_iter().next()
                {
                    import.location = Some(path);
                }
                cx.notify();
            });
        })
        .detach();
    }
    pub(in crate::app) fn submit_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(import) = self.import_state() else {
            return;
        };
        if import.cloning.is_some() {
            return;
        }
        if let Some(path) = import.imported.clone() {
            return self.open_imported(path, window, cx);
        }
        let text = import.url.read(cx).text().to_owned();
        let Some(location) = import.location.clone() else {
            return;
        };
        let provider = import.provider;
        let Some(repository) = repository_import::parse(&text)
            .filter(|_| repository_import::detect(&text) == Some(provider))
        else {
            import.error = Some(tf(
                "onboarding.entry.clone.unsupportedUrl",
                &[("provider", provider.label().into())],
            ));
            cx.notify();
            return;
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let (publication, progress) = repository_import::Publication::new(cancel.clone());
        let publication = Arc::new(publication);
        import.publication = Some(publication.clone());
        import.cloning = Some(cancel.clone());
        import.error = None;
        self.observe_import_publication(cancel, progress, cx);
        cx.notify();
        let task = cx.background_executor().spawn(async move {
            repository_import::clone_with_publication(&location, &repository, &publication)
                .map(|path| (opens(&path), path))
        });
        self.finish_import(task, window, cx);
    }
    /// `retryRequest`: the imported project, opened again.
    fn open_imported(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        let Some(import) = self.import_state() else {
            return;
        };
        import.cloning = Some(Arc::new(AtomicBool::new(false)));
        import.publication = None;
        import.error = None;
        cx.notify();
        let task = cx
            .background_executor()
            .spawn(async move { Ok((opens(&path), path)) });
        self.finish_import(task, window, cx);
    }
    fn observe_import_publication(
        &self,
        attempt: Arc<AtomicBool>,
        progress: async_channel::Receiver<()>,
        cx: &mut Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            while progress.recv().await.is_ok() {
                if this
                    .update(cx, |s, cx| {
                        if s.owns_import_attempt(&attempt) {
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }
    /// The import's end: its project opened here, the dialog closing; or
    /// imported but not openable (`opening.status === "failed"`), said and
    /// kept to try again; or what went wrong.
    fn finish_import(
        &mut self,
        task: gpui::Task<Result<(bool, PathBuf), String>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(attempt) = self.import.as_ref().and_then(|i| i.cloning.clone()) else {
            return;
        };
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let prepared = this.update(cx, |s, cx| {
                if !s.owns_import_attempt(&attempt) {
                    return None;
                }
                let (can_open, path) = match result {
                    Ok(value) => value,
                    Err(error) => {
                        let import = s.import.as_mut().unwrap();
                        import.cloning = None;
                        import.error = Some(error);
                        cx.notify();
                        return None;
                    }
                };
                // Publication is complete. Keep this exact project throughout
                // persistence and opening failures, including a later retry.
                s.import.as_mut().unwrap().imported = Some(path.clone());
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or_default();
                let persisted = s.preferences.update(cx, |p, cx| {
                    p.change(|p| p.remember_project(&path, now), cx);
                    p.flush(cx)
                });
                cx.notify();
                Some((can_open, path, persisted))
            });
            let Ok(Some((can_open, path, persisted))) = prepared else {
                return;
            };
            let persisted = persisted.await;
            let _ = this.update(cx, |s, cx| {
                if !s.owns_import_attempt(&attempt) {
                    return;
                }
                if persisted.is_err() || !can_open {
                    s.finish_import_opening(&attempt, false, cx);
                } else {
                    cx.emit(HomeEvent::OpenImported { path, attempt });
                }
            });
        })
        .detach();
    }
    pub(in crate::app) fn owns_import_attempt(&self, attempt: &Arc<AtomicBool>) -> bool {
        !attempt.load(std::sync::atomic::Ordering::Relaxed)
            && self
                .import
                .as_ref()
                .and_then(|i| i.cloning.as_ref())
                .is_some_and(|current| Arc::ptr_eq(current, attempt))
    }
    pub(in crate::app) fn finish_import_opening(
        &mut self,
        attempt: &Arc<AtomicBool>,
        opened: bool,
        cx: &mut Context<Self>,
    ) {
        if !self.owns_import_attempt(attempt) {
            return;
        }
        if opened {
            self.import = None;
            self.import_picker = None;
            self.close_dialog(DialogKey::ImportRepository, cx);
        } else {
            let import = self.import.as_mut().unwrap();
            import.cloning = None;
            import.error = Some(tr("onboarding.entry.import.openFailed").into());
        }
        cx.notify();
    }
    pub(in crate::app) fn import_dialog(
        &self,
        import: &ImportRepository,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty();
        let host = self.weak.clone();
        let text = import.url.read(cx).text().to_owned();
        let title = tf(
            "onboarding.entry.import.repository.title",
            &[("provider", import.provider.label().into())],
        );
        let busy = import.cloning.is_some();
        let imported = import.imported.is_some();
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
        let label = |key: &'static str| {
            div()
                .text_size(px(ty.ui.body))
                .line_height(px(18.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .child(tr(key))
        };
        let location = import.location.as_ref().map(|p| p.display().to_string());
        let mut body = v_flex()
            .gap(px(18.))
            .child(
                v_flex()
                    .gap(px(8.))
                    .child(label("onboarding.entry.clone.urlLabel"))
                    .child(
                        field()
                            .px(px(8.))
                            .child(div().w_full().text_color(t.text).child(import.url.clone())),
                    ),
            )
            .child(
                v_flex()
                    .gap(px(8.))
                    .child(label("onboarding.entry.create.locationLabel"))
                    .child(
                        field()
                            .id("import-location")
                            .px(px(11.))
                            .gap(px(10.))
                            .when(!busy && !imported, |d| d.cursor(theme::clickable_cursor()))
                            .on_click(cx.listener(|s, _, w, cx| s.choose_import_location(w, cx)))
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
                                    .text_color(t.text)
                                    .child(location.clone().unwrap_or_default()),
                            ),
                    ),
            );
        if busy && !imported {
            body = body.child(
                h_flex()
                    .gap(px(8.))
                    .text_size(px(ty.ui.meta))
                    .text_color(t.muted)
                    .child(
                        crate::ui::loading::LoadingMark::new("import-cloning")
                            .size(crate::ui::loading::LoaderSize::Xs)
                            .tone(crate::ui::loading::Tone::Neutral),
                    )
                    .child(tr("onboarding.status.loadingProject")),
            );
        }
        if let Some(error) = &import.error {
            body = body.child(
                div()
                    .text_size(px(ty.ui.meta))
                    .text_color(t.danger)
                    .child(error.clone()),
            );
        }
        Dialog::new("import-repository")
            .width(420.)
            .inset(24.)
            .body_padding(10., 22.)
            .leading(Icon::new("download").stroke(1.8), t.accent)
            .heading(self.import_heading(title, cx))
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_import(w, cx));
            })
            .child(body)
            .footer(
                Button::new("import-cancel")
                    .debug_selector(|| "import-cancel".into())
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(import.publication.as_ref().is_some_and(|p| p.publishing()))
                    .on_click(cx.listener(|s, _, w, cx| s.close_import(w, cx))),
            )
            .footer(
                Button::new("import-submit")
                    .variant(ButtonVariant::Solid)
                    .label(tr(match (busy, imported) {
                        (true, true) => "onboarding.status.opening",
                        (true, false) => "onboarding.entry.clone.submitting",
                        (false, true) => "onboarding.entry.import.retryOpen",
                        (false, false) => "onboarding.entry.clone.submit",
                    }))
                    .disabled(
                        busy || !imported
                            && (location.is_none()
                                || repository_import::detect(&text) != Some(import.provider)),
                    )
                    .on_click(cx.listener(|s, _, w, cx| s.submit_import(w, cx))),
            )
    }
}

/// Whether the imported project's folder can be opened now.
fn opens(path: &Path) -> bool {
    crate::platform::folder_availability::probe(path)
        == crate::platform::folder_availability::State::Available
}
