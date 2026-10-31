import type { LocaleCatalog } from "./types";

export type CatalogNamespaceMap = Readonly<Record<string, Readonly<Record<string, string>>>>;

export function mergeCatalogNamespaces(namespaces: CatalogNamespaceMap): LocaleCatalog {
  const catalog: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [namespace, messages] of Object.entries(namespaces)) {
    for (const [key, message] of Object.entries(messages)) {
      const id = `${namespace}.${key}`;
      if (Object.hasOwn(catalog, id)) throw new Error(`Duplicate localization message: ${id}`);
      if (typeof message !== "string" || !message.length) {
        throw new Error(`Localization message ${id} must be a non-empty string.`);
      }
      catalog[id] = message;
    }
  }
  return Object.freeze(catalog);
}
