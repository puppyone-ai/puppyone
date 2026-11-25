//! The Electron product's preferences as native [`Preferences`] (PL-3), for
//! a first launch with no native preferences yet. Each key is read the way
//! the product parses it (`src/preferences.ts`, `preferenceStorage.ts`,
//! `appearancePreferences.ts` with its legacy keys); anything unreadable
//! keeps the native default. Credentials are never part of it.
use super::preference_types::{
    Experimental, GitSidebarLayout, HomepageLayout, HomepageSort, Preferences, RecentProject,
    RightSidebarSurface, ThemeMode,
};
use crate::platform::electron_import::ElectronData;
use serde_json::Value;

#[cfg(test)]
#[path = "electron_preference_parity_tests.rs"]
mod parity_tests;

/// `localStorage` keys (`src/preferences.ts`, `preferenceStorage.ts`,
/// `interface-style-manifest.json`, `useFirstRunSignIn.ts`).
mod keys {
    pub const APPEARANCE: &str = "puppyone.desktop.appearance";
    /// Before the canonical document: `legacyAppearancePreferences` and the
    /// separate keys `readLegacyAppearanceSnapshot` reads.
    pub const LEGACY_APPEARANCE: &str = "puppyone.desktop.appearance.v2";
    pub const INTERFACE_STYLE: &str = "puppyone.desktop.interfaceStyle";
    pub const LEGACY_PRESET: &str = "puppyone.desktop.themePreset";
    pub const SURFACE_THEMES: &str = "puppyone.desktop.surfaceThemes";
    pub const TEXT_SIZE: &str = "puppyone.desktop.textSize";
    pub const THEME: &str = "puppyone.desktop.theme";
    pub const LIGHT_PRESET: &str = "puppyone.desktop.lightThemePreset";
    pub const DARK_PRESET: &str = "puppyone.desktop.darkThemePreset";
    pub const TYPOGRAPHY: &str = "puppyone.desktop.typography";
    pub const POINTER_CURSORS: &str = "puppyone.desktop.pointerCursors";
    pub const FILE_ICON_THEME: &str = "puppyone.desktop.fileIconTheme";
    pub const EXPLORER_WIDTH: &str = "puppyone.desktop.explorerWidth";
    pub const SIDEBAR_COLLAPSED: &str = "puppyone.desktop.sidebarCollapsed";
    pub const RIGHT_SIDEBAR_WIDTH: &str = "puppyone.desktop.rightSidebarWidth";
    pub const RIGHT_SIDEBAR_SURFACE: &str = "puppyone.desktop.rightSidebarSurface";
    pub const EXPERIMENTAL: &str = "puppyone.desktop.experimental";
    pub const FILES: &str = "puppyone.desktop.filesVisibility";
    pub const LOCAL_AGENTS: &str = "puppyone.desktop.localAgents";
    pub const AGENT_ROUTING: &str = "puppyone.desktop.agentRoutingPreferences.v1";
    pub const AGENT_PREFERRED_RUNTIME: &str = "puppyone.desktop.agentPreferredRuntime";
    pub const AGENT_PREFERRED_MODEL: &str = "puppyone.desktop.agentPreferredModel";
    pub const AGENT_FILE_ACTIVITY: &str = "puppyone.desktop.agentFileActivityIndicators";
    pub const HEADER_COACHMARKS: &str = "puppyone.desktop.headerCoachmarks.v1";
    pub const GIT_SIDEBAR_LAYOUT: &str = "puppyone.desktop.gitSidebarLayout";
    pub const TITLEBAR_ACTIONS: &str = "puppyone.desktop.titlebarActions";
    pub const CREATE_NEW: &str = "puppyone.desktop.createNewMenu";
    pub const FIRST_RUN_SIGN_IN: &str = "puppyone.desktop.firstRunSignInCompleted.v1";
    pub const HOMEPAGE_LAYOUT: &str = "puppyone.desktop.homepageProjectLayout";
    pub const HOMEPAGE_SORT: &str = "puppyone.desktop.homepageProjectSort";
    /// `EXPLORER_PINS_STORAGE_PREFIX`, then `:` and the project's path.
    pub const EXPLORER_PINS: &str = "puppyone.desktop.explorer-pins.v1:";
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
        .map(|r| RecentProject {
            path: r.path.clone(),
            name: r.name.clone(),
            opened_at: r.opened_at,
            host_folder: None,
            fs_identity: None,
        })
        .collect();
    if let Some(language) = &data.language
        && (language == "system"
            || crate::localization::Locale::choices().any(|(id, _)| id == language))
    {
        p.locale = language.clone();
    }

