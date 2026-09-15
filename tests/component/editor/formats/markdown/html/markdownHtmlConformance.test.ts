/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { markdownAssetUrlResolverFacet } from "../../../../../../packages/shared-ui/src/editor/markdown/core/editor/markdownLivePreviewContext";
import {
  getMarkdownPlanIndex,
  getMarkdownPlansInRange,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import {
  getMarkdownConformanceSnapshot,
  projectMarkdownConformanceSurface,
  type MarkdownConformanceSurface,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/projection/markdownConformance";
import { validateMarkdownHtmlBlockStructure } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/htmlBlockStructure";
import { getMarkdownHtmlBlock } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/htmlBlockModel";
import { compileMarkdownHtmlBlockPolicy } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/htmlBlockPolicy";
import { createSanitizedBlockHtmlFragment } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/sanitizeHtml";
import { renderMarkdownInlineFromSharedPolicy } from "../../../../../../packages/shared-ui/src/editor/markdown/composition/preview/markdownInlinePlanAdapter";
import {
  getSafeBlockProfile,
  getSafeMediaProfile,
  MARKDOWN_HTML_PROFILES,
} from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownHtmlProfiles";
import type {
  MarkdownAssetUrlResolver,
  MarkdownDialectId,
} from "../../../../../../packages/shared-ui/src/editor/registry/viewerTypes";
import { CENTERED_README_HEADER } from "../../../../../fixtures/editor/formats/markdown/centeredReadme";

const inertAssetResolver: MarkdownAssetUrlResolver = () => null;
const mountedViews: EditorView[] = [];

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function createState(
  source: string,
  options: {
    dialect?: MarkdownDialectId;
    readOnly?: boolean;
    assetResolver?: MarkdownAssetUrlResolver | null;
  } = {},
) {
  return EditorState.create({
    doc: source,
    extensions: [
      ...markdownCodeMirrorBaseExtensions(
        options.readOnly ?? false,
        options.dialect ?? "puppy-gfm",
      ),
      markdownAssetUrlResolverFacet.of(options.assetResolver ?? null),
    ],
  });
}

function getHtmlPlan(state: EditorState) {
  return getMarkdownPlanIndex(state).find(({ element }) => element.kind === "htmlBlock")?.plan ?? null;
}

function mountLive(
  source: string,
  readOnly: boolean,
  assetResolver: MarkdownAssetUrlResolver | null = null,
  documentPath = "note.md",
) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(readOnly),
        markdownLivePreviewExtension("safe", null, documentPath, assetResolver),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ],
    }),
  });
  mountedViews.push(view);
  return view;
}

describe("Markdown HTML authored-structure model", () => {
  it.each([
    ["balanced nested tags", "<div><span>x</span></div>", "complete"],
    ["multiple balanced roots", "<div>a</div><section>b</section>", "complete"],
    ["void elements", '<div>a<br><img alt="x"></div>', "complete"],
    ["mismatched nesting", "<div><span>x</div></span>", "malformed"],
    ["orphan closing tag", "</div>", "malformed"],
    ["incomplete nested tag", "<div><span>x</span>", "incomplete"],
    ["duplicate attribute", '<div id="a" id="b"></div>', "malformed"],
    ["paragraph browser repair", "<p><div>x</div></p>", "malformed"],
    ["table foster parenting", "<table><div>x</div></table>", "malformed"],
    ["table text foster parenting", "<table>text<tr><td>x</td></tr></table>", "malformed"],
    ["comment payload with fake tags", "<div><!-- <span> --></div>", "complete"],
    ["complete comment block", "<!-- <div> -->", "unsupported"],
    ["incomplete comment block", "<!-- <div>", "incomplete"],
    ["complete declaration", "<!DOCTYPE html>", "unsupported"],
    ["complete processing instruction", "<?target value?>", "unsupported"],
    ["complete CDATA", "<![CDATA[<div>]]>", "unsupported"],
  ] as const)("classifies %s", (_name, source, status) => {
    expect(validateMarkdownHtmlBlockStructure(source).status).toBe(status);
  });

  it("reports the exact mismatched authored pair instead of root balance", () => {
    expect(validateMarkdownHtmlBlockStructure("<div><span>x</div></span>")).toMatchObject({
      status: "malformed",
      tagName: "div",
      diagnostic: "closing tag </div> does not match <span>",
    });
  });
});

