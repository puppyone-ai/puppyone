//! Thin adapter between Settings › Model Connections UI and the `po-agent`
//! [`ModelConnectionService`] authority. All driver probing, catalog parsing,
//! persistence, and verification logic live in `po-agent::agent::model_connections`.
use crate::agent::model_connections::{ModelConnectionService, configuration, drivers, snapshot};
use crate::wake::Wake;
pub use configuration::{Auth, Driver, ModelConnection, SourceKind};
pub use drivers::{Candidate, CatalogModel};
#[cfg(test)]
pub use drivers::{list_models, lm_studio_models, ollama_models, openai_models, project};
pub use snapshot::{CatalogStatus, ConnectionCatalog, ModelConnectionSnapshot};
use std::sync::{
    Arc,
    mpsc::{self, Receiver},
};

pub fn load_with_service(
    service: Arc<ModelConnectionService>,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let _ = tx.send(service.reload_saved());
        wake.notify();
    });
    rx
}

pub fn save_with_service(
    service: Arc<ModelConnectionService>,
    connection: ModelConnection,
    secret: Option<String>,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let _ = tx.send(service.save(connection, secret));
        wake.notify();
    });
    rx
}

pub fn remove_with_service(
    service: Arc<ModelConnectionService>,
    id: String,
    generation: String,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let _ = tx.send(service.remove(&id, &generation));
        wake.notify();
    });
    rx
}

/// Probe the known local services; only loopback is ever contacted.
pub fn discover(wake: Wake) -> Receiver<Vec<Candidate>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let found = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map(|runtime| runtime.block_on(drivers::discover_local()))
            .unwrap_or_default();
        let _ = tx.send(found);
        wake.notify();
    });
    rx
}

/// A catalog read in flight. Dropping it (a newer read, the page left)
/// cancels its requests, waiting their turn or sent.
pub struct CatalogRead {
    rx: Receiver<Result<Vec<CatalogModel>, String>>,
    _cancel: tokio_util::sync::DropGuard,
}
impl CatalogRead {
    pub fn try_recv(&self) -> Result<Result<Vec<CatalogModel>, String>, mpsc::TryRecvError> {
        self.rx.try_recv()
    }
}

/// Refresh the catalog of connection `id` through `service`.
pub fn catalog_with_service(
    service: Arc<ModelConnectionService>,
    id: String,
    wake: Wake,
) -> CatalogRead {
    let (tx, rx) = mpsc::sync_channel(1);
    let cancel = tokio_util::sync::CancellationToken::new();
    let cancelled = cancel.clone();
    std::thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
            .and_then(|runtime| {
                runtime.block_on(drivers::until_cancelled(
                    service.refresh_connection(&id),
                    &cancelled,
                ))
            });
        let _ = tx.send(result);
        wake.notify();
    });
    CatalogRead {
        rx,
        _cancel: cancel.drop_guard(),
    }
}

