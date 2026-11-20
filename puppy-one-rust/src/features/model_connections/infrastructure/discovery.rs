//! Local model discovery: the model services running on this Mac with the
//! models each serves, and the model apps installed but stopped with the
//! models they have downloaded.
//!
//! - Running services are found from the loopback ports this user listens on
//!   (`lsof`) plus the services' default ports. A port is named by its
//!   listening process (`ollama`, `mlx_lm.server`, oMLX…) and confirmed by
//!   what it answers, never by its number. Only `127.0.0.1` is contacted.
//! - Downloaded models are listed by folder name from the apps' own model
//!   folders; model files are never opened.
use super::Driver;
use crate::agent::model_connections::configuration::{is_loopback_host, read_json};
use crate::agent::model_connections::providers;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A running local model service.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Candidate {
    pub driver: Driver,
    pub name: String,
    /// `http://127.0.0.1:<port>/v1`.
    pub endpoint: String,
    /// The chat models it serves (embeddings, speech and rerankers left out),
    /// at most [`MODEL_LIMIT`].
    pub models: Vec<String>,
    /// It answers only with its API key (oMLX by default).
    pub needs_key: bool,
}

/// Default ports, probed even when `lsof` finds nothing: Ollama, LM Studio,
/// oMLX / vLLM / Unsloth, llama.cpp / MLX / LocalAI, Jan, alternates.
const PORTS: [u16; 7] = [11434, 1234, 8000, 8080, 1337, 8081, 5000];
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
/// The most ports probed in one discovery.
const PORT_LIMIT: usize = 64;
pub const MODEL_LIMIT: usize = 60;

/// The ports to probe, with the command of the process listening on each
/// when known: this user's loopback listeners, a loopback `OLLAMA_HOST`,
/// then the defaults.
pub fn ports(ollama_host: Option<&str>, listening: &[Listener]) -> Vec<(u16, Option<String>)> {
    let mut ports: Vec<(u16, Option<String>)> = vec![];
    let known = |port: u16| {
        listening
            .iter()
            .find(|l| l.port == port)
            .map(|l| l.command.clone())
    };
    let ordered = ollama_host
        .and_then(ollama_port)
        .into_iter()
        .chain(listening.iter().map(|l| l.port))
        .chain(PORTS);
    for port in ordered {
        if !ports.iter().any(|(p, _)| *p == port) {
            ports.push((port, known(port)));
        }
    }
    ports.truncate(PORT_LIMIT);
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

/// A TCP port a process of this user listens on, reachable on loopback.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listener {
    pub port: u16,
    /// The process's command line, which names the service.
    pub command: String,
}

/// `lsof -nP -iTCP -sTCP:LISTEN -Fpn` output as `(port, pid)`: loopback or
/// wildcard addresses only, one per port, never `own_pid`.
pub fn parse_lsof(output: &str, own_pid: u32) -> Vec<(u16, u32)> {
    let mut found: Vec<(u16, u32)> = vec![];
    let mut pid = 0u32;
    for line in output.lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.trim().parse().unwrap_or(0);
        } else if let Some(name) = line.strip_prefix('n') {
            let Some((host, port)) = name.rsplit_once(':') else {
                continue;
            };
            let host = host.trim_start_matches('[').trim_end_matches(']');
            let local = matches!(
                host,
                "127.0.0.1" | "::1" | "localhost" | "*" | "0.0.0.0" | "::"
            );
            let Ok(port) = port.parse::<u16>() else {
                continue;
            };
            if local && pid != 0 && pid != own_pid && !found.iter().any(|(p, _)| *p == port) {
                found.push((port, pid));
            }
        }
    }
    found
}

/// This user's loopback listeners with their command lines (`lsof`, `ps`).
/// Empty when `lsof` is unavailable; the default ports still serve.
pub fn listeners() -> Vec<Listener> {
    let user = std::env::var("USER").unwrap_or_default();
    let mut args = vec!["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"];
    if !user.is_empty() {
        args.extend(["-a", "-u", user.as_str()]);
    }
    let Ok(out) = std::process::Command::new("/usr/sbin/lsof")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return vec![];
    };
    parse_lsof(&String::from_utf8_lossy(&out.stdout), std::process::id())
        .into_iter()
        .map(|(port, pid)| Listener {
            port,
            command: std::process::Command::new("/bin/ps")
                .args(["-o", "command=", "-p", &pid.to_string()])
                .stderr(std::process::Stdio::null())
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
                .unwrap_or_default(),
        })
        .filter(|l| !front_end(&l.command))
        .collect()
}

