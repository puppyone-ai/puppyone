import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { puppyMarkdownFeatureCompositionExtension, puppyMarkdownParserExtensions } from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import { createEmbeddedEditSessionStore } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embeddedEditSession";
import { createWidgetSessionRegistry } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/widgetSession";

import { createAsyncRenderBroker } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/brokers/asyncRenderBroker";
import { createLinkBroker } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/brokers/linkBroker";
import { createTransactionBroker, getDocRevision } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/brokers/transactionBroker";
import { createWebEmbedBroker } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/brokers/webEmbedBroker";
import { MARKDOWN_HTML_PROFILE_VERSION } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownHtmlProfiles";
import { createDocumentTrustContext, evaluateAuthorizationGrant } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownTrustPolicy";
import { createCapabilityPrincipal, workspaceIdForDocument } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/security/capabilityPrincipal";
import { createExecutionSessionStore } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/sessions/executionSession";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

describe("Markdown embed runtime foundations", () => {
  it("rejects embedded commits from a stale base revision", () => {
    const state = EditorState.create({ doc: "```ts\nold\n```" });
    const view = { state, dispatch: () => { throw new Error("stale commit dispatched"); } } as never;
    const broker = createTransactionBroker();

    expect(broker.buildCommit(view, {
      mappedRange: { from: 0, to: state.doc.length },
      baseSource: state.doc.toString(),
      baseRevision: "stale-revision",
      nextSource: "```ts\nnew\n```",
    })).toBeNull();
    expect(broker.commit(view, {
      mappedRange: { from: 0, to: state.doc.length },
      baseSource: state.doc.toString(),
      baseRevision: "stale-revision",
      nextSource: "```ts\nnew\n```",
    })).toEqual({ ok: false, mappedTo: null });
    expect(getDocRevision(state.doc)).not.toBe("stale-revision");
  });

  it("disposes widget sessions by exact DOM node and disposeAll", () => {
    const registry = createWidgetSessionRegistry();
    const domA = {} as HTMLElement;
    const domB = {} as HTMLElement;
    let disposedA = 0;
    let disposedB = 0;

    registry.mount(domA, () => ({ dispose: () => { disposedA += 1; } }));
    registry.mount(domB, () => ({ dispose: () => { disposedB += 1; } }));
    registry.dispose(domA);
    expect(disposedA).toBe(1);
    expect(disposedB).toBe(0);

    registry.disposeAll();
    expect(disposedB).toBe(1);
  });

  it("keeps embedded edit sessions range-mapped and revision-aware", () => {
    const store = createEmbeddedEditSessionStore();
    store.set({
      elementId: "table:0",
      featureId: "tables",
      mappedRange: { from: 10, to: 40 },
      baseSource: "| a | b |",
      baseRevision: "rev-1",
      draft: { text: "x" },
      mode: "editing",
    });
    store.mapRanges((pos) => pos + 5);
    expect(store.get("table:0")?.mappedRange).toEqual({ from: 15, to: 45 });
  });

  it("defaults external web embeds to click-to-load and blocks non-https", async () => {
    const broker = createWebEmbedBroker();
    const principal = createCapabilityPrincipal({
      editorViewId: "view-1",
      workspaceId: "ws",
      documentPath: "note.md",
      documentRevision: "1",
      purpose: "web-embed",
    });

    const https = broker.create({
      principal,
      href: "https://example.com",
      privacyProfile: "temporary-no-credential",
    });
    expect(https.state).toBe("click-to-load");
    expect((await broker.activate(https.id))?.state).toBe("loaded");

    const blocked = broker.create({
      principal,
      href: "file:///tmp/x.html",
      privacyProfile: "temporary-no-credential",
    });
    expect(blocked.state).toBe("blocked");
  });

  it("binds native web embeds to an exact capability revision and revokes stale sessions", async () => {
    const created: Array<Record<string, unknown>> = [];
    const destroyed: string[] = [];
    const runtime = globalThis as typeof globalThis & { puppyoneDesktop?: unknown };
    runtime.puppyoneDesktop = {
      markdownWebEmbed: {
        async create(request: Record<string, unknown>) {
          created.push(request);
          return { id: "native-1" };
        },
        async setBounds() {},
        async destroy({ id }: { id: string }) {
          destroyed.push(id);
        },
      },
    };

    try {
      const broker = createWebEmbedBroker();
      const principal = createCapabilityPrincipal({
        editorViewId: "view-1",
        workspaceId: "ws",
        documentPath: "note.md",
        documentRevision: "revision-1",
        purpose: "web-embed",
      });
      const session = broker.create({
        principal,
        href: "https://example.com/embed",
        privacyProfile: "temporary-no-credential",
      });
      await broker.activate(session.id, { x: 1, y: 2, width: 300, height: 200 });
      expect(created[0]).toMatchObject({
        capability: {
          editorViewId: "view-1",
          workspaceId: "ws",
          documentPath: "note.md",
          documentRevision: "revision-1",
          purpose: "web-embed",
        },
      });

      broker.destroyStaleRevision("view-1", "revision-2");
      await Promise.resolve();
      expect(destroyed).toEqual(["native-1"]);
      expect(session.state).toBe("destroyed");
    } finally {
      delete runtime.puppyoneDesktop;
    }
  });

  it("single-flights repeated activation of one native web embed", async () => {
    let createCalls = 0;
    let finishCreate: ((value: { id: string }) => void) | undefined;
    const createResult = new Promise<{ id: string }>((resolve) => {
      finishCreate = resolve;
    });
    const runtime = globalThis as typeof globalThis & { puppyoneDesktop?: unknown };
    runtime.puppyoneDesktop = {
      markdownWebEmbed: {
        async create() {
          createCalls += 1;
          return createResult;
        },
        async setBounds() {},
        async destroy() {},
      },
    };

    try {
      const broker = createWebEmbedBroker();
      const principal = createCapabilityPrincipal({
        editorViewId: "view-single-flight",
        workspaceId: "ws",
        documentPath: "note.md",
        documentRevision: "revision-1",
        purpose: "web-embed",
      });
      const session = broker.create({
        principal,
        href: "https://example.com/embed",
        privacyProfile: "temporary-no-credential",
      });

      const first = broker.activate(session.id);
      const second = broker.activate(session.id);
      expect(createCalls).toBe(1);
      finishCreate?.({ id: "native-single" });
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult).toBe(session);
      expect(secondResult).toBe(session);
      expect((await broker.activate(session.id))?.nativeViewId).toBe("native-single");
      expect(createCalls).toBe(1);
      broker.disposeAll();
    } finally {
      delete runtime.puppyoneDesktop;
    }
  });

  it("deduplicates async render work by principal-scoped key", async () => {
    const broker = createAsyncRenderBroker();
    let runs = 0;
    const principal = createCapabilityPrincipal({
      editorViewId: "view-1",
      workspaceId: "ws",
      documentPath: "note.md",
      documentRevision: "1",
      purpose: "async-render",
    });
    const key = {
      featureId: "mermaid",
      elementKey: "1",
      source: "graph TD;A-->B",
      themeKey: "dark",
      policyVersion: MARKDOWN_HTML_PROFILE_VERSION,
      principalKey: principal.editorViewId,
    };

    const [first, second] = await Promise.all([
      broker.run({
        key,
        principal,
        run: async () => {
          runs += 1;
          return "svg";
        },
      }),
      broker.run({
        key,
        principal,
        run: async () => {
          runs += 1;
          return "svg";
        },
      }),
    ]);

    expect(runs).toBe(1);
    expect(first?.value).toBe("svg");
    expect(second?.value).toBe("svg");
  });

  it("destroys execution sessions bound to a superseded revision", () => {
    let destroyed = 0;
    const store = createExecutionSessionStore({ onDestroy: () => { destroyed += 1; } });
    const base = createCapabilityPrincipal({
      editorViewId: "view-1",
      workspaceId: "ws",
      documentPath: "note.md",
      documentRevision: "10:1",
      purpose: "web-embed",
    });

    const oldSession = store.create({ principal: base, documentRevision: "10:1", grantId: "grant-1" });
    expect(oldSession.principal.executionSessionId).toBe(oldSession.id);
    // A fresh session recreated against the new revision must survive.
    const newSession = store.create({ principal: base, documentRevision: "12:1", grantId: "grant-1" });

    const gone = store.destroyForRevisionChange("10:1", "12:1");
    expect(gone.map((session) => session.id)).toEqual([oldSession.id]);
    expect(store.get(oldSession.id)).toBeUndefined();
    expect(store.get(newSession.id)).toBeDefined();
    expect(destroyed).toBe(1);
    expect(oldSession.grantId).toBe("grant-1"); // grant is independent of the session
  });

  it("requires an explicit grant for local active HTML (independent of revision)", () => {
    const principal = createCapabilityPrincipal({
      editorViewId: "view-1",
      workspaceId: "ws",
      documentPath: "note.md",
      documentRevision: "1:1",
      purpose: "web-embed",
    });

    // Safe trust mode: never granted, sanitized only.
    expect(
      evaluateAuthorizationGrant(
        createDocumentTrustContext({
          workspaceId: "ws",
          documentPath: "note.md",
          provenance: "local-workspace",
          explicitGrants: [],
        }),
        principal,
        "local-active-html",
      ),
    ).toBeNull();

    // Provenance / localTrusted alone is NOT a grant.
    expect(
      evaluateAuthorizationGrant(
        createDocumentTrustContext({
          workspaceId: "ws",
          documentPath: "note.md",
          provenance: "local-workspace",
          explicitGrants: [],
        }),
        principal,
        "local-active-html",
      ),
    ).toBeNull();

    const granted = evaluateAuthorizationGrant(
      createDocumentTrustContext({
        workspaceId: "ws",
        documentPath: "note.md",
        provenance: "local-workspace",
        explicitGrants: ["local-active-html"],
      }),
      principal,
      "local-active-html",
    );
    expect(granted).not.toBeNull();
    expect(granted?.capability).toBe("local-active-html");
    expect(granted?.revoked).toBe(false);
  });

  it("routes link intents through the link broker", () => {
    const broker = createLinkBroker({
      resolveInternal: (_documentPath, href) => href.endsWith(".md") ? href : null,
    });
    const principal = createCapabilityPrincipal({
      editorViewId: "view-1",
      workspaceId: workspaceIdForDocument("note.md"),
      documentPath: "note.md",
      documentRevision: "1",
      purpose: "link-open",
    });

    expect(workspaceIdForDocument("note.md")).toBe("doc:note.md");
    expect(broker.resolve(principal, "other.md")).toEqual({
      action: "navigate-internal",
      path: "other.md",
    });
    expect(broker.resolve(principal, "https://example.com")).toEqual({
      action: "open-external",
      href: "https://example.com/",
    });
    expect(broker.resolve(principal, "javascript:alert(1)").action).toBe("deny");

    // The production EmbedHost uses the default broker. Relative links must
    // still be classified as internal and delegated to the host link graph.
    expect(createLinkBroker().resolve(principal, "other.md")).toEqual({
      action: "navigate-internal",
      path: "other.md",
    });
  });
});
