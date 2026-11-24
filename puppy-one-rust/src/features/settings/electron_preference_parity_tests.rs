use super::*;
use crate::features::create_new::MenuSettings;
use serde_json::json;

fn imported(key: &str, stored: Option<&str>) -> Preferences {
    let storage = stored.into_iter().map(|v| (key.into(), v.into())).collect();
    import(&ElectronData {
        storage,
        ..Default::default()
    })
}
fn menu(input: Option<Value>, expected: Value) {
    let input = input.map(|v| v.to_string());
    let preferences = imported("puppyone.desktop.createNewMenu", input.as_deref());
    assert_eq!(
        serde_json::to_value(&preferences.create_new).unwrap(),
        expected
    );
    let reloaded = Preferences::from_stored(serde_json::to_value(&preferences).unwrap()).unwrap();
    assert_eq!(
        reloaded.create_new, preferences.create_new,
        "native save/reload changed the imported hierarchy"
    );
}

#[test]
fn create_menu_defaults_and_legacy_default_layouts_keep_the_complete_hierarchy() {
    let default = json!({"main":["markdown","csv","html","whiteboard","customFiles"],"submenu":["contextMap"],"hidden":["text","json","slides","app","puppyflow"]});
    assert_eq!(
        serde_json::to_value(MenuSettings::default()).unwrap(),
        default
    );
    let (main, submenu) = MenuSettings::default().visible(false);
    assert_eq!(serde_json::to_value(main).unwrap(), default["main"]);
    assert_eq!(serde_json::to_value(submenu).unwrap(), default["submenu"]);
    menu(None, default.clone());
    for version in [2, 3] {
        menu(
            Some(
                json!({"version":version,"items":[{"kind":"markdown","enabled":true},{"kind":"csv","enabled":true}]}),
            ),
            default.clone(),
        );
    }
}

#[test]
fn visible_create_menu_keeps_the_submenu_position_and_filters_only_its_experiment() {
    let menu: MenuSettings = serde_json::from_value(json!({"main":["app","customFiles","contextMap"],"submenu":["csv","puppyflow"],"hidden":["json","text","markdown","html","slides"]})).unwrap();
    let (main, submenu) = menu.visible(false);
    assert_eq!(
        serde_json::to_value(main).unwrap(),
        json!(["app", "customFiles", "contextMap"])
    );
    assert_eq!(serde_json::to_value(submenu).unwrap(), json!(["csv"]));
    let (_, enabled) = menu.visible(true);
    assert_eq!(
        serde_json::to_value(enabled).unwrap(),
        json!(["csv", "puppyflow"])
    );
    let menu: MenuSettings = serde_json::from_value(
        json!({"main":["customFiles","text"],"submenu":["puppyflow"],"hidden":[]}),
    )
    .unwrap();
    let (main, submenu) = menu.visible(false);
    assert_eq!(serde_json::to_value(main).unwrap(), json!(["text"]));
    assert!(submenu.is_empty());
}

#[test]
fn create_menu_migrates_legacy_enabled_and_placement_without_losing_hidden_choices() {
    menu(
        Some(
            json!({"version":3,"items":[{"kind":"json","enabled":false},{"kind":"text","enabled":true}]}),
        ),
        json!({"main":["whiteboard","customFiles"],"submenu":["text"],"hidden":["json","markdown","contextMap","csv","html","slides","app","puppyflow"]}),
    );
    menu(
        Some(
            json!({"version":4,"items":[{"kind":"json","enabled":true,"placement":"main"},{"kind":"json","enabled":false,"placement":"submenu"},{"kind":"text","enabled":false,"placement":"invalid"},{"kind":"not-a-file-type","enabled":true,"placement":"main"}]}),
        ),
        json!({"main":["json","whiteboard","customFiles"],"submenu":[],"hidden":["text","markdown","contextMap","csv","html","slides","app","puppyflow"]}),
    );
}

#[test]
fn create_menu_normalizes_v5_unknowns_and_duplicates_preserving_submenu_position() {
    menu(
        Some(
            json!({"version":5,"main":["html","customFiles","markdown","html","invalid"],"submenu":["json","markdown"],"hidden":["text","json"]}),
        ),
        json!({"main":["html","whiteboard","customFiles","markdown"],"submenu":["json"],"hidden":["text","contextMap","csv","slides","app","puppyflow"]}),
    );
}

