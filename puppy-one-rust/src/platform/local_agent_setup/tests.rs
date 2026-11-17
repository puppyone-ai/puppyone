use super::*;
use core::prelude::v1::test;
#[test]
fn routes_follow_the_catalog_and_recipes_are_platform_qualified() {
    let names: Vec<_> = ROUTES.iter().map(|r| r.display_name).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);
    let codex = route("codex").unwrap().recipe("darwin", "arm64").unwrap();
    assert_eq!(codex.binary, "vendor/aarch64-apple-darwin/bin/codex");
    assert!(route("codex").unwrap().recipe("linux", "x64").is_none());
    assert!(route("claude").unwrap().recipe("darwin", "arm64").is_none());
    // The product's hex digest, re-encoded.
    use base64::Engine as _;
    let cursor = route("cursor").unwrap().recipe("darwin", "arm64").unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(cursor.digest)
        .unwrap();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(
        hex,
        "4e67b9ac80cc4a56e0a91b3b437894e0ba489ef7ec37f120d8084d2bfd02095d"
    );
    let x64 = route("cursor").unwrap().recipe("darwin", "x64").unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(x64.digest)
        .unwrap();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(
        hex,
        "f4298af7114a57ce317ddc13a49c273e1113b027e3e6b7a0769b8ef3565e6897"
    );
    for digest in [
        codex.digest,
        route("codex")
            .unwrap()
            .recipe("darwin", "x64")
            .unwrap()
            .digest,
    ] {
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(digest)
                .unwrap()
                .len(),
            64
        );
    }
    assert!(
        !route("workbuddy-china")
            .unwrap()
            .supports(Surface::Terminal)
    );
}
#[test]
fn only_a_missing_cli_beside_its_app_is_recommended() {
    let hidden = vec![];
    let dismissed = vec![];
    let snoozed = std::collections::BTreeMap::from([("cursor".to_owned(), 2_000)]);
    let request = Request {
        surface: Surface::Chat,
        eligible: &CHAT_IDS,
        hidden: &hidden,
        enabled: true,
        dismissed: &dismissed,
        snoozed_until: &snoozed,
    };
    let companions = [
        ("codex", companion::Presence::Present),
        ("cursor", companion::Presence::Present),
    ];
    let entries = advise(
        &request,
        "darwin",
        &completed_observations(&["claude"]),
        &companions,
        1_000,
        &Default::default(),
    );
    assert_eq!(entries.len(), 8);
    let get = |id: &str| entries.iter().find(|e| e.setup_id == id).unwrap();
    assert_eq!(get("claude").status, Found::Found);
    assert!(get("codex").recommended);
    // Snoozed until later.
    assert!(!get("cursor").recommended);
    assert!(!get("opencode").recommended);
    let linux = advise(
        &request,
        "linux",
        &[],
        &companions,
        1_000,
        &Default::default(),
    );
    assert!(linux.iter().all(|e| !e.setup_id.starts_with("workbuddy")));
    let terminal = Request {
        surface: Surface::Terminal,
        eligible: &TERMINAL_IDS,
        ..request
    };
    assert_eq!(
        advise(&terminal, "darwin", &[], &[], 0, &Default::default()).len(),
        6
    );
}