/// A model app's own window process, which answers its server's API on a
/// private port (`Ollama.app/Contents/MacOS/Ollama`); its server is found
/// on its own port.
fn front_end(command: &str) -> bool {
    command
        .to_ascii_lowercase()
        .contains("ollama.app/contents/macos/ollama")
}

/// The service a listening process's command line names, if any.
pub fn hint(command: &str) -> Option<Driver> {
    let c = command.to_ascii_lowercase();
    let program = c.split_whitespace().next().unwrap_or_default();
    let has = |needle: &str| c.contains(needle);
    Some(
        if program.ends_with("/ollama") || program == "ollama" || has("ollama.app") {
            Driver::Ollama
        } else if has("lm studio") || has("lmstudio") || has("llmster") || program.ends_with("/lms")
        {
            Driver::LmStudio
        } else if has("omlx") {
            Driver::Omlx
        } else if has("mlx_lm") || has("mlx_vlm") || has("mlx-lm") || has("mlx-vlm") {
            Driver::Mlx
        } else if has("llama-server") || has("llama_cpp") || has("llama.cpp") {
            Driver::LlamaCpp
        } else if has("vllm") {
            Driver::Vllm
        } else if has("jan.app") || has("cortex") {
            Driver::Jan
        } else if has("local-ai") || has("localai") {
            Driver::LocalAi
        } else if has("unsloth") {
            Driver::Unsloth
        } else {
            return None;
        },
    )
}

