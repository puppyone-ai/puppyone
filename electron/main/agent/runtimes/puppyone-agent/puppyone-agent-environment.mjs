import path from "node:path";

const EXACT_ENVIRONMENT_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP",
  "LANG", "TERM", "COLORTERM", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE",
]);

// Pinned to the built-in provider contract of the adopted Pi SDK. Arbitrary
// *_API_KEY-style variables are deliberately excluded: custom providers must
// be configured through PuppyOne's managed auth/models files instead of
// inheriting unrelated application secrets.
export const PUPPYONE_PROVIDER_ENVIRONMENT_KEYS = Object.freeze([
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN",
  "ANT_LING_API_KEY",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE",
  "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME",
  "AWS_ENDPOINT_URL_BEDROCK_RUNTIME", "AWS_BEDROCK_SKIP_AUTH",
  "AWS_BEDROCK_FORCE_HTTP1", "AWS_BEDROCK_FORCE_CACHE",
  "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_RESOURCE_NAME", "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
  "BASETEN_API_KEY", "CEREBRAS_API_KEY",
  "CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID",
  "COPILOT_GITHUB_TOKEN", "DEEPSEEK_API_KEY", "FIREWORKS_API_KEY",
  "GCLOUD_PROJECT", "GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_API_KEY", "GOOGLE_CLOUD_LOCATION", "GOOGLE_CLOUD_PROJECT",
  "GROQ_API_KEY", "HF_TOKEN", "KIMI_API_KEY", "MINIMAX_API_KEY", "MINIMAX_CN_API_KEY",
  "MISTRAL_API_KEY", "MOONSHOT_API_KEY", "NVIDIA_API_KEY", "OPENAI_API_KEY",
  "OPENCODE_API_KEY", "OPENROUTER_API_KEY",
  "QWEN_TOKEN_PLAN_API_KEY", "QWEN_TOKEN_PLAN_CN_API_KEY", "RADIUS_API_KEY",
  "TOGETHER_API_KEY", "XAI_API_KEY", "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY", "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY", "ZAI_API_KEY", "ZAI_CODING_CN_API_KEY",
]);

const PROVIDER_ENVIRONMENT_KEYS = new Set(PUPPYONE_PROVIDER_ENVIRONMENT_KEYS);

/** Build the narrow environment inherited by the product-owned Pi SDK worker. */
export function buildPuppyOneAgentEnvironment(baseEnv, { profilePath, platform = process.platform } = {}) {
  if (typeof profilePath !== "string" || !path.isAbsolute(profilePath)) {
    throw new TypeError("PuppyOne Agent requires an absolute managed profile path.");
  }
  const environment = {};
  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (typeof value !== "string") continue;
    if (
      EXACT_ENVIRONMENT_KEYS.has(key)
      || key.startsWith("LC_")
      || PROVIDER_ENVIRONMENT_KEYS.has(key)
    ) environment[key] = value;
  }
  environment.TERM = "dumb";
  environment.PUPPYONE_AGENT = "1";
  environment.PUPPYONE_AGENT_HOME = path.resolve(profilePath);
  environment.PI_CODING_AGENT_DIR = path.join(environment.PUPPYONE_AGENT_HOME, "pi");
  environment.PI_CODING_AGENT_SESSION_DIR = path.join(environment.PUPPYONE_AGENT_HOME, "sessions");
  environment.ELECTRON_RUN_AS_NODE = "1";
  if (platform === "win32") environment.PATHEXT = baseEnv?.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return environment;
}

/** Provider credentials are available to ModelRuntime, never to model-callable shell subprocesses. */
export function stripPuppyOneProviderCredentials(environment) {
  const sanitized = { ...(environment ?? {}) };
  for (const key of PROVIDER_ENVIRONMENT_KEYS) delete sanitized[key];
  return sanitized;
}
