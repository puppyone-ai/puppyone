/** Product-facing local import capabilities. Execution is still validated in main. */
export const LOCAL_IMPORT_SOURCES = Object.freeze([
  Object.freeze({ id: "github", mode: "repository", availability: "ready", preview: true }),
  Object.freeze({ id: "gitlab", mode: "repository", availability: "ready", preview: true }),
  Object.freeze({ id: "notion", mode: "folder", availability: "experimental", preview: true, stepCount: 3 }),
  Object.freeze({ id: "google-drive", mode: "folder", availability: "experimental", preview: true, stepCount: 3 }),
  Object.freeze({ id: "obsidian", mode: "folder", availability: "experimental", preview: true, stepCount: 2 }),
  Object.freeze({ id: "airtable", mode: "folder", availability: "experimental", preview: true, stepCount: 3 }),
]);

export function getLocalImportSource(id) {
  return LOCAL_IMPORT_SOURCES.find((source) => source.id === id) ?? null;
}
