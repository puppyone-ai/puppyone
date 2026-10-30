//! `useCloudBillingController` and `CloudOrganizationBillingPage`: Billing
//! of one explicitly chosen Organization, for its owner. Every state belongs
//! to one context (account, session, API, Organization) and goes with it:
//! a late answer is dropped by the epoch. Success is what the server reports
//! afterwards, never a browser return.
use super::*;
use crate::workspace::cloud::billing::{self, Catalog, Keys, Operation, Quote, Summary};

/// Member loading, member error, non-owner and owner are distinct.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Membership {
    #[default]
    Unknown,
    Loading,
    Failed,
    Member,
    Owner,
}
#[derive(Default)]
pub(super) struct BillingPage {
    pub membership: Membership,
    pub catalog: Option<Catalog>,
    pub summary: Option<Summary>,
    pub operations: Vec<Operation>,
    pub quote: Option<Quote>,
    pub quoted_operation: Option<String>,
    pub seats: u64,
    pub acting: bool,
    pub error: Option<&'static str>,
    pub polling: Option<String>,
    pub keys: Keys,
    pub epoch: u64,
}
impl BillingPage {
    /// `contextChanged`: everything goes, keys included; only the fence stays.
    pub fn reset(&mut self) {
        *self = Self {
            epoch: self.epoch + 1,
            ..Self::default()
        };
    }
}
type Loaded = (Catalog, Summary, Vec<Operation>);

