//! `ProjectWorkbenchStore`: each project's tabs and what fills them, what
//! the shell places, closes and reopens, how much a contribution may hold,
//! and the saved state.
use super::*;

impl Workbench {
    /// The project at `root` is shown (a local folder, or a hosted
    /// Project's Agent location).
    pub fn show(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        self.attach(root, cx);
    }

    /// The shown project.
    pub fn root(&self) -> Option<&PathBuf> {
        self.root.as_ref()
    }

    /// Sorted list of all project roots attached to this workbench.
    pub fn open_roots(&self) -> Vec<PathBuf> {
        let mut roots: Vec<PathBuf> = self.projects.keys().cloned().collect();
        roots.sort();
        roots
    }

    /// Prepares a `(group, launcher_tab)` slot in the shown project's active
    /// group for a new item, cancelling any initial restore if just attached.
    pub fn prepare_launch_slot(&mut self, cx: &mut Context<Self>) -> Option<(Id, Option<Id>)> {
        let p = self.project_mut()?;
        if p.loading {
            p.loading = false;
        }
        let gid = p.layout.active_group;
        let launcher = p.layout.groups.get(&gid).and_then(|g| {
            g.tabs.iter().copied().find(|t| {
                matches!(p.content.get(t), Some(Content::Launcher)) && !p.preparing.has_tab(*t)
            })
        });
        cx.notify();
        Some((gid, launcher))
    }

    /// Whether the shown project is still restoring its saved tabs.
    #[cfg(feature = "dev-capture")]
    pub fn loading(&self) -> bool {
        self.project().is_none_or(|p| p.loading)
    }

    /// The shown project's active group.
    #[cfg(feature = "dev-capture")]
    pub fn active_group(&self) -> Id {
        self.project().map_or(0, |p| p.layout.active_group)
    }

    /// Whether `tab` of `root` still shows a launcher (a creation that
    /// finishes later only replaces the launcher it started from).
    pub fn is_launcher(&self, root: &std::path::Path, tab: Id) -> bool {
        self.root.as_deref() == Some(root)
            && matches!(
                self.project().and_then(|p| p.content.get(&tab)),
                Some(Content::Launcher)
            )
    }

    /// The group showing `tab`.
    pub fn group_of(&self, tab: Id) -> Option<Id> {
        self.project()?
            .layout
            .groups
            .iter()
            .find(|(_, g)| g.tabs.contains(&tab))
            .map(|(group, _)| *group)
    }

    /// A new launcher tab in `group` (`createLauncher`).
    pub fn new_launcher_tab(&mut self, group: Id, cx: &mut Context<Self>) -> Option<Id> {
        let p = self.project_mut()?;
        // Explicit work takes precedence over an older asynchronous restore.
        p.loading = false;
        let id = p.layout.add(group);
        p.content.insert(id, Content::Launcher);
        cx.notify();
        Some(id)
    }

    /// `item` fills the launcher `tab` (or a new tab of `group`), which
    /// becomes active.
    pub fn place(
        &mut self,
        group: Id,
        tab: Option<Id>,
        item: Rc<dyn WorkbenchItem>,
        cx: &mut Context<Self>,
    ) -> Option<Id> {
        if !self.can_create(item.kind()) {
            return None;
        }
        if let Some(tab) = tab {
            let root = self.root.as_ref()?;
            if !self.launcher_available(root, tab) {
                return None;
            }
        }
        let content = self.content(item, cx);
        let p = self.project_mut()?;
        let id = tab.unwrap_or_else(|| p.layout.add(group));
        p.content.insert(id, content);
        // Replacing a launcher keeps its visual key, group and current selection.
        if tab.is_none() {
            p.layout.activate(group, id);
        }
        cx.notify();
        Some(id)
    }

    /// `recordCreationFailure`: `tab` could not be created, for `message`;
    /// `retry`, when the failure may pass, tries again.
    pub fn fail_creation(
        &mut self,
        tab: Id,
        message: String,
        retry: Option<CreationRetry>,
        cx: &mut Context<Self>,
    ) {
        let Some(root) = self.root.clone() else {
            return;
        };
        self.creation_failure = Some(CreationFailure {
            root,
            tab,
            message,
            retry,
        });
        cx.notify();
    }

