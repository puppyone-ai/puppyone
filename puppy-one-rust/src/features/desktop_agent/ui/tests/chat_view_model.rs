//! `agentChatViewModel.test.ts`, `desktop-agent.error-presentation.test.ts`
//! and `desktop-agent.session-presentation.test.ts`.
use crate::agent::contract::display_types::AgentDisplay;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentDisplayRecovery, AgentDisplayRecoveryCause,
    AgentDisplayRecoveryPolicy, AgentDisplayRecoveryStage, AgentSessionPreparation,
    AgentSubmissionStage, ReplicaStatus,
};
use crate::features::desktop_agent::domain::agent_session_controls::{
    AgentSessionControlId, AgentSessionControlOption, AgentSessionControlSelection,
    derive_agent_session_controls,
};
use crate::features::desktop_agent::domain::agent_stream_presentation::{
    next_agent_stream_text, split_streaming_markdown,
};
use crate::features::desktop_agent::ui::agent_chat_view_model::{
    AgentChatViewModel, AgentChatViewOptions, derive_agent_chat_runtime,
    derive_agent_chat_view_model,
};
use crate::features::desktop_agent::ui::agent_error_presentation::present_agent_error;
use crate::localization::t;
use serde_json::{Value, json};
use std::sync::Arc;

fn ready_state() -> AgentControllerState {
    AgentControllerState {
        initialized: true,
        phase: AgentControllerPhase::Ready,
        selected_runtime_id: Some("opencode".into()),
        selected_model: Some("model-1".into()),
        replica_status: ReplicaStatus::Live,
        inspection: Some(json!({
            "runtime": { "id": "opencode", "displayName": "OpenCode", "kind": "harness" },
            "readiness": { "runtimeId": "opencode", "provider": "opencode", "status": "ready", "code": "READY", "version": "1", "minimumVersion": null, "message": "Ready" },
            "account": null,
            "models": [{ "id": "model-1", "model": "model-1", "displayName": "Model", "description": "Test", "isDefault": true }],
            "warnings": [],
            "capabilities": {
                "streamingText": true, "structuredToolEvents": true, "commandOutputStreaming": true, "fileChangeEvents": true,
                "manualApprovals": true, "structuredQuestions": true, "resume": true, "fork": false, "steer": false, "queue": false,
                "attachments": false, "contextReferences": false, "modelSelection": true, "modeSelection": false,
                "slashCommands": false, "sessionHistory": true, "usage": true, "accountState": true, "mcp": false, "skills": false,
                "compaction": false,
            },
        })),
        ..Default::default()
    }
}

fn options() -> AgentChatViewOptions {
    AgentChatViewOptions {
        presented: true,
        pending_connection_model: None,
        compute_ready: false,
        compute_access_required: None,
        preferences_ready: true,
    }
}

fn view_with(
    state: &AgentControllerState,
    options: AgentChatViewOptions,
    hidden: &[&str],
) -> AgentChatViewModel {
    let hidden: Vec<String> = hidden.iter().map(|id| id.to_string()).collect();
    derive_agent_chat_view_model(state, derive_agent_chat_runtime(state, &hidden), &options)
}

fn view(state: &AgentControllerState) -> AgentChatViewModel {
    view_with(state, options(), &[])
}

fn capabilities(state: &mut AgentControllerState) -> &mut Value {
    &mut state.inspection.as_mut().expect("inspection")["capabilities"]
}

fn onboard() -> AgentControllerState {
    let mut state = ready_state();
    capabilities(&mut state)["modelConnections"] = json!(true);
    let readiness = &mut state.inspection.as_mut().expect("inspection")["readiness"];
    readiness["status"] = json!("error");
    readiness["code"] = json!("RUNTIME_SETUP_REQUIRED");
    state.selected_model = None;
    state
}

fn session() -> Value {
    json!({
        "id": "session-1", "provider": "opencode", "providerSessionId": "native-1", "workspaceRoot": "/workspace",
        "title": "Saved chat", "createdAt": "2026-01-01", "updatedAt": "2026-01-01", "terminalState": "idle",
        "selectedModel": "model-1", "activeTurnId": null, "lastSequence": 0,
    })
}

