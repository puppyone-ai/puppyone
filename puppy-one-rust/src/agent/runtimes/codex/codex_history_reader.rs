//! `runtimes/codex/codex-history-reader.mjs`: reads the newest bounded,
//! complete-turn window through Codex's paginated history contract.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::history_schema::history_cursor;
use crate::agent::contract::js::{self, Obj};
use futures_util::future::LocalBoxFuture;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::HashSet;
use std::sync::LazyLock;

/// `request(method, params)`.
pub type CodexRequest = dyn Fn(&str, Value) -> LocalBoxFuture<'static, AgentResult<Value>>;

/// `codexHistoryReaderLimits`.
pub mod limits {
    pub const TURN_PAGE_SIZE: usize = 40;
    pub const ITEM_PAGE_SIZE: usize = 100;
    pub const MAX_TURNS: usize = 200;
    pub const MAX_ITEMS_PER_TURN: usize = 300;
    pub const MAX_PROJECTED_EVENTS: usize = 900;
}
use limits::*;

static PAGINATION_UNAVAILABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:-32601|method not found|unknown method|unsupported method)")
        .expect("pattern")
});
static PAGINATION_METHOD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)thread/(?:turns|items)/list").expect("pattern"));
static EXCLUDE_TURNS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)excludeTurns").expect("pattern"));
static EXCLUDE_TURNS_REJECTED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:unknown|unexpected|unsupported|invalid)").expect("pattern")
});

fn type_error(message: &str) -> AgentError {
    AgentError::new(message).with_name("TypeError")
}

/// `readCodexPaginatedHistory({ request, threadId })`: the returned turns
/// are chronological for presentation.
pub async fn read_codex_paginated_history(
    request: &CodexRequest,
    thread_id: Option<&str>,
) -> AgentResult<Value> {
    let id = optional_id(thread_id)
        .ok_or_else(|| AgentError::new("Codex history requires a thread id."))?;
    let (descending_turns, partial) = read_turn_pages(request, &id).await?;
    let mut hydrated_descending = Vec::new();
    for turn in descending_turns {
        hydrated_descending.push(hydrate_turn_items(request, &id, turn).await?);
    }
    let hydrated_count = hydrated_descending.len();
    let mut selected = select_complete_turn_window(hydrated_descending);
    let coverage =
        if partial || selected.len() < hydrated_count || selected.iter().any(history_partial) {
            "partial"
        } else {
            "complete"
        };
    selected.reverse();
    Ok(json!({ "id": id, "turns": selected, "coverage": coverage }))
}

fn history_partial(turn: &Value) -> bool {
    js::truthy_opt(turn.get("historyPartial"))
}

/// `readCodexHistory({ request, threadId })`: the compatibility boundary
/// for Codex releases predating paginated history.
pub async fn read_codex_history(request: &CodexRequest, thread_id: &str) -> AgentResult<Value> {
    let error = match read_codex_paginated_history(request, Some(thread_id)).await {
        Ok(thread) => return Ok(thread),
        Err(error) => error,
    };
    if !is_pagination_method_unavailable(&error) {
        return Err(error);
    }
    let result = request(
        "thread/read",
        json!({ "threadId": thread_id, "includeTurns": true }),
    )
    .await?;
    let thread = &result["thread"];
    let Some(turns) = thread
        .get("turns")
        .and_then(Value::as_array)
        .filter(|_| thread.get("id").and_then(Value::as_str) == Some(thread_id))
    else {
        return Err(type_error("Codex returned an invalid history snapshot."));
    };
    let descending: Vec<Value> = turns[turns.len().saturating_sub(MAX_TURNS)..]
        .iter()
        .rev()
        .map(|turn| {
            let partial = turn
                .get("items")
                .and_then(Value::as_array)
                .is_some_and(|items| items.len() > MAX_ITEMS_PER_TURN);
            Obj::from(turn)
                .set("items", bounded_items(turn.get("items")))
                .set("historyPartial", partial)
                .build()
        })
        .collect();
    let mut selected = select_complete_turn_window(descending);
    let coverage = if selected.len() < turns.len() || selected.iter().any(history_partial) {
        "partial"
    } else {
        "complete"
    };
    selected.reverse();
    Ok(Obj::from(thread)
        .set("turns", selected)
        .set("coverage", coverage)
        .build())
}

