//! `tests/integration/agent/sessions/electron.agent-production-composition.test.mjs`.
use super::{
    DEFAULT_AGENT_RUNTIME_ID, DefaultRuntimeHostOptions, create_default_agent_runtime_host,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::tests_support::run_local;
use crate::agent::runtime::agent_runtime_registry::RuntimeDiscovery;
use crate::agent::tasks::CancelSignal;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::rc::Rc;

struct Fixed(Value);

impl RuntimeDiscovery for Fixed {
    fn discover(
        &self,
        _refresh: bool,
        _signal: CancelSignal,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let readiness = self.0.clone();
        Box::pin(async move { Ok(readiness) })
    }
}

struct Broken;

impl RuntimeDiscovery for Broken {
    fn discover(
        &self,
        _refresh: bool,
        _signal: CancelSignal,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async { Err(AgentError::new("cursor discovery failed")) })
    }
}

fn readiness(runtime_id: &str, status: &str) -> Rc<dyn RuntimeDiscovery> {
    let code = match status {
        "ready" => "READY",
        "not-installed" => "RUNTIME_NOT_INSTALLED",
        "protocol-unavailable" => "PROTOCOL_UNAVAILABLE",
        _ => "RUNTIME_DISCOVERY_FAILED",
    };
    let ready = status == "ready";
    Rc::new(Fixed(json!({
        "runtimeId": runtime_id,
        "provider": runtime_id,
        "status": status,
        "code": code,
        "version": if ready { Value::from("1.0.0") } else { Value::Null },
        "minimumVersion": null,
        "executablePath": if ready { Value::from(format!("/{runtime_id}")) } else { Value::Null },
        "environment": {},
        "message": status,
    })))
}

fn production_host(
    statuses: &[(&str, &str)],
    cursor: Option<Rc<dyn RuntimeDiscovery>>,
) -> DefaultRuntimeHostOptions {
    let of = |id: &str| {
        statuses
            .iter()
            .find(|(runtime, _)| *runtime == id)
            .map(|(runtime, status)| readiness(runtime, status))
    };
    DefaultRuntimeHostOptions {
        codex: of("codex"),
        claude: of("claude"),
        open_code_native: of("opencode-native"),
        pi: of("pi"),
        cursor: cursor.or_else(|| of("cursor")),
        work_buddy_china: of("workbuddy-china"),
        work_buddy_international: of("workbuddy-international"),
        hermes: of("hermes"),
        puppyone_agent: of("puppyone-agent"),
        ..Default::default()
    }
}

#[test]
fn registers_independent_native_backends_and_never_silently_replaces_an_explicit_selection() {
    run_local(async {
        let host = create_default_agent_runtime_host(production_host(
            &[
                ("codex", "ready"),
                ("claude", "ready"),
                ("opencode-native", "not-installed"),
                ("pi", "ready"),
                ("cursor", "protocol-unavailable"),
                ("workbuddy-china", "ready"),
                ("workbuddy-international", "ready"),
                ("hermes", "ready"),
                ("puppyone-agent", "ready"),
            ],
            None,
        ))
        .unwrap();
        let catalog = host.discover(false, None).await;
        let ids: Vec<String> = host
            .descriptors()
            .iter()
            .map(|d| d["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            ids,
            [
                "puppyone-agent",
                "codex",
                "claude",
                "opencode-native",
                "cursor",
                "hermes",
                "pi",
                "workbuddy-china",
                "workbuddy-international",
            ]
        );
        assert_eq!(DEFAULT_AGENT_RUNTIME_ID, "codex");
        assert!(
            catalog
                .iter()
                .any(|entry| entry.descriptor["id"] == DEFAULT_AGENT_RUNTIME_ID)
        );
        assert_eq!(
            host.require("claude").unwrap().descriptor["displayName"],
            "Claude Agent"
        );
        let manifests: Vec<Value> = host
            .manifests()
            .iter()
            .map(|m| {
                json!([
                    m["id"],
                    m["integration"]["kind"],
                    m["protocol"]["kind"],
                    m["trust"]["level"]
                ])
            })
            .collect();
        assert_eq!(
            manifests,
            [
                json!([
                    "puppyone-agent",
                    "managed-harness",
                    "rpc",
                    "bundled-verified"
                ]),
                json!(["codex", "specialized-native", "app-server", "first-party"]),
                json!(["claude", "specialized-native", "agent-sdk", "first-party"]),
                json!(["opencode-native", "native-protocol", "acp", "first-party"]),
                json!(["cursor", "native-protocol", "acp", "first-party"]),
                json!(["hermes", "native-protocol", "acp", "first-party"]),
                json!(["pi", "specialized-native", "rpc", "first-party"]),
                json!(["workbuddy-china", "native-protocol", "acp", "first-party"]),
                json!([
                    "workbuddy-international",
                    "native-protocol",
                    "acp",
                    "first-party"
                ]),
            ]
        );
        let built_in = host.require("puppyone-agent").unwrap();
        assert_eq!(built_in.descriptor["displayName"], "Built-in Agent");
        assert_eq!(built_in.descriptor["iconKey"], "built-in-agent");
        host.dispose().await.unwrap();
    });
}

#[test]
fn isolates_discovery_failure_to_the_backend_that_failed() {
    run_local(async {
        let host = create_default_agent_runtime_host(production_host(
            &[
                ("codex", "ready"),
                ("claude", "not-installed"),
                ("opencode-native", "not-installed"),
                ("pi", "not-installed"),
                ("workbuddy-china", "not-installed"),
                ("workbuddy-international", "not-installed"),
                ("hermes", "not-installed"),
                ("puppyone-agent", "ready"),
            ],
            Some(Rc::new(Broken)),
        ))
        .unwrap();
        let catalog = host.discover(false, None).await;
        let readiness = |id: &str| {
            catalog
                .iter()
                .find(|entry| entry.descriptor["id"] == id)
                .unwrap()
                .readiness
                .clone()
        };
        assert_eq!(readiness("cursor")["status"], "error");
        assert_eq!(readiness("codex")["status"], "ready");
        host.dispose().await.unwrap();
    });
}
