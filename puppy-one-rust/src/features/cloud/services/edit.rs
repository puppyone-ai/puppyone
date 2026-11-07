//! The dialog's writes: general settings, visibility, access points and
//! their scopes and permissions, a new access point from a folder.
use super::*;

impl CloudServices {
    /// A mutation, then a reread; its outcome is never replayed.
    pub(super) fn mutate(
        &mut self,
        action: impl FnOnce(&Client) -> services::Result<Option<(String, String)>> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        self.mutate_or("cloud.settings.saveFailed", action, cx);
    }
    /// One change at a time; a failure reports `failed` and changes nothing.
    pub(super) fn mutate_or(
        &mut self,
        failed: &'static str,
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
                    Err(_) => s.notice = Some(tr(failed).into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub(super) fn save_general(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else {
            return;
        };
        let name = self.name.read(cx).text().trim().to_owned();
        let branch = self.branch.read(cx).text().trim().to_owned();
        let description = self.description.read(cx).text().trim().to_owned();
        if name.is_empty() || branch.is_empty() {
            return;
        }
        let update = services::ProjectUpdate {
            name: Some(name),
            description: Some((!description.is_empty()).then_some(description)),
            bound_git_branch: Some(branch),
            ..Default::default()
        };
        self.mutate(
            move |client| client.update_project(&project, update).map(|_| None),
            cx,
        );
    }
    pub(super) fn set_visibility(&mut self, visibility: &'static str, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else {
            return;
        };
        self.mutate(
            move |client| {
                let update = services::ProjectUpdate {
                    visibility: Some(visibility),
                    ..Default::default()
                };
                client.update_project(&project, update).map(|_| None)
            },
            cx,
        );
    }
    /// `handleCreateMcpEndpoint`: its key is shown here, once.
    pub(super) fn create_mcp(&mut self, view: access::View, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone().filter(|_| self.can_manage()) else {
            return;
        };
        let readonly = self
            .details
            .as_ref()
            .and_then(|d| d.scopes.iter().find(|s| s.id == view.id))
            .is_some_and(|s| s.max_mode != "rw");
        self.mutate(
            move |client| {
                let endpoint =
                    client.create_mcp_endpoint(&project, "MCP Server", &view.path, readonly)?;
                Ok(endpoint.api_key.map(|key| (endpoint.id, key)))
            },
            cx,
        );
    }
    /// `canManage`: the capability the server granted on this Project.
    pub(super) fn can_manage(&self) -> bool {
        self.details
            .as_ref()
            .and_then(|d| d.project.as_ref())
            .is_some_and(|p| p.can("access_surface.manage"))
    }
    /// A delete needs a second press within four seconds.
    pub(super) fn arm_delete(&mut self, id: String, cx: &mut Context<Self>) {
        self.confirm_delete = Some(id.clone());
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(DELETE_CONFIRM).await;
            this.update(cx, |s, cx| {
                if s.confirm_delete.as_deref() == Some(id.as_str()) && !s.busy {
                    s.confirm_delete = None;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
        cx.notify();
    }
    pub(super) fn delete_scope(&mut self, scope: String, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone().filter(|_| self.can_manage()) else {
            return;
        };
        self.mutate_or(
            "cloud.message.delete-access-failed",
            move |client| client.delete_scope(&project, &scope).map(|_| None),
            cx,
        );
    }
    /// The settings of one Scope at a time, filled from what the server holds.
    pub(super) fn toggle_scope_settings(&mut self, scope: &Scope, cx: &mut Context<Self>) {
        let open = self
            .scope_edit
            .as_ref()
            .is_some_and(|(id, _)| *id == scope.id);
        self.confirm_delete = None;
        if open {
            self.scope_edit = None;
        } else {
            self.fill_scope_form(scope, cx);
        }
        cx.notify();
    }
    pub(super) fn fill_scope_form(&mut self, scope: &Scope, cx: &mut Context<Self>) {
        let mode = if scope.max_mode == "rw" { "rw" } else { "r" };
        self.scope_edit = Some((scope.id.clone(), mode));
        self.scope_edit_name
            .update(cx, |i, cx| i.set_text(&scope.name, cx));
        self.scope_exclude
            .update(cx, |i, cx| i.set_text(scope.exclude.join("\n"), cx));
    }
    pub(super) fn scope_dirty(&self, scope: &Scope, cx: &App) -> bool {
        let Some((id, mode)) = &self.scope_edit else {
            return false;
        };
        *id == scope.id
            && (self.scope_edit_name.read(cx).text().trim() != scope.name
                || *mode != scope.max_mode
                || permissions::parse_exclude(self.scope_exclude.read(cx).text()) != scope.exclude)
    }
    pub(super) fn save_scope(&mut self, scope: Scope, cx: &mut Context<Self>) {
        let Some((_, mode)) = self.scope_edit.clone().filter(|_| self.can_manage()) else {
            return;
        };
        let typed = self.scope_edit_name.read(cx).text().trim().to_owned();
        let name = if typed.is_empty() {
            scope.name.clone()
        } else {
            typed
        };
        let exclude = permissions::parse_exclude(self.scope_exclude.read(cx).text());
        self.mutate_or(
            "cloud.message.save-scope-failed",
            move |client| {
                client
                    .update_scope(&scope.project_id, &scope.id, &name, mode, &exclude)
                    .map(|_| None)
            },
            cx,
        );
    }
    /// `handleUpdateAccessPointPermissions`: the whole record goes back with
    /// its permissions replaced.
    pub(super) fn set_permissions(
        &mut self,
        point: &access::Point,
        allowed: &permissions::Allowed,
        cx: &mut Context<Self>,
    ) {
        let (Some(project), Some(details), Some(id)) = (
            self.project.clone().filter(|_| self.can_manage()),
            self.details.as_ref(),
            point.surface.clone(),
        ) else {
            return;
        };
        let failed = "cloud.message.update-config-failed";
        match point.kind {
            Kind::Cli => {
                let Some(surface) = details.surfaces.iter().find(|s| s.id == id) else {
                    return;
                };
                let config = permissions::cli_config(&surface.config, allowed);
                self.mutate_or(
                    failed,
                    move |client| {
                        client
                            .update_surface_config(&project, &id, config)
                            .map(|_| None)
                    },
                    cx,
                );
            }
            Kind::Mcp => {
                let Some(endpoint) = details.endpoints.iter().find(|e| e.id == id) else {
                    return;
                };
                let tools = permissions::mcp_config(&endpoint.tools_config, allowed);
                self.mutate_or(
                    failed,
                    move |client| client.update_mcp_tools(&project, &id, tools).map(|_| None),
                    cx,
                );
            }
            Kind::Git => {}
        }
    }
    /// `CreateAccessDialog`: choosing a path reads its folders on demand.
    pub(super) fn begin_create(&mut self, cx: &mut Context<Self>) {
        if !self.can_manage() {
            return;
        }
        self.creating = Some(Create::default());
        self.read_folder(String::new(), cx);
        cx.notify();
    }
    pub(super) fn read_folder(&mut self, path: String, cx: &mut Context<Self>) {
        let (Some(client), Some(project)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        if let Some(create) = &mut self.creating {
            create.browsing = path.clone();
            create.folders.clear();
            create.failed = false;
        }
        self.folder_epoch += 1;
        let epoch = self.folder_epoch;
        let task = cx.background_spawn(async move { client.folder(&project, &path) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.folder_epoch != epoch {
                    return;
                }
                if let Some(create) = &mut s.creating {
                    match result {
                        Ok(tree) => {
                            create.folders = tree
                                .entries
                                .into_iter()
                                .filter(|e| e.kind == "folder")
                                .map(|e| e.path)
                                .collect();
                        }
                        Err(_) => create.failed = true,
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// `defaultScopeName` fills the name until someone types one.
    pub(super) fn choose_path(&mut self, path: String, cx: &mut Context<Self>) {
        let last = path
            .rsplit('/')
            .find(|p| !p.is_empty())
            .unwrap_or("")
            .to_owned();
        if let Some(create) = &mut self.creating {
            create.path = Some(path);
        }
        self.scope_name.update(cx, |i, cx| i.set_text(&last, cx));
        cx.notify();
    }
    /// `createDesktopCloudAccess`: a path with access is never doubled.
    pub(super) fn create_access(&mut self, cx: &mut Context<Self>) {
        let (Some(project), Some(create)) = (self.project.clone(), self.creating.clone()) else {
            return;
        };
        let Some(path) = create.path.clone().filter(|p| !p.is_empty()) else {
            return;
        };
        let name = self.scope_name.read(cx).text().trim().to_owned();
        let taken = self.details.as_ref().is_some_and(|d| {
            d.scopes
                .iter()
                .any(|s| s.path.trim_matches('/') == path.trim_matches('/'))
        });
        if taken {
            self.notice = Some(tr("cloud.access.create.pathAlreadyHasAccess").into());
            cx.notify();
            return;
        }
        if name.is_empty() {
            return;
        }
        let mode = create.mode;
        let mcp = self.section == Section::Mcp;
        self.creating = None;
        self.mutate(
            move |client| {
                let scope = client.create_scope(&project, &name, &path, mode)?;
                if !mcp {
                    return Ok(None);
                }
                let endpoint = client.create_mcp_endpoint(
                    &project,
                    "MCP Server",
                    &scope.path,
                    scope.max_mode != "rw",
                )?;
                Ok(endpoint.api_key.map(|key| (endpoint.id, key)))
            },
            cx,
        );
    }
    pub(super) fn copy(&mut self, value: String, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(value));
        self.notice = Some(tr("cloud.status.copied").into());
        cx.notify();
    }
}
