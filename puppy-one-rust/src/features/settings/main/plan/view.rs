//! Settings › Plan as redesigned on 2026-11-19 (puppy-issues
//! `document/puppyone-desktop/cloud/billing.md`, "Plan page"). The page
//! answers, in order: what
//! the space is on and how much of it is used (the plan, then two
//! forty-cell meters with machine-set readings), what the add-ons held are,
//! and what each other plan would add. It is drawn as every Settings page
//! is: rows with the label at the start and the value or control at the
//! end, subsections titled in the meta size, notes under the rows they
//! qualify. A change is confirmed where it was asked for, in a group of
//! rows under the plan, the add-on or the plan row it changes.
use super::super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Target;
use super::format::{self as f, Fill};
use crate::localization::{Arg, t as tr, tf};
use crate::theme::{self, Theme};
use crate::ui::components::{
    Button, ButtonVariant, Icon, SettingRow, SettingsChange, SettingsList, SettingsNote,
    SettingsSection, SettingsSubsection, Spinner, Stepper,
};
use crate::ui::loading::{self, model::Shape};
use crate::workspace::cloud::billing::Quote;
use crate::workspace::cloud::pricing::{
    self, AddOnKind, AddOnOffer, CatalogView, PLAN_ORDER, PlanHolding, PlanId, PlanOffer,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};

/// Numbers a machine set: readings, prices quoted.
fn mono(text: impl Into<SharedString>) -> Div {
    div().font_family(theme::mono()).child(text.into())
}
fn placeholder(id: &'static str, width: f32, height: f32) -> AnyElement {
    loading::placeholder(
        id,
        width,
        height,
        vec![Shape {
            x: 0.,
            y: 0.,
            width: width as f64,
            height: height as f64,
            radius: 4.,
        }],
    )
    .into_any_element()
}
/// A row of the page: its label in the label ink, its value or control at
/// the end.
fn row(label: impl Into<SharedString>, end: impl IntoElement) -> SettingRow {
    SettingRow::new(label).control(end)
}
/// A row whose label says what it is and, under it in the meta size, what
/// it gives.
fn described(
    name: impl Into<SharedString>,
    detail: impl Into<SharedString>,
    end: impl IntoElement,
) -> SettingRow {
    let meta = theme::ty().ui.meta;
    SettingRow::new("")
        .label_element(
            v_flex().child(div().child(name.into())).child(
                div()
                    .text_size(px(meta))
                    .line_height(px(meta * 1.5))
                    .child(detail.into()),
            ),
        )
        .control(end)
        .py(px(8.))
}
/// A value and what qualifies it, each its own run:
/// `Team · 3 people · $60 / month`.
fn facts(value: Option<String>, facts: Vec<String>, t: Theme) -> Div {
    let lead = value.is_some();
    h_flex()
        .gap(px(6.))
        .min_w_0()
        .whitespace_nowrap()
        .children(value.map(|value| div().text_color(t.text).child(value)))
        .children(
            facts
                .into_iter()
                .enumerate()
                .flat_map(move |(index, fact)| {
                    let dot = (lead || index > 0).then(|| div().text_color(t.subtle).child("·"));
                    dot.into_iter()
                        .chain([div().text_color(t.subtle).child(fact)])
                        .collect::<Vec<_>>()
                }),
        )
}
/// A meter as a row's control: the share used, the forty cells, the reading.
fn meter(percent: String, cells: AnyElement, reading: String, ink: Hsla, t: Theme) -> Div {
    let calm = ink == Hsla::from(t.text);
    h_flex()
        .gap(px(10.))
        .child(mono(percent).text_color(if calm { t.subtle.into() } else { ink }))
        .child(div().w(px(200.)).child(cells))
        .child(mono(reading).min_w(px(96.)).text_right().text_color(ink))
}
/// The end of a change's last row: its two choices.
fn choices(cancel: Button, confirm: Button) -> Div {
    h_flex().gap(px(8.)).child(cancel).child(confirm)
}
/// A note in a change's last row, beside its choices.
fn change_note(text: impl IntoElement) -> Div {
    let meta = theme::ty().ui.meta;
    div()
        .text_size(px(meta))
        .line_height(px(meta * 1.5))
        .child(text)
}
/// What the plan held costs a month; nothing on Free.
fn held_monthly(view: &CatalogView, holding: &PlanHolding) -> Option<i64> {
    if !holding.subscribed {
        return None;
    }
    holding.monthly_cents.or_else(|| {
        let offer = view.plan(holding.plan()?)?;
        Some(
            offer.price_cents
                * if offer.per_person {
                    holding.seats as i64
                } else {
                    1
                },
        )
    })
}
/// A monthly amount, or a change of one: `$60 → $100 / month`.
fn monthly_change(from: Option<i64>, to: i64, currency: &str) -> String {
    let monthly = tf(
        "settings.plan.monthlyFor",
        &[("amount", f::money(Some(to), currency).into())],
    );
    match from.filter(|from| *from != to) {
        Some(from) => format!("{} → {monthly}", f::money(Some(from), currency)),
        None => monthly,
    }
}
fn plan_name(id: PlanId) -> String {
    tr(&format!("settings.plan.name.{}", id.key())).to_owned()
}

