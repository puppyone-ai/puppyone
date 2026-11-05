//! `electron/main/agent/security`: Main-owned workspace boundaries for what
//! a native runtime may read, write or be told about.
pub mod acp_workspace_files;
pub mod authorized_project_instructions;
pub mod authorized_workspace_reference_prompt;
#[cfg(all(test, unix))]
mod tests;
