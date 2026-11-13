//! `planPricing.ts`' wording and `CloudPlans.tsx`' small decisions: money,
//! storage and hours as the product writes them, the plan's status, and what
//! confirming a quote will do.
use crate::localization::{Arg, format_currency, format_decimal, month_day, t, tf};
use crate::workspace::cloud::{billing::Quote, pricing::PlanHolding};

const BYTES_PER_MB: f64 = 1_000_000.;
const BYTES_PER_GB: f64 = 1_000_000_000.;

/// `formatMoney`: "Free" for nothing, "Custom" while unknown.
pub fn money(cents: Option<i64>, currency: &str) -> String {
    match cents {
        None => t("settings.plan.custom").to_owned(),
        Some(0) => t("settings.plan.freePrice").to_owned(),
        Some(cents) => currency_amount(cents, currency),
    }
}
/// `formatCurrency`: a price as currency, $0 included.
pub fn currency_amount(cents: i64, currency: &str) -> String {
    format_currency(
        cents as f64 / 100.,
        currency,
        if cents % 100 == 0 { 0 } else { 2 },
    )
}
/// `formatStorage`: MB below one gigabyte, so a few saved files never read
/// as "0 GB", and GB with at most one decimal from there.
pub fn storage(bytes: u64) -> String {
    let bytes = bytes as f64;
    if bytes < BYTES_PER_GB {
        return tf(
            "settings.plan.amountMb",
            &[(
                "amount",
                format_decimal((bytes / BYTES_PER_MB).round(), 0).into(),
            )],
        );
    }
    tf(
        "settings.plan.amountGb",
        &[(
            "amount",
            format_decimal(((bytes / BYTES_PER_GB) * 10.).round() / 10., 1).into(),
        )],
    )
}
/// `formatHours`: one decimal below ten hours, none from there.
pub fn hours(value: f64) -> String {
    format_decimal(value, if value < 10. { 1 } else { 0 })
}
/// `formatDate(…, {month: "short", day: "numeric"})` of an ISO timestamp,
/// in local time.
pub fn short_date(iso: &str) -> String {
    use chrono::{Datelike, Local};
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|at| {
            let local = at.with_timezone(&Local);
            month_day(None, local.month(), local.day())
        })
        .unwrap_or_default()
}

/// `heldPlanName` with `describeHolding`: the plan held, and what it costs
/// a month when that is known.
pub fn held_plan(holding: &PlanHolding) -> String {
    let name = t(if !holding.subscribed {
        "settings.plan.name.free"
    } else if holding.plan_id == "enterprise" {
        "settings.plan.name.enterprise"
    } else {
        "settings.plan.name.team"
    });
    match (holding.subscribed, holding.monthly_cents) {
        (true, Some(cents)) => format!(
            "{name} · {}",
            tf(
                "settings.plan.monthlyFor",
                &[("amount", money(Some(cents), &holding.currency).into())]
            )
        ),
        _ => name.to_owned(),
    }
}

/// `PlanStatus`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Free,
    Active,
    Ending,
    Attention,
    Updating,
}
impl Status {
    pub fn key(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Active => "active",
            Self::Ending => "ending",
            Self::Attention => "attention",
            Self::Updating => "updating",
        }
    }
}
/// `planStatus`.
pub fn status(holding: &PlanHolding) -> Status {
    if !holding.subscribed {
        return Status::Free;
    }
    match holding.status.as_deref() {
        Some("past_due" | "disputed") => Status::Attention,
        _ if holding.cancel_at_period_end => Status::Ending,
        Some("cancel_scheduled") => Status::Ending,
        Some("change_pending") => Status::Updating,
        _ => Status::Active,
    }
}

/// `planKey`: the plan a catalog id is sold as.
pub fn plan_key(plan_id: &str) -> &'static str {
    match plan_id {
        "personal" | "plus" | "team_v2" => "team",
        "free" => "free",
        _ => "enterprise",
    }
}

/// `describeScheduledChange`.
pub fn scheduled_change(holding: &PlanHolding) -> String {
    let Some(scheduled) = &holding.scheduled else {
        return String::new();
    };
    let date = short_date(&scheduled.effective_at);
    if scheduled.plan_id == holding.plan_id {
        return tf(
            "settings.plan.scheduledSeats",
            &[
                ("count", Arg::Number(scheduled.seats as i64)),
                ("date", date.into()),
            ],
        );
    }
    tf(
        "settings.plan.scheduledPlan",
        &[
            (
                "plan",
                t(&format!("settings.plan.name.{}", scheduled.plan_id)).into(),
            ),
            ("date", date.into()),
        ],
    )
}

/// `describeQuoteTiming`: what confirming a quote will do, in words: pay
/// now, wait for renewal, or withdraw a scheduled change by keeping what is
/// held.
#[derive(Clone, Debug, PartialEq)]
pub struct QuoteTiming {
    pub confirm: &'static str,
    pub note: String,
    pub opens_browser: bool,
}
pub fn quote_timing(quote: Option<&Quote>, holding: &PlanHolding) -> QuoteTiming {
    let keeps = quote.is_some_and(|q| {
        holding.scheduled.is_some()
            && plan_key(&q.target_plan_id) == holding.plan_id
            && q.target_seats == holding.seats
    });
    if keeps {
        return QuoteTiming {
            confirm: "settings.plan.keepCurrent",
            note: t("settings.plan.quoteKeep").to_owned(),
            opens_browser: false,
        };
    }
    if let (Some(q), Some(renews)) = (quote, holding.renews_at.as_deref())
        && q.effective.as_deref() == Some("next_period")
    {
        return QuoteTiming {
            confirm: "settings.plan.confirmSchedule",
            note: tf(
                "settings.plan.quoteNextPeriod",
                &[("date", short_date(renews).into())],
            ),
            opens_browser: false,
        };
    }
    QuoteTiming {
        confirm: "settings.plan.confirmAndPay",
        note: t("settings.plan.quoteNote").to_owned(),
        opens_browser: true,
    }
}

