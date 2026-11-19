/** Formats a File Mode window can show. */
const FILE_MODE_FORMATS = Object.freeze(["markdown", "csv"]);
// The HTML format also covers server templates, which do not preview on their own.
const FILE_MODE_HTML_EXTENSIONS = Object.freeze([".html", ".htm"]);

/** The largest file the editor opens. */
export const MAX_EDITOR_BYTES = 1024 * 1024;

/**
 * Every extension File Mode opens, from the file format registry. One list
 * decides File Mode, the CLI declaration in Info.plist, and the protocol.
 */
export function createFileModeExtensions(registry) {
  const extensions = new Set(FILE_MODE_HTML_EXTENSIONS);
  for (const format of registry?.formats ?? []) {
    if (!FILE_MODE_FORMATS.includes(format?.id)) continue;
    for (const extension of format.extensions ?? []) {
      if (typeof extension === "string" && extension.startsWith(".")) extensions.add(extension.toLowerCase());
    }
  }
  // `.agent.md` adds nothing once `.md` is listed.
  const covered = (extension) => [...extensions].some((other) => other !== extension && extension.endsWith(other));
  return Object.freeze([...extensions].filter((extension) => !covered(extension)).sort());
}

export function hasFileModeExtension(name, extensions) {
  const lowerName = String(name ?? "").toLowerCase();
  return extensions.some((extension) => lowerName.length > extension.length && lowerName.endsWith(extension));
}