    /// The reported failure, if it belongs to the shown project.
    pub(super) fn shown_failure(&self) -> Option<&CreationFailure> {
        self.creation_failure
            .as_ref()
            .filter(|f| self.root.as_ref() == Some(&f.root))
    }

    /// A saved tab of `item` in the shown project (tests).
    #[cfg(test)]
    pub fn lab_retained(&mut self, item: RetainedItem, cx: &mut Context<Self>) {
        if let Some(p) = self.project_mut() {
            p.loading = false;
            let id = p.layout.add(0);
            p.content.insert(id, Content::Retained(item));
        }
        cx.notify();
    }

    /// The shown project's tab count (tests).
    #[cfg(test)]
    pub fn tab_count(&self) -> usize {
        self.project().map_or(0, |p| p.content.len())
    }

    /// The tab whose creation failure is reported.
    #[cfg(test)]
    pub fn creation_failure_tab(&self) -> Option<Id> {
        self.shown_failure().map(|f| f.tab)
    }

    /// A new creation in the shown project replaces its reported failure;
    /// another project's stays with it.
    pub fn clear_creation_failure(&mut self, cx: &mut Context<Self>) {
        if self.shown_failure().is_some() {
            self.creation_failure = None;
            cx.notify();
        }
    }

    /// The resources the shown project's `kind` items have open
    /// (`excludedHistoryResourceIds`).
    pub fn open_resources(&self, kind: ItemKind, cx: &App) -> Vec<String> {
        self.project()
            .map(|p| {
                p.content
                    .values()
                    .filter_map(Content::item)
                    .filter(|item| item.kind() == kind)
                    .filter_map(|item| item.snapshot(cx).resource_id)
                    .collect()
            })
            .unwrap_or_default()
    }

    /// View of the active tab in the active group if it has `kind`.
    pub fn active_item_view(&self, kind: ItemKind) -> Option<AnyView> {
        let p = self.project()?;
        let tab = p.layout.groups.get(&p.layout.active_group)?.active?;
        let item = p.content.get(&tab)?.item()?;
        (item.kind() == kind).then(|| item.view())
    }

