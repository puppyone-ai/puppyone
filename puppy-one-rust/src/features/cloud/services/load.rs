//! Opening the dialog on a Project and section, and the reads behind each
//! section: details, history pages, the organization's team, a commit.
use super::*;

impl CloudServices {
    /// Opens on `section` of `project` for the signed-in account.
    pub fn open(&mut self, project: String, section: Section, cx: &mut Context<Self>) {
        let Some((broker, binding)) = account::broker_and_binding(cx) else {
            return;
        };
        let client = Client::new(Arc::new(services::BrokerTransport {
            broker,
            binding,
            cancel: Default::default(),
        }));
        self.open_with(client, project, section, cx);
    }
    pub fn open_with(
        &mut self,
        client: Client,
        project: String,
        section: Section,
        cx: &mut Context<Self>,
    ) {
        self.reset();
        if self
            .pending_share
            .as_ref()
            .is_some_and(|(owner, _)| *owner != project)
        {
            self.pending_share = None;
        }
        self.client = Some(client);
        self.project = Some(project);
        self.section = section;
        self.refresh(cx);
        self.enter(section, cx);
        self.watch_pending(cx);
        cx.notify();
    }
    /// `openShareWizard(null, path)`: the next share starts from `path`, past
    /// the readers an empty path would show first.
    pub fn start_from(&mut self, path: String, cx: &mut Context<Self>) {
        self.share_path = path;
        self.share_readers = false;
        cx.notify();
    }
    pub fn project(&self) -> Option<&str> {
        self.project.as_deref()
    }
    /// The orchestration in `ShareConnectStep`: a share waiting on the first
    /// publication goes on when it clears, and stops if the run it asked for
    /// stops. One it did not ask for only hands over to a request of its own.
    pub fn sync_publication(
        &mut self,
        publication: Publication,
        failure: Option<String>,
        cx: &mut Context<Self>,
    ) {
        self.publish_failure = failure;
        if self.publication == publication {
            return;
        }
        self.publication = publication;
        if !self.publishing() {
            return;
        }
        match publication {
            Publication::Busy => {}
            Publication::Pending if self.publish_requested => {
                self.set_share_phase(SharePhase::Failed, cx)
            }
            Publication::Clear | Publication::Pending => self.issue_share(cx),
        }
    }
    /// The run could not even start, so nothing will report back.
    pub fn publication_refused(&mut self, cx: &mut Context<Self>) {
        if self.publishing() {
            self.set_share_phase(SharePhase::Failed, cx);
        }
    }
    pub(super) fn publishing(&self) -> bool {
        matches!(
            self.share_flow.as_ref().map(|flow| &flow.phase),
            Some(SharePhase::Publishing)
        )
    }
    /// A share of the Project by the Shell's tests, past its scope step.
    #[cfg(test)]
    pub fn share_now(&mut self, cx: &mut Context<Self>) {
        self.begin_share(share::TARGETS[2], cx);
        self.issue_share(cx);
    }
    #[cfg(test)]
    pub fn share_ready(&self) -> bool {
        matches!(
            self.share_flow.as_ref().map(|flow| &flow.phase),
            Some(SharePhase::Ready { .. })
        )
    }
    #[cfg(test)]
    pub fn share_start(&self) -> &str {
        &self.share_path
    }
    /// `enabled` of `useProjectShareActivity`, and the effect that leaves the
    /// Share section when onboarding ends. An account ending ends a wait too.
    pub fn sync_sharing(&mut self, enabled: bool, cx: &mut Context<Self>) {
        if enabled {
            return;
        }
        self.pending_share = None;
        self.pending_epoch += 1;
        if self.project.is_some() && self.section == Section::Share {
            self.select(Section::Contents, cx);
        }
    }
    pub(super) fn reset(&mut self) {
        self.epoch += 1;
        self.team_epoch += 1;
        self.detail_epoch += 1;
        self.details = None;
        self.team = Team::default();
        self.commit = None;
        self.detail = None;
        self.issued = None;
        self.confirm_delete = None;
        self.creating = None;
        self.folder_epoch += 1;
        self.share_flow = None;
        self.share_path.clear();
        self.share_readers = false;
        self.expanded = None;
        self.scope_edit = None;
        self.share_epoch += 1;
        self.shares_epoch += 1;
        self.pending_epoch += 1;
        self.publish_requested = false;
        self.history_epoch += 1;
        self.history_loading_more = false;
        self.history_more_failed = false;
        self.history_restart = false;
        self.stop_failed = false;
        self.billing.reset();
        self.notice = None;
        self.busy = false;
    }
    /// Closing forgets everything, a one-time credential first of all.
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.reset();
        self.client = None;
        self.project = None;
        cx.emit(Close);
        cx.notify();
    }
    pub fn select(&mut self, section: Section, cx: &mut Context<Self>) {
        self.section = section;
        self.confirm_delete = None;
        self.creating = None;
        self.share_flow = None;
        self.share_path.clear();
        self.share_readers = false;
        self.expanded = None;
        self.scope_edit = None;
        self.share_epoch += 1;
        self.notice = None;
        self.scroll.set_offset(point(px(0.), px(0.)));
        self.enter(section, cx);
        cx.notify();
    }
    pub(super) fn enter(&mut self, section: Section, cx: &mut Context<Self>) {
        if matches!(section, Section::Team | Section::Billing)
            && self.team.organizations.is_empty()
            && !self.team.loading
        {
            self.load_team(cx);
        }
        if section == Section::Billing
            && self.team.selected.is_some()
            && self.billing.membership == billing::Membership::Unknown
        {
            self.load_billing(cx);
        }
        if section == Section::Settings {
            self.fill_settings(cx);
        }
    }
    /// `loadCloudProjectDetails`: dropped if a newer load or project began.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(id)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        self.epoch += 1;
        let epoch = self.epoch;
        self.loading = true;
        let task = cx.background_spawn(async move { Details::load(&client, &id) });
        cx.spawn(async move |this, cx| {
            let details = task.await;
            this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                let mut details = details;
                // `useProjectShares`: a failed read keeps what was known, so
                // one bad answer neither empties the list nor ends a wait.
                if let Some(known) = s.details.take() {
                    if details.endpoints_failed {
                        details.endpoints = known.endpoints;
                    }
                    details.dashboard = details.dashboard.or(known.dashboard);
                    // Loaded pages stand until the history itself moves on.
                    if !s.history_restart
                        && let (Some(fresh), Some(loaded)) = (&details.history, &known.history)
                        && fresh.snapshot == loaded.snapshot
                    {
                        details.history = known.history;
                    }
                }
                s.history_restart = false;
                s.details = Some(details);
                s.loading = false;
                s.settle_pending(cx);
                if s.section == Section::Settings {
                    s.fill_settings(cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// `loadMore` of `useCloudHistoryData`: a page merges only into the
    /// snapshot it continues. A snapshot that moved starts over from the
    /// first page; any other failure says so and leaves the list as it was.
    pub(super) fn load_more_history(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(project)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        let Some(current) = self.details.as_ref().and_then(|d| d.history.clone()) else {
            return;
        };
        let Some(cursor) = current.next_cursor.clone().filter(|_| current.more()) else {
            return;
        };
        if self.loading || self.history_loading_more {
            return;
        }
        self.history_epoch += 1;
        let epoch = self.history_epoch;
        self.history_loading_more = true;
        self.history_more_failed = false;
        cx.notify();
        let task =
            cx.background_spawn(async move { read_history_page(&client, &project, &cursor) });
        cx.spawn(async move |this, cx| {
            let page = task.await;
            this.update(cx, |s, cx| {
                if s.history_epoch != epoch {
                    return;
                }
                s.history_loading_more = false;
                match page {
                    Ok(page) => match history::merge(&current, page) {
                        Ok(merged) => {
                            if let Some(details) = &mut s.details
                                && details
                                    .history
                                    .as_ref()
                                    .is_some_and(|h| h.snapshot == current.snapshot)
                            {
                                details.history = Some(merged);
                            }
                        }
                        Err(history::SnapshotChanged) => s.restart_history(cx),
                    },
                    // `isHistorySnapshotRestartError`.
                    Err(services::Error::Status(409)) => s.restart_history(cx),
                    Err(_) => s.history_more_failed = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub(super) fn restart_history(&mut self, cx: &mut Context<Self>) {
        self.history_restart = true;
        self.refresh(cx);
    }
    pub(super) fn fill_settings(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.details.as_ref().and_then(|d| d.project.clone()) else {
            return;
        };
        self.name.update(cx, |i, cx| i.set_text(&project.name, cx));
        self.description.update(cx, |i, cx| {
            i.set_text(project.description.as_deref().unwrap_or(""), cx)
        });
        self.branch.update(cx, |i, cx| {
            i.set_text(project.bound_git_branch.as_deref().unwrap_or("main"), cx)
        });
    }
    pub(super) fn load_team(&mut self, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            return;
        };
        self.team_epoch += 1;
        let epoch = self.team_epoch;
        self.team.loading = true;
        let task = cx.background_spawn(async move { client.organizations() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.team_epoch != epoch {
                    return;
                }
                s.team.loading = false;
                match result {
                    Ok(organizations) => {
                        // One organization is the choice; several need an
                        // explicit one, never the first.
                        let only = (organizations.len() == 1).then(|| organizations[0].id.clone());
                        s.team.organizations = organizations;
                        if let Some(id) = only {
                            s.select_organization(id, cx);
                        }
                    }
                    Err(_) => s.team.failed = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub fn select_organization(&mut self, id: String, cx: &mut Context<Self>) {
        let Some(client) = self.client.clone() else {
            return;
        };
        self.team_epoch += 1;
        let epoch = self.team_epoch;
        self.team.selected = Some(id.clone());
        // Another Organization is another billing context.
        self.billing.reset();
        if self.section == Section::Billing {
            self.load_billing(cx);
        }
        self.team.members.clear();
        self.team.entitlements = None;
        self.team.seats = None;
        self.team.failed = false;
        self.team.loading = true;
        let task = cx.background_spawn(async move {
            (
                client.members(&id),
                client.entitlements(&id),
                client.seat_usage(&id),
            )
        });
        cx.spawn(async move |this, cx| {
            let (members, entitlements, seats) = task.await;
            this.update(cx, |s, cx| {
                if s.team_epoch != epoch {
                    return;
                }
                s.team.loading = false;
                s.team.failed = members.is_err();
                s.team.members = members.unwrap_or_default();
                s.team.entitlements = entitlements.ok();
                s.team.seats = seats.ok();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub(super) fn open_commit(&mut self, id: String, cx: &mut Context<Self>) {
        let (Some(client), Some(project)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        self.commit = Some(id.clone());
        self.detail = None;
        self.detail_epoch += 1;
        let epoch = self.detail_epoch;
        let task = cx.background_spawn(async move {
            let request = history::detail_request(&project, &id)
                .ok_or(services::Error::Invalid("history"))?;
            history::parse_detail(&client.raw(request)?, &id)
                .map_err(|_| services::Error::Invalid("history"))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.detail_epoch == epoch {
                    s.detail = result.ok();
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }
}
