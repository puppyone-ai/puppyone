// Official cursor.com/install archive URLs, downloaded and hashed 2026-09-20.
const digests = {
  arm64: "4e67b9ac80cc4a56e0a91b3b437894e0ba489ef7ec37f120d8084d2bfd02095d",
  x64: "f4298af7114a57ce317ddc13a49c273e1113b027e3e6b7a0769b8ef3565e6897",
};
export function cursorActivationRecipe(platform, arch) {
  if (platform !== "darwin" || !Object.hasOwn(digests, arch)) return null;
  return Object.freeze({ setupId: "cursor", version: "2026.09.18-9a7762b", entry: "cursor-agent", binary: "cursor-agent",
    artifact: Object.freeze({ url: `https://downloads.cursor.com/lab/2026.09.18-9a7762b/darwin/${arch}/agent-cli-package.tar.gz`,
      algorithm: "sha256", digest: Buffer.from(digests[arch], "hex").toString("base64") }) });
}
