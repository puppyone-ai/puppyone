//! `planPricing.ts`: Cloud pricing as decided on 2026-11-08 (puppy-issues
//! `document/puppypay/product.md`, "云端套餐").
//!
//! Three plans: Free, Team ($20 per person a month) and Enterprise ($40 per
//! person a month), each including cloud projects, storage and cloud agent
//! hours. The headline is the price; hours and storage are the allowance
//! printed under it, never a unit price.
//!
//! - Hours are agent time only.
//! - No machine specs, no runtime units: hours are the only time unit a
//!   person sees.
//! - No price per GB: storage ships inside the plan and grows in packs.
//! - Amounts charged come from the catalog. The local offers below are
//!   indicative and only shown until the billing service answers.
use super::billing::{AddOn, Catalog, Plan, Summary, Usage};
use serde_json::Value;
use std::collections::BTreeMap;

const BYTES_PER_GB: u64 = 1_000_000_000;
const LOCAL_CURRENCY: &str = "USD";
const SECONDS_PER_HOUR: f64 = 3600.;
const DEFAULT_UNIT_SECONDS: u64 = 60;

/// `PLAN_ORDER`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PlanId {
    Free,
    Team,
    Enterprise,
}
pub const PLAN_ORDER: [PlanId; 3] = [PlanId::Free, PlanId::Team, PlanId::Enterprise];
impl PlanId {
    pub fn key(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Team => "team",
            Self::Enterprise => "enterprise",
        }
    }
    /// The plan's id in the 2026-11-09.2 catalog.
    fn catalog_id(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Team => "team_v2",
            Self::Enterprise => "enterprise_v2",
        }
    }
}

/// `TEAM_FEATURES`: only what Cloud enforces today.
pub const TEAM_FEATURES: [&str; 2] = ["team.member_roles", "billing.consolidated"];

/// `PlanOffer`.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanOffer {
    pub id: PlanId,
    /// Per month; per person when `per_person`.
    pub price_cents: i64,
    pub currency: String,
    pub per_person: bool,
    /// Fewest people the plan can be bought for.
    pub minimum_seats: u64,
    /// Cloud projects included; `None` means no cap.
    pub projects: Option<u64>,
    /// Storage included, in bytes.
    pub storage_bytes: Option<u64>,
    /// Cloud agent hours a month.
    pub agent_hours: f64,
    /// History kept, in days.
    pub history_days: Option<u64>,
    pub team_features: bool,
    pub purchasable: bool,
    /// The authoritative plan; absent for indicative pricing, and a
    /// purchase can never start without it.
    pub catalog_plan: Option<Plan>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddOnKind {
    Hours,
    Storage,
}
/// `AddOnOffer`.
#[derive(Clone, Debug, PartialEq)]
pub struct AddOnOffer {
    pub id: String,
    pub kind: AddOnKind,
    pub price_cents: i64,
    pub currency: String,
    /// Agent hours each pack adds a month.
    pub hours: f64,
    /// Bytes each pack adds.
    pub storage_bytes: u64,
    pub max_quantity: i64,
    pub available_on: Vec<String>,
    pub catalog_add_on: Option<AddOn>,
}

fn local_plan(id: PlanId) -> PlanOffer {
    let (price_cents, per_person, projects, gb, agent_hours, history_days, team) = match id {
        PlanId::Free => (0, false, 1, 1, 5., 30, false),
        PlanId::Team => (2000, true, 20, 10, 40., 30, true),
        PlanId::Enterprise => (4000, true, 20, 20, 40., 365, true),
    };
    PlanOffer {
        id,
        price_cents,
        currency: LOCAL_CURRENCY.into(),
        per_person,
        minimum_seats: 1,
        projects: Some(projects),
        storage_bytes: Some(gb * BYTES_PER_GB),
        agent_hours,
        history_days: Some(history_days),
        team_features: team,
        purchasable: id != PlanId::Free,
        catalog_plan: None,
    }
}
fn local_add_ons() -> Vec<AddOnOffer> {
    let on = || {
        ["team_v2", "enterprise_v2", "personal", "team"]
            .map(str::to_owned)
            .to_vec()
    };
    vec![
        AddOnOffer {
            id: "agent_hours_100".into(),
            kind: AddOnKind::Hours,
            price_cents: 500,
            currency: LOCAL_CURRENCY.into(),
            hours: 100.,
            storage_bytes: 0,
            max_quantity: 20,
            available_on: on(),
            catalog_add_on: None,
        },
        AddOnOffer {
            id: "storage_10gb".into(),
            kind: AddOnKind::Storage,
            price_cents: 500,
            currency: LOCAL_CURRENCY.into(),
            hours: 0.,
            storage_bytes: 10 * BYTES_PER_GB,
            max_quantity: 50,
            available_on: on(),
            catalog_add_on: None,
        },
    ]
}