/// Forty cells in one row: used, held by agents still running, left. Only
/// a reading draws used cells; without one every cell stays dark.
fn cells(
    id: &'static str,
    label: &'static str,
    percent: Option<f64>,
    running: Option<f64>,
    t: Theme,
) -> AnyElement {
    let (used, held) = f::cells(percent, running);
    let ink = match f::fill(percent) {
        Fill::Calm => theme::fade(t.text, 0.88),
        Fill::Near => t.warning,
        Fill::Full => t.danger,
    };
    div()
        .id(id)
        .debug_selector(move || id.into())
        .when_some(percent, |d, value| {
            d.role(Role::ProgressIndicator)
                .aria_label(tr(label))
                .aria_numeric_value(value.clamp(0., 100.))
                .aria_min_numeric_value(0.)
                .aria_max_numeric_value(100.)
        })
        .flex()
        .w_full()
        .h(px(14.))
        .gap(px(2.))
        .children((0..f::CELLS).map(|cell| {
            div()
                .debug_selector(move || format!("{id}-cell-{cell}"))
                .when(cell < used, |d| {
                    d.debug_selector(move || format!("{id}-used-{cell}"))
                })
                .when(cell >= used && cell < used + held, |d| {
                    d.debug_selector(move || format!("{id}-running-{cell}"))
                })
                .flex_1()
                .h_full()
                .rounded(px(1.))
                .bg(if cell < used {
                    ink
                } else if cell < used + held {
                    theme::fade(t.text, 0.34)
                } else {
                    theme::fade(t.text, 0.075)
                })
        }))
        .test_support()
        .into_any_element()
}

/// Where the plans are listed for: no account, an account whose space
/// could not be read, its owner, or someone else in the space.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Reader {
    SignedOut,
    Unread,
    Owner,
    Member,
}

impl SettingsWorkspaceSurface {
    pub(in crate::features::settings) fn plan(
        &self,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        #[cfg(feature = "dev-capture")]
        let lab = self.plan_page.lab.is_some();
        #[cfg(not(feature = "dev-capture"))]
        let lab = false;
        // `usePaymentsExperience()`: nothing of Plan without payments.
        if !lab && !crate::features::flags::payments_enabled(&self.preferences, cx) {
            return div().into_any_element();
        }
        let (signed_in, space) = self.plan_reader(cx);
        let restoring = crate::features::cloud::account::status(cx)
            == Some(crate::cloud::auth::Status::Restoring);
        let page = &self.plan_page;
        let org = page
            .context
            .as_ref()
            .map(|c| c.1.clone())
            .filter(|org| space.as_ref().is_some_and(|s| &s.id == org));
        let snapshot = &page.snapshot;
        let mut section = SettingsSection::new(tr("settings.seats.title"));
        if signed_in && space.is_none() {
            section = section.child(SettingsNote::new(tr("settings.space.choose")));
        }
        let waiting = signed_in && space.is_some();
        let body = if restoring
            || (waiting && snapshot.summary.is_none() && (snapshot.loading || !snapshot.error))
        {
            self.plan_loading(t)
        } else if let (true, Some(_), Some(_)) = (signed_in, org, snapshot.summary.as_ref()) {
            self.connected_plans(t, cx)
        } else {
            let view = pricing::resolve_catalog(snapshot.catalog.as_ref());
            let holding = pricing::resolve_holding(None, None);
            v_flex()
                .gap(px(16.))
                .when(waiting, |d| {
                    d.child(
                        div()
                            .id("plan-load-error")
                            .role(Role::Alert)
                            .aria_label(tr("cloud.billing.loadFailed"))
                            .child(row(
                                tr("cloud.billing.loadFailed"),
                                Button::new("plan-load-retry")
                                    .label(tr("common.action.retry"))
                                    .on_click(cx.listener(|s, _, _, cx| s.refresh_plan(cx))),
                            ))
                            .test_support(),
                    )
                })
                .child(self.plan_rows(
                    &view,
                    &holding,
                    if waiting {
                        Reader::Unread
                    } else {
                        Reader::SignedOut
                    },
                    false,
                    t,
                    cx,
                ))
                .child(SettingsNote::new(tr("settings.plan.finePrint")))
                .into_any_element()
        };
        section.child(body).into_any_element()
    }