/// `requestCodexMetadataOnlyThread({ request, method, params })`: new
/// Codex versions require resume/fork to avoid eager full-history loading.
/// Retry without the optional field only when an older server rejects that
/// exact field, not for arbitrary resume failures.
pub async fn request_codex_metadata_only_thread(
    request: &CodexRequest,
    method: &str,
    params: Value,
) -> AgentResult<Value> {
    match request(method, js::with(&params, "excludeTurns", true)).await {
        Ok(result) => Ok(result),
        Err(error) if is_exclude_turns_unsupported(&error) => request(method, params).await,
        Err(error) => Err(error),
    }
}

/// One paginated native listing.
struct Listing<'a> {
    method: &'a str,
    page_size: usize,
    maximum: usize,
    invalid_page: &'a str,
    repeated_cursor: &'a str,
}

/// Reads one paginated listing: `(entries, partial)`. `accept` validates an
/// entry and returns whether it is new.
async fn read_pages(
    request: &CodexRequest,
    listing: Listing<'_>,
    params: &dyn Fn(Option<&str>, usize) -> Value,
    mut accept: impl FnMut(&Value) -> AgentResult<bool>,
) -> AgentResult<(Vec<Value>, bool)> {
    let Listing {
        method,
        page_size,
        maximum,
        invalid_page,
        repeated_cursor,
    } = listing;
    let mut entries: Vec<Value> = Vec::new();
    let mut seen_cursors: HashSet<String> = HashSet::new();
    let mut omitted = false;
    let mut cursor: Option<String> = None;
    let mut pages = 0;
    let mut partial = false;
    while entries.len() < maximum {
        let limit = page_size.min(maximum - entries.len());
        let result = request(method, params(cursor.as_deref(), limit)).await?;
        pages += 1;
        let Some(data) = result
            .get("data")
            .and_then(Value::as_array)
            .filter(|_| pages <= 100)
        else {
            return Err(type_error(invalid_page));
        };
        for entry in data {
            if !accept(entry)? {
                continue;
            }
            if entries.len() >= maximum {
                omitted = true;
                continue;
            }
            entries.push(entry.clone());
        }
        let next_cursor = history_cursor(result.get("nextCursor"))?;
        partial = omitted || next_cursor.is_some();
        let Some(next_cursor) = next_cursor else {
            break;
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            return Err(AgentError::new(repeated_cursor));
        }
        cursor = Some(next_cursor);
    }
    Ok((entries, partial))
}

async fn read_turn_pages(
    request: &CodexRequest,
    thread_id: &str,
) -> AgentResult<(Vec<Value>, bool)> {
    let mut seen_turn_ids: HashSet<String> = HashSet::new();
    let (turns, partial) = read_pages(
        request,
        Listing {
            method: "thread/turns/list",
            page_size: TURN_PAGE_SIZE,
            maximum: MAX_TURNS,
            invalid_page: "Codex returned an invalid turn history page.",
            repeated_cursor: "Codex turn history returned a repeated pagination cursor.",
        },
        &|cursor, limit| {
            json!({
                "threadId": thread_id,
                "cursor": cursor,
                "limit": limit,
                "sortDirection": "desc",
                "itemsView": "full",
            })
        },
        |turn| {
            let turn_id = optional_id(turn.get("id").and_then(Value::as_str))
                .ok_or_else(|| type_error("Codex returned a turn without an identity."))?;
            Ok(seen_turn_ids.insert(turn_id))
        },
    )
    .await?;
    let turns = turns
        .into_iter()
        .map(|turn| {
            let id = optional_id(turn.get("id").and_then(Value::as_str)).unwrap_or_default();
            js::with(&turn, "id", id)
        })
        .collect();
    Ok((turns, partial))
}

