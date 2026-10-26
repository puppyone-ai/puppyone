const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

// Domain discovery supports both today's src/features/* and the accepted
// src/<domain> layout. Technical buckets are not domains.
const directories = (path) => existsSync(join(__dirname, path))
  ? readdirSync(join(__dirname, path), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => `${path}/${entry.name}`)
  : [];
const technical = new Set(["app", "features", "components", "hooks", "lib", "types", "styles", "assets"]);
const domains = [
  ...directories("src/features"),
  ...directories("src").filter((path) => !technical.has(path.split("/").at(-1))),
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const domainPaths = domains.map(escape);

module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    // Unresolved aliases must not bypass the directional rules. Existing
    // unresolved imports are individual baseline entries, never a wildcard.
    { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
    {
      name: "composition-root-only",
      severity: "error",
      from: { path: "^src/[^/]+/", pathNot: "^src/(?:features/app-shell|app)/" },
      to: { path: "^src/(?:features/app-shell|app)/" },
    },
    {
      name: "lib-does-not-import-domains",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: `^(?:src/features|src/app|${domainPaths.join("|")})/` },
    },
    {
      name: "packages-do-not-import-applications",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^(?:src|electron)/" },
    },
    ...domains.map((domain) => ({
      name: `public-domain-entry-${domain.replaceAll("/", "-")}`,
      severity: "error",
      from: { path: `^${escape(domain)}/` },
      to: {
        path: `^(?:${domainPaths.filter((path) => path !== escape(domain)).join("|")})/`,
        pathNot: `^(?:${domainPaths.join("|")})/index\\.[cm]?[jt]sx?$`,
      },
    })),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(?:^|/)(?:node_modules|artifacts|vendor|dist)/|\\.d\\.ts$" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
