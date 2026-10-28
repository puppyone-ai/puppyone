//! The editor workbench (product `src/features/editor-workbench` and
//! shared-ui `editor/workbench`, `editor/find`): open references, placement,
//! retained Working Copy owners, metadata, pane chrome and find. Local host
//! integration is implemented; this is not the completed Cloud/TS migration.
pub mod catalog;
pub mod find;
pub mod layout;
pub mod pane;
pub mod resource_operations;
pub mod runtime;
#[cfg(test)]
mod tests;
