//! The pixel lab's History (`FixtureHistory` in
//! `tools/reference-workbench-entry.tsx`): four runtimes, five sessions;
//! Codex has another page, so "Load more" shows.
use crate::features::desktop_agent::application::agent_client_port::AgentClientPort;
use crate::features::desktop_agent::application::conversation_history_controller::ConversationHistoryController;
use crate::features::desktop_agent::fixtures::{JsonAgent, JsonAnswer, JsonPort};
use crate::features::desktop_agent::infrastructure::host::window_runtime::WindowUiRuntime;
use crate::features::desktop_agent::ui::agent_conversation_history::{
    HistoryBrowser, HistorySource,
};
use gpui::{App, AppContext as _, Entity, Window};
use std::rc::Rc;

/// The History browser over the reference sessions (none unless
/// `populated`).
pub fn lab_history_browser(
    populated: bool,
    enabled: bool,
    window: &mut Window,
    cx: &mut App,
) -> Entity<HistoryBrowser> {
    let client: Rc<dyn AgentClientPort> = Rc::new(JsonPort(LabHistoryClient { populated }));
    let controller = ConversationHistoryController::new(
        "/reference/project",
        Rc::new(move || Some(client.clone())),
        WindowUiRuntime::create(cx),
    );
    cx.new(|cx| HistoryBrowser::new(HistorySource::Agent(controller), enabled, window, cx))
}

/// The reference entry's History: four runtimes and five saved chats.
struct LabHistoryClient {
    populated: bool,
}

impl JsonAgent for LabHistoryClient {
    fn supports(&self, operation: crate::agent::contract::protocol::AgentOperation) -> bool {
        use crate::agent::contract::protocol::AgentOperation as O;
        matches!(operation, O::DiscoverRuntimes | O::ListSessions)
    }

    fn answer(
        &self,
        operation: crate::agent::contract::protocol::AgentOperation,
        request: serde_json::Value,
    ) -> JsonAnswer {
        use crate::agent::contract::protocol::AgentOperation as O;
        use serde_json::json;
        const NOW: i64 = 1_800_000_000_000;
        let runtimes = [
            ("codex", "Codex"),
            ("claude", "Claude Code"),
            ("pi", "Pi"),
            ("opencode-native", "OpenCode"),
        ];
        let runtime = |id: &str| {
            let (id, label) = runtimes
                .iter()
                .find(|(r, _)| *r == id)
                .copied()
                .unwrap_or((id, id));
            let icon = if id == "opencode-native" {
                "opencode"
            } else {
                id
            };
            json!({ "id": id, "displayName": label, "iconKey": icon, "ownership": { "session": "runtime" } })
        };
        let session = |id: usize, runtime_id: &str, title: &str, age: i64| {
            json!({
                "id": format!("history-{id}"), "title": title, "runtimeId": runtime_id,
                "runtime": runtime(runtime_id),
                "updatedAt": crate::clock::iso_string(NOW - age),
            })
        };
        let sessions: Vec<serde_json::Value> = if self.populated {
            vec![
                session(
                    0,
                    "codex",
                    "Make the terminal colours follow the theme",
                    5 * 60_000,
                ),
                session(
                    1,
                    "claude",
                    "Refactor the workbench split constraints",
                    2 * 3_600_000,
                ),
                session(2, "codex", "Port the approval dock to GPUI", 26 * 3_600_000),
                session(
                    3,
                    "pi",
                    "Investigate the flaky terminal resize test after the PTY host moved",
                    3 * 86_400_000,
                ),
                session(
                    4,
                    "opencode-native",
                    "Audit markdown table rendering",
                    9 * 86_400_000,
                ),
            ]
        } else {
            vec![]
        };
        let result = match operation {
            O::DiscoverRuntimes => json!({
                "runtimes": runtimes.iter().map(|(id, _)| json!({
                    "descriptor": runtime(id),
                    "readiness": { "runtimeId": id, "status": "ready", "code": "READY", "selectable": true },
                })).collect::<Vec<_>>(),
            }),
            _ if request["discoverNative"] == true => {
                let runtime_id = request["runtimeId"].as_str().unwrap_or_default();
                let more = runtime_id == "codex";
                json!({
                    "sessions": sessions.iter().filter(|s| s["runtimeId"] == runtime_id).collect::<Vec<_>>(),
                    "discovery": {
                        "runtimeId": runtime_id,
                        "status": if more { "partial" } else { "complete" },
                        "coverage": if more { "partial" } else { "complete" },
                        "nextCursor": more.then_some("page-2"),
                        "scanId": more.then_some("scan-1"),
                    },
                })
            }
            _ => json!({
                "sessions": sessions,
                "catalogCoverage": { "truncated": false },
                "catalogNextCursor": null,
            }),
        };
        Box::pin(async move { Ok(result) })
    }
}
