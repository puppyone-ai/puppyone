//! `transcript/display-window.mjs`: retain a bounded display window
//! independently of unresolved control records.
use crate::agent::contract::display_metrics::entry_metrics;
use crate::agent::contract::display_schema::limits;
use crate::agent::contract::display_types::{AgentDisplay, Entry};
use crate::agent::contract::js;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

const COLLECTIONS: &[&str] = &[
    "parts",
    "rows",
    "messages",
    "activities",
    "turns",
    "approvals",
    "questions",
];

fn id(entry: &Value) -> &str {
    js::str_or_empty(entry.get("id"))
}

/// `boundAgentDisplay(display, control)`.
pub fn bound_agent_display(display: AgentDisplay, control: &Value) -> AgentDisplay {
    let execution = &control["execution"];
    let protected_turns: HashSet<&str> =
        [&execution["activeTurnId"], &execution["uncertainTurnId"]]
            .into_iter()
            .filter_map(Value::as_str)
            .filter(|t| !t.is_empty())
            .collect();
    let commands = control["commands"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let pending_inputs: HashSet<&str> = commands
        .iter()
        .filter(|command| {
            matches!(
                command["status"].as_str(),
                Some("queued" | "dispatching" | "outcome-unknown")
            )
        })
        .filter_map(|command| command["commandId"].as_str())
        .collect();
    let mut protected_ids: HashSet<String> = HashSet::new();
    for part in &display.parts {
        if part["kind"] == "user"
            && part["submissionId"]
                .as_str()
                .is_some_and(|id| pending_inputs.contains(id))
        {
            protected_ids.insert(id(part).to_string());
        }
    }
    // Keep the current input, rather than every historical follow-up in a long turn.
    for turn in &protected_turns {
        if let Some(input) = display
            .parts
            .iter()
            .rev()
            .find(|part| part["kind"] == "user" && part["turnId"].as_str() == Some(turn))
        {
            protected_ids.insert(id(input).to_string());
        }
    }
    let requests: HashSet<&str> = ["approvals", "questions"]
        .iter()
        .flat_map(|key| {
            control["interaction"][*key]
                .as_array()
                .into_iter()
                .flatten()
        })
        .filter_map(|entry| entry["requestId"].as_str())
        .collect();
    for part in &display.parts {
        if matches!(part["kind"].as_str(), Some("permission" | "question"))
            && part["requestId"]
                .as_str()
                .is_some_and(|r| requests.contains(r))
        {
            protected_ids.insert(id(part).to_string());
        }
    }

    let mut counts: HashMap<&str, usize> = COLLECTIONS
        .iter()
        .map(|key| (*key, display.collection(key).len()))
        .collect();
    let (mut bytes, mut nodes) = (0usize, 0usize);
    for key in COLLECTIONS {
        for entry in display.collection(key) {
            let metrics = entry_metrics(entry);
            bytes += metrics.bytes;
            nodes += metrics.nodes;
        }
    }
    let over_budget = |counts: &HashMap<&str, usize>, bytes: usize, nodes: usize| {
        counts.values().any(|count| *count > limits::MAX_ENTRIES - 32)
            // Leave transport room for control metadata, patch identities and envelope.
            || bytes > limits::MAX_BYTES - 2 * 1024 * 1024
            || nodes > limits::MAX_NODES - 8_000
    };
    if !over_budget(&counts, bytes, nodes) {
        return display;
    }

    let mirror = |entries: &[Entry]| -> HashMap<String, Entry> {
        entries
            .iter()
            .map(|entry| (id(entry).to_string(), entry.clone()))
            .collect()
    };
    let messages = mirror(&display.messages);
    let activities = mirror(&display.activities);
    let rows: HashMap<String, Entry> = display
        .rows
        .iter()
        .map(|row| (js::str_or_empty(row.get("partId")).to_string(), row.clone()))
        .collect();
    let turns = mirror(&display.turns);
    let turn_key = |part: &Value| {
        part.get("turnId")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let mut turn_part_counts: HashMap<Option<String>, usize> = HashMap::new();
    for part in &display.parts {
        *turn_part_counts.entry(turn_key(part)).or_insert(0) += 1;
    }
    let mut removed: HashSet<String> = HashSet::new();
    let mut removed_turns: HashSet<String> = HashSet::new();
    let discard = |key: &'static str,
                   entry: Option<&Entry>,
                   counts: &mut HashMap<&str, usize>,
                   bytes: &mut usize,
                   nodes: &mut usize| {
        if let Some(entry) = entry {
            let metrics = entry_metrics(entry);
            *counts.get_mut(key).expect("collection count") -= 1;
            *bytes -= metrics.bytes;
            *nodes -= metrics.nodes;
        }
    };
    for turn in &display.turns {
        let turn_id = id(turn).to_string();
        if !turn_part_counts.contains_key(&Some(turn_id.clone()))
            && !protected_turns.contains(turn_id.as_str())
        {
            discard("turns", Some(turn), &mut counts, &mut bytes, &mut nodes);
            removed_turns.insert(turn_id);
        }
    }
    let mut ordered: Vec<&Entry> = display.parts.iter().collect();
    ordered.sort_by(|a, b| {
        let at = |e: &Value| e.get("sequence").and_then(Value::as_f64).unwrap_or(0.0);
        at(a).total_cmp(&at(b))
    });
    for part in ordered {
        if !over_budget(&counts, bytes, nodes) {
            break;
        }
        let part_id = id(part).to_string();
        if protected_ids.contains(&part_id) {
            continue;
        }
        discard("parts", Some(part), &mut counts, &mut bytes, &mut nodes);
        discard(
            "rows",
            rows.get(&part_id),
            &mut counts,
            &mut bytes,
            &mut nodes,
        );
        discard(
            "messages",
            messages.get(&part_id),
            &mut counts,
            &mut bytes,
            &mut nodes,
        );
        discard(
            "activities",
            activities.get(&part_id),
            &mut counts,
            &mut bytes,
            &mut nodes,
        );
        removed.insert(part_id);
        let key = turn_key(part);
        let remaining = turn_part_counts
            .get(&key)
            .copied()
            .unwrap_or(1)
            .saturating_sub(1);
        turn_part_counts.insert(key.clone(), remaining);
        if let Some(turn_id) = key
            && remaining == 0
            && !protected_turns.contains(turn_id.as_str())
            && let Some(turn) = turns.get(&turn_id)
        {
            discard("turns", Some(turn), &mut counts, &mut bytes, &mut nodes);
            removed_turns.insert(turn_id);
        }
    }
    if removed.is_empty() && removed_turns.is_empty() {
        return display;
    }
    let mut display = display;
    display.set("displayWindow", json!({ "truncated": true }));
    display.parts.retain(|part| !removed.contains(id(part)));
    display
        .rows
        .retain(|row| !removed.contains(js::str_or_empty(row.get("partId"))));
    display
        .messages
        .retain(|entry| !removed.contains(id(entry)));
    display
        .activities
        .retain(|entry| !removed.contains(id(entry)));
    display.turns = display
        .turns
        .iter()
        .filter(|turn| !removed_turns.contains(id(turn)))
        .map(|turn| {
            let keeps_all = turn["partIds"].as_array().is_none_or(|ids| {
                ids.iter()
                    .all(|p| !p.as_str().is_some_and(|p| removed.contains(p)))
            });
            if keeps_all {
                return turn.clone();
            }
            super::transcript_indexes::revise(turn, |t| {
                if let Some(Value::Array(ids)) = t.get_mut("partIds") {
                    ids.retain(|p| !p.as_str().is_some_and(|p| removed.contains(p)));
                }
            })
        })
        .collect();
    display
}
