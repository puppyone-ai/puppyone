//! `SeatsSettingsView`, `PersonalPlan` and `useAccountPlan`: what this account
//! holds and the one plan on sale. Each read fails on its own and a billing
//! outage falls back to the published offer; with payments off nothing is
//! read. A purchase starts only from the catalog's plan, and the plan changes
//! when the server says so, never when the browser comes back.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Page;
use crate::{
    features::cloud_services::billing_client,
    localization::{t as tr, tf},
    theme::Theme,
    ui::components::{Button, ButtonVariant, SettingsSection, SettingsSubsection, ValueRow},
    workspace::cloud::billing::{self, Catalog, Keys, Quote, Summary, Usage},
};
use gpui::{prelude::*, *};
use gpui_kit::base::Disableable as _;

/// `resolvePersonalOffer` without a catalogue: Personal, $19 a month, 10 GB
/// and one Cloud Computer.
const OFFER_PRICE: &str = "$19";
const OFFER_STORAGE: &str = "10 GB";
const INCLUDED_COMPUTERS: usize = 1;
/// How many times a confirmed checkout rereads the account while the browser
/// finishes, by the billing backoff.
const CHECKOUT_REREADS: usize = 5;

#[derive(Default)]
pub(in crate::features::settings) struct PlanPage {
    pub catalog: Option<Catalog>,
    pub summary: Option<Summary>,
    pub usage: Option<Usage>,
    pub organization: Option<String>,
    pub loading: bool,
    pub quote: Option<Quote>,
    pub acting: bool,
    pub error: Option<&'static str>,
    pub keys: Keys,
    pub epoch: u64,
}
fn bytes(value: u64) -> String {
    const GB: f64 = 1024. * 1024. * 1024.;
    let gb = value as f64 / GB;
    if gb >= 1. {
        format!("{gb:.1} GB")
    } else {
        format!("{:.1} MB", value as f64 / (1024. * 1024.))
    }
}
fn money(cents: i64, currency: &str) -> String {
    let symbol = if currency.eq_ignore_ascii_case("usd") {
        "$".to_owned()
    } else {
        format!("{currency} ")
    };
    if cents % 100 == 0 {
        format!("{symbol}{}", cents / 100)
    } else {
        format!("{symbol}{}.{:02}", cents / 100, cents % 100)
    }
}

