//! `TemplateImportCard`: what a template link opens — the template and one
//! action, "Get a copy". The name and the place have good defaults, so
//! asking about them waits until someone wants to change them; nothing is
//! created until the copy is asked for. A copy never takes the place of a
//! project open in this window: it opens in a window of its own (W-7).
use super::{
    create_project::{Destination, default_location},
    *,
};
use crate::{
    platform::templates::{
        self,
        store::{Detail, SIGNED_OUT, Store},
    },
    ui::components::{Dialog, Icon},
};

pub(in crate::shell) struct TemplateImport {
    pub(in crate::shell) url: String,
    pub(in crate::shell) destination: Destination,
    pub(in crate::shell) detail: Option<Detail>,
    pub(in crate::shell) resolving: bool,
    resolve_error: Option<String>,
    /// Which resolution is current; a later one replaces it.
    generation: u64,
    /// The name and place fields are open (Change).
    editing: bool,
    pub(in crate::shell) submitting: bool,
    pub(in crate::shell) error: Option<String>,
    /// A project is open here, and a copy must not take its place.
    pub(in crate::shell) new_window: bool,
}

impl Shell {
    /// `openTemplate`: the card for `url`, in place of the entry dialogs.
    pub(in crate::shell) fn open_template_link(
        &mut self,
        url: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.modals.remove(|m| {
            matches!(
                m,
                Modal::CreateProject(_) | Modal::ProjectEntry | Modal::TemplateImport(_)
            )
        });
        let name = self.project_name_input(String::new(), window, cx, Self::submit_template);
        self.modals
            .open(Modal::TemplateImport(Box::new(TemplateImport {
                url,
                destination: Destination {
                    name,
                    location: default_location(),
                    choosing: false,
                },
                detail: None,
                resolving: true,
                resolve_error: None,
                generation: 0,
                editing: false,
                submitting: false,
                error: None,
                new_window: self.workspace_root().is_some() && !self.home_visible(),
            })));
        self.resolve_template(window, cx);
        cx.notify();
    }
    fn template_import(&mut self) -> Option<&mut TemplateImport> {
        self.modals.iter_mut().find_map(|m| match m {
            Modal::TemplateImport(import) => Some(&mut **import),
            _ => None,
        })
    }
    /// `resolve`: the template's details, in the app's language.
    fn resolve_template(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(import) = self.template_import() else {
            return;
        };
        import.generation += 1;
        import.resolving = true;
        import.resolve_error = None;
        import.detail = None;
        let (url, generation) = (import.url.clone(), import.generation);
        let locale = crate::localization::current_code();
        let task = cx.background_spawn(async move { Store::current().resolve(&url, &locale) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |s, window, cx| {
                let Some(import) = s.template_import() else {
                    return;
                };
                if import.generation != generation {
                    return;
                }
                import.resolving = false;
                match result {
                    Ok(detail) => {
                        let name = Some(templates::project_name_from(&detail.name))
                            .filter(|n| !n.is_empty())
                            .unwrap_or_else(|| tr("onboarding.entry.create.defaultName").into());
                        let input = import.destination.name.clone();
                        import.detail = Some(detail);
                        input.update(cx, |input, cx| input.set_text(name, cx));
                        input.read(cx).focus_handle(cx).focus(window, cx);
                    }
                    Err(error) => import.resolve_error = Some(error),
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn close_template(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.template_import().is_some_and(|i| i.submitting) {
            return;
        }
        self.modals
            .remove(|m| matches!(m, Modal::TemplateImport(_)));
        self.focus.focus(window, cx);
        cx.notify();
    }
    /// A template the store keeps for accounts, and nobody signed in.
    fn template_needs_sign_in(&self, cx: &App) -> bool {
        self.modals.iter().any(|m| {
            matches!(m, Modal::TemplateImport(import)
                if import.detail.as_ref().is_some_and(|d| d.requires_sign_in))
        }) && !crate::features::cloud::account::has_account(cx)
    }
    /// "Get a copy": the release's verified files, under a name no folder
    /// has yet, then the project opens on its first document.
    pub(in crate::shell) fn submit_template(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let needs_sign_in = self.template_needs_sign_in(cx);
        let account = crate::features::cloud::account::broker_and_binding(cx);
        let Some(import) = self.template_import() else {
            return;
        };
        let (Some(detail), Some(parent)) =
            (import.detail.clone(), import.destination.location.clone())
        else {
            return;
        };
        if import.submitting || import.destination.choosing || needs_sign_in {
            return;
        }
        let name = match templates::require_project_name(import.destination.name.read(cx).text()) {
            Ok(name) => name.to_owned(),
            Err(error) => {
                import.error = Some(error);
                cx.notify();
                return;
            }
        };
        import.submitting = true;
        import.error = None;
        let new_window = import.new_window;
        let task = cx.background_spawn(async move {
            let store = Store::current();
            let release = detail.release_id.clone();
            let authorize = move |url: &str| {
                let Some((broker, binding)) = account else {
                    return Err(SIGNED_OUT.to_owned());
                };
                let url = url::Url::parse(url).map_err(|_| SIGNED_OUT.to_owned())?;
                broker
                    .template_download(&binding, &url, &release, &Default::default())
                    .map_err(|error| match error {
                        crate::cloud::auth::Error::Http(_) => {
                            "Template authorization failed. Please sign in again.".to_owned()
                        }
                        _ => SIGNED_OUT.to_owned(),
                    })
            };
            let plan = store.download(
                &detail.id,
                &detail.release_id,
                authorize,
                crate::features::cloud::agents::now_ms(),
            )?;
            // `numberIfTaken`: a copy never fails for a name in use.
            let name = templates::free_name(&parent, &name)?;
            let path = templates::materialize(&parent, &name, &plan)?;
            Ok::<_, String>((path, plan.initial_open))
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |s, window, cx| {
                match result {
                    Ok((path, open)) => {
                        s.modals.remove(|m| matches!(m, Modal::TemplateImport(_)));
                        s.open_created_project(
                            path,
                            open.map(PathBuf::from),
                            new_window,
                            window,
                            cx,
                        );
                    }
                    Err(error) => {
                        if let Some(import) = s.template_import() {
                            import.submitting = false;
                            import.error = Some(error);
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub(in crate::shell) fn template_import_dialog(
        &self,
        import: &TemplateImport,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let ty = theme::ty().ui;
        let host = self.weak.clone();
        let busy = import.submitting || import.destination.choosing;
        let needs_sign_in = self.template_needs_sign_in(cx);
        let signing_in = crate::features::cloud::account::status(cx)
            == Some(crate::cloud::auth::Status::SigningIn);
        let note = |text: String| {
            div()
                .text_size(px(ty.meta))
                .line_height(px(18.))
                .text_color(t.muted)
                .child(text)
        };
        let alert = |text: String| {
            div()
                .text_size(px(ty.meta))
                .line_height(px(18.))
                .text_color(t.danger)
                .child(text)
        };
        let mut body = v_flex().gap(px(14.));
        if import.resolving {
            body = body.child(note(tr("onboarding.template.loading").into()));
        }
        if let Some(detail) = &import.detail {
            let facts = [
                Some(detail.author.clone()).filter(|a| !a.is_empty()),
                detail.file_count.map(|count| {
                    tf(
                        "onboarding.template.fileCount",
                        &[("count", (count as usize).into())],
                    )
                }),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" · ");
            let identity = h_flex()
                .gap(px(12.))
                .items_center()
                .min_w_0()
                .child(
                    div()
                        .size(px(40.))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .border_1()
                        .border_color(t.border_subtle)
                        .rounded(px(10.))
                        .text_size(px(ty.title))
                        .line_height(px(ty.title))
                        .child(match &detail.icon {
                            Some(icon) => div().child(icon.clone()).into_any_element(),
                            None => Icon::product(crate::ui::components::ProductIcon::Folder)
                                .with_size(px(20.))
                                .color(t.muted)
                                .into_any_element(),
                        }),
                )
                .child(
                    v_flex()
                        .min_w_0()
                        .child(
                            div()
                                .truncate()
                                .text_size(px(ty.body))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(t.text)
                                .child(detail.name.clone()),
                        )
                        .when(!facts.is_empty(), |d| {
                            d.child(
                                div()
                                    .mt(px(2.))
                                    .truncate()
                                    .text_size(px(ty.caption))
                                    .text_color(t.muted)
                                    .child(facts),
                            )
                        }),
                );
            let mut template = v_flex().gap(px(14.)).min_w_0().child(identity);
            if !detail.description.is_empty() {
                template = template.child(
                    div()
                        .line_clamp(3)
                        .text_size(px(ty.meta))
                        .line_height(relative(1.5))
                        .text_color(t.muted)
                        .child(detail.description.clone()),
                );
            }
            template = if import.editing {
                template.child(self.destination_fields(&import.destination, busy, cx))
            } else {
                // A long path would be cut off at the end, the part that matters.
                let name = import.destination.name.read(cx).text().to_owned();
                let shown = import
                    .destination
                    .location
                    .as_ref()
                    .and_then(|p| p.file_name())
                    .map(|folder| format!("{}/{name}", folder.to_string_lossy()))
                    .unwrap_or_else(|| tr("onboarding.entry.create.locationPlaceholder").into());
                let full = import
                    .destination
                    .location
                    .as_ref()
                    .map(|p| format!("{}/{name}", p.display()))
                    .unwrap_or_else(|| shown.clone());
                template.child(
                    h_flex()
                        .justify_between()
                        .items_center()
                        .gap(px(12.))
                        .min_w_0()
                        .text_size(px(ty.caption))
                        .text_color(t.muted)
                        .child(
                            div()
                                .id("template-destination")
                                .min_w_0()
                                .truncate()
                                .tooltip(crate::ui::components::tooltip(full))
                                .child(shown),
                        )
                        .child(
                            div()
                                .id("template-destination-change")
                                .debug_selector(|| "template-destination-change".into())
                                .flex_none()
                                .text_color(t.muted)
                                .when(!busy, |d| {
                                    d.cursor(theme::clickable_cursor())
                                        .hover(|s| s.text_color(t.text))
                                        .on_click(cx.listener(|s, _, _, cx| {
                                            if let Some(import) = s.template_import() {
                                                import.editing = true;
                                            }
                                            cx.notify();
                                        }))
                                })
                                .child(tr("onboarding.entry.create.change")),
                        ),
                )
            };
            body = body.child(template);
        }
        if needs_sign_in {
            body = body.child(
                div().child(
                    Button::new("template-sign-in")
                        .variant(ButtonVariant::Secondary)
                        .label(tr(if signing_in {
                            "onboarding.template.signingIn"
                        } else {
                            "onboarding.template.signIn"
                        }))
                        .disabled(signing_in)
                        .on_click(|_, _, cx| crate::features::cloud::account::sign_in(cx)),
                ),
            );
        }
        for message in [import.resolve_error.clone(), import.error.clone()]
            .into_iter()
            .flatten()
        {
            body = body.child(alert(message));
        }
        let ready = import.detail.is_some()
            && !needs_sign_in
            && !import.resolving
            && !import.destination.name.read(cx).text().trim().is_empty()
            && import.destination.location.is_some();
        let primary = if import.resolve_error.is_some() {
            Button::new("template-retry")
                .variant(ButtonVariant::Solid)
                .label(tr("common.action.retry"))
                .on_click(cx.listener(|s, _, w, cx| s.resolve_template(w, cx)))
        } else {
            Button::new("template-get-copy")
                .variant(ButtonVariant::Solid)
                .label(tr(if import.submitting {
                    "onboarding.entry.create.submitting"
                } else {
                    "onboarding.template.getCopy"
                }))
                .disabled(busy || !ready)
                .on_click(cx.listener(|s, _, w, cx| s.submit_template(w, cx)))
        };
        Dialog::new("template-import")
            .width(400.)
            .inset(24.)
            .body_padding(10., 22.)
            .leading(Icon::new("folder-plus").stroke(1.8), t.accent)
            .title(tr("onboarding.template.title"))
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.close_template(w, cx));
            })
            .child(body)
            .footer(
                Button::new("template-cancel")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, w, cx| s.close_template(w, cx))),
            )
            .footer(primary)
    }
    /// Escape, unless a copy is on its way.
    pub(in crate::shell) fn dismiss_template(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_template(window, cx);
    }
}