fn push(state: &mut AgentControllerState, collection: &str) {
    let mut display = state.projection.to_value();
    display[collection]
        .as_array_mut()
        .expect("collection")
        .push(json!({}));
    state.projection = AgentDisplay::from_value(&display).unwrap_or_else(|_| {
        let mut projection = state.projection.clone();
        projection
            .collection_mut(collection)
            .push(Arc::new(json!({})));
        projection
    });
}

#[test]
fn derives_ready_rendering_and_session_preparation_from_the_same_route() {
    let model = view(&ready_state());
    assert!(
        model.routing_ready
            && !model.composer_disabled
            && model.show_ready_empty_state
            && !model.show_status
    );
    assert_eq!(model.presentation.title, "OpenCode");
    assert_eq!(
        model.presentation.runtime_label.as_deref(),
        Some("OpenCode")
    );
    assert_eq!(model.presentation.status_code, "ready");
    assert!(!model.presentation.running);
    assert_eq!(
        model.composer_placeholder,
        t("agent.composer.placeholder.default")
    );
    let ids: Vec<AgentSessionControlId> = model.session_controls.iter().map(|c| c.id).collect();
    assert_eq!(ids, vec![AgentSessionControlId::Model]);
}

#[test]
fn shows_startup_loading_while_discovering_restoring_or_creating() {
    for phase in [
        AgentControllerPhase::Discovering,
        AgentControllerPhase::Restoring,
        AgentControllerPhase::Creating,
    ] {
        let state = AgentControllerState {
            phase,
            ..ready_state()
        };
        let model = view(&state);
        assert!(
            model.loading
                && model.startup_loading
                && model.composer_disabled
                && !model.show_ready_empty_state
        );
        assert!(
            !view_with(
                &state,
                AgentChatViewOptions {
                    presented: false,
                    ..options()
                },
                &[]
            )
            .startup_loading
        );
    }
}

#[test]
fn preserves_failed_and_exited_recovery() {
    for phase in [
        AgentControllerPhase::Failed,
        AgentControllerPhase::RuntimeExited,
    ] {
        let model = view(&AgentControllerState {
            phase,
            ..ready_state()
        });
        assert!(
            model.failed
                && model.show_status
                && model.composer_disabled
                && !model.show_ready_empty_state
        );
        assert_eq!(
            model.composer_placeholder,
            t("agent.composer.placeholder.preparing")
        );
    }
}

#[test]
fn blocks_the_composer_while_the_replica_is_stale_or_subscribing() {
    for replica_status in [ReplicaStatus::Stale, ReplicaStatus::Subscribing] {
        assert!(
            view(&AgentControllerState {
                replica_status,
                ..ready_state()
            })
            .composer_disabled
        );
    }
}

#[test]
fn keeps_hidden_sessions_bound_while_hiding_unused_runtimes() {
    let mut state = ready_state();
    let model = view_with(&state, options(), &["opencode"]);
    assert!(
        !model.runtime.agent_runtime_selected
            && model.show_runtime_launcher
            && model.runtime.runtime_models.is_empty()
    );
    assert_eq!(
        model.composer_placeholder,
        t("agent.composer.placeholder.chooseAgent")
    );
    state.session = Some(session());
    let model = view_with(&state, options(), &["opencode"]);
    assert!(
        model.runtime.agent_runtime_selected
            && !model.show_runtime_launcher
            && model.runtime.agent_runtimes.is_empty()
    );
}

#[test]
fn blocks_missing_unregistered_and_pending_model_routes() {
    let model = view(&AgentControllerState {
        selected_model: None,
        ..ready_state()
    });
    assert!(!model.routing_ready);
    assert_eq!(
        model.composer_placeholder,
        t("agent.composer.placeholder.chooseModel")
    );
    assert!(
        !view(&AgentControllerState {
            selected_model: Some("missing".into()),
            ..ready_state()
        })
        .routing_ready
    );
    assert!(
        !view_with(
            &ready_state(),
            AgentChatViewOptions {
                preferences_ready: false,
                ..options()
            },
            &[]
        )
        .routing_ready
    );
    assert!(
        !view_with(
            &ready_state(),
            AgentChatViewOptions {
                pending_connection_model: Some("model-2".into()),
                ..options()
            },
            &[]
        )
        .routing_ready
    );
    let mut state = ready_state();
    capabilities(&mut state)["modelSelection"] = json!(false);
    state.selected_model = None;
    assert!(view(&state).routing_ready);
}

