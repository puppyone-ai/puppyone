//! The provider registry: every service a model connection can name — its
//! brand, the protocol the Built-in Agent speaks to it, its default address
//! and context budget, and how a user authenticates (an API key, an OAuth
//! sign-in or nothing). Settings, catalogs and the model client read their
//! defaults here; nothing else hard-codes a provider.
use super::configuration::{Auth, Driver, SourceKind};
use super::oauth::OauthProvider;

/// The wire protocol a driver speaks for inference.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    /// OpenAI Chat Completions (`/chat/completions`).
    OpenaiChat,
    /// Anthropic Messages (`/v1/messages`).
    AnthropicMessages,
    /// OpenAI Responses (`/responses`).
    OpenaiResponses,
    /// ChatGPT's Codex backend (`/codex/responses`): Responses with the
    /// account header and `store: false`.
    CodexResponses,
}

/// A model a provider is known to serve when its service lists none (or
/// cannot be listed with the credential the user has).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KnownModel {
    pub id: &'static str,
    pub context: u64,
}

/// One registered provider.
#[derive(Clone, Copy, Debug)]
pub struct Provider {
    /// Stable identity, saved on connections as `provider`.
    pub id: &'static str,
    /// The brand's name (not translated).
    pub name: &'static str,
    /// The brand mark under `assets/providers/`, if the brand has one.
    pub mark: Option<&'static str>,
    /// The mark is one colour, drawn in the row's text colour.
    pub monochrome: bool,
    pub source: SourceKind,
    /// The driver an API-key (or keyless local) connection uses.
    pub driver: Driver,
    pub base_url: &'static str,
    /// The context budget used when the service reports none.
    pub context: u64,
    /// The provider accepts an API key.
    pub api_key: bool,
    /// The OAuth sign-in this provider offers, and the driver its signed-in
    /// connections use.
    pub oauth: Option<(OauthProvider, Driver, &'static str)>,
    /// Models to prefer as the default, in order.
    pub recommended: &'static [&'static str],
    /// Models served when the catalog cannot be read.
    pub known: &'static [KnownModel],
}

impl Provider {
    /// The authentication a new connection of this provider starts with.
    pub fn default_auth(&self) -> Auth {
        if self.api_key && self.source == SourceKind::Api {
            Auth::Bearer
        } else if self.api_key {
            self.driver.default_auth()
        } else if self.oauth.is_some() {
            Auth::Oauth
        } else {
            Auth::None
        }
    }
}

const fn known(id: &'static str, context: u64) -> KnownModel {
    KnownModel { id, context }
}

#[allow(clippy::too_many_arguments)]
const fn api(
    id: &'static str,
    name: &'static str,
    mark: Option<&'static str>,
    monochrome: bool,
    driver: Driver,
    base_url: &'static str,
    context: u64,
    recommended: &'static [&'static str],
) -> Provider {
    Provider {
        id,
        name,
        mark,
        monochrome,
        source: SourceKind::Api,
        driver,
        base_url,
        context,
        api_key: true,
        oauth: None,
        recommended,
        known: &[],
    }
}

const fn local(
    id: &'static str,
    name: &'static str,
    mark: Option<&'static str>,
    monochrome: bool,
    driver: Driver,
    base_url: &'static str,
) -> Provider {
    Provider {
        id,
        name,
        mark,
        monochrome,
        source: SourceKind::Local,
        driver,
        base_url,
        context: LOCAL_CONTEXT,
        api_key: true,
        oauth: None,
        recommended: &[],
        known: &[],
    }
}

/// The budget a local model gets when its service reports no window.
pub const LOCAL_CONTEXT: u64 = 32_768;

