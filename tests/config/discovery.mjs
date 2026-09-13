// Both Vitest and the repository layout check consume this contract.
export const testLayers = ["unit", "component", "integration", "architecture"];
export const testDomains = [
  "agent", "appearance", "automation", "cloud", "editor", "extensions",
  "localization", "platform", "release", "settings", "source-control",
  "telemetry", "terminal", "ui-primitives", "updates", "workbench", "workspace",
];
export const testExtensions = ["ts", "tsx", "mjs"];
export const benchmarkExtensions = ["ts"];
export const testInclude = [`tests/{${testLayers.join(",")}}/**/*.test.{${testExtensions.join(",")}}`];
export const benchmarkInclude = [`tests/performance/benchmarks/**/*.bench.${benchmarkExtensions[0]}`];

/** @param {string} file */
export function isRuntimeTest(file) {
  const parts = file.split("/");
  return parts[0] === "tests" && testLayers.includes(parts[1])
    && testExtensions.some((extension) => file.endsWith(`.test.${extension}`));
}

/** @param {string} file */
export function isBenchmark(file) {
  return file.startsWith("tests/performance/benchmarks/")
    && benchmarkExtensions.some((extension) => file.endsWith(`.bench.${extension}`));
}
