//! `createProjectAgentClientProvider(context, getClient)`: a project-owned
//! client captures its generation once, including deferred commands, and
//! fills in a session's instance identity.
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, AgentClientProvider, Cleanup, ClientFuture, same_client,
};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

struct ProjectAgentClient {
    base: Rc<dyn AgentClientPort>,
    context: Value,
    instances: Rc<RefCell<HashMap<String, String>>>,
}

impl AgentClientPort for ProjectAgentClient {
    fn implements(&self, method: &str) -> bool {
        self.base.implements(method)
    }

    fn call(&self, method: &str, request: Value) -> ClientFuture {
        let mut input = if request.is_object() {
            request
        } else {
            serde_json::json!({})
        };
        input["projectContext"] = self.context.clone();
        if let Some(session_id) = input["sessionId"].as_str().map(str::to_string)
            && input
                .get("instanceId")
                .is_none_or(|id| !crate::agent::contract::js::truthy(id))
            && let Some(instance) = self.instances.borrow().get(&session_id)
        {
            input["instanceId"] = Value::from(instance.as_str());
        }
        let call = self.base.call(method, input);
        let instances = self.instances.clone();
        Box::pin(async move {
            let value = call.await?;
            let session = value
                .get("session")
                .filter(|s| s.is_object())
                .or_else(|| value.get("snapshot").and_then(|s| s.get("session")));
            if let Some(session) = session
                && let (Some(id), Some(instance)) =
                    (session["id"].as_str(), session["instanceId"].as_str())
                && !instance.is_empty()
            {
                instances
                    .borrow_mut()
                    .insert(id.to_string(), instance.to_string());
            }
            Ok(value)
        })
    }

    fn on_agent_session_frame(&self, listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        self.base.on_agent_session_frame(listener)
    }

    fn on_agent_session_failure(&self, listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        self.base.on_agent_session_failure(listener)
    }
}

/// `createProjectAgentClientProvider(context, getClient)`.
pub fn create_project_agent_client_provider(
    context: Value,
    get_client: AgentClientProvider,
) -> AgentClientProvider {
    let cache: RefCell<Option<(Rc<dyn AgentClientPort>, Rc<dyn AgentClientPort>)>> =
        RefCell::default();
    let instances: Rc<RefCell<HashMap<String, String>>> = Rc::default();
    Rc::new(move || {
        let current = get_client()?;
        if let Some((source, client)) = cache.borrow().as_ref()
            && same_client(source, &current)
        {
            return Some(client.clone());
        }
        let client: Rc<dyn AgentClientPort> = Rc::new(ProjectAgentClient {
            base: current.clone(),
            context: context.clone(),
            instances: instances.clone(),
        });
        *cache.borrow_mut() = Some((current, client.clone()));
        Some(client)
    })
}