#[test]
fn create_menu_recovers_malformed_values_but_keeps_an_intentionally_empty_legacy_menu() {
    for stored in [
        None,
        Some("invalid"),
        Some("null"),
        Some("false"),
        Some("{}"),
        Some(r#"{"items":[{"kind":"not-a-file-type"}]}"#),
    ] {
        assert_eq!(
            imported("puppyone.desktop.createNewMenu", stored).create_new,
            MenuSettings::default()
        );
    }
    menu(
        Some(json!({"items":[]})),
        json!({"main":["whiteboard","customFiles"],"submenu":[],"hidden":["markdown","contextMap","text","json","csv","html","slides","app","puppyflow"]}),
    );
}

#[test]
fn hidden_agent_ids_keep_first_seen_order_safe_bounds_and_workbuddy_migration() {
    let key = "puppyone.desktop.localAgents";
    for stored in [
        None,
        Some("invalid"),
        Some(r#"{"enabledAgentIds":["codex"]}"#),
    ] {
        let local = imported(key, stored).local_agents;
        assert!(local.hidden_agent_ids.is_empty());
        assert!(!local.chat_history_discovery);
    }
    let local = imported(key,Some(r#"{"hiddenTerminalAgentIds":["codex","claude","codex","../../bad",7],"chatHistoryDiscoveryEnabled":true}"#)).local_agents;
    assert_eq!(local.hidden_agent_ids, ["codex", "claude"]);
    assert!(local.chat_history_discovery);
    let mut values = vec![
        json!("workbuddy"),
        json!("workbuddy-china"),
        json!("Upper"),
        json!("bad space"),
        json!(".first"),
        json!("x".repeat(81)),
        json!("中文"),
    ];
    values.extend((0..20).map(|i| json!(format!("agent-{i}"))));
    let preferences = imported(
        key,
        Some(
            &json!({"hiddenTerminalAgentIds":values,"chatHistoryDiscoveryEnabled":"true"})
                .to_string(),
        ),
    );
    let expected: Vec<String> = [
        "workbuddy-china".to_owned(),
        "workbuddy-international".to_owned(),
    ]
    .into_iter()
    .chain((0..14).map(|i| format!("agent-{i}")))
    .collect();
    assert_eq!(preferences.local_agents.hidden_agent_ids, expected);
    assert!(!preferences.local_agents.chat_history_discovery);
    let native = Preferences::from_stored(
        json!({"local_agents":{"hidden_agent_ids":["workbuddy","codex","codex","../bad"]}}),
    )
    .unwrap();
    assert_eq!(
        native.local_agents.hidden_agent_ids,
        ["workbuddy-china", "workbuddy-international", "codex"]
    );
}

#[test]
fn file_activity_and_pointer_preferences_require_explicit_true() {
    for stored in [
        None,
        Some("true"),
        Some("false"),
        Some("invalid"),
        Some("1"),
        Some("\"true\""),
    ] {
        let enabled = stored == Some("true");
        assert_eq!(
            imported(keys::AGENT_FILE_ACTIVITY, stored).agent_file_activity_indicators,
            enabled
        );
        assert_eq!(
            imported(keys::POINTER_CURSORS, stored).pointer_cursors,
            enabled
        );
    }
}

#[test]
fn import_experiments_restore_legacy_opt_ins_without_turning_on_unrelated_features() {
    for key in [
        "enableOtherAppImports",
        "enableNotionImport",
        "enableGoogleDriveImport",
        "enableAirtableImport",
        "enableObsidianImport",
    ] {
        for value in [json!(true), json!(false), json!("true"), json!(1)] {
            let imported = imported(keys::EXPERIMENTAL, Some(&json!({key:value}).to_string()));
            let expected = Experimental {
                other_app_imports: value == json!(true),
                ..Default::default()
            };
            assert_eq!(imported.experimental, expected, "{key} {value}");
        }
    }
}

#[test]
fn supported_experiments_remain_off_until_opted_in_and_retired_keys_cannot_restore_features() {
    for stored in [None, Some("invalid"), Some("null"), Some("{}"), Some("[]")] {
        let p = imported(keys::EXPERIMENTAL, stored);
        assert_eq!(p.experimental, Experimental::default());
        assert!(!p.project_switcher_rail);
    }
    for key in [
        "enableCloudWorkspace",
        "enableIsolatedAgentSandboxes",
        "enableAlwaysShowOnboardingCoachmarks",
        "enableProjectSwitcherRail",
        "enableMarkdownBlockDrag",
    ] {
        for value in [
            json!(true),
            json!(false),
            json!("true"),
            json!(1),
            Value::Null,
        ] {
            let p = imported(keys::EXPERIMENTAL, Some(&json!({key:value}).to_string()));
            let enabled = value == json!(true);
            let mut expected = Experimental::default();
            match key {
                "enableCloudWorkspace" => expected.cloud_workspace = enabled,
                "enableIsolatedAgentSandboxes" => expected.isolated_agent_sandboxes = enabled,
                "enableAlwaysShowOnboardingCoachmarks" => {
                    expected.always_show_onboarding_coachmarks = enabled
                }
                "enableMarkdownBlockDrag" => expected.markdown_block_drag = enabled,
                _ => {}
            }
            assert_eq!(p.experimental, expected);
            assert_eq!(
                p.project_switcher_rail,
                key == "enableProjectSwitcherRail" && enabled
            );
        }
    }
    for key in [
        "enableBuiltInAgent",
        "enableProjectLocationIconsInHeader",
        "enableCenteredProjectInHeader",
        "enableGitCardInHeader",
        "enableCloudAgentCatalog",
        "enableCloudAutomation",
        "enableFirstProjectStarter",
        "enableEditorSaveStatus",
        "enableContextMaps",
        "enableFolderRelationships",
        "enableMinimalMode",
        "enableAssetLibraryHome",
        "enableOfficeEditing",
    ] {
        for enabled in [false, true] {
            let p = imported(keys::EXPERIMENTAL, Some(&json!({key:enabled}).to_string()));
            assert_eq!(p.experimental, Experimental::default(), "{key}");
            assert!(!p.project_switcher_rail);
        }
    }
}
