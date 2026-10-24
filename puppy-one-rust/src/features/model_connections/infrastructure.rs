use crate::{model_connections::configuration, wake::Wake};
pub use configuration::ModelConnection;
use std::sync::mpsc::{self, Receiver};
pub fn load(wake: Wake) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let _ = tx.send(configuration::load());
        wake.notify();
    });
    rx
}
pub fn save(
    connection: ModelConnection,
    secret: Option<String>,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let result = configuration::save(connection, secret).and_then(|()| configuration::load());
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

pub fn remove(
    id: String,
    generation: String,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let result = configuration::remove(&id, &generation).and_then(|()| configuration::load());
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

/// A reachable local model service (`discovery-service.mjs` candidates).
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub name: &'static str,
    pub endpoint: &'static str,
}
/// `drivers/{ollama,lm-studio}.mjs` candidates and their probes.
const CANDIDATES: [(Candidate, &str); 2] = [
    (
        Candidate {
            name: "Ollama",
            endpoint: "http://127.0.0.1:11434/v1",
        },
        "http://127.0.0.1:11434/api/version",
    ),
    (
        Candidate {
            name: "LM Studio",
            endpoint: "http://127.0.0.1:1234/v1",
        },
        "http://127.0.0.1:1234/api/v1/models",
    ),
];
/// Probe the known local services; only loopback is ever contacted.
pub fn discover(wake: Wake) -> Receiver<Vec<Candidate>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let found = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map(|runtime| {
                runtime.block_on(async {
                    let Ok(client) = reqwest::Client::builder()
                        .redirect_policy(reqwest::redirect::Policy::none())
                        .timeout(std::time::Duration::from_millis(1500))
                        .build()
                    else {
                        return vec![];
                    };
                    let mut found = vec![];
                    for (candidate, probe) in CANDIDATES {
                        let Ok(response) = client.get(probe).send().await else {
                            continue;
                        };
                        let Ok(value) = response.json::<serde_json::Value>().await else {
                            continue;
                        };
                        let reachable = if candidate.name == "Ollama" {
                            value["version"].is_string()
                        } else {
                            value["models"].as_array().is_some_and(|models| {
                                models
                                    .iter()
                                    .all(|m| m["key"].is_string() && m["type"].is_string())
                            })
                        };
                        if reachable {
                            found.push(candidate);
                        }
                    }
                    found
                })
            })
            .unwrap_or_default();
        let _ = tx.send(found);
        wake.notify();
    });
    rx
}
