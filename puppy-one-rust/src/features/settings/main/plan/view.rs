//! `CloudPlans.tsx`, `PlanLoading.tsx` and `PlanUsageBar.tsx` with
//! `settings.css`' `.desktop-plan-*` rules. The page answers three questions
//! in the order people ask them: the plan held and this period's agent hours,
//! then the plans side by side with one price and the same allowance rows,
//! then, for a paid plan, the add-ons.
use super::super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use super::format::{self as f, METER_TICKS};
use crate::localization::{Arg, format_number, t as tr, tf};
use crate::theme::{self, Theme};
use crate::ui::components::{
    Button, ButtonVariant, Icon, IconButton, SettingsSection, SettingsSubsection, ValueRow,
};
use crate::ui::loading::{self, model::Shape};
use crate::workspace::cloud::pricing::{
    self, AddOnKind, AddOnOffer, MeterTone, PlanHolding, PlanId, PlanOffer,
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};

/// `.desktop-plan-note`: meta type, subtle, 10px in.
fn note(text: impl Into<SharedString>, t: Theme) -> Div {
    let meta = theme::ty().ui.meta;
    div()
        .px(px(10.))
        .text_size(px(meta))
        .line_height(px(meta * 1.5))
        .text_color(t.subtle)
        .child(text.into())
}
/// `.desktop-plan-error`.
fn error_note(text: impl Into<SharedString>, t: Theme) -> Div {
    note(text, t).text_color(t.danger)
}
/// `CurrentBadge`.
fn current_badge(t: Theme) -> Div {
    div()
        .flex()
        .items_center()
        .min_h(px(theme::control_compact() + 6.))
        .text_color(t.muted)
        .child(tr("settings.plan.current"))
}
fn placeholder(id: &'static str, width: f32, height: f32, cx: &App) -> AnyElement {
    let style = cx
        .try_global::<crate::ui::appearance::Appearance>()
        .map(|a| a.loading_style)
        .unwrap_or_default();
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
        style,
    )
    .into_any_element()
}

/// `PlanUsageBar`: a complete short rail stays visible for every reading,
/// zero included; only authoritative readings light its ticks.
fn meter(percent: Option<f64>, t: Theme) -> Div {
    let active = f::active_ticks(percent);
    let lit = match percent.map(pricing::meter_tone) {
        Some(MeterTone::Exhausted) => t.danger,
        _ => theme::plan_accent(),
    };
    let track = theme::fade(t.text, 0.38);
    div()
        .flex()
        .flex_none()
        .gap(px(6.))
        .h(px(18.))
        .children((0..METER_TICKS).map(|tick| {
            div()
                .w(px(2.))
                .h(px(18.))
                .bg(if tick < active { lit } else { track })
        }))
}

/// How many plan cards share a row: `@container (max-width: 600px)` puts
/// them in one column, the reading width in two.
fn columns(width: f32) -> usize {
    if width > 600. { 2 } else { 1 }
}

