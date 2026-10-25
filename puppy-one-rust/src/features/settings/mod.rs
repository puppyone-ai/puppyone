mod main;
pub mod preference_types;
pub mod preferences_store;
pub mod repository_settings;
pub mod settings_workspace_surface;
mod sidebar;
pub mod workspace_config;
pub use settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface};
pub use sidebar::settings_sidebar_model::Page;
