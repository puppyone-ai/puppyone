//! `runtimes/puppyone-agent/puppyone-agent-adapter.mjs`: the product-owned
//! harness route over the shared Pi RPC adapter. It never reads the user's
//! Pi profile or binary; with a model-connection port, every session holds
//! a lease on one connection.
use super::model_connection_binding::{
    ModelConnectionBinding, ModelConnectionPort, connection_models,
};
use super::puppyone_agent_approval::parse_puppyone_agent_approval_request;
use super::puppyone_agent_history_source::puppyone_agent_history_source;
use super::puppyone_agent_identity::PUPPYONE_AGENT_RUNTIME_DESCRIPTOR;
use super::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js::{self, Obj};
use crate::agent::model_connections::schema::{connection_error, parse_model_route};
use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::{
    PI_CAPABILITIES, PiAdapterOptions, PiRpcRuntimeAdapter,
};
use crate::agent::runtime::agent_runtime_port::{AdapterFuture, AgentRuntimeAdapter};
use crate::agent::runtime::agent_session_history_port::SessionHistoryPort;
use crate::agent::security::authorized_project_instructions::{
    format_authorized_project_instructions, load_authorized_project_instructions,
};
use crate::agent::tasks::CancelSignal;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::LazyLock;

/// `PUPPYONE_AGENT_CAPABILITIES`.
pub static PUPPYONE_AGENT_CAPABILITIES: LazyLock<Value> = LazyLock::new(|| {
    Obj::from(&PI_CAPABILITIES)
        .set("manualApprovals", true)
        .set("skills", false)
        .set("revision", "puppyone-pi-rpc:1")
        .set(
            "protocol",
            json!({ "name": "puppyone-pi-rpc", "version": 1 }),
        )
        .build()
});

struct Inner {
    pi: PiRpcRuntimeAdapter,
    readiness: Value,
    runtime_descriptor: Value,
    port: Option<Rc<dyn ModelConnectionPort>>,
    binding: Option<Rc<ModelConnectionBinding>>,
    selected_connection_model: RefCell<Option<String>>,
    read_only: Cell<bool>,
}

/// `PuppyOneAgentAdapter`.
#[derive(Clone)]
pub struct PuppyOneAgentAdapter(Rc<Inner>);

/// `withoutUnverifiedCost(event)`: the SDK's zero placeholder prices are
/// not billing facts.
fn without_unverified_cost(event: Value) -> Value {
    if event["type"] != "usage.updated" {
        return event;
    }
    let payload = js::with(&event["payload"], "cost", Value::Null);
    js::with(&event, "payload", payload)
}