/// What answered on a port.
#[derive(Default)]
pub struct Answers {
    /// `GET /api/version`.
    pub ollama_version: Option<serde_json::Value>,
    /// `GET /api/tags` (Ollama's downloaded models).
    pub ollama_tags: Option<serde_json::Value>,
    /// `GET /api/v1/models`.
    pub lm_studio_models: Option<serde_json::Value>,
    /// `GET /props`.
    pub llama_props: Option<serde_json::Value>,
    /// `GET /v1/models`.
    pub openai_models: Option<serde_json::Value>,
    /// `GET /version`.
    pub version: Option<serde_json::Value>,
    /// `/v1/models` refused without a key (401 / 403).
    pub unauthorized: bool,
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

/// A chat model, not embeddings, speech or a reranker.
pub fn chat_model(id: &str) -> bool {
    let id = id.to_ascii_lowercase();
    ![
        "embed", "whisper", "tts", "rerank", "bge-", "speech", "audio", "parakeet",
    ]
    .iter()
    .any(|n| id.contains(n))
}

fn limited(mut models: Vec<String>) -> Vec<String> {
    models.retain(|id| !id.trim().is_empty() && id.len() <= 300 && chat_model(id));
    models.dedup();
    models.truncate(MODEL_LIMIT);
    models
}

/// The chat models a service's answers list (Ollama's cloud models left out).
pub fn models(answers: &Answers) -> Vec<String> {
    let strings = |items: Option<&Vec<serde_json::Value>>,
                   keep: &dyn Fn(&serde_json::Value) -> bool,
                   key: &str| {
        items
            .into_iter()
            .flatten()
            .filter(|m| keep(m))
            .filter_map(|m| m[key].as_str().map(str::to_owned))
            .collect::<Vec<_>>()
    };
    let ids = if let Some(tags) = &answers.ollama_tags {
        strings(
            tags["models"].as_array(),
            &|m| m["remote_host"].is_null() && m["remote_model"].is_null(),
            "name",
        )
    } else if let Some(models) = &answers.lm_studio_models {
        strings(models["models"].as_array(), &|m| m["type"] == "llm", "key")
    } else if let Some(models) = &answers.openai_models {
        strings(models["data"].as_array(), &|_| true, "id")
    } else {
        vec![]
    };
    limited(ids)
}

/// The candidate a port describes: a known listening process names the
/// service (`hint`) and the answers confirm it serves models — or, for a
/// known process, that it refuses without its key.
pub fn candidate(port: u16, hint: Option<Driver>, answers: &Answers) -> Option<Candidate> {
    let identified = identify(answers);
    let driver = match (hint, identified) {
        (Some(hint), Some(_)) => hint,
        (Some(hint), None) if answers.unauthorized => hint,
        (None, Some(found)) => found,
        _ => return None,
    };
    let name = match providers::local_for(driver) {
        Some(p) if driver != Driver::OpenaiCompatible => p.name.to_owned(),
        _ => format!("OpenAI-compatible · {port}"),
    };
    Some(Candidate {
        driver,
        name,
        endpoint: format!("http://127.0.0.1:{port}/v1"),
        models: models(answers),
        needs_key: identified.is_none() && answers.unauthorized,
    })
}

async fn probe(client: &reqwest::Client, port: u16, hint: Option<Driver>) -> Option<Candidate> {
    let base = format!("http://127.0.0.1:{port}");
    // `None`: nothing answered; `Err(status)`: refused.
    let get = |path: &'static str| {
        let url = format!("{base}{path}");
        async move {
            let response = client.get(url).send().await.ok()?;
            let status = response.status().as_u16();
            if !(200..300).contains(&status) {
                return Some(Err(status));
            }
            Some(
                response
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|_| status),
            )
        }
    };
    let ok = |answer: Option<Result<serde_json::Value, u16>>| answer.and_then(Result::ok);
    // A closed port answers nothing: stop before the other probes.
    let ollama_version = ok(Some(get("/api/version").await?));
    if ollama_version
        .as_ref()
        .is_some_and(|v| v["version"].is_string())
    {
        let ollama_tags = ok(get("/api/tags").await);
        return candidate(
            port,
            Some(Driver::Ollama),
            &Answers {
                ollama_version,
                ollama_tags,
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
    let unauthorized = matches!(openai_models, Some(Err(401 | 403)));
    candidate(
        port,
        hint,
        &Answers {
            ollama_version,
            ollama_tags: None,
            lm_studio_models: ok(lm_studio_models),
            llama_props: ok(llama_props),
            openai_models: ok(openai_models),
            version: ok(version),
            unauthorized,
        },
    )
}

/// Probe every port concurrently; one candidate per answering port.
pub async fn discover_ports(ports: &[(u16, Option<String>)]) -> Vec<Candidate> {
    let Ok(client) = crate::platform::proxy::system(reqwest::Client::builder())
        .redirect_policy(reqwest::redirect::Policy::none())
        .timeout(PROBE_TIMEOUT)
        .build()
    else {
        return vec![];
    };
    futures_util::future::join_all(
        ports
            .iter()
            .map(|(port, command)| probe(&client, *port, command.as_deref().and_then(hint))),
    )
    .await
    .into_iter()
    .flatten()
    .collect()
}

/// The ports `driver` may serve on: its listeners' and its default port.
pub fn service_ports(driver: Driver, listening: &[Listener]) -> Vec<(u16, Option<String>)> {
    let mut ports: Vec<(u16, Option<String>)> = listening
        .iter()
        .filter(|l| hint(&l.command) == Some(driver))
        .map(|l| (l.port, Some(l.command.clone())))
        .collect();
    let default = providers::local_for(driver)
        .and_then(|p| url::Url::parse(p.base_url).ok())
        .and_then(|u| u.port());
    if let Some(port) = default.filter(|d| !ports.iter().any(|(p, _)| p == d)) {
        ports.push((port, None));
    }
    ports
}

/// Whether `driver` is serving now (its own ports only: a cheap check).
pub async fn serving(driver: Driver) -> bool {
    let listening = tokio::task::spawn_blocking(listeners)
        .await
        .unwrap_or_default();
    discover_ports(&service_ports(driver, &listening))
        .await
        .iter()
        .any(|c| c.driver == driver)
}

/// Everything running here: listeners, `OLLAMA_HOST` and the defaults.
pub async fn running() -> Vec<Candidate> {
    let listening = tokio::task::spawn_blocking(listeners)
        .await
        .unwrap_or_default();
    let ports = ports(std::env::var("OLLAMA_HOST").ok().as_deref(), &listening);
    discover_ports(&ports).await
}

/// A local model app installed on this Mac.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Installed {
    pub driver: Driver,
    pub name: &'static str,
    /// The models it has downloaded, by name.
    pub models: Vec<String>,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}
fn app(name: &str) -> bool {
    Path::new("/Applications").join(name).exists()
        || home().join("Applications").join(name).exists()
}
fn on_path(command: &str) -> Option<PathBuf> {
    ["/opt/homebrew/bin", "/usr/local/bin"]
        .iter()
        .map(PathBuf::from)
        .chain(std::iter::once(home().join(".lmstudio/bin")))
        .map(|dir| dir.join(command))
        .find(|path| path.is_file())
}

/// Entry names in `dir` (sorted, hidden ones skipped), folders only or not.
fn entries(dir: &Path, folders_only: bool) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| !folders_only || e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.starts_with('.'))
        .collect();
    names.sort();
    names
}

