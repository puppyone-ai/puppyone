//! `runtimes/puppyone-agent/puppyone-agent-environment.mjs`: the narrow
//! environment the product-owned worker inherits.
use super::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::node_path;
use crate::platform::common::command_environment::EnvMap;

const EXACT_ENVIRONMENT_KEYS: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "TERM",
    "COLORTERM",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
];

/// `PUPPYONE_PROVIDER_ENVIRONMENT_KEYS`: the built-in provider contract of
/// the adopted Pi SDK. Arbitrary `*_API_KEY` variables are deliberately
/// excluded.
pub const PUPPYONE_PROVIDER_ENVIRONMENT_KEYS: &[&str] = &[
    "AI_GATEWAY_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_OAUTH_TOKEN",
    "ANT_LING_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AWS_ROLE_SESSION_NAME",
    "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
    "AWS_BEDROCK_SKIP_AUTH",
    "AWS_BEDROCK_FORCE_HTTP1",
    "AWS_BEDROCK_FORCE_CACHE",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_BASE_URL",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_RESOURCE_NAME",
    "AZURE_OPENAI_API_VERSION",
    "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
    "BASETEN_API_KEY",
    "CEREBRAS_API_KEY",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_GATEWAY_ID",
    "COPILOT_GITHUB_TOKEN",
    "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY",
    "GCLOUD_PROJECT",
    "GEMINI_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_API_KEY",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_CLOUD_PROJECT",
    "GROQ_API_KEY",
    "HF_TOKEN",
    "KIMI_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_CN_API_KEY",
    "MISTRAL_API_KEY",
    "MOONSHOT_API_KEY",
    "NVIDIA_API_KEY",
    "OPENAI_API_KEY",
    "OPENCODE_API_KEY",
    "OPENROUTER_API_KEY",
    "QWEN_TOKEN_PLAN_API_KEY",
    "QWEN_TOKEN_PLAN_CN_API_KEY",
    "RADIUS_API_KEY",
    "TOGETHER_API_KEY",
    "XAI_API_KEY",
    "XIAOMI_API_KEY",
    "XIAOMI_TOKEN_PLAN_CN_API_KEY",
    "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
    "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
    "ZAI_API_KEY",
    "ZAI_CODING_CN_API_KEY",
];

/// `buildPuppyOneAgentEnvironment(baseEnv, { profilePath, platform })`.
pub fn build_puppyone_agent_environment(
    base: &EnvMap,
    profile_path: &str,
    platform: &str,
) -> AgentResult<EnvMap> {
    if !node_path::is_absolute(profile_path) {
        return Err(AgentError::new(format!(
            "{BUILT_IN_AGENT_DISPLAY_NAME} requires an absolute managed profile path."
        ))
        .with_name("TypeError"));
    }
    let mut environment: EnvMap = base
        .iter()
        .filter(|(key, _)| {
            EXACT_ENVIRONMENT_KEYS.contains(&key.as_str())
                || key.starts_with("LC_")
                || PUPPYONE_PROVIDER_ENVIRONMENT_KEYS.contains(&key.as_str())
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let home = node_path::resolve_one(profile_path);
    environment.insert("TERM".into(), "dumb".into());
    environment.insert("PUPPYONE_AGENT".into(), "1".into());
    environment.insert(
        "PUPPYONE_AGENT_HOME".into(),
        home.to_string_lossy().into_owned(),
    );
    environment.insert(
        "PI_CODING_AGENT_DIR".into(),
        home.join("pi").to_string_lossy().into_owned(),
    );
    environment.insert(
        "PI_CODING_AGENT_SESSION_DIR".into(),
        home.join("sessions").to_string_lossy().into_owned(),
    );
    environment.insert("ELECTRON_RUN_AS_NODE".into(), "1".into());
    if platform == "win32" {
        environment.insert(
            "PATHEXT".into(),
            base.get("PATHEXT")
                .cloned()
                .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".into()),
        );
    }
    Ok(environment)
}

/// `stripPuppyOneProviderCredentials(environment)`: provider credentials
/// reach the model runtime, never model-callable shell subprocesses.
pub fn strip_puppyone_provider_credentials(environment: &EnvMap) -> EnvMap {
    environment
        .iter()
        .filter(|(key, _)| !PUPPYONE_PROVIDER_ENVIRONMENT_KEYS.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}