/// `PlanCatalogView`.
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogView {
    pub plans: Vec<PlanOffer>,
    pub add_ons: Vec<AddOnOffer>,
    /// False while the prices shown are indicative.
    pub authoritative: bool,
}
impl CatalogView {
    pub fn plan(&self, id: PlanId) -> Option<&PlanOffer> {
        self.plans.iter().find(|p| p.id == id)
    }
}

/// `resolvePlanCatalog`: the three plans and the add-ons, from the catalog
/// when it carries all three; an older price list is not this pricing, so
/// the indicative offers stay instead of mixing two lists.
pub fn resolve_catalog(catalog: Option<&Catalog>) -> CatalogView {
    let indicative = || CatalogView {
        plans: PLAN_ORDER.map(local_plan).to_vec(),
        add_ons: local_add_ons(),
        authoritative: false,
    };
    let Some(catalog) = catalog else {
        return indicative();
    };
    let unit_seconds = match catalog.runtime.unit_seconds {
        0 => DEFAULT_UNIT_SECONDS,
        seconds => seconds,
    };
    let plans: Option<Vec<PlanOffer>> = PLAN_ORDER
        .iter()
        .map(|id| {
            catalog
                .plans
                .iter()
                .find(|p| p.id == id.catalog_id())
                .map(|plan| plan_from_catalog(*id, plan, unit_seconds))
        })
        .collect();
    let Some(plans) = plans else {
        return indicative();
    };
    CatalogView {
        plans,
        add_ons: catalog
            .add_ons
            .iter()
            .flatten()
            .map(|add_on| add_on_from_catalog(add_on, unit_seconds))
            .collect(),
        authoritative: true,
    }
}

fn plan_from_catalog(id: PlanId, plan: &Plan, unit_seconds: u64) -> PlanOffer {
    let per_person = plan.seats.minimum > 1 || plan.runtime.units_per_seat > 0;
    let units = if per_person {
        plan.runtime.units_per_seat
    } else {
        plan.runtime.fixed_units
    };
    PlanOffer {
        id,
        price_cents: plan.price_per_seat_cents.unwrap_or(0),
        currency: plan.currency.clone(),
        per_person,
        minimum_seats: plan.seats.minimum.max(1),
        projects: limit_of(plan, "projects.max"),
        storage_bytes: limit_of(plan, "storage.max_bytes"),
        agent_hours: units_to_hours(units as f64, unit_seconds),
        history_days: limit_of(plan, "history.retention_days"),
        team_features: TEAM_FEATURES
            .iter()
            .any(|f| plan.features.get(*f) == Some(&true)),
        purchasable: plan.purchasable,
        catalog_plan: Some(plan.clone()),
    }
}

fn add_on_from_catalog(add_on: &AddOn, unit_seconds: u64) -> AddOnOffer {
    AddOnOffer {
        id: add_on.id.clone(),
        kind: if add_on.runtime_units > 0 {
            AddOnKind::Hours
        } else {
            AddOnKind::Storage
        },
        price_cents: add_on.price_cents,
        currency: add_on.currency.clone(),
        hours: units_to_hours(add_on.runtime_units as f64, unit_seconds),
        storage_bytes: add_on.storage_bytes(),
        max_quantity: add_on.max_quantity,
        available_on: add_on.available_on_plans.clone(),
        catalog_add_on: Some(add_on.clone()),
    }
}

