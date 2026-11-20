//! Local model service discovery (`discovery-service.mjs`): probe the
//! loopback ports model services listen on and name each service by what it
//! answers, never by its port (8000 and 8080 are shared by several). Only
//! `127.0.0.1` is contacted; model files are never read.
use super::Driver;
use crate::agent::model_connections::configuration::is_loopback_host;
use crate::agent::model_connections::providers;
use std::time::Duration;

/// A reachable local model service.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub driver: Driver,
    pub name: String,
    /// `http://127.0.0.1:<port>/v1`.
    pub endpoint: String,
}

/// Ports local model services listen on by default: Ollama, LM Studio,
/// llama.cpp / MLX / LocalAI, vLLM / Unsloth, Jan, and common alternates.
const PORTS: [u16; 7] = [11434, 1234, 8080, 8000, 1337, 8081, 5000];
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// The ports to probe: the defaults and a loopback `OLLAMA_HOST`.
pub fn ports(ollama_host: Option<&str>) -> Vec<u16> {
    let mut ports = PORTS.to_vec();
    if let Some(port) = ollama_host.and_then(ollama_port)
        && !ports.contains(&port)
    {
        ports.insert(0, port);
    }
    ports
}

/// `OLLAMA_HOST` (`host:port`, `http://host:port`, `:port`) when it names a
/// loopback address.
fn ollama_port(value: &str) -> Option<u16> {
    let value = value.trim();
    let with_scheme = if value.contains("://") {
        value.to_owned()
    } else {
        format!(
            "http://{}",
            value
                .strip_prefix(':')
                .map(|p| format!("127.0.0.1:{p}"))
                .unwrap_or(value.to_owned())
        )
    };
    let url = url::Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?;
    (is_loopback_host(host) || host == "0.0.0.0").then_some(())?;
    url.port()
}

/// What answered on a port, from its responses (`None` when nothing that
/// looks like a model service did).
#[derive(Default)]
pub struct Answers {
    /// `GET /api/version`.
    pub ollama_version: Option<serde_json::Value>,
    /// `GET /api/v1/models`.
    pub lm_studio_models: Option<serde_json::Value>,
    /// `GET /props`.
    pub llama_props: Option<serde_json::Value>,
    /// `GET /v1/models`.
    pub openai_models: Option<serde_json::Value>,
    /// `GET /version`.
    pub version: Option<serde_json::Value>,
}

/// Name a service by its answers.
pub fn identify(answers: &Answers) -> Option<Driver> {
    if answers
        .ollama_version
        .as_ref()
        .is_some_and(|v| v["version"].is_string())
    {
        return Some(Driver::Ollama);
    }
    if answers.lm_studio_models.as_ref().is_some_and(|v| {
        v["models"].as_array().is_some_and(|models| {
            models
                .iter()
                .all(|m| m["key"].is_string() && m["type"].is_string())
        })
    }) {
        return Some(Driver::LmStudio);
    }
    if answers.llama_props.as_ref().is_some_and(|p| {
        p["default_generation_settings"].is_object() || p["build_info"].is_string()
    }) {
        return Some(Driver::LlamaCpp);
    }
    let models = answers
        .openai_models
        .as_ref()
        .and_then(|v| v["data"].as_array())?;
    let owned_by = |owner: &str| models.iter().any(|m| m["owned_by"] == owner);
    if owned_by("vllm") {
        return Some(Driver::Vllm);
    }
    if owned_by("jan") {
        return Some(Driver::Jan);
    }
    if answers.version.as_ref().is_some_and(|v| {
        v["version"]
            .as_str()
            .is_some_and(|s| s.to_ascii_lowercase().contains("localai"))
    }) {
        return Some(Driver::LocalAi);
    }
    // `mlx_lm.server` lists Hugging Face repos; MLX conversions name `mlx`.
    if !models.is_empty()
        && models.iter().all(|m| {
            m["id"]
                .as_str()
                .is_some_and(|id| id.to_ascii_lowercase().contains("mlx"))
        })
    {
        return Some(Driver::Mlx);
    }
    Some(Driver::OpenaiCompatible)
}

