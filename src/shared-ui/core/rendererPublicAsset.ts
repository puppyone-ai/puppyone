/**
 * Resolves an asset copied from `public/` against Vite's renderer base.
 *
 * Desktop production uses a relative base because Electron loads the renderer
 * from `app.asar/dist/index.html`. Root-relative URLs would instead resolve to
 * the filesystem root (for example, `file:///assets/icons/...`).
 */
export function resolveRendererPublicAssetUrl(
  assetPath: string,
  baseUrl = import.meta.env.BASE_URL,
): string {
  const segments = assetPath.split("/");
  const hasUnsafeSegment = segments.some((segment) => (
    segment === "" || segment === "." || segment === ".."
  ));

  if (
    assetPath.startsWith("/")
    || assetPath.includes("\\")
    || assetPath.includes("?")
    || assetPath.includes("#")
    || /^[a-z][a-z\d+.-]*:/i.test(assetPath)
    || hasUnsafeSegment
  ) {
    throw new Error(`Renderer public asset paths must be safe repository-relative paths: ${assetPath}`);
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}${assetPath}`;
}
