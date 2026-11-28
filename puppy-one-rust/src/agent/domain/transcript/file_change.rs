//! `transcript/file-change.mjs`.
use super::content_readers::activity_id;
use super::transcript_indexes::{Projection, revise};
use crate::agent::contract::js;
use crate::text;
use serde_json::Value;

/// `hasRenderableFileChange(payload)`: rejects empty runtime placeholders
/// before they become transcript rows.
pub fn has_renderable_file_change(payload: &Value) -> bool {
    let empty = Value::Object(Default::default());
    let input = payload
        .get("input")
        .filter(|v| v.is_object())
        .unwrap_or(&empty);
    let present = |value: Option<&Value>| !text::trim(js::str_or_empty(value)).is_empty();
    let has_path = [
        payload.get("path"),
        input.get("path"),
        input.get("file"),
        input.get("filepath"),
    ]
    .into_iter()
    .any(present);
    let has_diff = [
        payload.get("diff"),
        payload.get("patch"),
        input.get("diff"),
        input.get("patch"),
    ]
    .into_iter()
    .any(present);
    let has_change = payload
        .get("changes")
        .and_then(Value::as_array)
        .is_some_and(|changes| {
            changes.iter().filter(|c| c.is_object()).any(|record| {
                let path = [
                    record.get("path"),
                    record.get("file"),
                    record.get("filepath"),
                ]
                .into_iter()
                .flatten()
                .find(|v| js::truthy(v));
                present(path)
            })
        });
    has_path || has_diff || has_change
}

/// `clearProjectedFileChange(projection, event)`: clears only the
/// file-change row represented by an emptied runtime snapshot.
pub fn clear_projected_file_change(projection: &mut Projection, event: &Value) {
    let id = activity_id(event);
    let Some(index) = projection.indexes().activities.get(&id).copied() else {
        return;
    };
    let d = &mut projection.d;
    if d.activities.get(index).and_then(|a| a.get("kind")) != Some(&Value::from("file-change")) {
        return;
    }
    d.activities.remove(index);
    let is_id = |v: Option<&Value>| v.and_then(Value::as_str) == Some(id.as_str());
    d.parts.retain(|part| !is_id(part.get("id")));
    d.rows.retain(|row| !is_id(row.get("partId")));
    for turn in d.turns.iter_mut() {
        let includes = turn
            .get("partIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| ids.iter().any(|p| p.as_str() == Some(id.as_str())));
        if includes {
            *turn = revise(turn, |t| {
                if let Some(Value::Array(ids)) = t.get_mut("partIds") {
                    ids.retain(|p| p.as_str() != Some(id.as_str()));
                }
            });
        }
    }
    projection.invalidate();
}
