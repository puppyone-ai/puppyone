// Official npm platform artifacts; integrity reviewed 2026-09-20. No npm scripts.
const digests = {
  arm64: "cYxzGcRRoBrncyHlR8ed4yXwcoVJZC1pipGULSyJkGFKXJw/Uu57BklvzayuAptjJIipamnOk32CfUkk1F0bLw==",
  x64: "FDpc+PdELYlyDnhd76Ckm6jNLF+1n3x34Ygd4QLQger810Vkxx/InQ5LY5jwkecJYKcbvyhMmuxTspaj1dLZrA==",
};
export function codexActivationRecipe(platform, arch) {
  if (platform !== "darwin" || !Object.hasOwn(digests, arch)) return null;
  return Object.freeze({ setupId: "codex", version: "0.155.1", entry: "codex",
    binary: `vendor/${arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin/bin/codex`,
    artifact: Object.freeze({ url: `https://registry.npmjs.org/@openai/codex/-/codex-0.155.1-darwin-${arch}.tgz`,
      algorithm: "sha512", digest: digests[arch] }) });
}