    /// The signed-in page keeps its reading order while its first snapshot
    /// loads: the plan, dark meters, then the plans.
    fn plan_loading(&self, t: Theme) -> AnyElement {
        let ui = theme::ty().ui;
        let empty = |id, label| {
            row(
                tr(label),
                h_flex()
                    .gap(px(10.))
                    .child(div().w(px(200.)).child(cells(id, label, None, None, t)))
                    .child(placeholder("plan-loading-reading", 96., ui.label * 1.5)),
            )
        };
        v_flex()
            .id("plan-loading")
            .role(Role::Status)
            .aria_label(tr("common.status.loading"))
            .debug_selector(|| "plan-loading".into())
            .gap(px(16.))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(row(
                        tr("settings.account.plan"),
                        placeholder("plan-loading-plan", 168., ui.label * 1.5),
                    ))
                    .child(empty("plan-hours-meter", "settings.plan.hoursLabel"))
                    .child(empty("plan-storage-meter", "settings.plan.storageLabel")),
            )
            .child(
                SettingsSubsection::new()
                    .title(tr("settings.plan.chooseTitle"))
                    .child(row(
                        "",
                        placeholder("plan-loading-row-0", 240., ui.label * 1.5),
                    ))
                    .child(row(
                        "",
                        placeholder("plan-loading-row-1", 240., ui.label * 1.5),
                    )),
            )
            .test_support()
            .into_any_element()
    }

    /// The space's plan as the server holds it, with everything its owner
    /// can change.
    fn connected_plans(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let page = &self.plan_page;
        let snapshot = &page.snapshot;
        let controller = &page.controller;
        let view = pricing::resolve_catalog(snapshot.catalog.as_ref());
        let summary = snapshot.summary.clone();
        let holding = pricing::resolve_holding(summary.as_ref(), snapshot.catalog.as_ref());
        let current = holding
            .plan()
            .and_then(|id| view.plan(id))
            .unwrap_or(&view.plans[0])
            .clone();
        // Only the space's owner can buy or change; others see the plan.
        let owner = snapshot.can_manage_billing == Some(true);
        let sellable =
            !snapshot.catalog_unavailable && view.authoritative && !controller.disabled && owner;
        let busy = controller.acting || snapshot.loading || controller.polling.is_some();
        let held_plan = summary
            .as_ref()
            .map(|s| s.plan_id.clone())
            .unwrap_or_default();
        let portal = summary.as_ref().is_some_and(|s| s.portal_available);
        let seat_changes = summary.as_ref().is_some_and(|s| s.seat_changes_available);
        let add_ons: Vec<AddOnOffer> =
            if !snapshot.catalog_unavailable && owner && holding.subscribed {
                view.add_ons
                    .iter()
                    .filter(|a| a.available_on.contains(&held_plan))
                    .cloned()
                    .collect()
            } else {
                vec![]
            };

        let mut actions = vec![];
        if owner && holding.subscribed {
            if current.per_person
                && sellable
                && seat_changes
                && holding.scheduled.is_none()
                && controller.target.is_none()
            {
                actions.push(
                    Button::new("plan-change-people")
                        .label(tr("native.plan.changePeople"))
                        .disabled(busy)
                        .on_click(cx.listener(|s, _, _, cx| s.change_people(cx)))
                        .into_any_element(),
                );
            }
            if portal {
                actions.push(
                    Button::new("plan-invoices")
                        .label(tr("settings.plan.invoices"))
                        .trailing(Icon::new("external-link").small())
                        .disabled(busy)
                        .on_click(cx.listener(|s, _, _, cx| s.open_portal(cx)))
                        .into_any_element(),
                );
            }
        }

        let mut notices = vec![];
        if holding.scheduled.is_some() {
            let keep = (owner && sellable && current.purchasable && controller.target.is_none())
                .then(|| current.catalog_plan.clone())
                .flatten()
                .map(|plan| {
                    let seats = holding.seats;
                    Button::new("plan-keep-current")
                        .label(tr("settings.plan.keepCurrent"))
                        .disabled(busy)
                        .on_click(
                            cx.listener(move |s, _, _, cx| s.keep_plan(plan.clone(), seats, cx)),
                        )
                        .into_any_element()
                });
            notices.push(self.scheduled_notice(&holding, keep, t));
        }
        // A change of the plan held is confirmed under the plan: the
        // people, keeping it, or one resumed from an earlier visit.
        let held = held_monthly(&view, &holding);
        let change = match controller.target {
            Some(Target::People) => {
                let stepper = self.people_stepper(1, cx).into_any_element();
                Some(self.confirmation(None, Some(stepper), &holding, current.id, held, t, cx))
            }
            Some(Target::Keep) => {
                Some(self.confirmation(None, None, &holding, current.id, held, t, cx))
            }
            None if controller.polling.is_some() => {
                Some(self.confirmation(None, None, &holding, current.id, held, t, cx))
            }
            _ => None,
        };

        let summary = self.current_plan(
            &current,
            &holding,
            view.authoritative && !snapshot.catalog_unavailable,
            &view.add_ons,
            actions,
            notices,
            change,
            if holding.subscribed {
                "native.plan.freeUpOrAdd"
            } else if sellable {
                "native.plan.freeUpOrUpgrade"
            } else {
                "native.plan.freeUp"
            },
            t,
        );
        // An error of a change shows where that change is confirmed.
        let loose_error = controller
            .error
            .filter(|_| !matches!(controller.target, Some(Target::Plan(_))));
        v_flex()
            .gap(px(16.))
            .child(
                v_flex()
                    .gap(px(6.))
                    .child(summary)
                    .when(snapshot.can_manage_billing == Some(false), |d| {
                        d.child(SettingsNote::new(tr("settings.plan.space.managedByOwner")))
                    })
                    .children(loose_error.map(|e| SettingsNote::new(tr(e)).danger()))
                    .when(snapshot.error, |d| {
                        d.child(row(
                            tr("cloud.billing.loadFailed"),
                            Button::new("plan-retry")
                                .label(tr("common.action.retry"))
                                .disabled(busy)
                                .on_click(cx.listener(|s, _, _, cx| s.refresh_plan(cx))),
                        ))
                    }),
            )
            .children(self.add_ons(&add_ons, &holding, sellable, t, cx))
            .child(self.plan_rows(
                &view,
                &holding,
                if owner { Reader::Owner } else { Reader::Member },
                sellable,
                t,
                cx,
            ))
            .child(SettingsNote::new(tr("settings.plan.finePrint")))
            .into_any_element()
    }

    /// The plan held, what it costs and when it renews, and this period's
    /// agent hours and storage as cell meters.
    #[allow(clippy::too_many_arguments)]
    fn current_plan(
        &self,
        offer: &PlanOffer,
        holding: &PlanHolding,
        show_price: bool,
        add_ons: &[AddOnOffer],
        actions: Vec<AnyElement>,
        notices: Vec<AnyElement>,
        change: Option<AnyElement>,
        storage_hint: &'static str,
        t: Theme,
    ) -> AnyElement {
        let usage = self.plan_page.snapshot.usage.as_ref();
        let reading = pricing::resolve_allowance(usage, offer, holding, add_ons);
        let hours = pricing::resolve_agent_hours(usage);
        let status = f::status(holding);
        let mut facts_list = vec![];
        if matches!(status, f::Status::Attention | f::Status::Updating) {
            facts_list.push(tr(&format!("settings.plan.status.{}", status.key())).to_owned());
        }
        if holding.subscribed {
            if offer.per_person {
                facts_list.push(tf(
                    "settings.plan.peopleUnit",
                    &[("count", Arg::Number(holding.seats as i64))],
                ));
            }
            // Until the catalog answers, the plan's own price stands in.
            let monthly = holding.monthly_cents.unwrap_or(
                offer.price_cents
                    * if offer.per_person {
                        holding.seats as i64
                    } else {
                        1
                    },
            );
            if show_price {
                facts_list.push(tf(
                    "settings.plan.monthlyFor",
                    &[(
                        "amount",
                        f::currency_amount(monthly, &holding.currency).into(),
                    )],
                ));
            }
            if let Some(renews) = &holding.renews_at {
                facts_list.push(tf(
                    if holding.cancel_at_period_end {
                        "settings.plan.endsOn"
                    } else {
                        "settings.plan.renewsOn"
                    },
                    &[("date", f::short_date(renews).into())],
                ));
            }
        } else {
            facts_list.push(tf(
                "settings.plan.monthlyFor",
                &[("amount", f::currency_amount(0, &holding.currency).into())],
            ));
        }

        // Agent hours: used of the month's grant; what running agents hold
        // follows in half-lit cells.
        let hours_percent = f::percent_of(hours.used, hours.total);
        let running = f::percent_of(hours.reserved, hours.total);
        let hours_reading = tf(
            "native.plan.hoursOf",
            &[
                (
                    "used",
                    hours.used.map_or_else(|| "—".to_owned(), f::hours).into(),
                ),
                (
                    "total",
                    hours
                        .total
                        .filter(|h| *h > 0.)
                        .map_or_else(|| "—".to_owned(), f::hours)
                        .into(),
                ),
            ],
        );
        let mut hours_note = vec![];
        if let Some(reserved) = hours.reserved.filter(|h| *h > 0.) {
            hours_note.push(tf(
                "settings.plan.hoursReserved",
                &[("hours", f::hours(reserved).into())],
            ));
        }
        if let Some(at) = reading.resets_at.as_deref() {
            hours_note.push(tf(
                "settings.plan.resetsOn",
                &[("date", f::short_date(at).into())],
            ));
        }
        let hours_meter = meter(
            hours_percent.map_or_else(|| "—".to_owned(), f::percent),
            cells(
                "plan-hours-meter",
                "settings.plan.hoursLabel",
                hours_percent,
                running,
                t,
            ),
            hours_reading,
            t.text.into(),
            t,
        )
        .id("plan-hours-left")
        .debug_selector(|| "plan-hours-left".into());

        // Storage: what the space keeps of what its plan and packs include.
        let storage_percent = f::percent_of(
            reading.used_bytes.map(|b| b as f64),
            reading.included_bytes.map(|b| b as f64),
        );
        let storage_reading = match (reading.used_bytes, reading.included_bytes) {
            (Some(used), Some(limit)) => format!("{}/{}", f::storage(used), f::storage(limit)),
            (Some(used), None) => f::storage(used),
            _ => "—".to_owned(),
        };
        let fill = f::fill(storage_percent);
        let storage_ink: Hsla = match fill {
            Fill::Calm => t.text.into(),
            Fill::Near => t.warning.into(),
            Fill::Full => t.danger.into(),
        };
        let storage_meter = meter(
            storage_percent.map_or_else(|| "—".to_owned(), f::percent),
            cells(
                "plan-storage-meter",
                "settings.plan.storageLabel",
                storage_percent,
                None,
                t,
            ),
            storage_reading,
            storage_ink,
            t,
        );
        let storage_note = (fill != Fill::Calm).then(|| {
            let note = SettingsNote::new(format!(
                "{}: {} · {}",
                tr("settings.plan.storageLabel"),
                tr(if fill == Fill::Full {
                    "native.plan.full"
                } else {
                    "native.plan.almostFull"
                }),
                tr(storage_hint)
            ));
            if fill == Fill::Full {
                note.danger()
            } else {
                note.warning()
            }
        });

        let name = plan_name(offer.id);
        v_flex()
            .gap(px(6.))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(row(
                        tr("settings.account.plan"),
                        h_flex()
                            .gap(px(8.))
                            .min_w_0()
                            .child(facts(Some(name), facts_list, t))
                            .children(actions),
                    ))
                    .children(notices)
                    .children(change)
                    .child(row(tr("settings.plan.hoursLabel"), hours_meter))
                    .child(row(tr("settings.plan.storageLabel"), storage_meter)),
            )
            .when(!hours_note.is_empty(), |d| {
                d.child(SettingsNote::new(format!(
                    "{}: {}",
                    tr("settings.plan.hoursLabel"),
                    hours_note.join(" · ")
                )))
            })
            .children(storage_note)
            .into_any_element()
    }

    /// The change scheduled for renewal, beside what keeps the plan held;
    /// keeping it is confirmed under the plan.
    fn scheduled_notice(
        &self,
        holding: &PlanHolding,
        keep: Option<AnyElement>,
        t: Theme,
    ) -> AnyElement {
        row(
            tr("settings.plan.scheduledLabel"),
            h_flex()
                .gap(px(8.))
                .child(
                    div()
                        .text_color(t.text)
                        .whitespace_nowrap()
                        .child(f::scheduled_change(holding)),
                )
                .children(keep),
        )
        .into_any_element()
    }

    /// The change under way as a group of rows, under what it changes: its
    /// people when it has them and the monthly total the server quoted
    /// (`$60 → $100 / month` when it replaces a price), then when it applies
    /// beside the two choices, confirm it as quoted or leave everything as
    /// it is. While a confirmed change is paid or settled, it waits there
    /// instead. `lead` is the row of the plan being chosen.
    #[allow(clippy::too_many_arguments)]
    fn confirmation(
        &self,
        lead: Option<AnyElement>,
        stepper: Option<AnyElement>,
        holding: &PlanHolding,
        plan: PlanId,
        held: Option<i64>,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let controller = &self.plan_page.controller;
        if controller.polling.is_some() {
            let paying = controller.checkout_url.is_some();
            let status = div()
                .id("plan-waiting")
                .debug_selector(|| "plan-waiting".into())
                .role(Role::Status)
                .child(
                    SettingRow::new("")
                        .label_element(
                            h_flex()
                                .gap(px(10.))
                                .child(Spinner::new("plan-waiting-spinner", t.divider, t.text))
                                .child(div().text_color(t.text).child(tr(if paying {
                                    "native.plan.waitingPayment"
                                } else {
                                    "native.plan.confirming"
                                }))),
                        )
                        .when(paying, |r| {
                            r.control(
                                Button::new("plan-reopen-checkout")
                                    .label(tr("native.plan.reopenPayment"))
                                    .trailing(Icon::new("external-link").small())
                                    .on_click(cx.listener(|s, _, _, cx| s.reopen_checkout(cx))),
                            )
                        }),
                )
                .test_support();
            return SettingsChange::new()
                .children(lead)
                .child(status)
                .when(paying, |d| {
                    d.child(
                        SettingRow::new("")
                            .label_element(change_note(tr("native.plan.waitingNote"))),
                    )
                })
                .into_any_element();
        }
        let seats = controller.seats;
        let quote = controller
            .quote
            .as_ref()
            .filter(|q| matches_target(q, plan, seats));
        let timing = f::quote_timing(quote, holding);
        let total = match quote {
            Some(quote) => div()
                .text_color(t.text)
                .font_weight(FontWeight::MEDIUM)
                .child(monthly_change(
                    held,
                    quote.target_amount_cents,
                    &quote.currency,
                )),
            None => div().text_color(t.subtle).child(if controller.acting {
                tr("native.plan.quoting").to_owned()
            } else {
                "—".to_owned()
            }),
        }
        .id("plan-quote-price")
        .debug_selector(|| "plan-quote-price".into());
        let note = match controller.error {
            Some(error) => change_note(tr(error)).text_color(t.danger),
            None => change_note(div().children(quote.is_some().then(|| timing.note.clone()))),
        };
        div()
            .id("plan-confirmation")
            .debug_selector(|| "plan-confirmation".into())
            .child(
                SettingsChange::new()
                    .children(lead)
                    .children(stepper.map(|stepper| row(tr("settings.plan.peopleLabel"), stepper)))
                    .child(row(tr("native.plan.monthlyTotal"), total))
                    .child(
                        SettingRow::new("").label_element(note).control(choices(
                            Button::new("plan-cancel-change")
                                .label(tr("settings.plan.cancel"))
                                .disabled(controller.acting)
                                .on_click(cx.listener(|s, _, _, cx| s.close_change(cx))),
                            Button::new("plan-confirm-quote")
                                .variant(ButtonVariant::OutlinePrimary)
                                .label(tr(timing.confirm))
                                .when(timing.opens_browser, |b| {
                                    b.trailing(Icon::new("external-link").small())
                                })
                                .disabled(controller.acting || quote.is_none())
                                .on_click(cx.listener(|s, _, _, cx| s.confirm_quote(cx))),
                        )),
                    ),
            )
            .into_any_element()
    }

    /// Every plan but the one held, each saying what it adds: upgrades
    /// first, Free last. Without a holding (signed out, or unread) all
    /// three are listed.
    fn plan_rows(
        &self,
        view: &CatalogView,
        holding: &PlanHolding,
        reader: Reader,
        sellable: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let connected = matches!(reader, Reader::Owner | Reader::Member);
        let current = holding.plan().filter(|_| connected);
        let plans = listed(view, current);
        let title = match (connected, holding.subscribed) {
            (false, _) => "settings.plan.chooseTitle",
            (true, false) => "settings.plan.upgrade",
            (true, true) => "native.plan.otherPlans",
        };
        let controller = &self.plan_page.controller;
        let portal = self
            .plan_page
            .snapshot
            .summary
            .as_ref()
            .is_some_and(|s| s.portal_available);
        // While a change is paid or settled nothing else is offered.
        let paying = controller.polling.is_some();
        let busy = controller.acting || self.plan_page.snapshot.loading;
        let held = held_monthly(view, holding);
        // The paid plans someone on Free can move to stand side by side as
        // tiles, the way Appearance offers its themes; anything else is a
        // row.
        let tiled: Vec<PlanId> = if holding.subscribed {
            vec![]
        } else {
            plans
                .iter()
                .filter(|p| p.id != PlanId::Free)
                .map(|p| p.id)
                .collect()
        };
        let tiled = if tiled.len() == 2 { tiled } else { vec![] };
        let mut tiles: Vec<AnyElement> = vec![];
        let mut chosen_tile = None;
        let mut rows: Vec<AnyElement> = vec![];
        for plan in plans {
            let open = controller.target == Some(Target::Plan(plan.id));
            let offer = match reader {
                Reader::SignedOut => Offer::SignIn,
                Reader::Unread | Reader::Member => Offer::Nothing,
                Reader::Owner if open || paying => Offer::Nothing,
                // Leaving a paid plan is a cancellation, which lives with
                // invoices at the payment provider.
                Reader::Owner if plan.id == PlanId::Free => Offer::MoveToFree,
                Reader::Owner if !(sellable && plan.purchasable && plan.catalog_plan.is_some()) => {
                    Offer::ComingSoon
                }
                Reader::Owner => Offer::Choose {
                    upgrade: current.is_none_or(|c| rank(plan.id) > rank(c)),
                },
            };
            if tiled.contains(&plan.id) {
                let first = tiles.is_empty();
                tiles.push(self.plan_tile(plan, offer, open, first, busy, t, cx));
                if open {
                    chosen_tile = Some(plan);
                }
                continue;
            }
            let price = if plan.per_person {
                tf(
                    "native.plan.perPersonMonthly",
                    &[(
                        "amount",
                        f::currency_amount(plan.price_cents, &plan.currency).into(),
                    )],
                )
            } else {
                f::currency_amount(plan.price_cents, &plan.currency)
            };
            let action: Option<AnyElement> = match offer {
                Offer::SignIn => Some(self.sign_in_to_choose(plan.id, cx).into_any_element()),
                Offer::Nothing => None,
                Offer::MoveToFree => Some(
                    Button::new("plan-move-to-free")
                        .variant(ButtonVariant::Ghost)
                        .label(tr("settings.plan.moveToFree"))
                        .trailing(Icon::new("external-link").small())
                        .disabled(busy || !portal)
                        .on_click(cx.listener(|s, _, _, cx| s.open_portal(cx)))
                        .into_any_element(),
                ),
                Offer::ComingSoon => Some(
                    div()
                        .text_color(t.subtle)
                        .child(tr("settings.plan.comingSoon"))
                        .into_any_element(),
                ),
                Offer::Choose { upgrade } => {
                    let id = plan.id;
                    Some(
                        Button::new(SharedString::from(format!("plan-choose-{}", id.key())))
                            .label(tr(if upgrade {
                                "settings.plan.upgrade"
                            } else {
                                "settings.plan.switch"
                            }))
                            .disabled(busy)
                            .on_click(cx.listener(move |s, _, _, cx| s.choose_plan(id, cx)))
                            .into_any_element(),
                    )
                }
            };
            let row = div()
                .id(SharedString::from(format!("plan-row-{}", plan.id.key())))
                .role(Role::Group)
                .aria_label(plan_name(plan.id))
                .child(described(
                    plan_name(plan.id),
                    gains(plan),
                    h_flex()
                        .gap(px(8.))
                        .child(div().text_color(t.subtle).whitespace_nowrap().child(price))
                        .children(action),
                ))
                .test_support()
                .into_any_element();
            rows.push(if open {
                let stepper = plan.per_person.then(|| {
                    self.people_stepper(plan.minimum_seats.max(1), cx)
                        .into_any_element()
                });
                self.confirmation(Some(row), stepper, holding, plan.id, held, t, cx)
            } else {
                row
            });
        }
        // A chosen tile is confirmed under the tiles, as a row's change is
        // under its row.
        let chosen = chosen_tile.map(|plan| {
            let stepper = plan.per_person.then(|| {
                self.people_stepper(plan.minimum_seats.max(1), cx)
                    .into_any_element()
            });
            div()
                .mt(px(8.))
                .child(self.confirmation(None, stepper, holding, plan.id, held, t, cx))
        });
        SettingsSubsection::new()
            .title(tr(title))
            .when(!tiles.is_empty(), |d| {
                d.child(
                    h_flex()
                        .items_stretch()
                        .gap(px(12.))
                        .px(px(10.))
                        .pt(px(4.))
                        .children(tiles),
                )
            })
            .children(chosen)
            .children(rows)
            .into_any_element()
    }

    /// `Sign in to choose`: buying needs an account, and Account owns
    /// sign-in.
    fn sign_in_to_choose(&self, id: PlanId, cx: &mut Context<Self>) -> Button {
        Button::new(SharedString::from(format!("plan-sign-in-{}", id.key())))
            .label(tr("settings.plan.signInToChoose"))
            .on_click(cx.listener(|s, _, _, cx| {
                s.select_page(crate::features::settings::Page::Account, cx)
            }))
    }

    /// One paid plan as a tile, drawn as Appearance draws a theme choice
    /// (radius 8, the subtle border on the raised panel, and when chosen
    /// the accent border with its 26% ring): its name and price, what it
    /// gives, and the way to it at the foot. The first tile's way is the
    /// accented one.
    #[allow(clippy::too_many_arguments)]
    fn plan_tile(
        &self,
        plan: &PlanOffer,
        offer: Offer,
        open: bool,
        first: bool,
        busy: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ui = theme::ty().ui;
        let foot: AnyElement = match offer {
            Offer::SignIn => self
                .sign_in_to_choose(plan.id, cx)
                .w_full()
                .into_any_element(),
            Offer::ComingSoon => div()
                .h(px(theme::control_compact()))
                .flex()
                .items_center()
                .justify_center()
                .text_color(t.subtle)
                .child(tr("settings.plan.comingSoon"))
                .into_any_element(),
            Offer::Choose { upgrade } => {
                let id = plan.id;
                Button::new(SharedString::from(format!("plan-choose-{}", id.key())))
                    .when(first, |b| b.variant(ButtonVariant::OutlinePrimary))
                    .label(if upgrade {
                        tf("native.plan.upgradeTo", &[("plan", plan_name(id).into())])
                    } else {
                        tr("settings.plan.switch").to_owned()
                    })
                    .disabled(busy)
                    .on_click(cx.listener(move |s, _, _, cx| s.choose_plan(id, cx)))
                    .w_full()
                    .into_any_element()
            }
            // Chosen, paid for, or not the reader's to buy: the foot keeps
            // its height so the tiles stay level.
            Offer::Nothing | Offer::MoveToFree => {
                div().h(px(theme::control_compact())).into_any_element()
            }
        };
        let hover_border = theme::mix(t.accent, t.border, 0.42);
        let hover_bg = theme::mix(t.selected, t.panel, 0.72);
        v_flex()
            .id(SharedString::from(format!("plan-row-{}", plan.id.key())))
            .role(Role::Group)
            .aria_label(plan_name(plan.id))
            .relative()
            .flex_1()
            .min_w_0()
            .gap(px(14.))
            .p(px(16.))
            .border_1()
            .rounded(px(8.))
            .map(|d| {
                if open {
                    d.border_color(hover_border).bg(hover_bg).child(
                        div()
                            .absolute()
                            .top(px(-2.))
                            .left(px(-2.))
                            .right(px(-2.))
                            .bottom(px(-2.))
                            .rounded(px(9.))
                            .border_1()
                            .border_color(theme::alpha(t.accent, 0.26)),
                    )
                } else {
                    d.border_color(t.border_subtle)
                        .bg(theme::alpha(t.panel_raised, 0.82))
                }
            })
            .child(
                v_flex()
                    .child(
                        div()
                            .text_color(t.text)
                            .font_weight(FontWeight::MEDIUM)
                            .child(plan_name(plan.id)),
                    )
                    .child(
                        h_flex()
                            .items_end()
                            .gap(px(6.))
                            .child(
                                div()
                                    .text_size(px(ui.page_title))
                                    .line_height(px(ui.page_title * 1.4))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.text)
                                    .child(f::currency_amount(plan.price_cents, &plan.currency)),
                            )
                            .child(div().pb(px(4.)).text_color(t.subtle).child(tr(
                                if plan.per_person {
                                    "native.plan.perPersonUnit"
                                } else {
                                    "native.plan.perMonthUnit"
                                },
                            ))),
                    ),
            )
            .child(
                v_flex()
                    .gap(px(6.))
                    .children(gain_list(plan).into_iter().map(|gain| {
                        h_flex()
                            .items_start()
                            .gap(px(8.))
                            .text_color(t.muted)
                            .child(
                                div().pt(px(2.)).child(
                                    Icon::new("check")
                                        .with_size(px(14.))
                                        .stroke(2.)
                                        .color(t.subtle),
                                ),
                            )
                            .child(div().min_w_0().child(gain))
                    })),
            )
            .child(div().flex_1())
            .child(foot)
            .test_support()
            .into_any_element()
    }

    /// Extra hours and storage as monthly packs on a paid plan: one row
    /// each, a new quantity priced and confirmed under its row.
    fn add_ons(
        &self,
        offers: &[AddOnOffer],
        holding: &PlanHolding,
        sellable: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if offers.is_empty() {
            return None;
        }
        let mut offers: Vec<&AddOnOffer> = offers.iter().collect();
        offers.sort_by_key(|o| o.kind == AddOnKind::Storage);
        let state = &self.plan_page.controller.add_on;
        let draft = state.draft.clone();
        let mut rows: Vec<AnyElement> = vec![];
        for offer in offers {
            let kind = match offer.kind {
                AddOnKind::Hours => "hours",
                AddOnKind::Storage => "storage",
            };
            let held = holding.add_ons.get(&offer.id).copied().unwrap_or(0);
            let shown = match &draft {
                Some((id, quantity)) if id == &offer.id => *quantity,
                _ => held,
            };
            let id = offer.id.clone();
            let entity = cx.entity();
            let (fewer, more) = stepper_labels(tr(&format!("settings.plan.addOn.{kind}")));
            let pack = row(
                tr(&format!("settings.plan.addOn.{kind}")),
                h_flex()
                    .gap(px(8.))
                    .child(div().text_color(t.subtle).whitespace_nowrap().child(tf(
                        &format!("settings.plan.addOn.{kind}Detail"),
                        &[
                            ("hours", f::hours(offer.hours).into()),
                            ("amount", f::storage(offer.storage_bytes).into()),
                            (
                                "price",
                                f::money(Some(offer.price_cents), &offer.currency).into(),
                            ),
                        ],
                    )))
                    .child(
                        Stepper::new(format!("plan-add-on-{}", offer.id), shown)
                            .range(0, offer.max_quantity.max(0) as u64)
                            .labels(fewer, more)
                            .disabled(
                                state.pending
                                    || !sellable
                                    || draft.as_ref().is_some_and(|(d, _)| d != &offer.id),
                            )
                            .on_change(move |quantity, _, cx| {
                                let id = id.clone();
                                entity.update(cx, |s, cx| s.draft_add_on(id, quantity, held, cx))
                            }),
                    ),
            );
            let Some(quantity) = draft
                .as_ref()
                .filter(|(id, _)| id == &offer.id)
                .map(|(_, quantity)| *quantity)
            else {
                rows.push(pack.into_any_element());
                continue;
            };
            // A new quantity is priced under its row, as a plan's change
            // is: the pack's monthly total, then when it applies.
            let price = |count: u64| count as i64 * offer.price_cents;
            let when = if held == 0 {
                "settings.plan.quoteNote"
            } else if quantity > held {
                "native.plan.chargedNow"
            } else {
                "native.plan.addOnNext"
            };
            rows.push(
                SettingsChange::new()
                    .child(pack)
                    .child(row(
                        tr("native.plan.monthlyTotal"),
                        div()
                            .text_color(t.text)
                            .font_weight(FontWeight::MEDIUM)
                            .child(monthly_change(
                                (held > 0).then(|| price(held)),
                                price(quantity),
                                &offer.currency,
                            )),
                    ))
                    .child(
                        SettingRow::new("")
                            .label_element(change_note(tr(when)))
                            .control(choices(
                                Button::new("plan-add-on-cancel")
                                    .label(tr("settings.plan.cancel"))
                                    .disabled(state.pending)
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        s.plan_page.controller.add_on.draft = None;
                                        cx.notify();
                                    })),
                                Button::new("plan-add-on-confirm")
                                    .variant(ButtonVariant::OutlinePrimary)
                                    .label(tr(if held == 0 {
                                        "settings.plan.confirmAndPay"
                                    } else {
                                        "settings.plan.confirm"
                                    }))
                                    .when(held == 0, |b| {
                                        b.trailing(Icon::new("external-link").small())
                                    })
                                    .disabled(state.pending)
                                    .on_click(cx.listener(|s, _, _, cx| s.confirm_add_on(cx))),
                            )),
                    )
                    .into_any_element(),
            );
        }
        Some(
            v_flex()
                .gap(px(6.))
                .child(
                    SettingsSubsection::new()
                        .title(tr("settings.plan.addOnsTitle"))
                        .children(rows),
                )
                .children(state.message.map(|(message, error)| {
                    let note = SettingsNote::new(tr(message));
                    if error { note.danger() } else { note }
                }))
                .into_any_element(),
        )
    }

    /// The people a change is for, from the plan's fewest to 500.
    fn people_stepper(&self, minimum: u64, cx: &mut Context<Self>) -> Stepper {
        let controller = &self.plan_page.controller;
        let entity = cx.entity();
        let (fewer, more) = stepper_labels(tr("settings.plan.peopleLabel"));
        Stepper::new("plan-seats", controller.seats)
            .range(minimum, 500)
            .labels(fewer, more)
            .disabled(controller.polling.is_some())
            .on_change(move |seats, _, cx| entity.update(cx, |s, cx| s.set_plan_seats(seats, cx)))
    }
}

