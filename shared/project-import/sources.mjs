/** Product-facing local import capabilities. Execution is still validated in main. */
export const LOCAL_IMPORT_SOURCES = Object.freeze([
  Object.freeze({ id: "github", mode: "repository", availability: "ready", operational: true, preview: true }),
  Object.freeze({ id: "gitlab", mode: "repository", availability: "ready", operational: true, preview: true }),
  Object.freeze({ id: "notion", mode: "remote", availability: "experimental", operational: false, preview: true }),
  Object.freeze({ id: "google-drive", mode: "remote", availability: "experimental", operational: false, preview: true }),
  Object.freeze({ id: "obsidian", mode: "folder", availability: "experimental", operational: true, preview: true, stepCount: 2 }),
  Object.freeze({ id: "airtable", mode: "remote", availability: "experimental", operational: false, preview: true }),
]);

export function getLocalImportSource(id) {
  return LOCAL_IMPORT_SOURCES.find((source) => source.id === id) ?? null;
}