    appearance(
        &mut p,
        object(keys::APPEARANCE).or_else(|| object(keys::LEGACY_APPEARANCE)),
        &get,
    );
    p.create_new = crate::features::create_new::MenuSettings::from_electron(get(keys::CREATE_NEW));

    // `readInitialHomepageProjectLayout` / `…Sort`: the stored word, else Grid
    // and Last modified.
    p.homepage_project_layout = match get(keys::HOMEPAGE_LAYOUT) {
        Some("list") => HomepageLayout::List,
        _ => HomepageLayout::Grid,
    };
    p.homepage_project_sort = match get(keys::HOMEPAGE_SORT) {
        Some("name") => HomepageSort::Name,
        _ => HomepageSort::Modified,
    };

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
    // `readInitialRightSidebarSurface`: `history` or `changes`, else Chat.
    p.right_sidebar_surface = match get(keys::RIGHT_SIDEBAR_SURFACE) {
        Some("history") => RightSidebarSurface::History,
        Some("changes") => RightSidebarSurface::Changes,
        _ => RightSidebarSurface::Chat,
    };

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
    // `parseAgentRoutingPreferences(stored, { legacyRuntimeId, legacyModelId })`.
    p.agent_routing =
        crate::features::settings::agent_routing_preferences::AgentRoutingPreferences::parse(
            get(keys::AGENT_ROUTING),
            get(keys::AGENT_PREFERRED_RUNTIME),
            get(keys::AGENT_PREFERRED_MODEL)
                .map(|m| m.trim())
                .filter(|m| !m.is_empty()),
        );
    // `parseLocalAgentsSettings`: the legacy `enabledAgentIds` meant Editor
    // provider visibility and never hides a launcher.
    if let Some(agents) = object(keys::LOCAL_AGENTS) {
        if let Some(hidden) = agents
            .get("hiddenTerminalAgentIds")
            .and_then(Value::as_array)
        {
            p.local_agents.hidden_agent_ids = hidden
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            p.local_agents.normalize_hidden_ids();
        }
        if let Some(Value::Bool(on)) = agents.get("chatHistoryDiscoveryEnabled") {
            p.local_agents.chat_history_discovery = *on;
        }
        // `normalizeSetupPreferences`: on unless switched off.
        if let Some(setup) = agents.get("setupSuggestions").filter(|v| v.is_object()) {
            let suggestions = &mut p.local_agents.setup_suggestions;
            suggestions.enabled = setup.get("enabled") != Some(&Value::Bool(false));
            suggestions.dismissed_setup_ids = setup
                .get("dismissedSetupIds")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            suggestions.snoozed_until = setup
                .get("snoozedUntil")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(id, until)| Some((id.clone(), until.as_u64()?)))
                .collect();
            *suggestions = std::mem::take(suggestions).normalized();
        }
    }
    // `parseAgentFileActivityIndicatorsEnabled`: off unless stored "true".
    p.agent_file_activity_indicators = get(keys::AGENT_FILE_ACTIVITY) == Some("true");
    // `readHeaderCoachmarkProgress`.
    if let Some(progress) = object(keys::HEADER_COACHMARKS) {
        p.header_coachmarks.agent = progress.get("agent") == Some(&Value::Bool(true));
        p.header_coachmarks.changes = progress.get("changes") == Some(&Value::Bool(true));
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
    p.explorer_pins = explorer_pins(data);
    p
}
/// `readStoredPins` for every single-folder project (a multi-folder key
/// joins its folders with U+001F; native projects have one folder).
fn explorer_pins(
    data: &ElectronData,
) -> std::collections::BTreeMap<String, super::preference_types::ExplorerPins> {
    use super::preference_types::{ExplorerPins, PinnedFile};
    data.storage
        .iter()
        .filter_map(|(key, value)| {
            let project = key.strip_prefix(keys::EXPLORER_PINS)?;
            if project.is_empty() || project.contains('\u{1f}') {
                return None;
            }
            let parsed: Value = serde_json::from_str(value).ok()?;
            let files: Vec<PinnedFile> = parsed["files"]
                .as_array()?
                .iter()
                .filter(|f| {
                    ["id", "name", "path", "type"]
                        .iter()
                        .all(|k| f[k].is_string())
                        && f["type"] != "folder"
                })
                .filter_map(|f| {
                    let path = f["path"].as_str()?;
                    let relative = path
                        .strip_prefix(project)
                        .unwrap_or(path)
                        .trim_start_matches('/');
                    (!relative.is_empty()).then(|| PinnedFile {
                        path: relative.to_owned(),
                        name: f["name"].as_str().unwrap_or(relative).to_owned(),
                    })
                })
                .collect();
            (!files.is_empty()).then(|| {
                (
                    project.to_owned(),
                    ExplorerPins {
                        files,
                        files_collapsed: parsed["filesCollapsed"] == true,
                    },
                )
            })
        })
        .collect()
}

