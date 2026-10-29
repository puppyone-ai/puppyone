//! `OnboardingImportDialog` for the ready sources (GitHub, GitLab): a
//! repository URL and a location (the same `Documents/PuppyOne` default as
//! Create); Import clones into the location and opens the project. The clone
//! runs on a worker and can be cancelled; nothing is left behind.
use super::*;
use crate::{
    platform::repository_import::{self, Provider},
    ui::{
        components::{Dialog, Icon},
        form_input::{InputEvent, TextInput},
    },
};
use std::sync::{Arc, atomic::AtomicBool};

pub(in crate::shell) struct ImportRepository {
    pub(in crate::shell) url: Entity<TextInput>,
    location: Option<PathBuf>,
    /// The clone in flight and its cancellation.
    cloning: Option<Arc<AtomicBool>>,
    error: Option<String>,
}

impl Shell {
    pub(in crate::shell) fn begin_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let url = cx.new(|cx| {
            let mut input = TextInput::new(
                "https://github.com/owner/repository",
                false,
                512,
                window,
                cx,
            );
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
        self.modals.open(Modal::ImportRepository(ImportRepository {
            url,
            location: create_project::default_location(),
            cloning: None,
            error: None,
        }));
        cx.notify();
    }
    fn import_state(&mut self) -> Option<&mut ImportRepository> {
        self.modals.iter_mut().find_map(|m| match m {
            Modal::ImportRepository(import) => Some(import),
            _ => None,
        })
    }
    pub(in crate::shell) fn close_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(import) = self.import_state()
            && let Some(cancel) = import.cloning.take()
        {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        self.modals
            .remove(|m| matches!(m, Modal::ImportRepository(_)));
        self.focus.focus(window, cx);
        cx.notify();
    }
    fn choose_import_location(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
    pub(in crate::shell) fn submit_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(import) = self.import_state() else {
            return;
        };
        if import.cloning.is_some() {
            return;
        }
        let text = import.url.read(cx).text().to_owned();
        let Some(location) = import.location.clone() else {
            return;
        };
        let Some(repository) = repository_import::parse(&text) else {
            let provider = repository_import::detect(&text).map_or("GitHub", Provider::label);
            import.error = Some(tf(
                "onboarding.entry.clone.unsupportedUrl",
                &[("provider", provider.into())],
            ));
            cx.notify();
            return;
        };
        let cancel = Arc::new(AtomicBool::new(false));
        import.cloning = Some(cancel.clone());
        import.error = None;
        cx.notify();
        let task = cx
            .background_executor()
            .spawn(async move { repository_import::clone_into(&location, &repository, &cancel) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |s, w, cx| {
                let Some(import) = s.import_state() else {
                    return;
                };
                import.cloning = None;
                match result {
                    Ok(path) => {
                        s.modals.remove(|m| matches!(m, Modal::ImportRepository(_)));
                        s.open_project(path, w, cx);
                    }
                    Err(error) => import.error = Some(error),
                }
                cx.notify();
            });
        })
        .detach();
    }
    pub(in crate::shell) fn import_dialog(
        &self,
        import: &ImportRepository,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty();
        let host = self.weak.clone();
        let text = import.url.read(cx).text().to_owned();
        let provider = repository_import::detect(&text);
        let title = match provider {
            Some(p) => tf(
                "onboarding.entry.import.repository.title",
                &[("provider", p.label().into())],
            ),
            None => tr("onboarding.entry.import.title").to_owned(),
        };
        let busy = import.cloning.is_some();
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
                            .when(!busy, |d| d.cursor(theme::clickable_cursor()))
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
        if busy {
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
            .title(title)
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_import(w, cx));
            })
            .child(body)
            .footer(
                Button::new("import-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .on_click(cx.listener(|s, _, w, cx| s.close_import(w, cx))),
            )
            .footer(
                Button::new("import-submit")
                    .variant(ButtonVariant::Solid)
                    .label(tr("onboarding.entry.import.title"))
                    .disabled(busy || text.trim().is_empty() || location.is_none())
                    .on_click(cx.listener(|s, _, w, cx| s.submit_import(w, cx))),
            )
    }
}
