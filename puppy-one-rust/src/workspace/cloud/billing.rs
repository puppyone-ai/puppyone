//! `billing.md`, `cloudBillingState.ts` and the billing half of `cloudApi.ts`.
//! Desktop never computes a price or treats a browser return as payment: it
//! asks for a server quote, confirms it, opens the validated URL and waits
//! for the server's state. A mutation's idempotency key is stable across
//! retries of one intent and never crosses an account or Organization.
use super::services::{Error, Result, Transport};
use crate::cloud_auth::model::ApiRequest;
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
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Plan {
    pub id: String,
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
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Catalog {
    pub schema_version: String,
    pub plans: Vec<Plan>,
}
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Summary {
    pub org_id: String,
    pub plan_id: String,
    pub status: String,
    pub seat_quantity: u64,
    #[serde(default)]
    pub pending_plan_id: Option<String>,
    #[serde(default)]
    pub cancel_at_period_end: bool,
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
    pub expires_at: String,
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
        let catalog: Catalog =
            decode(self.send(Method::GET, "/billing/catalog".into(), None, None)?)?;
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
        Ok(summary)
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
            return Err(Error::Invalid("billing"));
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
