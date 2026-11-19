import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Ship the SDK's versioned fonts without runtime network dependencies. */
export function excalidrawAssetsPlugin() {
  const root = fileURLToPath(new URL("../../../node_modules/@excalidraw/excalidraw/dist/prod/", import.meta.url));
  const files = readdirSync(path.join(root, "fonts"), { recursive: true })
    .filter((name) => /\.(woff2?|ttf|txt)$/i.test(name))
    .map((name) => `fonts/${name.split(path.sep).join("/")}`);
  const allowed = new Set(files);
  return {
    name: "puppyone-excalidraw-assets",
    // The SDK unconditionally adds a CDN fallback even with EXCALIDRAW_ASSET_PATH.
    // Keep that fallback inside the packaged app as well (pinned SDK 0.18.1).
    transform(code, id) {
      if (!id.includes("/@excalidraw/excalidraw/dist/") || !id.endsWith(".js")) return null;
      return code.replace(/`https:\/\/esm\.sh\/\$\{[^;\n]+?\/dist\/prod\/`/g,
        'new URL("assets/excalidraw/", document.baseURI).href')
        // SDK 0.18.1 destroys Scene before removing the WYSIWYG textarea. Its blur
        // cleanup then unsubscribes an already-cleared listener. Make only that
        // unsubscribe idempotent so file switches/external replacements can retire it.
        .replace(/\(\)\s*=>\s*\{\s*if\s*\(!this\.callbacks\.has\((\w+)\)\)\s*\{?\s*throw (?:new )?Error(?:\(\))?;?\s*\}?\s*this\.callbacks\.delete\(\1\)/g,
          "() => { this.callbacks.delete($1)");
    },
    configureServer(server) {
      server.middlewares.use("/assets/excalidraw/", (request, response, next) => {
        const file = request.url?.split("?", 1)[0]?.replace(/^\//, "");
        if (!allowed.has(file)) return next();
        response.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream");
        response.end(readFileSync(path.join(root, file)));
      });
    },
    generateBundle() {
      for (const file of files) this.emitFile({ type: "asset", fileName: `assets/excalidraw/${file}`, source: readFileSync(path.join(root, file)) });
    },
  };
}
