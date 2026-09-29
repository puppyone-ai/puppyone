import { LOCAL_IMPORT_SOURCES } from "../../../shared/project-import/sources.mjs";

/** One registration boundary for import metadata and executable providers. */
export function createImportSourceRegistry({ descriptors = LOCAL_IMPORT_SOURCES, adapters = {}, loadAdapter = null } = {}) {
  const manifest = Object.freeze(descriptors.map((descriptor) => Object.freeze({ ...descriptor })));
  const entries = new Map();
  const loading = new Map();
  for (const descriptor of manifest) {
    if (!/^[a-z][a-z0-9-]*$/.test(descriptor?.id ?? "") || entries.has(descriptor.id)) {
      throw new Error("Duplicate or invalid import source.");
    }
    const adapter = adapters[descriptor.id] ?? null;
    if (descriptor.operational && !adapter && !loadAdapter) {
      throw new Error(`Operational import source ${descriptor.id} needs a matching adapter.`);
    }
    if (adapter) validateAdapter(descriptor, adapter);
    entries.set(descriptor.id, { descriptor, adapter });
  }
  for (const id of Object.keys(adapters)) {
    if (!entries.has(id)) throw new Error(`Import adapter ${id} has no source descriptor.`);
  }
  return Object.freeze({
    list: () => manifest,
    get: (id) => entries.get(id)?.descriptor ?? null,
    async require(id) {
      const entry = entries.get(id);
      if (!entry?.descriptor.operational) {
        const error = new Error("This import source is not available yet.");
        error.code = "IMPORT_SOURCE_UNAVAILABLE";
        throw error;
      }
      if (!entry.adapter) {
        if (!loading.has(id)) {
          loading.set(id, Promise.resolve().then(() => loadAdapter(id)).then((adapter) => {
            validateAdapter(entry.descriptor, adapter);
            entry.adapter = adapter;
            return adapter;
          }).finally(() => loading.delete(id)));
        }
        await loading.get(id);
      }
      return Object.freeze({ descriptor: entry.descriptor, adapter: entry.adapter });
    },
  });
}

function validateAdapter(descriptor, adapter) {
  if (!adapter || adapter.mode !== descriptor.mode
    || typeof adapter.inspect !== "function" || typeof adapter.materialize !== "function"
    || (descriptor.mode === "remote" && (typeof adapter.connect !== "function" || typeof adapter.listResources !== "function"))) {
    throw new Error(`Import source ${descriptor.id} needs a compatible adapter.`);
  }
}