/// `appearancePreferences.ts`: the v6 document, else the legacy keys it
/// migrates from. Only the default interface is native (D-6).
/// `readAppearancePreferences` for the Default root theme: a schema-6
/// document as it is, an older one (or the `appearance.v2` document)
/// migrated, and no document — or a newer one this release cannot read —
/// from the separate legacy keys.
fn appearance<'a>(
    p: &mut Preferences,
    document: Option<Value>,
    get: &dyn Fn(&str) -> Option<&'a str>,
) {
    let mode_of = |value: Option<&str>| match value {
        Some("light") => ThemeMode::Light,
        Some("dark") => ThemeMode::Dark,
        _ => ThemeMode::System,
    };
    // Installed (`local.*`) ids are kept: the Themes Folder may hold them.
    let pack = |id: Option<&str>| id.and_then(super::preference_types::normalize_sub_theme_id);
    let neutral = || {
        (
            crate::theme::DEFAULT_PACK.to_owned(),
            crate::theme::DEFAULT_PACK.to_owned(),
        )
    };
    // `readLegacyAppearanceSnapshot`.
    let legacy_mode = mode_of(get(keys::THEME));
    let legacy_light = light_preset(get(keys::LIGHT_PRESET).or_else(|| get(keys::LEGACY_PRESET)))
        .unwrap_or("neutral")
        .to_owned();
    let legacy_dark = dark_preset(get(keys::DARK_PRESET))
        .unwrap_or("default")
        .to_owned();
    let surface_theme = legacy_surface_theme(get(keys::SURFACE_THEMES));
    let legacy_default = |style: Option<&str>| style != Some("windows-xp");
    // `resolveLegacyDefaultSubThemes`: Warm and Graphite presets have their
    // own Sub Themes; any other preset was Neutral.
    let preset_ids = |light: &str, dark: &str| match &surface_theme {
        Some(id) => (id.clone(), id.clone()),
        None => {
            let id = |preset: &str| match preset {
                "warm" => "default.warm".to_owned(),
                "graphite" => "default.graphite".to_owned(),
                _ => crate::theme::DEFAULT_PACK.to_owned(),
            };
            (id(light), id(dark))
        }
    };
    // `readRootThemePreferences` for `default`.
    let root = |value: &Value, fallback: ThemeMode, by_style: bool| {
        let single = pack(text(value.get("requestedSubThemeId")).or(text(value.get("subThemeId"))));
        let by_mode = value.get("requestedSubThemeIds");
        let id = |mode: &str| {
            pack(text(by_mode.and_then(|m| m.get(mode))))
                .or_else(|| single.clone())
                .unwrap_or_else(|| crate::theme::DEFAULT_PACK.to_owned())
        };
        let mode = text(value.get("requestedColorMode"))
            .or_else(|| by_style.then(|| text(value.get("themeMode"))).flatten());
        (
            mode.map_or(fallback, |m| mode_of(Some(m))),
            id("light"),
            id("dark"),
        )
    };
    let document = document.filter(Value::is_object);
    let version = document
        .as_ref()
        .and_then(|d| d.get("schemaVersion"))
        .and_then(Value::as_u64);
    let (requested, shared, text_size) = match (&document, version) {
        // `normalizeV6`.
        (Some(d), Some(6)) => {
            let active = text(d.get("activeRootThemeId")).or(get(keys::INTERFACE_STYLE));
            let requested = match d.get("byRootTheme").and_then(|r| r.get("default")) {
                Some(value) if value.is_object() => root(value, legacy_mode, false),
                _ if legacy_default(active) => {
                    let (light, dark) = preset_ids(&legacy_light, &legacy_dark);
                    (legacy_mode, light, dark)
                }
                _ => {
                    let (light, dark) = neutral();
                    (ThemeMode::System, light, dark)
                }
            };
            (requested, d.get("shared").cloned(), None)
        }
        // `migrateLegacyDocument`.
        (Some(d), version) if version.is_none_or(|v| v < 6) => {
            let shared = d
                .get("shared")
                .filter(|s| s.is_object())
                .cloned()
                .unwrap_or_else(|| d.clone());
            let active = text(d.get("activeRootThemeId"))
                .or(text(d.get("activeStyle")))
                .or(text(d.get("style")))
                .or(get(keys::INTERFACE_STYLE));
            let mode = mode_of(text(shared.get("themeMode")).or(get(keys::THEME)));
            let (light, dark) = preset_ids(
                light_preset(text(shared.get("lightThemePreset"))).unwrap_or(&legacy_light),
                dark_preset(text(shared.get("darkThemePreset"))).unwrap_or(&legacy_dark),
            );
            let remembered = match d.get("byRootTheme") {
                Some(roots) if roots.is_object() => roots
                    .get("default")
                    .filter(|r| r.is_object())
                    .map(|r| root(r, mode, false)),
                _ => d
                    .get("byStyle")
                    .and_then(|s| s.get("default"))
                    .filter(|r| r.is_object())
                    .map(|r| root(r, mode, true)),
            };
            let requested = remembered.unwrap_or_else(|| {
                if legacy_default(active) {
                    (mode, light, dark)
                } else {
                    let (light, dark) = neutral();
                    (ThemeMode::System, light, dark)
                }
            });
            let size = text(shared.get("textSize")).map(str::to_owned);
            (requested, Some(shared), size)
        }
        // `fromLegacy`: no document, or one newer than this release.
        _ => {
            let requested = if legacy_default(get(keys::INTERFACE_STYLE)) {
                let (light, dark) = preset_ids(&legacy_light, &legacy_dark);
                (legacy_mode, light, dark)
            } else {
                let (light, dark) = neutral();
                (ThemeMode::System, light, dark)
            };
            (requested, None, get(keys::TEXT_SIZE).map(str::to_owned))
        }
    };
    let (mode, light, dark) = requested;
    p.theme_mode = mode;
    // Light and Dark selections are remembered independently.
    p.sub_theme_ids.light = light;
    p.sub_theme_ids.dark = dark;
    let typography = shared
        .as_ref()
        .and_then(|s| s.get("typography"))
        .map(Value::to_string)
        .or_else(|| get(keys::TYPOGRAPHY).map(str::to_owned));
    if let Some(typography) = typography {
        (p.fonts, p.text_scale) = crate::typography::fonts::parse_preferences(Some(&typography));
    }
    // `migrateLegacyContentSize`: the retired content-size switch, only
    // before schema 6.
    match text_size.as_deref() {
        Some("small") => p.text_scale = crate::typography::Scale::Small,
        Some("large") => p.text_scale = crate::typography::Scale::Large,
        _ => {}
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
    // `parseFileIconThemeId`: a retired id becomes its replacement.
    if let Some(theme) =
        shared_str("fileIconTheme").or(get(keys::FILE_ICON_THEME).map(str::to_owned))
    {
        p.file_icon_theme = crate::file_kind::parse_theme(Some(&theme))
            .unwrap_or(crate::file_kind::default_theme())
            .into();
    }
}

fn text(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str)
}
/// `isLightThemePreset`, `isDarkThemePreset`.
fn light_preset(value: Option<&str>) -> Option<&str> {
    value.filter(|v| matches!(*v, "neutral" | "warm" | "graphite"))
}
fn dark_preset(value: Option<&str>) -> Option<&str> {
    value.filter(|v| matches!(*v, "default" | "warm" | "graphite"))
}
/// `readLegacySurfaceSubThemeId`: one Sub Theme chosen for all three
/// surfaces (version 1), never the managed Custom CSS id.
fn legacy_surface_theme(value: Option<&str>) -> Option<String> {
    let parsed: Value = serde_json::from_str(value?).ok()?;
    if parsed.get("version").and_then(Value::as_u64) != Some(1) {
        return None;
    }
    let ids: Vec<String> = ["application", "markdown", "csv"]
        .iter()
        .filter_map(|surface| parsed.get(*surface).and_then(Value::as_str))
        .filter_map(super::preference_types::normalize_sub_theme_id)
        .collect();
    (ids.len() == 3
        && ids.iter().all(|id| *id == ids[0])
        && ids[0] != crate::platform::themes::service::LEGACY_CUSTOM_THEME_ID)
        .then(|| ids[0].clone())
}