describe("Markdown HTML plan-level policy", () => {
  function policy(source: string, assetBrokerAvailable = false) {
    const structure = validateMarkdownHtmlBlockStructure(source);
    return compileMarkdownHtmlBlockPolicy({
      source,
      status: structure.status,
      diagnostic: structure.diagnostic,
      assetBrokerAvailable,
    });
  }

  it.each([
    ["safe block", "<div><strong>safe</strong></div>", true, "safe-block"],
    ["safe details", "<details><summary>Title</summary>Body</details>", true, "safe-block"],
    ["blocked script", "<script>alert(1)</script>", false, null],
    ["blocked form", "<form><input></form>", false, null],
    ["unknown custom element", "<my-widget></my-widget>", false, null],
    ["unsafe anchor", '<div><a href="javascript:alert(1)">x</a></div>', false, null],
    ["exact HTTPS iframe", '<iframe src="https://example.com/embed"></iframe>', true, "external-web-embed"],
    ["iframe with ignored behavior", '<iframe src="https://example.com" allow="camera"></iframe>', false, null],
    ["non-HTTPS iframe", '<iframe src="http://example.com"></iframe>', false, null],
  ] as const)("classifies %s before Widget creation", (_name, source, supported, profile) => {
    const result = policy(source);
    expect(result.supported).toBe(supported);
    if (result.supported) expect(result.profile).toBe(profile);
  });

  it("records reducible attributes/styles without turning them into authority", () => {
    const result = policy('<div onclick="run()" style="display:none;color:red">safe</div>');
    expect(result).toMatchObject({
      supported: true,
      profile: "safe-block",
    });
    if (result.supported) {
      expect(result.diagnostics.map(({ code }) => code)).toEqual([
        "htmlBlock.attribute-reduced",
        "htmlBlock.style-reduced",
      ]);
    }
  });

  it("requires a broker at plan time for raw media source intents", () => {
    const source = '<figure><img src="assets/a.png" alt="a"></figure>';
    expect(policy(source, false)).toMatchObject({
      supported: false,
      diagnostic: { code: "htmlBlock.asset-broker-unavailable" },
    });
    expect(policy(source, true)).toMatchObject({
      supported: true,
      profile: "safe-block-with-media",
      requiresAssetBroker: true,
    });
  });

  it("keeps policy and defensive sanitizer aligned for approved safe blocks", () => {
    const source = '<div onclick="run()"><time datetime="2026-08-05">Today</time></div>';
    expect(policy(source)).toMatchObject({ supported: true, profile: "safe-block" });
    const sanitized = createSanitizedBlockHtmlFragment(source);
    expect(sanitized.supported).toBe(true);
    expect(sanitized.fragment.querySelector("div")?.hasAttribute("onclick")).toBe(false);
  });

  it("normalizes conventional README align attributes into safe presentation", () => {
    const source = '<div align="center"><p align="right">safe</p></div>';
    expect(policy(source)).toMatchObject({ supported: true, profile: "safe-block" });
    const sanitized = createSanitizedBlockHtmlFragment(source);
    expect(sanitized.supported).toBe(true);
    expect(sanitized.fragment.querySelector("div")?.style.textAlign).toBe("center");
    expect(sanitized.fragment.querySelector("p")?.style.textAlign).toBe("right");
  });

  it("reduces invalid legacy align values without changing block classification", () => {
    const source = '<div align="sideways">safe</div>';
    const result = policy(source);
    expect(result).toMatchObject({
      supported: true,
      profile: "safe-block",
      diagnostics: [{ code: "htmlBlock.attribute-reduced" }],
    });
    const sanitized = createSanitizedBlockHtmlFragment(source);
    expect(sanitized.supported).toBe(true);
    expect(sanitized.fragment.querySelector<HTMLElement>("div")?.style.textAlign).toBe("");
  });

  it("covers every versioned safe-block tag through one policy authority", () => {
    for (const tag of getSafeBlockProfile().tags) {
      const source = getSafeBlockProfile().voidTags.has(tag) ? `<${tag}>` : `<${tag}></${tag}>`;
      expect(policy(source), tag).toMatchObject({ supported: true, profile: "safe-block" });
      expect(createSanitizedBlockHtmlFragment(source).supported, tag).toBe(true);
    }
  });

  it("covers every passive-media tag only through the composed media profile", () => {
    for (const tag of getSafeMediaProfile().tags) {
      const source = getSafeMediaProfile().voidTags.has(tag) ? `<${tag}>` : `<${tag}></${tag}>`;
      expect(policy(source), tag).toMatchObject({
        supported: true,
        profile: "safe-block-with-media",
      });
      expect(createSanitizedBlockHtmlFragment(source, { deferredMedia: true }).supported, tag).toBe(true);
    }
  });

  it("keeps every blocked executable tag out of ordinary block plans", () => {
    for (const tag of MARKDOWN_HTML_PROFILES.blocked) {
      const source = tag === "iframe" ? "<iframe></iframe>" : `<${tag}></${tag}>`;
      expect(policy(source).supported, tag).toBe(false);
    }
  });
});