/// Ollama's downloaded models
/// (`models/manifests/registry.ollama.ai/<namespace>/<name>/<tag>`).
pub fn ollama_downloads(root: &Path) -> Vec<String> {
    let registry = root.join("models/manifests/registry.ollama.ai");
    let mut found = vec![];
    for namespace in entries(&registry, true) {
        for name in entries(&registry.join(&namespace), true) {
            for tag in entries(&registry.join(&namespace).join(&name), false) {
                found.push(if namespace == "library" {
                    format!("{name}:{tag}")
                } else {
                    format!("{namespace}/{name}:{tag}")
                });
            }
        }
    }
    found
}

/// `<publisher>/<model>` folders (LM Studio, oMLX); a model folder directly
/// in `dir` (one holding `config.json`) counts by its own name.
pub fn two_level_downloads(dir: &Path) -> Vec<String> {
    let mut found = vec![];
    for first in entries(dir, true) {
        if dir.join(&first).join("config.json").is_file() {
            found.push(first);
            continue;
        }
        found.extend(
            entries(&dir.join(&first), true)
                .into_iter()
                .map(|m| format!("{first}/{m}")),
        );
    }
    found
}

/// oMLX's settings (`~/.omlx/settings.json`).
fn omlx_settings(root: &Path) -> Option<serde_json::Value> {
    read_json(&root.join(".omlx/settings.json"), 256 * 1024).ok()
}

/// The API key oMLX requires, from its own settings; `None` when it
/// requires none. Read when the user connects it, never during discovery.
pub fn omlx_key(root: &Path) -> Option<String> {
    let auth = omlx_settings(root)?["auth"].take();
    if auth["skip_api_key_verification"] == true {
        return None;
    }
    auth["api_key"]
        .as_str()
        .filter(|k| !k.is_empty())
        .map(str::to_owned)
}

/// The key a local service requires, read from its own configuration on
/// this Mac when the user connects it.
pub fn local_key(driver: Driver) -> Option<String> {
    match driver {
        Driver::Omlx => omlx_key(&home()),
        _ => None,
    }
}

