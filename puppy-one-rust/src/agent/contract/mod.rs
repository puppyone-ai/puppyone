//! `shared/agent-contract`: the process-neutral Agent contract. Main and
//! the Renderer exchange the plain data these modules describe and check;
//! nothing here interprets a Harness or renders anything.
pub mod activity_semantics;
pub mod constants;
pub mod display_metrics;
pub mod display_schema;
pub mod display_state;
pub mod display_types;
pub mod dto;
pub mod event_content_update;
pub mod event_schema;
pub mod history_schema;
pub mod js;
pub mod local_connection_schema;
pub mod native_session_id;
pub mod operation_error;
pub mod protocol;
pub mod reference_identity;
pub mod reference_input;
pub mod runtime_schema;
pub mod schema;
#[cfg(test)]
mod tests;
pub mod types;
pub mod validation;
pub mod workspace_resource_reference;

pub use validation::ContractError;
