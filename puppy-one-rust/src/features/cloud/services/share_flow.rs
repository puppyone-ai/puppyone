//! Share (`openCloudShare`): choosing a target, issuing access once the
//! first publication finished, waiting for the first read, and the readers.
use super::*;

impl CloudServices {
    pub(super) fn share_rows(&self) -> Vec<share::Share> {
        self.details
            .as_ref()
            .map(|d| share::shares(&d.endpoints, d.dashboard.as_ref()))
            .unwrap_or_default()
    }
    pub(super) fn begin_share(&mut self, target: share::Target, cx: &mut Context<Self>) {
        self.publish_requested = false;
        self.share_flow = Some(ShareFlow {
            target,
            path: self.share_path.clone(),
            mode: "r",
            phase: SharePhase::Choose,
        });
        cx.notify();
    }
    /// `ShareWizardDialog`'s issue step: a link needs no request; the same
    /// active share is reused without a new key; otherwise the Scope exists
    /// first, then the endpoint.
    pub(super) fn issue_share(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(project), Some(flow)) = (
            self.client.clone(),
            self.project.clone(),
            self.share_flow.clone(),
        ) else {
            return;
        };
        // `publishPending`: nothing is handed over for a Project whose
        // content has not arrived, whichever way the share reaches it.
        match self.publication {
            Publication::Clear => {}
            Publication::Busy => return self.set_share_phase(SharePhase::Publishing, cx),
            Publication::Pending => {
                self.publish_requested = true;
                self.set_share_phase(SharePhase::Publishing, cx);
                cx.emit(ResumePublication);
                return;
            }
        }
        let target = flow.target;
        if target.channel == share::Channel::Link {
            self.set_share_phase(
                SharePhase::Ready {
                    endpoint: None,
                    key: None,
                    issued_at: None,
                    reused: false,
                },
                cx,
            );
            return;
        }
        let name = target_label(&target);
        let (path, mode) = (flow.path.clone(), flow.mode);
        if let Some(existing) = share::reusable(&self.share_rows(), &name, &path, mode == "r") {
            let (endpoint, issued_at) = (existing.id.clone(), existing.created_at.clone());
            self.set_share_phase(
                SharePhase::Ready {
                    endpoint: Some(endpoint.clone()),
                    key: None,
                    issued_at: issued_at.clone(),
                    reused: true,
                },
                cx,
            );
            self.await_first_read(target, endpoint, issued_at, cx);
            return;
        }
        self.set_share_phase(SharePhase::Issuing, cx);
        self.share_epoch += 1;
        let epoch = self.share_epoch;
        let task = cx.background_spawn(async move {
            if !path.is_empty() && !client.scopes(&project)?.iter().any(|s| s.path == path) {
                let folder = path.rsplit('/').find(|p| !p.is_empty()).unwrap_or(&path);
                client.create_scope(&project, folder, &path, mode)?;
            }
            client.create_mcp_endpoint(&project, &name, &path, mode == "r")
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.share_epoch != epoch {
                    return;
                }
                match result {
                    Ok(endpoint) => {
                        let issued_at =
                            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        s.set_share_phase(
                            SharePhase::Ready {
                                endpoint: Some(endpoint.id.clone()),
                                key: endpoint.api_key,
                                issued_at: Some(issued_at.clone()),
                                reused: false,
                            },
                            cx,
                        );
                        // The read starts first: the list before it has no
                        // such share, and that must not end the wait.
                        s.refresh(cx);
                        s.await_first_read(target, endpoint.id, Some(issued_at), cx);
                    }
                    Err(_) => s.set_share_phase(SharePhase::Failed, cx),
                }
            })
            .ok();
        })
        .detach();
    }
    /// `retry`: a failed run may be asked for again.
    pub(super) fn retry_share(&mut self, cx: &mut Context<Self>) {
        self.publish_requested = false;
        self.publish_failure = None;
        self.issue_share(cx);
    }
    pub(super) fn set_share_phase(&mut self, phase: SharePhase, cx: &mut Context<Self>) {
        if let Some(flow) = &mut self.share_flow {
            flow.phase = phase;
        }
        cx.notify();
    }
    /// Whether the issued share has been used since it was issued.
    pub(super) fn share_connected(&self, flow: &ShareFlow) -> bool {
        let SharePhase::Ready {
            endpoint: Some(endpoint),
            issued_at,
            ..
        } = &flow.phase
        else {
            return false;
        };
        let rows = self.share_rows();
        share::has_receipt(
            rows.iter().find(|s| s.id == *endpoint),
            issued_at.as_deref(),
        )
    }
    /// `closeShareWizard`: the next share starts over from the whole Project.
    pub(super) fn finish_share(&mut self, cx: &mut Context<Self>) {
        self.share_epoch += 1;
        self.share_flow = None;
        self.share_path.clear();
        cx.notify();
    }
    /// `onIssued`: the wait outlives the wizard. A share with no issue time
    /// cannot be awaited.
    pub(super) fn await_first_read(
        &mut self,
        target: share::Target,
        endpoint: String,
        issued_at: Option<String>,
        cx: &mut Context<Self>,
    ) {
        let (Some(project), Some(issued_at)) = (self.project.clone(), issued_at) else {
            return;
        };
        let pending = share::Pending {
            target,
            endpoint,
            issued_at,
        };
        self.pending_share = Some((project, pending));
        self.settle_pending(cx);
        self.watch_pending(cx);
    }
    /// The effect in `useProjectShareActivity`, with one difference: only a
    /// list that was actually read can end a wait. Time ends it regardless.
    pub(super) fn settle_pending(&mut self, cx: &mut Context<Self>) {
        let Some((_, pending)) = &self.pending_share else {
            return;
        };
        let read = !self.loading && self.details.as_ref().is_some_and(|d| !d.endpoints_failed);
        if pending.expired(chrono::Utc::now()) || (read && !pending.live(&self.share_rows())) {
            self.pending_share = None;
            self.pending_epoch += 1;
            cx.notify();
        }
    }
    /// `pollIntervalMs`: reread while a share is awaited and this dialog is
    /// open; opening it again picks the wait back up.
    pub(super) fn watch_pending(&mut self, cx: &mut Context<Self>) {
        self.pending_epoch += 1;
        if self.pending_share.is_none() {
            return;
        }
        let epoch = self.pending_epoch;
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(RECEIPT_POLL).await;
                let waiting = this
                    .update(cx, |s, cx| {
                        if s.pending_epoch != epoch {
                            return false;
                        }
                        s.settle_pending(cx);
                        // Ending a wait moves the epoch.
                        let waiting = s.pending_epoch == epoch;
                        if waiting {
                            s.reload_shares(cx);
                        }
                        waiting
                    })
                    .unwrap_or(false);
                if !waiting {
                    break;
                }
            }
        })
        .detach();
    }
    /// `useProjectShares.reload`: only what a share's state needs, so a wait
    /// never touches the page being edited or an action in flight.
    pub(super) fn reload_shares(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(project)) = (self.client.clone(), self.project.clone()) else {
            return;
        };
        self.shares_epoch += 1;
        let epoch = self.shares_epoch;
        let task = cx.background_spawn(async move {
            (client.mcp_endpoints(&project), client.dashboard(&project))
        });
        cx.spawn(async move |this, cx| {
            let (endpoints, dashboard) = task.await;
            this.update(cx, |s, cx| {
                if s.shares_epoch != epoch {
                    return;
                }
                if let Some(details) = &mut s.details {
                    details.endpoints_failed = endpoints.is_err();
                    if let Ok(endpoints) = endpoints {
                        details.endpoints = endpoints;
                    }
                    if let Ok(dashboard) = dashboard {
                        details.dashboard = Some(dashboard);
                    }
                }
                s.settle_pending(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub(super) fn stop_share(&mut self, id: String, cx: &mut Context<Self>) {
        self.stop_failed = false;
        let Some(client) = self.client.clone() else {
            return;
        };
        if self.busy {
            return;
        }
        self.busy = true;
        let epoch = self.epoch;
        let task = cx.background_spawn(async move { client.delete_mcp_endpoint(&id) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                s.busy = false;
                match result {
                    Ok(()) => {
                        s.confirm_delete = None;
                        s.refresh(cx);
                    }
                    Err(_) => s.stop_failed = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}
