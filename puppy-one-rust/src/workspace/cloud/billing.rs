//! `billing.md`, `cloudBillingState.ts` and the billing half of `cloudApi.ts`.
//! Desktop never computes a price or treats a browser return as payment: it
//! asks for a server quote, confirms it, opens the validated URL and waits
//! for the server's state. A mutation's idempotency key is stable across
//! retries of one intent and never crosses an account or Organization.
use super::services::{Error, Result, Transport};
use crate::cloud::auth::model::ApiRequest;
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc, time::Duration};

/// `BILLING_POLL_BACKOFF_MS`.
pub const POLL_BACKOFF_MS: [u64; 5] = [2_000, 4_000, 8_000, 15_000, 30_000];
pub fn poll_delay(attempt: usize) -> Duration {
    Duration::from_millis(POLL_BACKOFF_MS[attempt.min(POLL_BACKOFF_MS.len() - 1)])
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct SeatPolicy {
    #[serde(default)]
    pub minimum: u64,
    #[serde(default)]
    pub maximum: Option<u64>,
}
/// `DesktopBillingPlan.runtime`: agent time included, in runtime units.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct PlanRuntime {
    #[serde(default)]
    pub fixed_units: u64,
    #[serde(default)]
    pub units_per_seat: u64,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Plan {
    pub id: String,
    /// Earlier ids that name this plan (`plus`, `personal`, …).
    #[serde(default)]
    pub aliases: Vec<String>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub public: bool,
    #[serde(default)]
    pub purchasable: bool,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub price_per_seat_cents: Option<i64>,
    #[serde(default)]
    pub seats: SeatPolicy,
    #[serde(default)]
    pub per_seat_limits: HashMap<String, Value>,
    #[serde(default)]
    pub fixed_limits: HashMap<String, Value>,
    #[serde(default)]
    pub features: HashMap<String, bool>,
    #[serde(default)]
    pub runtime: PlanRuntime,
    /// Which kinds of space may hold this plan; empty or absent means any.
    /// Validated, never used to filter (v0.4.4).
    #[serde(default)]
    pub space_kinds: Option<Vec<String>>,
}
impl Plan {
    /// `planStorageBytes`: what one person gets, if the plan says.
    pub fn storage_bytes(&self) -> Option<u64> {
        self.per_seat_limits
            .get("storage.max_bytes")
            .or_else(|| self.fixed_limits.get("storage.max_bytes"))
            .and_then(Value::as_u64)
    }
}
/// `DesktopBillingAddOn`: a monthly pack sold on top of a paid plan.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct AddOn {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub price_cents: i64,
    pub currency: String,
    pub available_on_plans: Vec<String>,
    pub max_quantity: i64,
    /// Runtime units each pack adds every period.
    pub runtime_units: i64,
    /// Limits each pack raises, by limit key.
    pub limit_increments: HashMap<String, Value>,
}
impl AddOn {
    /// Bytes of storage each pack adds.
    pub fn storage_bytes(&self) -> u64 {
        self.limit_increments
            .get("storage.max_bytes")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    }
}
/// `DesktopBillingCatalog.runtime`, as far as Desktop reads it.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct CatalogRuntime {
    #[serde(default)]
    pub unit_seconds: u64,
    /// Runtime kinds that spend the organization's agent hours; `None`
    /// means every kind.
    #[serde(default)]
    pub charged_sources: Option<Vec<String>>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Catalog {
    pub schema_version: String,
    pub plans: Vec<Plan>,
    /// Absent from catalogs published before add-ons existed.
    #[serde(default)]
    pub add_ons: Option<Vec<AddOn>>,
    #[serde(default)]
    pub runtime: CatalogRuntime,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Summary {
    pub org_id: String,
    pub plan_id: String,
    pub status: String,
    pub seat_quantity: u64,
    #[serde(default)]
    pub pending_plan_id: Option<String>,
    /// A downgrade or seat decrease waiting for renewal; absent from older
    /// servers.
    #[serde(default)]
    pub pending_seat_quantity: Option<u64>,
    #[serde(default)]
    pub pending_effective_at: Option<String>,
    #[serde(default)]
    pub cancel_at_period_end: bool,
    #[serde(default)]
    pub current_period_end: Option<String>,
    #[serde(default)]
    pub portal_available: bool,
    #[serde(default)]
    pub seat_changes_available: bool,
    #[serde(default)]
    pub catalog_version: Option<String>,
    #[serde(default)]
    pub source_revision: Option<u64>,
    /// Add-ons held right now; absent from older billing services.
    #[serde(default)]
    pub add_ons: Option<Vec<AddOnHolding>>,
}
/// `DesktopBillingAddOnHolding`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct AddOnHolding {
    pub add_on_id: String,
    pub quantity: u64,
    #[serde(default)]
    pub status: String,
    pub cancel_at_period_end: bool,
    #[serde(default)]
    pub current_period_end: Option<String>,
}
impl Summary {
    /// `NOT_HELD`: free, a checkout not yet paid, or revoked.
    pub fn held(&self) -> bool {
        !matches!(
            self.status.as_str(),
            "free" | "checkout_pending" | "revoked"
        )
    }
}
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Storage {
    #[serde(default)]
    pub logical_bytes: u64,
    #[serde(default)]
    pub limit_bytes: Option<u64>,
    #[serde(default)]
    pub percent: Option<u64>,
    /// `0`, `80`, `95` or `100`: the warning the server has reached.
    #[serde(default)]
    pub threshold_percent: u64,
}
/// `DesktopRuntimeAllowance`: this period's included agent time.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Allowance {
    pub granted_units: u64,
    pub consumed_units: u64,
    pub reserved_units: u64,
    #[serde(default)]
    pub resets_at: Option<String>,
    pub unit_seconds: u64,
}
/// `DesktopRuntimeBalance`: amounts the server counted, shown as they are.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Runtime {
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub available_units: i64,
    #[serde(default)]
    pub reserved_units: i64,
    #[serde(default)]
    pub consumed_units: i64,
    #[serde(default)]
    pub granted_units: i64,
    /// Absent from older billing services.
    #[serde(default)]
    pub allowance: Option<Allowance>,
}
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct Usage {
    #[serde(default)]
    pub runtime: Runtime,
    #[serde(default)]
    pub storage: Storage,
}
/// `catalogPersonalOffer`: one plan is sold, the cheapest public paid one. A
/// purchase cannot start without it: an amount charged comes from the
/// billing authority, never from a number the client rendered.
pub fn personal_offer(catalog: &Catalog) -> Option<&Plan> {
    catalog
        .plans
        .iter()
        .filter(|p| p.public && p.price_per_seat_cents.is_some_and(|c| c > 0))
        .min_by_key(|p| p.price_per_seat_cents)
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Quote {
    pub quote_id: String,
    pub org_id: String,
    pub target_plan_id: String,
    pub target_seats: u64,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub delta_amount_cents: i64,
    #[serde(default)]
    pub target_amount_cents: i64,
    /// `checkout | plan_change | seat_change`.
    pub application_mode: String,
    /// Downgrades and seat decreases wait for renewal (`next_period`);
    /// absent from older servers.
    #[serde(default)]
    pub effective: Option<String>,
    pub expires_at: String,
    #[serde(default)]
    pub details: Value,
}
/// `DesktopBillingAddOnChange`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct AddOnChange {
    pub org_id: String,
    pub add_on_id: String,
    pub current_quantity: u64,
    pub target_quantity: u64,
    pub monthly_amount_cents: u64,
    pub currency: String,
    /// `checkout`, `pending_provider_confirmation` or `unchanged`.
    pub outcome: String,
    #[serde(default)]
    pub checkout_url: Option<String>,
    /// `now` or `next_period`.
    pub effective: String,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Operation {
    pub id: String,
    pub org_id: String,
    pub kind: String,
    pub state: String,
    pub terminal: bool,
    #[serde(default)]
    pub action_required: bool,
    #[serde(default)]
    pub target_plan_id: Option<String>,
    #[serde(default)]
    pub target_seat_quantity: Option<u64>,
    #[serde(default)]
    pub quote_id: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Access {
    pub org_id: String,
    pub can_manage_billing: bool,
}

/// The rejection the view reports (`cloud.billing.*`).
pub const MISMATCH: &str = "cloud.billing.organizationMismatch";
/// `Error::Invalid` for an operation that is not the one asked for. Unlike a
/// malformed answer, this one is not worth asking again.
pub const FOREIGN: &str = "billing-foreign";
pub const EXPIRED: &str = "cloud.billing.quoteExpired";

/// `assertQuoteNotExpired`: an unreadable time is expired.
pub fn quote_live(quote: &Quote, now: chrono::DateTime<chrono::Utc>) -> bool {
    chrono::DateTime::parse_from_rfc3339(&quote.expires_at).is_ok_and(|at| at > now)
}
/// `assertReturnedQuoteMatches`.
pub fn same_quote(returned: &Quote, requested: &Quote, org: &str) -> bool {
    returned.org_id == org
        && returned.quote_id == requested.quote_id
        && returned.target_plan_id == requested.target_plan_id
        && returned.target_seats == requested.target_seats
        && returned.application_mode == requested.application_mode
}
/// `assertOperationMatchesQuote`.
pub fn operation_matches(
    operation: &Operation,
    quote: &Quote,
    org: &str,
    expected: Option<&str>,
) -> bool {
    operation.org_id == org
        && expected.is_none_or(|id| operation.id == id)
        && operation.quote_id.as_deref() == Some(quote.quote_id.as_str())
        && operation.target_plan_id.as_deref() == Some(quote.target_plan_id.as_str())
        && operation.target_seat_quantity == Some(quote.target_seats)
}
/// `resumableBillingOperation`.
pub fn resumable(operations: &[Operation]) -> Option<&Operation> {
    operations.iter().find(|o| {
        matches!(
            o.kind.as_str(),
            "checkout" | "plan_change" | "seat_increase" | "seat_decrease"
        ) && matches!(
            o.state.as_str(),
            "pending" | "processing" | "retryable_failed"
        ) && !o.terminal
    })
}
/// `loadSucceeded`: what was seen to end stays ended. A list that lags behind
/// the operation would otherwise reopen it and start watching it again.
pub fn keep_ended(observed: &[Operation], incoming: Vec<Operation>) -> Vec<Operation> {
    incoming
        .into_iter()
        .map(|operation| {
            observed
                .iter()
                .find(|o| o.id == operation.id && o.terminal && !operation.terminal)
                .cloned()
                .unwrap_or(operation)
        })
        .collect()
}
/// `pendingBillingOperations`.
pub fn pending(operations: &[Operation]) -> Vec<&Operation> {
    operations.iter().filter(|o| !o.terminal).collect()
}
fn member_seat(operation: &Operation) -> bool {
    matches!(
        operation.kind.as_str(),
        "member_activation" | "member_deactivation"
    )
}
/// `actionableSeatOperation`: a member change the server is waiting on the
/// owner to pay for or release.
pub fn actionable_seat(operations: &[Operation]) -> Option<&Operation> {
    operations.iter().find(|o| {
        !o.terminal
            && member_seat(o)
            && o.action_required
            && o.target_seat_quantity.is_some_and(|seats| seats > 0)
    })
}
/// A seat quote for exactly what a member change needs settles that change.
pub fn seat_operation(operations: &[Operation], seats: u64) -> Option<&Operation> {
    operations
        .iter()
        .find(|o| !o.terminal && member_seat(o) && o.target_seat_quantity == Some(seats))
}
/// Whether the quote lands somewhere other than what was asked for: the
/// owner has to see that before confirming.
pub fn crosses_boundary(quote: &Quote, requested_plan: Option<&str>) -> bool {
    requested_plan != Some(quote.target_plan_id.as_str())
        || quote.details["crosses_plan_boundary"] == Value::Bool(true)
}
/// `clampBillingSeats`.
pub fn clamp_seats(value: u64, plan: &Plan) -> u64 {
    let minimum = plan.seats.minimum.max(1);
    value
        .max(minimum)
        .min(plan.seats.maximum.unwrap_or(u64::MAX))
}
/// `openCloudBillingExternalUrl`: HTTPS (HTTP on loopback only), no
/// credentials, no control characters raw or encoded.
pub fn safe_url(href: &str) -> Option<String> {
    let lower = href.to_ascii_lowercase();
    let encoded_control = lower.match_indices('%').any(|(i, _)| {
        let code = lower.get(i + 1..i + 3).unwrap_or("");
        code.starts_with('0') || code.starts_with('1') || code == "7f"
    });
    if href.chars().any(|c| c.is_control()) || encoded_control {
        return None;
    }
    let url = url::Url::parse(href).ok()?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    let scheme = url.scheme() == "https" || (loopback && url.scheme() == "http");
    (scheme && url.username().is_empty() && url.password().is_none()).then(|| url.to_string())
}

/// `idempotencyKeyFor`: one key per intent, until it is cleared or the
/// context changes (a new `Keys`).
#[derive(Debug, Default)]
pub struct Keys(HashMap<String, String>);
impl Keys {
    pub fn key(&mut self, intent: &str, scope: &str) -> String {
        self.0
            .entry(intent.to_owned())
            .or_insert_with(|| format!("desktop:{scope}:{}", uuid::Uuid::new_v4()))
            .clone()
    }
    pub fn forget(&mut self, intent: &str) {
        self.0.remove(intent);
    }
}

/// `{code, data}` yields `data`.
fn payload(value: Value) -> Value {
    match value {
        Value::Object(mut map) if map.contains_key("data") => {
            map.remove("data").unwrap_or(Value::Null)
        }
        value => value,
    }
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(payload(value)).map_err(|_| Error::Invalid("billing"))
}
/// `requireBillingString`.
fn filled(value: &str) -> bool {
    !value.trim().is_empty()
}
/// `requireBillingOptionalTimestamp`.
fn timestamp(value: Option<&str>) -> bool {
    value.is_none_or(|at| chrono::DateTime::parse_from_rfc3339(at).is_ok())
}
fn check(valid: bool) -> Result<()> {
    if valid {
        Ok(())
    } else {
        Err(Error::Invalid("billing"))
    }
}
/// `validateDesktopBillingCatalog`'s v0.4.4 additions: a plan's space kinds
/// and the add-ons, which never carry the provider's private data.
fn check_catalog_additions(raw: &Value, catalog: &Catalog) -> Result<()> {
    for plan in &catalog.plans {
        check(plan.space_kinds.as_ref().is_none_or(|kinds| {
            kinds
                .iter()
                .all(|kind| kind == "personal" || kind == "team")
        }))?;
    }
    if let Some(add_ons) = &catalog.add_ons {
        check(
            raw["add_ons"]
                .as_array()
                .is_some_and(|rows| rows.iter().all(|row| row.get("provider").is_none())),
        )?;
        for add_on in add_ons {
            check(
                filled(&add_on.id)
                    && filled(&add_on.name)
                    && filled(&add_on.currency)
                    && add_on.price_cents >= 1
                    && add_on.max_quantity >= 1
                    && add_on.runtime_units >= 0
                    && add_on.available_on_plans.iter().all(|p| filled(p))
                    && add_on
                        .limit_increments
                        .values()
                        .all(|v| v.as_u64().is_some()),
            )?;
        }
    }
    Ok(())
}
/// `validateDesktopBillingSummary`'s v0.4.4 additions.
fn check_summary_additions(summary: &Summary) -> Result<()> {
    check(
        summary.pending_seat_quantity.is_none_or(|n| n >= 1)
            && timestamp(summary.pending_effective_at.as_deref())
            && summary.add_ons.iter().flatten().all(|held| {
                filled(&held.add_on_id) && timestamp(held.current_period_end.as_deref())
            }),
    )
}
/// `validateDesktopBillingUsage`'s allowance and storage reading.
fn check_usage(usage: &Usage) -> Result<()> {
    check(
        usage
            .runtime
            .allowance
            .as_ref()
            .is_none_or(|a| a.unit_seconds >= 1 && timestamp(a.resets_at.as_deref()))
            && [0, 80, 95, 100].contains(&usage.storage.threshold_percent)
            && usage.storage.limit_bytes.is_none_or(|b| b >= 1)
            && usage.storage.percent.is_none_or(|p| p <= 100),
    )
}
/// `quote.effective`, when the server states it.
fn check_quote(quote: &Quote) -> Result<()> {
    check(
        quote
            .effective
            .as_deref()
            .is_none_or(|e| e == "now" || e == "next_period"),
    )
}
fn segment(id: &str) -> Result<&str> {
    if !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Ok(id)
    } else {
        Err(Error::Invalid("billing"))
    }
}

#[derive(Clone)]
pub struct Client {
    transport: Arc<dyn Transport>,
}
impl Client {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport }
    }
    fn send(
        &self,
        method: Method,
        path: String,
        body: Option<Value>,
        key: Option<String>,
    ) -> Result<Value> {
        self.transport.request(ApiRequest {
            method,
            path,
            query: vec![],
            body,
            idempotency_key: key,
        })
    }
    fn path(org: &str, suffix: &str) -> Result<String> {
        Ok(format!("/billing/organizations/{}/{suffix}", segment(org)?))
    }
    /// `validateDesktopBillingCatalog`: a supported schema with unique plans.
    pub fn catalog(&self) -> Result<Catalog> {
        let raw = payload(self.send(Method::GET, "/billing/catalog".into(), None, None)?);
        let catalog: Catalog = decode(raw.clone())?;
        check_catalog_additions(&raw, &catalog)?;
        let mut ids = std::collections::HashSet::new();
        if catalog.schema_version.split('.').next() != Some("1")
            || catalog.plans.is_empty()
            || !catalog.plans.iter().all(|p| ids.insert(p.id.clone()))
        {
            return Err(Error::Invalid("billing"));
        }
        Ok(catalog)
    }
    pub fn access(&self, org: &str) -> Result<Access> {
        let path = format!("/organizations/{}/access", segment(org)?);
        let access: Access = decode(self.send(Method::GET, path, None, None)?)?;
        if access.org_id != org {
            return Err(Error::Invalid("billing"));
        }
        Ok(access)
    }
    pub fn summary(&self, org: &str) -> Result<Summary> {
        let summary: Summary =
            decode(self.send(Method::GET, Self::path(org, "summary")?, None, None)?)?;
        if summary.org_id != org {
            return Err(Error::Invalid("billing"));
        }
        check_summary_additions(&summary)?;
        Ok(summary)
    }
    pub fn usage(&self, org: &str) -> Result<Usage> {
        let usage: Usage =
            decode(self.send(Method::GET, Self::path(org, "usage")?, None, None)?)?;
        check_usage(&usage)?;
        Ok(usage)
    }
    /// `changeCloudBillingAddOn`: hold `quantity` packs of one add-on; zero
    /// cancels at the period end. A checkout outcome must carry a safe URL.
    pub fn change_add_on(
        &self,
        org: &str,
        add_on: &str,
        quantity: u64,
        key: String,
    ) -> Result<AddOnChange> {
        let path = Self::path(org, &format!("add-ons/{}", segment(add_on)?))?;
        let change: AddOnChange = decode(self.send(
            Method::PUT,
            path,
            Some(json!({"quantity": quantity})),
            Some(key),
        )?)?;
        check(
            change.org_id == org
                && change.add_on_id == add_on
                && filled(&change.currency)
                && ["checkout", "pending_provider_confirmation", "unchanged"]
                    .contains(&change.outcome.as_str())
                && (change.effective == "now" || change.effective == "next_period")
                && (change.outcome != "checkout"
                    || change.checkout_url.as_deref().and_then(safe_url).is_some()),
        )?;
        Ok(change)
    }
    pub fn organizations(&self) -> Result<Vec<String>> {
        let rows: Vec<Value> =
            decode(self.send(Method::GET, "/organizations/".into(), None, None)?)?;
        Ok(rows
            .iter()
            .filter_map(|o| o["id"].as_str().map(str::to_owned))
            .collect())
    }
    pub fn operations(&self, org: &str) -> Result<Vec<Operation>> {
        let rows: Vec<Operation> =
            decode(self.send(Method::GET, Self::path(org, "operations")?, None, None)?)?;
        if rows.iter().any(|o| o.org_id != org) {
            return Err(Error::Invalid("billing"));
        }
        Ok(rows)
    }
    pub fn operation(&self, org: &str, id: &str) -> Result<Operation> {
        let path = Self::path(org, &format!("operations/{}", segment(id)?))?;
        let operation: Operation = decode(self.send(Method::GET, path, None, None)?)?;
        if operation.org_id != org || operation.id != id {
            return Err(Error::Invalid(FOREIGN));
        }
        Ok(operation)
    }
    pub fn quote_plan(&self, org: &str, plan: &str, seats: u64, key: String) -> Result<Quote> {
        let body = json!({"target_plan_id": plan, "seat_quantity": seats});
        let quote: Quote = decode(self.send(
            Method::POST,
            Self::path(org, "plan/quote")?,
            Some(body),
            Some(key),
        )?)?;
        if quote.org_id != org {
            return Err(Error::Invalid("billing"));
        }
        check_quote(&quote)?;
        Ok(quote)
    }
    /// `quoteCloudBillingSeats`, tied to the member change it settles.
    pub fn quote_seats(
        &self,
        org: &str,
        seats: u64,
        operation: Option<&str>,
        key: String,
    ) -> Result<Quote> {
        let mut body = json!({"seat_quantity": seats});
        if let Some(operation) = operation {
            body["operation_id"] = json!(operation);
        }
        let quote: Quote = decode(self.send(
            Method::POST,
            Self::path(org, "seats/quote")?,
            Some(body),
            Some(key),
        )?)?;
        if quote.org_id != org {
            return Err(Error::Invalid("billing"));
        }
        check_quote(&quote)?;
        Ok(quote)
    }
    /// The URL is checked before it is returned; only then may it open.
    pub fn checkout(
        &self,
        org: &str,
        quote: &Quote,
        operation: Option<&str>,
        key: String,
    ) -> Result<(String, Quote, Operation)> {
        let mut body = json!({"plan_id": quote.target_plan_id, "seat_quantity": quote.target_seats,
            "quote_id": quote.quote_id});
        if let Some(operation) = operation {
            body["operation_id"] = json!(operation);
        }
        let value = payload(self.send(
            Method::POST,
            Self::path(org, "checkout")?,
            Some(body),
            Some(key),
        )?);
        let url = value["checkout_url"]
            .as_str()
            .and_then(safe_url)
            .ok_or(Error::Invalid("billing"))?;
        Ok((
            url,
            decode(value["quote"].clone())?,
            decode(value["operation"].clone())?,
        ))
    }
    /// `applyCloudBillingPlanChange` / `applyCloudBillingSeatChange`.
    pub fn apply(
        &self,
        org: &str,
        quote: &Quote,
        operation: Option<&str>,
        key: String,
    ) -> Result<(Quote, Operation)> {
        let seats = quote.application_mode == "seat_change";
        let mut body = json!({"quote_id": quote.quote_id});
        if seats && let Some(operation) = operation {
            body["operation_id"] = json!(operation);
        }
        let suffix = if seats { "seats/change" } else { "plan/change" };
        let value = payload(self.send(
            Method::POST,
            Self::path(org, suffix)?,
            Some(body),
            Some(key),
        )?);
        Ok((decode(value.clone())?, decode(value["operation"].clone())?))
    }
    pub fn portal(&self, org: &str, key: String) -> Result<String> {
        let value =
            payload(self.send(Method::POST, Self::path(org, "portal")?, None, Some(key))?);
        value["portal_url"]
            .as_str()
            .and_then(safe_url)
            .ok_or(Error::Invalid("billing"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    struct Reply(Value);
    impl Transport for Reply {
        fn request(&self, _: ApiRequest) -> Result<Value> {
            Ok(self.0.clone())
        }
    }
    fn client(value: Value) -> Client {
        Client::new(Arc::new(Reply(value)))
    }
    fn lifecycle(id: &str, terminal: bool) -> Operation {
        serde_json::from_value(json!({"id": id, "org_id": "o", "kind": "checkout",
            "state": if terminal { "succeeded" } else { "processing" }, "terminal": terminal}))
        .unwrap()
    }
    fn catalog(add_ons: Value) -> Value {
        json!({"schema_version": "1.0", "runtime": {"unit_seconds": 60},
            "plans": [{"id": "free", "name": "Free", "space_kinds": ["personal", "team"]}],
            "add_ons": add_ons})
    }
    fn add_on() -> Value {
        json!({"id": "agent_hours_100", "name": "Hours", "price_cents": 500, "currency": "USD",
            "available_on_plans": ["team_v2"], "max_quantity": 20, "runtime_units": 6000,
            "limit_increments": {}})
    }
    /// `validateDesktopBillingCatalog` (v0.4.4): add-ons are read, and one
    /// that carries the provider's data, or breaks its bounds, fails the
    /// whole catalog.
    #[test]
    fn the_catalog_reads_add_ons_and_refuses_private_or_broken_ones() {
        let read = client(catalog(json!([add_on()]))).catalog().unwrap();
        let add_ons = read.add_ons.unwrap();
        assert_eq!(add_ons[0].runtime_units, 6000);
        assert_eq!(read.runtime.unit_seconds, 60);
        let mut private = add_on();
        private["provider"] = json!({"price": "price_123"});
        assert!(client(catalog(json!([private]))).catalog().is_err());
        for (field, value) in [
            ("price_cents", json!(0)),
            ("max_quantity", json!(0)),
            ("runtime_units", json!(-1)),
            ("name", json!(" ")),
            ("limit_increments", json!({"storage.max_bytes": -1})),
        ] {
            let mut broken = add_on();
            broken[field] = value;
            assert!(
                client(catalog(json!([broken]))).catalog().is_err(),
                "{field}"
            );
        }
        let mut kinds = catalog(json!([]));
        kinds["plans"][0]["space_kinds"] = json!(["company"]);
        assert!(client(kinds).catalog().is_err());
    }
    fn summary(extra: Value) -> Value {
        let mut summary = json!({"org_id": "o", "plan_id": "team_v2", "status": "active",
            "seat_quantity": 3});
        summary
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        summary
    }
    #[test]
    fn a_summary_states_a_change_that_waits_for_renewal_and_the_add_ons_held() {
        let read = client(summary(json!({"pending_seat_quantity": 2,
            "pending_effective_at": "2026-12-01T00:00:00Z",
            "add_ons": [{"add_on_id": "storage_10gb", "quantity": 2, "status": "active",
                "cancel_at_period_end": false, "current_period_end": null}]})))
        .summary("o")
        .unwrap();
        assert_eq!(read.pending_seat_quantity, Some(2));
        assert_eq!(read.add_ons.unwrap()[0].quantity, 2);
        assert!(
            client(summary(json!({"pending_seat_quantity": 0})))
                .summary("o")
                .is_err()
        );
        assert!(
            client(summary(json!({"pending_effective_at": "soon"})))
                .summary("o")
                .is_err()
        );
    }
    #[test]
    fn usage_reads_the_allowance_and_refuses_impossible_storage() {
        let usage = |storage: Value| {
            json!({"runtime": {"org_id": "o", "allowance": {"granted_units": 2400,
                "consumed_units": 600, "reserved_units": 60, "resets_at": null,
                "unit_seconds": 60}}, "storage": storage})
        };
        let read = client(usage(json!({"logical_bytes": 5, "threshold_percent": 80,
            "percent": 81, "limit_bytes": 10})))
        .usage("o")
        .unwrap();
        assert_eq!(read.runtime.allowance.unwrap().consumed_units, 600);
        for storage in [
            json!({"logical_bytes": 5, "threshold_percent": 50}),
            json!({"logical_bytes": 5, "threshold_percent": 0, "percent": 101}),
            json!({"logical_bytes": 5, "threshold_percent": 0, "limit_bytes": 0}),
        ] {
            assert!(client(usage(storage)).usage("o").is_err());
        }
    }
    #[test]
    fn an_add_on_change_is_held_to_its_space_pack_and_outcome() {
        let change = |outcome: &str, url: Value| {
            json!({"org_id": "o", "add_on_id": "storage_10gb", "current_quantity": 0,
                "target_quantity": 1, "monthly_amount_cents": 500, "currency": "USD",
                "outcome": outcome, "checkout_url": url, "effective": "now"})
        };
        let key = || "k".to_owned();
        let read = client(change("checkout", json!("https://checkout.stripe.com/c/1")))
            .change_add_on("o", "storage_10gb", 1, key())
            .unwrap();
        assert_eq!(read.target_quantity, 1);
        assert!(
            client(change("pending_provider_confirmation", Value::Null))
                .change_add_on("o", "storage_10gb", 1, key())
                .is_ok()
        );
        assert!(
            client(change("checkout", Value::Null))
                .change_add_on("o", "storage_10gb", 1, key())
                .is_err()
        );
        assert!(
            client(change("unchanged", Value::Null))
                .change_add_on("other", "storage_10gb", 1, key())
                .is_err()
        );
        assert!(
            client(change("refunded", Value::Null))
                .change_add_on("o", "storage_10gb", 1, key())
                .is_err()
        );
    }
    #[test]
    fn a_lagging_list_does_not_reopen_what_ended() {
        let ended = lifecycle("a", true);
        let kept = keep_ended(
            std::slice::from_ref(&ended),
            vec![lifecycle("a", false), lifecycle("b", false)],
        );
        assert_eq!(kept, [ended.clone(), lifecycle("b", false)]);
        assert!(resumable(&kept[..1]).is_none());
        // A later word from the server is not older than what was seen.
        let mut failed = ended.clone();
        failed.state = "failed".into();
        assert_eq!(keep_ended(&[ended], vec![failed.clone()]), [failed]);
    }
    #[test]
    fn a_foreign_operation_is_told_from_a_malformed_one() {
        let foreign = json!({"id": "a", "org_id": "other", "kind": "checkout",
            "state": "processing", "terminal": false});
        assert!(matches!(
            client(foreign).operation("o", "a"),
            Err(Error::Invalid(FOREIGN))
        ));
        let other = json!({"id": "b", "org_id": "o", "kind": "checkout",
            "state": "processing", "terminal": false});
        assert!(matches!(
            client(other).operation("o", "a"),
            Err(Error::Invalid(FOREIGN))
        ));
        assert!(matches!(
            client(json!({"id": 1})).operation("o", "a"),
            Err(Error::Invalid("billing"))
        ));
    }
    fn quote() -> Quote {
        serde_json::from_value(
            json!({"quote_id": "q", "org_id": "o", "target_plan_id": "team",
            "target_seats": 3, "application_mode": "checkout",
            "expires_at": "2026-10-30T12:00:00Z"}),
        )
        .unwrap()
    }
    fn operation() -> Operation {
        serde_json::from_value(json!({"id": "op", "org_id": "o", "kind": "checkout",
            "state": "pending", "terminal": false, "quote_id": "q", "target_plan_id": "team",
            "target_seat_quantity": 3}))
        .unwrap()
    }

    #[test]
    fn the_same_intent_keeps_its_key_and_a_new_context_never_shares_one() {
        let mut keys = Keys::default();
        let first = keys.key("quote:o:team:3", "plan-quote");
        assert_eq!(keys.key("quote:o:team:3", "plan-quote"), first);
        assert!(first.starts_with("desktop:plan-quote:"));
        assert_ne!(keys.key("quote:o:team:4", "plan-quote"), first);
        keys.forget("quote:o:team:3");
        assert_ne!(keys.key("quote:o:team:3", "plan-quote"), first);
        assert_ne!(Keys::default().key("quote:o:team:4", "plan-quote"), first);
    }

    #[test]
    fn a_quote_and_its_operation_must_answer_the_request() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-30T11:00:00Z")
            .unwrap()
            .to_utc();
        let later = chrono::DateTime::parse_from_rfc3339("2026-10-30T13:00:00Z")
            .unwrap()
            .to_utc();
        let requested = quote();
        assert!(quote_live(&requested, now) && !quote_live(&requested, later));
        let mut other = quote();
        other.target_seats = 9;
        assert!(same_quote(&quote(), &requested, "o"));
        assert!(!same_quote(&other, &requested, "o"));
        assert!(!same_quote(&quote(), &requested, "another"));
        assert!(operation_matches(&operation(), &requested, "o", None));
        assert!(operation_matches(&operation(), &requested, "o", Some("op")));
        assert!(!operation_matches(&operation(), &requested, "o", Some("x")));
        assert!(!operation_matches(&operation(), &other, "o", None));
    }

    #[test]
    fn only_a_safe_billing_url_may_open() {
        assert!(safe_url("https://pay.example.com/c/1").is_some());
        assert!(safe_url("http://127.0.0.1:3000/c").is_some());
        assert!(safe_url("http://pay.example.com/c").is_none());
        assert!(safe_url("https://user:pw@pay.example.com/").is_none());
        assert!(safe_url("https://pay.example.com/a%0Ab").is_none());
        assert!(safe_url("https://pay.example.com/a%7fb").is_none());
        assert!(safe_url("https://pay.example.com/a\nb").is_none());
        assert!(safe_url("javascript:alert(1)").is_none());
    }

    #[test]
    fn responses_are_held_to_the_organization_and_the_url_rule() {
        let summary =
            json!({"org_id": "o", "plan_id": "free", "status": "free", "seat_quantity": 1});
        assert!(client(summary.clone()).summary("o").is_ok());
        assert!(client(summary).summary("other").is_err());
        let bad = json!({"checkout_url": "http://pay.example.com", "quote": {}, "operation": {}});
        assert!(
            client(bad)
                .checkout("o", &quote(), None, "k".into())
                .is_err()
        );
        let catalog = json!({"schema_version": "2.0", "plans": [{"id": "a", "name": "A"}]});
        assert!(client(catalog).catalog().is_err());
        let twice = json!({"schema_version": "1.0", "plans": [
            {"id": "a", "name": "A"}, {"id": "a", "name": "A"}]});
        assert!(client(twice).catalog().is_err());
    }

    #[test]
    fn seats_stay_in_the_plans_range_and_polling_backs_off() {
        let plan: Plan = serde_json::from_value(
            json!({"id": "t", "name": "T", "seats": {"minimum": 2, "maximum": 10}}),
        )
        .unwrap();
        assert_eq!(clamp_seats(1, &plan), 2);
        assert_eq!(clamp_seats(50, &plan), 10);
        assert_eq!(clamp_seats(5, &plan), 5);
        assert_eq!(poll_delay(0), Duration::from_secs(2));
        assert_eq!(poll_delay(99), Duration::from_secs(30));
    }

    #[test]
    fn the_offer_is_the_cheapest_public_paid_plan_and_holding_is_the_servers_word() {
        let catalog: Catalog = serde_json::from_value(json!({"schema_version": "1.0", "plans": [
            {"id": "free", "name": "F", "public": true, "price_per_seat_cents": 0},
            {"id": "team", "name": "T", "public": true, "price_per_seat_cents": 4000},
            {"id": "personal", "name": "P", "public": true, "price_per_seat_cents": 1900,
             "per_seat_limits": {"storage.max_bytes": 1024}},
            {"id": "secret", "name": "S", "public": false, "price_per_seat_cents": 100}]}))
        .unwrap();
        let offer = personal_offer(&catalog).unwrap();
        assert_eq!(offer.id, "personal");
        assert_eq!(offer.storage_bytes(), Some(1024));
        let summary = |status: &str| -> Summary {
            serde_json::from_value(
                json!({"org_id": "o", "plan_id": "personal", "status": status,
                "seat_quantity": 1}),
            )
            .unwrap()
        };
        assert!(summary("active").held() && summary("past_due").held());
        assert!(!summary("checkout_pending").held() && !summary("free").held());
    }

    #[test]
    fn a_finished_operation_is_not_resumed() {
        assert!(resumable(&[operation()]).is_some());
        let mut done = operation();
        done.terminal = true;
        assert!(resumable(&[done]).is_none());
        let mut seats = operation();
        seats.kind = "member_activation".into();
        assert!(resumable(&[seats]).is_none());
    }
}