/// A stepper's accessible names: "Fewer: People", "More: People".
fn stepper_labels(label: &str) -> (String, String) {
    let label = || [("label", label.to_owned().into())];
    (
        tf("settings.plan.decrease", &label()),
        tf("settings.plan.increase", &label()),
    )
}

fn rank(id: PlanId) -> usize {
    PLAN_ORDER.iter().position(|p| *p == id).unwrap_or(0)
}
/// The plans offered besides the one held: upgrades first, Free last.
/// Without a holding all of them, in the catalog's order.
fn listed(view: &CatalogView, current: Option<PlanId>) -> Vec<&PlanOffer> {
    let mut plans: Vec<&PlanOffer> = view
        .plans
        .iter()
        .filter(|p| Some(p.id) != current)
        .collect();
    if current.is_some() {
        plans.sort_by_key(|p| (p.id == PlanId::Free, rank(p.id)));
    }
    plans
}

/// Whether a quote prices this plan for these people.
fn matches_target(quote: &Quote, plan: PlanId, seats: u64) -> bool {
    f::plan_key(&quote.target_plan_id) == plan.key() && quote.target_seats == seats
}

/// What a plan adds, in one line: Free and Team by their allowance,
/// Enterprise as Team plus what differs from it.
/// What a listed plan offers its reader.
#[derive(Clone, Copy)]
enum Offer {
    SignIn,
    Nothing,
    MoveToFree,
    ComingSoon,
    Choose { upgrade: bool },
}

