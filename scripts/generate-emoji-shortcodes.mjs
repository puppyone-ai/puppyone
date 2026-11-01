#!/usr/bin/env node
// Refreshes the shortcode table from GitHub's public list. Entries without a
// Unicode code point, such as :octocat:, are images and are left out.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL(
  "../src/shared-ui/editor/markdown/features/inline-syntax/emojiShortcodes.generated.json",
  import.meta.url,
));
const listing = JSON.parse(execFileSync("gh", ["api", "emojis"], { encoding: "utf8", maxBuffer: 1 << 24 }));
const table = {};
for (const name of Object.keys(listing).sort()) {
  const codePoints = /\/unicode\/([0-9a-f-]+)\.png/.exec(listing[name])?.[1];
  if (codePoints) table[name] = String.fromCodePoint(...codePoints.split("-").map((value) => Number.parseInt(value, 16)));
}
writeFileSync(target, `${JSON.stringify(table)}\n`);
console.log(`${Object.keys(table).length} shortcodes`);