/// API-key presets, in the order Settings offers them.
pub const API_PROVIDERS: &[Provider] = &[
    api(
        "openai",
        "OpenAI",
        Some("openai.svg"),
        true,
        Driver::OpenaiCompatible,
        "https://api.openai.com/v1",
        128_000,
        &["gpt-5.5", "gpt-5.4", "gpt-4.1"],
    ),
    api(
        "anthropic",
        "Anthropic",
        Some("anthropic.svg"),
        true,
        Driver::Anthropic,
        "https://api.anthropic.com",
        200_000,
        // `/v1/models` lists the newest model first.
        &[],
    ),
    api(
        "gemini",
        "Google Gemini",
        Some("gemini-color.svg"),
        false,
        Driver::OpenaiCompatible,
        "https://generativelanguage.googleapis.com/v1beta/openai",
        1_048_576,
        &["gemini-2.5-pro", "gemini-2.5-flash"],
    ),
    Provider {
        oauth: Some((
            OauthProvider::Openrouter,
            Driver::OpenaiCompatible,
            "https://openrouter.ai/api/v1",
        )),
        ..api(
            "openrouter",
            "OpenRouter",
            Some("openrouter.svg"),
            true,
            Driver::OpenaiCompatible,
            "https://openrouter.ai/api/v1",
            128_000,
            &["openai/gpt-5.5", "google/gemini-2.5-pro"],
        )
    },
    api(
        "deepseek",
        "DeepSeek",
        Some("deepseek-color.svg"),
        false,
        Driver::OpenaiCompatible,
        "https://api.deepseek.com/v1",
        131_072,
        &["deepseek-chat", "deepseek-reasoner"],
    ),
    api(
        "moonshot",
        "Moonshot (Kimi)",
        Some("kimi-color.svg"),
        false,
        Driver::OpenaiCompatible,
        "https://api.moonshot.ai/v1",
        262_144,
        &["kimi-k2-turbo-preview", "kimi-k2-0905-preview"],
    ),
    api(
        "qwen",
        "Alibaba Cloud Model Studio (Qwen)",
        Some("qwen-color.svg"),
        false,
        Driver::OpenaiCompatible,
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        131_072,
        &["qwen3-coder-plus", "qwen-plus"],
    ),
    api(
        "zhipu",
        "Zhipu (GLM)",
        Some("zhipu-color.svg"),
        false,
        Driver::OpenaiCompatible,
        "https://open.bigmodel.cn/api/paas/v4",
        131_072,
        &["glm-4.6", "glm-4.5"],
    ),
    Provider {
        oauth: Some((
            OauthProvider::Xai,
            Driver::OpenaiResponses,
            "https://api.x.ai/v1",
        )),
        known: &[known("grok-4", 256_000), known("grok-code-fast-1", 256_000)],
        ..api(
            "xai",
            "xAI",
            Some("xai.svg"),
            true,
            Driver::OpenaiCompatible,
            "https://api.x.ai/v1",
            256_000,
            &["grok-4", "grok-code-fast-1"],
        )
    },
    api(
        "groq",
        "Groq",
        Some("groq.svg"),
        true,
        Driver::OpenaiCompatible,
        "https://api.groq.com/openai/v1",
        131_072,
        &["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct-0905"],
    ),
    api(
        "mistral",
        "Mistral",
        Some("mistral-color.svg"),
        false,
        Driver::OpenaiCompatible,
        "https://api.mistral.ai/v1",
        131_072,
        &["mistral-large-latest", "devstral-medium-latest"],
    ),
    api(
        "custom",
        "OpenAI-compatible",
        None,
        false,
        Driver::OpenaiCompatible,
        "",
        32_768,
        &[],
    ),
];