/// What a paid plan gives, one line each, for its tile: Team by its
/// allowance, Enterprise by what it adds to Team.
fn gain_list(plan: &PlanOffer) -> Vec<String> {
    let storage = plan
        .storage_bytes
        .map_or_else(|| tr("settings.plan.spec.unlimited").to_owned(), f::storage);
    let storage = tf(
        "native.plan.gain.storagePerPerson",
        &[("storage", storage.into())],
    );
    match plan.id {
        PlanId::Free => vec![gains(plan)],
        PlanId::Team => vec![
            tf(
                "settings.plan.hoursPerPerson",
                &[("hours", f::hours(plan.agent_hours).into())],
            ),
            storage,
            tf(
                "native.plan.gain.projectsEach",
                &[(
                    "projects",
                    Arg::Number(plan.projects.map_or(0, |n| n as i64)),
                )],
            ),
            tr("native.plan.gain.membersAndRoles").to_owned(),
        ],
        PlanId::Enterprise => vec![
            tf(
                "native.plan.gain.everythingIn",
                &[("plan", plan_name(PlanId::Team).into())],
            ),
            storage,
            tf(
                "native.plan.gain.history",
                &[("history", f::history(plan.history_days).into())],
            ),
            tr("native.plan.gain.activityLog").to_owned(),
        ],
    }
}

