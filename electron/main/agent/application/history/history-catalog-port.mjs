/** Only metadata operations are granted to History query handlers. */
export function createHistoryCatalogPort(catalog) {
  const call = (method, args) => {
    if (typeof catalog?.[method] !== "function") throw new Error("History catalog is unavailable.");
    return catalog[method](...args);
  };
  return Object.freeze({
    ...(typeof catalog?.listPage === "function" ? { listPage: (...args) => call("listPage", args) } : {}),
    list: (...args) => call("list", args),
    getRevision: () => call("getRevision", []),
    getCoverage: () => call("getCoverage", []),
    applyNativePage: (page) => call("applyNativePage", [page]),
  });
}
