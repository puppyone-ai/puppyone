/**
 * Convert a scope name / path into a CLI-friendly profile slug.
 *
 * `puppyone ap login <slug>` keeps a per-scope credential locally; the
 * slug needs to be filename-safe and lowercased. Empty strings fall
 * back to `folder` so we never feed the CLI an empty profile name.
 */
export function profileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '') || 'folder'
  );
}