/// Sign-in-only providers: subscriptions the Built-in Agent may use through
/// the provider's own OAuth (ported from Pi Coding Agent).
pub const ACCOUNT_PROVIDERS: &[Provider] = &[
    Provider {
        id: "openai-api",
        name: "OpenAI",
        mark: Some("openai.svg"),
        monochrome: true,
        source: SourceKind::Api,
        // "Sign in with ChatGPT" for agents: the token calls the OpenAI API
        // (Responses) directly; `/models` lists what it may use.
        driver: Driver::OpenaiResponses,
        base_url: "https://api.openai.com/v1",
        context: 400_000,
        api_key: false,
        oauth: Some((
            OauthProvider::OpenaiApi,
            Driver::OpenaiResponses,
            "https://api.openai.com/v1",
        )),
        recommended: &[],
        known: &[],
    },
    Provider {
        id: "meta",
        name: "Meta",
        mark: Some("meta-color.svg"),
        monochrome: false,
        source: SourceKind::Api,
        // Meta Model API (Responses), Pi `providers/meta.ts`; models.dev
        // lists the Muse family with a 1M window.
        driver: Driver::OpenaiResponses,
        base_url: "https://api.meta.ai/v1",
        context: 1_048_576,
        api_key: false,
        oauth: Some((
            OauthProvider::Meta,
            Driver::OpenaiResponses,
            "https://api.meta.ai/v1",
        )),
        recommended: &["muse-spark-1.3"],
        known: &[known("muse-spark-1.3", 1_048_576)],
    },
    Provider {
        id: "chatgpt",
        name: "ChatGPT",
        mark: Some("openai.svg"),
        monochrome: true,
        source: SourceKind::Api,
        driver: Driver::Chatgpt,
        base_url: "https://chatgpt.com/backend-api",
        context: 272_000,
        api_key: false,
        oauth: Some((
            OauthProvider::Chatgpt,
            Driver::Chatgpt,
            "https://chatgpt.com/backend-api",
        )),
        recommended: &["gpt-5.5", "gpt-5.4"],
        known: &[known("gpt-5.5", 272_000), known("gpt-5.4", 272_000)],
    },
    Provider {
        id: "kimi-code",
        name: "Kimi Code",
        mark: Some("kimi-color.svg"),
        monochrome: false,
        source: SourceKind::Api,
        // Chat Completions, as the official Kimi Code client and Pi
        // (`catalog/providers/kimi-coding.ts`) call it; `/models` lists the
        // plan's models (kimi-for-coding, k3…).
        driver: Driver::OpenaiCompatible,
        base_url: "https://api.kimi.com/coding/v1",
        context: 262_144,
        api_key: false,
        oauth: Some((
            OauthProvider::KimiCode,
            Driver::OpenaiCompatible,
            "https://api.kimi.com/coding/v1",
        )),
        recommended: &["kimi-for-coding"],
        known: &[known("kimi-for-coding", 262_144)],
    },
    Provider {
        id: "qwen-code",
        name: "Qwen Code",
        mark: Some("qwen-color.svg"),
        monochrome: false,
        source: SourceKind::Api,
        driver: Driver::OpenaiCompatible,
        // Qwen Code's subscription API (`oauth-config.ts`): a Plus or Pro
        // plan; its `/models` lists what the plan serves.
        base_url: "https://api.qwen.ai/compatible-mode/v1",
        context: 262_144,
        api_key: false,
        oauth: Some((
            OauthProvider::QwenCode,
            Driver::OpenaiCompatible,
            "https://api.qwen.ai/compatible-mode/v1",
        )),
        recommended: &["qwen3.8-max"],
        known: &[known("qwen3.8-max", 262_144)],
    },
];

/// Local model services, in discovery order.
pub const LOCAL_PROVIDERS: &[Provider] = &[
    local(
        "ollama",
        "Ollama",
        Some("ollama.svg"),
        true,
        Driver::Ollama,
        "http://127.0.0.1:11434/v1",
    ),
    local(
        "lm-studio",
        "LM Studio",
        Some("lmstudio.svg"),
        true,
        Driver::LmStudio,
        "http://127.0.0.1:1234/v1",
    ),
    local(
        "omlx",
        "oMLX",
        Some("omlx.svg"),
        false,
        Driver::Omlx,
        "http://127.0.0.1:8000/v1",
    ),
    local(
        "mlx",
        "MLX",
        Some("mlx.png"),
        false,
        Driver::Mlx,
        "http://127.0.0.1:8080/v1",
    ),
    local(
        "llama-cpp",
        "llama.cpp",
        Some("llamacpp.svg"),
        true,
        Driver::LlamaCpp,
        "http://127.0.0.1:8080/v1",
    ),
    local(
        "vllm",
        "vLLM",
        Some("vllm-color.svg"),
        false,
        Driver::Vllm,
        "http://127.0.0.1:8000/v1",
    ),
    local(
        "jan",
        "Jan",
        Some("jan.png"),
        false,
        Driver::Jan,
        "http://127.0.0.1:1337/v1",
    ),
    local(
        "local-ai",
        "LocalAI",
        Some("localai.png"),
        false,
        Driver::LocalAi,
        "http://127.0.0.1:8080/v1",
    ),
    local(
        "unsloth",
        "Unsloth",
        Some("unsloth.png"),
        false,
        Driver::Unsloth,
        "http://127.0.0.1:8000/v1",
    ),
    local(
        "openai-compatible-local",
        "OpenAI-compatible",
        None,
        false,
        Driver::OpenaiCompatible,
        "",
    ),
];

