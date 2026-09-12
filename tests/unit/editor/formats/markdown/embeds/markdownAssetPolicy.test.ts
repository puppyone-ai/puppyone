import { describe, expect, it } from "vitest";
import {
  evaluateMarkdownAssetHref,
  isBrokerSafeResolvedAssetUrl,
  isPathInsideWorkspaceRoot,
  resolveWorkspaceRelativePath,
} from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownAssetPolicy";
import { createAssetBroker } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/brokers/assetBroker";
import { createCapabilityPrincipal } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/security/capabilityPrincipal";
import {
  allowsLocalActiveHtml,
  createDocumentTrustContext,
  evaluateAuthorizationGrant,
} from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownTrustPolicy";
import { createExecutionSessionStore } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/sessions/executionSession";

describe("markdownAssetPolicy", () => {
  it("denies file:// and executable schemes", () => {
    expect(evaluateMarkdownAssetHref("file:///tmp/x.png", { documentPath: "a.md" }).ok).toBe(false);
    expect(evaluateMarkdownAssetHref("javascript:alert(1)", { documentPath: "a.md" }).ok).toBe(false);
  });

  it("denies svg data URLs and oversized data images", () => {
    expect(evaluateMarkdownAssetHref("data:image/svg+xml,<svg></svg>", { documentPath: "a.md" }).ok).toBe(false);
    const huge = `data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`;
    expect(evaluateMarkdownAssetHref(huge, { documentPath: "a.md" }).ok).toBe(false);
  });

  it("allows small raster data images", () => {
    const result = evaluateMarkdownAssetHref("data:image/png;base64,aaaa", { documentPath: "a.md" });
    expect(result).toMatchObject({ ok: true, kind: "data-image", mimeType: "image/png" });
  });

  it("rejects workspace escape via ..", () => {
    expect(resolveWorkspaceRelativePath("notes/a.md", "../../etc/passwd")).toBeNull();
    expect(resolveWorkspaceRelativePath("notes/a.md", "../bad%ZZ.png")).toBeNull();
    expect(resolveWorkspaceRelativePath("notes/a.md", "../images%2Fsecret.png")).toBeNull();
    expect(
      evaluateMarkdownAssetHref("../../../secret.png", {
        documentPath: "notes/a.md",
        workspaceRoot: "/Users/example/workspace",
      }).ok,
    ).toBe(false);
  });

  it("keeps workspace-relative document paths when the host root is absolute", () => {
    expect(isPathInsideWorkspaceRoot("/ws", "/ws/img/a.png")).toBe(true);
    expect(isPathInsideWorkspaceRoot("/ws", "/other/a.png")).toBe(false);
    const result = evaluateMarkdownAssetHref("./img/a.png", {
      documentPath: "notes/doc.md",
      workspaceRoot: "/Users/example/workspace",
    });
    expect(result).toMatchObject({ ok: true, kind: "workspace-relative", path: "notes/img/a.png" });
  });

  it("denies remote tracking loads and ambient capability URLs by default", () => {
    expect(evaluateMarkdownAssetHref("https://tracker.example/pixel.gif", { documentPath: "a.md" }))
      .toEqual({ ok: false, reason: "remote-load-denied" });
    expect(evaluateMarkdownAssetHref("blob:https://app.example/id", { documentPath: "a.md" }).ok).toBe(false);
    expect(evaluateMarkdownAssetHref("puppyone-local://file/token/root/a.png", { documentPath: "a.md" }).ok).toBe(false);
  });

  it("allows canonical credential-free HTTPS only with the explicit passive-image policy", () => {
    expect(evaluateMarkdownAssetHref("https://example.com/a.png", {
      documentPath: "a.md",
      remotePolicy: "https-only",
    })).toMatchObject({ ok: true, kind: "safe-direct", url: "https://example.com/a.png" });
    expect(evaluateMarkdownAssetHref("https://user:pass@example.com/a.png", {
      documentPath: "a.md",
      remotePolicy: "https-only",
    }).ok).toBe(false);
    expect(evaluateMarkdownAssetHref("http://example.com/a.png", {
      documentPath: "a.md",
      remotePolicy: "https-only",
    }).ok).toBe(false);
  });

  it("never treats file:// as a safe resolved broker URL", () => {
    expect(isBrokerSafeResolvedAssetUrl("file:///tmp/x.png")).toBe(false);
    expect(isBrokerSafeResolvedAssetUrl("blob:https://x/1")).toBe(true);
  });

  it("keeps image and video policy capabilities distinct", () => {
    expect(evaluateMarkdownAssetHref("assets/clip.mp4", { documentPath: "notes/a.md" }, "video"))
      .toMatchObject({ ok: true, kind: "workspace-relative", mimeType: "video/mp4" });
    expect(evaluateMarkdownAssetHref("assets/clip.mp4", { documentPath: "notes/a.md" }, "image"))
      .toEqual({ ok: false, reason: "media-kind-mismatch" });
    expect(evaluateMarkdownAssetHref("assets/poster.png", { documentPath: "notes/a.md" }, "video"))
      .toEqual({ ok: false, reason: "media-kind-mismatch" });
    expect(evaluateMarkdownAssetHref("data:video/mp4;base64,AAAA", { documentPath: "a.md" }, "video"))
      .toEqual({ ok: false, reason: "data-media-kind-denied" });
  });
});