/// oMLX's model folders (its settings, else `~/.omlx/models`).
fn omlx_model_dirs(root: &Path) -> Vec<PathBuf> {
    let dirs: Vec<PathBuf> = omlx_settings(root)
        .and_then(|s| s["model"]["model_dirs"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|d| d.as_str())
        .map(|d| match d.strip_prefix("~/") {
            Some(rest) => root.join(rest),
            None => PathBuf::from(d),
        })
        .collect();
    if dirs.is_empty() {
        vec![root.join(".omlx/models")]
    } else {
        dirs
    }
}

/// The local model apps installed under `root` (a home folder), with the
/// models they downloaded.
pub fn installed_in(
    root: &Path,
    app: impl Fn(&str) -> bool,
    on_path: impl Fn(&str) -> bool,
) -> Vec<Installed> {
    let mut found = vec![];
    if app("Ollama.app") || on_path("ollama") {
        found.push(Installed {
            driver: Driver::Ollama,
            name: "Ollama",
            models: limited(ollama_downloads(&root.join(".ollama"))),
        });
    }
    if app("LM Studio.app") || on_path("lms") {
        let mut models = two_level_downloads(&root.join(".lmstudio/models"));
        models.extend(two_level_downloads(&root.join(".cache/lm-studio/models")));
        found.push(Installed {
            driver: Driver::LmStudio,
            name: "LM Studio",
            models: limited(models),
        });
    }
    if app("oMLX.app") {
        let models = omlx_model_dirs(root)
            .iter()
            .flat_map(|d| two_level_downloads(d))
            .collect();
        found.push(Installed {
            driver: Driver::Omlx,
            name: "oMLX",
            models: limited(models),
        });
    }
    if app("Jan.app") {
        found.push(Installed {
            driver: Driver::Jan,
            name: "Jan",
            models: vec![],
        });
    }
    found
}

/// The local model apps installed on this Mac.
pub fn installed() -> Vec<Installed> {
    installed_in(&home(), app, |c| on_path(c).is_some())
}

/// Start an installed service at the user's request: the app when present,
/// else its server command. Nothing is installed or downloaded.
pub fn start(driver: Driver) -> Result<(), String> {
    let spawn = |program: &Path, args: &[&str]| {
        std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|_| "START_FAILED".to_owned())
    };
    let open = Path::new("/usr/bin/open");
    match driver {
        Driver::Ollama if app("Ollama.app") => spawn(open, &["-g", "-a", "Ollama"]),
        Driver::Ollama => spawn(&on_path("ollama").ok_or("NOT_INSTALLED")?, &["serve"]),
        Driver::LmStudio => match on_path("lms") {
            Some(lms) => spawn(&lms, &["server", "start"]),
            None if app("LM Studio.app") => spawn(open, &["-g", "-a", "LM Studio"]),
            None => Err("NOT_INSTALLED".into()),
        },
        Driver::Omlx if app("oMLX.app") => spawn(open, &["-g", "-a", "oMLX"]),
        Driver::Jan if app("Jan.app") => spawn(open, &["-g", "-a", "Jan"]),
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
        assert!(candidate(11434, None, &other).is_none());
        let generic = candidate(
            11434,
            None,
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
    fn listening_processes_name_the_service_on_any_port() {
        let cases = [
            ("/opt/homebrew/bin/ollama serve", Some(Driver::Ollama)),
            (
                "/opt/homebrew/opt/python@3.11/bin/python3.11 -m mlx_vlm.server --model Qwen/Qwen3.5-9B --port 8024",
                Some(Driver::Mlx),
            ),
            (
                "/Applications/oMLX.app/Contents/MacOS/omlx-server --port 8000",
                Some(Driver::Omlx),
            ),
            (
                "/usr/local/bin/llama-server -m model.gguf",
                Some(Driver::LlamaCpp),
            ),
            (
                "python -m vllm.entrypoints.openai.api_server",
                Some(Driver::Vllm),
            ),
            (
                "/Applications/LM Studio.app/Contents/MacOS/LM Studio",
                Some(Driver::LmStudio),
            ),
            ("node /usr/local/bin/vite", None),
        ];
        for (command, expected) in cases {
            assert_eq!(hint(command), expected, "{command}");
        }
        // A known process serving a model list is that service on any port;
        // speech models are not offered for chat.
        let mlx = candidate(
            8024,
            Some(Driver::Mlx),
            &Answers {
                openai_models: Some(json!({"data": [
                    {"id": "Qwen/Qwen3.5-9B"},
                    {"id": "mlx-community/whisper-large-v3-turbo"},
                    {"id": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"}
                ]})),
                ..answers()
            },
        )
        .unwrap();
        assert_eq!(
            (mlx.driver, mlx.endpoint.as_str(), mlx.name.as_str()),
            (Driver::Mlx, "http://127.0.0.1:8024/v1", "MLX")
        );
        assert_eq!(mlx.models, ["Qwen/Qwen3.5-9B"]);
        // A known process that refuses without its key still appears.
        let omlx = candidate(
            8000,
            Some(Driver::Omlx),
            &Answers {
                unauthorized: true,
                ..answers()
            },
        )
        .unwrap();
        assert!(omlx.needs_key);
        assert_eq!(omlx.name, "oMLX");
        // An unknown process that refuses is not taken for a model service.
        let refused = Answers {
            unauthorized: true,
            ..answers()
        };
        assert!(candidate(9000, None, &refused).is_none());
    }

    #[test]
    fn lsof_output_lists_loopback_listeners_once_without_this_app() {
        let output = "p4211\nn127.0.0.1:18765\np62146\nn127.0.0.1:8024\nn[::1]:8024\np777\nn*:5173\np900\nn192.168.1.13:22\np1\nn127.0.0.1:9999\n";
        assert_eq!(
            parse_lsof(output, 1),
            [(18765, 4211), (8024, 62146), (5173, 777)]
        );
        let listening = vec![Listener {
            port: 8024,
            command: "python -m mlx_vlm.server".into(),
        }];
        let probed = ports(None, &listening);
        assert_eq!(probed[0], (8024, Some("python -m mlx_vlm.server".into())));
        assert!(probed.iter().any(|(p, c)| *p == 11434 && c.is_none()));
        assert_eq!(probed.len(), PORTS.len() + 1);
        assert!(front_end(
            "/Applications/Ollama.app/Contents/MacOS/Ollama hidden"
        ));
        assert!(!front_end(
            "/Applications/Ollama.app/Contents/Resources/ollama serve"
        ));
    }

    #[test]
    fn ollama_host_adds_its_loopback_port_only() {
        let first = |host| ports(Some(host), &[])[0].0;
        assert_eq!(first("127.0.0.1:11500"), 11500);
        assert_eq!(first("http://localhost:11600"), 11600);
        assert_eq!(first(":11700"), 11700);
        assert_eq!(first("0.0.0.0:11800"), 11800);
        assert_eq!(ports(Some("192.168.1.9:11434"), &[]).len(), PORTS.len());
        assert_eq!(ports(None, &[]).len(), PORTS.len());
    }

    #[test]
    fn downloaded_models_are_listed_by_folder_name() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path();
        let manifests = home.join(".ollama/models/manifests/registry.ollama.ai");
        std::fs::create_dir_all(manifests.join("library/qwen3.5")).unwrap();
        std::fs::write(manifests.join("library/qwen3.5/9b"), "{}").unwrap();
        std::fs::create_dir_all(manifests.join("library/nomic-embed-text")).unwrap();
        std::fs::write(manifests.join("library/nomic-embed-text/latest"), "{}").unwrap();
        std::fs::create_dir_all(manifests.join("team/coder")).unwrap();
        std::fs::write(manifests.join("team/coder/latest"), "{}").unwrap();
        let lm = home.join(".lmstudio/models");
        std::fs::create_dir_all(lm.join("qwen/qwen3-8b")).unwrap();
        std::fs::create_dir_all(lm.join("mlx-community/Qwen3-4B-4bit")).unwrap();
        // oMLX keeps models where its settings say; its key is read from
        // there too, unless it requires none.
        let omlx = home.join("mlx-models");
        std::fs::create_dir_all(omlx.join("Qwen3.5-9B-4bit")).unwrap();
        std::fs::write(omlx.join("Qwen3.5-9B-4bit/config.json"), "{}").unwrap();
        std::fs::create_dir_all(home.join(".omlx")).unwrap();
        let settings = |skip: bool| {
            json!({
                "model": {"model_dirs": ["~/mlx-models"]},
                "auth": {"api_key": "local-key", "skip_api_key_verification": skip}
            })
            .to_string()
        };
        std::fs::write(home.join(".omlx/settings.json"), settings(false)).unwrap();
        let found = installed_in(home, |a| a != "Jan.app", |_| false);
        assert_eq!(
            found
                .iter()
                .map(|i| (i.name, i.models.clone()))
                .collect::<Vec<_>>(),
            [
                (
                    "Ollama",
                    vec!["qwen3.5:9b".to_owned(), "team/coder:latest".to_owned()]
                ),
                (
                    "LM Studio",
                    vec![
                        "mlx-community/Qwen3-4B-4bit".to_owned(),
                        "qwen/qwen3-8b".to_owned()
                    ]
                ),
                ("oMLX", vec!["Qwen3.5-9B-4bit".to_owned()]),
            ]
        );
        assert_eq!(omlx_key(home).as_deref(), Some("local-key"));
        std::fs::write(home.join(".omlx/settings.json"), settings(true)).unwrap();
        assert_eq!(omlx_key(home), None);
    }

    /// Real HTTP on a loopback port: `(path, status line, body)`.
    fn serve(routes: Vec<(&'static str, &'static str, &'static str)>) -> u16 {
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
                    .find(|(p, _, _)| *p == path)
                    .map(|(_, s, b)| (*s, *b))
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
    fn discovery_finds_services_and_their_models_over_http() {
        let ollama = serve(vec![
            ("/api/version", "200 OK", r#"{"version":"0.12.0"}"#),
            (
                "/api/tags",
                "200 OK",
                r#"{"models":[{"name":"qwen3.5:9b"},{"name":"glm:cloud","remote_host":"https://ollama.com"}]}"#,
            ),
        ]);
        let llama = serve(vec![
            (
                "/props",
                "200 OK",
                r#"{"default_generation_settings":{"n_ctx":4096}}"#,
            ),
            ("/v1/models", "200 OK", r#"{"data":[{"id":"m.gguf"}]}"#),
        ]);
        let keyed = serve(vec![(
            "/v1/models",
            "401 Unauthorized",
            r#"{"error":"key"}"#,
        )]);
        let closed = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let found = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(discover_ports(&[
                (ollama, None),
                (llama, None),
                (
                    keyed,
                    Some("/Applications/oMLX.app/Contents/MacOS/omlx".into()),
                ),
                (closed, None),
            ]));
        assert_eq!(
            found
                .iter()
                .map(|c| (c.driver, c.models.clone(), c.needs_key))
                .collect::<Vec<_>>(),
            [
                (Driver::Ollama, vec!["qwen3.5:9b".to_owned()], false),
                (Driver::LlamaCpp, vec!["m.gguf".to_owned()], false),
                (Driver::Omlx, vec![], true),
            ]
        );
    }
}