#[test]
fn requires_compute_readiness_only_for_app_managed_models() {
    let mut state = ready_state();
    capabilities(&mut state)["modelConnections"] = json!(true);
    let model = view(&state);
    assert!(model.model_connections && !model.routing_ready && model.session_controls.is_empty());
    assert!(
        view_with(
            &state,
            AgentChatViewOptions {
                compute_ready: true,
                ..options()
            },
            &[]
        )
        .routing_ready
    );
    assert!(
        !view_with(
            &state,
            AgentChatViewOptions {
                compute_ready: true,
                pending_connection_model: Some("model-2".into()),
                ..options()
            },
            &[]
        )
        .routing_ready
    );
}

#[test]
fn offers_first_use_access_without_turning_setup_into_a_failure() {
    let model = view(&onboard());
    assert!(
        model.compute_onboarding
            && model.show_ready_empty_state
            && !model.show_status
            && model.composer_disabled
    );
    assert_eq!(
        model.composer_placeholder,
        t("agent.composer.placeholder.default")
    );
    let model = view_with(
        &onboard(),
        AgentChatViewOptions {
            compute_access_required: Some("sign-in".into()),
            ..options()
        },
        &[],
    );
    assert!(model.can_request_compute_access && !model.composer_disabled && !model.routing_ready);
}

#[test]
fn retains_recovery_for_credential_failures() {
    for code in [
        "AUTHENTICATION_REQUIRED",
        "AUTHENTICATION_EXPIRED",
        "PROVIDER_CREDENTIALS_REJECTED",
    ] {
        let mut state = onboard();
        state.inspection.as_mut().expect("inspection")["readiness"]["code"] = json!(code);
        let model = view_with(
            &state,
            AgentChatViewOptions {
                compute_access_required: Some("sign-in".into()),
                ..options()
            },
            &[],
        );
        assert!(
            !model.compute_onboarding && !model.can_request_compute_access && model.show_status,
            "{code}"
        );
    }
}

#[test]
fn excludes_saved_state_from_first_use_onboarding() {
    for reason in ["model", "session", "history", "error", "failed"] {
        let mut state = onboard();
        match reason {
            "model" => state.selected_model = Some("model-1".into()),
            "session" => state.session = Some(session()),
            "history" => push(&mut state, "messages"),
            "error" => state.error = Some(json!({ "code": "event-gap" })),
            _ => state.phase = AgentControllerPhase::Failed,
        }
        assert!(!view(&state).compute_onboarding, "{reason}");
    }
}

#[test]
fn suppresses_the_empty_state_for_committed_or_interactive_content() {
    for kind in [
        "rows",
        "parts",
        "messages",
        "activities",
        "approvals",
        "questions",
    ] {
        let mut state = ready_state();
        push(&mut state, kind);
        let model = view(&state);
        assert!(!model.show_ready_empty_state, "{kind}");
        if ["rows", "messages"].contains(&kind) {
            assert_eq!(
                model.composer_placeholder,
                t("agent.composer.placeholder.followUp")
            );
        }
        if ["approvals", "questions"].contains(&kind) {
            assert!(model.composer_disabled);
        }
    }
}

#[test]
fn keeps_the_empty_overlay_for_drafts_but_hides_it_for_history_gaps_and_connection_status() {
    assert!(
        view(&AgentControllerState {
            draft: "unsent".into(),
            ..ready_state()
        })
        .show_ready_empty_state
    );
    let mut state = ready_state();
    state
        .projection
        .set("history", json!({ "coverage": "partial", "reason": null }));
    assert!(!view(&state).show_ready_empty_state);
    state
        .projection
        .set("history", json!({ "coverage": "complete", "reason": null }));
    state
        .projection
        .set("connectionStatus", json!({ "state": "reconnecting" }));
    assert!(!view(&state).show_ready_empty_state);
}

