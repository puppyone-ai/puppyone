/** One serializable registration manifest shared by Renderer and Main. */
export const LOCAL_IMPORT_SOURCES = Object.freeze([
  Object.freeze({ id: "github", label: "GitHub", mode: "repository", availability: "ready", operational: true, preview: true }),
  Object.freeze({ id: "gitlab", label: "GitLab", mode: "repository", availability: "ready", operational: true, preview: true }),
  Object.freeze({ id: "notion", label: "Notion", mode: "remote", availability: "experimental", operational: false, preview: true }),
  Object.freeze({ id: "google-drive", label: "Google Drive", mode: "remote", availability: "experimental", operational: false, preview: true }),
  // "app" sources are folders another app already records; they are listed in place, never copied.
  Object.freeze({ id: "obsidian", label: "Obsidian", mode: "app", availability: "experimental", operational: true, preview: true }),
  Object.freeze({ id: "vscode", label: "VS Code", mode: "app", availability: "experimental", operational: true, preview: false }),
  Object.freeze({ id: "cursor", label: "Cursor", mode: "app", availability: "experimental", operational: true, preview: false }),
  Object.freeze({ id: "typora", label: "Typora", mode: "app", availability: "experimental", operational: true, preview: false }),
  Object.freeze({ id: "airtable", label: "Airtable", mode: "remote", availability: "experimental", operational: false, preview: true }),
]);
