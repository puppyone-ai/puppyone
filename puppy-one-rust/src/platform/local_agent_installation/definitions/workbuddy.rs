//! `local-agent-installation/definitions/workbuddy.mjs`.
use super::join;
use crate::agent::node_path::flavor::{win32_dirname, win32_join};
use crate::platform::local_agent_installation::installation_definition::{
    CandidateSpec, IdentityPolicy, InstallationDefinition, ManifestPolicy,
};

const MACOS_APP_CLI_RELATIVE_PATH: &[&str] = &[
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "cli",
    "bin",
    "codebuddy",
];
const WINDOWS_APP_CLI_RELATIVE_PATH: &[&str] =
    &["resources", "app.asar.unpacked", "cli", "bin", "codebuddy"];

struct Channel {
    id: &'static str,
    display_name: &'static str,
    app_name: &'static str,
    windows_application_names: &'static [&'static str],
    endpoints: &'static [&'static str],
    route: &'static str,
    override_environment_variable: &'static str,
}

fn work_buddy_installation_definition(channel: Channel) -> InstallationDefinition {
    let Channel {
        id,
        display_name,
        app_name,
        windows_application_names,
        endpoints,
        route,
        override_environment_variable,
    } = channel;
    let mut definition = InstallationDefinition::named(id, display_name, &["codebuddy"])
        .with_candidates(move |context| {
            let mut candidates = Vec::new();
            if let Some(path) = context.var(override_environment_variable) {
                candidates.push(CandidateSpec::new(path, "environment-override"));
            }
            let routed = context
                .env
                .get("CODEBUDDY_INTERNET_ENVIRONMENT")
                .is_some_and(|value| value.trim().to_lowercase() == route);
            if let Some(path) = context.var("CODEBUDDY_CODE_PATH").filter(|_| routed) {
                candidates.push(CandidateSpec::new(path, "environment-override"));
            }
            if context.platform == "darwin" {
                let user_applications = join(context.homedir, &["Applications"]);
                for applications_root in ["/Applications", user_applications.as_str()] {
                    let mut segments = vec![app_name];
                    segments.extend_from_slice(MACOS_APP_CLI_RELATIVE_PATH);
                    candidates.push(CandidateSpec::new(
                        join(applications_root, &segments),
                        "product-fallback",
                    ));
                }
            }
            if context.platform == "win32" {
                for registration in context.registered_applications {
                    if !windows_application_names.iter().any(|name| {
                        registration.application_name.to_lowercase() == name.to_lowercase()
                    }) {
                        continue;
                    }
                    let mut segments = vec![win32_dirname(&registration.executable_path)];
                    segments.extend_from_slice(WINDOWS_APP_CLI_RELATIVE_PATH);
                    let cli_path = win32_join(&segments);
                    let product_manifest_path =
                        win32_join(&[win32_dirname(win32_dirname(&cli_path)), "product.json"]);
                    candidates.push(CandidateSpec {
                        path: cli_path.clone(),
                        source: registration.source.clone(),
                        launcher_path: Some(registration.executable_path.clone()),
                        args_prefix: Some(vec![cli_path]),
                        environment_overrides: Some(vec![(
                            "ELECTRON_RUN_AS_NODE".into(),
                            "1".into(),
                        )]),
                        identity_file_path: Some(product_manifest_path),
                        requires_manifest_identity: true,
                        identity_mismatch_as_not_found: true,
                    });
                }
            }
            Ok(candidates)
        });
    definition.registered_application_names = Some(
        windows_application_names
            .iter()
            .map(|n| n.to_string())
            .collect(),
    );
    // `codebuddy` on PATH is a multi-channel CLI. A stable product identity
    // requires an exact desktop-app path or an explicitly routed override.
    definition.search_path = false;
    let mut policy = IdentityPolicy::new(
        &["codebuddy"],
        &["@tencent-ai/codebuddy-code", "@genie/agent-cli"],
        &[],
        &["__codebuddy_process_start_time__", "codebuddy code"],
    );
    policy.path_fragments = vec![format!("/{}/", app_name.to_lowercase())];
    policy.manifest = Some(ManifestPolicy {
        parent_depth: 1,
        file_name: "product.json".into(),
        property: "endpoint".into(),
        values: endpoints.iter().map(|e| e.to_string()).collect(),
    });
    definition.identity_policy = Some(policy);
    definition
}

/// `workBuddyChinaInstallationDefinition`.
pub fn work_buddy_china_installation_definition() -> InstallationDefinition {
    work_buddy_installation_definition(Channel {
        id: "workbuddy-china",
        display_name: "WorkBuddy (China)",
        app_name: "WorkBuddy.app",
        windows_application_names: &["WorkBuddy.exe"],
        endpoints: &["https://www.workbuddy.cn", "https://www.codebuddy.cn"],
        route: "internal",
        override_environment_variable: "WORKBUDDY_CHINA_CODE_PATH",
    })
}

/// `workBuddyInternationalInstallationDefinition`.
pub fn work_buddy_international_installation_definition() -> InstallationDefinition {
    work_buddy_installation_definition(Channel {
        id: "workbuddy-international",
        display_name: "WorkBuddy (International)",
        app_name: "WorkBuddy AI.app",
        windows_application_names: &["WorkBuddy.exe", "WorkBuddy AI.exe"],
        endpoints: &["https://www.workbuddy.ai", "https://www.codebuddy.ai"],
        route: "public",
        override_environment_variable: "WORKBUDDY_INTERNATIONAL_CODE_PATH",
    })
}