/// A per-person limit for one person, or a fixed limit as it stands.
fn limit_of(plan: &Plan, key: &str) -> Option<u64> {
    plan.per_seat_limits
        .get(key)
        .and_then(Value::as_u64)
        .or_else(|| plan.fixed_limits.get(key).and_then(Value::as_u64))
}

/// `unitsToHours`: to one decimal.
pub fn units_to_hours(units: f64, unit_seconds: u64) -> f64 {
    ((units * unit_seconds as f64 / SECONDS_PER_HOUR) * 10.).round() / 10.
}

/// `ScheduledPlanChange`: a downgrade or seat decrease that waits for
/// renewal.
#[derive(Clone, Debug, PartialEq)]
pub struct Scheduled {
    pub plan_id: String,
    pub seats: u64,
    pub effective_at: String,
}
/// `PlanHolding`.
#[derive(Clone, Debug, PartialEq)]
pub struct PlanHolding {
    /// Whether a paid plan is held right now.
    pub subscribed: bool,
    /// The plan in effect: `free` when nothing paid is held; `team` or
    /// `enterprise` for every name those plans had.
    pub plan_id: String,
    pub seats: u64,
    /// Monthly total in cents for the plan, or `None` while unknown.
    pub monthly_cents: Option<i64>,
    pub currency: String,
    pub status: Option<String>,
    pub renews_at: Option<String>,
    pub cancel_at_period_end: bool,
    /// Add-on quantities held, by id.
    pub add_ons: BTreeMap<String, u64>,
    pub scheduled: Option<Scheduled>,
}
impl PlanHolding {
    /// The offer this holding is on, for the plans the page shows.
    pub fn plan(&self) -> Option<PlanId> {
        PLAN_ORDER.into_iter().find(|p| p.key() == self.plan_id)
    }
}

/// `resolvePlanHolding`: what this account holds. Holding nothing is Free,
/// and Free is a complete answer.
pub fn resolve_holding(summary: Option<&Summary>, catalog: Option<&Catalog>) -> PlanHolding {
    let Some(summary) = summary.filter(|s| s.held()) else {
        return PlanHolding {
            subscribed: false,
            plan_id: "free".into(),
            seats: 1,
            monthly_cents: Some(0),
            currency: LOCAL_CURRENCY.into(),
            status: summary.map(|s| s.status.clone()),
            renews_at: None,
            cancel_at_period_end: false,
            add_ons: BTreeMap::new(),
            scheduled: None,
        };
    };
    let plan = catalog.and_then(|c| {
        c.plans
            .iter()
            .find(|p| p.id == summary.plan_id || p.aliases.contains(&summary.plan_id))
    });
    let seats = summary.seat_quantity.max(1);
    let mut add_ons = BTreeMap::new();
    for held in summary.add_ons.iter().flatten() {
        if !held.cancel_at_period_end {
            *add_ons.entry(held.add_on_id.clone()).or_insert(0) += held.quantity;
        }
    }
    let held_id = plan.map_or(summary.plan_id.as_str(), |p| p.id.as_str());
    PlanHolding {
        subscribed: true,
        plan_id: canonical_plan_id(held_id),
        seats,
        monthly_cents: plan
            .and_then(|p| p.price_per_seat_cents)
            .map(|unit| unit * seats as i64),
        currency: plan.map_or(LOCAL_CURRENCY.into(), |p| p.currency.clone()),
        status: Some(summary.status.clone()),
        renews_at: summary.current_period_end.clone(),
        cancel_at_period_end: summary.cancel_at_period_end,
        add_ons,
        scheduled: summary
            .pending_effective_at
            .as_ref()
            .map(|effective_at| Scheduled {
                plan_id: canonical_plan_id(summary.pending_plan_id.as_deref().unwrap_or(held_id)),
                seats: summary.pending_seat_quantity.unwrap_or(seats),
                effective_at: effective_at.clone(),
            }),
    }
}

/// `canonicalPlanId`.
fn canonical_plan_id(plan_id: &str) -> String {
    match plan_id {
        "personal" | "plus" | "team_v2" => "team",
        "business" | "pro" | "team" | "enterprise_v2" => "enterprise",
        other => other,
    }
    .to_owned()
}

