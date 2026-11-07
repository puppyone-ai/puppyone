//! `journal/migrate-v1.mjs`: a version-1 publish journal (`phase`) becomes a
//! schema-v2 record whose single attempt is the expected head; the migration
//! is marked unpersisted until the next successful write.
use super::{Code, PublishError};
use serde_json::{Value, json};

fn invalid() -> PublishError {
    PublishError::new(
        Code::JournalCorrupt,
        "Cloud initialization journal (version 1) is invalid.",
        false,
    )
}
fn text(value: &Value) -> Result<String, PublishError> {
    value
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(invalid)
}
fn optional(value: &Value) -> Result<Option<String>, PublishError> {
    if value.is_null() {
        Ok(None)
    } else {
        text(value).map(Some)
    }
}

pub fn version1(value: &Value) -> Result<Value, PublishError> {
    let phase = text(&value["phase"])?;
    let checkpoint = match phase.as_str() {
        "prepared" => "prepared",
        "project-created" => "project-created",
        "credential-issued" => "credential-issued",
        "remote-configured" => "remote-configured",
        "pushed" => "push-accepted",
        "compensation-pending" => "cleanup-requested",
        "completed" => "completed",
        _ => return Err(invalid()),
    };
    let project = optional(&value["project_id"])?;
    let updated = text(&value["updated_at"])?;
    let created = text(&value["created_at"])?;
    let accepted = matches!(phase.as_str(), "pushed" | "completed");
    let cleaning = phase == "compensation-pending";
    let operation = text(&value["operation_id"])?.to_lowercase();
    let commit = text(&value["expected_head_commit_id"])?.to_lowercase();
    let branch = text(&value["expected_branch"])?;
    Ok(json!({
        "version": 2,
        "kind": "puppyone-cloud-initialization",
        "operation_id": operation,
        "revision": value["revision"],
        "checkpoint": checkpoint,
        "api_base_url": text(&value["api_base_url"])?,
        "api_origin": text(&value["api_origin"])?,
        "user_id": text(&value["user_id"])?,
        "organization_id": text(&value["organization_id"])?,
        "project_name": text(&value["project_name"])?,
        "create_payload": value["create_payload"],
        "repository_fingerprint": text(&value["repository_fingerprint"])?,
        "selected_source_branch": branch,
        "selected_source_ref": format!("refs/heads/{branch}"),
        "destination_ref": "refs/heads/main",
        "project_state": if accepted { "published" } else if cleaning { "deleting" } else if project.is_some() { "empty" } else { "absent" },
        "push_state": if accepted { "accepted" } else if cleaning { "failed" } else { "idle" },
        "cleanup_state": if cleaning { "requested" } else { "none" },
        "project_id": project,
        "credential_id": optional(&value["credential_id"])?,
        "secret_ref": optional(&value["secret_ref"])?,
        "secret_stored": value["secret_stored"] == true,
        "canonical_remote_url": optional(&value["canonical_remote_url"])?,
        "credential_username": optional(&value["credential_username"])?,
        "credential_config_snapshot": value["credential_config_snapshot"],
        "remote_add_intent": value["remote_add_intent"] == true,
        "remote_created_by_operation": value["remote_created_by_operation"] == true,
        "attempt_count": 1,
        "attempt": {
            "attempt_id": operation,
            "sequence": 1,
            "commit_oid": commit,
            "expected_remote_oid": null,
            "state": if accepted { "accepted" } else if cleaning { "failed" } else { "preparing" },
            "started_at": created,
            "updated_at": updated,
            "completed_at": if accepted { Some(updated.clone()) } else { None },
        },
        "attempt_history": [],
        "last_error": null,
        "migrated_from": {"version": 1, "phase": phase, "migrated_at": updated, "persisted": false},
        "created_at": created,
        "updated_at": updated,
    }))
}
