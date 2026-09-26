/** One serializable registration manifest shared by Renderer and Main. */
export const LOCAL_IMPORT_SOURCES = Object.freeze([
  Object.freeze({ id: "github", label: "GitHub", mode: "repository", availability: "ready", operational: true, preview: true }),
  Object.freeze({ id: "gitlab", label: "GitLab", mode: "repository", availability: "ready", operational: true, preview: true }),
  Object.freeze({ id: "notion", label: "Notion", mode: "remote", availability: "experimental", operational: false, preview: true }),
  Object.freeze({ id: "google-drive", label: "Google Drive", mode: "remote", availability: "experimental", operational: false, preview: true }),
  Object.freeze({ id: "obsidian", label: "Obsidian", mode: "folder", availability: "experimental", operational: true, preview: true, stepCount: 2 }),
  Object.freeze({ id: "airtable", label: "Airtable", mode: "remote", availability: "experimental", operational: false, preview: true }),
]);
