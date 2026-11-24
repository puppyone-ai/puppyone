//! What the compute wallet's answers read as: the public directory, this
//! account's balance and its usage receipts (`managed-usage.mjs`), money,
//! and checkout addresses. Only server-owned customer amounts are kept.
use serde_json::Value;

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

/// A directory with models (an empty one is refused: a funded account
/// would otherwise wait for a model forever).
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
pub(super) fn data(value: Value) -> Value {
    if value.get("data").is_some() && value.get("code").is_some() {
        value["data"].clone()
    } else {
        value
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UsageStatus {
    /// Reserved, running, uncertain or under review.
    Pending,
    Released,
    Settled,
}
/// The latest model call's usage, as the server settled it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Usage {
    pub reservation_id: String,
    pub model_id: String,
    pub status: UsageStatus,
    pub charged_micro_usd: Option<i64>,
    pub price_book_id: Option<String>,
    pub input_tokens: Option<i64>,
    pub cached_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
}
impl Usage {
    /// A call whose receipt is not read yet.
    pub fn pending(reservation_id: &str, model_id: &str) -> Self {
        Self {
            reservation_id: reservation_id.into(),
            model_id: model_id.into(),
            status: UsageStatus::Pending,
            charged_micro_usd: None,
            price_book_id: None,
            input_tokens: None,
            cached_tokens: None,
            output_tokens: None,
        }
    }
}
/// `parseManagedUsage`: the receipt of `reservation`, or `None` for a
/// mismatched one, an unknown status or a settlement without its amount and
/// token counts. Provider costs and routes are never read.
pub fn parse_usage(value: &Value, reservation: &str) -> Option<Usage> {
    let counter = |v: &Value| v.as_i64().filter(|n| *n >= 0);
    let model_id = value["model_id"].as_str().filter(|m| m.len() <= 200)?;
    if value["reservation_id"].as_str() != Some(reservation) {
        return None;
    }
    let status = value["status"].as_str()?;
    if !matches!(
        status,
        "reserved" | "running" | "uncertain" | "manual_review" | "released" | "settled"
    ) {
        return None;
    }
    let settled = status == "settled";
    let usage = &value["usage"];
    let tokens = [
        counter(&usage["input_tokens"]),
        counter(&usage["cached_tokens"]),
        counter(&usage["output_tokens"]),
    ];
    if settled
        && (counter(&value["charged_micro_usd"]).is_none()
            || tokens.iter().any(Option::is_none)
            || tokens[1] > tokens[0])
    {
        return None;
    }
    let settled_only = |v: Option<i64>| v.filter(|_| settled);
    Some(Usage {
        reservation_id: reservation.into(),
        model_id: model_id.into(),
        status: match status {
            "settled" => UsageStatus::Settled,
            "released" => UsageStatus::Released,
            _ => UsageStatus::Pending,
        },
        charged_micro_usd: settled_only(counter(&value["charged_micro_usd"])),
        price_book_id: value["price_book_id"].as_str().map(str::to_owned),
        input_tokens: settled_only(tokens[0]),
        cached_tokens: settled_only(tokens[1]),
        output_tokens: settled_only(tokens[2]),
    })
}
