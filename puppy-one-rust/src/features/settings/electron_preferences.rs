//! The Electron product's preferences as native [`Preferences`] (PL-3), for
//! a first launch with no native preferences yet. Each key is read the way
//! the product parses it (`src/preferences.ts`, `preferenceStorage.ts`,
//! `appearancePreferences.ts` with its legacy keys); anything unreadable
//! keeps the native default. Credentials are never part of it.
use super::preference_types::{
    Experimental, GitSidebarLayout, Preferences, RECENT_PROJECT_LIMIT, RecentProject, ThemeMode,
};
use crate::platform::electron_import::ElectronData;
use serde_json::Value;

/// `localStorage` keys (`src/preferences.ts`, `preferenceStorage.ts`,
/// `interface-style-manifest.json`, `useFirstRunSignIn.ts`).
mod keys {
    pub const APPEARANCE: &str = "puppyone.desktop.appearance";
    pub const THEME: &str = "puppyone.desktop.theme";
    pub const LIGHT_PRESET: &str = "puppyone.desktop.lightThemePreset";
    pub const DARK_PRESET: &str = "puppyone.desktop.darkThemePreset";
    pub const TYPOGRAPHY: &str = "puppyone.desktop.typography";
    pub const POINTER_CURSORS: &str = "puppyone.desktop.pointerCursors";
    pub const FILE_ICON_THEME: &str = "puppyone.desktop.fileIconTheme";
    pub const LOADING: &str = "puppyone.desktop.loadingAnimation";
    pub const EXPLORER_WIDTH: &str = "puppyone.desktop.explorerWidth";
    pub const SIDEBAR_COLLAPSED: &str = "puppyone.desktop.sidebarCollapsed";
    pub const RIGHT_SIDEBAR_WIDTH: &str = "puppyone.desktop.rightSidebarWidth";
    pub const EXPERIMENTAL: &str = "puppyone.desktop.experimental";
    pub const FILES: &str = "puppyone.desktop.filesVisibility";
    pub const LOCAL_AGENTS: &str = "puppyone.desktop.localAgents";
    pub const GIT_SIDEBAR_LAYOUT: &str = "puppyone.desktop.gitSidebarLayout";
    pub const TITLEBAR_ACTIONS: &str = "puppyone.desktop.titlebarActions";
    pub const FIRST_RUN_SIGN_IN: &str = "puppyone.desktop.firstRunSignInCompleted.v1";
}

