//! Settings › Plan (`SeatsSettingsView`, `CloudPlans`, `useAccountPlan`,
//! `useCloudBillingController`): what the Settings space is on, what it has
//! used, and what else it could be on. The readings are Settings' own
//! (`features::cloud::billing`); the controller quotes, confirms and watches
//! changes. Desktop never computes a charge: every change is quoted by the
//! server, confirmed by the person, and finished in the browser, and the
//! plan changes when the server says so, never when the browser comes back.
mod format;
mod view;

use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use crate::features::cloud::{
    PlanSnapshot, billing_namespace, cached_billing, fetch_billing, settle_billing,
};
use crate::workspace::cloud::{
    billing::{self, Keys, Operation, Plan, Quote},
    pricing::{self, PlanId},
    services::Error,
};
use gpui::{prelude::*, *};

/// `useCloudBillingController`'s state for one space: operations seen,
/// the quote on the page and the action under way.
#[derive(Default)]
struct Controller {
    operations: Vec<Operation>,
    quote: Option<Quote>,
    /// The member change a seat quote settles.
    quoted_operation: Option<String>,
    /// The people the Team stepper reads; a quote always asks for this.
    seats: u64,
    /// What `seats` was last seeded from (`onTeam`, seats held, minimum).
    seeded_for: Option<(bool, u64, u64)>,
    acting: bool,
    error: Option<&'static str>,
    /// Hosted subscriptions answered as switched off: nothing sells.
    disabled: bool,
    polling: Option<String>,
    keys: Keys,
    add_on: AddOnChange,
}
/// `AddOns`' draft: one pack's new quantity, before it is confirmed.
#[derive(Default)]
struct AddOnChange {
    draft: Option<(String, u64)>,
    pending: bool,
    /// A note, or an error when `true`.
    message: Option<(&'static str, bool)>,
    /// The intent and its key, kept across a retry of the same intent.
    key: Option<(String, String)>,
}

#[derive(Default)]
pub(in crate::features::settings) struct PlanPage {
    /// The session namespace and the space the readings belong to.
    context: Option<(String, String)>,
    snapshot: PlanSnapshot,
    epoch: u64,
    controller: Controller,
    /// `.desktop-plan-storage-details[open]`.
    storage_open: bool,
    /// Captures: `#cloud-plans-visual-smoke`'s space, signed in, with its
    /// fixed readings; nothing is read.
    #[cfg(feature = "dev-capture")]
    lab: Option<crate::workspace::cloud::spaces::Space>,
}

impl SettingsWorkspaceSurface {
    /// The billing client and the space Plan reads: payments on, signed in,
    /// a space chosen.
    fn plan_scope(&self, cx: &App) -> Option<(billing::Client, String, String)> {
        if !self.preferences.read(cx).state.experimental.payments {
            return None;
        }
        let (_, binding) = crate::features::cloud::account::broker_and_binding(cx)?;
        let org = self.settings_space(cx)?.id;
        Some((
            crate::features::cloud::billing_client(cx)?,
            billing_namespace(&binding),
            org,
        ))
    }
    /// Whether someone is signed in, and the space Plan is on.
    pub(super) fn plan_reader(
        &self,
        cx: &App,
    ) -> (bool, Option<crate::workspace::cloud::spaces::Space>) {
        #[cfg(feature = "dev-capture")]
        if let Some(space) = &self.plan_page.lab {
            return (true, Some(space.clone()));
        }
        (
            crate::features::cloud::account::broker_and_binding(cx).is_some(),
            self.settings_space(cx),
        )
    }
    /// Captures: `#cloud-plans-visual-smoke?state=<state>` (`free`, `team`,
    /// `enterprise`, `scheduled`), its readings as the harness fixes them.
    #[cfg(feature = "dev-capture")]
    pub fn install_plan_lab(&mut self, state: &str, cx: &mut Context<Self>) {
        use serde_json::json;
        const GB: u64 = 1_000_000_000;
        let usage = |used: u64, granted: u64, bytes: u64, limit: u64| {
            json!({
                "runtime": {"org_id": "o1", "available_units": granted - used, "reserved_units": 0,
                    "granted_units": granted, "consumed_units": used,
                    "allowance": {"granted_units": granted, "consumed_units": used, "reserved_units": 0,
                        "resets_at": "2026-12-01T00:00:00Z", "unit_seconds": 60}},
                "storage": {"logical_bytes": bytes, "limit_bytes": limit, "percent": null,
                    "threshold_percent": 0},
            })
        };
        let (summary, usage) = match state {
            "team" => (
                json!({"org_id": "o1", "plan_id": "team_v2", "status": "active", "seat_quantity": 1,
                    "current_period_end": "2026-12-08T00:00:00Z", "cancel_at_period_end": false,
                    "add_ons": [{"add_on_id": "agent_hours_100", "quantity": 1, "status": "active",
                        "cancel_at_period_end": false, "current_period_end": null}]}),
                usage(122 * 60, 140 * 60, 32 * GB / 10, 10 * GB),
            ),
            "enterprise" => (
                json!({"org_id": "o1", "plan_id": "enterprise_v2", "status": "active", "seat_quantity": 5,
                    "current_period_end": "2026-12-08T00:00:00Z", "cancel_at_period_end": false,
                    "add_ons": []}),
                usage(61 * 60, 200 * 60, 41 * GB, 100 * GB),
            ),
            "scheduled" => (
                json!({"org_id": "o1", "plan_id": "enterprise_v2", "status": "active", "seat_quantity": 3,
                    "current_period_end": "2026-12-08T12:00:00Z", "pending_plan_id": "team_v2",
                    "pending_seat_quantity": 1, "pending_effective_at": "2026-12-08T12:00:00Z",
                    "cancel_at_period_end": false, "add_ons": []}),
                usage(30 * 60, 120 * 60, 12 * GB, 60 * GB),
            ),
            _ => (
                json!({"org_id": "o1", "plan_id": "free", "status": "free", "seat_quantity": 1}),
                usage(3 * 60, 5 * 60, 4 * GB / 10, GB),
            ),
        };
        self.plan_page = PlanPage {
            context: Some(("lab".into(), "o1".into())),
            snapshot: PlanSnapshot {
                summary: serde_json::from_value(summary).ok(),
                usage: serde_json::from_value(usage).ok(),
                organization: Some("o1".into()),
                can_manage_billing: Some(true),
                ..Default::default()
            },
            lab: Some(crate::workspace::cloud::spaces::Space {
                id: "o1".into(),
                name: "Acme Research".into(),
                role: Some("owner".into()),
                can_manage_space: true,
                can_create_projects: true,
                ..Default::default()
            }),
            ..Default::default()
        };
        self.seed_seats();
        self.page = super::Page::Plan;
        cx.notify();
    }
    /// `useAccountPlan`: the space's readings, cached ones painted at once;
    /// `force` asks the server for all of them. A new space or session
    /// starts the controller over.
    pub(in crate::features::settings) fn load_plan(&mut self, force: bool, cx: &mut Context<Self>) {
        #[cfg(feature = "dev-capture")]
        if self.plan_page.lab.is_some() {
            return;
        }
        let Some((client, namespace, org)) = self.plan_scope(cx) else {
            let epoch = self.plan_page.epoch + 1;
            self.plan_page = PlanPage {
                epoch,
                ..Default::default()
            };
            return;
        };
        let context = (namespace.clone(), org.clone());
        let cached = cached_billing(&namespace, &org, cx);
        let changed = self.plan_page.context.as_ref() != Some(&context);
        self.plan_page.epoch += 1;
        if changed {
            self.plan_page.context = Some(context);
            self.plan_page.controller = Controller::default();
            self.plan_page.snapshot = cached.snapshot(&org);
        } else if self.plan_page.snapshot.summary.is_some() {
            self.plan_page.snapshot.loading = true;
            self.plan_page.snapshot.error = false;
        } else {
            self.plan_page.snapshot = cached.snapshot(&org);
        }
        let epoch = self.plan_page.epoch;
        let task = {
            let (client, org, cached) = (client.clone(), org.clone(), cached.clone());
            cx.background_spawn(async move { fetch_billing(&client, &org, &cached, force) })
        };
        cx.spawn(async move |this, cx| {
            let loaded = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch != epoch {
                    return;
                }
                s.plan_page.snapshot = settle_billing(&namespace, &org, cached, loaded, cx);
                s.seed_seats();
                cx.notify();
            })
            .ok();
        })
        .detach();
        if changed {
            self.load_operations(cx);
        }
        cx.notify();
    }
    /// Starts the Team stepper from what is held, and again whenever that
    /// changes, but never over a number the person is still choosing.
    fn seed_seats(&mut self) {
        let snapshot = &self.plan_page.snapshot;
        let view = pricing::resolve_catalog(snapshot.catalog.as_ref());
        let holding =
            pricing::resolve_holding(snapshot.summary.as_ref(), snapshot.catalog.as_ref());
        let minimum = view.plan(PlanId::Team).map_or(1, |p| p.minimum_seats);
        let held = (holding.subscribed, holding.seats, minimum);
        let controller = &mut self.plan_page.controller;
        if controller.seeded_for != Some(held) {
            controller.seeded_for = Some(held);
            controller.seats = if holding.subscribed {
                holding.seats
            } else {
                minimum
            };
        }
    }
    pub(in crate::features::settings) fn plan_org(&self) -> Option<String> {
        self.plan_page.context.as_ref().map(|c| c.1.clone())
    }
    /// The operations under way for this space; one still in flight is
    /// watched, never repeated.
    fn load_operations(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) =
            (crate::features::cloud::billing_client(cx), self.plan_org())
        else {
            return;
        };
        let epoch = self.plan_page.epoch;
        let task = cx.background_spawn(async move { client.operations(&org) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch < epoch || s.plan_org().is_none() {
                    return;
                }
                if let Ok(incoming) = result {
                    let controller = &mut s.plan_page.controller;
                    controller.operations = billing::keep_ended(&controller.operations, incoming);
                    let resume = billing::resumable(&controller.operations).map(|o| o.id.clone());
                    if let (Some(id), None) = (resume, controller.polling.as_ref()) {
                        s.watch_operation(id, cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// `refreshAll`: what the server says now, after a change or a retry.
    fn refresh_plan(&mut self, cx: &mut Context<Self>) {
        self.plan_page.controller.error = None;
        self.load_plan(true, cx);
        self.load_operations(cx);
    }
    fn plan_failed(&mut self, error: Error, otherwise: &'static str) {
        let controller = &mut self.plan_page.controller;
        match error {
            Error::BillingDisabled => controller.disabled = true,
            Error::Invalid(billing::FOREIGN | billing::MISMATCH) => {
                controller.error = Some(billing::MISMATCH)
            }
            _ => controller.error = Some(otherwise),
        }
    }
    /// `quotePlan`: asks the server for a quote; Desktop never computes a
    /// price.
    fn quote_plan(&mut self, plan: Plan, seats: u64, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) =
            (crate::features::cloud::billing_client(cx), self.plan_org())
        else {
            return;
        };
        let controller = &mut self.plan_page.controller;
        if controller.acting || controller.polling.is_some() || !plan.purchasable {
            return;
        }
        let seats = billing::clamp_seats(seats, &plan);
        let intent = format!("plan-quote:{org}:{}:{seats}", plan.id);
        let key = controller.keys.key(&intent, "plan-quote");
        controller.acting = true;
        controller.error = None;
        controller.quote = None;
        controller.quoted_operation = None;
        let epoch = self.plan_page.epoch;
        let task =
            cx.background_spawn(async move { client.quote_plan(&org, &plan.id, seats, key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch < epoch {
                    return;
                }
                s.plan_page.controller.acting = false;
                match result {
                    Ok(quote) => {
                        s.plan_page.controller.keys.forget(&intent);
                        s.plan_page.controller.quote = Some(quote);
                    }
                    Err(error) => s.plan_failed(error, "cloud.billing.quoteFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// `quoteSeats`: the people on the page for the plan held; a member
    /// change the server holds for that count is settled by it.
    fn quote_seats(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) =
            (crate::features::cloud::billing_client(cx), self.plan_org())
        else {
            return;
        };
        let available = self
            .plan_page
            .snapshot
            .summary
            .as_ref()
            .is_some_and(|s| s.seat_changes_available);
        let controller = &mut self.plan_page.controller;
        if controller.acting || controller.polling.is_some() || !available {
            return;
        }
        let seats = controller.seats.max(1);
        let linked = billing::seat_operation(&controller.operations, seats).map(|o| o.id.clone());
        let intent = format!(
            "seat-quote:{org}:{seats}:{}",
            linked.as_deref().unwrap_or("manual")
        );
        let key = controller.keys.key(&intent, "seat-quote");
        controller.acting = true;
        controller.error = None;
        controller.quote = None;
        controller.quoted_operation = linked.clone();
        let epoch = self.plan_page.epoch;
        let task =
            cx.background_spawn(
                async move { client.quote_seats(&org, seats, linked.as_deref(), key) },
            );
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch < epoch {
                    return;
                }
                s.plan_page.controller.acting = false;
                match result {
                    Ok(quote) => {
                        s.plan_page.controller.keys.forget(&intent);
                        s.plan_page.controller.quote = Some(quote);
                    }
                    Err(error) => s.plan_failed(error, "cloud.billing.quoteFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// `confirmQuote`: the mutation by the quote's mode. A checkout's URL
    /// opens only after the answer matched what was quoted.
    fn confirm_quote(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) =
            (crate::features::cloud::billing_client(cx), self.plan_org())
        else {
            return;
        };
        let controller = &mut self.plan_page.controller;
        let Some(quote) = controller.quote.clone().filter(|_| !controller.acting) else {
            return;
        };
        if !billing::quote_live(&quote, chrono::Utc::now()) {
            controller.quote = None;
            controller.error = Some(billing::EXPIRED);
            cx.notify();
            return;
        }
        let intent = format!(
            "quote-apply:{org}:{}:{}",
            quote.application_mode, quote.quote_id
        );
        let key = controller
            .keys
            .key(&intent, &quote.application_mode.clone());
        let expected = controller.quoted_operation.clone();
        controller.acting = true;
        controller.error = None;
        let epoch = self.plan_page.epoch;
        let task = cx.background_spawn(async move {
            let (url, returned, operation) = if quote.application_mode == "checkout" {
                let (url, returned, operation) =
                    client.checkout(&org, &quote, expected.as_deref(), key)?;
                (Some(url), returned, operation)
            } else {
                let (returned, operation) = client.apply(&org, &quote, expected.as_deref(), key)?;
                (None, returned, operation)
            };
            if !billing::same_quote(&returned, &quote, &org)
                || !billing::operation_matches(&operation, &quote, &org, expected.as_deref())
            {
                return Err(Error::Invalid(billing::MISMATCH));
            }
            Ok((url, operation))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch < epoch {
                    return;
                }
                s.plan_page.controller.acting = false;
                match result {
                    Ok((url, operation)) => {
                        let controller = &mut s.plan_page.controller;
                        controller.keys.forget(&intent);
                        controller.quote = None;
                        if let Some(url) = url {
                            cx.open_url(&url);
                        }
                        controller.operations.retain(|o| o.id != operation.id);
                        let (id, ended) = (operation.id.clone(), operation.terminal);
                        controller.operations.push(operation);
                        // What ended is reread, not watched.
                        if ended {
                            s.refresh_plan(cx);
                        } else {
                            s.watch_operation(id, cx);
                        }
                    }
                    // The same intent keeps its key for a retry.
                    Err(error) => s.plan_failed(error, "cloud.billing.changeFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// Polls with backoff until the server says the change ended; only
    /// then is the space reread. Access lost ends the watch.
    fn watch_operation(&mut self, id: String, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) =
            (crate::features::cloud::billing_client(cx), self.plan_org())
        else {
            return;
        };
        self.plan_page.controller.polling = Some(id.clone());
        let epoch = self.plan_page.epoch;
        cx.spawn(async move |this, cx| {
            let mut attempt = 0;
            loop {
                cx.background_executor()
                    .timer(billing::poll_delay(attempt))
                    .await;
                let (client, org, asked) = (client.clone(), org.clone(), id.clone());
                let result = cx
                    .background_spawn(async move { client.operation(&org, &asked) })
                    .await;
                let stop = this
                    .update(cx, |s, cx| {
                        if s.plan_page.epoch < epoch
                            || s.plan_page.controller.polling.as_deref() != Some(id.as_str())
                        {
                            return true;
                        }
                        let stop = match result {
                            Ok(operation) => {
                                let terminal = operation.terminal;
                                let failed = terminal && operation.state != "succeeded";
                                let controller = &mut s.plan_page.controller;
                                controller.operations.retain(|o| o.id != operation.id);
                                controller.operations.push(operation);
                                if terminal {
                                    controller.polling = None;
                                    s.refresh_plan(cx);
                                    // What failed stays said through the reread.
                                    if failed {
                                        s.plan_page.controller.error =
                                            Some("cloud.billing.changeFailed");
                                    }
                                }
                                terminal
                            }
                            Err(Error::Invalid(billing::FOREIGN)) => {
                                s.plan_page.controller.polling = None;
                                s.plan_page.controller.error = Some(billing::MISMATCH);
                                true
                            }
                            Err(Error::Status(401 | 403 | 404)) => {
                                s.plan_page.controller.polling = None;
                                s.plan_page.controller.error = Some("cloud.billing.loadFailed");
                                true
                            }
                            Err(_) => false,
                        };
                        cx.notify();
                        stop
                    })
                    .unwrap_or(true);
                if stop {
                    break;
                }
                attempt += 1;
            }
        })
        .detach();
    }
    /// `openPortal`: invoices, and leaving a paid plan, live with the
    /// payment provider.
    fn open_portal(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) =
            (crate::features::cloud::billing_client(cx), self.plan_org())
        else {
            return;
        };
        let controller = &mut self.plan_page.controller;
        if controller.acting {
            return;
        }
        let intent = format!("portal:{org}");
        let key = controller.keys.key(&intent, "portal");
        controller.acting = true;
        controller.error = None;
        let epoch = self.plan_page.epoch;
        let task = cx.background_spawn(async move { client.portal(&org, key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch < epoch {
                    return;
                }
                s.plan_page.controller.acting = false;
                match result {
                    Ok(url) => {
                        s.plan_page.controller.keys.forget(&intent);
                        cx.open_url(&url);
                    }
                    Err(error) => s.plan_failed(error, "cloud.billing.portalFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn set_plan_seats(&mut self, seats: u64, cx: &mut Context<Self>) {
        let controller = &mut self.plan_page.controller;
        controller.seats = seats;
        controller.quote = None;
        cx.notify();
    }
    /// A pack's stepper moved: a draft unless it is back at what is held.
    fn draft_add_on(&mut self, id: String, quantity: u64, held: u64, cx: &mut Context<Self>) {
        let add_on = &mut self.plan_page.controller.add_on;
        add_on.draft = (quantity != held).then_some((id, quantity));
        add_on.message = None;
        cx.notify();
    }
    /// `AddOns.confirm`: one key per intent, kept for a retry of it.
    fn confirm_add_on(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) =
            (crate::features::cloud::billing_client(cx), self.plan_org())
        else {
            return;
        };
        let add_on = &mut self.plan_page.controller.add_on;
        let Some((id, quantity)) = add_on.draft.clone().filter(|_| !add_on.pending) else {
            return;
        };
        let intent = format!("{org}:{id}:{quantity}");
        if add_on.key.as_ref().map(|k| &k.0) != Some(&intent) {
            let key = Keys::default().key(&intent, &format!("add-on:{id}"));
            add_on.key = Some((intent.clone(), key));
        }
        let key = add_on.key.clone().map(|k| k.1).unwrap_or_default();
        add_on.pending = true;
        add_on.message = None;
        let epoch = self.plan_page.epoch;
        let task =
            cx.background_spawn(async move { client.change_add_on(&org, &id, quantity, key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch < epoch {
                    return;
                }
                let add_on = &mut s.plan_page.controller.add_on;
                add_on.pending = false;
                match result {
                    Ok(change) => {
                        add_on.key = None;
                        add_on.draft = None;
                        if change.outcome == "checkout"
                            && let Some(url) =
                                change.checkout_url.as_deref().and_then(billing::safe_url)
                        {
                            cx.open_url(&url);
                            add_on.message = Some(("settings.plan.addOnCheckoutOpened", false));
                        } else if change.outcome == "pending_provider_confirmation" {
                            add_on.message = Some(("settings.plan.addOnPending", false));
                        }
                        s.refresh_plan(cx);
                    }
                    Err(Error::BillingDisabled) => {
                        add_on.message = Some(("settings.plan.addOnFailed", true));
                        s.plan_page.controller.disabled = true;
                    }
                    Err(_) => add_on.message = Some(("settings.plan.addOnFailed", true)),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Account's compact reading of the Settings space's plan
    /// (`AccountSettingsView`): an actual holding, never an assumed catalog
    /// price; "Loading…" or "—" while the space's summary is not in. Also
    /// whether its button opens Billing rather than offering an upgrade.
    pub(in crate::features::settings) fn plan_reading(
        &self,
        space: &str,
        restoring: bool,
        signed_in: bool,
    ) -> (String, bool) {
        let ours = self
            .plan_page
            .context
            .as_ref()
            .is_some_and(|c| c.1 == space);
        let snapshot = &self.plan_page.snapshot;
        let summary = snapshot.summary.as_ref().filter(|_| ours);
        let holding = pricing::resolve_holding(summary, snapshot.catalog.as_ref());
        let unread = signed_in && summary.is_none();
        let reading = if restoring || unread {
            if restoring || snapshot.loading || !ours {
                crate::localization::t("settings.plan.loading").to_owned()
            } else {
                "—".to_owned()
            }
        } else {
            format::held_plan(&holding)
        };
        (reading, holding.subscribed || unread)
    }

    #[cfg(test)]
    pub fn plan_snapshot(&self) -> &PlanSnapshot {
        &self.plan_page.snapshot
    }
    /// Retry, as the page's button asks for it.
    #[cfg(test)]
    pub fn refresh_plan_for_test(&mut self, cx: &mut Context<Self>) {
        self.refresh_plan(cx);
    }
}