/// `resolveAgentHours`: the monthly allowance when supplied, otherwise the
/// service's actual balance. `None` throughout without a reading.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AgentHours {
    pub used: Option<f64>,
    pub total: Option<f64>,
    pub remaining: Option<f64>,
    pub reserved: Option<f64>,
}
pub fn resolve_agent_hours(usage: Option<&Usage>) -> AgentHours {
    let Some(usage) = usage else {
        return AgentHours::default();
    };
    let runtime = &usage.runtime;
    let allowance = runtime.allowance.as_ref();
    let seconds = allowance.map_or(DEFAULT_UNIT_SECONDS, |a| a.unit_seconds);
    let hours = |units: f64| Some(units_to_hours(units, seconds));
    let (used, total, reserved) = match allowance {
        Some(a) => (
            hours(a.consumed_units as f64),
            hours(a.granted_units as f64),
            hours(a.reserved_units as f64),
        ),
        None => (
            hours(runtime.consumed_units as f64),
            hours(runtime.granted_units as f64),
            hours(runtime.reserved_units as f64),
        ),
    };
    let remaining = match (allowance, total, used) {
        (Some(_), Some(total), Some(used)) => Some((total - used - reserved.unwrap_or(0.)).max(0.)),
        _ => hours(runtime.available_units as f64),
    };
    AgentHours {
        used,
        total,
        remaining,
        reserved,
    }
}

/// `AllowanceReading`: this period's agent hours and storage against what
/// the plan includes. A meter is only drawn against an authoritative
/// reading; without one the page states what the plan includes.
#[derive(Clone, Debug, PartialEq)]
pub struct AllowanceReading {
    pub used_hours: Option<f64>,
    pub included_hours: f64,
    pub resets_at: Option<String>,
    pub used_bytes: Option<u64>,
    pub included_bytes: Option<u64>,
}
pub fn resolve_allowance(
    usage: Option<&Usage>,
    offer: &PlanOffer,
    holding: &PlanHolding,
    add_ons: &[AddOnOffer],
) -> AllowanceReading {
    let held = |add_on: &AddOnOffer| holding.add_ons.get(&add_on.id).copied().unwrap_or(0);
    let extra_hours: f64 = add_ons.iter().map(|a| a.hours * held(a) as f64).sum();
    let extra_bytes: u64 = add_ons.iter().map(|a| a.storage_bytes * held(a)).sum();
    let seats = if offer.per_person { holding.seats } else { 1 };
    let plan_hours = offer.agent_hours * seats as f64 + extra_hours;
    let plan_bytes = offer.storage_bytes.map(|b| b * seats + extra_bytes);
    let allowance = usage.and_then(|u| u.runtime.allowance.as_ref());
    AllowanceReading {
        used_hours: allowance.map(|a| units_to_hours(a.consumed_units as f64, a.unit_seconds)),
        included_hours: match allowance {
            Some(a) if a.granted_units > 0 => {
                units_to_hours(a.granted_units as f64, a.unit_seconds)
            }
            _ => plan_hours,
        },
        resets_at: allowance
            .and_then(|a| a.resets_at.clone())
            .or_else(|| holding.renews_at.clone()),
        used_bytes: usage.map(|u| u.storage.logical_bytes),
        included_bytes: usage.and_then(|u| u.storage.limit_bytes).or(plan_bytes),
    }
}