describe("AssetBroker policy gate", () => {
  it("keeps remote scheme authority in broker configuration, not feature requests", async () => {
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "README.md",
      documentRevision: "rev-1",
      purpose: "asset-read",
    });
    const denied = createAssetBroker(null);
    const passiveImages = createAssetBroker(null, {
      remotePolicy: { image: "https-only", video: "deny" },
    });

    expect(await denied.resolve({
      kind: "image",
      principal,
      sourcePath: "README.md",
      href: "https://img.shields.io/badge/Docs-Read-blue",
    })).toBeNull();
    expect(await passiveImages.resolve({
      kind: "image",
      principal,
      sourcePath: "README.md",
      href: "https://img.shields.io/badge/Docs-Read-blue",
    })).toMatchObject({
      kind: "image",
      url: "https://img.shields.io/badge/Docs-Read-blue",
    });
    expect(await passiveImages.resolve({
      kind: "video",
      principal,
      sourcePath: "README.md",
      href: "https://example.com/demo.mp4",
    })).toBeNull();
  });

  it("does not call the host resolver for denied hrefs", async () => {
    let calls = 0;
    const broker = createAssetBroker(async () => {
      calls += 1;
      return "blob:denied";
    });
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "a.md",
      documentRevision: "1:1",
      purpose: "asset-read",
    });
    const handle = await broker.resolve({
      kind: "image",
      principal,
      sourcePath: "a.md",
      href: "file:///tmp/x.png",
    });
    expect(handle).toBeNull();
    expect(calls).toBe(0);
  });

  it("drops file:// results even if the host resolver returns them", async () => {
    const broker = createAssetBroker(async () => "file:///tmp/x.png");
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "a.md",
      documentRevision: "1:1",
      purpose: "asset-read",
    });
    const handle = await broker.resolve({
      kind: "image",
      principal,
      sourcePath: "a.md",
      href: "./x.png",
      workspaceRoot: null,
    });
    expect(handle).toBeNull();
  });

  it("rejects the wrong capability purpose or a mismatched source document", async () => {
    let calls = 0;
    const broker = createAssetBroker(async () => {
      calls += 1;
      return "puppyone-local://file/token/root/x.png";
    });
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "a.md",
      documentRevision: "rev-1",
      purpose: "link-open",
    });
    expect(await broker.resolve({ kind: "image", principal, sourcePath: "a.md", href: "./x.png" })).toBeNull();
    expect(await broker.resolve({
      kind: "image",
      principal: { ...principal, purpose: "asset-read" },
      sourcePath: "other.md",
      href: "./x.png",
    })).toBeNull();
    expect(calls).toBe(0);
  });

  it("propagates handle revocation to the host capability lease", async () => {
    let revoked = 0;
    const broker = createAssetBroker(async () => ({
      url: "puppyone-local://file/token/markdown-asset/root/images/a.png",
      revoke: () => {
        revoked += 1;
      },
    }));
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "notes/a.md",
      documentRevision: "rev-1",
      purpose: "asset-read",
    });
    const handle = await broker.resolve({
      kind: "image",
      principal,
      sourcePath: "notes/a.md",
      href: "../images/a.png",
    });

    expect(handle).not.toBeNull();
    handle?.revoke();
    handle?.revoke();
    await Promise.resolve();
    expect(revoked).toBe(1);
  });

  it("revokes a host lease when the resolver result fails sink validation", async () => {
    let revoked = 0;
    const broker = createAssetBroker(async () => ({
      url: "file:///tmp/unsafe.png",
      revoke: () => {
        revoked += 1;
      },
    }));
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "a.md",
      documentRevision: "rev-1",
      purpose: "asset-read",
    });

    expect(await broker.resolve({
      kind: "image",
      principal,
      sourcePath: "a.md",
      href: "./unsafe.png",
    })).toBeNull();
    await Promise.resolve();
    expect(revoked).toBe(1);
  });
});

describe("trust + execution sessions", () => {
  it("requires an explicit local-active-html grant", () => {
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "a.md",
      documentRevision: "1:1",
      purpose: "web-embed",
    });
    const denied = createDocumentTrustContext({
      workspaceId: "ws",
      documentPath: "a.md",
      explicitGrants: [],
    });
    const granted = createDocumentTrustContext({
      workspaceId: "ws",
      documentPath: "a.md",
      explicitGrants: ["local-active-html"],
    });
    expect(allowsLocalActiveHtml(denied, principal)).toBe(false);
    expect(evaluateAuthorizationGrant(granted, principal, "local-active-html")?.revoked).toBe(false);
  });

  it("destroys execution sessions on revision change and revokes handles", () => {
    const revoked: string[] = [];
    const store = createExecutionSessionStore({
      onDestroy(session) {
        revoked.push(session.id);
      },
    });
    const principal = createCapabilityPrincipal({
      editorViewId: "v1",
      workspaceId: "ws",
      documentPath: "a.md",
      documentRevision: "1:1",
      purpose: "asset-read",
    });
    const session = store.create({
      principal,
      documentRevision: "1:1",
      featureId: "html-block",
    });
    store.destroyForRevisionChange("1:1", "2:1");
    expect(revoked).toEqual([session.id]);
    expect(store.values()).toHaveLength(0);
  });
});