async fn hydrate_turn_items(
    request: &CodexRequest,
    thread_id: &str,
    turn: Value,
) -> AgentResult<Value> {
    if turn.get("itemsView").and_then(Value::as_str) == Some("full") {
        let Some(items) = turn.get("items").and_then(Value::as_array) else {
            return Err(type_error("Codex returned invalid turn items."));
        };
        let partial = items.len() > MAX_ITEMS_PER_TURN;
        return Ok(Obj::from(&turn)
            .set("items", bounded_items(turn.get("items")))
            .set("historyPartial", partial)
            .build());
    }
    let summary_prompt = turn
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("type").and_then(Value::as_str) == Some("userMessage"))
        })
        .cloned();
    let turn_id = js::str_or_empty(turn.get("id")).to_string();
    let mut seen_item_ids: HashSet<String> = HashSet::new();
    let (entries, partial) = read_pages(
        request,
        Listing {
            method: "thread/items/list",
            page_size: ITEM_PAGE_SIZE,
            maximum: MAX_ITEMS_PER_TURN,
            invalid_page: "Codex returned an invalid item history page.",
            repeated_cursor: "Codex item history returned a repeated pagination cursor.",
        },
        &|cursor, limit| {
            json!({
                "threadId": thread_id,
                "turnId": turn_id,
                "cursor": cursor,
                "limit": limit,
                "sortDirection": "desc",
            })
        },
        |entry| {
            let item = entry
                .get("item")
                .filter(|item| item.is_object() || item.is_array());
            if optional_id(entry.get("turnId").and_then(Value::as_str)).as_deref()
                != Some(turn_id.as_str())
                || item.is_none()
            {
                return Err(type_error("Codex returned an invalid item identity."));
            }
            Ok(
                match optional_id(item.and_then(|i| i.get("id")).and_then(Value::as_str)) {
                    Some(item_id) => seen_item_ids.insert(item_id),
                    None => true,
                },
            )
        },
    )
    .await?;
    let mut chronological: Vec<Value> = entries
        .into_iter()
        .rev()
        .map(|entry| entry["item"].clone())
        .collect();
    if let Some(prompt) = summary_prompt
        && !chronological.iter().any(|item| same_item(item, &prompt))
    {
        chronological.insert(0, prompt);
    }
    let partial = partial || chronological.len() > MAX_ITEMS_PER_TURN;
    Ok(Obj::from(&turn)
        .set("items", bounded_items(Some(&Value::Array(chronological))))
        .set("itemsView", "full")
        .set("historyPartial", partial)
        .build())
}

fn bounded_items(value: Option<&Value>) -> Vec<Value> {
    let items: Vec<Value> = value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.is_object() || item.is_array())
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if items.len() <= MAX_ITEMS_PER_TURN {
        return items;
    }
    let recent_start = items.len() - (MAX_ITEMS_PER_TURN - 1);
    let first_prompt = items
        .iter()
        .position(|item| item.get("type").and_then(Value::as_str) == Some("userMessage"));
    match first_prompt {
        Some(index) if index < recent_start => {
            let mut bounded = vec![items[index].clone()];
            bounded.extend_from_slice(&items[recent_start..]);
            bounded
        }
        _ => items[items.len() - MAX_ITEMS_PER_TURN..].to_vec(),
    }
}

fn select_complete_turn_window(descending_turns: Vec<Value>) -> Vec<Value> {
    let mut selected = Vec::new();
    let mut projected_events = 0;
    for turn in descending_turns {
        let cost = estimated_projected_event_count(&turn);
        if !selected.is_empty() && projected_events + cost > MAX_PROJECTED_EVENTS {
            break;
        }
        selected.push(turn);
        projected_events += cost;
    }
    selected
}

fn estimated_projected_event_count(turn: &Value) -> usize {
    2 + turn
        .get("items")
        .and_then(Value::as_array)
        .map_or(0, |items| {
            items
                .iter()
                .map(|item| {
                    if item.get("type").and_then(Value::as_str) == Some("fileChange") {
                        2
                    } else {
                        1
                    }
                })
                .sum()
        })
}

fn is_pagination_method_unavailable(error: &AgentError) -> bool {
    PAGINATION_UNAVAILABLE.is_match(&error.message) && PAGINATION_METHOD.is_match(&error.message)
}

fn is_exclude_turns_unsupported(error: &AgentError) -> bool {
    EXCLUDE_TURNS.is_match(&error.message) && EXCLUDE_TURNS_REJECTED.is_match(&error.message)
}

fn optional_id(value: Option<&str>) -> Option<String> {
    value
        .map(js::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn same_item(left: &Value, right: &Value) -> bool {
    let id = |item: &Value| optional_id(item.get("id").and_then(Value::as_str));
    match (id(left), id(right)) {
        (Some(left), Some(right)) => left == right,
        // Without identities the product compares object references, which
        // never match across pages.
        _ => false,
    }
}
