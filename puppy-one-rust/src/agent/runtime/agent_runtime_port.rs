//! Native runtime seam: application code has no provider method names or JSON envelopes.
use crate::agent::domain::agent_session_model::{Resolution, SessionSnapshot};
use crate::agent::domain::reference_input::Prompt;
use serde_json::Value;
pub trait AgentRuntimePort {
    fn snapshot(&self) -> &SessionSnapshot;
    fn poll(&mut self);
    fn send(&mut self, text: String);
    fn submit(&mut self, prompt: Prompt) {
        self.send(prompt.text_with_references())
    }
    fn reload_configuration(&mut self) {}
    fn steer(&mut self, _text: String) {}
    fn fork(&mut self) {}
    fn compact(&mut self) {}
    fn archive(&mut self, _id: String) {}
    fn rename(&mut self, _name: String) {}
    fn select_mode(&mut self, _mode: String) {}
    fn select_effort(&mut self, _effort: String) {}
    fn stop(&mut self);
    fn resume(&mut self, id: String);
    fn list_history(&mut self);
    fn new_thread(&mut self);
    fn resolve(&mut self, id: &Value, response: Resolution);
    fn select_model(&mut self, model: Option<String>);
}
