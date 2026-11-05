//! `application/history/agent-history-queries.mjs`: History queries
//! receive only catalog and native discovery capabilities.
use super::super::agent_input_policy::{normalize_runtime_id, require_workspace_root};
use super::super::ports::HistoryCatalog;
use super::history_operation::{history_failure, observe_history_operation};
use super::native_conversation_indexer::NativeConversationIndexer;
use crate::agent::agent_error::AgentResult;
use crate::agent::contract::js::{self, Obj};
use crate::agent::domain::agent_conversation_metadata::public_session_record;
use crate::agent::event_loop::{AbortController, set_timeout};
use crate::agent::migrations::legacy_session_format::resolve_persisted_runtime_id;
use crate::agent::sender::Sender;
use serde_json::{Value, json};
use std::rc::Rc;

#[derive(Clone)]
pub struct AgentHistoryQueries {
    catalog: Rc<dyn HistoryCatalog>,
    indexer: NativeConversationIndexer,
}

impl AgentHistoryQueries {
    pub fn new(catalog: Rc<dyn HistoryCatalog>, indexer: NativeConversationIndexer) -> Self {
        Self { catalog, indexer }
    }

    /// `history.listSessions(sender, request, workspaceRoot)`.
    pub async fn list_sessions(
        &self,
        sender: &Sender,
        request: &Value,
        workspace_root: &str,
    ) -> AgentResult<Value> {
        require_workspace_root(Some(workspace_root))?;
        let runtime_id = normalize_runtime_id(request.get("runtimeId"));
        let discover = js::truthy_opt(request.get("discoverNative"));
        let discovery = match (&runtime_id, discover) {
            (Some(runtime_id), true) => {
                self.indexer
                    .refresh(
                        workspace_root,
                        runtime_id,
                        request.get("cursor").cloned().unwrap_or(Value::Null),
                        request
                            .get("scanId")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        request.get("limit").cloned(),
                        Some(sender.id()),
                    )
                    .await
            }
            _ => json!({
                "runtimeId": runtime_id, "status": "not-requested", "nextCursor": null, "scanId": null,
                "indexed": 0, "warnings": [],
            }),
        };
        let controller = AbortController::new();
        let timeout = {
            let controller = controller.clone();
            set_timeout(2_000, move || {
                controller.abort(history_failure(
                    "History catalog read timed out.",
                    None,
                    None,
                ))
            })
        };
        let include_archived = js::truthy_opt(request.get("includeArchived"));
        let catalog = self.catalog.clone();
        let read = async {
            let records = if catalog.supports_list_page() {
                let options = Obj::new()
                    .set(
                        "runtimeId",
                        if discover { None } else { runtime_id.clone() },
                    )
                    .set("includeArchived", include_archived)
                    .set(
                        "cursor",
                        request.get("catalogCursor").cloned().unwrap_or(Value::Null),
                    )
                    .build();
                catalog
                    .list_page(workspace_root.to_string(), options)
                    .await?
            } else {
                let options =
                    json!({ "runtimeId": runtime_id, "includeArchived": include_archived });
                Value::Array(catalog.list(workspace_root.to_string(), options).await?)
            };
            let coverage = catalog.get_coverage().await?;
            Ok((records, coverage))
        };
        let result = observe_history_operation(read, &controller.signal()).await;
        timeout.clear();
        let (records, coverage) = result?;
        let (mut sessions, next_cursor, excluded) = match records {
            Value::Array(sessions) => (sessions, None, None),
            page => (
                page["sessions"].as_array().cloned().unwrap_or_default(),
                Some(page.get("nextCursor").cloned().unwrap_or(Value::Null)),
                page.get("excludedSessionIds")
                    .filter(|e| js::truthy(e))
                    .cloned(),
            ),
        };
        if let Some(discovered) = discovery.get("sessions").and_then(Value::as_array) {
            sessions = discovered
                .iter()
                .filter(|record| include_archived || !js::truthy_opt(record.get("archivedAt")))
                .cloned()
                .collect();
        }
        let mut public_discovery = discovery.clone();
        js::delete(&mut public_discovery, "sessions");
        let sessions = sessions
            .iter()
            .filter_map(|record| {
                let resolved = resolve_persisted_runtime_id(record, runtime_id.as_deref());
                public_session_record(&js::with(record, "runtimeId", resolved)).ok()
            })
            .collect::<Vec<_>>();
        let mut out = Obj::new();
        if let Some(next) = next_cursor {
            out = out
                .set("catalogNextCursor", next)
                .set("sessionListKind", "page");
        }
        Ok(out
            .opt("excludedSessionIds", excluded)
            .opt("catalogCoverage", js::truthy(&coverage).then_some(coverage))
            .set("sessions", sessions)
            .set(
                "warnings",
                discovery
                    .get("warnings")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            )
            .set("discovery", public_discovery)
            .build())
    }
}