fn read_only_error() -> AgentError {
    connection_error("CONNECTION_UNAVAILABLE_READ_ONLY")
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

impl PuppyOneAgentAdapter {
    /// `new PuppyOneAgentAdapter(options)`.
    pub fn new(
        mut options: PiAdapterOptions,
        model_connection_port: Option<Rc<dyn ModelConnectionPort>>,
    ) -> AgentResult<Self> {
        let Some(profile_path) = options
            .readiness
            .get("profilePath")
            .and_then(Value::as_str)
            .filter(|p| !p.is_empty())
            .map(str::to_string)
        else {
            return Err(AgentError::new(format!(
                "{BUILT_IN_AGENT_DISPLAY_NAME} managed profile is unavailable."
            ))
            .with_name("TypeError"));
        };
        let binding = model_connection_port
            .clone()
            .map(ModelConnectionBinding::new);
        if let Some(binding) = binding.clone() {
            let on_event = options.on_event.clone();
            options.on_event = Rc::new(move |event| on_event(without_unverified_cost(event)));
            options.client_factory = Some(Rc::new(move |client| binding.create_client(client)));
        }
        if !options.runtime_descriptor.is_object() {
            options.runtime_descriptor = PUPPYONE_AGENT_RUNTIME_DESCRIPTOR.clone();
        }
        if options.source_scope_id.is_empty() {
            options.source_scope_id = puppyone_agent_history_source(&profile_path).source_scope_id;
        }
        options.runtime_label = Some(BUILT_IN_AGENT_DISPLAY_NAME.into());
        options.runtime_namespace = Some("puppyone-agent".into());
        options.provider_source = Some("puppyone-agent".into());
        options.account_type = Some("puppyone-agent".into());
        options.capabilities = Some(PUPPYONE_AGENT_CAPABILITIES.clone());
        options.runtime_setup_message = Some(format!(
            "{BUILT_IN_AGENT_DISPLAY_NAME} has no configured model provider. Add a provider credential to PuppyOne, then refresh."
        ));
        if options.project_instruction_loader.is_none() {
            options.project_instruction_loader = Some(Rc::new(|root: &str| {
                load_authorized_project_instructions(root, None)
            }));
        }
        if options.project_instruction_formatter.is_none() {
            options.project_instruction_formatter = Some(Rc::new(|value: &Value| {
                format_authorized_project_instructions(Some(value))
            }));
        }
        if options.approval_request_parser.is_none() {
            options.approval_request_parser = Some(Rc::new(parse_puppyone_agent_approval_request));
        }
        let readiness = options.readiness.clone();
        let runtime_descriptor = options.runtime_descriptor.clone();
        Ok(Self(Rc::new(Inner {
            pi: PiRpcRuntimeAdapter::new(options)?,
            readiness,
            runtime_descriptor,
            port: model_connection_port,
            binding,
            selected_connection_model: RefCell::default(),
            read_only: Cell::new(false),
        })))
    }

    /// The shared Pi RPC adapter (`super`).
    pub fn pi(&self) -> &PiRpcRuntimeAdapter {
        &self.0.pi
    }

    /// `adapter.inspect()`.
    pub async fn inspect_now(&self) -> AgentResult<Value> {
        let inner = &self.0;
        let Some(port) = inner.port.as_ref() else {
            return inner.pi.inspect_now().await;
        };
        let snapshot = port.read().await?;
        let models = connection_models(&snapshot)?;
        let providers: Vec<Value> = snapshot["connections"]
            .as_array()
            .map(|connections| {
                connections
                    .iter()
                    .map(|connection| {
                        json!({
                            "id": connection["id"],
                            "displayName": connection["name"],
                            "source": "model-connection",
                            "modelCount": models.iter().filter(|m| m["connectionId"] == connection["id"]).count(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let ready = !models.is_empty();
        let mut account = Obj::new()
            .set(
                "account",
                if ready {
                    json!({ "type": "puppyone-agent", "email": null, "planType": null })
                } else {
                    Value::Null
                },
            )
            .set("requiresOpenaiAuth", false)
            .set("requiresRuntimeSetup", !ready);
        if !ready {
            account = account.set("setupReason", "runtime-setup-required").set(
                "error",
                "Add or verify a model connection in Settings → Model Connections.",
            );
        }
        let base = &*PUPPYONE_AGENT_CAPABILITIES;
        let image = js::with(
            &base["referenceInputs"]["attachments"]["image"],
            "accepted",
            models
                .iter()
                .any(|model| model["modelCapabilities"]["images"] == "supported"),
        );
        let attachments = js::with(&base["referenceInputs"]["attachments"], "image", image);
        let reference_inputs = js::with(&base["referenceInputs"], "attachments", attachments);
        let capabilities = Obj::from(base)
            .set(
                "revision",
                format!(
                    "puppyone-model-connections:{}",
                    js::to_js_string(snapshot.get("revision"))
                ),
            )
            .set("modelConnections", true)
            .set("referenceInputs", reference_inputs)
            .build();
        let readiness = &inner.readiness;
        Ok(json!({
            "account": account.build(),
            "models": models,
            "providers": providers,
            "modes": [],
            "commands": [],
            "warnings": [],
            "capabilities": capabilities,
            "runtime": Obj::from(&inner.runtime_descriptor)
                .set("version", readiness.get("version").cloned().unwrap_or(Value::Null))
                .set("source", readiness.get("source").cloned().unwrap_or(Value::Null))
                .set("compatibility", readiness.get("compatibility").cloned().unwrap_or(Value::Null))
                .build(),
        }))
    }

    /// `adapter.bootstrapSession({ kind, threadId, ...selection })`.
    async fn bootstrap_session_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        let inspection = self.inspect_now().await?;
        let resume = request["kind"] == "resume";
        let model = text(&request, "model");
        let offered = inspection["models"].as_array().is_some_and(|models| {
            models
                .iter()
                .any(|m| m["model"].as_str() == model.as_deref())
        });
        let mut binding_changed = false;
        if let Some(binding) = inner.binding.as_ref()
            && resume
            && offered
        {
            // Main compares the durable history fence, never a
            // renderer-supplied value.
            if let Err(error) = binding.acquire(model.as_deref()).await {
                if !error.is("MODEL_BINDING_CHANGED") {
                    return Err(error);
                }
                binding_changed = true;
            }
        }
        if let Some(binding) = inner.binding.as_ref()
            && resume
            && (binding_changed || !offered)
        {
            // Read through the SDK's native session API without authorizing
            // any endpoint.
            inner.read_only.set(true);
            binding.enable_read_only()?;
            let provider_session = inner
                .pi
                .resume_session(
                    json!({ "threadId": request["threadId"], "model": null, "effort": null }),
                )
                .await?;
            *inner.selected_connection_model.borrow_mut() = model.clone();
            let capabilities = Obj::from(&inspection["capabilities"])
                .set("readOnly", true)
                .set("compaction", false)
                .build();
            return Ok(json!({
                "inspection": js::with(&inspection, "capabilities", capabilities),
                "providerSession": Obj::from(&provider_session)
                    .set("model", model)
                    .set("effort", Value::Null)
                    .build(),
            }));
        }
        let mut selection = request.clone();
        js::delete(&mut selection, "kind");
        let provider_session = if resume {
            self.resume_session_inner(selection).await?
        } else {
            js::delete(&mut selection, "threadId");
            self.create_session_inner(selection).await?
        };
        Ok(json!({ "inspection": inspection, "providerSession": provider_session }))
    }

    fn model_binding_revision(&self) -> String {
        let configuration = self
            .0
            .binding
            .as_ref()
            .and_then(|binding| binding.configuration())
            .unwrap_or(Value::Null);
        format!(
            "{}:{}",
            js::to_js_string(configuration.get("connectionId")),
            js::to_js_string(configuration.get("securityGeneration"))
        )
    }

    async fn bound_session(&self, request: Value, resume: bool) -> AgentResult<Value> {
        let inner = &self.0;
        let model = text(&request, "model");
        if let Some(binding) = inner.binding.as_ref() {
            binding.acquire(model.as_deref()).await?;
        }
        let result = if resume {
            inner.pi.resume_session(request).await
        } else {
            inner.pi.create_session(request).await
        };
        match result {
            Ok(result) => {
                *inner.selected_connection_model.borrow_mut() = model;
                Ok(if inner.binding.is_some() {
                    Obj::from(&result)
                        .set("effort", Value::Null)
                        .set("modelBindingRevision", self.model_binding_revision())
                        .build()
                } else {
                    result
                })
            }
            Err(error) => {
                if let Some(binding) = inner.binding.as_ref() {
                    let _ = binding.dispose().await;
                }
                Err(error)
            }
        }
    }

    async fn create_session_inner(&self, request: Value) -> AgentResult<Value> {
        self.bound_session(request, false).await
    }

    async fn resume_session_inner(&self, request: Value) -> AgentResult<Value> {
        self.bound_session(request, true).await
    }

    /// `adapter.assertModelReferences(route, references)`.
    fn assert_model_references(
        &self,
        route: Option<&str>,
        references: &[Value],
    ) -> AgentResult<()> {
        let model_id = parse_model_route(route)?.model_id;
        let configuration = self
            .0
            .binding
            .as_ref()
            .and_then(|binding| binding.configuration())
            .unwrap_or(Value::Null);
        let images = configuration["models"]
            .as_array()
            .and_then(|models| models.iter().find(|m| m["id"] == model_id.as_str()))
            .is_some_and(|model| model["capabilities"]["images"] == "supported");
        if !images
            && references.iter().any(|reference| {
                reference["mime"]
                    .as_str()
                    .is_some_and(|mime| mime.starts_with("image/"))
            })
        {
            return Err(connection_error("MODEL_IMAGE_UNSUPPORTED"));
        }
        Ok(())
    }

    async fn start_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        if inner.read_only.get() {
            return Err(read_only_error());
        }
        let route =
            text(&request, "model").or_else(|| inner.selected_connection_model.borrow().clone());
        if let Some(binding) = inner.binding.as_ref() {
            binding.validate(route.as_deref()).await?;
            let references = match request.get("references").and_then(Value::as_array) {
                Some(references) => references.clone(),
                None => [request.get("attachments"), request.get("contextReferences")]
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_array)
                    .flatten()
                    .cloned()
                    .collect(),
            };
            self.assert_model_references(route.as_deref(), &references)?;
        }
        let result = inner.pi.start_turn(request).await?;
        *inner.selected_connection_model.borrow_mut() = route;
        Ok(result)
    }

    async fn steer_turn_inner(&self, request: Value) -> AgentResult<Value> {
        let inner = &self.0;
        if inner.read_only.get() {
            return Err(read_only_error());
        }
        if let Some(binding) = inner.binding.as_ref() {
            let selected = inner.selected_connection_model.borrow().clone();
            binding.validate(selected.as_deref()).await?;
            let references = request["references"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            self.assert_model_references(selected.as_deref(), &references)?;
        }
        inner.pi.steer_turn(request).await
    }

    async fn compact_session_inner(&self) -> AgentResult<Value> {
        let inner = &self.0;
        if inner.read_only.get() {
            return Err(read_only_error());
        }
        if let Some(binding) = inner.binding.as_ref() {
            let selected = inner.selected_connection_model.borrow().clone();
            binding.validate(selected.as_deref()).await?;
        }
        inner.pi.compact_session().await
    }

    /// `adapter.readHistoryResult()`.
    pub async fn read_history_result(&self) -> AgentResult<Value> {
        let result = self.0.pi.read_history_result().await?;
        if self.0.binding.is_none() {
            return Ok(result);
        }
        let events: Vec<Value> = result["events"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(without_unverified_cost)
            .collect();
        Ok(js::with(&result, "events", events))
    }

    /// `adapter.dispose(reason)`.
    pub async fn dispose_with(&self, reason: Option<&str>) -> AgentResult<()> {
        let disposed = self.0.pi.dispose_with(reason).await;
        if let Some(binding) = self.0.binding.as_ref() {
            binding.dispose().await?;
        }
        disposed
    }
}

impl AgentRuntimeAdapter for PuppyOneAgentAdapter {
    fn inspect(&self) -> AdapterFuture<'_, Value> {
        Box::pin(self.inspect_now())
    }
    fn create_session(&self, selection: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.create_session_inner(selection))
    }
    fn resume_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.resume_session_inner(request))
    }
    fn start_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.start_turn_inner(request))
    }
    fn interrupt_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.0.pi.interrupt_turn(request)
    }
    fn dispose(&self) -> AdapterFuture<'_, ()> {
        Box::pin(self.dispose_with(None))
    }
    fn implements(&self, name: &str) -> bool {
        name == "bootstrapSession" || self.0.pi.implements(name)
    }
    fn bootstrap_session(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.bootstrap_session_inner(request))
    }
    fn steer_turn(&self, request: Value) -> AdapterFuture<'_, Value> {
        Box::pin(self.steer_turn_inner(request))
    }
    fn resolve_approval(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.0.pi.resolve_approval(request)
    }
    fn resolve_question(&self, request: Value) -> AdapterFuture<'_, Value> {
        self.0.pi.resolve_question(request)
    }
    fn compact_session(&self) -> AdapterFuture<'_, Value> {
        Box::pin(self.compact_session_inner())
    }
    fn reference_mention_delivery(&self, reference: &Value) -> Option<&'static str> {
        self.0.pi.reference_mention_delivery(reference)
    }
    fn session_history_port(&self) -> Option<Rc<dyn SessionHistoryPort>> {
        let source = self.0.pi.session_history_port()?.source_scope_id();
        Some(Rc::new(PuppyOneHistoryPort(self.clone(), source)))
    }
}

/// The Pi port, hydrating through this adapter (`this.readHistoryResult()`).
struct PuppyOneHistoryPort(PuppyOneAgentAdapter, Option<String>);

impl SessionHistoryPort for PuppyOneHistoryPort {
    fn source_scope_id(&self) -> Option<String> {
        self.1.clone()
    }
    fn implements(&self, method: &str) -> bool {
        method == "hydrate"
    }
    fn hydrate(&self, _signal: CancelSignal) -> AdapterFuture<'_, Value> {
        Box::pin(self.0.read_history_result())
    }
}
