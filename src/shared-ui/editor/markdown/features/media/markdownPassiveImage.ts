/**
 * Shared browser-sink behavior for broker-authorized Markdown images.
 * Resource policy stays in AssetBroker; this module owns only passive image
 * loading/privacy attributes used by native Markdown and sanitized HTML.
 */
export function prepareBrokeredMarkdownImage(
  image: HTMLImageElement,
  authorizedUrlOrSrcset: string,
) {
  image.loading = image.loading === "eager" ? "eager" : "lazy";
  image.decoding = "async";

  if (containsRemoteHttpsImage(authorizedUrlOrSrcset)) {
    image.referrerPolicy = "no-referrer";
    image.crossOrigin = "anonymous";
  }
}

function containsRemoteHttpsImage(value: string): boolean {
  return /(?:^|[\s,])https:\/\//i.test(value.trim());
}