#[test]
fn keeps_attachment_only_submission_feedback_across_preparation_and_admission() {
    let mut state = AgentControllerState {
        submitting: true,
        pending_prompt: Some(String::new()),
        ..ready_state()
    };
    let model = view(&state);
    assert!(model.submission_pending && model.configuration_disabled);
    assert_eq!(
        model.submission_stage,
        Some(AgentSubmissionStage::PreparingSession)
    );
    state.session = Some(session());
    assert_eq!(
        view(&state).submission_stage,
        Some(AgentSubmissionStage::StartingTurn)
    );
    state.session_preparation = AgentSessionPreparation::Preparing;
    assert_eq!(
        view(&state).submission_stage,
        Some(AgentSubmissionStage::PreparingSession)
    );
    state.projection.set("runningTurnId", json!("turn-1"));
    let model = view(&state);
    assert!(model.submission_stage.is_none() && model.running && model.compute_disabled);
}

#[test]
fn preserves_silent_event_gap_recovery_without_suppressing_other_errors() {
    let mut state = ready_state();
    state.error = Some(json!({ "code": "event-gap" }));
    state.display_recovery = Some(AgentDisplayRecovery {
        stage: AgentDisplayRecoveryStage::Silent,
        cause: AgentDisplayRecoveryCause::RevisionGap,
        policy: AgentDisplayRecoveryPolicy::Automatic,
        attempt: 1,
        max_attempts: 3,
    });
    assert!(!view(&state).show_status);
    if let Some(recovery) = state.display_recovery.as_mut() {
        recovery.stage = AgentDisplayRecoveryStage::Reconnecting;
    }
    assert!(view(&state).show_status);
}

#[test]
fn keeps_read_only_capability_separate_from_route_readiness() {
    let mut state = ready_state();
    capabilities(&mut state)["readOnly"] = json!(true);
    let model = view(&state);
    assert!(model.read_only && model.routing_ready && model.composer_disabled);
}

#[test]
fn renders_an_ended_session_without_a_missing_message_fallback() {
    let presented =
        present_agent_error(Some(&json!({ "code": "session-ended" }))).expect("presented");
    assert!(!presented.summary.is_empty());
    assert_ne!(presented.summary, "agent.error.session-ended");
}

fn inspection(models: Value, modes: Value) -> Value {
    json!({
        "selectedRuntimeId": "fixture", "readiness": null, "account": null, "models": models, "modes": modes, "warnings": [],
        "capabilities": {
            "streamingText": true, "structuredToolEvents": true, "commandOutputStreaming": true, "fileChangeEvents": true,
            "manualApprovals": true, "structuredQuestions": true, "resume": true, "fork": true, "steer": false, "queue": false,
            "attachments": true, "contextReferences": true, "modelSelection": true, "modeSelection": true, "slashCommands": true,
            "sessionHistory": true, "usage": true, "accountState": true, "mcp": true, "skills": true, "compaction": true,
        },
    })
}

#[test]
fn projects_native_model_and_mode_capabilities_without_inventing_effort() {
    let inspection = inspection(
        json!([
            { "id": "auto", "model": "auto", "displayName": "Auto", "description": "", "isDefault": true },
            { "id": "composer", "model": "composer", "displayName": "Composer", "description": "", "isDefault": false },
        ]),
        json!([
            { "id": "agent", "displayName": "Agent", "description": "", "isDefault": true },
            { "id": "plan", "displayName": "Plan", "description": "", "isDefault": false },
            { "id": "ask", "displayName": "Ask", "description": "", "isDefault": false },
        ]),
    );
    let controls = derive_agent_session_controls(
        Some(&inspection),
        AgentSessionControlSelection {
            selected_model: Some("auto"),
            selected_effort: None,
            selected_mode: Some("agent"),
        },
    );
    let ids: Vec<AgentSessionControlId> = controls.iter().map(|c| c.id).collect();
    assert_eq!(
        ids,
        vec![AgentSessionControlId::Model, AgentSessionControlId::Mode]
    );
    assert_eq!(controls[0].value.as_deref(), Some("auto"));
    assert_eq!(
        (
            controls[0].options[0].value.as_str(),
            controls[0].options[0].label.as_str()
        ),
        ("auto", "Auto")
    );
    let values: Vec<&str> = controls[1]
        .options
        .iter()
        .map(|o| o.value.as_str())
        .collect();
    assert_eq!(values, vec!["agent", "plan", "ask"]);
}