    /// Activates or reopens an existing `kind` tab in the shown project, or
    /// returns the `(group, launcher_tab)` slot where the host can place a new
    /// item.
    pub fn ensure_item_view(
        &mut self,
        kind: ItemKind,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (Option<AnyView>, Option<(Id, Option<Id>)>) {
        if self.root.is_none() {
            return (None, None);
        }
        if let Some(p) = self.project_mut()
            && p.loading
        {
            p.loading = false;
        }
        if let Some(view) = self.active_item_view(kind) {
            return (Some(view), None);
        }
        let found_live = self.project().and_then(|p| {
            for (&gid, g) in &p.layout.groups {
                for &tid in &g.tabs {
                    if let Some(Content::Item { item, .. }) = p.content.get(&tid)
                        && item.kind() == kind
                    {
                        return Some((gid, tid));
                    }
                }
            }
            None
        });
        if let Some((gid, tid)) = found_live {
            if let Some(p) = self.project_mut() {
                p.layout.activate(gid, tid);
            }
            cx.notify();
            return (
                self.project()
                    .and_then(|p| p.content.get(&tid))
                    .and_then(Content::item)
                    .map(|item| item.view()),
                None,
            );
        }
        let found_retained = self.project().and_then(|p| {
            for (&gid, g) in &p.layout.groups {
                for &tid in &g.tabs {
                    if let Some(Content::Retained(item)) = p.content.get(&tid)
                        && item.kind() == Some(kind)
                    {
                        return Some((gid, tid, item.clone()));
                    }
                }
            }
            None
        });
        if let Some((gid, tid, retained)) = found_retained {
            self.reopen(gid, tid, retained, window, cx);
            if let Some(view) = self
                .project()
                .and_then(|p| p.content.get(&tid))
                .and_then(Content::item)
                .map(|item| item.view())
            {
                return (Some(view), None);
            }
        }
        let slot = self.project().map(|p| {
            let gid = p.layout.active_group;
            let launcher = p.layout.groups.get(&gid).and_then(|g| {
                g.tabs.iter().copied().find(|t| {
                    matches!(p.content.get(t), Some(Content::Launcher)) && !p.preparing.has_tab(*t)
                })
            });
            (gid, launcher)
        });
        (None, slot)
    }

    pub(super) fn attach(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        if !self.projects.contains_key(&root) {
            self.projects.insert(
                root.clone(),
                Project {
                    loading: true,
                    ..Default::default()
                },
            );
            ui_state_store::load(root.clone(), self.store_tx.clone(), self.wake.clone());
        }
        self.root = Some(root);
        self.confirm = None;
        self.bounds.clear();
        self.overflow = None;
        cx.notify();
    }

    pub(super) fn restore_results(&mut self, cx: &mut Context<Self>) {
        while let Ok(event) = self.store_rx.try_recv() {
            match event {
                ResultEvent::Loaded(root, result) => {
                    if let Some(project) = self.projects.get_mut(&root)
                        && project.loading
                    {
                        project.loading = false;
                        match result {
                            Ok(Some(saved)) => match StoredProject::read(saved) {
                                Some(stored) => {
                                    project.layout = stored.layout;
                                    project.content = stored
                                        .items
                                        .into_iter()
                                        .map(|(id, item)| {
                                            (
                                                id,
                                                if matches!(item, RetainedItem::Launcher) {
                                                    Content::Launcher
                                                } else {
                                                    Content::Retained(item)
                                                },
                                            )
                                        })
                                        .collect();
                                }
                                _ => {
                                    project.storage_error = Some(
                                        crate::localization::t("native.workbench.invalidState")
                                            .into(),
                                    )
                                }
                            },
                            Ok(None) => {}
                            Err(e) => project.storage_error = Some(e),
                        }
                    }
                }
                ResultEvent::Saved(root, result) => {
                    if let Some(project) = self.projects.get_mut(&root)
                        && let Err(e) = result
                    {
                        project.storage_error = Some(e);
                    }
                }
            }
            cx.notify();
        }
    }

    pub(super) fn persist(&mut self, cx: &App) {
        for (root, project) in &mut self.projects {
            if project.loading {
                continue;
            }
            let items = project
                .content
                .iter()
                .map(|(id, content)| {
                    (
                        *id,
                        match content {
                            Content::Launcher => RetainedItem::Launcher,
                            Content::Retained(item) => item.clone(),
                            Content::Item { item, .. } => item.retained(cx),
                        },
                    )
                })
                .collect();
            let stored = StoredProject {
                version: 1,
                layout: project.layout.clone(),
                items,
            };
            if let Some(value) = stored.to_saved() {
                let hash = blake3::hash(value.to_string().as_bytes());
                if project.saved != Some(hash)
                    && ui_state_store::save(
                        root.clone(),
                        value,
                        self.store_tx.clone(),
                        self.wake.clone(),
                    )
                {
                    project.saved = Some(hash);
                }
            }
        }
    }

    /// "Reconnect" on a saved tab: the host's contribution reopens it.
    pub(super) fn reopen(
        &mut self,
        group: Id,
        tab: Id,
        item: RetainedItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(root), Some(host)) = (self.root.clone(), self.host.clone()) else {
            return;
        };
        let content = match item {
            RetainedItem::Launcher => Content::Launcher,
            item => match host.reopen(&root, tab, &item, window, cx) {
                Ok(item) => self.content(item, cx),
                Err(error) => {
                    if let Some(p) = self.project_mut() {
                        p.storage_error = Some(error);
                    }
                    cx.notify();
                    return;
                }
            },
        };
        if let Some(p) = self.project_mut() {
            p.content.insert(tab, content);
            p.layout.activate(group, tab);
        }
        cx.notify();
    }

    pub fn has_running(&self, cx: &App) -> bool {
        self.projects
            .values()
            .any(|p| p.content.values().any(|c| c.busy(cx)))
    }