/// The native preferences a first launch starts from.
pub fn import(data: &ElectronData) -> Preferences {
    let mut p = Preferences::default();
    let get = |key: &str| data.storage.get(key).map(String::as_str);
    let object = |key: &str| {
        get(key)
            .and_then(|v| serde_json::from_str::<Value>(v).ok())
            .filter(Value::is_object)
    };

    p.recent_projects = data
        .recent
        .iter()
        .take(RECENT_PROJECT_LIMIT)
        .map(|r| RecentProject {
            path: r.path.clone(),
            name: r.name.clone(),
            opened_at: r.opened_at,
        })
        .collect();
    if let Some(language) = &data.language
        && (language == "system"
            || crate::localization::Locale::choices().any(|(id, _)| id == language))
    {
        p.locale = language.clone();
    }

    appearance(&mut p, object(keys::APPEARANCE), &get);

    // `preferenceStorage.ts`: numbers and the collapsed flag.
    if let Some(width) = get(keys::EXPLORER_WIDTH).and_then(|v| v.trim().parse::<f32>().ok())
        && width.is_finite()
    {
        p.explorer_width = width;
    }
    if let Some(width) = get(keys::RIGHT_SIDEBAR_WIDTH).and_then(|v| v.trim().parse::<f32>().ok())
        && width.is_finite()
    {
        p.right_sidebar_width = width;
    }
    p.sidebar_collapsed = get(keys::SIDEBAR_COLLAPSED) == Some("true");

    if let Some(experimental) = object(keys::EXPERIMENTAL) {
        (p.experimental, p.project_switcher_rail) = experimental_settings(&experimental);
    }
    // `parseFilesVisibilitySettings`.
    if let Some(files) = object(keys::FILES) {
        p.files.show_hidden_files = files.get("showHiddenFiles") == Some(&Value::Bool(true));
        if let Some(patterns) = files.get("excludePatterns").and_then(Value::as_array) {
            let mut seen = std::collections::BTreeSet::new();
            p.files.exclude_patterns = patterns
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty() && seen.insert(s.to_string()))
                .map(str::to_owned)
                .collect();
        }
    }
    // `parseLocalAgentsSettings`: the legacy `enabledAgentIds` meant Editor
    // provider visibility and never hides a launcher.
    if let Some(agents) = object(keys::LOCAL_AGENTS) {
        if let Some(hidden) = agents
            .get("hiddenTerminalAgentIds")
            .and_then(Value::as_array)
        {
            let mut ids: Vec<String> = hidden
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            ids.sort();
            ids.dedup();
            p.local_agents.hidden_agent_ids = ids;
        }
        if let Some(Value::Bool(on)) = agents.get("chatHistoryDiscoveryEnabled") {
            p.local_agents.chat_history_discovery = *on;
        }
    }
    p.git_sidebar_layout = match get(keys::GIT_SIDEBAR_LAYOUT) {
        Some("dividers") => GitSidebarLayout::Dividers,
        _ => GitSidebarLayout::Cards,
    };
    // `parseTitlebarActionsSettings`: on unless switched off.
    if let Some(actions) = object(keys::TITLEBAR_ACTIONS)
        && let Some(enabled) = actions.get("enabled").filter(|v| v.is_object())
    {
        p.header_changes = enabled.get("changes") != Some(&Value::Bool(false));
        p.header_terminal = enabled.get("terminal") != Some(&Value::Bool(false));
    }
    p.first_run_sign_in_completed = get(keys::FIRST_RUN_SIGN_IN) == Some("true");
    p
}