fn gains(plan: &PlanOffer) -> String {
    let storage = plan
        .storage_bytes
        .map_or_else(|| tr("settings.plan.spec.unlimited").to_owned(), f::storage);
    let projects = plan.projects.map_or(0, |n| n as i64);
    match plan.id {
        PlanId::Free => tf(
            "native.plan.gains.free",
            &[
                ("hours", f::hours(plan.agent_hours).into()),
                ("storage", storage.into()),
                ("projects", Arg::Number(projects)),
            ],
        ),
        PlanId::Team => tf(
            "native.plan.gains.team",
            &[
                ("hours", f::hours(plan.agent_hours).into()),
                ("storage", storage.into()),
                ("projects", Arg::Number(projects)),
            ],
        ),
        PlanId::Enterprise => tf(
            "native.plan.gains.enterprise",
            &[
                ("storage", storage.into()),
                ("history", f::history(plan.history_days).into()),
            ],
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn other_plans_list_upgrades_first_and_free_last() {
        let view = pricing::resolve_catalog(None);
        let ids = |current| {
            listed(&view, current)
                .iter()
                .map(|p| p.id)
                .collect::<Vec<_>>()
        };
        use PlanId::{Enterprise, Free, Team};
        assert_eq!(ids(None), [Free, Team, Enterprise]);
        assert_eq!(ids(Some(Free)), [Team, Enterprise]);
        assert_eq!(ids(Some(Team)), [Enterprise, Free]);
        assert_eq!(ids(Some(Enterprise)), [Team, Free]);
    }

    #[test]
    fn each_plan_says_what_it_adds_and_enterprise_only_its_difference() {
        crate::localization::set_current("en");
        let view = pricing::resolve_catalog(None);
        let said = |id| gains(view.plan(id).unwrap());
        assert_eq!(said(PlanId::Free), "5 h a month, 1 GB, 1 project online");
        assert_eq!(
            said(PlanId::Team),
            "40 h and 10 GB per person, 20 projects each, members and roles"
        );
        assert_eq!(
            said(PlanId::Enterprise),
            "Everything in Team, plus 20 GB per person, 1 year of history and an activity log"
        );
    }
}

#[cfg(test)]
#[path = "tests/acceptance.rs"]
mod acceptance_tests;