/// The candidate a port's answers describe.
pub fn candidate(port: u16, answers: &Answers) -> Option<Candidate> {
    let driver = identify(answers)?;
    let name = match providers::local_for(driver) {
        Some(p) if driver != Driver::OpenaiCompatible => p.name.to_owned(),
        _ => format!("OpenAI-compatible · {port}"),
    };
    Some(Candidate {
        driver,
        name,
        endpoint: format!("http://127.0.0.1:{port}/v1"),
    })
}

async fn probe(client: &reqwest::Client, port: u16) -> Option<Candidate> {
    let base = format!("http://127.0.0.1:{port}");
    let get = |path: &'static str| {
        let url = format!("{base}{path}");
        async move {
            let response = client.get(url).send().await.ok()?;
            if !response.status().is_success() {
                return None;
            }
            response.json::<serde_json::Value>().await.ok()
        }
    };
    // A closed port answers nothing: stop before the other probes.
    let ollama_version = get("/api/version").await;
    if ollama_version
        .as_ref()
        .is_some_and(|v| v["version"].is_string())
    {
        return candidate(
            port,
            &Answers {
                ollama_version,
                ..Default::default()
            },
        );
    }
    let (lm_studio_models, llama_props, openai_models, version) = futures_util::join!(
        get("/api/v1/models"),
        get("/props"),
        get("/v1/models"),
        get("/version")
    );
    candidate(
        port,
        &Answers {
            ollama_version,
            lm_studio_models,
            llama_props,
            openai_models,
            version,
        },
    )
}

/// Probe every port concurrently; one candidate per answering port.
pub async fn discover_ports(ports: &[u16]) -> Vec<Candidate> {
    let Ok(client) = crate::platform::proxy::system(reqwest::Client::builder())
        .redirect_policy(reqwest::redirect::Policy::none())
        .timeout(PROBE_TIMEOUT)
        .build()
    else {
        return vec![];
    };
    futures_util::future::join_all(ports.iter().map(|port| probe(&client, *port)))
        .await
        .into_iter()
        .flatten()
        .collect()
}

/// A local service installed on this Mac, running or not.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Installed {
    pub driver: Driver,
    pub name: &'static str,
}

fn home() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}
fn app(name: &str) -> bool {
    std::path::Path::new("/Applications").join(name).exists()
        || home().join("Applications").join(name).exists()
}
fn on_path(command: &str) -> Option<std::path::PathBuf> {
    ["/opt/homebrew/bin", "/usr/local/bin"]
        .iter()
        .map(std::path::PathBuf::from)
        .chain(std::iter::once(home().join(".lmstudio/bin")))
        .map(|dir| dir.join(command))
        .find(|path| path.is_file())
}

/// Ollama and LM Studio as installed (the app or its command line).
pub fn installed() -> Vec<Installed> {
    let mut found = vec![];
    if app("Ollama.app") || on_path("ollama").is_some() {
        found.push(Installed {
            driver: Driver::Ollama,
            name: "Ollama",
        });
    }
    if app("LM Studio.app") || on_path("lms").is_some() {
        found.push(Installed {
            driver: Driver::LmStudio,
            name: "LM Studio",
        });
    }
    found
}

