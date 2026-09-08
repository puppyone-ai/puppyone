import fs from "node:fs/promises";
import path from "node:path";
import {
  normalizeRelativePath,
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
} from "./files/path-policy.mjs";

export const BUILT_IN_SLIDES_TEMPLATE_ID = "slides.default";
export const BUILT_IN_SLIDES_TEMPLATE_VERSION = 1;

const TEMPLATE_DIR_PREFIX = ".puppyone-template-";
const templateCreationQueues = new Map();

export async function instantiateWorkspaceTemplate(rootPath, request, options = {}) {
  if (request?.templateId !== BUILT_IN_SLIDES_TEMPLATE_ID) {
    throw new Error("Unsupported workspace template.");
  }
  const parentPath = request?.parentPath ?? null;
  const title = normalizeTemplateName(request?.name);
  const parent = await resolveExistingWorkspacePath(rootPath, parentPath);
  const parentMetadata = await fs.stat(parent).catch((error) => {
    throw new Error(`Unable to create Slides: ${error.message}`);
  });
  if (!parentMetadata.isDirectory()) throw new Error("Create target is not a folder.");

  const fontBytes = options.fontBytes;
  if (!Buffer.isBuffer(fontBytes) && !(fontBytes instanceof Uint8Array)) {
    throw new Error("The built-in Slides font asset is unavailable.");
  }

  return serializeTemplateCreation(parent, async () => {
    let stagingPath = null;
    try {
      const folderName = await findAvailableFolderName(parent, title);
      const normalizedParent = normalizeRelativePath(parentPath);
      const rootRelativePath = joinRelativePath(normalizedParent, folderName);
      resolveWorkspacePath(rootPath, rootRelativePath);

      stagingPath = await fs.mkdtemp(path.join(parent, TEMPLATE_DIR_PREFIX));
      await fs.mkdir(path.join(stagingPath, "assets"));
      const filePlan = createSlidesTemplateFiles(title);
      await Promise.all([
        ...Object.entries(filePlan).map(([name, content]) => (
          fs.writeFile(path.join(stagingPath, name), content, { encoding: "utf8", flag: "wx" })
        )),
        fs.writeFile(path.join(stagingPath, "assets", "geist-sans.woff2"), fontBytes, { flag: "wx" }),
      ]);

      const targetPath = path.join(parent, folderName);
      await fs.rename(stagingPath, targetPath);
      stagingPath = null;

      const appFileName = `${title}.puppyoneapp`;
      const openPath = joinRelativePath(rootRelativePath, appFileName);
      const createdPaths = [
        rootRelativePath,
        openPath,
        joinRelativePath(rootRelativePath, "index.html"),
        joinRelativePath(rootRelativePath, "puppyone-slides.css"),
        joinRelativePath(rootRelativePath, "puppyone-slides.js"),
        joinRelativePath(rootRelativePath, "assets"),
        joinRelativePath(rootRelativePath, "assets/geist-sans.woff2"),
      ];
      return {
        rootPath: rootRelativePath,
        openPath,
        createdPaths,
        template: {
          id: BUILT_IN_SLIDES_TEMPLATE_ID,
          version: BUILT_IN_SLIDES_TEMPLATE_VERSION,
        },
      };
    } catch (error) {
      throw new Error(`Unable to create Slides: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (stagingPath) await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    }
  });
}

export async function loadBundledSlidesFont(appPath) {
  const candidates = [
    path.join(appPath, "dist", "fonts", "geist", "Geist-Variable.woff2"),
    path.join(appPath, "public", "fonts", "geist", "Geist-Variable.woff2"),
  ];
  for (const candidate of candidates) {
    const bytes = await fs.readFile(candidate).catch(() => null);
    if (bytes) return bytes;
  }
  throw new Error("The built-in Slides font asset is missing from this application build.");
}

function createSlidesTemplateFiles(title) {
  const appFileName = `${title}.puppyoneapp`;
  return {
    [appFileName]: `${JSON.stringify({
      id: "puppyone.slides.default",
      name: title,
      type: "puppyone.app",
      version: 1,
      launch: { kind: "static-file", path: "index.html" },
      permissions: { workspace: [] },
    }, null, 2)}\n`,
    "index.html": createSlidesHtml(title),
    "puppyone-slides.css": SLIDES_CSS,
    "puppyone-slides.js": SLIDES_JS,
  };
}

function createSlidesHtml(title) {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="puppyone-slides.css">
</head>
<body>
  <main class="po-deck" aria-label="${safeTitle} presentation">
    <section class="po-slide po-slide--hero" aria-labelledby="slide-1-title">
      <p class="po-slide__eyebrow">PuppyOne Slides</p>
      <h1 id="slide-1-title">${safeTitle}</h1>
      <p class="po-slide__lede">A clear thought, presented beautifully.</p>
      <footer><span>01</span><span>Edit this deck in PuppyOne</span></footer>
    </section>
    <section class="po-slide" aria-labelledby="slide-2-title">
      <p class="po-slide__eyebrow">The opportunity</p>
      <h2 id="slide-2-title">Lead with one memorable idea.</h2>
      <div class="po-slide__grid po-slide__grid--three">
        <article><strong>01</strong><h3>Context</h3><p>What changed, and why it matters now.</p></article>
        <article><strong>02</strong><h3>Insight</h3><p>The perspective only your team can offer.</p></article>
        <article><strong>03</strong><h3>Action</h3><p>The focused next step you want people to take.</p></article>
      </div>
      <footer><span>02</span><span>${safeTitle}</span></footer>
    </section>
    <section class="po-slide po-slide--contrast" aria-labelledby="slide-3-title">
      <p class="po-slide__eyebrow">Key signal</p>
      <div class="po-slide__metric"><strong>3×</strong><span>Make the most important number impossible to miss.</span></div>
      <h2 id="slide-3-title">Evidence earns attention.</h2>
      <footer><span>03</span><span>${safeTitle}</span></footer>
    </section>
    <section class="po-slide" aria-labelledby="slide-4-title">
      <p class="po-slide__eyebrow">The plan</p>
      <h2 id="slide-4-title">Move from idea to outcome.</h2>
      <ol class="po-slide__steps">
        <li><span>Now</span><strong>Align</strong><p>Define the decision and its owner.</p></li>
        <li><span>Next</span><strong>Build</strong><p>Ship the smallest complete experience.</p></li>
        <li><span>Then</span><strong>Learn</strong><p>Measure the signal and improve.</p></li>
      </ol>
      <footer><span>04</span><span>${safeTitle}</span></footer>
    </section>
    <section class="po-slide po-slide--closing" aria-labelledby="slide-5-title">
      <p class="po-slide__eyebrow">Next step</p>
      <h2 id="slide-5-title">What will you make possible?</h2>
      <p class="po-slide__lede">Replace this copy, add or remove sections, and make the story yours.</p>
      <footer><span>05</span><span>${safeTitle}</span></footer>
    </section>
  </main>
  <nav class="po-controls" aria-label="Slide controls">
    <button type="button" data-action="previous" aria-label="Previous slide">←</button>
    <span aria-live="polite"><strong data-current>1</strong> / <span data-total>5</span></span>
    <button type="button" data-action="next" aria-label="Next slide">→</button>
  </nav>
  <div class="po-progress" aria-hidden="true"><span></span></div>
  <script src="puppyone-slides.js"></script>
</body>
</html>
`;
}

const SLIDES_CSS = `@font-face{font-family:Geist;src:url("assets/geist-sans.woff2") format("woff2");font-display:swap;font-weight:100 900}
:root{--po-slide-bg:#f6f3ed;--po-slide-panel:#fffdf8;--po-slide-text:#15171a;--po-slide-muted:#6b6a66;--po-slide-border:#dcd7cd;--po-slide-accent:#2563eb;--po-slide-space:clamp(28px,6vw,84px);font-family:Geist,ui-sans-serif,system-ui,sans-serif;color-scheme:light}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#111318}body{overflow:hidden;color:var(--po-slide-text)}button{font:inherit}.po-deck{height:100dvh;display:grid}.po-slide{grid-area:1/1;width:100%;height:100%;padding:var(--po-slide-space);display:grid;grid-template-rows:auto 1fr auto;gap:clamp(20px,4vw,52px);background:var(--po-slide-bg);opacity:0;visibility:hidden;transform:translateX(3%);transition:opacity .35s ease,transform .35s ease,visibility .35s}.po-slide.is-active{opacity:1;visibility:visible;transform:none;z-index:1}.po-slide__eyebrow{margin:0;color:var(--po-slide-accent);font-size:clamp(12px,2vw,18px);font-weight:700;letter-spacing:.14em;text-transform:uppercase}.po-slide h1,.po-slide h2{margin:0;max-width:14ch;align-self:center;font-weight:650;letter-spacing:-.055em;line-height:.94}.po-slide h1{font-size:clamp(58px,10vw,150px)}.po-slide h2{font-size:clamp(42px,7vw,104px)}.po-slide__lede{max-width:34ch;margin:0;font-size:clamp(20px,3vw,40px);line-height:1.25;color:var(--po-slide-muted)}.po-slide footer{display:flex;justify-content:space-between;gap:20px;padding-top:18px;border-top:1px solid var(--po-slide-border);color:var(--po-slide-muted);font-size:clamp(11px,1vw,16px)}.po-slide--hero{background:radial-gradient(circle at 82% 18%,#d7e5ff 0,transparent 30%),var(--po-slide-panel)}.po-slide--hero h1{align-self:end}.po-slide__grid{align-self:center;display:grid;gap:18px}.po-slide__grid--three{grid-template-columns:repeat(3,1fr)}.po-slide__grid article{min-height:220px;padding:clamp(20px,3vw,38px);border:1px solid var(--po-slide-border);border-radius:22px;background:var(--po-slide-panel)}.po-slide__grid strong{color:var(--po-slide-accent)}.po-slide__grid h3{font-size:clamp(20px,3vw,34px);margin:3rem 0 .5rem}.po-slide__grid p{color:var(--po-slide-muted);font-size:clamp(15px,2vw,21px);line-height:1.5}.po-slide--contrast{background:var(--po-slide-text);color:#fff}.po-slide--contrast footer{border-color:#3b3d41;color:#aeb0b4}.po-slide__metric{align-self:center;display:flex;align-items:end;gap:clamp(24px,5vw,72px)}.po-slide__metric strong{color:#8db4ff;font-size:clamp(100px,19vw,280px);line-height:.75;letter-spacing:-.08em}.po-slide__metric span{max-width:22ch;font-size:clamp(18px,2vw,34px);color:#c9cbd0}.po-slide__steps{align-self:center;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;padding:0;background:var(--po-slide-border);list-style:none}.po-slide__steps li{padding:clamp(20px,3vw,42px);background:var(--po-slide-panel)}.po-slide__steps span{color:var(--po-slide-accent);font-weight:700}.po-slide__steps strong{display:block;margin-top:3rem;font-size:clamp(26px,4vw,52px)}.po-slide__steps p{color:var(--po-slide-muted);font-size:clamp(14px,2vw,20px);line-height:1.45}.po-slide--closing{background:linear-gradient(135deg,#e9f0ff,var(--po-slide-panel) 55%)}.po-slide--closing h2{align-self:end}.po-controls{position:fixed;z-index:10;right:22px;bottom:18px;display:flex;align-items:center;gap:10px;padding:6px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:rgba(18,20,24,.82);color:#fff;backdrop-filter:blur(12px)}.po-controls button{width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}.po-controls button:hover,.po-controls button:focus-visible{background:rgba(255,255,255,.14)}.po-controls span{min-width:58px;text-align:center;font-size:12px}.po-progress{position:fixed;z-index:11;inset:auto 0 0;height:3px;background:rgba(0,0,0,.12)}.po-progress span{display:block;height:100%;width:20%;background:var(--po-slide-accent);transition:width .3s ease}@media(max-width:700px){.po-slide__grid--three,.po-slide__steps{grid-template-columns:1fr}.po-slide__grid article{min-height:0}.po-slide__grid h3,.po-slide__steps strong{margin-top:.8rem}.po-slide__metric{align-items:start;flex-direction:column}.po-slide footer{display:none}}@media(prefers-reduced-motion:reduce){.po-slide,.po-progress span{transition:none}}
`;

const SLIDES_JS = `(()=>{"use strict";const slides=[...document.querySelectorAll(".po-slide")];const current=document.querySelector("[data-current]");const total=document.querySelector("[data-total]");const progress=document.querySelector(".po-progress span");let index=0;function show(next){index=(next+slides.length)%slides.length;slides.forEach((slide,i)=>{const active=i===index;slide.classList.toggle("is-active",active);slide.setAttribute("aria-hidden",String(!active));});current.textContent=String(index+1);total.textContent=String(slides.length);progress.style.width=((index+1)/slides.length*100)+"%";document.title=slides[index].querySelector("h1,h2")?.textContent||document.title;}function move(delta){show(index+delta)}document.querySelector('[data-action="previous"]').addEventListener("click",()=>move(-1));document.querySelector('[data-action="next"]').addEventListener("click",()=>move(1));document.addEventListener("keydown",event=>{if(["ArrowRight","PageDown"," "].includes(event.key)){event.preventDefault();move(1)}else if(["ArrowLeft","PageUp"].includes(event.key)){event.preventDefault();move(-1)}else if(event.key==="Home")show(0);else if(event.key==="End")show(slides.length-1)});let startX=null;document.addEventListener("pointerdown",event=>{startX=event.clientX},{passive:true});document.addEventListener("pointerup",event=>{if(startX===null)return;const delta=event.clientX-startX;startX=null;if(Math.abs(delta)>60)move(delta<0?1:-1)},{passive:true});show(0)})();
`;

async function serializeTemplateCreation(key, operation) {
  const previous = templateCreationQueues.get(key) ?? Promise.resolve();
  let release;
  const turn = new Promise((resolve) => {
    release = resolve;
  });
  templateCreationQueues.set(key, turn);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (templateCreationQueues.get(key) === turn) templateCreationQueues.delete(key);
  }
}

async function findAvailableFolderName(parent, preferredName) {
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = index === 1 ? preferredName : `${preferredName} ${index}`;
    try {
      await fs.lstat(path.join(parent, candidate));
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error("Unable to choose an available Slides name.");
}

function normalizeTemplateName(value) {
  if (typeof value !== "string") throw new Error("Slides name is required.");
  const name = value.trim().replace(/\.puppyoneapp$/i, "");
  if (!name) throw new Error("Slides name is required.");
  if (name === "." || name === ".." || /[\\/\0]/.test(name)) throw new Error("Slides name is invalid.");
  if (name.length > 120) throw new Error("Slides name is too long.");
  return name;
}

function joinRelativePath(parentPath, name) {
  return parentPath ? `${parentPath}/${name}` : name;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