/// `meterTone`: calm, then a warning from 80%, then exhausted from 90%.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeterTone {
    Calm,
    Warning,
    Exhausted,
}
pub fn meter_tone(percent: f64) -> MeterTone {
    if percent >= 90. {
        MeterTone::Exhausted
    } else if percent >= 80. {
        MeterTone::Warning
    } else {
        MeterTone::Calm
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;

    const GB: u64 = BYTES_PER_GB;

    /// `planSubscription.test.tsx`'s 2026-11-09.2 catalog.
    fn catalog() -> Catalog {
        let required = json!({"access_surface.agent": true, "remote_workspace.create": true});
        let mut team = required.clone();
        team["team.member_roles"] = json!(true);
        team["billing.consolidated"] = json!(true);
        serde_json::from_value(json!({
            "schema_version": "1.1",
            "runtime": {"unit_seconds": 60, "charged_sources": ["agent", "automation"]},
            "plans": [
                {"id": "free", "aliases": [], "name": "Free", "public": true, "purchasable": false,
                    "currency": "USD", "price_per_seat_cents": 0, "seats": {"minimum": 1, "maximum": 1},
                    "features": required, "runtime": {"fixed_units": 300, "units_per_seat": 0},
                    "per_seat_limits": {}, "fixed_limits": {"projects.max": 1,
                        "storage.max_bytes": GB, "history.retention_days": 30}},
                {"id": "personal", "aliases": ["plus"], "name": "Personal", "public": true,
                    "purchasable": true, "currency": "USD", "price_per_seat_cents": 2000,
                    "seats": {"minimum": 1, "maximum": 1}, "features": required,
                    "runtime": {"fixed_units": 2400, "units_per_seat": 0}, "per_seat_limits": {},
                    "fixed_limits": {"projects.max": 20, "storage.max_bytes": 10 * GB,
                        "history.retention_days": 30}},
                {"id": "team", "aliases": ["business"], "name": "Team", "public": true,
                    "purchasable": true, "currency": "USD", "price_per_seat_cents": 4000,
                    "seats": {"minimum": 2, "maximum": null}, "features": team,
                    "runtime": {"fixed_units": 0, "units_per_seat": 2400},
                    "fixed_limits": {"history.retention_days": 365},
                    "per_seat_limits": {"projects.max": 20, "storage.max_bytes": 20 * GB}},
                {"id": "team_v2", "aliases": [], "name": "Team", "public": true, "purchasable": true,
                    "currency": "USD", "price_per_seat_cents": 2000, "seats": {"minimum": 1, "maximum": null},
                    "features": {"team.member_roles": true, "billing.consolidated": true},
                    "runtime": {"fixed_units": 0, "units_per_seat": 2400},
                    "fixed_limits": {"history.retention_days": 30},
                    "per_seat_limits": {"projects.max": 20, "storage.max_bytes": 10 * GB}},
                {"id": "enterprise_v2", "aliases": [], "name": "Enterprise", "public": true,
                    "purchasable": true, "currency": "USD", "price_per_seat_cents": 4000,
                    "seats": {"minimum": 1, "maximum": null}, "features": team,
                    "runtime": {"fixed_units": 0, "units_per_seat": 2400},
                    "fixed_limits": {"history.retention_days": 365},
                    "per_seat_limits": {"projects.max": 20, "storage.max_bytes": 20 * GB}},
            ],
            "add_ons": [
                {"id": "agent_hours_100", "name": "Extra agent hours", "price_cents": 500,
                    "currency": "USD", "available_on_plans": ["personal", "team"], "max_quantity": 20,
                    "runtime_units": 6000, "limit_increments": {}},
                {"id": "storage_10gb", "name": "Extra storage", "price_cents": 500, "currency": "USD",
                    "available_on_plans": ["personal", "team"], "max_quantity": 50, "runtime_units": 0,
                    "limit_increments": {"storage.max_bytes": 10 * GB}},
            ],
        }))
        .unwrap()
    }
    fn summary(extra: serde_json::Value) -> Summary {
        let mut value = json!({"org_id": "o1", "plan_id": "personal", "status": "active",
            "seat_quantity": 1, "current_period_end": null, "cancel_at_period_end": false});
        value
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(value).unwrap()
    }
    fn usage(used_units: u64, granted_units: u64, used_bytes: u64, limit: Option<u64>) -> Usage {
        serde_json::from_value(json!({
            "runtime": {"org_id": "o1", "allowance": {"granted_units": granted_units,
                "consumed_units": used_units, "reserved_units": 0,
                "resets_at": "2026-12-01T00:00:00Z", "unit_seconds": 60}},
            "storage": {"logical_bytes": used_bytes, "limit_bytes": limit}}))
        .unwrap()
    }

    #[test]
    fn offers_three_plans_with_one_price_each_and_the_same_allowances() {
        let view = resolve_catalog(None);
        assert!(!view.authoritative);
        assert_eq!(
            view.plans
                .iter()
                .map(|p| (p.id, p.price_cents, p.per_person))
                .collect::<Vec<_>>(),
            [
                (PlanId::Free, 0, false),
                (PlanId::Team, 2000, true),
                (PlanId::Enterprise, 4000, true)
            ]
        );
        assert_eq!(
            view.plans.iter().map(|p| p.agent_hours).collect::<Vec<_>>(),
            [5., 40., 40.]
        );
        assert_eq!(
            view.plans
                .iter()
                .map(|p| p.storage_bytes)
                .collect::<Vec<_>>(),
            [Some(GB), Some(10 * GB), Some(20 * GB)]
        );
        // Indicative offers carry no catalog plan, so nothing can be bought.
        assert!(view.plans.iter().all(|p| p.catalog_plan.is_none()));
    }

    #[test]
    fn reads_plans_and_add_ons_from_the_catalog_in_hours_and_bytes() {
        let catalog = catalog();
        let view = resolve_catalog(Some(&catalog));
        assert!(view.authoritative);
        let team = view.plan(PlanId::Team).unwrap();
        assert_eq!(
            (
                team.per_person,
                team.minimum_seats,
                team.agent_hours,
                team.storage_bytes
            ),
            (true, 1, 40., Some(10 * GB))
        );
        assert!(team.team_features);
        assert_eq!(view.plan(PlanId::Free).unwrap().agent_hours, 5.);
        assert_eq!(
            view.add_ons
                .iter()
                .map(|a| (a.id.as_str(), a.kind, a.hours, a.storage_bytes))
                .collect::<Vec<_>>(),
            [
                ("agent_hours_100", AddOnKind::Hours, 100., 0),
                ("storage_10gb", AddOnKind::Storage, 0., 10 * GB)
            ]
        );
    }

    #[test]
    fn keeps_indicative_prices_when_the_catalog_is_an_older_price_list() {
        let mut legacy = catalog();
        legacy.plans.retain(|p| p.id != "enterprise_v2");
        assert!(!resolve_catalog(Some(&legacy)).authoritative);
    }

    #[test]
    fn treats_holding_nothing_as_free_a_complete_answer() {
        let holding = resolve_holding(None, None);
        assert_eq!(
            (
                holding.subscribed,
                holding.plan_id.as_str(),
                holding.monthly_cents
            ),
            (false, "free", Some(0))
        );
        let pending = summary(json!({"status": "checkout_pending"}));
        let pending = resolve_holding(Some(&pending), Some(&catalog()));
        assert!(!pending.subscribed);
        // The status read stays, though nothing paid is held.
        assert_eq!(pending.status.as_deref(), Some("checkout_pending"));
    }

    #[test]
    fn bills_a_team_per_person_and_names_a_legacy_plan_by_its_new_name() {
        let catalog = catalog();
        let team = resolve_holding(
            Some(&summary(json!({"plan_id": "business", "seat_quantity": 5}))),
            Some(&catalog),
        );
        assert_eq!(
            (team.plan_id.as_str(), team.seats, team.monthly_cents),
            ("enterprise", 5, Some(20000))
        );
        let held = resolve_holding(
            Some(&summary(json!({"add_ons": [
                {"add_on_id": "agent_hours_100", "quantity": 2, "status": "active",
                    "cancel_at_period_end": false, "current_period_end": null},
                {"add_on_id": "storage_10gb", "quantity": 1, "status": "cancel_scheduled",
                    "cancel_at_period_end": true, "current_period_end": null}]}))),
            Some(&catalog),
        );
        // A pack scheduled to end is not counted as held going forward.
        assert_eq!(
            held.add_ons,
            BTreeMap::from([("agent_hours_100".to_owned(), 2)])
        );
    }

    #[test]
    fn pools_a_teams_hours_and_storage_and_adds_the_packs_held() {
        let catalog = catalog();
        let view = resolve_catalog(Some(&catalog));
        let holding = resolve_holding(
            Some(&summary(
                json!({"plan_id": "team_v2", "seat_quantity": 3, "add_ons": [
                {"add_on_id": "agent_hours_100", "quantity": 1, "status": "active",
                    "cancel_at_period_end": false, "current_period_end": null}]}),
            )),
            Some(&catalog),
        );
        let reading = resolve_allowance(
            None,
            view.plan(PlanId::Team).unwrap(),
            &holding,
            &view.add_ons,
        );
        assert_eq!(
            (
                reading.used_hours,
                reading.included_hours,
                reading.included_bytes
            ),
            (None, 220., Some(30 * GB))
        );
    }

    #[test]
    fn reads_used_hours_only_from_the_billing_service_never_invents_them() {
        let catalog = catalog();
        let view = resolve_catalog(Some(&catalog));
        let holding = resolve_holding(Some(&summary(json!({}))), Some(&catalog));
        let used_bytes = 3_200_000_000;
        let reading = resolve_allowance(
            Some(&usage(12 * 60, 40 * 60, used_bytes, Some(10 * GB))),
            view.plan(PlanId::Team).unwrap(),
            &holding,
            &view.add_ons,
        );
        assert_eq!(
            (
                reading.used_hours,
                reading.included_hours,
                reading.used_bytes,
                reading.included_bytes
            ),
            (Some(12.), 40., Some(used_bytes), Some(10 * GB))
        );
    }

    #[test]
    fn reads_a_scheduled_seat_decrease_and_a_scheduled_downgrade_from_the_summary() {
        let catalog = catalog();
        let scheduled = json!({"plan_id": "team_v2", "seat_quantity": 3,
            "current_period_end": "2026-12-08T12:00:00Z", "pending_plan_id": null,
            "pending_seat_quantity": 2, "pending_effective_at": "2026-12-08T12:00:00Z"});
        assert_eq!(
            resolve_holding(Some(&summary(scheduled.clone())), Some(&catalog)).scheduled,
            Some(Scheduled {
                plan_id: "team".into(),
                seats: 2,
                effective_at: "2026-12-08T12:00:00Z".into()
            })
        );
        let mut downgrade = scheduled;
        downgrade["pending_plan_id"] = json!("plus");
        downgrade["pending_seat_quantity"] = json!(1);
        assert_eq!(
            resolve_holding(Some(&summary(downgrade)), Some(&catalog))
                .scheduled
                .unwrap()
                .plan_id,
            "team"
        );
        // A change still waiting on the payment service is not a schedule.
        let waiting = summary(json!({"status": "change_pending", "pending_plan_id": "team"}));
        assert_eq!(
            resolve_holding(Some(&waiting), Some(&catalog)).scheduled,
            None
        );
    }

    /// `resolveAgentHours`: the allowance's remaining hours leave out what
    /// is reserved; a legacy balance reads its own available units.
    #[test]
    fn agent_hours_come_from_the_allowance_or_the_legacy_balance() {
        let mut reading = usage(600, 2400, 0, None);
        reading.runtime.allowance.as_mut().unwrap().reserved_units = 60;
        assert_eq!(
            resolve_agent_hours(Some(&reading)),
            AgentHours {
                used: Some(10.),
                total: Some(40.),
                remaining: Some(29.),
                reserved: Some(1.)
            }
        );
        let legacy: Usage = serde_json::from_value(json!({"runtime": {"org_id": "o1",
            "available_units": 120, "consumed_units": 300, "granted_units": 0}, "storage": {}}))
        .unwrap();
        let hours = resolve_agent_hours(Some(&legacy));
        assert_eq!((hours.used, hours.remaining), (Some(5.), Some(2.)));
        assert_eq!(resolve_agent_hours(None), AgentHours::default());
    }

    #[test]
    fn the_meter_warns_from_80_and_is_exhausted_from_90() {
        assert_eq!(meter_tone(79.9), MeterTone::Calm);
        assert_eq!(meter_tone(80.), MeterTone::Warning);
        assert_eq!(meter_tone(90.), MeterTone::Exhausted);
    }
}