/// Start an installed service at the user's request: the app when present,
/// else its server command. Nothing is installed or downloaded.
pub fn start(driver: Driver) -> Result<(), String> {
    let spawn = |program: &std::path::Path, args: &[&str]| {
        std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|_| "START_FAILED".to_owned())
    };
    let open = std::path::Path::new("/usr/bin/open");
    match driver {
        Driver::Ollama if app("Ollama.app") => spawn(open, &["-g", "-a", "Ollama"]),
        Driver::Ollama => spawn(&on_path("ollama").ok_or("NOT_INSTALLED")?, &["serve"]),
        Driver::LmStudio => match on_path("lms") {
            Some(lms) => spawn(&lms, &["server", "start"]),
            None if app("LM Studio.app") => spawn(open, &["-g", "-a", "LM Studio"]),
            None => Err("NOT_INSTALLED".into()),
        },
        _ => Err("NOT_INSTALLED".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn answers() -> Answers {
        Answers::default()
    }

    #[test]
    fn services_are_named_by_what_they_answer() {
        let cases = [
            (
                Answers {
                    ollama_version: Some(json!({"version": "0.12.0"})),
                    ..answers()
                },
                Some(Driver::Ollama),
            ),
            (
                Answers {
                    lm_studio_models: Some(json!({"models": [{"key": "qwen", "type": "llm"}]})),
                    ..answers()
                },
                Some(Driver::LmStudio),
            ),
            (
                Answers {
                    llama_props: Some(json!({"default_generation_settings": {"n_ctx": 8192}})),
                    openai_models: Some(json!({"data": [{"id": "model.gguf"}]})),
                    ..answers()
                },
                Some(Driver::LlamaCpp),
            ),
            (
                Answers {
                    openai_models: Some(
                        json!({"data": [{"id": "Qwen/Qwen3-8B", "owned_by": "vllm"}]}),
                    ),
                    ..answers()
                },
                Some(Driver::Vllm),
            ),
            (
                Answers {
                    openai_models: Some(json!({"data": [{"id": "mlx-community/Qwen3-8B-4bit"}]})),
                    ..answers()
                },
                Some(Driver::Mlx),
            ),
            (
                Answers {
                    openai_models: Some(json!({"data": [{"id": "phi"}]})),
                    version: Some(json!({"version": "LocalAI v3.1"})),
                    ..answers()
                },
                Some(Driver::LocalAi),
            ),
            (
                Answers {
                    openai_models: Some(json!({"data": [{"id": "custom"}]})),
                    ..answers()
                },
                Some(Driver::OpenaiCompatible),
            ),
            (answers(), None),
        ];
        for (answers, expected) in cases {
            assert_eq!(identify(&answers), expected);
        }
    }

    /// The PRD's acceptance: another service on Ollama's or LM Studio's port
    /// is not taken for them.
    #[test]
    fn a_port_held_by_another_service_is_not_misnamed() {
        let other = Answers {
            ollama_version: Some(json!({"name": "some web app"})),
            lm_studio_models: Some(json!({"models": [{"id": "x"}]})),
            ..answers()
        };
        assert_eq!(identify(&other), None);
        let generic = candidate(
            11434,
            &Answers {
                openai_models: Some(json!({"data": [{"id": "m"}]})),
                ..other
            },
        )
        .unwrap();
        assert_eq!(generic.driver, Driver::OpenaiCompatible);
        assert_eq!(generic.name, "OpenAI-compatible · 11434");
    }

    #[test]
    fn ollama_host_adds_its_loopback_port_only() {
        assert_eq!(ports(Some("127.0.0.1:11500"))[0], 11500);
        assert_eq!(ports(Some("http://localhost:11600"))[0], 11600);
        assert_eq!(ports(Some(":11700"))[0], 11700);
        assert_eq!(ports(Some("0.0.0.0:11800"))[0], 11800);
        assert_eq!(ports(Some("192.168.1.9:11434")), PORTS.to_vec());
        assert_eq!(ports(None), PORTS.to_vec());
    }

    /// One real HTTP round per path on a loopback port.
    fn serve(routes: Vec<(&'static str, &'static str)>) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut request = [0u8; 2048];
                let n = stream.read(&mut request).unwrap_or(0);
                let head = String::from_utf8_lossy(&request[..n]).to_string();
                let path = head
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or_default()
                    .to_owned();
                let (status, body) = routes
                    .iter()
                    .find(|(p, _)| *p == path)
                    .map(|(_, b)| ("200 OK", *b))
                    .unwrap_or(("404 Not Found", "{}"));
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        port
    }

    #[test]
    fn discovery_finds_services_over_http_and_skips_closed_ports() {
        let ollama = serve(vec![("/api/version", r#"{"version":"0.12.0"}"#)]);
        let llama = serve(vec![
            (
                "/props",
                r#"{"default_generation_settings":{"n_ctx":4096}}"#,
            ),
            ("/v1/models", r#"{"data":[{"id":"m.gguf"}]}"#),
        ]);
        let closed = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let found = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(discover_ports(&[ollama, llama, closed]));
        assert_eq!(
            found
                .iter()
                .map(|c| (c.driver, c.endpoint.clone()))
                .collect::<Vec<_>>(),
            [
                (Driver::Ollama, format!("http://127.0.0.1:{ollama}/v1")),
                (Driver::LlamaCpp, format!("http://127.0.0.1:{llama}/v1")),
            ]
        );
    }
}
