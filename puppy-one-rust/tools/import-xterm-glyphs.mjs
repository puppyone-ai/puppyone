#!/usr/bin/env node
// Imports xterm's custom glyph definitions (`customGlyphs: true` in the
// product terminal) from the product's @xterm/addon-webgl bundle into
// assets/terminal-glyphs.json, so the native terminal draws box drawing,
// block elements, shade patterns and Powerline symbols to the same cell
// geometry instead of the font's glyphs.
//
// Paths are xterm's unit-square instructions. Definitions that are
// functions of xterm's two stroke parameters (`e` = .15 and
// `t` = .15 / cellHeight * cellWidth) are stored as linear coefficients
// [a, b, c] meaning a + b*e + c*t, verified at a fourth point.
//
//   node tools/import-xterm-glyphs.mjs           regenerate
//   node tools/import-xterm-glyphs.mjs --check   fail if the asset drifted
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = JSON.parse(fs.readFileSync(path.join(root, "product-source.json"), "utf8"));
const product = path.resolve(root, source.checkout);
const addon = path.join(product, "node_modules/@xterm/addon-webgl");
const bundlePath = path.join(addon, "lib/addon-webgl.js");
const output = path.join(root, "assets/terminal-glyphs.json");

const bundle = fs.readFileSync(bundlePath, "utf8");

/** The balanced object literal that starts at the first `{` after `at`. */
function literalAt(at) {
  if (at < 0) throw new Error("definition not found in the xterm bundle");
  const start = bundle.indexOf("{", at);
  let depth = 0;
  for (let i = start; i < bundle.length; i++) {
    const c = bundle[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return bundle.slice(start, i + 1);
    else if (c === '"' || c === "`") {
      for (i++; bundle[i] !== c; i++) if (bundle[i] === "\\") i++;
    }
  }
  throw new Error("unbalanced definition literal");
}
const evaluate = (literal) => (0, eval)(`(${literal})`);
const definition = (name) => evaluate(literalAt(bundle.indexOf(`t.${name}={`)));

const blocks = definition("blockElementDefinitions");
const boxes = definition("boxDrawingDefinitions");
const powerline = definition("powerlineDefinitions");
const patterns = evaluate(literalAt(bundle.lastIndexOf("{", bundle.indexOf('"░":[['))));
// Aliases assigned after the literals (`t.powerlineDefinitions["…"]=t.powerlineDefinitions["…"]`).
for (const m of bundle.matchAll(/t\.powerlineDefinitions\["([^"]+)"\]=t\.powerlineDefinitions\["([^"]+)"\]/g)) {
  const [alias, target] = [JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`)];
  powerline[alias] = powerline[target];
}

/** `M.5,1 L1,.5` → [["M", [x, y]], …] with constant numbers. */
function parse(d) {
  return d.split(" ").filter(Boolean).map((token) => [
    token[0],
    token.slice(1).split(",").map((n) => parseFloat(n) || parseInt(n, 10) || 0),
  ]);
}

/** A path as linear coefficients of (e, t). */
function linear(value) {
  if (typeof value === "string") {
    return parse(value).map(([cmd, ns]) => [cmd, ns.map((n) => [n, 0, 0])]);
  }
  const at = (e, t) => parse(value(e, t));
  const [base, de, dt, probe] = [at(0, 0), at(1, 0), at(0, 1), at(0.15, 0.2)];
  return base.map(([cmd, ns], i) => {
    if (de[i][0] !== cmd || dt[i][0] !== cmd || ns.length !== de[i][1].length) {
      throw new Error(`non-linear path structure: ${value}`);
    }
    return [cmd, ns.map((n, j) => {
      const coefficients = [n, de[i][1][j] - n, dt[i][1][j] - n];
      const expected = coefficients[0] + coefficients[1] * 0.15 + coefficients[2] * 0.2;
      if (Math.abs(expected - probe[i][1][j]) > 1e-9) throw new Error(`non-linear coordinate: ${value}`);
      return coefficients.map((c) => Math.round(c * 1e9) / 1e9);
    })];
  });
}

const sorted = (object, map) => Object.fromEntries(
  Object.keys(object).sort().map((key) => [key, map(object[key])]),
);
const asset = {
  source: {
    package: "@xterm/addon-webgl",
    version: JSON.parse(fs.readFileSync(path.join(addon, "package.json"), "utf8")).version,
    sha256: crypto.createHash("sha256").update(bundle).digest("hex"),
  },
  // Eighths of the cell: [x, y, w, h].
  blocks: sorted(blocks, (rects) => rects.map(({ x, y, w, h }) => [x, y, w, h])),
  // Device-pixel tiles of 0/1.
  patterns: sorted(patterns, (rows) => rows),
  // Stroke weight (device pixels per CSS pixel) → linear path.
  boxes: sorted(boxes, (weights) => Object.entries(weights).map(([weight, d]) => ({
    weight: Number.parseInt(weight, 10),
    path: linear(d),
  }))),
  // type 1 strokes, otherwise fills; paddings in twelfths of the font size.
  powerline: sorted(powerline, (p) => ({
    type: p.type ?? 0,
    left: p.leftPadding ?? 0,
    right: p.rightPadding ?? 0,
    path: parse(p.d),
  })),
};
const text = `${JSON.stringify(asset)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
  if (current !== text) {
    console.error(`${path.relative(root, output)} drifted from ${asset.source.package} ${asset.source.version}; run node tools/import-xterm-glyphs.mjs`);
    process.exit(1);
  }
  console.log(`terminal glyphs match ${asset.source.package} ${asset.source.version}`);
} else {
  fs.writeFileSync(output, text);
  console.log(`wrote ${path.relative(root, output)}: ${Object.keys(asset.blocks).length} blocks, ${Object.keys(asset.patterns).length} patterns, ${Object.keys(asset.boxes).length} box glyphs, ${Object.keys(asset.powerline).length} powerline glyphs`);
}
