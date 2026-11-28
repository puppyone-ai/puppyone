//! `createProjectAgentClientProvider(context, getClient)`: a project-owned
//! client fills in the live instance of the sessions it has seen. (The
//! product also stamps each request with its project generation for Main's
//! IPC checks; the Agent host authorizes a window's roots instead.)
use crate::agent::contract::dto::{SessionFailure, SessionFrame, SessionMetadata};
use crate::agent::contract::protocol::{AgentOperation, AgentRequest, AgentResponse};
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, AgentClientProvider, Cleanup, ClientFuture, same_client,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

struct ProjectAgentClient {
    base: Rc<dyn AgentClientPort>,
    instances: Rc<RefCell<HashMap<String, String>>>,
}

/// The session (and its live instance) an answer reports.
fn reported_session(response: &AgentResponse) -> Option<&SessionMetadata> {
    match response {
        AgentResponse::Snapshot(snapshot) => Some(&snapshot.session),
        AgentResponse::FeedReceipt(receipt) => receipt.snapshot.as_ref().ok().map(|s| &s.session),
        AgentResponse::Opened(crate::agent::contract::dto::SessionOpenResult::Opened(snapshot)) => {
            Some(&snapshot.session)
        }
        _ => None,
    }
}

impl AgentClientPort for ProjectAgentClient {
    fn supports(&self, operation: AgentOperation) -> bool {
        self.base.supports(operation)
    }

    fn delivers_frames(&self) -> bool {
        self.base.delivers_frames()
    }

    fn request(&self, mut request: AgentRequest) -> ClientFuture {
        if request.instance_id().is_none()
            && let Some(session_id) = request.session_id().map(str::to_string)
            && let Some(instance) = self.instances.borrow().get(&session_id)
        {
            request.set_instance_id(instance);
        }
        let call = self.base.request(request);
        let instances = self.instances.clone();
        Box::pin(async move {
            let response = call.await?;
            if let Some(session) = reported_session(&response)
                && let Some(instance) = session.instance()
            {
                instances
                    .borrow_mut()
                    .insert(session.id.clone(), instance.to_string());
            }
            Ok(response)
        })
    }

    fn on_agent_session_frame(&self, listener: Rc<dyn Fn(SessionFrame)>) -> Option<Cleanup> {
        self.base.on_agent_session_frame(listener)
    }

    fn on_agent_session_failure(&self, listener: Rc<dyn Fn(SessionFailure)>) -> Option<Cleanup> {
        self.base.on_agent_session_failure(listener)
    }
}

/// The wrapped client of one source client.
type Cached = (Rc<dyn AgentClientPort>, Rc<dyn AgentClientPort>);

/// `createProjectAgentClientProvider(context, getClient)`.
pub fn create_project_agent_client_provider(
    get_client: AgentClientProvider,
) -> AgentClientProvider {
    let cache: RefCell<Option<Cached>> = RefCell::default();
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
            instances: instances.clone(),
        });
        *cache.borrow_mut() = Some((current, client.clone()));
        Some(client)
    })
}
