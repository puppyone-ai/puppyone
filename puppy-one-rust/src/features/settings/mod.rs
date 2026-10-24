mod main;
pub mod preference_types;
pub mod preferences_store;
pub mod repository_settings;
pub mod settings_workspace_surface;
pub mod workspace_config;
mod sidebar;
pub use settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface};
pub use sidebar::settings_sidebar_model::Page;
