//! `managed-connection.mjs` (the PuppyOne compute wallet) without Cloud
//! hosting: the public model and pack directory (`/ai/catalog`), this
//! account's balance (`/ai/balance`), the one-time trial grant claimed once
//! per account (`/ai/trial`), and top-up checkouts (`/ai/checkouts`) opened
//! only at the payment provider's HTTPS origin. A new session generation
//! drops everything read under the old one.
use crate::cloud_auth::model::ApiRequest;
use gpui::*;
use reqwest::Method;
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pack {
    pub id: String,
    pub price_cents: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub context_window: Option<u64>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Catalog {
    pub models: Vec<Model>,
    pub packs: Vec<Pack>,
    pub trial_credit_micro_usd: i64,
    pub sandbox: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Balance {
    pub balance_micro_usd: i64,
    pub reserved_micro_usd: i64,
    pub available_micro_usd: i64,
    pub trial_granted_micro_usd: i64,
}
/// `managed.reason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    SignInRequired,
    Loading,
    GatewayUnavailable,
    Ready,
    InsufficientCredit,
}

pub fn parse_catalog(value: &Value) -> Option<Catalog> {
    let models: Vec<Model> = value["models"]
        .as_array()?
        .iter()
        .filter_map(|m| {
            Some(Model {
                id: m["id"].as_str()?.to_owned(),
                name: m["name"].as_str().unwrap_or_default().to_owned(),
                context_window: m["context_window"].as_u64(),
            })
        })
        .collect();
    let packs = value["packs"]
        .as_array()?
        .iter()
        .filter_map(|p| {
            Some(Pack {
                id: p["id"].as_str()?.to_owned(),
                price_cents: p["price_cents"].as_i64()?,
            })
        })
        .collect();
    (!models.is_empty()).then_some(Catalog {
        models,
        packs,
        trial_credit_micro_usd: value["trial_credit_micro_usd"].as_i64().unwrap_or(0),
        sandbox: value["sandbox"] == true,
    })
}
/// `validBalance`.
pub fn parse_balance(value: &Value) -> Option<Balance> {
    Some(Balance {
        balance_micro_usd: value["balance_micro_usd"].as_i64()?,
        reserved_micro_usd: value["reserved_micro_usd"].as_i64()?,
        available_micro_usd: value["available_micro_usd"].as_i64()?,
        trial_granted_micro_usd: value["trial_granted_micro_usd"].as_i64().unwrap_or(0),
    })
}
/// Money read as money: two decimals, enough to stay true below a cent.
pub fn money(micro: i64) -> String {
    let amount = micro as f64 / 1_000_000.;
    let sub_cent = amount > 0. && amount < 0.01;
    if sub_cent {
        format!("${amount:.4}")
    } else {
        format!("${amount:.2}")
    }
}
/// A checkout URL only at the payment provider (`sandbox.polar.sh` in
/// sandbox), over HTTPS, without credentials.
pub fn checkout_url(value: &str, sandbox: bool) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    let host = if sandbox {
        "sandbox.polar.sh"
    } else {
        "polar.sh"
    };
    (url.scheme() == "https"
        && url.host_str() == Some(host)
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.to_string())
}
/// The `{code, data}` envelope or the bare value.
fn data(value: Value) -> Value {
    if value.get("data").is_some() && value.get("code").is_some() {
        value["data"].clone()
    } else {
        value
    }
}

pub struct ManagedCompute {
    key: Option<String>,
    pub catalog: Option<Catalog>,
    pub balance: Option<Balance>,
    pub failed: bool,
    pub pending: bool,
    trial_claimed_for: Option<String>,
    last_refresh: Option<Instant>,
    epoch: u64,
}
struct Service(Entity<ManagedCompute>);
impl Global for Service {}
pub fn global(cx: &mut App) -> Entity<ManagedCompute> {
    if let Some(service) = cx.try_global::<Service>() {
        return service.0.clone();
    }
    let entity = cx.new(|_| ManagedCompute {
        key: None,
        catalog: None,
        balance: None,
        failed: false,
        pending: false,
        trial_claimed_for: None,
        last_refresh: None,
        epoch: 0,
    });
    cx.set_global(Service(entity.clone()));
    entity
}

