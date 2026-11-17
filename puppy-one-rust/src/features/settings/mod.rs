//! Settings: the preference store and its typed slices, the preference
//! types, and the Settings page. Other features and the window reach it
//! through these exports.
mod agent_routing_preferences;
mod electron_preferences;
mod main;
mod preference_types;
mod preferences_store;
mod repository_settings;
mod settings_workspace_surface;
mod sidebar;
mod workspace_config;

pub use agent_routing_preferences::{
    AgentRoutePatch, AgentRoutePreference, AgentRoutingPreferences,
};
pub use preference_types::{
    ExplorerPins, FilesVisibility, GitSidebarLayout, HeaderCoachmarks, HomepageLayout,
    HomepageSort, PinnedFile, Preferences, RecentProject, RightSidebarSurface, SetupSuggestions,
    SubThemeIds, ThemeMode,
};
pub use preferences_store::{PreferencesChanged, PreferencesStore, Slice, observe_slice};
pub use settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface};
pub use sidebar::settings_sidebar_model::Page;
