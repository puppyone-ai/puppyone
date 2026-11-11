import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The Getting Started template introduces puppyone once per format: the guide
// explains what it is, and each sample file shows one more way to read the same
// story. Every locale is rendered from one string table so the files agree.

export const SAMPLE_LOCALES = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "zh-Hans"];
export const SAMPLE_FILES = {
  guide: { source: "getting-started.md", path: "Getting Started.md" },
  formats: { source: "formats.csv", path: "Formats.csv" },
  tour: { source: "how-it-works.html", path: "How It Works.html" },
  map: { source: "workspace-map.excalidraw", path: "Workspace Map.excalidraw" },
};

const contentRoot = fileURLToPath(new URL("../../electron/local-api/templates/content/", import.meta.url));

export async function loadSampleStrings(locale) {
  const module = await import(new URL(`./getting-started/${locale}.mjs`, import.meta.url).href);
  return module.default;
}

export function renderGettingStartedSamples(locale, strings) {
  return {
    [SAMPLE_FILES.guide.source]: renderGuide(strings),
    [SAMPLE_FILES.formats.source]: renderFormats(strings),
    [SAMPLE_FILES.tour.source]: renderTour(locale, strings),
    [SAMPLE_FILES.map.source]: renderMap(strings),
  };
}

const link = (file) => `[${file.path}](${encodeURI(file.path)})`;

function renderGuide(strings) {
  const s = strings.guide;
  return [
    `# ${s.title}`,
    s.tagline,
    `## ${s.whatHeading}`,
    s.what.map((point) => `- ${point}`).join("\n"),
    `## ${s.samplesHeading}`,
    s.samplesIntro,
    ["formats", "tour", "map"].map((key) => `- ${link(SAMPLE_FILES[key])}${s.separator}${s.samples[key]}`).join("\n"),
    `## ${s.editHeading}`,
    s.edit,
    s.editLine,
    `## ${s.agentHeading}`,
    s.agent,
    s.agentExample,
    s.privacy,
    `## ${s.bringHeading}`,
    ...s.bring,
    `## ${s.yoursHeading}`,
    s.yours,
  ].join("\n\n") + "\n";
}