#[test]
fn derives_effort_only_from_the_selected_models_native_variants() {
    let inspection = inspection(
        json!([
            { "id": "fast", "model": "fast", "displayName": "Fast", "description": "", "isDefault": false },
            { "id": "deep", "model": "deep", "displayName": "Deep", "description": "", "isDefault": true, "variants": ["low", "high"] },
        ]),
        json!([]),
    );
    let controls = derive_agent_session_controls(
        Some(&inspection),
        AgentSessionControlSelection {
            selected_model: Some("deep"),
            selected_effort: Some("high"),
            selected_mode: None,
        },
    );
    let ids: Vec<AgentSessionControlId> = controls.iter().map(|c| c.id).collect();
    assert_eq!(
        ids,
        vec![AgentSessionControlId::Model, AgentSessionControlId::Effort]
    );
    assert_eq!(controls[1].value.as_deref(), Some("high"));
    let option = |value: &str| AgentSessionControlOption {
        value: value.into(),
        label: value.into(),
        ..Default::default()
    };
    assert_eq!(controls[1].options, vec![option("low"), option("high")]);
}

#[test]
fn advances_by_grapheme_safe_adaptive_frames_and_converges() {
    let authoritative = "A👨‍👩‍👧‍👦BCDEFGHIJK";
    let mut displayed = "A".to_string();
    for _ in 0..12 {
        if displayed == authoritative {
            break;
        }
        let next = next_agent_stream_text(&displayed, authoritative);
        assert!(authoritative.starts_with(&next));
        assert!(next.len() > displayed.len());
        displayed = next;
    }
    assert_eq!(displayed, authoritative);
    assert_eq!(
        next_agent_stream_text("stale", "replacement"),
        "replacement"
    );
}

fn split(text: &str) -> (String, String) {
    split_streaming_markdown(text)
}

fn pair(stable: &str, tail: &str) -> (String, String) {
    (stable.to_string(), tail.to_string())
}

#[test]
fn keeps_an_incomplete_markdown_block_in_a_stable_plain_text_tail() {
    assert_eq!(
        split("First paragraph\n\n**still typing"),
        pair("First paragraph\n\n", "**still typing")
    );
    assert_eq!(
        split("```ts\nconst ok = true;\n```\nNext"),
        pair("```ts\nconst ok = true;\n```\n", "Next")
    );
    assert_eq!(
        split("```ts\nconst pending = true;"),
        pair("", "```ts\nconst pending = true;")
    );
}

#[test]
fn promotes_a_validated_gfm_table_one_completed_row_at_a_time() {
    assert_eq!(
        split(
            &[
                "Before",
                "",
                "| Name | State |",
                "| --- | ---: |",
                "| Parser | run"
            ]
            .join("\n")
        ),
        pair(
            "Before\n\n| Name | State |\n| --- | ---: |\n",
            "| Parser | run"
        )
    );
    assert_eq!(
        split(
            &[
                "Before",
                "",
                "| Name | State |",
                "| --- | ---: |",
                "| Parser | running |",
                "| Renderer | wai"
            ]
            .join("\n")
        ),
        pair(
            "Before\n\n| Name | State |\n| --- | ---: |\n| Parser | running |\n",
            "| Renderer | wai"
        )
    );
    assert_eq!(
        split(&["| Name | State |", "| --- | --- |", "Parser", "Renderer"].join("\n")),
        pair("| Name | State |\n| --- | --- |\nParser\n", "Renderer")
    );
    assert_eq!(
        split("| State |\n| --- |\ncomplete\npen"),
        pair("| State |\n| --- |\ncomplete\n", "pen")
    );
}

#[test]
fn does_not_promote_malformed_or_ambiguous_pipe_text() {
    assert_eq!(
        split("| One | Two |\n| --- |\n| value | other |\n"),
        pair("", "| One | Two |\n| --- |\n| value | other |\n")
    );
    assert_eq!(
        split("Introductory prose\nOne | Two\n--- | ---\n"),
        pair("", "Introductory prose\nOne | Two\n--- | ---\n")
    );
}

#[test]
fn ends_table_streaming_before_a_competing_flow_block() {
    assert_eq!(
        split(
            &[
                "| Name | State |",
                "| --- | --- |",
                "| Parser | complete |",
                "# Result",
                "Still streaming"
            ]
            .join("\n")
        ),
        pair(
            "| Name | State |\n| --- | --- |\n| Parser | complete |\n",
            "# Result\nStill streaming"
        )
    );
}
