use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DesktopStatus {
    pub app_name: String,
    pub recorder_ready: bool,
    pub cloud_sync_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub agent: String,
    pub workspace: String,
    pub modified: u32,
    pub created: u32,
    pub deleted: u32,
    pub risk: String,
}

pub fn desktop_status() -> DesktopStatus {
    DesktopStatus {
        app_name: "puppyone".to_string(),
        recorder_ready: true,
        cloud_sync_enabled: false,
    }
}

pub fn demo_sessions() -> Vec<SessionSummary> {
    vec![
        SessionSummary {
            id: "s-1".to_string(),
            agent: "Claude Code".to_string(),
            workspace: "Client files".to_string(),
            modified: 12,
            created: 3,
            deleted: 1,
            risk: "high".to_string(),
        },
        SessionSummary {
            id: "s-2".to_string(),
            agent: "Codex CLI".to_string(),
            workspace: "puppyone repo".to_string(),
            modified: 8,
            created: 2,
            deleted: 0,
            risk: "medium".to_string(),
        },
    ]
}