/// Every registered provider.
pub fn all() -> impl Iterator<Item = &'static Provider> {
    API_PROVIDERS
        .iter()
        .chain(ACCOUNT_PROVIDERS)
        .chain(LOCAL_PROVIDERS)
}

/// The provider saved as `id`.
pub fn get(id: &str) -> Option<&'static Provider> {
    all().find(|p| p.id == id)
}

/// The local service a driver names.
pub fn local_for(driver: Driver) -> Option<&'static Provider> {
    LOCAL_PROVIDERS.iter().find(|p| p.driver == driver)
}

/// The provider that offers `oauth`.
pub fn for_oauth(oauth: OauthProvider) -> Option<&'static Provider> {
    all().find(|p| p.oauth.is_some_and(|(o, _, _)| o == oauth))
}

/// The provider a saved connection belongs to: its explicit `provider`, its
/// OAuth provider, else the local service its driver names.
pub fn of(
    provider: Option<&str>,
    oauth: Option<OauthProvider>,
    driver: Driver,
) -> Option<&'static Provider> {
    provider
        .and_then(get)
        .or_else(|| oauth.and_then(for_oauth))
        .or_else(|| local_for(driver).filter(|p| p.driver != Driver::OpenaiCompatible))
}

/// The model to make default from a catalog: the provider's recommendation
/// first, else the first model that `usable` accepts.
pub fn pick_default<'a>(
    provider: Option<&Provider>,
    models: impl IntoIterator<Item = &'a str> + Clone,
    usable: impl Fn(&str) -> bool,
) -> Option<String> {
    if let Some(provider) = provider {
        for wanted in provider.recommended {
            if models.clone().into_iter().any(|m| m == *wanted) {
                return Some((*wanted).to_owned());
            }
        }
    }
    models.into_iter().find(|m| usable(m)).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_identities_are_unique_and_marks_exist() {
        let mut ids = std::collections::HashSet::new();
        for provider in all() {
            assert!(ids.insert(provider.id), "duplicate {}", provider.id);
            if let Some(mark) = provider.mark {
                let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../assets/providers")
                    .join(mark);
                assert!(
                    path.exists(),
                    "{} has no mark at {}",
                    provider.id,
                    path.display()
                );
            }
            if !provider.base_url.is_empty() {
                assert!(
                    super::super::configuration::normalize_endpoint(
                        provider.base_url,
                        provider.driver
                    )
                    .is_ok(),
                    "{} base URL is not accepted",
                    provider.id
                );
            }
            assert!(provider.context >= 1024, "{}", provider.id);
        }
    }

    #[test]
    fn every_oauth_provider_has_one_home() {
        for oauth in OauthProvider::ALL {
            let provider = for_oauth(oauth).expect("registered");
            assert_eq!(provider.default_auth() == Auth::Oauth, !provider.api_key);
        }
    }

    #[test]
    fn saved_connections_resolve_to_their_provider() {
        assert_eq!(
            of(Some("deepseek"), None, Driver::OpenaiCompatible)
                .unwrap()
                .id,
            "deepseek"
        );
        assert_eq!(
            of(None, Some(OauthProvider::Chatgpt), Driver::Chatgpt)
                .unwrap()
                .id,
            "chatgpt"
        );
        assert_eq!(of(None, None, Driver::Ollama).unwrap().id, "ollama");
        // A legacy API connection names no provider.
        assert!(of(None, None, Driver::OpenaiCompatible).is_none());
    }

    #[test]
    fn the_default_model_prefers_the_recommendation_then_usable_models() {
        let openai = get("openai");
        let models = ["o3", "gpt-4.1", "gpt-5.4"];
        assert_eq!(
            pick_default(openai, models.iter().copied(), |_| true).as_deref(),
            Some("gpt-5.4")
        );
        assert_eq!(
            pick_default(None, models.iter().copied(), |m| m.starts_with("gpt")).as_deref(),
            Some("gpt-4.1")
        );
        assert_eq!(pick_default(None, [].iter().copied(), |_| true), None);
    }
}