/// `verify`: the Agent tool round trip for `(id, model_id)` persisted via `service`.
pub fn verify_with_service(
    service: Arc<ModelConnectionService>,
    id: String,
    model_id: String,
    wake: Wake,
) -> Receiver<Result<(), String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
            .and_then(|runtime| runtime.block_on(service.verify_model(&id, &model_id)));
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use crate::agent::model_connections::drivers::{metadata_client, ollama_detail};
    use serde_json::json;

    #[test]
    fn ollama_catalog_marks_loaded_models_and_their_context() {
        let tags = json!({"models": [
            {"name": "qwen3:8b"}, {"model": "llama3.2"}, {"name": ""}, {"name": "bad\u{7}id"}
        ]});
        let running = json!({"models": [{"name": "qwen3:8b", "context_length": 8192}]});
        let models = ollama_models(&tags, Some(&running));
        assert_eq!(
            models
                .iter()
                .map(|m| (m.id.as_str(), m.loaded, m.context))
                .collect::<Vec<_>>(),
            vec![
                ("qwen3:8b", Some(true), Some(8192)),
                ("llama3.2", Some(false), None)
            ]
        );
        // Without `/api/ps` the loaded state is unknown, not "not loaded".
        assert!(
            ollama_models(&tags, None)
                .iter()
                .all(|m| m.loaded.is_none())
        );
    }

    #[test]
    fn lm_studio_catalog_keeps_language_models_with_reported_capabilities() {
        let value = json!({"models": [
            {"type": "llm", "key": "qwen/qwen3-8b", "display_name": "Qwen3 8B",
             "capabilities": {"trained_for_tool_use": true, "vision": false},
             "loaded_instances": [{"config": {"context_length": 32768}}, {"config": {"context_length": 4096}}]},
            {"type": "embedding", "key": "nomic-embed"},
            {"type": "llm", "key": "gemma"}
        ]});
        let models = lm_studio_models(&value);
        assert_eq!(models.len(), 2);
        assert_eq!(
            (
                models[0].name.as_str(),
                models[0].tools,
                models[0].loaded,
                models[0].context
            ),
            ("Qwen3 8B", Some(true), Some(true), Some(4096))
        );
        assert_eq!(
            (models[1].name.as_str(), models[1].tools, models[1].loaded),
            ("gemma", None, Some(false))
        );
    }

    #[test]
    fn openai_catalog_lists_valid_ids_only() {
        let value = json!({"data": [{"id": "gpt-4.1"}, {"id": "  "}, {"id": 7}, {"id": "o3"}]});
        let ids: Vec<_> = openai_models(&value).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["gpt-4.1", "o3"]);
    }

    /// One HTTP exchange on a loopback port: the request head, answered
    /// with `status` and `body`.
    fn serve(status: &'static str, body: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let n = stream.read(&mut request).unwrap();
            let head = String::from_utf8_lossy(&request[..n]).to_string();
            write!(
                stream,
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            head
        });
        (port, server)
    }
    fn list(connection: &ModelConnection, key: Option<&str>) -> Result<Vec<CatalogModel>, String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async { list_models(&metadata_client()?, connection, key).await })
    }

    #[test]
    fn generic_services_are_read_over_http() {
        let (port, server) = serve("200 OK", r#"{"data":[{"id":"local-model"}]}"#);
        let connection = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..Default::default()
        };
        let models = list(&connection, Some("sk-test")).unwrap();
        let head = server.join().unwrap();
        assert!(head.starts_with("GET /v1/models "), "{head}");
        assert!(
            head.to_ascii_lowercase()
                .contains("authorization: bearer sk-test")
        );
        assert_eq!(
            models.into_iter().map(|m| m.id).collect::<Vec<_>>(),
            ["local-model"]
        );
    }

    /// `rejects metadata that echoes a credential`, `does not follow a
    /// metadata redirect with credentials`.
    #[test]
    fn a_catalog_echoing_the_key_or_redirecting_is_refused() {
        let connection = |port: u16| ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..Default::default()
        };
        let (port, server) = serve("200 OK", r#"{"data":[{"id":"synthetic-private-key"}]}"#);
        assert_eq!(
            list(&connection(port), Some("synthetic-private-key")),
            Err("INVALID_RESPONSE".into())
        );
        server.join().unwrap();
        // The redirect's target is never contacted.
        let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let elsewhere = target.local_addr().unwrap().port();
        let origin = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = origin.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = origin.accept().unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request).unwrap();
            write!(
                stream,
                "HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:{elsewhere}/v1/models\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            )
            .unwrap();
        });
        assert_eq!(
            list(&connection(port), Some("synthetic-private-key")),
            Err("REDIRECT_REJECTED".into())
        );
        server.join().unwrap();
        assert_eq!(
            target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    /// `providerDrivers.test.mjs`: "supports an explicit model ID when
    /// /models is absent, without inventing capabilities".
    #[test]
    fn a_manual_model_is_served_when_the_service_lists_none() {
        let (port, server) = serve("404 Not Found", "{}");
        let connection = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/proxy/v1"),
            manual_model_id: Some("manual".into()),
            manual_context_window: Some(4096),
            ..Default::default()
        };
        let models = list(&connection, None).unwrap();
        server.join().unwrap();
        assert_eq!(
            models,
            [CatalogModel {
                context: Some(4096),
                ..CatalogModel::named("manual".into())
            }]
        );
        // Without a manual model a missing catalog is an error.
        let (port, server) = serve("404 Not Found", "{}");
        let bare = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..Default::default()
        };
        assert_eq!(list(&bare, None).unwrap_err(), "ENDPOINT_NOT_FOUND");
        server.join().unwrap();
    }

    #[test]
    fn the_context_budget_fills_unreported_windows_within_the_maximum() {
        let connection = ModelConnection {
            manual_context_window: Some(32768),
            ..Default::default()
        };
        let models = project(
            &connection,
            vec![
                CatalogModel {
                    context: Some(8192),
                    ..CatalogModel::named("loaded".into())
                },
                CatalogModel {
                    max_context: Some(4096),
                    ..CatalogModel::named("small".into())
                },
                CatalogModel::named("open".into()),
            ],
        );
        assert_eq!(
            models.iter().map(|m| m.context).collect::<Vec<_>>(),
            [Some(8192), Some(4096), Some(32768)]
        );
        let mut detail = CatalogModel::named("qwen3".into());
        ollama_detail(
            &mut detail,
            &json!({"capabilities": ["completion", "tools"], "model_info": {"qwen3.context_length": 40960}}),
        );
        assert_eq!(
            (detail.tools, detail.images, detail.max_context),
            (Some(true), Some(false), Some(40960))
        );
    }
}