/// `appearancePreferences.ts`: the v6 document, else the legacy keys it
/// migrates from. Only the default interface is native (D-6).
fn appearance<'a>(
    p: &mut Preferences,
    document: Option<Value>,
    get: &dyn Fn(&str) -> Option<&'a str>,
) {
    let theme_mode = |value: Option<&str>| match value {
        Some("light") => Some(ThemeMode::Light),
        Some("dark") => Some(ThemeMode::Dark),
        Some("system") => Some(ThemeMode::System),
        _ => None,
    };
    let pack = |id: Option<&str>| {
        id.filter(|id| crate::theme::pack_choices().any(|(known, _)| known == *id))
            .map(str::to_owned)
    };
    let current = document.filter(|d| d.get("schemaVersion").and_then(Value::as_u64) == Some(6));
    let (mode, light, dark) = match &current {
        Some(d) => {
            let root = d
                .get("byRootTheme")
                .and_then(|r| r.get("default"))
                .cloned()
                .unwrap_or(Value::Null);
            let ids = root.get("requestedSubThemeIds");
            (
                theme_mode(root.get("requestedColorMode").and_then(Value::as_str)),
                pack(ids.and_then(|i| i.get("light")).and_then(Value::as_str)),
                pack(ids.and_then(|i| i.get("dark")).and_then(Value::as_str)),
            )
        }
        // The default interface's legacy presets were `default.<preset>`.
        None => (
            theme_mode(get(keys::THEME)),
            pack(
                get(keys::LIGHT_PRESET)
                    .map(|p| format!("default.{p}"))
                    .as_deref(),
            ),
            pack(
                get(keys::DARK_PRESET)
                    .map(|p| format!("default.{p}"))
                    .as_deref(),
            ),
        ),
    };
    if let Some(mode) = mode {
        p.theme_mode = mode;
    }
    // One native Sub Theme serves both modes: the one the chosen mode uses.
    if let Some(id) = match p.theme_mode {
        ThemeMode::Dark => dark.or(light),
        _ => light.or(dark),
    } {
        p.theme_pack = id;
    }
    let shared = current.as_ref().and_then(|d| d.get("shared")).cloned();
    let typography = shared
        .as_ref()
        .and_then(|s| s.get("typography"))
        .map(Value::to_string)
        .or_else(|| get(keys::TYPOGRAPHY).map(str::to_owned));
    if let Some(typography) = typography {
        (p.fonts, p.text_scale) = crate::typography::fonts::parse_preferences(Some(&typography));
    }
    let shared_bool = |key: &str| {
        shared
            .as_ref()
            .and_then(|s| s.get(key))
            .and_then(Value::as_bool)
    };
    if let Some(on) =
        shared_bool("pointerCursors").or(get(keys::POINTER_CURSORS).map(|v| v == "true"))
    {
        p.pointer_cursors = on;
    }
    if let Some(on) = shared_bool("showFileIcons") {
        p.show_file_icons = on;
    }
    let shared_str = |key: &str| {
        shared
            .as_ref()
            .and_then(|s| s.get(key))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    if let Some(theme) =
        shared_str("fileIconTheme").or(get(keys::FILE_ICON_THEME).map(str::to_owned))
    {
        p.file_icon_theme = theme;
    }
    if let Some(style) =
        shared_str("loadingPlaceholderStyle").or(get(keys::LOADING).map(str::to_owned))
    {
        p.loading_style = serde_json::from_value(Value::String(style)).unwrap_or_default();
    }
}

/// `parseExperimentalSettings` (and the Project Switcher Rail, which the
/// native preferences keep beside them). Git Auto Commit consent is main
/// owned and never restored from renderer storage.
fn experimental_settings(v: &Value) -> (Experimental, bool) {
    let on = |key: &str| v.get(key) == Some(&Value::Bool(true));
    let not_off = |key: &str| v.get(key) != Some(&Value::Bool(false));
    let experimental = Experimental {
        asset_library_home: on("enableAssetLibraryHome"),
        always_show_onboarding_coachmarks: on("enableAlwaysShowOnboardingCoachmarks"),
        cloud_automation: on("enableCloudAutomation"),
        cloud_workspace: on("enableCloudWorkspace"),
        editor_tabs_in_header: on("enableEditorTabsInHeader"),
        centered_project_in_header: on("enableCenteredProjectInHeader"),
        project_location_icons_in_header: on("enableProjectLocationIconsInHeader"),
        project_reach: on("enableProjectReach"),
        share_onboarding: not_off("enableShareOnboarding"),
        workbench_tabs_in_header: on("enableWorkbenchTabsInHeader"),
        git_auto_commit: false,
        markdown_block_drag: on("enableMarkdownBlockDrag"),
        markdown_heading_outline: on("enableMarkdownHeadingOutline"),
        multi_root_workspaces: on("enableMultiRootWorkspaces"),
        other_app_imports: on("enableOtherAppImports")
            || on("enableNotionImport")
            || on("enableGoogleDriveImport")
            || on("enableAirtableImport")
            || on("enableObsidianImport"),
        payments: not_off("enablePayments"),
        puppy_flow_files: on("enablePuppyFlowFiles"),
        viewer_plugins: on("enableViewerPlugins"),
    };
    (experimental, on("enableProjectSwitcherRail"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::electron_import::Recent;
    use core::prelude::v1::test;
    use std::path::PathBuf;

    fn data(storage: &[(&str, &str)]) -> ElectronData {
        ElectronData {
            recent: vec![
                Recent {
                    path: PathBuf::from("/p/last"),
                    name: "Last".into(),
                    opened_at: 2,
                },
                Recent {
                    path: PathBuf::from("/p/older"),
                    name: "Older".into(),
                    opened_at: 1,
                },
            ],
            language: Some("ja".into()),
            storage: storage
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        }
    }

    #[test]
    fn the_product_appearance_document_and_layout_carry_over() {
        let p = import(&data(&[
            (
                keys::APPEARANCE,
                r#"{"schemaVersion":6,"activeRootThemeId":"default",
                   "shared":{"typography":{"version":11,"contentFont":{"mode":"follow-theme"},
                             "codeFontId":"builtin:geist-mono","terminalFontId":"builtin:terminal-system-mono","scale":"large"},
                             "pointerCursors":true,"showFileIcons":false,"loadingPlaceholderStyle":"dither",
                             "fileIconTheme":"default","sidebarNavigationLayout":"bottom-horizontal"},
                   "byRootTheme":{"default":{"requestedColorMode":"dark",
                      "requestedSubThemeIds":{"light":"default.neutral","dark":"default.neutral"}}},
                   "bySurface":{}}"#,
            ),
            (keys::EXPLORER_WIDTH, "312"),
            (keys::SIDEBAR_COLLAPSED, "true"),
            (keys::RIGHT_SIDEBAR_WIDTH, "480"),
            (keys::GIT_SIDEBAR_LAYOUT, "dividers"),
            (keys::FIRST_RUN_SIGN_IN, "true"),
            (
                keys::TITLEBAR_ACTIONS,
                r#"{"enabled":{"changes":false},"order":["terminal","changes"]}"#,
            ),
        ]));
        assert_eq!(p.recent_projects[0].path, PathBuf::from("/p/last"));
        assert_eq!(p.recent_projects.len(), 2);
        assert_eq!(p.locale, "ja");
        assert_eq!(p.theme_mode, ThemeMode::Dark);
        assert_eq!(p.theme_pack, "default.neutral");
        assert_eq!(p.text_scale, crate::typography::Scale::Large);
        assert!(p.pointer_cursors);
        assert!(!p.show_file_icons);
        assert_eq!(p.loading_style, crate::ui::loading::LoadingStyle::Dither);
        assert_eq!((p.explorer_width, p.right_sidebar_width), (312., 480.));
        assert!(p.sidebar_collapsed);
        assert_eq!(p.git_sidebar_layout, GitSidebarLayout::Dividers);
        assert!(p.first_run_sign_in_completed);
        assert!(!p.header_changes && p.header_terminal);
    }

    #[test]
    fn legacy_keys_flags_and_unknown_values_follow_the_product_parsers() {
        let p = import(&data(&[
            (keys::THEME, "light"),
            (
                keys::TYPOGRAPHY,
                r#"{"version":8,"scales":{"editor":"small"}}"#,
            ),
            (keys::POINTER_CURSORS, "true"),
            (
                keys::EXPERIMENTAL,
                r#"{"enableCloudWorkspace":true,"enablePayments":false,"enableGitAutoCommit":true,
                    "enableNotionImport":true,"enableProjectSwitcherRail":true}"#,
            ),
            (
                keys::FILES,
                r#"{"showHiddenFiles":true,"excludePatterns":[" **/.git ","**/.git",""]}"#,
            ),
            (
                keys::LOCAL_AGENTS,
                r#"{"hiddenTerminalAgentIds":["pi","codex","pi"],"enabledAgentIds":["claude"],
                    "chatHistoryDiscoveryEnabled":true}"#,
            ),
            (keys::EXPLORER_WIDTH, "wide"),
        ]));
        assert_eq!(p.theme_mode, ThemeMode::Light);
        assert_eq!(p.text_scale, crate::typography::Scale::Small);
        assert!(p.pointer_cursors);
        assert!(p.experimental.cloud_workspace && p.experimental.other_app_imports);
        assert!(!p.experimental.payments);
        assert!(p.experimental.share_onboarding, "on unless switched off");
        assert!(!p.experimental.git_auto_commit, "main-owned consent");
        assert!(p.project_switcher_rail);
        assert!(p.files.show_hidden_files);
        assert_eq!(p.files.exclude_patterns, ["**/.git"]);
        assert_eq!(p.local_agents.hidden_agent_ids, ["codex", "pi"]);
        assert!(p.local_agents.chat_history_discovery);
        assert_eq!(
            p.explorer_width,
            Preferences::default().explorer_width,
            "an unreadable width keeps the default"
        );
        // Nothing stored: the native defaults, an unknown language included.
        let empty = import(&ElectronData {
            language: Some("xx".into()),
            ..Default::default()
        });
        assert_eq!(empty, Preferences::default());
    }
}