fn oracle() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../fixtures/local-agent-setup-oracle.json"
    ))
    .unwrap()
}
#[test]
fn actual_typescript_setup_advice_preserves_every_evidence_state_and_suppression_policy() {
    use serde_json::{Value, json};
    for case in oracle()["advice"].as_array().unwrap() {
        let input = &case["input"];
        let request = &input["request"];
        let strings = |v: &Value| {
            v.as_array()
                .unwrap()
                .iter()
                .map(|s| s.as_str().unwrap().to_owned())
                .collect::<Vec<_>>()
        };
        let eligible = strings(&request["eligibleInstallationIds"]);
        let hidden = strings(&request["hiddenAgentIds"]);
        let dismissed = strings(&request["preferences"]["dismissedSetupIds"]);
        let snoozed =
            serde_json::from_value(request["preferences"]["snoozedUntil"].clone()).unwrap();
        let eligible = eligible.iter().map(String::as_str).collect::<Vec<_>>();
        let request = Request {
            surface: match request["surface"].as_str().unwrap() {
                "chat" => Surface::Chat,
                "terminal" => Surface::Terminal,
                _ => panic!("invalid surface"),
            },
            eligible: &eligible,
            hidden: &hidden,
            enabled: request["preferences"]["enabled"].as_bool().unwrap(),
            dismissed: &dismissed,
            snoozed_until: &snoozed,
        };
        let observations = input["installations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| Observation {
                id: o["agentId"].as_str().unwrap().into(),
                status: match o["status"].as_str().unwrap() {
                    "found" => ObservationStatus::Found,
                    "not-found" => ObservationStatus::NotFound,
                    "failed" => ObservationStatus::Failed,
                    "unknown" => ObservationStatus::Unknown,
                    _ => panic!("invalid observation"),
                },
                failure: match o["reasonCode"].as_str() {
                    Some("environment-unavailable") => {
                        Some(ObservationFailure::EnvironmentUnavailable)
                    }
                    Some("context-error") => Some(ObservationFailure::ContextError),
                    Some(_) => Some(ObservationFailure::Product),
                    None => None,
                },
            })
            .collect::<Vec<_>>();
        let companions = input["companions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    route(c["companionId"].as_str().unwrap()).unwrap().id,
                    match c["status"].as_str().unwrap() {
                        "present" => companion::Presence::Present,
                        "not-found" => companion::Presence::NotFound,
                        "unknown" => companion::Presence::Unknown,
                        "unsupported" => companion::Presence::Unsupported,
                        _ => panic!("invalid companion evidence"),
                    },
                )
            })
            .collect::<Vec<_>>();
        let suppressed = strings(&input["suppressed"]).into_iter().collect();
        let entries = advise(
            &request,
            input["platform"].as_str().unwrap(),
            &observations,
            &companions,
            input["now"].as_u64().unwrap(),
            &suppressed,
        );
        let actual = entries.iter().map(|e| json!({
            "setupId":e.setup_id,"installationId":e.setup_id,"displayName":e.display_name,
            "strategy":match e.strategy {Strategy::ExternalCli=>"external-cli",Strategy::AppBundledRuntime=>"app-bundled-runtime",Strategy::CompanionManagedRuntime=>"companion-managed-runtime"},
            "status":match e.status {Found::Found=>"found",Found::NotFound=>"not-found",Found::Unknown=>"unknown"},
            "companionPresent":e.companion_present,"recommended":e.recommended,
        })).collect::<Vec<_>>();
        assert_eq!(json!(actual), case["expected"], "{}", case["name"]);
    }
}

#[test]
fn actual_typescript_platform_matrix_preserves_guided_and_automatic_capabilities() {
    use serde_json::json;
    for case in oracle()["capabilities"].as_array().unwrap() {
        let platform = case["platform"].as_str().unwrap();
        let arch = case["arch"].as_str().unwrap();
        let mut registered = ROUTES
            .iter()
            .filter(|r| r.platforms.contains(&platform))
            .map(|r| r.id)
            .collect::<Vec<_>>();
        registered.sort();
        assert_eq!(json!(registered), case["registered"], "{platform}/{arch}");
        for expected in case["agents"].as_array().unwrap() {
            let r = route(expected["id"].as_str().unwrap()).unwrap();
            let supported = r.platforms.contains(&platform);
            let recipe = r.recipe(platform,arch).map(|r| json!({
                "setupId":r.setup_id,"version":r.version,"entry":r.entry,"binary":r.binary,
                "artifact":{"url":r.url,"algorithm":match r.algorithm {Algorithm::Sha256=>"sha256",Algorithm::Sha512=>"sha512"},"digest":r.digest},
            }));
            let actual = json!({"id":r.id,"chat":supported&&r.supports(Surface::Chat),"terminal":supported&&r.supports(Surface::Terminal),"companionDiscovery":supported&&platform=="darwin"&&r.companion.is_some(),"automaticInstall":recipe.is_some(),"recipe":recipe});
            assert_eq!(actual, *expected, "{platform}/{arch}/{}", r.id);
        }
    }
}
