import { describe, expect, it, vi } from "vitest";
import { startLoopbackCallbackServer } from "../../../../electron/main/auth/loopback-callback-server.mjs";

describe("desktop OAuth loopback callback", () => {
  it("binds a random 127.0.0.1 port and forwards only the exact callback path", async () => {
    const onCallback = vi.fn(async () => ({ status: "authenticated" }));
    const server = await startLoopbackCallbackServer({
      onCallback,
      isExpectedCallback: (callbackUrl) => new URL(callbackUrl).searchParams.get("state") === "state-1",
    });

    expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    const wrong = await fetch(new URL("/wrong", server.redirectUri));
    expect(wrong.status).toBe(404);
    expect(onCallback).not.toHaveBeenCalled();

    const wrongState = await fetch(`${server.redirectUri}?state=wrong&code=code-1`);
    expect(wrongState.status).toBe(400);
    expect(await wrongState.text()).toContain("Sign-in could not be verified");
    expect(onCallback).not.toHaveBeenCalled();

    const callback = `${server.redirectUri}?state=state-1&code=code-1`;
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const page = await response.text();
    expect(page).toContain("Signed in successfully");
    expect(page).toContain("Return to the app to continue.");
    expect(page).toContain("<style>");
    expect(page).not.toContain("<script");
    await vi.waitFor(() => expect(onCallback).toHaveBeenCalledWith(callback));
  });

  it("shows a distinct localized failure when the Desktop exchange does not complete", async () => {
    const server = await startLoopbackCallbackServer({
      onCallback: async () => null,
      isExpectedCallback: () => true,
    });
    const response = await fetch(`${server.redirectUri}?state=state-1&code=code-1`, {
      headers: { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    });

    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('<html lang="zh">');
    expect(page).toContain("登录未完成");
    expect(page).toContain("请返回应用重试");
    expect(page).not.toContain("登录成功");
  });
});