impl CloudServices {
    fn billing_client(&self) -> Option<billing::Client> {
        Some(billing::Client::new(self.client.as_ref()?.transport()))
    }
    /// The Organization's membership, then its Billing state.
    pub(super) fn load_billing(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) = (self.billing_client(), self.team.selected.clone()) else {
            return;
        };
        self.billing.reset();
        self.billing.membership = Membership::Loading;
        let epoch = self.billing.epoch;
        let task = cx.background_spawn(async move {
            let access = client.access(&org)?;
            if !access.can_manage_billing {
                return Ok(None);
            }
            let loaded: Loaded = (
                client.catalog()?,
                client.summary(&org)?,
                client.operations(&org)?,
            );
            services::Result::Ok(Some(loaded))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.billing.epoch != epoch {
                    return;
                }
                match result {
                    Ok(Some((catalog, summary, operations))) => {
                        s.billing.membership = Membership::Owner;
                        s.billing.seats = summary.seat_quantity.max(1);
                        s.billing.catalog = Some(catalog);
                        s.billing.summary = Some(summary);
                        // An operation still in flight is watched, not repeated.
                        let resume = billing::resumable(&operations).map(|o| o.id.clone());
                        s.billing.operations = operations;
                        if let Some(id) = resume {
                            s.watch_operation(id, cx);
                        }
                    }
                    Ok(None) => s.billing.membership = Membership::Member,
                    Err(_) => s.billing.membership = Membership::Failed,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// Asks the server for a quote: Desktop never computes a price.
    pub(super) fn request_quote(&mut self, plan: billing::Plan, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) = (self.billing_client(), self.team.selected.clone()) else {
            return;
        };
        if self.billing.acting || self.billing.polling.is_some() {
            return;
        }
        let seats = billing::clamp_seats(self.billing.seats, &plan);
        let intent = format!("quote:{org}:{}:{seats}", plan.id);
        let key = self.billing.keys.key(&intent, "plan-quote");
        self.billing.acting = true;
        self.billing.error = None;
        self.billing.quote = None;
        let epoch = self.billing.epoch;
        let task =
            cx.background_spawn(async move { client.quote_plan(&org, &plan.id, seats, key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.billing.epoch != epoch {
                    return;
                }
                s.billing.acting = false;
                match result {
                    Ok(quote) => {
                        s.billing.keys.forget(&intent);
                        s.billing.quote = Some(quote);
                    }
                    Err(_) => s.billing.error = Some("cloud.billing.quoteFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// `confirmQuote`: the mutation by the quote's mode. A checkout's URL
    /// opens only after the answer matched what was quoted.
    pub(super) fn confirm_quote(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org), Some(quote)) = (
            self.billing_client(),
            self.team.selected.clone(),
            self.billing.quote.clone(),
        ) else {
            return;
        };
        if self.billing.acting {
            return;
        }
        if !billing::quote_live(&quote, chrono::Utc::now()) {
            self.billing.error = Some(billing::EXPIRED);
            cx.notify();
            return;
        }
        let intent = format!(
            "quote-apply:{org}:{}:{}",
            quote.application_mode, quote.quote_id
        );
        let key = self
            .billing
            .keys
            .key(&intent, &quote.application_mode.clone());
        let expected = self.billing.quoted_operation.clone();
        self.billing.acting = true;
        self.billing.error = None;
        let epoch = self.billing.epoch;
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
                return Err(services::Error::Invalid("billing"));
            }
            Ok((url, operation))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.billing.epoch != epoch {
                    return;
                }
                s.billing.acting = false;
                match result {
                    Ok((url, operation)) => {
                        s.billing.keys.forget(&intent);
                        s.billing.quote = None;
                        if let Some(url) = url {
                            cx.open_url(&url);
                        }
                        s.billing.operations.retain(|o| o.id != operation.id);
                        let id = operation.id.clone();
                        s.billing.operations.push(operation);
                        s.watch_operation(id, cx);
                    }
                    Err(services::Error::Invalid(_)) => {
                        s.billing.error = Some(billing::MISMATCH);
                    }
                    // The same intent keeps its key for a retry.
                    Err(_) => s.billing.error = Some("cloud.billing.changeFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    /// Polls with backoff until the server says it ended; only then is the
    /// state reread. Access lost ends the watch.
    fn watch_operation(&mut self, id: String, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) = (self.billing_client(), self.team.selected.clone()) else {
            return;
        };
        self.billing.polling = Some(id.clone());
        let epoch = self.billing.epoch;
        cx.spawn(async move |this, cx| {
            let mut attempt = 0;
            loop {
                cx.background_executor()
                    .timer(billing::poll_delay(attempt))
                    .await;
                let (client, org, id) = (client.clone(), org.clone(), id.clone());
                let result = cx
                    .background_spawn(async move { client.operation(&org, &id) })
                    .await;
                let stop = this
                    .update(cx, |s, cx| {
                        if s.billing.epoch != epoch {
                            return true;
                        }
                        match result {
                            Ok(operation) => {
                                let terminal = operation.terminal;
                                let failed = terminal && operation.state != "succeeded";
                                s.billing.operations.retain(|o| o.id != operation.id);
                                s.billing.operations.push(operation);
                                if terminal {
                                    s.billing.polling = None;
                                    if failed {
                                        s.billing.error = Some("cloud.billing.changeFailed");
                                        cx.notify();
                                    } else {
                                        s.load_billing(cx);
                                    }
                                }
                                terminal
                            }
                            Err(services::Error::Status(401 | 403 | 404)) => {
                                s.billing.polling = None;
                                s.billing.error = Some("cloud.billing.loadFailed");
                                cx.notify();
                                true
                            }
                            Err(_) => false,
                        }
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
    pub(super) fn open_portal(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) = (self.billing_client(), self.team.selected.clone()) else {
            return;
        };
        if self.billing.acting {
            return;
        }
        let intent = format!("portal:{org}");
        let key = self.billing.keys.key(&intent, "portal");
        self.billing.acting = true;
        self.billing.error = None;
        let epoch = self.billing.epoch;
        let task = cx.background_spawn(async move { client.portal(&org, key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.billing.epoch != epoch {
                    return;
                }
                s.billing.acting = false;
                match result {
                    Ok(url) => {
                        s.billing.keys.forget(&intent);
                        cx.open_url(&url);
                    }
                    Err(_) => s.billing.error = Some("cloud.billing.portalFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub(super) fn billing_view(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().ui;
        let text = |color: Hsla, value: String| {
            div().text_size(px(ty.meta)).text_color(color).child(value)
        };
        let mut page = v_flex().gap(px(12.)).child(self.heading(t));
        page = page.children(self.organization_chooser(cx));
        if self.team.selected.is_none() {
            let empty = !self.team.loading && self.team.organizations.is_empty();
            return page
                .when(empty, |d| {
                    d.child(text(
                        t.muted.into(),
                        tr("cloud.billing.noOrganization").into(),
                    ))
                })
                .into_any_element();
        }
        match self.billing.membership {
            Membership::Unknown | Membership::Loading => {
                return page.child(self.loading_row(t)).into_any_element();
            }
            Membership::Failed => {
                return page
                    .child(text(t.danger.into(), tr("cloud.billing.loadFailed").into()))
                    .child(
                        h_flex().child(
                            Button::new("cloud-billing-retry")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("cloud.common.retry"))
                                .on_click(cx.listener(|s, _, _, cx| s.load_billing(cx))),
                        ),
                    )
                    .into_any_element();
            }
            Membership::Member => {
                return page
                    .child(text(
                        t.text.into(),
                        tr("cloud.billing.ownerRequired").into(),
                    ))
                    .child(text(
                        t.muted.into(),
                        tr("cloud.billing.ownerRequiredDetail").into(),
                    ))
                    .into_any_element();
            }
            Membership::Owner => {}
        }
        let busy = self.billing.acting || self.billing.polling.is_some();
        if let Some(summary) = &self.billing.summary {
            let status = tr(&format!(
                "cloud.billing.subscriptionStatus.{}",
                summary.status
            ));
            let current = self
                .billing
                .catalog
                .as_ref()
                .and_then(|c| c.plans.iter().find(|p| p.id == summary.plan_id))
                .map_or(summary.plan_id.clone(), |p| p.name.clone());
            page = page.child(text(
                t.text.into(),
                format!("{current} · {status} · {}", summary.seat_quantity),
            ));
        }
        if self.billing.polling.is_some() {
            page = page.child(text(
                t.muted.into(),
                tr("cloud.billing.waitingForAuthority").into(),
            ));
        }
        if let Some(error) = self.billing.error {
            page = page.child(text(t.danger.into(), tr(error).into()));
        }
        let seats = self.billing.seats;
        page = page.child(
            h_flex()
                .gap(px(6.))
                .child(text(
                    t.muted.into(),
                    tr("cloud.billing.seatQuantity").into(),
                ))
                .child(
                    Button::new("cloud-seats-less")
                        .variant(ButtonVariant::Secondary)
                        .icon(Icon::new("minus").with_size(px(12.)).color(t.muted))
                        .accessibility_label(tr("cloud.billing.seatQuantity"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.billing.seats = s.billing.seats.saturating_sub(1).max(1);
                            s.billing.quote = None;
                            cx.notify();
                        })),
                )
                .child(text(t.text.into(), seats.to_string()))
                .child(
                    Button::new("cloud-seats-more")
                        .variant(ButtonVariant::Secondary)
                        .icon(Icon::new("plus").with_size(px(12.)).color(t.muted))
                        .accessibility_label(tr("cloud.billing.seatQuantity"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.billing.seats += 1;
                            s.billing.quote = None;
                            cx.notify();
                        })),
                ),
        );
        let plans: Vec<billing::Plan> = self
            .billing
            .catalog
            .as_ref()
            .map(|c| {
                c.plans
                    .iter()
                    .filter(|p| p.public && p.purchasable)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        for (index, plan) in plans.into_iter().enumerate() {
            // The catalog's own price; the amount due comes from the quote.
            let price = plan
                .price_per_seat_cents
                .map_or(tr("cloud.billing.custom").to_owned(), |cents| {
                    money(cents, &plan.currency)
                });
            let name = plan.name.clone();
            page = page.child(
                h_flex()
                    .gap(px(8.))
                    .p(px(10.))
                    .border_1()
                    .border_color(t.border)
                    .rounded(px(8.))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(text(t.text.into(), name))
                            .child(text(t.muted.into(), price)),
                    )
                    .child(
                        Button::new(("cloud-plan-quote", index))
                            .variant(ButtonVariant::Secondary)
                            .label(tr("cloud.billing.requestQuote"))
                            .disabled(busy)
                            .on_click(
                                cx.listener(move |s, _, _, cx| s.request_quote(plan.clone(), cx)),
                            ),
                    ),
            );
        }
        if let Some(quote) = self.billing.quote.clone() {
            page = page.child(
                h_flex()
                    .gap(px(8.))
                    .p(px(10.))
                    .border_1()
                    .border_color(t.border)
                    .rounded(px(8.))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(text(
                                t.text.into(),
                                format!(
                                    "{} · {}",
                                    quote.target_plan_id,
                                    money(quote.target_amount_cents, &quote.currency)
                                ),
                            ))
                            .child(text(
                                t.muted.into(),
                                money(quote.delta_amount_cents, &quote.currency),
                            )),
                    )
                    .child(
                        Button::new("cloud-quote-confirm")
                            .variant(ButtonVariant::Solid)
                            .label(tr("cloud.billing.confirmQuotedChange"))
                            .disabled(busy)
                            .on_click(cx.listener(|s, _, _, cx| s.confirm_quote(cx))),
                    ),
            );
        }
        page.child(
            h_flex().justify_end().child(
                Button::new("cloud-billing-portal")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("cloud.billing.managePortal"))
                    .disabled(self.billing.acting)
                    .on_click(cx.listener(|s, _, _, cx| s.open_portal(cx))),
            ),
        )
        .into_any_element()
    }
}
/// A server amount for display; nothing is computed from it.
fn money(cents: i64, currency: &str) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let cents = cents.unsigned_abs();
    format!("{sign}{}.{:02} {currency}", cents / 100, cents % 100)
}