/// `percentOf`.
pub fn percent_of(used: Option<f64>, total: Option<f64>) -> Option<f64> {
    match (used, total) {
        (Some(used), Some(total)) if total > 0. => Some((used / total * 100.).clamp(0., 100.)),
        _ => None,
    }
}
/// `PlanUsageBar`: 24 ticks; any reading above zero lights at least one.
pub const METER_TICKS: usize = 24;
pub fn active_ticks(percent: Option<f64>) -> usize {
    match percent.map(|p| p.clamp(0., 100.)) {
        None => 0,
        Some(0.) => 0,
        Some(p) => ((p / 100. * METER_TICKS as f64).round() as usize).max(1),
    }
}

/// `teamActionLabel`.
pub fn team_action(on_team: bool, sellable: bool) -> &'static str {
    if on_team {
        "settings.plan.changePeople"
    } else if sellable {
        "settings.plan.upgrade"
    } else {
        "settings.plan.comingSoon"
    }
}
/// `planActionLabel`.
pub fn plan_action(subscribed: bool, sellable: bool) -> &'static str {
    if !sellable {
        "settings.plan.comingSoon"
    } else if subscribed {
        "settings.plan.switch"
    } else {
        "settings.plan.upgrade"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::cloud::pricing::Scheduled;
    use core::prelude::v1::test;
    use std::collections::BTreeMap;

    fn holding(plan: &str, seats: u64, scheduled: Option<Scheduled>) -> PlanHolding {
        PlanHolding {
            subscribed: true,
            plan_id: plan.into(),
            seats,
            monthly_cents: Some(2000 * seats as i64),
            currency: "USD".into(),
            status: Some("active".into()),
            renews_at: Some("2026-12-08T12:00:00Z".into()),
            cancel_at_period_end: false,
            add_ons: BTreeMap::new(),
            scheduled,
        }
    }
    fn quote(plan: &str, seats: u64, effective: Option<&str>) -> Quote {
        serde_json::from_value(serde_json::json!({"quote_id": "q", "org_id": "o",
            "target_plan_id": plan, "target_seats": seats, "application_mode": "plan_change",
            "effective": effective, "expires_at": "2026-12-01T00:00:00Z"}))
        .unwrap()
    }

    /// `planSubscription.test.tsx`: "never reads a few saved files as zero
    /// gigabytes".
    #[test]
    fn storage_reads_in_mb_below_a_gigabyte() {
        crate::localization::set_current("en");
        assert_eq!(storage(0), "0 MB");
        assert_eq!(storage(10_000_000_000), "10 GB");
        assert_eq!(storage(3_240_000_000), "3.2 GB");
        assert_eq!(money(Some(0), "USD"), "Free");
        assert_eq!(money(None, "USD"), "Custom");
        assert_eq!(money(Some(2000), "USD"), "$20");
        assert_eq!(currency_amount(0, "USD"), "$0");
        assert_eq!(hours(12.5), "13");
        assert_eq!(hours(2.5), "2.5");
    }

    /// "tells a downgrade apart from a payment before it is confirmed",
    /// "says what changes at renewal and offers to keep the current plan".
    #[test]
    fn a_quote_says_whether_it_pays_now_waits_or_keeps() {
        crate::localization::set_current("en");
        let held = holding("team", 3, None);
        assert_eq!(
            quote_timing(Some(&quote("team_v2", 2, Some("next_period"))), &held).confirm,
            "settings.plan.confirmSchedule"
        );
        let now = quote_timing(Some(&quote("enterprise_v2", 3, Some("now"))), &held);
        assert!(now.opens_browser && now.confirm == "settings.plan.confirmAndPay");
        let scheduled = holding(
            "team",
            3,
            Some(Scheduled {
                plan_id: "team".into(),
                seats: 2,
                effective_at: "2026-12-08T12:00:00Z".into(),
            }),
        );
        assert_eq!(
            quote_timing(Some(&quote("team_v2", 3, Some("now"))), &scheduled).confirm,
            "settings.plan.keepCurrent"
        );
        assert_eq!(scheduled_change(&scheduled), "2 people from Dec 8");
    }

    #[test]
    fn the_status_pill_and_the_rail_follow_the_holding_and_reading() {
        let mut held = holding("team", 1, None);
        assert_eq!(status(&held), Status::Active);
        held.status = Some("past_due".into());
        assert_eq!(status(&held), Status::Attention);
        held.status = Some("active".into());
        held.cancel_at_period_end = true;
        assert_eq!(status(&held), Status::Ending);
        held.cancel_at_period_end = false;
        held.status = Some("change_pending".into());
        assert_eq!(status(&held), Status::Updating);
        held.subscribed = false;
        assert_eq!(status(&held), Status::Free);
        // "keeps every tick" and lights one for any reading above zero.
        assert_eq!(active_ticks(None), 0);
        assert_eq!(active_ticks(Some(0.)), 0);
        assert_eq!(active_ticks(Some(0.1)), 1);
        assert_eq!(active_ticks(Some(50.)), 12);
        assert_eq!(active_ticks(Some(140.)), 24);
        assert_eq!(percent_of(Some(20.), Some(40.)), Some(50.));
        assert_eq!(percent_of(Some(1.), Some(0.)), None);
    }
}