impl ManagedCompute {
    pub fn reason(&self, signed_in: bool) -> Reason {
        if !signed_in {
            return Reason::SignInRequired;
        }
        match (&self.catalog, &self.balance) {
            (Some(_), Some(b)) if !self.failed => {
                if b.available_micro_usd > 0 {
                    Reason::Ready
                } else {
                    Reason::InsufficientCredit
                }
            }
            _ if self.pending || !self.failed => Reason::Loading,
            _ => Reason::GatewayUnavailable,
        }
    }
    /// Read the directory and the wallet; at most every 15 s unless forced.
    pub fn refresh(&mut self, force: bool, cx: &mut Context<Self>) {
        let Some((broker, binding)) = crate::features::cloud_account::broker_and_binding(cx) else {
            if self.key.is_some() {
                self.key = None;
                self.balance = None;
                self.failed = false;
                self.epoch += 1;
                cx.notify();
            }
            return;
        };
        let key = format!(
            "{}\n{}\n{}",
            binding.user,
            binding.epoch,
            binding.environment.api()
        );
        if self.key.as_ref() != Some(&key) {
            self.key = Some(key);
            self.balance = None;
            self.failed = false;
            self.trial_claimed_for = None;
            self.last_refresh = None;
            self.epoch += 1;
        }
        if self.pending
            || (!force
                && self
                    .last_refresh
                    .is_some_and(|t| t.elapsed() < Duration::from_secs(15)))
        {
            return;
        }
        self.pending = true;
        let epoch = self.epoch;
        let claim = (self.trial_claimed_for.as_deref() != Some(binding.user.as_str()))
            .then(|| binding.user.clone());
        cx.notify();
        let task = cx.background_executor().spawn(async move {
            let get = |path: &str| {
                broker
                    .request(
                        &binding,
                        &ApiRequest {
                            idempotency_key: None,
                            method: Method::GET,
                            path: path.into(),
                            query: vec![],
                            body: None,
                        },
                    )
                    .map(data)
            };
            let catalog = get("/ai/catalog")
                .ok()
                .as_ref()
                .and_then(parse_catalog)
                .ok_or(())?;
            let mut balance = get("/ai/balance")
                .ok()
                .as_ref()
                .and_then(parse_balance)
                .ok_or(())?;
            let mut claimed = false;
            // A returning account already has its lifetime grant; a new one
            // receives it from the idempotent claim, which returns the wallet.
            if claim.is_some() && catalog.trial_credit_micro_usd > 0 {
                if balance.trial_granted_micro_usd <= 0
                    && let Some(granted) = broker
                        .request(
                            &binding,
                            &ApiRequest {
                                idempotency_key: None,
                                method: Method::POST,
                                path: "/ai/trial".into(),
                                query: vec![],
                                body: Some(serde_json::json!({})),
                            },
                        )
                        .ok()
                        .map(data)
                        .as_ref()
                        .and_then(parse_balance)
                {
                    balance = granted;
                }
                claimed = true;
            }
            Ok::<_, ()>((catalog, balance, claimed))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.epoch != epoch {
                    return;
                }
                s.pending = false;
                s.last_refresh = Some(Instant::now());
                match result {
                    Ok((catalog, balance, claimed)) => {
                        s.catalog = Some(catalog);
                        s.balance = Some(balance);
                        s.failed = false;
                        if claimed {
                            s.trial_claimed_for =
                                crate::features::cloud_account::broker_and_binding(cx)
                                    .map(|(_, b)| b.user);
                        }
                    }
                    Err(()) => {
                        s.balance = None;
                        s.failed = true;
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
    /// Top up with `pack`: the checkout opens in the system browser; the
    /// balance changes only when the service says so.
    pub fn checkout(&mut self, pack: String, cx: &mut Context<Self>) {
        let (Some((broker, binding)), Some(catalog)) = (
            crate::features::cloud_account::broker_and_binding(cx),
            self.catalog.clone(),
        ) else {
            return;
        };
        if !catalog.packs.iter().any(|p| p.id == pack) {
            return;
        }
        self.pending = true;
        cx.notify();
        let task = cx.background_executor().spawn(async move {
            let value = broker
                .request(
                    &binding,
                    &ApiRequest {
                        idempotency_key: Some(uuid::Uuid::new_v4().to_string()),
                        method: Method::POST,
                        path: "/ai/checkouts".into(),
                        query: vec![],
                        body: Some(serde_json::json!({"pack_id": pack})),
                    },
                )
                .ok()
                .map(data)?;
            checkout_url(value["checkout_url"].as_str()?, catalog.sandbox)
        });
        cx.spawn(async move |this, cx| {
            let url = task.await;
            let _ = this.update(cx, |s, cx| {
                s.pending = false;
                match url {
                    Some(url) => {
                        let _ = crate::platform::desktop::open_url(&url);
                    }
                    None => s.failed = true,
                }
                s.refresh(true, cx);
                cx.notify();
            });
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_wallet_reads_like_the_product() {
        let catalog = parse_catalog(&serde_json::json!({
            "models": [{"id": "m1", "name": "Model", "context_window": 128000}],
            "packs": [{"id": "p5", "price_cents": 500}],
            "trial_credit_micro_usd": 2000000,
        }))
        .unwrap();
        assert_eq!(catalog.packs[0].price_cents, 500);
        assert!(parse_catalog(&serde_json::json!({"models": [], "packs": []})).is_none());
        let balance = parse_balance(&serde_json::json!({
            "balance_micro_usd": 1_500_000, "reserved_micro_usd": 0, "available_micro_usd": 1_500_000
        }))
        .unwrap();
        assert_eq!(money(balance.available_micro_usd), "$1.50");
        assert_eq!(money(4_000), "$0.0040");
        assert_eq!(money(0), "$0.00");
        assert!(parse_balance(&serde_json::json!({"balance_micro_usd": 1})).is_none());
        assert!(checkout_url("https://polar.sh/checkout/abc", false).is_some());
        assert!(checkout_url("https://sandbox.polar.sh/c", true).is_some());
        assert!(checkout_url("https://sandbox.polar.sh/c", false).is_none());
        assert!(checkout_url("http://polar.sh/c", false).is_none());
        assert!(checkout_url("https://evil.example/c", false).is_none());
        assert!(checkout_url("https://user:pw@polar.sh/c", false).is_none());
    }
}