    pub fn shutdown(&mut self, cx: &mut Context<Self>) {
        self.persist(cx);
        self.projects.clear();
        if let Some(host) = self.host.clone() {
            host.shutdown(cx);
        }
        self.root = None;
        cx.notify();
    }

    /// `ProjectWorkbenchStore.canCreate`: a contribution's `maximumItems`.
    pub fn can_create(&self, kind: ItemKind) -> bool {
        self.project().is_some_and(|p| {
            !p.preparing.has_kind(kind)
                && p.content
                    .values()
                    .filter(|c| c.kind() == Some(kind))
                    .count()
                    < kind.maximum_items()
        })
    }

    /// Focus within `group`'s content (`activate-group`): it becomes the
    /// active group, so its shown item is the command target.
    pub(super) fn activate_group(&mut self, group: Id, cx: &mut Context<Self>) {
        if let Some(p) = self.project_mut()
            && p.layout.active_group != group
            && p.layout.groups.contains_key(&group)
        {
            p.layout.active_group = group;
            cx.notify();
        }
    }

    pub(super) fn add(&mut self, group: Id, cx: &mut Context<Self>) {
        if let Some(p) = self.project_mut() {
            let id = p.layout.add(group);
            p.content.insert(id, Content::Launcher);
            p.layout.active_group = group;
        }
        cx.notify();
    }

    /// `close.decide`, then `close.commit`: a busy item asks first, a
    /// blocked one only keeps its tab.
    pub(super) fn close(&mut self, id: Id, force: bool, cx: &mut Context<Self>) {
        // A close already committed waits for its release: asking again
        // commits nothing more.
        if (force && self.close_blocked) || self.closing.contains(&id) {
            return;
        }
        let Some(root) = self.root.clone() else {
            return;
        };
        let item = self
            .project()
            .and_then(|p| p.content.get(&id))
            .and_then(|c| match c {
                Content::Item { item, .. } => Some(item.clone()),
                _ => None,
            });
        let Some(item) = item else {
            self.remove_tab(&root, id, cx);
            return;
        };
        match item.close_decision(cx) {
            CloseDecision::Blocked => {
                self.close_blocked = true;
                self.request_close_confirmation(id, cx);
                return;
            }
            CloseDecision::Confirm if !force => {
                self.request_close_confirmation(id, cx);
                return;
            }
            _ => {}
        }
        let Some(release) = item.commit_close() else {
            self.remove_tab(&root, id, cx);
            return;
        };
        self.confirm = None;
        self.closing.insert(id);
        // The tab closes once its item is released; a refusal presents the
        // latest decision again.
        cx.spawn(async move |this, cx| {
            let released = release.await;
            this.update(cx, |s, cx| {
                s.closing.remove(&id);
                if released {
                    s.remove_tab(&root, id, cx);
                } else if s.root.as_ref() == Some(&root)
                    && s.project()
                        .and_then(|p| p.content.get(&id))
                        .is_some_and(|c| c.busy(cx))
                {
                    s.request_close_confirmation(id, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    /// `removeItem`: the tab leaves `root`'s layout.
    pub(super) fn remove_tab(&mut self, root: &std::path::Path, id: Id, cx: &mut Context<Self>) {
        if let Some(p) = self.projects.get_mut(root) {
            p.layout.remove(id);
            p.content.remove(&id);
            p.preparing.remove(id);
        }
        if let Some(host) = self.host.clone() {
            cx.defer(move |cx| host.tab_removed(id, cx));
        }
        // A failure reported for a closed tab has nothing left to retry.
        if self
            .creation_failure
            .as_ref()
            .is_some_and(|f| f.tab == id && f.root == root)
        {
            self.creation_failure = None;
        }
        if self.confirm == Some(id) {
            self.confirm = None;
        }
        self.close_blocked = false;
        cx.notify();
    }

    pub(super) fn split(
        &mut self,
        group: Id,
        axis: Axis,
        tab: Option<Id>,
        after: bool,
        cx: &mut Context<Self>,
    ) {
        if let Some(p) = self.project_mut() {
            p.layout.split(group, axis, after, tab);
        }
        cx.notify();
    }
}
