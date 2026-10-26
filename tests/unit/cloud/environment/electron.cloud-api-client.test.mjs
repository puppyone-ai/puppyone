import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCloudApi } from "../../../../electron/main/cloud-api-client.mjs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Electron Cloud API error transport", () => {
  it.each([
    [new TypeError("fetch failed"), "CLOUD_TRANSPORT_UNAVAILABLE"],
    [new DOMException("expired", "TimeoutError"), "CLOUD_REQUEST_TIMEOUT"],
    [new DOMException("cancelled", "AbortError"), "CLOUD_REQUEST_CANCELLED"],
  ])("classifies transport failures without retrying the request", async (cause, code) => {
    globalThis.fetch = vi.fn().mockRejectedValue(cause);
    await expect(requestCloudApi("https://api.example", "/projects/p/repository-context", { method: "POST" }))
      .rejects.toMatchObject({ code });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves timeout semantics when the response body aborts after headers", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("expired", "TimeoutError"));
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockRejectedValue(new DOMException("body aborted", "AbortError")) });
    await expect(requestCloudApi("https://api.example", "/projects/p/repository-context", { signal: controller.signal }))
      .rejects.toMatchObject({ code: "CLOUD_REQUEST_TIMEOUT" });
  });

  it("returns successful binary responses without attempting JSON decoding", async () => {
    const bytes = Uint8Array.from([0, 255, 17, 42]);
    globalThis.fetch = vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    }));

    const result = await requestCloudApi(
      "https://api.puppyone.ai/api/v1",
      "/office/sessions/session-1/result?revision=1",
      { method: "GET", responseType: "bytes" },
    );

    expect(result).toBeInstanceOf(Uint8Array);
    expect([...result]).toEqual([...bytes]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.puppyone.ai/api/v1/office/sessions/session-1/result?revision=1",
      { method: "GET" },
    );
  });

  it("puts HTTP status in the serialized message as well as the local Error", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: "Project authorization is temporarily unavailable",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    const error = await requestCloudApi(
      "http://localhost:9090/api/v1",
      "/projects/project-1",
      { method: "GET" },
    ).then(() => null, (reason) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: "Request failed (503): Project authorization is temporarily unavailable",
      status: 503,
    });
  });

  it("preserves a safe backend data.code instead of classifying every 409 alike", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      message: "The Project already accepted its first push.",
      data: { code: "initialization_not_abandonable" },
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }));

    const error = await requestCloudApi(
      "http://localhost:9090/api/v1",
      "/projects/project-1/initialization/abandon",
      { method: "POST" },
    ).then(() => null, (reason) => reason);

    expect(error).toMatchObject({
      status: 409,
      code: "initialization_not_abandonable",
    });
  });
});