impl SettingsWorkspaceSurface {
    pub(in crate::features::settings) fn plan(
        &self,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        // `usePaymentsExperience()`: nothing of Plan without payments.
        if !self.preferences.read(cx).state.experimental.payments {
            return div().into_any_element();
        }
        let signed_in = crate::features::cloud::account::broker_and_binding(cx).is_some();
        let restoring = crate::features::cloud::account::status(cx)
            == Some(crate::cloud::auth::Status::Restoring);
        let space = self.settings_space(cx);
        let page = &self.plan_page;
        let org = page
            .context
            .as_ref()
            .map(|c| c.1.clone())
            .filter(|org| space.as_ref().is_some_and(|s| &s.id == org));
        let snapshot = &page.snapshot;
        let mut section = SettingsSection::new(tr("settings.seats.title"));
        if signed_in && space.is_none() {
            section = section.child(note(tr("settings.space.choose"), t));
        }
        let waiting = signed_in && space.is_some();
        let body = if restoring
            || (waiting && snapshot.summary.is_none() && (snapshot.loading || !snapshot.error))
        {
            self.plan_loading(t, cx)
        } else if let (true, Some(_), Some(_)) = (signed_in, org, snapshot.summary.as_ref()) {
            self.connected_plans(t, cx)
        } else {
            let view = pricing::resolve_catalog(snapshot.catalog.as_ref());
            let holding = pricing::resolve_holding(None, None);
            v_flex()
                .gap(px(16.))
                .when(waiting, |d| {
                    d.child(
                        SettingsSubsection::new()
                            .title(tr("settings.plan.currentLabel"))
                            .child(
                                ValueRow::new(tr("cloud.billing.loadFailed"), "").action(
                                    Button::new("plan-load-retry")
                                        .label(tr("common.action.retry"))
                                        .on_click(cx.listener(|s, _, _, cx| s.refresh_plan(cx))),
                                ),
                            ),
                    )
                })
                .child(self.plan_comparison(
                    &view.plans,
                    &holding,
                    false,
                    None,
                    t,
                    cx,
                    |plan, _, cx| {
                        (!waiting).then(|| {
                            Button::new(SharedString::from(format!(
                                "plan-sign-in-{}",
                                plan.id.key()
                            )))
                            .variant(if plan.id == PlanId::Free {
                                ButtonVariant::PlanCard
                            } else {
                                ButtonVariant::PlanCardPrimary
                            })
                            .label(tr("settings.plan.signInToChoose"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                // Buying needs an account; Account owns sign-in.
                                s.select_page(crate::features::settings::Page::Account, cx)
                            }))
                            .into_any_element()
                        })
                    },
                ))
                .into_any_element()
        };
        section.child(body).into_any_element()
    }

    /// `PlanLoading`: the signed-in page keeps its reading order while its
    /// first snapshot loads.
    fn plan_loading(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let ui = theme::ty().ui;
        let card = |index: usize, cx: &App| {
            let ids = [
                "plan-loading-card-0",
                "plan-loading-card-1",
                "plan-loading-card-2",
            ];
            div()
                .id(ids[index])
                .flex()
                .flex_col()
                .min_h(px(280.))
                .p(px(16.))
                .border_1()
                .border_color(t.divider)
                .rounded(px(8.))
                .gap(px(12.))
                .child(placeholder("plan-loading-name", 108., ui.label * 1.5, cx))
                .child(placeholder(
                    "plan-loading-price",
                    120.,
                    ui.display * 1.25,
                    cx,
                ))
        };
        v_flex()
            .gap(px(16.))
            .child(
                SettingsSubsection::new().child(
                    h_flex()
                        .min_h(px(44.))
                        .px(px(10.))
                        .gap(px(16.))
                        .child(
                            div()
                                .text_color(t.muted)
                                .child(tr("settings.plan.currentLabel")),
                        )
                        .child(
                            v_flex()
                                .gap(px(5.))
                                .child(placeholder(
                                    "plan-loading-plan",
                                    108.,
                                    ui.section_title * 1.4,
                                    cx,
                                ))
                                .child(placeholder("plan-loading-detail", 168., ui.meta * 1.5, cx)),
                        ),
                ),
            )
            .child(
                v_flex()
                    .px(px(10.))
                    .pb(px(24.))
                    .gap(px(8.))
                    .border_b_1()
                    .border_color(t.divider)
                    .child(
                        div()
                            .text_color(t.muted)
                            .child(tr("settings.plan.hoursLabel")),
                    )
                    .child(
                        h_flex()
                            .gap(px(16.))
                            .child(placeholder("plan-loading-reading", 84., ui.label * 1.5, cx))
                            .child(meter(None, t))
                            .child(placeholder("plan-loading-left", 84., ui.label * 1.5, cx)),
                    ),
            )
            .child(
                SettingsSubsection::new()
                    .title(tr("settings.plan.chooseTitle"))
                    .child(
                        self.plan_grid((0..3).map(|i| card(i, cx).into_any_element()).collect()),
                    ),
            )
            .into_any_element()
    }

    /// Cards in rows of `columns`, 16px apart, 14px below the title.
    fn plan_grid(&self, cards: Vec<AnyElement>) -> Div {
        let columns = columns(self.content_width());
        let mut rows = v_flex().gap(px(16.)).mt(px(14.)).mx(px(10.));
        let mut cards = cards.into_iter().peekable();
        while cards.peek().is_some() {
            let mut row = h_flex().items_stretch().gap(px(16.));
            for _ in 0..columns {
                row = row.child(div().flex_1().min_w_0().children(cards.next()));
            }
            rows = rows.child(row);
        }
        rows
    }

    /// `ConnectedPlans`.
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
        let busy = controller.acting || snapshot.loading;
        let held_plan = summary
            .as_ref()
            .map(|s| s.plan_id.clone())
            .unwrap_or_default();
        let portal = summary.as_ref().is_some_and(|s| s.portal_available);
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
        let team_minimum = view.plan(PlanId::Team).map_or(1, |p| p.minimum_seats);
        let seat_target = team_minimum.max(controller.seats);
        let on_team = holding.subscribed;
        let timing = f::quote_timing(controller.quote.as_ref(), &holding);

        let current_plan = self.current_plan(
            &current,
            &holding,
            view.authoritative && !snapshot.catalog_unavailable,
            &view.add_ons,
            (holding.subscribed && portal).then(|| {
                Button::new("plan-invoices")
                    .label(tr("settings.plan.invoices"))
                    .trailing(Icon::new("external-link").small())
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, _, cx| s.open_portal(cx)))
                    .into_any_element()
            }),
            (holding.scheduled.is_some() && current.catalog_plan.is_some()).then(|| {
                let plan = current
                    .catalog_plan
                    .clone()
                    .unwrap_or_else(|| unreachable!());
                let seats = holding.seats;
                Button::new("plan-keep-current")
                    .label(tr("settings.plan.keepCurrent"))
                    .disabled(busy || !sellable || !current.purchasable)
                    .on_click(cx.listener(move |s, _, _, cx| s.quote_plan(plan.clone(), seats, cx)))
                    .into_any_element()
            }),
            t,
        );

        let quote = controller.quote.as_ref().map(|quote| {
            SettingsSubsection::new()
                .title(tr("settings.plan.quoteTitle"))
                .child(
                    ValueRow::new(
                        tf(
                            "settings.plan.quotePlan",
                            &[
                                (
                                    "plan",
                                    tr(&format!(
                                        "settings.plan.name.{}",
                                        f::plan_key(&quote.target_plan_id)
                                    ))
                                    .into(),
                                ),
                                ("count", Arg::Number(quote.target_seats as i64)),
                            ],
                        ),
                        tf(
                            "settings.plan.monthlyFor",
                            &[(
                                "amount",
                                f::money(Some(quote.target_amount_cents), &quote.currency).into(),
                            )],
                        ),
                    )
                    .action(
                        Button::new("plan-confirm-quote")
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr(timing.confirm))
                            .when(timing.opens_browser, |b| {
                                b.trailing(Icon::new("external-link").small())
                            })
                            .disabled(controller.acting)
                            .on_click(cx.listener(|s, _, _, cx| s.confirm_quote(cx))),
                    ),
                )
                .child(note(timing.note.clone(), t))
        });

        let render_action =
            move |plan: &PlanOffer, page: &SettingsWorkspaceSurface, cx: &mut Context<Self>| {
                let is_current = plan.id == current.id;
                let can_purchase = sellable && plan.purchasable;
                let catalog_id = plan.catalog_plan.as_ref().map(|p| p.id.clone());
                if !owner {
                    return is_current.then(|| current_badge(t).into_any_element());
                }
                if plan.id == PlanId::Free {
                    if is_current {
                        return Some(current_badge(t).into_any_element());
                    }
                    // Leaving a paid plan is a cancellation, which lives with
                    // invoices.
                    return Some(
                        Button::new("plan-move-to-free")
                            .variant(ButtonVariant::PlanCard)
                            .label(tr("settings.plan.moveToFree"))
                            .trailing(Icon::new("external-link").small())
                            .disabled(busy || !portal)
                            .on_click(cx.listener(|s, _, _, cx| s.open_portal(cx)))
                            .into_any_element(),
                    );
                }
                let choose = {
                    let plan = plan.catalog_plan.clone();
                    let held_plan = held_plan.clone();
                    let seats = if holding.subscribed {
                        holding.seats
                    } else {
                        seat_target
                    };
                    cx.listener(move |s, _, _, cx| {
                        let Some(plan) = plan.clone() else { return };
                        if plan.id == held_plan && on_team {
                            s.quote_seats(cx);
                        } else {
                            s.quote_plan(plan, seats, cx);
                        }
                    })
                };
                if plan.per_person {
                    let changed = !is_current
                        || catalog_id.as_deref() != Some(held_plan.as_str())
                        || seat_target != holding.seats;
                    let can_choose_seats =
                        !holding.subscribed || catalog_id.as_deref() == Some(held_plan.as_str());
                    let minimum = if on_team { 1 } else { team_minimum };
                    let seats = if can_choose_seats {
                        page.stepper(
                            SharedString::from(format!("plan-seats-{}", plan.id.key())),
                            tr("settings.plan.peopleLabel").into(),
                            seat_target,
                            minimum,
                            500,
                            busy || !can_purchase,
                            Some(tf(
                                "settings.plan.peopleUnit",
                                &[("count", Arg::Number(seat_target as i64))],
                            )),
                            |s, value, cx| s.set_plan_seats(value, cx),
                            t,
                            cx,
                        )
                        .into_any_element()
                    } else {
                        div()
                            .child(tf(
                                "settings.plan.peopleUnit",
                                &[("count", Arg::Number(holding.seats as i64))],
                            ))
                            .into_any_element()
                    };
                    let action = if is_current && !changed {
                        current_badge(t).into_any_element()
                    } else {
                        Button::new(SharedString::from(format!("plan-choose-{}", plan.id.key())))
                            .variant(ButtonVariant::PlanCardPrimary)
                            .label(tr(f::team_action(is_current, can_purchase)))
                            .disabled(busy || !can_purchase || catalog_id.is_none())
                            .on_click(choose)
                            .into_any_element()
                    };
                    return Some(
                        h_flex()
                            .w_full()
                            .flex_wrap()
                            .justify_center()
                            .gap(px(10.))
                            .child(seats)
                            .child(div().flex_1().flex().justify_center().child(action))
                            .into_any_element(),
                    );
                }
                if is_current {
                    return Some(current_badge(t).into_any_element());
                }
                Some(
                    Button::new(SharedString::from(format!("plan-choose-{}", plan.id.key())))
                        .variant(if holding.subscribed {
                            ButtonVariant::PlanCard
                        } else {
                            ButtonVariant::PlanCardPrimary
                        })
                        .label(tr(f::plan_action(holding.subscribed, can_purchase)))
                        .disabled(busy || !can_purchase || catalog_id.is_none())
                        .on_click(choose)
                        .into_any_element(),
                )
            };

        let storage_add_ons = self.add_ons(&add_ons, AddOnKind::Storage, &holding, sellable, t, cx);
        let hours_add_ons = self.add_ons(&add_ons, AddOnKind::Hours, &holding, sellable, t, cx);
        v_flex()
            .gap(px(16.))
            .child(current_plan)
            .children(quote)
            .children(controller.error.map(|e| error_note(tr(e), t)))
            .when(snapshot.error, |d| {
                d.child(
                    h_flex()
                        .flex_wrap()
                        .justify_between()
                        .gap(px(16.))
                        .px(px(10.))
                        .child(note(tr("cloud.billing.loadFailed"), t).px(px(0.)))
                        .child(
                            Button::new("plan-retry")
                                .label(tr("common.action.retry"))
                                .disabled(busy)
                                .on_click(cx.listener(|s, _, _, cx| s.refresh_plan(cx))),
                        ),
                )
            })
            .when(snapshot.can_manage_billing == Some(false), |d| {
                d.child(note(tr("settings.plan.space.managedByOwner"), t))
            })
            .child(self.plan_comparison(
                &view.plans,
                &holding,
                true,
                Some((snapshot.usage.clone(), storage_add_ons)),
                t,
                cx,
                render_action,
            ))
            .children(hours_add_ons)
            .into_any_element()
    }

    /// `CurrentPlan`: the plan held and its one primary usage indicator,
    /// cloud agent hours; storage speaks only when it needs attention.
    #[allow(clippy::too_many_arguments)]
    fn current_plan(
        &self,
        offer: &PlanOffer,
        holding: &PlanHolding,
        show_price: bool,
        add_ons: &[AddOnOffer],
        action: Option<AnyElement>,
        scheduled_action: Option<AnyElement>,
        t: Theme,
    ) -> AnyElement {
        let usage = self.plan_page.snapshot.usage.as_ref();
        let reading = pricing::resolve_allowance(usage, offer, holding, add_ons);
        let hours = pricing::resolve_agent_hours(usage);
        let value = hours.used.map_or_else(|| "—".to_owned(), f::hours);
        let used = tf(
            "settings.plan.hoursUsed",
            &[(
                "hours",
                match hours.total.filter(|h| *h > 0.) {
                    Some(total) => format!("{value} / {}", f::hours(total)),
                    None => value,
                }
                .into(),
            )],
        );
        let remaining = tf(
            "settings.plan.hoursRemaining",
            &[(
                "hours",
                hours
                    .remaining
                    .map_or_else(|| "—".to_owned(), f::hours)
                    .into(),
            )],
        );
        let reserved = hours.reserved.filter(|h| *h > 0.).map(|h| {
            tf(
                "settings.plan.hoursReserved",
                &[("hours", f::hours(h).into())],
            )
        });
        let status = f::status(holding);
        let mut facts = vec![];
        if holding.subscribed {
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
                    &[("amount", f::money(Some(monthly), &holding.currency).into())],
                ));
            }
            if offer.per_person {
                facts.push(tf(
                    "settings.plan.peopleUnit",
                    &[("count", Arg::Number(holding.seats as i64))],
                ));
            }
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
        let resets = reading.resets_at.as_deref().map(|at| {
            tf(
                "settings.plan.resetsOn",
                &[("date", f::short_date(at).into())],
            )
        });
        let storage = f::percent_of(
            reading.used_bytes.map(|b| b as f64),
            reading.included_bytes.map(|b| b as f64),
        );
        let ui = theme::ty().ui;
        v_flex()
            .gap(px(12.))
            .child(
                SettingsSubsection::new()
                    .child(
                        h_flex()
                            .flex_wrap()
                            .min_h(px(44.))
                            .px(px(10.))
                            .gap(px(16.))
                            .child(
                                div()
                                    .flex_none()
                                    .text_color(t.muted)
                                    .child(tr("settings.plan.currentLabel")),
                            )
                            .child(
                                v_flex()
                                    .min_w_0()
                                    .gap(px(5.))
                                    .child(
                                        h_flex()
                                            .flex_wrap()
                                            .gap(px(10.))
                                            .child(div().text_color(t.text).child(tr(&format!(
                                                "settings.plan.name.{}",
                                                offer.id.key()
                                            ))))
                                            .when(status != f::Status::Free, |d| {
                                                d.child(tr(&format!(
                                                    "settings.plan.status.{}",
                                                    status.key()
                                                )))
                                            }),
                                    )
                                    .when(!facts.is_empty(), |d| {
                                        d.child(div().text_color(t.muted).child(facts.join(" · ")))
                                    }),
                            )
                            .child(
                                h_flex()
                                    .ml_auto()
                                    .flex_wrap()
                                    .justify_end()
                                    .gap(px(12.))
                                    .text_color(t.muted)
                                    .children(resets)
                                    .children(action),
                            ),
                    )
                    .when(holding.scheduled.is_some(), |d| {
                        let row = ValueRow::new(
                            tr("settings.plan.scheduledLabel"),
                            f::scheduled_change(holding),
                        );
                        d.child(match scheduled_action {
                            Some(action) => row.action(action),
                            None => row,
                        })
                    }),
            )
            .child(
                v_flex()
                    .px(px(10.))
                    .pb(px(24.))
                    .gap(px(8.))
                    .border_b_1()
                    .border_color(t.divider)
                    .child(
                        div()
                            .text_color(t.muted)
                            .child(tr("settings.plan.hoursLabel")),
                    )
                    .child(
                        h_flex()
                            .flex_wrap()
                            .gap(px(16.))
                            .child(div().text_color(t.text).child(used))
                            .child(meter(f::percent_of(hours.used, hours.total), t))
                            .child(
                                div()
                                    .id("plan-hours-left")
                                    .text_color(t.muted)
                                    .child(remaining)
                                    .when_some(reserved, |d, reserved| {
                                        d.tooltip(crate::ui::components::tooltip(reserved))
                                    }),
                            ),
                    ),
            )
            .when_some(storage.filter(|p| *p >= 80.), |d, percent| {
                let full = percent >= 100.;
                d.child(
                    h_flex()
                        .flex_wrap()
                        .justify_between()
                        .gap(px(16.))
                        .px(px(10.))
                        .text_color(if full { t.danger } else { t.warning })
                        .child(tr(if full {
                            "settings.plan.storageFull"
                        } else {
                            "settings.plan.storageNearLimit"
                        }))
                        .child(format!(
                            "{} / {}",
                            f::storage(reading.used_bytes.unwrap_or(0)),
                            f::storage(reading.included_bytes.unwrap_or(0))
                        )),
                )
            })
            .text_size(px(ui.label))
            .line_height(px(ui.label * 1.5))
            .into_any_element()
    }

    /// `PlanComparison`: comparable cards, then the fine print, then the
    /// storage details with storage's add-ons.
    #[allow(clippy::too_many_arguments)]
    fn plan_comparison(
        &self,
        plans: &[PlanOffer],
        holding: &PlanHolding,
        signed_in: bool,
        storage: Option<(
            Option<crate::workspace::cloud::billing::Usage>,
            Option<AnyElement>,
        )>,
        t: Theme,
        cx: &mut Context<Self>,
        render_action: impl Fn(&PlanOffer, &Self, &mut Context<Self>) -> Option<AnyElement>,
    ) -> AnyElement {
        let ui = theme::ty().ui;
        let cards = plans
            .iter()
            .map(|plan| {
                let current = signed_in && plan.id.key() == holding.plan_id;
                let per_person = |value: String| {
                    if plan.per_person {
                        tf("settings.plan.spec.perPerson", &[("value", value.into())])
                    } else {
                        value
                    }
                };
                let history = match plan.history_days {
                    None => tr("settings.plan.spec.unlimited").to_owned(),
                    Some(days) if days >= 365 && days % 365 == 0 => tf(
                        "settings.plan.spec.years",
                        &[("count", Arg::Number((days / 365) as i64))],
                    ),
                    Some(days) => tf(
                        "settings.plan.spec.days",
                        &[("count", Arg::Number(days as i64))],
                    ),
                };
                let specs = [
                    (
                        tr("settings.plan.hoursLabel").to_owned(),
                        tf(
                            if plan.per_person {
                                "settings.plan.spec.hoursPerPerson"
                            } else {
                                "settings.plan.spec.hours"
                            },
                            &[("hours", f::hours(plan.agent_hours).into())],
                        ),
                    ),
                    (
                        tr("settings.plan.storageLabel").to_owned(),
                        tr("settings.plan.storageIncluded").to_owned(),
                    ),
                    (
                        tr("settings.plan.spec.projects").to_owned(),
                        plan.projects.map_or_else(
                            || tr("settings.plan.spec.unlimited").to_owned(),
                            |n| per_person(format_number(n as i64)),
                        ),
                    ),
                    (tr("settings.plan.spec.history").to_owned(), history),
                ];
                div()
                    .flex()
                    .flex_col()
                    .h_full()
                    .min_h(px(280.))
                    .p(px(16.))
                    .border_1()
                    .border_color(t.divider)
                    .rounded(px(8.))
                    .when(current, |d| d.bg(theme::fade(t.text, 0.02)))
                    .child(
                        v_flex()
                            .gap(px(12.))
                            .child(
                                h_flex()
                                    .justify_between()
                                    .gap(px(12.))
                                    .min_h(px(21.))
                                    .child(div().text_color(t.text).child(tr(&format!(
                                        "settings.plan.name.{}",
                                        plan.id.key()
                                    ))))
                                    .when(current, |d| {
                                        d.child(Icon::new("check").small().color(t.muted))
                                    }),
                            )
                            .child(
                                h_flex()
                                    .flex_wrap()
                                    .items_baseline()
                                    .gap(px(8.))
                                    .child(
                                        div()
                                            .text_color(t.text)
                                            .text_size(px(ui.display))
                                            .line_height(px(ui.display * 1.25))
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(f::currency_amount(
                                                plan.price_cents,
                                                &plan.currency,
                                            )),
                                    )
                                    .child(div().text_color(t.muted).child(tr(
                                        if plan.per_person {
                                            "settings.plan.spec.perPersonMonth"
                                        } else {
                                            "settings.plan.spec.perMonth"
                                        },
                                    ))),
                            ),
                    )
                    .child(v_flex().gap(px(10.)).mt(px(18.)).mb(px(20.)).children(
                        specs.into_iter().map(|(label, value)| {
                            h_flex()
                                .justify_between()
                                .items_baseline()
                                .gap(px(12.))
                                .child(div().min_w_0().text_color(t.muted).child(label))
                                .child(div().text_color(t.text).text_right().child(value))
                        }),
                    ))
                    .child(
                        div()
                            .mt_auto()
                            .flex()
                            .min_h(px(theme::control_compact()))
                            .items_center()
                            .justify_center()
                            .children(render_action(plan, self, cx).map(|action| {
                                div().w_full().flex().justify_center().child(action)
                            })),
                    )
                    .into_any_element()
            })
            .collect();
        let open = self.plan_page.storage_open;
        let (usage, storage_actions) = storage.unwrap_or((None, None));
        v_flex()
            .mt(px(10.))
            .child(
                SettingsSubsection::new()
                    .title(tr("settings.plan.chooseTitle"))
                    .child(self.plan_grid(cards)),
            )
            .child(
                note(tr("settings.plan.finePrint"), t)
                    .mt(px(16.))
                    .text_color(t.muted),
            )
            .child(
                v_flex()
                    .mt(px(12.))
                    .mx(px(10.))
                    .text_color(t.muted)
                    .child(
                        div()
                            .id("plan-storage-details")
                            .cursor(theme::clickable_cursor())
                            .child(format!(
                                "{}  {}",
                                tr("settings.plan.storageDetails"),
                                if open { "−" } else { "+" }
                            ))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.plan_page.storage_open = !s.plan_page.storage_open;
                                cx.notify();
                            })),
                    )
                    .when(open, |d| {
                        d.child(
                            v_flex()
                                .gap(px(4.))
                                .pt(px(12.))
                                .children(usage.map(|usage| {
                                    let mut value = f::storage(usage.storage.logical_bytes);
                                    if let Some(limit) = usage.storage.limit_bytes {
                                        value = format!("{value} / {}", f::storage(limit));
                                    }
                                    ValueRow::new(tr("settings.plan.storageUsed"), value).px(px(0.))
                                }))
                                .children(plans.iter().map(|plan| {
                                    let mut capacity = plan.storage_bytes.map_or_else(
                                        || tr("settings.plan.custom").to_owned(),
                                        f::storage,
                                    );
                                    if plan.storage_bytes.is_some() && plan.per_person {
                                        capacity = tf(
                                            "settings.plan.spec.perPerson",
                                            &[("value", capacity.into())],
                                        );
                                    }
                                    ValueRow::new(
                                        tr(&format!("settings.plan.name.{}", plan.id.key())),
                                        capacity,
                                    )
                                    .px(px(0.))
                                }))
                                .child(note(tr("settings.plan.storagePolicy"), t).px(px(0.)))
                                .children(storage_actions),
                        )
                    }),
            )
            .text_size(px(ui.label))
            .line_height(px(ui.label * 1.5))
            .into_any_element()
    }

    /// `AddOns`: extra hours or storage as monthly packs on a paid plan.
    fn add_ons(
        &self,
        offers: &[AddOnOffer],
        kind: AddOnKind,
        holding: &PlanHolding,
        sellable: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let offers: Vec<&AddOnOffer> = offers.iter().filter(|a| a.kind == kind).collect();
        if offers.is_empty() {
            return None;
        }
        let state = &self.plan_page.controller.add_on;
        let draft = state.draft.clone();
        let kind_key = match kind {
            AddOnKind::Hours => "hours",
            AddOnKind::Storage => "storage",
        };
        let mut subsection = SettingsSubsection::new().title(tr("settings.plan.addOnsTitle"));
        for offer in &offers {
            let held = holding.add_ons.get(&offer.id).copied().unwrap_or(0);
            let shown = match &draft {
                Some((id, quantity)) if id == &offer.id => *quantity,
                _ => held,
            };
            let id = offer.id.clone();
            subsection = subsection.child(
                h_flex()
                    .py(px(10.))
                    .px(px(10.))
                    .justify_between()
                    .gap(px(18.))
                    .child(
                        v_flex()
                            .min_w_0()
                            .gap(px(5.))
                            .child(tr(&format!("settings.plan.addOn.{kind_key}")))
                            .child(div().text_color(t.muted).child(tf(
                                &format!("settings.plan.addOn.{kind_key}Detail"),
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
                        tr(&format!("settings.plan.addOn.{kind_key}")).into(),
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
                    )),
            );
        }
        if let Some((id, quantity)) = &draft
            && let Some(offer) = offers.iter().find(|o| &o.id == id)
        {
            let held = holding.add_ons.get(id).copied().unwrap_or(0);
            let difference = quantity.abs_diff(held) as i64 * offer.price_cents;
            subsection = subsection.child(
                ValueRow::new(
                    tr("settings.plan.addOnChangeLabel"),
                    tf(
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
                    ),
                )
                .action(
                    h_flex()
                        .gap(px(8.))
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
                        ),
                ),
            );
        }
        if let Some((message, error)) = state.message {
            subsection = subsection.child(if error {
                error_note(tr(message), t)
            } else {
                note(tr(message), t)
            });
        }
        Some(subsection.into_any_element())
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
            .rounded(px(5.))
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
                    .min_w(px(28.))
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

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn plan_cards_share_a_row_above_600px() {
        assert_eq!(columns(724.), 2);
        assert_eq!(columns(601.), 2);
        assert_eq!(columns(600.), 1);
    }
}
