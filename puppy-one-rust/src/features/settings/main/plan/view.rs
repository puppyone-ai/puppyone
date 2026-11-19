//! Settings › Plan as redesigned on 2026-11-19 (puppy-issues
//! `document/puppyone-desktop/cloud/billing.md`, "Plan page"). The page
//! answers, in order: what
//! the space is on and how much of it is used (one card, two forty-cell
//! meters with machine-set readings), what the add-ons held are, and what
//! each other plan would add. A change is confirmed where it was asked for:
//! in the chosen plan's row, or in the card for people and a kept plan.
//! Two type sizes: the interface label for everything, the page title for
//! the plan's name.
use super::super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::Target;
use super::format::{self as f, Fill};
use crate::localization::{Arg, format_number, t as tr, tf};
use crate::theme::{self, Theme};
use crate::ui::components::{Button, ButtonVariant, Icon, IconButton, SettingsSection, Spinner};
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

/// A note in the page's subtle ink.
fn note(text: impl Into<SharedString>, t: Theme) -> Div {
    div().text_color(t.subtle).child(text.into())
}
fn error_note(text: impl Into<SharedString>, t: Theme) -> Div {
    div().text_color(t.danger).child(text.into())
}
/// Numbers a machine set: readings, prices quoted.
fn mono(text: impl Into<SharedString>) -> Div {
    div().font_family(theme::MONO).child(text.into())
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
/// The bordered surface every block of the page sits on.
fn card(t: Theme) -> Div {
    v_flex()
        .border_1()
        .border_color(t.divider)
        .rounded(px(theme::metric::CARD_RADIUS))
        .bg(theme::fade(t.text, 0.015))
        .overflow_hidden()
}
/// A block's name above it, as Settings titles a list: meta size, medium,
/// subtle.
fn section_label(text: impl Into<SharedString>, t: Theme) -> Div {
    let meta = theme::ty().ui.meta;
    div()
        .mt(px(28.))
        .mb(px(8.))
        .text_size(px(meta))
        .line_height(px(18.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.subtle)
        .child(text.into())
}
/// One line inside a card, under a hairline.
fn card_row(t: Theme) -> Div {
    h_flex()
        .gap(px(16.))
        .px(px(20.))
        .py(px(14.))
        .border_t_1()
        .border_color(t.divider)
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

/// A meter with its name and reading above, and what the reading means
/// below.
fn meter(
    label: &'static str,
    reading: String,
    cells: AnyElement,
    left: AnyElement,
    right: Option<String>,
    t: Theme,
) -> Div {
    v_flex()
        .flex_1()
        .min_w_0()
        .child(
            h_flex()
                .justify_between()
                .gap(px(8.))
                .child(div().text_color(t.text).child(tr(label)))
                .child(mono(reading).text_color(t.text)),
        )
        .child(div().mt(px(10.)).child(cells))
        .child(
            h_flex()
                .flex_wrap()
                .mt(px(8.))
                .gap_x(px(8.))
                .text_color(t.subtle)
                .child(left)
                .children(right.map(|r| div().ml_auto().child(r))),
        )
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
        if let Some(space) = &space {
            section = section.lede(self.scope_lede(space, None, t, cx));
        }
        if signed_in && space.is_none() {
            section = section.child(note(tr("settings.space.choose"), t).px(px(10.)));
        }
        let waiting = signed_in && space.is_some();
        let ui = theme::ty().ui;
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
                .when(waiting, |d| {
                    d.child(
                        div()
                            .id("plan-load-error")
                            .role(Role::Alert)
                            .aria_label(tr("cloud.billing.loadFailed"))
                            .child(
                                card(t).child(
                                    h_flex()
                                        .justify_between()
                                        .gap(px(16.))
                                        .p(px(20.))
                                        .child(
                                            div()
                                                .text_color(t.muted)
                                                .child(tr("cloud.billing.loadFailed")),
                                        )
                                        .child(
                                            Button::new("plan-load-retry")
                                                .label(tr("common.action.retry"))
                                                .on_click(
                                                    cx.listener(|s, _, _, cx| s.refresh_plan(cx)),
                                                ),
                                        ),
                                ),
                            )
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
                .child(note(tr("settings.plan.finePrint"), t).mt(px(24.)))
                .into_any_element()
        };
        section
            .child(
                div()
                    .mx(px(10.))
                    .text_size(px(ui.label))
                    .line_height(px(ui.label * 1.5))
                    .child(body),
            )
            .into_any_element()
    }

    /// The signed-in page keeps its reading order while its first snapshot
    /// loads: the card with dark meters, then the plans.
    fn plan_loading(&self, t: Theme) -> AnyElement {
        let ui = theme::ty().ui;
        let empty = |id, label| {
            meter(
                label,
                String::new(),
                cells(id, label, None, None, t),
                placeholder("plan-loading-reading", 72., ui.label * 1.5),
                None,
                t,
            )
        };
        let row = |id: &'static str| {
            card_row(t).child(
                v_flex()
                    .gap(px(4.))
                    .child(placeholder(id, 120., ui.label * 1.5))
                    .child(placeholder("plan-loading-gains", 300., ui.label * 1.5)),
            )
        };
        v_flex()
            .id("plan-loading")
            .role(Role::Status)
            .aria_label(tr("common.status.loading"))
            .debug_selector(|| "plan-loading".into())
            .child(
                card(t).p(px(20.)).child(
                    v_flex()
                        .gap(px(4.))
                        .child(placeholder("plan-loading-plan", 96., ui.page_title * 1.4))
                        .child(placeholder("plan-loading-detail", 168., ui.label * 1.5))
                        .child(
                            h_flex()
                                .mt(px(18.))
                                .gap(px(32.))
                                .child(empty("plan-hours-meter", "settings.plan.hoursLabel"))
                                .child(empty("plan-storage-meter", "settings.plan.storageLabel")),
                        ),
                ),
            )
            .child(section_label(tr("settings.plan.chooseTitle"), t))
            .child(
                card(t)
                    .child(row("plan-loading-row-0").border_t_0())
                    .child(row("plan-loading-row-1")),
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
            notices.push(self.scheduled_notice(&holding, current.id, keep, t, cx));
        }
        if controller.target == Some(Target::People) {
            let stepper = self.stepper(
                "plan-seats".into(),
                tr("settings.plan.peopleLabel").into(),
                controller.seats,
                1,
                500,
                controller.polling.is_some(),
                Some(tf(
                    "settings.plan.peopleUnit",
                    &[("count", Arg::Number(controller.seats as i64))],
                )),
                |s, value, cx| s.set_plan_seats(value, cx),
                t,
                cx,
            );
            notices.push(self.confirmation(
                Some(stepper.into_any_element()),
                &holding,
                current.id,
                t,
                cx,
            ));
        } else if controller.polling.is_some()
            && !matches!(controller.target, Some(Target::Plan(_) | Target::Keep))
        {
            // A change resumed from an earlier visit, or one just confirmed.
            notices.push(
                h_flex()
                    .gap(px(10.))
                    .text_color(t.muted)
                    .child(Spinner::new("plan-confirming", t.divider, t.text))
                    .child(tr("native.plan.confirming"))
                    .into_any_element(),
            );
        }
        if snapshot.can_manage_billing == Some(false) {
            notices.push(
                div()
                    .text_color(t.muted)
                    .child(tr("settings.plan.space.managedByOwner"))
                    .into_any_element(),
            );
        }

        let summary_card = self.current_plan(
            &current,
            &holding,
            view.authoritative && !snapshot.catalog_unavailable,
            &view.add_ons,
            actions,
            notices,
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
            .child(summary_card)
            .children(loose_error.map(|e| error_note(tr(e), t).mt(px(12.))))
            .when(snapshot.error, |d| {
                d.child(
                    h_flex()
                        .mt(px(12.))
                        .justify_between()
                        .gap(px(16.))
                        .child(note(tr("cloud.billing.loadFailed"), t))
                        .child(
                            Button::new("plan-retry")
                                .label(tr("common.action.retry"))
                                .disabled(busy)
                                .on_click(cx.listener(|s, _, _, cx| s.refresh_plan(cx))),
                        ),
                )
            })
            .children(self.add_ons(&add_ons, &holding, sellable, t, cx))
            .child(self.plan_rows(
                &view,
                &holding,
                if owner { Reader::Owner } else { Reader::Member },
                sellable,
                t,
                cx,
            ))
            .child(note(tr("settings.plan.finePrint"), t).mt(px(24.)))
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
        storage_hint: &'static str,
        t: Theme,
    ) -> AnyElement {
        let usage = self.plan_page.snapshot.usage.as_ref();
        let reading = pricing::resolve_allowance(usage, offer, holding, add_ons);
        let hours = pricing::resolve_agent_hours(usage);
        let status = f::status(holding);
        let mut facts = vec![];
        if matches!(status, f::Status::Attention | f::Status::Updating) {
            facts.push(tr(&format!("settings.plan.status.{}", status.key())).to_owned());
        }
        if holding.subscribed {
            if offer.per_person {
                facts.push(tf(
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
                facts.push(tf(
                    "settings.plan.monthlyFor",
                    &[(
                        "amount",
                        f::currency_amount(monthly, &holding.currency).into(),
                    )],
                ));
            }
            if let Some(renews) = &holding.renews_at {
                facts.push(tf(
                    if holding.cancel_at_period_end {
                        "settings.plan.endsOn"
                    } else {
                        "settings.plan.renewsOn"
                    },
                    &[("date", f::short_date(renews).into())],
                ));
            }
        } else {
            facts.push(tf(
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
        let mut hours_left = vec![hours_percent.map_or_else(|| "—".to_owned(), f::percent)];
        if let Some(reserved) = hours.reserved.filter(|h| *h > 0.) {
            hours_left.push(tf(
                "settings.plan.hoursReserved",
                &[("hours", f::hours(reserved).into())],
            ));
        }
        let resets = reading.resets_at.as_deref().map(|at| {
            tf(
                "settings.plan.resetsOn",
                &[("date", f::short_date(at).into())],
            )
        });
        let hours_meter = meter(
            "settings.plan.hoursLabel",
            hours_reading,
            cells(
                "plan-hours-meter",
                "settings.plan.hoursLabel",
                hours_percent,
                running,
                t,
            ),
            mono(hours_left.join(" · "))
                .id("plan-hours-left")
                .debug_selector(|| "plan-hours-left".into())
                .into_any_element(),
            resets,
            t,
        );

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
        let storage_left = {
            let percent = storage_percent.map_or_else(|| "—".to_owned(), f::percent);
            let (text, ink) = match fill {
                Fill::Calm => (percent, t.subtle),
                Fill::Near => (
                    format!("{percent} · {}", tr("native.plan.almostFull")),
                    t.warning,
                ),
                Fill::Full => (format!("{percent} · {}", tr("native.plan.full")), t.danger),
            };
            mono(text).text_color(ink).into_any_element()
        };
        let storage_meter = meter(
            "settings.plan.storageLabel",
            storage_reading,
            cells(
                "plan-storage-meter",
                "settings.plan.storageLabel",
                storage_percent,
                None,
                t,
            ),
            storage_left,
            (fill != Fill::Calm).then(|| tr(storage_hint).to_owned()),
            t,
        );

        card(t)
            .p(px(20.))
            .child(
                h_flex()
                    .items_start()
                    .gap(px(16.))
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .text_color(t.text)
                                    .text_size(px(theme::ty().ui.page_title))
                                    .line_height(px(theme::ty().ui.page_title * 1.4))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(plan_name(offer.id)),
                            )
                            .child(div().text_color(t.muted).child(facts.join(" · "))),
                    )
                    .when(!actions.is_empty(), |d| {
                        d.child(h_flex().flex_none().gap(px(8.)).children(actions))
                    }),
            )
            .child(
                h_flex()
                    .items_start()
                    .mt(px(22.))
                    .gap(px(32.))
                    .child(hours_meter)
                    .child(storage_meter),
            )
            .children(notices.into_iter().map(|notice| {
                div()
                    .mt(px(18.))
                    .pt(px(16.))
                    .border_t_1()
                    .border_color(t.divider)
                    .child(notice)
            }))
            .into_any_element()
    }

    /// The change scheduled for renewal, beside what keeps the plan held,
    /// and that keeping's confirmation once it is asked for.
    fn scheduled_notice(
        &self,
        holding: &PlanHolding,
        current: PlanId,
        keep: Option<AnyElement>,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        v_flex()
            .child(
                h_flex()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_none()
                            .text_color(t.muted)
                            .child(tr("settings.plan.scheduledLabel")),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_color(t.text)
                            .child(f::scheduled_change(holding)),
                    )
                    .children(keep),
            )
            .when(
                self.plan_page.controller.target == Some(Target::Keep),
                |d| {
                    d.child(
                        div()
                            .mt(px(14.))
                            .child(self.confirmation(None, holding, current, t, cx)),
                    )
                },
            )
            .into_any_element()
    }

    /// The quote for the change under way, said once, and the two choices:
    /// confirm it as the server priced it, or leave everything as it is.
    /// While a confirmed change is paid or settled, it waits instead.
    fn confirmation(
        &self,
        stepper: Option<AnyElement>,
        holding: &PlanHolding,
        plan: PlanId,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let controller = &self.plan_page.controller;
        if controller.polling.is_some() {
            let paying = controller.checkout_url.is_some();
            return v_flex()
                .id("plan-waiting")
                .debug_selector(|| "plan-waiting".into())
                .role(Role::Status)
                .child(
                    h_flex()
                        .gap(px(10.))
                        .child(Spinner::new("plan-waiting-spinner", t.divider, t.text))
                        .child(
                            div()
                                .text_color(t.text)
                                .font_weight(FontWeight::MEDIUM)
                                .child(tr(if paying {
                                    "native.plan.waitingPayment"
                                } else {
                                    "native.plan.confirming"
                                })),
                        ),
                )
                .when(paying, |d| {
                    d.child(
                        div()
                            .mt(px(10.))
                            .text_color(t.muted)
                            .child(tr("native.plan.waitingNote")),
                    )
                    .child(
                        h_flex().mt(px(14.)).justify_end().child(
                            Button::new("plan-reopen-checkout")
                                .label(tr("native.plan.reopenPayment"))
                                .trailing(Icon::new("external-link").small())
                                .on_click(cx.listener(|s, _, _, cx| s.reopen_checkout(cx))),
                        ),
                    )
                })
                .test_support()
                .into_any_element();
        }
        let seats = controller.seats;
        let quote = controller
            .quote
            .as_ref()
            .filter(|q| matches_target(q, plan, seats));
        let timing = f::quote_timing(quote, holding);
        let price = match quote {
            Some(quote) => tf(
                "settings.plan.monthlyFor",
                &[(
                    "amount",
                    f::money(Some(quote.target_amount_cents), &quote.currency).into(),
                )],
            ),
            None if controller.acting => tr("native.plan.quoting").to_owned(),
            None => "—".to_owned(),
        };
        v_flex()
            .id("plan-confirmation")
            .debug_selector(|| "plan-confirmation".into())
            .gap(px(12.))
            .children(stepper.map(|stepper| {
                h_flex()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .text_color(t.muted)
                            .child(tr("settings.plan.peopleLabel")),
                    )
                    .child(stepper)
            }))
            .child(
                h_flex()
                    .justify_between()
                    .gap(px(12.))
                    .child(div().text_color(t.muted).child(tf(
                        "settings.plan.quotePlan",
                        &[
                            ("plan", plan_name(plan).into()),
                            ("count", Arg::Number(seats as i64)),
                        ],
                    )))
                    .child(
                        mono(price)
                            .id("plan-quote-price")
                            .debug_selector(|| "plan-quote-price".into())
                            .text_color(t.text),
                    ),
            )
            .when(quote.is_some(), |d| {
                d.child(div().text_color(t.muted).child(timing.note.clone()))
            })
            .children(
                controller
                    .error
                    .map(|e| error_note(tr(e), t).into_any_element()),
            )
            .child(
                h_flex()
                    .mt(px(4.))
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        Button::new("plan-cancel-change")
                            .label(tr("settings.plan.cancel"))
                            .disabled(controller.acting)
                            .on_click(cx.listener(|s, _, _, cx| s.close_change(cx))),
                    )
                    .child(
                        Button::new("plan-confirm-quote")
                            .variant(ButtonVariant::Solid)
                            .label(tr(timing.confirm))
                            .when(timing.opens_browser, |b| {
                                b.trailing(Icon::new("external-link").small())
                            })
                            .disabled(controller.acting || quote.is_none())
                            .on_click(cx.listener(|s, _, _, cx| s.confirm_quote(cx))),
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
        let mut list = card(t);
        for (index, plan) in plans.into_iter().enumerate() {
            let open = controller.target == Some(Target::Plan(plan.id));
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
            let action: Option<AnyElement> = match reader {
                Reader::SignedOut => Some(
                    Button::new(SharedString::from(format!(
                        "plan-sign-in-{}",
                        plan.id.key()
                    )))
                    .label(tr("settings.plan.signInToChoose"))
                    .on_click(cx.listener(|s, _, _, cx| {
                        // Buying needs an account; Account owns sign-in.
                        s.select_page(crate::features::settings::Page::Account, cx)
                    }))
                    .into_any_element(),
                ),
                Reader::Unread | Reader::Member => None,
                Reader::Owner if open || paying => None,
                // Leaving a paid plan is a cancellation, which lives with
                // invoices at the payment provider.
                Reader::Owner if plan.id == PlanId::Free => Some(
                    Button::new("plan-move-to-free")
                        .variant(ButtonVariant::Ghost)
                        .label(tr("settings.plan.moveToFree"))
                        .trailing(Icon::new("external-link").small())
                        .disabled(busy || !portal)
                        .on_click(cx.listener(|s, _, _, cx| s.open_portal(cx)))
                        .into_any_element(),
                ),
                Reader::Owner if !(sellable && plan.purchasable && plan.catalog_plan.is_some()) => {
                    Some(
                        div()
                            .text_color(t.subtle)
                            .child(tr("settings.plan.comingSoon"))
                            .into_any_element(),
                    )
                }
                Reader::Owner => {
                    let id = plan.id;
                    let upgrade = current.is_none_or(|c| rank(id) > rank(c));
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
            let row = h_flex()
                .id(SharedString::from(format!("plan-row-{}", plan.id.key())))
                .role(Role::Group)
                .aria_label(plan_name(plan.id))
                .gap(px(16.))
                .px(px(20.))
                .py(px(14.))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .child(
                            h_flex()
                                .gap(px(6.))
                                .child(div().text_color(t.text).child(plan_name(plan.id)))
                                .child(div().text_color(t.subtle).child("·"))
                                .child(div().text_color(t.subtle).child(price)),
                        )
                        .child(div().text_color(t.muted).child(gains(plan))),
                )
                .children(action.map(|action| {
                    h_flex()
                        .flex_none()
                        .min_w(px(92.))
                        .justify_end()
                        .child(action)
                }))
                .test_support();
            let stepper = plan.per_person.then(|| {
                self.stepper(
                    "plan-seats".into(),
                    tr("settings.plan.peopleLabel").into(),
                    controller.seats,
                    plan.minimum_seats.max(1),
                    500,
                    controller.polling.is_some(),
                    Some(tf(
                        "settings.plan.peopleUnit",
                        &[("count", Arg::Number(controller.seats as i64))],
                    )),
                    |s, value, cx| s.set_plan_seats(value, cx),
                    t,
                    cx,
                )
                .into_any_element()
            });
            list = list.child(
                v_flex()
                    .when(index > 0, |d| d.border_t_1().border_color(t.divider))
                    .when(open, |d| d.bg(theme::fade(t.text, 0.04)))
                    .child(row)
                    .when(open, |d| {
                        d.child(
                            div()
                                .px(px(20.))
                                .pb(px(18.))
                                .child(self.confirmation(stepper, holding, plan.id, t, cx)),
                        )
                    }),
            );
        }
        v_flex()
            .child(section_label(tr(title), t))
            .child(list)
            .into_any_element()
    }

    /// Extra hours and storage as monthly packs on a paid plan: one row
    /// each, a change priced on the line under its row.
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
        let mut list = card(t);
        for (index, offer) in offers.iter().enumerate() {
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
            let row = h_flex()
                .gap(px(16.))
                .px(px(20.))
                .py(px(14.))
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .text_color(t.text)
                                .child(tr(&format!("settings.plan.addOn.{kind}"))),
                        )
                        .child(div().text_color(t.muted).child(tf(
                            &format!("settings.plan.addOn.{kind}Detail"),
                            &[
                                ("hours", f::hours(offer.hours).into()),
                                ("amount", f::storage(offer.storage_bytes).into()),
                                (
                                    "price",
                                    f::money(Some(offer.price_cents), &offer.currency).into(),
                                ),
                            ],
                        ))),
                )
                .child(self.stepper(
                    SharedString::from(format!("plan-add-on-{}", offer.id)),
                    tr(&format!("settings.plan.addOn.{kind}")).into(),
                    shown,
                    0,
                    offer.max_quantity.max(0) as u64,
                    state.pending
                        || !sellable
                        || draft.as_ref().is_some_and(|(d, _)| d != &offer.id),
                    None,
                    move |s, quantity, cx| s.draft_add_on(id.clone(), quantity, held, cx),
                    t,
                    cx,
                ));
            let change = draft
                .as_ref()
                .filter(|(id, _)| id == &offer.id)
                .map(|(_, quantity)| {
                    let difference = quantity.abs_diff(held) as i64 * offer.price_cents;
                    h_flex()
                        .gap(px(12.))
                        .px(px(20.))
                        .pb(px(16.))
                        .child(
                            div().flex_1().min_w_0().text_color(t.muted).child(tf(
                                if *quantity > held {
                                    "settings.plan.addOnMoreNow"
                                } else {
                                    "settings.plan.addOnFewerNext"
                                },
                                &[
                                    ("amount", f::money(Some(difference), &offer.currency).into()),
                                    (
                                        "total",
                                        f::money(
                                            Some(*quantity as i64 * offer.price_cents),
                                            &offer.currency,
                                        )
                                        .into(),
                                    ),
                                ],
                            )),
                        )
                        .child(
                            Button::new("plan-add-on-cancel")
                                .label(tr("settings.plan.cancel"))
                                .disabled(state.pending)
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.plan_page.controller.add_on.draft = None;
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("plan-add-on-confirm")
                                .variant(ButtonVariant::Solid)
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
                        )
                });
            list = list.child(
                v_flex()
                    .when(index > 0, |d| d.border_t_1().border_color(t.divider))
                    .child(row)
                    .children(change),
            );
        }
        Some(
            v_flex()
                .child(section_label(tr("settings.plan.addOnsTitle"), t))
                .child(list)
                .children(state.message.map(|(message, error)| {
                    if error {
                        error_note(tr(message), t).mt(px(10.))
                    } else {
                        note(tr(message), t).mt(px(10.))
                    }
                }))
                .into_any_element(),
        )
    }

    /// `QuantityStepper`: fewer, the value (or its unit), more.
    #[allow(clippy::too_many_arguments)]
    fn stepper(
        &self,
        id: SharedString,
        label: SharedString,
        value: u64,
        minimum: u64,
        maximum: u64,
        disabled: bool,
        unit: Option<String>,
        on_change: impl Fn(&mut Self, u64, &mut Context<Self>) + Clone + 'static,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let less = on_change.clone();
        h_flex()
            .id(id.clone())
            .flex_none()
            .gap(px(2.))
            .min_h(px(theme::control_compact() + 6.))
            .border_1()
            .border_color(t.divider)
            .rounded(px(6.))
            .bg(t.control)
            .child(
                IconButton::new(
                    SharedString::from(format!("{id}-less")),
                    Icon::new("minus").small(),
                )
                .label(tf(
                    "settings.plan.decrease",
                    &[("label", label.to_string().into())],
                ))
                .no_tooltip()
                .disabled(disabled || value <= minimum)
                .on_click(
                    cx.listener(move |s, _, _, cx| {
                        less(s, value.saturating_sub(1).max(minimum), cx)
                    }),
                ),
            )
            .child(
                div()
                    .min_w(px(64.))
                    .text_center()
                    .whitespace_nowrap()
                    .child(unit.unwrap_or_else(|| format_number(value as i64))),
            )
            .child(
                IconButton::new(
                    SharedString::from(format!("{id}-more")),
                    Icon::new("plus").small(),
                )
                .label(tf(
                    "settings.plan.increase",
                    &[("label", label.to_string().into())],
                ))
                .no_tooltip()
                .disabled(disabled || value >= maximum)
                .on_click(
                    cx.listener(move |s, _, _, cx| on_change(s, (value + 1).min(maximum), cx)),
                ),
            )
    }
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