describe("Markdown HTML cross-surface conformance", () => {
  it("reassembles a conventional blank-line-split README HTML flow into one plan", () => {
    const state = createState(CENTERED_README_HEADER, { assetResolver: inertAssetResolver });
    const block = getMarkdownHtmlBlock(state, 1);
    const htmlEntries = getMarkdownPlanIndex(state).filter(({ element }) => element.kind === "htmlBlock");

    expect(block).toMatchObject({
      from: 0,
      to: CENTERED_README_HEADER.length,
      source: CENTERED_README_HEADER,
      status: "complete",
      tagName: "div",
    });
    expect(htmlEntries).toHaveLength(1);
    expect(htmlEntries[0]?.plan).toMatchObject({
      presentation: "blockAtom",
      sourceRange: { from: 0, to: CENTERED_README_HEADER.length },
      embed: {
        kind: "htmlBlock",
        profile: "safe-block-with-media",
        requiresAssetBroker: true,
      },
    });
  });

  it("returns the same HTML flow when a range projection starts at an inner parser fragment", () => {
    const state = createState(CENTERED_README_HEADER, { assetResolver: inertAssetResolver });
    const headingFrom = CENTERED_README_HEADER.indexOf("<h1>");
    const headingLine = state.doc.lineAt(headingFrom);
    const block = getMarkdownHtmlBlock(state, headingLine.number);
    const entries = getMarkdownPlansInRange(state, headingLine.from, headingLine.to)
      .filter(({ element }) => element.kind === "htmlBlock");

    expect(block).toMatchObject({ from: 0, to: CENTERED_README_HEADER.length });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.plan).toMatchObject({
      presentation: "blockAtom",
      sourceRange: { from: 0, to: CENTERED_README_HEADER.length },
    });
  });

  it.each([false, true])("mounts the complete README header instead of raw fragments (readOnly=%s)", (readOnly) => {
    const view = mountLive(CENTERED_README_HEADER, readOnly, inertAssetResolver);
    const surface = view.dom.querySelector<HTMLElement>(".cm-md-html-rendered-surface");

    expect(view.dom.querySelectorAll(".cm-md-html-widget")).toHaveLength(1);
    expect(surface).not.toBeNull();
    expect(surface?.querySelector<HTMLElement>("div")?.style.textAlign).toBe("center");
    expect(surface?.querySelectorAll("img")).toHaveLength(5);
    expect(surface?.querySelectorAll('[role="link"]')).toHaveLength(4);
    expect(surface?.textContent).toContain("puppyone");
    expect(surface?.textContent).toContain("A local-first editor. Built for you and your agents.");
    expect(surface?.textContent).not.toContain("<div");
  });

  it("hydrates the exact README local logo and HTTPS badges through one broker policy", async () => {
    const resolverCalls: Array<{ documentPath: string; href: string }> = [];
    const resolver: MarkdownAssetUrlResolver = async (documentPath, href) => {
      resolverCalls.push({ documentPath, href });
      if (href !== "public/assets/brand/puppy/puppy-dark.svg") return null;
      return "puppyone-local://file/token/markdown-asset/root/public/assets/brand/puppy/puppy-dark.svg";
    };
    const view = mountLive(CENTERED_README_HEADER, false, resolver, "README.md");

    await waitForDom(() => (
      view.dom.querySelectorAll<HTMLImageElement>(".cm-md-html-rendered-surface img[src]").length === 5
    ));

    const images = Array.from(
      view.dom.querySelectorAll<HTMLImageElement>(".cm-md-html-rendered-surface img"),
    );
    const logo = images.find((image) => image.alt === "puppyone Logo");
    const badges = images.filter((image) => image.src.startsWith("https://img.shields.io/"));

    expect(logo?.getAttribute("src")).toBe(
      "puppyone-local://file/token/markdown-asset/root/public/assets/brand/puppy/puppy-dark.svg",
    );
    expect(logo?.width).toBe(72);
    expect(logo?.height).toBe(72);
    expect(resolverCalls).toEqual([{
      documentPath: "README.md",
      href: "public/assets/brand/puppy/puppy-dark.svg",
    }]);
    expect(badges).toHaveLength(4);
    for (const badge of badges) {
      expect(badge.referrerPolicy).toBe("no-referrer");
      expect(badge.crossOrigin).toBe("anonymous");
      expect(badge.loading).toBe("lazy");
    }
  });

  it.each([
    ["unresolved local", "missing/logo.png"],
    ["denied HTTP", "http://example.com/tracker.png"],
  ])("keeps accessible alt text when a %s image is unavailable", async (_name, href) => {
    const view = mountLive(
      `<img src="${href}" alt="Missing logo">`,
      false,
      inertAssetResolver,
    );

    await waitForDom(() => view.dom.querySelector(".cm-md-html-image-fallback") !== null);

    const fallback = view.dom.querySelector<HTMLElement>(".cm-md-html-image-fallback");
    expect(fallback?.dataset.mdAssetState).toBe("unavailable");
    expect(fallback?.getAttribute("role")).toBe("img");
    expect(fallback?.getAttribute("aria-label")).toBe("Missing logo");
    expect(fallback?.textContent).toBe("Missing logo");
    expect(view.dom.querySelector(".cm-md-html-rendered-surface img")).toBeNull();
  });

  it("never reassembles an HTML flow across a non-HTML parser node", () => {
    const source = "<div>\n\nMarkdown child\n\n</div>";
    const first = getMarkdownHtmlBlock(createState(source), 1);

    expect(first).toMatchObject({
      source: "<div>",
      status: "incomplete",
    });
    expect(first?.to).toBe(source.indexOf("\n"));
  });

  it("keeps adjacent already-complete HTML blocks as independent plans", () => {
    const source = "<div>one</div>\n\n<section>two</section>";
    const entries = getMarkdownPlanIndex(createState(source))
      .filter(({ element }) => element.kind === "htmlBlock");

    expect(entries.map(({ plan }) => plan.sourceRange)).toEqual([
      { from: 0, to: source.indexOf("\n") },
      { from: source.indexOf("<section>"), to: source.length },
    ]);
    expect(entries.every(({ plan }) => plan.presentation === "blockAtom")).toBe(true);
  });

  it("returns one exact malformed flow when a later HTML fragment mismatches the open stack", () => {
    const source = "<div>\n\n<section>value</div>";
    const entries = getMarkdownPlanIndex(createState(source))
      .filter(({ element }) => element.kind === "htmlBlock");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.plan).toMatchObject({
      presentation: "visibleSource",
      sourceRange: { from: 0, to: source.length },
      diagnostics: [{ code: "htmlBlock.malformed" }],
    });
  });

  it.each([
    ["malformed", "<div><span>x</div></span>", "htmlBlock.malformed"],
    ["browser-repaired", "<p><div>x</div></p>", "htmlBlock.malformed"],
    ["blocked", "<script>alert(1)</script>", "htmlBlock.blocked-tag"],
    ["unknown", "<my-widget>\nvalue\n</my-widget>", "htmlBlock.unsupported-tag"],
    ["special", "<!-- note -->", "htmlBlock.unsupported"],
  ] as const)("keeps %s block source visible before mounting", (_name, source, code) => {
    const plan = getHtmlPlan(createState(source));
    expect(plan).toMatchObject({
      presentation: "visibleSource",
      diagnostics: [{ code }],
    });
  });

  it("compiles one safe block profile into both editable and read-only snapshots", () => {
    const source = "<div>\n<strong>safe</strong>\n</div>";
    const editable = getMarkdownConformanceSnapshot(createState(source, { readOnly: false }));
    const readOnly = getMarkdownConformanceSnapshot(createState(source, { readOnly: true }));
    expect(readOnly).toEqual(editable);
    expect(editable.entries.find(({ kind }) => kind === "htmlBlock")).toMatchObject({
      presentation: "blockAtom",
      htmlProfile: "safe-block",
      diagnosticCodes: [],
    });
    expect(JSON.parse(JSON.stringify(editable))).toEqual(editable);
  });

  it("keeps classification immutable while each surface only reduces capability", () => {
    const source = "<div>\n<strong>safe</strong>\n</div>";
    const snapshot = getMarkdownConformanceSnapshot(createState(source));
    const surfaces: MarkdownConformanceSurface[] = [
      "live-editable",
      "live-read-only",
      "fragment",
      "export",
      "index",
    ];
    const htmlBySurface = new Map(surfaces.map((surface) => [
      surface,
      projectMarkdownConformanceSurface(snapshot, surface).find(({ kind }) => kind === "htmlBlock")!,
    ]));
    const immutable = Array.from(htmlBySurface.values()).map((entry) => ({
      kind: entry.kind,
      from: entry.from,
      to: entry.to,
      presentation: entry.presentation,
      diagnosticCodes: entry.diagnosticCodes,
      htmlProfile: entry.htmlProfile,
    }));
    expect(immutable.every((entry) => JSON.stringify(entry) === JSON.stringify(immutable[0]))).toBe(true);
    expect(htmlBySurface.get("live-editable")?.disposition).toBe("render");
    expect(htmlBySurface.get("live-read-only")?.disposition).toBe("render");
    expect(htmlBySurface.get("fragment")?.disposition).toBe("preserve-source");
    expect(htmlBySurface.get("export")?.disposition).toBe("preserve-source");
    expect(htmlBySurface.get("index")?.disposition).toBe("semantic-only");
  });

  it("never lets a surface upgrade an unsupported HTML result", () => {
    const snapshot = getMarkdownConformanceSnapshot(createState("<script>alert(1)</script>"));
    for (const surface of [
      "live-editable",
      "live-read-only",
      "fragment",
      "export",
      "index",
    ] as const) {
      expect(projectMarkdownConformanceSurface(snapshot, surface)
        .find(({ kind }) => kind === "htmlBlock")).toMatchObject({
          presentation: "visibleSource",
          disposition: "preserve-source",
          diagnosticCodes: ["htmlBlock.blocked-tag"],
        });
    }
  });

  it.each([false, true])("renders safe blocks without an unavailable card (readOnly=%s)", (readOnly) => {
    const view = mountLive("<div>\n<strong>safe</strong>\n</div>", readOnly);
    expect(view.dom.querySelector(".cm-md-html-rendered-surface")).not.toBeNull();
    expect(view.dom.querySelector(".cm-md-html-unsupported")).toBeNull();
    expect(view.dom.textContent).toContain("safe");
  });

  it.each([false, true])("leaves unsupported blocks as editor source (readOnly=%s)", (readOnly) => {
    const source = "<my-widget>\nvalue\n</my-widget>";
    const view = mountLive(source, readOnly);
    expect(view.dom.querySelector(".cm-md-html-widget")).toBeNull();
    expect(view.dom.querySelector(".cm-md-html-unsupported")).toBeNull();
    expect(view.state.doc.toString()).toBe(source);
    expect(view.dom.textContent).toContain("<my-widget>");
    expect(view.dom.textContent).toContain("value");
    expect(view.dom.textContent).toContain("</my-widget>");
  });

  it("reduces media to visible source when a surface lacks Asset Broker capability", () => {
    const source = '<img src="assets/a.png" alt="a">';
    expect(getHtmlPlan(createState(source))).toMatchObject({
      presentation: "visibleSource",
      diagnostics: [{ code: "htmlBlock.asset-broker-unavailable" }],
    });
    expect(getHtmlPlan(createState(source, { assetResolver: inertAssetResolver }))).toMatchObject({
      presentation: "blockAtom",
      embed: { kind: "htmlBlock", profile: "safe-block-with-media" },
    });
  });

  it("keeps ordinary GFM component-like HTML honest instead of mounting HTML errors", () => {
    const source = "<Tabs>\n<Tab>one</Tab>\n</Tabs>";
    const snapshot = getMarkdownConformanceSnapshot(createState(source, { dialect: "puppy-gfm" }));
    expect(snapshot.entries.find(({ kind }) => kind === "htmlBlock")).toMatchObject({
      presentation: "visibleSource",
      diagnosticCodes: ["htmlBlock.unsupported-tag"],
    });
  });

  it.each([
    ["safe inline", '<span style="color:red">safe</span>', "SPAN", "safe"],
    ["blocked inline", "<script>alert(1)</script>", null, "<script>alert(1)</script>"],
    ["malformed inline", "<span><em>x</span></em>", null, "<span><em>x</span></em>"],
    ["unknown inline", "<my-widget>x</my-widget>", null, "<my-widget>x</my-widget>"],
  ] as const)("uses the shared policy in the fragment surface: %s", (_name, source, tag, text) => {
    const target = document.createElement("div");
    renderMarkdownInlineFromSharedPolicy(target, source);
    expect(target.firstElementChild?.tagName ?? null).toBe(tag);
    expect(target.textContent).toBe(text);
  });
});

async function waitForDom(assertion: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for Markdown HTML DOM state.");
}