function csvField(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderFormats(strings) {
  const f = strings.formats;
  const rows = [f.columns, ...f.rows.map((row) => [row.format, row.extensions, row.what, row.sample ? SAMPLE_FILES[row.sample].path : ""])];
  return rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function renderTour(locale, strings) {
  const t = strings.tour;
  const total = t.steps.length;
  const indent = (text, depth) => text.split("\n").map((line) => `${"  ".repeat(depth)}${line}`).join("\n");
  const tabs = t.steps.map((step, index) => `<button type="button" role="tab" id="tab-${index + 1}" aria-controls="step-${index + 1}" aria-selected="${index === 0}"><span>${index + 1}</span>${escapeHtml(step.title)}</button>`).join("\n");
  const panels = t.steps.map((step, index) => [
    `<section class="step" role="tabpanel" id="step-${index + 1}" aria-labelledby="tab-${index + 1}">`,
    `  <p class="count">${escapeHtml(t.progress.replace("{step}", String(index + 1)).replace("{total}", String(total)))}</p>`,
    `  <h2>${escapeHtml(step.title)}</h2>`,
    `  <p>${escapeHtml(step.body)}</p>`,
    "  <ul>",
    ...step.points.map((point) => `    <li>${escapeHtml(point)}</li>`),
    "  </ul>",
    "</section>",
  ].join("\n")).join("\n");
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t.title)}</title>
  <style>
    :root { color-scheme: light dark; --text: #1f2328; --muted: #656d76; --surface: #ffffff; --raised: #f6f8fa; --line: #d8dee4; --accent: #1f2328; }
    @media (prefers-color-scheme: dark) { :root { --text: #e6edf3; --muted: #9198a1; --surface: #16181d; --raised: #1f232a; --line: #30363d; --accent: #e6edf3; } }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--surface); color: var(--text); font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans", "Noto Sans", sans-serif; }
    main { max-width: 760px; margin: 0 auto; padding: 40px 24px 56px; }
    .eyebrow { margin: 0 0 6px; color: var(--muted); font-size: 13px; font-weight: 600; }
    h1 { margin: 0; font-size: 28px; line-height: 1.25; }
    .lead { margin: 10px 0 28px; color: var(--muted); }
    [role="tablist"] { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    [role="tab"] { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
    [role="tab"] span { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--raised); font-size: 12px; font-weight: 600; }
    [role="tab"]:hover { background: var(--raised); }
    [role="tab"][aria-selected="true"] { border-color: var(--accent); background: var(--accent); color: var(--surface); }
    [role="tab"][aria-selected="true"] span { background: var(--surface); color: var(--text); }
    .step { padding: 24px 28px; border: 1px solid var(--line); border-radius: 12px; background: var(--raised); }
    .step + .step { margin-top: 12px; }
    .step[hidden] { display: none; }
    .count { margin: 0; color: var(--muted); font-size: 13px; }
    .step h2 { margin: 4px 0 8px; font-size: 20px; }
    .step p { margin: 0; }
    .step ul { margin: 14px 0 0; padding-left: 20px; }
    .step li + li { margin-top: 6px; }
    nav { display: flex; justify-content: space-between; margin-top: 16px; }
    nav button { padding: 7px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
    nav button:hover:not(:disabled) { background: var(--raised); }
    nav button:disabled { opacity: .4; cursor: default; }
    footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">puppyone</p>
    <h1>${escapeHtml(t.title)}</h1>
    <p class="lead">${escapeHtml(t.lead)}</p>
    <div role="tablist" aria-label="${escapeHtml(t.title)}">
${indent(tabs, 3)}
    </div>
${indent(panels, 2)}
    <nav hidden>
      <button type="button" data-move="-1">${escapeHtml(t.previous)}</button>
      <button type="button" data-move="1">${escapeHtml(t.next)}</button>
    </nav>
    <footer>${escapeHtml(t.footer)}</footer>
  </main>
  <script>
    const tabs = [...document.querySelectorAll("[role=tab]")];
    const steps = [...document.querySelectorAll(".step")];
    const [previous, next] = document.querySelectorAll("[data-move]");
    let current = 0;
    function show(index) {
      current = Math.max(0, Math.min(steps.length - 1, index));
      steps.forEach((step, position) => { step.hidden = position !== current; });
      tabs.forEach((tab, position) => tab.setAttribute("aria-selected", String(position === current)));
      previous.disabled = current === 0;
      next.disabled = current === steps.length - 1;
    }
    tabs.forEach((tab, index) => tab.addEventListener("click", () => show(index)));
    for (const button of [previous, next]) button.addEventListener("click", () => show(current + Number(button.dataset.move)));
    document.querySelector("nav").hidden = false;
    show(0);
  </script>
</body>
</html>
`;
}

const LINE_HEIGHT = 1.25;
const TEXT_PADDING = 5;
const WIDE = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;
const advance = (character, fontSize) => (WIDE.test(character) ? fontSize : fontSize * 0.56);
const measure = (text, fontSize) => [...text].reduce((sum, character) => sum + advance(character, fontSize), 0);

/** Breaks text the way the whiteboard will, so containers are tall enough before its fonts load. */
function wrapText(text, width, fontSize) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const token of paragraph.match(/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef][、。，！？）]*|\S+\s*|\s+/g) ?? [""]) {
      if (line && measure(`${line}${token}`.trimEnd(), fontSize) > width) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else line += token;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function renderMap(strings) {
  const m = strings.map;
  const elements = [];
  const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const base = (id) => {
    const order = elements.length;
    const seed = 100_000 + order * 7_919;
    return {
      id, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1,
      strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, index: `a${DIGITS[order]}`, roundness: null,
      seed, version: 1, versionNonce: seed + 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
    };
  };
  const text = ({ id, x, y, width, value, fontSize = 16, color = "#1e1e1e", align = "center", containerId = null, verticalAlign = "top" }) => {
    const lines = wrapText(value, width, fontSize);
    const height = lines.length * fontSize * LINE_HEIGHT;
    const element = {
      ...base(id), type: "text", x, y, width, height, strokeColor: color, text: lines.join("\n"), fontSize, fontFamily: 9,
      textAlign: align, verticalAlign, containerId, originalText: value, autoResize: true, lineHeight: LINE_HEIGHT,
    };
    elements.push(element);
    return element;
  };
  const box = ({ id, x, y, width, height = 0, label, fontSize = 16, stroke = "#1e1e1e", fill = "transparent", strokeWidth = 1 }) => {
    const textHeight = wrapText(label, width - TEXT_PADDING * 2, fontSize).length * fontSize * LINE_HEIGHT;
    const shape = { ...base(id), type: "rectangle", x, y, width, height: Math.max(height, Math.ceil(textHeight + 28)), strokeColor: stroke, backgroundColor: fill, strokeWidth, boundElements: [{ type: "text", id: `${id}-text` }] };
    elements.push(shape);
    text({ id: `${id}-text`, x: x + TEXT_PADDING, y: y + (shape.height - textHeight) / 2, width: width - TEXT_PADDING * 2, value: label, fontSize, containerId: id, verticalAlign: "middle" });
    return shape;
  };
  const arrow = ({ id, from, to, points, both = false, dashed = false }) => {
    const [start] = points;
    const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
    const element = {
      ...base(id), type: "arrow", x: start[0], y: start[1], width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      strokeColor: "#495057", strokeStyle: dashed ? "dashed" : "solid", points: points.map(([x, y]) => [x - start[0], y - start[1]]), lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap: 6 }, endBinding: { elementId: to.id, focus: 0, gap: 6 },
      startArrowhead: both ? "arrow" : null, endArrowhead: "arrow", elbowed: false,
    };
    elements.push(element);
    for (const shape of [from, to]) shape.boundElements.push({ type: "arrow", id });
    return element;
  };
  const caption = (id, value, x, y, width) => text({ id, x: x - width / 2, y, width, value, fontSize: 14, color: "#495057" });

  const folder = { ...base("folder"), type: "rectangle", x: 310, y: 140, width: 400, height: 260, strokeColor: "#1e1e1e", strokeWidth: 2, backgroundColor: "#f8f9fa", boundElements: [] };
  elements.push(folder);
  text({ id: "folder-title", x: 330, y: 158, width: 360, value: m.folder, fontSize: 18 });
  const chips = [
    { key: "guide", stroke: "#1971c2", fill: "#e7f5ff" },
    { key: "formats", stroke: "#2f9e44", fill: "#ebfbee" },
    { key: "tour", stroke: "#e8590c", fill: "#fff4e6" },
    { key: "map", stroke: "#6741d9", fill: "#f3f0ff" },
  ];
  chips.forEach((chip, index) => {
    box({ id: `file-${chip.key}`, x: 334 + (index % 2) * 182, y: 210 + Math.floor(index / 2) * 82, width: 170, height: 64, label: SAMPLE_FILES[chip.key].path, fontSize: 14, stroke: chip.stroke, fill: chip.fill });
  });
  const you = box({ id: "you", x: 0, y: 230, width: 170, height: 80, label: m.you, fontSize: 20, strokeWidth: 2, fill: "#fff9db" });
  const agent = box({ id: "agent", x: 850, y: 230, width: 170, height: 80, label: m.agent, fontSize: 20, strokeWidth: 2, fill: "#e6fcf5" });
  const apps = box({ id: "apps", x: 340, y: 480, width: 340, height: 64, label: m.apps, fontSize: 16 });

  arrow({ id: "you-edit", from: you, to: folder, points: [[176, 270], [304, 270]] });
  caption("you-edit-label", m.edit, 240, 236, 120);
  arrow({ id: "agent-edit", from: agent, to: folder, points: [[844, 270], [716, 270]] });
  caption("agent-edit-label", m.propose, 780, 226, 120);
  arrow({ id: "agent-review", from: agent, to: you, dashed: true, points: [[935, 224], [935, 70], [85, 70], [85, 224]] });
  caption("agent-review-label", m.review, 510, 44, 420);
  arrow({ id: "folder-apps", from: folder, to: apps, both: true, points: [[510, 406], [510, 474]] });
  caption("folder-apps-label", m.open, 630, 430, 200);
  text({ id: "tip", x: 0, y: 580, width: 1020, value: m.tip, fontSize: 14, color: "#868e96" });

  return `${JSON.stringify({ type: "excalidraw", version: 2, source: "puppyone", elements, appState: { viewBackgroundColor: "#ffffff" }, files: {} }, null, 2)}\n`;
}

export async function syncGettingStartedSamples({ check = false } = {}) {
  const stale = [];
  for (const locale of SAMPLE_LOCALES) {
    const files = renderGettingStartedSamples(locale, await loadSampleStrings(locale));
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(contentRoot, locale, name);
      const current = await fs.readFile(target, "utf8").catch(() => null);
      if (current === content) continue;
      if (check) stale.push(`${locale}/${name}`);
      else await fs.writeFile(target, content);
    }
  }
  if (stale.length) throw new Error(`Getting Started samples are stale (${stale.join(", ")}). Run npm run sync:project-templates.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes("--check");
  await syncGettingStartedSamples({ check });
  console.log(`${check ? "Verified" : "Rendered"} Getting Started samples (${SAMPLE_LOCALES.length} locales).`);
}
