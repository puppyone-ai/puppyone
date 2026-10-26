// Supabase owns credentials, PKCE exchange and session lifecycle. Main is the
// only consumer of this adapter; never expose it through the renderer bridge.
export function createSupabaseAuthClient({ requestCloudApi, fetchImpl = globalThis.fetch }) {
  const configurations = new Map();
  async function configuration(apiBase) {
    if (!configurations.has(apiBase)) {
      const pending = requestCloudApi(apiBase, "/auth/config", { method: "GET" }).then(value => {
        const url = new URL(value?.supabase_url);
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
          throw new Error("Supabase authentication origin is invalid.");
        const key = value?.supabase_anon_key;
        let publicKey = typeof key === "string" && key.startsWith("sb_publishable_");
        try { publicKey ||= JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch { /* public key check below */ }
        if (!publicKey) throw new Error("Supabase public authentication key is invalid.");
        return { origin: url.origin, key };
      });
      configurations.set(apiBase, pending);
      pending.catch(() => configurations.delete(apiBase));
    }
    return configurations.get(apiBase);
  }
  async function request(apiBase, path, { body, token, signal } = {}) {
    const { origin, key } = await configuration(apiBase);
    const response = await fetchImpl(`${origin}/auth/v1${path}`, {
      method: body === undefined && !token ? "GET" : "POST",
      headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      // Never echo upstream bodies, which can contain credentials or URLs.
      let message = "Sign-in credentials are invalid or expired.";
      if (response.status === 429) message = "Too many sign-in attempts. Please try again later.";
      else if (response.status >= 500) message = "Supabase authentication is temporarily unavailable.";
      throw Object.assign(new Error(message), { status: response.status, code: data?.error_code });
    }
    return data;
  }
  return {
    configuration,
    async providers(apiBase) {
      const data = await request(apiBase, "/settings");
      return ["email", "google", "github"].filter(name => data?.external?.[name] === true);
    },
    async authorize(apiBase, provider, redirect, challenge) {
      if (!["google", "github"].includes(provider)) throw new Error("Unsupported sign-in provider.");
      const { origin } = await configuration(apiBase);
      const url = new URL(`${origin}/auth/v1/authorize`);
      url.search = new URLSearchParams({ provider, redirect_to: redirect, code_challenge: challenge, code_challenge_method: "s256" }).toString();
      return url.toString();
    },
    exchange: (apiBase, code, verifier) => request(apiBase, "/token?grant_type=pkce", { body: { auth_code: code, code_verifier: verifier } }),
    refresh: (apiBase, refreshToken, signal) => request(apiBase, "/token?grant_type=refresh_token", { body: { refresh_token: refreshToken }, signal }),
    logout: (apiBase, token, signal) => request(apiBase, "/logout?scope=local", { token, signal }),
  };
}
