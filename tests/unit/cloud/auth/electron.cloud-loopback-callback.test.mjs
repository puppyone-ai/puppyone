import { describe, expect, it, vi } from "vitest";
import { startLoopbackCallbackServer } from "../../../../electron/main/auth/loopback-callback-server.mjs";
import { PAGE_COPY } from "../../../../electron/main/auth/loopback-callback-copy.mjs";

describe("desktop OAuth loopback callback", () => {
  it("has complete result and return-button copy for all eight Desktop languages", () => {
    expect(Object.keys(PAGE_COPY)).toEqual(["en", "es", "pt-BR", "fr", "de", "ja", "ko", "zh-Hans"]);
    const keys = Object.keys(PAGE_COPY.en);
    for (const copy of Object.values(PAGE_COPY)) {
      expect(Object.keys(copy)).toEqual(keys);
      expect(copy.returnButton.trim()).not.toBe("");
      expect(copy.openAppManually.trim()).not.toBe("");
      for (const key of keys.filter((value) => value !== "returnButton" && value !== "openAppManually")) {
        expect(copy[key]).toHaveLength(3);
        expect(copy[key].every((value) => typeof value === "string" && value.trim())).toBe(true);
      }
    }
  });

  it("offers a system launch fallback only for a known Desktop URL", async () => {
    await expect(startLoopbackCallbackServer({
      onCallback: async () => ({}),
      isExpectedCallback: () => true,
      returnAppUrl: "https://example.com/open",
    })).rejects.toThrow("not a PuppyOne Desktop launch URL");

    const server = await startLoopbackCallbackServer({
      onCallback: async () => ({ status: "authenticated" }),
      onReturnToApp: () => undefined,
      isExpectedCallback: () => true,
      returnAppUrl: "puppyone://open",
    });
    const response = await fetch(`${server.redirectUri}?state=state-1&code=code-1`);
    const page = await response.text();
    expect(page).toContain('href="puppyone://open"');
    expect(page).toContain('class="return-fallback" hidden');
    expect(page).toContain('form.addEventListener("submit"');
    expect(response.headers.get("content-security-policy")).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+'/u);
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    await server.close();
  });

  it("binds a random 127.0.0.1 port and forwards only the exact callback path", async () => {
    const onCallback = vi.fn(async () => ({ status: "authenticated" }));
    const onReturnToApp = vi.fn();
    const server = await startLoopbackCallbackServer({
      onCallback,
      onReturnToApp,
      isExpectedCallback: (callbackUrl) => new URL(callbackUrl).searchParams.get("state") === "state-1",
      appPath: process.cwd(),
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
    expect(response.headers.get("content-security-policy")).toContain("font-src data:");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-src 'self'");
    const page = await response.text();
    expect(page).toContain("Signed in successfully");
    expect(page).toContain("Return to PuppyOne Desktop");
    expect(page).toContain("You can close this browser tab.");
    expect(page).toContain('<svg width="128" height="128" viewBox="0 0 128 128"');
    expect(page).toContain("data:font/woff2;base64,");
    expect(page).toContain("<style>");
    expect(page).not.toContain("<script");
    expect(page).not.toContain("<img");
    expect(page).toContain('method="post"');
    expect(page).toContain('target="puppyone-return-frame"');
    expect(page).toContain('name="puppyone-return-frame"');
    await vi.waitFor(() => expect(onCallback).toHaveBeenCalledWith(callback));

    const returnPath = page.match(/action="(\/auth\/return\/[A-Za-z0-9_-]+)"/)?.[1];
    expect(returnPath).toBeTruthy();
    const replay = await fetch(callback);
    expect(replay.status).toBe(409);
    const guessedReturn = await fetch(new URL("/auth/return/invalid", server.redirectUri));
    expect(guessedReturn.status).toBe(409);
    expect(onReturnToApp).not.toHaveBeenCalled();
    const directNavigation = await fetch(new URL(returnPath, server.redirectUri));
    expect(directNavigation.status).toBe(409);
    expect(onReturnToApp).not.toHaveBeenCalled();
    const open = await fetch(new URL(returnPath, server.redirectUri), { method: "POST" });
    expect(open.status).toBe(204);
    await vi.waitFor(() => expect(onReturnToApp).toHaveBeenCalledOnce());
    const returnAgain = await fetch(new URL(returnPath, server.redirectUri), { method: "POST" });
    expect(returnAgain.status).toBe(204);
    await vi.waitFor(() => expect(onReturnToApp).toHaveBeenCalledTimes(2));
    await server.close();
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
    expect(page).toContain('<html lang="zh-Hans">');
    expect(page).toContain("登录未完成");
    expect(page).toContain("请返回应用重试");
    expect(page).not.toContain("登录成功");
    expect(page).not.toContain("/auth/return/");
  });

  it.each([
    ["es-ES,es;q=0.9", "es", "Sesión iniciada correctamente"],
    ["pt-BR,pt;q=0.9", "pt-BR", "Login realizado com sucesso"],
    ["fr-FR,fr;q=0.9", "fr", "Connexion réussie"],
    ["de-DE,de;q=0.9", "de", "Anmeldung erfolgreich"],
    ["ja-JP,ja;q=0.9", "ja", "ログインが完了しました"],
    ["ko-KR,ko;q=0.9", "ko", "로그인 완료"],
    ["zh-CN,zh;q=0.9", "zh-Hans", "登录成功"],
  ])("renders the success page in %s", async (language, locale, heading) => {
    const server = await startLoopbackCallbackServer({
      onCallback: async () => ({ status: "authenticated" }),
      isExpectedCallback: () => true,
    });
    const response = await fetch(`${server.redirectUri}?state=state-1&code=code-1`, {
      headers: { "Accept-Language": language },
    });
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain(`<html lang="${locale}">`);
    expect(page).toContain(heading);
  });

  it("uses the Desktop language preference ahead of the browser language", async () => {
    const server = await startLoopbackCallbackServer({
      onCallback: async () => ({ status: "authenticated" }),
      isExpectedCallback: () => true,
      getLocale: () => "ja",
    });
    const response = await fetch(`${server.redirectUri}?state=state-1&code=code-1`, {
      headers: { "Accept-Language": "en-US" },
    });
    expect(await response.text()).toContain("ログインが完了しました");
  });
});
