//! MCP, CLI, Git and Access: the access points, their permissions and
//! scope settings, and the form that creates one.
use super::*;

impl CloudServices {
    pub(super) fn access(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let catalog = self.section.catalog().unwrap_or(Catalog::All);
        let Some(details) = self.details.clone() else {
            return self.loading_row(t);
        };
        let id = self.project.clone().unwrap_or_default();
        let manage = self.can_manage();
        let task = !matches!(self.section, Section::Mcp | Section::Cli);
        let server = account::environment(cx)
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
    pub(super) fn permissions_panel(
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
    pub(super) fn scope_settings(&self, scope: &Scope, t: Theme, cx: &mut Context<Self>) -> Div {
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
    /// `CreateAccessDialog`: a folder, a name and a permission.
    pub(super) fn create_form(
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
}
