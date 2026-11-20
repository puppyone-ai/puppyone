//! `electron.agent-runtime-contract.test.mjs`: a second runtime (the
//! TypeScript fixture, copied as is) runs through the Agent service with no
//! branch on its name.
use super::harness::{FakePersistence, RecordingLogger, create_sender, run};
use crate::agent::agent_error::AgentResult;
use crate::agent::application::agent_service::{AgentService, AgentServiceOptions};
use crate::agent::runtime::agent_runtime_port::{
    AdapterFuture, AdapterOptions, AgentRuntimeAdapter,
};
use crate::agent::runtime::agent_runtime_registry::{
    AgentRuntimeRegistry, RuntimeDefinition, RuntimeDiscovery,
};
use crate::agent::tasks::CancelSignal;
use core::prelude::v1::test;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::rc::Rc;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../fixtures/agent/runtimes/secondary-runtime.json"
    ))
    .unwrap()
}

struct Ready;
impl RuntimeDiscovery for Ready {
    fn discover(&self, _: bool, _: CancelSignal) -> LocalBoxFuture<'static, AgentResult<Value>> {
        Box::pin(async {
            Ok(
                json!({"runtimeId": "fixture-harness", "provider": "fixture-harness",
                "status": "ready", "code": "READY", "version": "1.0.0",
                "executablePath": "/fixture", "environment": {}, "message": "ready", "selectable": true}),
            )
        })
    }
}

struct Adapter(AdapterOptions);
impl AgentRuntimeAdapter for Adapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        let fixture = fixture();
        let mut inspection = fixture["inspection"].clone();
        inspection["capabilities"]["unknownCapability"] = json!(true);
        inspection["runtime"] = fixture["descriptor"].clone();
        inspection["warnings"] = json!([]);
        Box::pin(async move { Ok(inspection) })
    }
    fn create_session(&self, _: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async {
            Ok(
                json!({"providerSessionId": "native-fixture", "title": "Fixture",
                "model": "fixture/model", "mode": "build"}),
            )
        })
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async move {
            Ok(json!({"providerSessionId": request["threadId"], "title": "Fixture"}))
        })
    }
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        let emit = self.0.on_event.clone();
        Box::pin(async move {
            emit(
                json!({"type": "turn.started", "providerSessionId": "native-fixture",
                "turnId": "turn-fixture", "payload": {"prompt": request["prompt"]}}),
            );
            emit(
                json!({"type": "assistant.completed", "providerSessionId": "native-fixture",
                "turnId": "turn-fixture", "itemId": "message-fixture", "payload": {"text": "done"}}),
            );
            emit(
                json!({"type": "turn.completed", "providerSessionId": "native-fixture",
                "turnId": "turn-fixture", "payload": {"status": "completed"}}),
            );
            Ok(json!({"turnId": "turn-fixture"}))
        })
    }
    fn interrupt_turn(&self, _: Value) -> AdapterFuture<'_, Value> {
        Box::pin(async { Ok(Value::Null) })
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

#[test]
fn a_second_runtime_runs_through_the_service_without_name_branches() {
    run(async {
        let definition = RuntimeDefinition {
            manifest: serde_json::from_value(fixture()["manifest"].clone()).unwrap(),
            discovery: Rc::new(Ready),
            create_adapter: Rc::new(|options| {
                Ok(Rc::new(Adapter(options)) as Rc<dyn AgentRuntimeAdapter>)
            }),
            dispose: None,
        };
        let persistence = Rc::new(FakePersistence::default());
        let service = AgentService::new(AgentServiceOptions {
            runtime_registry: AgentRuntimeRegistry::new(vec![definition], None, None).unwrap(),
            session_cache: Rc::new(persistence.clone()),
            conversation_catalog: Some(Rc::new(persistence)),
            logger: Some(Rc::new(RecordingLogger::default())),
            attachment_store: None,
            process_supervisor: None,
        });
        let (sender, _) = create_sender(7);
        let inspection = service
            .discover_providers(&json!({"runtimeId": "fixture-harness"}), Some("/workspace"))
            .await
            .unwrap();
        assert_eq!(inspection["selectedRuntimeId"], "fixture-harness");
        assert_eq!(inspection["capabilities"]["streamingText"], true);
        assert_eq!(inspection["capabilities"]["queue"], false);
        assert!(
            inspection["capabilities"]
                .get("unknownCapability")
                .is_none()
        );
        let snapshot = service
            .create_session(
                &sender,
                &json!({"runtimeId": "fixture-harness"}),
                "/workspace",
            )
            .await
            .unwrap();
        let id = snapshot["session"]["id"].clone();
        service
            .start_turn(&sender, &json!({"sessionId": id, "prompt": "hello"}), None)
            .await
            .unwrap();
        let replay = service
            .replay(&sender, &json!({"sessionId": id, "afterSequence": 0}), None)
            .unwrap();
        let events = replay["events"].as_array().unwrap();
        assert!(events.iter().any(|e| e["type"] == "assistant.completed"));
        assert!(
            events
                .iter()
                .all(|e| e["runtimeId"] == "fixture-harness" && e["provider"] == "fixture-harness"),
            "{events:?}"
        );
        service.close_all().await.unwrap();
    });
}
