#!/usr/bin/env node
// Regenerates the README download cards from the published release catalogs.
// GitHub READMEs cannot run code, so the cards are static SVGs: run this after
// each Stable release to refresh the version and date they show.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/readme",
);

const PLATFORMS = [
  {
    id: "macos",
    label: "macOS",
    iconTransform: "translate(9.6 10.6) scale(0.95)",
    catalogUrl: "https://downloads.puppyone.ai/desktop/catalog/releases.json",
    iconPath:
      "M16.71 12.37c.02-2.08 1.7-3.08 1.78-3.13a3.83 3.83 0 0 0-3.02-1.64c-1.27-.13-2.51.76-3.16.76-.67 0-1.68-.75-2.77-.73a4.01 4.01 0 0 0-3.38 2.06c-1.46 2.53-.37 6.25 1.03 8.3.7 1 1.52 2.12 2.6 2.08 1.05-.04 1.45-.67 2.72-.67 1.26 0 1.64.67 2.74.65 1.14-.02 1.86-1 2.53-2.02a8.3 8.3 0 0 0 1.16-2.36 3.6 3.6 0 0 1-2.23-3.3Zm-2.07-6.12a3.66 3.66 0 0 0 .84-2.62 3.72 3.72 0 0 0-2.41 1.25 3.5 3.5 0 0 0-.86 2.52 3.08 3.08 0 0 0 2.43-1.15Z",
  },
  {
    id: "windows",
    label: "Windows",
    iconTransform: "translate(12 13) scale(0.75)",
    catalogUrl:
      "https://downloads.puppyone.ai/desktop/stable/windows/x64/nsis/releases.json",
    iconPath:
      "M3 4.55 10.53 3.5v7.78H3V4.55Zm8.47-1.19L21 2v9.28h-9.53V3.36ZM3 12.22h7.53V20L3 18.95v-6.73Zm8.47 0H21V21l-9.53-1.36v-7.42Z",
  },
];

const THEMES = {
  light: { fill: "#1f1e1c", title: "#ffffff", detail: "#aeaca7" },
  dark: { fill: "#f4f2ed", title: "#1f1e1c", detail: "#6b6963" },
};

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

async function fetchLatestRelease(catalogUrl) {
  const response = await fetch(catalogUrl);
  if (!response.ok) {
    throw new Error(`${catalogUrl} returned ${response.status}`);
  }
  const { releases } = await response.json();
  const [latest] = [...releases].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  if (!latest?.version || Number.isNaN(Date.parse(latest.publishedAt))) {
    throw new Error(`${catalogUrl} has no usable release`);
  }
  return latest;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(isoDate));
}

function renderCard({ platform, theme, release }) {
  const { fill, title, detail } = theme;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="44" viewBox="0 0 196 44" role="img" aria-label="Download puppyone ${release.version} for ${platform.label}">
  <rect width="196" height="44" rx="9" fill="${fill}"/>
  <path transform="${platform.iconTransform}" fill="${title}" d="${platform.iconPath}"/>
  <g font-family="${FONT_FAMILY}">
    <text x="38" y="19" font-size="13" font-weight="600" fill="${title}">Download for ${platform.label}</text>
    <text x="38" y="33" font-size="11" fill="${detail}">v${release.version} · ${formatDate(release.publishedAt)}</text>
  </g>
</svg>
`;
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

for (const platform of PLATFORMS) {
  const release = await fetchLatestRelease(platform.catalogUrl);
  for (const [themeName, theme] of Object.entries(THEMES)) {
    const fileName = `download-${platform.id}-${themeName}.svg`;
    await writeFile(
      path.join(OUTPUT_DIRECTORY, fileName),
      renderCard({ platform, theme, release }),
    );
    console.log(`${fileName}: ${release.version}, ${release.publishedAt}`);
  }
}