impl SettingsWorkspaceSurface {
    /// Whether usage was read and belonged to this organization.
    #[cfg(test)]
    pub fn plan_usage_read(&self) -> bool {
        self.plan_page.usage.is_some()
    }
    /// Whether a plan is held, once the account's summary has been read.
    #[cfg(test)]
    pub fn plan_summary_held(&self) -> Option<bool> {
        self.plan_page.summary.as_ref().map(Summary::held)
    }
    /// `useAccountPlan`: payments off means no price or wallet is read.
    pub(in crate::features::settings) fn load_plan(&mut self, cx: &mut Context<Self>) {
        self.plan_page.epoch += 1;
        let epoch = self.plan_page.epoch;
        let payments = self.preferences.read(cx).state.experimental.payments;
        let Some(client) = billing_client(cx).filter(|_| payments) else {
            let keep = self.plan_page.epoch;
            self.plan_page = PlanPage {
                epoch: keep,
                ..Default::default()
            };
            return;
        };
        self.plan_page.loading = true;
        let task = cx.background_spawn(async move {
            let catalog = client.catalog().ok();
            // An account's plan lives on its organization.
            let organization = client
                .organizations()
                .ok()
                .and_then(|o| o.into_iter().next());
            let (summary, usage) = match &organization {
                // Never one organization's money under another's name.
                Some(org) => (
                    client.summary(org).ok(),
                    client.usage(org).ok().filter(|u| u.runtime.org_id == *org),
                ),
                None => (None, None),
            };
            (catalog, organization, summary, usage)
        });
        cx.spawn(async move |this, cx| {
            let (catalog, organization, summary, usage) = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch != epoch {
                    return;
                }
                let page = &mut s.plan_page;
                page.loading = false;
                page.catalog = catalog;
                page.organization = organization;
                page.summary = summary;
                page.usage = usage;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn subscribe(&mut self, plan: String, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) = (billing_client(cx), self.plan_page.organization.clone())
        else {
            return;
        };
        let intent = format!("quote:{org}:{plan}:1");
        let key = self.plan_page.keys.key(&intent, "plan-quote");
        self.plan_page.acting = true;
        self.plan_page.error = None;
        let epoch = self.plan_page.epoch;
        let task = cx.background_spawn(async move { client.quote_plan(&org, &plan, 1, key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch != epoch {
                    return;
                }
                s.plan_page.acting = false;
                match result {
                    Ok(quote) => {
                        s.plan_page.keys.forget(&intent);
                        s.plan_page.quote = Some(quote);
                    }
                    Err(_) => s.plan_page.error = Some("cloud.billing.quoteFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    fn confirm_plan(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org), Some(quote)) = (
            billing_client(cx),
            self.plan_page.organization.clone(),
            self.plan_page.quote.clone(),
        ) else {
            return;
        };
        if !billing::quote_live(&quote, chrono::Utc::now()) {
            self.plan_page.quote = None;
            self.plan_page.error = Some(billing::EXPIRED);
            cx.notify();
            return;
        }
        let intent = format!("quote-apply:{org}:checkout:{}", quote.quote_id);
        let key = self.plan_page.keys.key(&intent, "checkout");
        self.plan_page.acting = true;
        self.plan_page.error = None;
        let epoch = self.plan_page.epoch;
        let task = cx.background_spawn(async move {
            let (url, returned, operation) = client.checkout(&org, &quote, None, key)?;
            if !billing::same_quote(&returned, &quote, &org)
                || !billing::operation_matches(&operation, &quote, &org, None)
            {
                return Err(crate::workspace::cloud::services::Error::Invalid("billing"));
            }
            Ok(url)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let opened = this
                .update(cx, |s, cx| {
                    if s.plan_page.epoch != epoch {
                        return false;
                    }
                    s.plan_page.acting = false;
                    let opened = match result {
                        Ok(url) => {
                            s.plan_page.keys.forget(&intent);
                            s.plan_page.quote = None;
                            cx.open_url(&url);
                            true
                        }
                        Err(_) => {
                            s.plan_page.error = Some("cloud.billing.changeFailed");
                            false
                        }
                    };
                    cx.notify();
                    opened
                })
                .unwrap_or(false);
            // The server's state is the answer, however the browser ends.
            for attempt in 0..CHECKOUT_REREADS {
                if !opened {
                    break;
                }
                cx.background_executor()
                    .timer(billing::poll_delay(attempt))
                    .await;
                let done = this
                    .update(cx, |s, cx| {
                        let held = s.plan_page.summary.as_ref().is_some_and(Summary::held);
                        if !held {
                            s.load_plan(cx);
                        }
                        held
                    })
                    .unwrap_or(true);
                if done {
                    break;
                }
            }
        })
        .detach();
    }
    fn open_invoices(&mut self, cx: &mut Context<Self>) {
        let (Some(client), Some(org)) = (billing_client(cx), self.plan_page.organization.clone())
        else {
            return;
        };
        let intent = format!("portal:{org}");
        let key = self.plan_page.keys.key(&intent, "portal");
        self.plan_page.acting = true;
        self.plan_page.error = None;
        let epoch = self.plan_page.epoch;
        let task = cx.background_spawn(async move { client.portal(&org, key) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.plan_page.epoch != epoch {
                    return;
                }
                s.plan_page.acting = false;
                match result {
                    Ok(url) => {
                        s.plan_page.keys.forget(&intent);
                        cx.open_url(&url);
                    }
                    Err(_) => s.plan_page.error = Some("cloud.billing.portalFailed"),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
    pub(super) fn plan(&self, _: Theme, cx: &mut Context<Self>) -> AnyElement {
        let signed_in = self
            .cloud
            .as_ref()
            .and_then(|s| s.read(cx).snapshot.as_ref())
            .is_some_and(|s| s.account.is_some());
        let page = &self.plan_page;
        let offer = page.catalog.as_ref().and_then(billing::personal_offer);
        let held = page.summary.as_ref().filter(|s| s.held());
        let price = offer
            .and_then(|p| p.price_per_seat_cents.map(|c| money(c, &p.currency)))
            .unwrap_or_else(|| OFFER_PRICE.to_owned());
        let monthly = tf("settings.plan.monthlyFor", &[("amount", price.into())]);
        let value = match held.and_then(|s| s.current_period_end.as_deref()) {
            Some(end) => {
                let day: String = end.chars().take(10).collect();
                format!(
                    "{monthly} · {}",
                    tf("settings.seats.renews", &[("date", day.into())])
                )
            }
            None => monthly,
        };
        let action = if !signed_in {
            // Buying needs an account, and Account owns the one sign-in flow.
            Some(
                Button::new("subscribe")
                    .variant(ButtonVariant::OutlinePrimary)
                    .label(tr("settings.seats.signInToSubscribe"))
                    .on_click(cx.listener(|s, _, _, cx| s.select_page(Page::Account, cx))),
            )
        } else if let Some(summary) = held {
            summary.portal_available.then(|| {
                Button::new("invoices")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("settings.seats.invoices"))
                    .disabled(page.acting)
                    .on_click(cx.listener(|s, _, _, cx| s.open_invoices(cx)))
            })
        } else {
            // While subscriptions are not open the button stays and says so.
            let plan = offer
                .filter(|p| p.purchasable && page.organization.is_some())
                .map(|p| p.id.clone());
            let ready = plan.is_some();
            Some(
                Button::new("subscribe")
                    .variant(ButtonVariant::OutlinePrimary)
                    .label(tr(if ready || page.loading {
                        "settings.seats.subscribe"
                    } else {
                        "settings.seats.comingSoon"
                    }))
                    .disabled(!ready || page.loading || page.acting)
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if let Some(plan) = plan.clone() {
                            s.subscribe(plan, cx);
                        }
                    })),
            )
        };
        let mut row = ValueRow::new(tr("settings.seats.planName"), value);
        if let Some(action) = action {
            row = row.action(action);
        }
        let limit = page
            .usage
            .as_ref()
            .and_then(|u| u.storage.limit_bytes)
            .or_else(|| offer.and_then(|p| p.storage_bytes()));
        let storage = match (&page.usage, limit) {
            (Some(usage), Some(limit)) => tf(
                "settings.seats.storageUsedOf",
                &[
                    ("used", bytes(usage.storage.logical_bytes).into()),
                    ("total", bytes(limit).into()),
                ],
            ),
            (_, Some(limit)) => bytes(limit),
            _ => OFFER_STORAGE.to_owned(),
        };
        let mut section = SettingsSection::new(tr(Page::Plan.title()))
            .child(SettingsSubsection::new().lead(true).child(row));
        if let Some(quote) = page.quote.clone() {
            section = section.child(
                SettingsSubsection::new()
                    .title(tr("settings.plan.quoteTitle"))
                    .child(
                        ValueRow::new(
                            tr("settings.seats.planName"),
                            money(quote.target_amount_cents, &quote.currency),
                        )
                        .action(
                            Button::new("confirm-plan")
                                .variant(ButtonVariant::Solid)
                                .label(tr("settings.plan.confirmAndPay"))
                                .disabled(page.acting)
                                .on_click(cx.listener(|s, _, _, cx| s.confirm_plan(cx))),
                        ),
                    )
                    .child(ValueRow::new(tr("settings.plan.quoteNote"), "")),
            );
        }
        if let Some(error) = page.error {
            section = section.child(SettingsSubsection::new().child(ValueRow::new(tr(error), "")));
        }
        section
            .child(
                SettingsSubsection::new()
                    .title(tr("settings.seats.includesTitle"))
                    .child(ValueRow::new(tr("settings.seats.storageTitle"), storage))
                    .child(ValueRow::new(
                        tr("settings.seats.computerTitle"),
                        tf(
                            "settings.seats.computerCount",
                            &[("count", INCLUDED_COMPUTERS.into())],
                        ),
                    )),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn amounts_and_sizes_read_as_the_product_shows_them() {
        assert_eq!(money(1900, "usd"), "$19");
        assert_eq!(money(1950, "USD"), "$19.50");
        assert_eq!(money(1900, "EUR"), "EUR 19");
        assert_eq!(bytes(10 * 1024 * 1024 * 1024), "10.0 GB");
        assert_eq!(bytes(5 * 1024 * 1024), "5.0 MB");
    }
}
