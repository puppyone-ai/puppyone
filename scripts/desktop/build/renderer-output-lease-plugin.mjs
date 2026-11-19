import path from "node:path";
import { acquireRendererOutputLease } from "../../../electron/main/renderer-output-lease.mjs";

/** Run before Vite can empty its output directory, including direct vite build. */
export function rendererOutputLeasePlugin() {
  let outputDirectory;
  let release;
  const dispose = () => {
    release?.();
    release = undefined;
  };
  return {
    name: "puppyone-renderer-output-lease",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    buildStart() {
      release ??= acquireRendererOutputLease({ outputDirectory, mode: "build" });
    },
    buildEnd(error) {
      if (error) dispose();
    },
    closeBundle: dispose,
  };
}