/// `parseExperimentalSettings` (and the Project Switcher Rail, which the
/// native preferences keep beside them) for the experiments supported natively.
fn experimental_settings(v: &Value) -> (Experimental, bool) {
    let on = |key: &str| v.get(key) == Some(&Value::Bool(true));
    let not_off = |key: &str| v.get(key) != Some(&Value::Bool(false));
    let experimental = Experimental {
        always_show_onboarding_coachmarks: on("enableAlwaysShowOnboardingCoachmarks"),
        cloud_workspace: on("enableCloudWorkspace"),
        cloud_computer_screen: on("enableCloudComputerScreen"),
        isolated_agent_sandboxes: on("enableIsolatedAgentSandboxes"),
        computer_mode: on("enableComputerMode"),
        editor_tabs_in_header: on("enableEditorTabsInHeader"),
        // The product has no such experiment.
        hidden_header: false,
        host_devices: on("enableHostDevices"),
        markdown_block_drag: on("enableMarkdownBlockDrag"),
        other_app_imports: on("enableOtherAppImports")
            || on("enableNotionImport")
            || on("enableGoogleDriveImport")
            || on("enableAirtableImport")
            || on("enableObsidianImport"),
        payments: not_off("enablePayments"),
        puppy_flow_files: on("enablePuppyFlowFiles"),
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
                      "requestedSubThemeIds":{"light":"builtin.pack.github","dark":"local.user.ocean"}}},
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
        assert_eq!(
            p.sub_theme_ids.light, "default.github",
            "retired ids are renamed"
        );
        assert_eq!(
            p.sub_theme_ids.dark, "local.user.ocean",
            "installed ids are kept"
        );
        assert_eq!(p.text_scale, crate::typography::Scale::Large);
        assert!(p.pointer_cursors);
        assert!(!p.show_file_icons);
        assert_eq!((p.explorer_width, p.right_sidebar_width), (312., 480.));
        assert!(p.sidebar_collapsed);
        assert_eq!(p.git_sidebar_layout, GitSidebarLayout::Dividers);
        assert!(p.first_run_sign_in_completed);
        assert!(!p.header_changes && p.header_terminal);
    }

    /// `appearance profile architecture`: every schema of the product's
    /// Appearance document, the pre-document keys, and a document newer than
    /// this release, as `readAppearancePreferences` resolves them for the
    /// Default root theme.
    #[test]
    fn appearance_documents_of_every_schema_migrate_like_the_product() {
        let doc = |text: &str| import(&data(&[(keys::APPEARANCE, text)]));
        // Schema 2: the Default style's remembered Sub Theme and mode, even
        // while another style was active.
        let p = doc(r#"{"schemaVersion":2,"activeStyle":"windows-xp",
            "shared":{"sidebarNavigationLayout":"left-vertical","themeMode":"dark"},
            "byStyle":{"default":{"subThemeId":"builtin.pack.github","themeMode":"dark"},
                       "windows-xp":{"subThemeId":"windows-xp.luna-blue","themeMode":"light"}},
            "bySurface":{"markdown":{"headingScale":"large"}}}"#);
        assert_eq!(p.theme_mode, ThemeMode::Dark);
        assert_eq!(
            (
                p.sub_theme_ids.light.as_str(),
                p.sub_theme_ids.dark.as_str()
            ),
            ("default.github", "default.github")
        );
        // Schema 1 keeps everything at the top level.
        assert_eq!(
            doc(r#"{"schemaVersion":1,"style":"default","navigationLayout":"left-vertical","themeMode":"light"}"#)
                .theme_mode,
            ThemeMode::Light
        );
        // The retired content size becomes the typography scale before 6 ...
        let p = doc(r#"{"schemaVersion":5,"activeRootThemeId":"default",
            "shared":{"textSize":"large","typography":{"version":4,"contentFont":{"mode":"follow-theme"}}},
            "byRootTheme":{},"bySurface":{}}"#);
        assert_eq!(p.text_scale, crate::typography::Scale::Large);
        // ... and is ignored once a schema-6 document exists.
        let p = doc(r#"{"schemaVersion":6,"activeRootThemeId":"default",
            "shared":{"textSize":"large","typography":{"version":11,"scale":"medium"},
                      "pointerCursors":false,"fileIconTheme":"vscode"},
            "byRootTheme":{},"bySurface":{}}"#);
        assert_eq!(p.text_scale, crate::typography::Scale::Medium);
        // A retired file-icon theme id is migrated inside the document.
        assert_eq!(p.file_icon_theme, "default");
        // Legacy Light and Dark presets become independent memories.
        let p = import(&data(&[
            (keys::LIGHT_PRESET, "warm"),
            (keys::DARK_PRESET, "graphite"),
        ]));
        assert_eq!(
            (
                p.sub_theme_ids.light.as_str(),
                p.sub_theme_ids.dark.as_str()
            ),
            ("default.warm", "default.graphite")
        );
        // A document newer than this release is not read: the legacy keys
        // decide, and the Default style.
        let p = import(&data(&[
            (
                keys::APPEARANCE,
                r#"{"schemaVersion":99,"activeStyle":"future-style","shared":{}}"#,
            ),
            (keys::THEME, "dark"),
        ]));
        assert_eq!(p.theme_mode, ThemeMode::Dark);
        assert_eq!(p.sub_theme_ids.dark, crate::theme::DEFAULT_PACK);
        // The pre-canonical document, the legacy content size, and one Sub
        // Theme chosen for every surface.
        let p = import(&data(&[(
            keys::LEGACY_APPEARANCE,
            r#"{"schemaVersion":3,"shared":{"themeMode":"light","lightThemePreset":"graphite"}}"#,
        )]));
        assert_eq!(
            (p.theme_mode, p.sub_theme_ids.light.as_str()),
            (ThemeMode::Light, "default.graphite")
        );
        let p = import(&data(&[
            (keys::TEXT_SIZE, "small"),
            (
                keys::SURFACE_THEMES,
                r#"{"version":1,"application":"default.github","markdown":"builtin.pack.github","csv":"default.github"}"#,
            ),
        ]));
        assert_eq!(p.text_scale, crate::typography::Scale::Small);
        assert_eq!(
            (
                p.sub_theme_ids.light.as_str(),
                p.sub_theme_ids.dark.as_str()
            ),
            ("default.github", "default.github")
        );
    }

    #[test]
    fn a_projects_pins_come_along() {
        let p = import(&data(&[
            (
                "puppyone.desktop.explorer-pins.v1:/p/notes",
                r#"{"files":[{"id":"plan.md","name":"plan.md","path":"plan.md","type":"file"},
                   {"id":"x","name":"x","path":"docs","type":"folder"}],"filesCollapsed":true}"#,
            ),
            (
                "puppyone.desktop.explorer-pins.v1:/a\u{1f}/b",
                r#"{"files":[]}"#,
            ),
        ]));
        let pins = &p.explorer_pins["/p/notes"];
        assert_eq!(pins.files.len(), 1);
        assert_eq!(pins.files[0].path, "plan.md");
        assert!(pins.files_collapsed);
        assert_eq!(p.explorer_pins.len(), 1);
    }

    /// `readInitialRightSidebarSurface`: Chat unless History or Changes was
    /// stored; anything else (a retired `terminal`) is Chat.
    #[test]
    fn the_right_sidebar_starts_on_chat_unless_a_git_surface_was_stored() {
        assert_eq!(
            import(&data(&[])).right_sidebar_surface,
            RightSidebarSurface::Chat
        );
        for (stored, surface) in [
            ("history", RightSidebarSurface::History),
            ("changes", RightSidebarSurface::Changes),
            ("terminal", RightSidebarSurface::Chat),
        ] {
            assert_eq!(
                import(&data(&[(keys::RIGHT_SIDEBAR_SURFACE, stored)])).right_sidebar_surface,
                surface,
                "{stored}"
            );
        }
    }

    #[test]
    fn legacy_keys_flags_and_unknown_values_follow_the_product_parsers() {
        let p = import(&data(&[
            (keys::THEME, "light"),
            (keys::LIGHT_PRESET, "warm"),
            (keys::DARK_PRESET, "graphite"),
            (
                keys::TYPOGRAPHY,
                r#"{"version":8,"scales":{"editor":"small"}}"#,
            ),
            (keys::POINTER_CURSORS, "true"),
            (
                keys::EXPERIMENTAL,
                r#"{"enableCloudWorkspace":true,"enableCloudComputerScreen":true,"enablePayments":false,"enableGitAutoCommit":true,
                    "enableViewerPlugins":true,"enableNotionImport":true,"enableProjectSwitcherRail":true}"#,
            ),
            (
                keys::FILES,
                r#"{"showHiddenFiles":true,"excludePatterns":[" **/.git ","**/.git",""]}"#,
            ),
            (
                keys::LOCAL_AGENTS,
                r#"{"hiddenTerminalAgentIds":["pi","codex","pi"],"enabledAgentIds":["claude"],
                    "chatHistoryDiscoveryEnabled":true,"setupSuggestions":{"enabled":false,
                    "dismissedSetupIds":["codex","nope","codex"],"snoozedUntil":{"cursor":5,"x":1,"pi":-1}}}"#,
            ),
            (keys::AGENT_FILE_ACTIVITY, "true"),
            (keys::HEADER_COACHMARKS, r#"{"agent":true,"changes":"yes"}"#),
            (keys::EXPLORER_WIDTH, "wide"),
        ]));
        assert_eq!(p.theme_mode, ThemeMode::Light);
        // `createLegacyRequestedSubThemeIds`: the legacy presets choose the
        // Sub Themes the first window paints.
        assert_eq!(
            (
                p.sub_theme_ids.light.as_str(),
                p.sub_theme_ids.dark.as_str()
            ),
            ("default.warm", "default.graphite")
        );
        assert_eq!(p.text_scale, crate::typography::Scale::Small);
        assert!(p.pointer_cursors);
        assert!(
            p.experimental.cloud_workspace
                && p.experimental.cloud_computer_screen
                && p.experimental.other_app_imports
        );
        assert!(!p.experimental.payments);
        assert!(p.project_switcher_rail);
        assert!(p.files.show_hidden_files);
        assert_eq!(p.files.exclude_patterns, ["**/.git"]);
        assert_eq!(p.local_agents.hidden_agent_ids, ["pi", "codex"]);
        assert!(p.local_agents.chat_history_discovery);
        let setup = &p.local_agents.setup_suggestions;
        assert!(!setup.enabled);
        assert_eq!(setup.dismissed_setup_ids, ["codex"]);
        assert_eq!(setup.snoozed_until, [("cursor".to_owned(), 5)].into());
        assert!(p.agent_file_activity_indicators);
        assert_eq!(
            (p.header_coachmarks.agent, p.header_coachmarks.changes),
            (true, false)
        );
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
