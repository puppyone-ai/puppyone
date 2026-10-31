/** Derive a portable source reference; capability URLs never enter the saved HTML. */
export function imageSourceReference(documentPath: string, assetPath: string, sourceBase: string | null): string {
  const origin = "https://workspace.invalid";
  const documentUrl = new URL(documentPath.split("/").map(encodeURIComponent).join("/"), `${origin}/`);
  const base = sourceBase ? new URL(sourceBase, documentUrl) : documentUrl;
  const directory = documentUrl.pathname.slice(0, documentUrl.pathname.lastIndexOf("/") + 1);
  if (base.origin !== origin || base.search || base.hash || sourceBase?.startsWith("/")
    || !base.pathname.startsWith(directory)) throw new Error("unsupported-base");
  const baseParts = base.pathname.split("/").slice(1, -1);
  const targetParts = assetPath.split("/").map(encodeURIComponent);
  while (baseParts.length && targetParts.length && baseParts[0] === targetParts[0]) {
    baseParts.shift(); targetParts.shift();
  }
  return [...baseParts.map(() => ".."), ...targetParts].join("/");
}
