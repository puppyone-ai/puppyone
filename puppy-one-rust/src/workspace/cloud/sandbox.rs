//! Cloud Computer sandbox features, settings, and screen session admission
//! (`cloudSandboxFeatures.ts`, `cloudScreenState.ts`, `CloudComputerScreen.tsx`,
//! `CloudComputerSettings.tsx`).
use super::model;
use crate::cloud::auth::{
    self as auth, Broker, Cancellation, ScreenSocket,
    model::{ApiRequest, Binding},
};
use reqwest::Method;
use serde_json::{Map, Value};
use std::sync::{Arc, Mutex};

pub const SCREEN_STREAM_FEATURE: &str = "screen_stream";
pub const VNC_TRANSPORT: &str = "vnc";
pub const CLOUD_SCREEN_RECONNECTS: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SandboxSlot {
    SidebarFooter,
    EditorSurface,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SandboxError {
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScreenConnectError {
    Asleep,
    Failed,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SandboxSettings {
    pub desktop: Option<bool>,
    pub screen_stream: Option<bool>,
    pub isolated_agent_sandboxes: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SandboxFeature {
    pub id: String,
    pub installed: bool,
    pub enabled: bool,
    pub preview: bool,
    pub reason: Option<String>,
    pub transport: Option<String>,
    pub requires: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CloudSandbox {
    pub profile: Option<String>,
    pub next_profile: Option<String>,
    pub settings: SandboxSettings,
    pub features: Vec<SandboxFeature>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScreenAvailability {
    Stream { transport: String },
    Preview,
    Install { pending: bool },
    StreamOff,
    Unavailable,
}

impl CloudSandbox {
    /// `cloudScreenFeature`: the resolved `screen_stream` feature, if reported.
    pub fn screen_feature(&self) -> Option<&SandboxFeature> {
        self.features.iter().find(|f| f.id == SCREEN_STREAM_FEATURE)
    }

    /// The bound computer has a screen to show: its Profile ships
    /// `screen_stream`, or the server reports it as a preview. A stream the
    /// owner turned off is still present.
    pub fn screen_present(&self) -> bool {
        self.screen_feature()
            .is_some_and(|f| f.installed || f.preview)
    }

    /// `cloudSandboxContributions`: enabled client entry points for `slot`.
    pub fn contributions(&self, slot: Option<SandboxSlot>) -> Vec<&'static str> {
        let _ = slot;
        if self
            .features
            .iter()
            .any(|f| f.id == SCREEN_STREAM_FEATURE && f.enabled)
        {
            vec![SCREEN_STREAM_FEATURE]
        } else {
            Vec::new()
        }
    }

    /// `cloudScreenAvailability` + `cloudScreenViewer` (`vnc`).
    pub fn availability(&self) -> ScreenAvailability {
        let feature = self.screen_feature();
        if let Some(f) = feature
            && f.preview
        {
            return ScreenAvailability::Preview;
        }
        if feature.is_none()
            || feature.is_some_and(|f| {
                f.reason.as_deref() == Some("not_installed")
                    || (f.reason.as_deref() == Some("requires") && !f.installed)
            })
        {
            return ScreenAvailability::Install {
                pending: self.next_profile.as_deref() == Some("desktop"),
            };
        }
        let f = feature.expect("checked Some above");
        if f.reason.as_deref() == Some("user_disabled") {
            return ScreenAvailability::StreamOff;
        }
        if !f.enabled || f.transport.as_deref() != Some(VNC_TRANSPORT) {
            return ScreenAvailability::Unavailable;
        }
        ScreenAvailability::Stream {
            transport: VNC_TRANSPORT.to_owned(),
        }
    }

    pub fn desktop_enabled(&self) -> bool {
        self.settings
            .desktop
            .unwrap_or_else(|| self.next_profile.as_deref() == Some("desktop"))
    }

    pub fn stream_enabled(&self) -> bool {
        self.settings.screen_stream.unwrap_or(true)
    }

    pub fn isolated_agent_sandboxes_enabled(&self) -> bool {
        self.settings.isolated_agent_sandboxes.unwrap_or(false)
    }

    pub fn desktop_pending(&self) -> bool {
        match (self.profile.as_deref(), self.next_profile.as_deref()) {
            (Some(profile), Some(next)) if !profile.is_empty() && !next.is_empty() => {
                profile != next
            }
            _ => false,
        }
    }
}

/// `readCloudSandbox`: tolerates older servers without Profiles and malformed rows.
pub fn read_sandbox(value: &Value) -> CloudSandbox {
    let Some(obj) = value.as_object() else {
        return CloudSandbox::default();
    };
    let settings = obj
        .get("settings")
        .and_then(Value::as_object)
        .map(|s| SandboxSettings {
            desktop: s.get("desktop").and_then(Value::as_bool),
            screen_stream: s.get("screen_stream").and_then(Value::as_bool),
            isolated_agent_sandboxes: s.get("isolated_agent_sandboxes").and_then(Value::as_bool),
        })
        .unwrap_or_default();
    let features = obj
        .get("features")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(read_feature).collect())
        .unwrap_or_default();
    CloudSandbox {
        profile: obj
            .get("profile")
            .and_then(Value::as_str)
            .map(str::to_owned),
        next_profile: obj
            .get("next_profile")
            .and_then(Value::as_str)
            .map(str::to_owned),
        settings,
        features,
    }
}

fn read_feature(value: &Value) -> Option<SandboxFeature> {
    let obj = value.as_object()?;
    let id = obj.get("id")?.as_str()?.to_owned();
    let enabled = obj.get("enabled")?.as_bool()?;
    let requires = obj
        .get("requires")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    Some(SandboxFeature {
        id,
        installed: obj
            .get("installed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        enabled,
        preview: obj.get("preview").and_then(Value::as_bool).unwrap_or(false),
        reason: obj.get("reason").and_then(Value::as_str).map(str::to_owned),
        transport: obj
            .get("transport")
            .and_then(Value::as_str)
            .map(str::to_owned),
        requires,
    })
}

fn unwrap_envelope(mut value: Value) -> Value {
    if value.get("code") == Some(&Value::from(0)) && value.get("data").is_some() {
        value["data"].take()
    } else {
        value
    }
}

/// Reads `workspace.sandbox` from `GET /projects/{project_id}/workbench`.
pub fn fetch_project_sandbox(
    broker: &Broker,
    binding: &Binding,
    project_id: &str,
    cancel: &Cancellation,
) -> std::result::Result<CloudSandbox, SandboxError> {
    if !model::identifier(project_id) {
        return Err(SandboxError::Failed);
    }
    let req = ApiRequest {
        idempotency_key: None,
        method: Method::GET,
        path: format!("/projects/{project_id}/workbench"),
        query: Vec::new(),
        body: None,
    };
    let response = broker
        .request_scoped(binding, &req, cancel)
        .map_err(|_| SandboxError::Failed)?;
    let unwrapped = unwrap_envelope(response);
    Ok(read_sandbox(&unwrapped["workspace"]["sandbox"]))
}

/// The body of `PUT /workbench/sandbox`: only the settings given; `None`
/// when there is nothing to change.
pub fn settings_body(patch: &SandboxSettings) -> Option<Value> {
    let mut body = Map::new();
    if let Some(desktop) = patch.desktop {
        body.insert("desktop".into(), Value::Bool(desktop));
    }
    if let Some(stream) = patch.screen_stream {
        body.insert("screen_stream".into(), Value::Bool(stream));
    }
    if let Some(isolated) = patch.isolated_agent_sandboxes {
        body.insert("isolated_agent_sandboxes".into(), Value::Bool(isolated));
    }
    (!body.is_empty()).then_some(Value::Object(body))
}

/// Sends `PUT /projects/{project_id}/workbench/sandbox` and parses the updated sandbox.
pub fn update_project_sandbox(
    broker: &Broker,
    binding: &Binding,
    project_id: &str,
    patch: SandboxSettings,
    cancel: &Cancellation,
) -> std::result::Result<CloudSandbox, SandboxError> {
    if !model::identifier(project_id) {
        return Err(SandboxError::Failed);
    }
    let body = settings_body(&patch).ok_or(SandboxError::Failed)?;
    let req = ApiRequest {
        idempotency_key: None,
        method: Method::PUT,
        path: format!("/projects/{project_id}/workbench/sandbox"),
        query: Vec::new(),
        body: Some(body),
    };
    let response = broker
        .request_scoped(binding, &req, cancel)
        .map_err(|_| SandboxError::Failed)?;
    Ok(read_sandbox(&unwrap_envelope(response)))
}

fn map_connect_error(error: auth::Error) -> ScreenConnectError {
    match error {
        auth::Error::Http(409)
        | auth::Error::Service(409, _)
        | auth::Error::Response(409, _, _) => ScreenConnectError::Asleep,
        _ => ScreenConnectError::Failed,
    }
}

/// Live Cloud workspace handle for sandbox state and screen-stream sessions.
///
/// Like [`super::agent::AgentTarget`], this handle binds to the account and
/// project rather than the SSE file-watcher lease so project sandbox updates
/// and `409` sleep detection continue working even after an idle workbench
/// stops its file event stream.
#[derive(Clone)]
pub struct SandboxTarget {
    pub(super) broker: Arc<Broker>,
    pub(super) binding: Binding,
    pub(super) project: String,
    pub(super) storage: String,
    pub(super) sandbox: Arc<Mutex<CloudSandbox>>,
}

impl SandboxTarget {
    pub fn same_instance(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.sandbox, &other.sandbox)
    }

    pub fn project_id(&self) -> &str {
        &self.project
    }

    pub fn storage(&self) -> &str {
        &self.storage
    }

    pub fn sandbox(&self) -> CloudSandbox {
        self.sandbox.lock().unwrap().clone()
    }

    pub fn set_cached(&self, next: CloudSandbox) {
        *self.sandbox.lock().unwrap() = next;
    }

    pub fn refresh(
        &self,
        cancel: &Cancellation,
    ) -> std::result::Result<CloudSandbox, SandboxError> {
        let next = fetch_project_sandbox(&self.broker, &self.binding, &self.project, cancel)?;
        self.set_cached(next.clone());
        Ok(next)
    }

    pub fn update(
        &self,
        patch: SandboxSettings,
        cancel: &Cancellation,
    ) -> std::result::Result<CloudSandbox, SandboxError> {
        let next =
            update_project_sandbox(&self.broker, &self.binding, &self.project, patch, cancel)?;
        self.set_cached(next.clone());
        Ok(next)
    }

    /// Mints a single-use screen ticket (`POST /workbench/screen/session`) and opens
    /// the ticketed WebSocket (`/workbench/screen/stream`). Does not retire the
    /// workspace lease if the computer went to sleep (`409`).
    pub fn connect_screen(
        &self,
        cancel: &Cancellation,
    ) -> std::result::Result<ScreenSocket, ScreenConnectError> {
        cancel.check().map_err(|_| ScreenConnectError::Failed)?;
        self.broker
            .check_binding(&self.binding)
            .map_err(|_| ScreenConnectError::Failed)?;
        let req = ApiRequest {
            idempotency_key: None,
            method: Method::POST,
            path: format!("/projects/{}/workbench/screen/session", self.project),
            query: Vec::new(),
            body: None,
        };
        let response = self
            .broker
            .request_scoped(&self.binding, &req, cancel)
            .map_err(map_connect_error)?;
        let session = unwrap_envelope(response);
        let ticket = session["ticket"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or(ScreenConnectError::Failed)?;
        let protocol = session["protocol"]
            .as_str()
            .filter(|&p| p == "puppyone.screen.v1")
            .ok_or(ScreenConnectError::Failed)?;
        let prefix = session["ticket_protocol_prefix"]
            .as_str()
            .filter(|&p| p == "puppyone.screen.ticket.")
            .ok_or(ScreenConnectError::Failed)?;
        if session["transport"].as_str() != Some(VNC_TRANSPORT) {
            return Err(ScreenConnectError::Failed);
        }
        let ticket_protocol = format!("{prefix}{ticket}");
        self.broker
            .screen_stream(
                &self.binding,
                &self.project,
                (protocol, &ticket_protocol),
                cancel,
            )
            .map_err(map_connect_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::auth::{
        ServiceCode, responding_account_fixture, responding_screen_account_fixture,
    };
    use serde_json::json;

    #[test]
    fn read_sandbox_tolerates_missing_and_malformed_fields() {
        assert_eq!(read_sandbox(&Value::Null), CloudSandbox::default());
        assert_eq!(read_sandbox(&json!("nope")), CloudSandbox::default());

        let parsed = read_sandbox(&json!({
            "profile": 42,
            "next_profile": "desktop",
            "settings": { "desktop": "yes", "screen_stream": false },
            "features": [
                null,
                { "id": 1, "enabled": true },
                { "id": "unknown_future", "enabled": true },
                {
                    "id": "screen_stream",
                    "installed": true,
                    "enabled": true,
                    "preview": false,
                    "transport": "vnc",
                    "requires": ["desktop", 99]
                }
            ]
        }));
        assert_eq!(parsed.profile, None);
        assert_eq!(parsed.next_profile.as_deref(), Some("desktop"));
        assert_eq!(parsed.settings.desktop, None);
        assert_eq!(parsed.settings.screen_stream, Some(false));
        assert_eq!(parsed.features.len(), 2);
        assert_eq!(
            parsed.contributions(Some(SandboxSlot::SidebarFooter)),
            vec![SCREEN_STREAM_FEATURE]
        );
        assert_eq!(
            parsed.availability(),
            ScreenAvailability::Stream {
                transport: "vnc".into()
            }
        );
    }

    #[test]
    fn availability_covers_preview_install_stream_off_and_unavailable() {
        let preview = read_sandbox(&json!({
            "features": [{ "id": "screen_stream", "installed": true, "enabled": true, "preview": true, "transport": "vnc" }]
        }));
        assert_eq!(preview.availability(), ScreenAvailability::Preview);

        assert_eq!(
            CloudSandbox::default().availability(),
            ScreenAvailability::Install { pending: false }
        );

        let pending = read_sandbox(&json!({
            "profile": "headless",
            "next_profile": "desktop",
            "features": [{ "id": "screen_stream", "installed": false, "enabled": false, "reason": "not_installed" }]
        }));
        assert_eq!(
            pending.availability(),
            ScreenAvailability::Install { pending: true }
        );
        assert!(pending.desktop_pending());

        let requires_uninstalled = read_sandbox(&json!({
            "features": [{ "id": "screen_stream", "installed": false, "enabled": false, "reason": "requires" }]
        }));
        assert_eq!(
            requires_uninstalled.availability(),
            ScreenAvailability::Install { pending: false }
        );

        let stream_off = read_sandbox(&json!({
            "features": [{ "id": "screen_stream", "installed": true, "enabled": false, "reason": "user_disabled", "transport": "vnc" }]
        }));
        assert_eq!(stream_off.availability(), ScreenAvailability::StreamOff);

        let unsupported_transport = read_sandbox(&json!({
            "features": [{ "id": "screen_stream", "installed": true, "enabled": true, "transport": "webrtc" }]
        }));
        assert_eq!(
            unsupported_transport.availability(),
            ScreenAvailability::Unavailable
        );

        // Only a computer that has a screen (or a preview of one) offers it.
        assert!(preview.screen_present());
        assert!(stream_off.screen_present());
        assert!(unsupported_transport.screen_present());
        assert!(!CloudSandbox::default().screen_present());
        assert!(!pending.screen_present());
        assert!(!requires_uninstalled.screen_present());
    }

    /// `cloudSandboxFeatures`: a disabled screen contributes nothing; a
    /// computer staying on its own profile offers to install a desktop now;
    /// the owner's toggle reads as off while any other refusal reads as
    /// unavailable.
    #[test]
    fn disabled_screens_contribute_nothing_and_refusals_are_told_apart() {
        let screen = |extra: Value| {
            let mut feature = json!({
                "id": "screen_stream", "surface": "screen", "transport": "vnc",
                "installed": true, "enabled": true, "reason": null, "preview": false
            });
            feature
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            read_sandbox(&json!({
                "profile": "desktop", "next_profile": "desktop", "settings": {},
                "features": [{"id": "desktop", "installed": true, "enabled": true}, feature,
                             {"id": "browser", "installed": true, "enabled": true},
                             {"id": "from_a_newer_server", "surface": "panel", "installed": true, "enabled": true}]
            }))
        };
        assert_eq!(
            screen(json!({})).contributions(Some(SandboxSlot::SidebarFooter)),
            vec![SCREEN_STREAM_FEATURE]
        );
        let off = screen(json!({"enabled": false, "reason": "user_disabled"}));
        assert!(
            off.contributions(Some(SandboxSlot::SidebarFooter))
                .is_empty()
        );
        assert_eq!(off.availability(), ScreenAvailability::StreamOff);
        assert_eq!(
            screen(json!({"enabled": false, "reason": "disabled"})).availability(),
            ScreenAvailability::Unavailable
        );
        let base = read_sandbox(&json!({
            "profile": "base", "next_profile": "base",
            "features": [{"id": "screen_stream", "installed": false, "enabled": false, "reason": "not_installed"}]
        }));
        assert_eq!(
            base.availability(),
            ScreenAvailability::Install { pending: false }
        );
    }

    #[test]
    fn settings_body_sends_only_the_settings_given() {
        assert_eq!(settings_body(&SandboxSettings::default()), None);
        assert_eq!(
            settings_body(&SandboxSettings {
                desktop: Some(true),
                ..Default::default()
            }),
            Some(json!({ "desktop": true }))
        );
        assert_eq!(
            settings_body(&SandboxSettings {
                desktop: Some(false),
                screen_stream: Some(true),
                ..Default::default()
            }),
            Some(json!({ "desktop": false, "screen_stream": true }))
        );
        assert_eq!(
            settings_body(&SandboxSettings {
                isolated_agent_sandboxes: Some(true),
                ..Default::default()
            }),
            Some(json!({ "isolated_agent_sandboxes": true }))
        );
        let parsed = read_sandbox(&json!({
            "profile": "base",
            "next_profile": "base",
            "settings": { "isolated_agent_sandboxes": true },
            "features": []
        }));
        assert!(parsed.isolated_agent_sandboxes_enabled());
    }

    #[test]
    fn connect_screen_maps_409_to_asleep_and_opens_ticketed_stream() {
        let (asleep_broker, _) = responding_account_fixture(Arc::new(|req| {
            assert_eq!(req.path, "/projects/proj-1/workbench/screen/session");
            Err(auth::Error::Service(409, ServiceCode::NotRunning))
        }));
        let binding = asleep_broker.signed_in_binding().unwrap();
        let cancel = Cancellation::default();
        let target = SandboxTarget {
            broker: asleep_broker,
            binding,
            project: "proj-1".into(),
            storage: "puppyone-cloud://test/".into(),
            sandbox: Arc::new(Mutex::new(CloudSandbox::default())),
        };
        assert_eq!(
            target.connect_screen(&cancel).err(),
            Some(ScreenConnectError::Asleep)
        );

        let (live_broker, _) = responding_screen_account_fixture(
            Arc::new(|req| match (req.method.as_str(), req.path.as_str()) {
                ("PUT", "/projects/proj-1/workbench/sandbox") => Ok(json!({
                    "profile": "headless",
                    "next_profile": "desktop",
                    "settings": { "desktop": true, "screen_stream": true },
                    "features": [{ "id": "screen_stream", "installed": false, "enabled": false, "reason": "not_installed" }]
                })),
                ("POST", "/projects/proj-1/workbench/screen/session") => Ok(json!({
                    "ticket": "tok-123",
                    "protocol": "puppyone.screen.v1",
                    "ticket_protocol_prefix": "puppyone.screen.ticket.",
                    "transport": "vnc",
                    "expires_at": "2026-11-15T12:00:00Z"
                })),
                _ => Err(auth::Error::Http(404)),
            }),
            Arc::new(|url, protocols| {
                assert_eq!(
                    url.as_str(),
                    "ws://127.0.0.1:18080/api/v1/projects/proj-1/workbench/screen/stream"
                );
                assert_eq!(protocols.0, "puppyone.screen.v1");
                assert_eq!(protocols.1, "puppyone.screen.ticket.tok-123");
                let (client, server) = ScreenSocket::pair();
                std::thread::spawn(move || {
                    futures_lite_send(server, b"RFB 003.008\n".to_vec());
                });
                Ok(client)
            }),
        );
        let live_binding = live_broker.signed_in_binding().unwrap();
        let live_target = SandboxTarget {
            broker: live_broker,
            binding: live_binding,
            project: "proj-1".into(),
            storage: "puppyone-cloud://test/".into(),
            sandbox: Arc::new(Mutex::new(CloudSandbox::default())),
        };
        let updated = live_target
            .update(
                SandboxSettings {
                    desktop: Some(true),
                    ..Default::default()
                },
                &cancel,
            )
            .unwrap();
        assert_eq!(
            updated.availability(),
            ScreenAvailability::Install { pending: true }
        );
        let socket = live_target.connect_screen(&cancel).unwrap();
        let greeting = poll_recv(&socket).unwrap();
        assert_eq!(greeting, b"RFB 003.008\n");
    }

    fn futures_lite_send(socket: ScreenSocket, bytes: Vec<u8>) {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(socket.send(bytes)).unwrap();
    }

    fn poll_recv(socket: &ScreenSocket) -> Option<Vec<u8>> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(socket.recv())
    }
}
