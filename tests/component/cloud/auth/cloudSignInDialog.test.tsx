/** @vitest-environment happy-dom */
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopWindowChrome } from "../../../../src/components/DesktopWindowChrome";
import {
  WindowNavigationProvider,
  type WindowNavigation,
} from "../../../../src/components/WindowNavigation";
import { OnboardingHeaderBrand } from "../../../../src/components/onboarding/OnboardingBrandLockup";
import { closeCloudSignInDialog } from "../../../../src/features/cloud";
import { HeaderSignInButton } from "../../../../src/features/cloud/workbench/CloudAccountButton";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import {
  clearDesktopCloudSession,
  type DesktopCloudAuthState,
} from "../../../../src/lib/cloudSession";
import zhHansCatalog from "../../../../src/localization/catalog-loaders/zh-Hans";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { testT, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const SESSION: DesktopCloudSession = {
  api_base_url: API,
  user_id: "alice",
  user_email: "alice@example.com",
  session_generation: "one",
  expires_in: 3600,
  expires_at: Date.now() + 3_600_000,
  status: "authenticated",
};

let root: Root;
let startCloudOAuth: ReturnType<typeof vi.fn>;
let authListeners: Set<(state: DesktopCloudAuthState) => void>;
let errorListeners: Set<(payload: { message?: string }) => void>;

function signedOutNavigation(session: DesktopCloudSession | null = null): WindowNavigation {
  return {
    account: {
      session,
      apiBaseUrl: API,
      onOpenAccount: vi.fn(),
    },
    spaces: [],
    onShowPlace: vi.fn(),
    trailing: session ? null : <HeaderSignInButton apiBaseUrl={API} />,
  };
}

async function renderShell(
  session: DesktopCloudSession | null = null,
  locale: "en" | "zh-Hans" = "en",
) {
  const tree: ReactNode = (
    <WindowNavigationProvider value={signedOutNavigation(session)}>
      <DesktopWindowChrome />
      <OnboardingHeaderBrand />
    </WindowNavigationProvider>
  );
  await act(async () => {
    root.render(
      locale === "zh-Hans" ? (
        <TestLocalizationProvider locale="zh-Hans" messages={zhHansCatalog}>
          {tree}
        </TestLocalizationProvider>
      ) : (
        withTestLocalization(tree)
      ),
    );
  });
}

async function click(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element).not.toBeNull();
  await act(async () => {
    element!.click();
  });
}

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
  closeCloudSignInDialog();
  authListeners = new Set();
  errorListeners = new Set();
  startCloudOAuth = vi.fn(async () => {
    for (const listener of authListeners) {
      listener({ status: "signing-in", session: null });
    }
  });
  window.puppyoneDesktop = {
    startCloudOAuth,
    readCloudSession: vi.fn(async () => null),
    clearCloudSession: vi.fn(async () => {}),
    onCloudAuthStateChanged: (listener: (state: DesktopCloudAuthState) => void) => {
      authListeners.add(listener);
      return () => authListeners.delete(listener);
    },
    onCloudAuthError: (listener: (payload: { message?: string }) => void) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
  } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  closeCloudSignInDialog();
  await clearDesktopCloudSession();
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Cloud sign-in explainer dialog", () => {
  it("opens the explainer dialog on Header Sign in without starting OAuth until confirmed", async () => {
    await renderShell(null, "zh-Hans");
    expect(document.querySelector(".cloud-sign-in-dialog")).toBeNull();

    await click(".homepage-cloud-sign-in");
    expect(startCloudOAuth).not.toHaveBeenCalled();

    const dialog = document.querySelector<HTMLElement>(".cloud-sign-in-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.querySelector(".cloud-sign-in-eyebrow")?.textContent).toBe("Puppyone Cloud");
    expect(dialog?.querySelector(".onboarding-value-hub-label")?.textContent).toBe("Puppyone Cloud");
    expect(dialog?.querySelectorAll(".onboarding-value-agent")).toHaveLength(7);

    const activeMoment = dialog?.querySelector(".cloud-sign-in-moment.is-active");
    expect(activeMoment?.querySelector("h2")?.textContent).toBe("放在云上，\n所有 Agent 都能用");
    expect(activeMoment?.querySelector("p")?.textContent).toBe(
      "Claude、ChatGPT、Codex 直接访问，手机上也能随时打开。",
    );
    expect(dialog?.querySelector(".cloud-sign-in-primary")?.textContent).toBe("登录，开启 Cloud");
    expect(dialog?.querySelector(".cloud-sign-in-later")?.textContent).toBe("以后再说");

    await click(".cloud-sign-in-primary");
    expect(startCloudOAuth).toHaveBeenCalledWith({
      apiBaseUrl: API,
      provider: undefined,
    });
    expect(dialog?.querySelector('[role="status"]')?.textContent).toContain("请在浏览器中完成登录");
  });

  it("auto-advances and loops across the two Cloud moments and switches on dot click", async () => {
    await renderShell(null, "zh-Hans");
    await click(".homepage-cloud-sign-in");

    const dialog = document.querySelector<HTMLElement>(".cloud-sign-in-dialog")!;
    expect(dialog.querySelector('[data-value-slide="cloud"]')?.classList.contains("is-active")).toBe(true);
    expect(dialog.querySelector('[data-value-slide="share"]')?.classList.contains("is-active")).toBe(false);

    // Advance from Moment 0 (4s) -> Moment 1 (5s, Grok Bot scene).
    const firstProgress = dialog.querySelector<HTMLElement>(".onboarding-value-dot.is-active > i")!;
    expect(firstProgress.style.getPropertyValue("--onboarding-slide-seconds")).toBe("4s");
    await act(async () => {
      firstProgress.dispatchEvent(new Event("animationend", { bubbles: true }));
    });

    expect(dialog.querySelector('[data-value-slide="share"]')?.classList.contains("is-active")).toBe(true);
    expect(dialog.querySelector(".onboarding-scene-phone-app")?.textContent).toBe("Grok Bot");
    expect(
      dialog.querySelector<HTMLImageElement>(".onboarding-scene-phone-app img")?.getAttribute("src"),
    ).toContain("grok-bot.webp");
    expect(dialog.querySelector(".onboarding-scene-changed")?.textContent).toBe("Grok Bot 改了这里");

    const secondMoment = dialog.querySelector(".cloud-sign-in-moment.is-active")!;
    expect(secondMoment.querySelector("h2")?.textContent).toBe("一条链接，\n交给任何人和 Agent");
    expect(secondMoment.querySelector("p")?.textContent).toBe(
      "发短信给同事，或者发给你的 Grok\u00a0Bot，对方点开就能看、能接着改。",
    );

    // Loop back from Moment 1 -> Moment 0.
    const secondProgress = dialog.querySelector<HTMLElement>(".onboarding-value-dot.is-active > i")!;
    expect(secondProgress.style.getPropertyValue("--onboarding-slide-seconds")).toBe("5s");
    await act(async () => {
      secondProgress.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(dialog.querySelector('[data-value-slide="cloud"]')?.classList.contains("is-active")).toBe(true);

    // Selecting a dot switches moments directly.
    const dots = dialog.querySelectorAll<HTMLButtonElement>(".onboarding-value-dot");
    expect(dots).toHaveLength(2);
    await act(async () => {
      dots[1]!.click();
    });
    expect(dialog.querySelector('[data-value-slide="share"]')?.classList.contains("is-active")).toBe(true);
  });

  it("opens the same explainer dialog when choosing Sign in from the Header place menu", async () => {
    await renderShell(null, "en");
    await click(".onboarding-header-brand");
    expect(document.querySelector('[data-account-row="sign-in"]')).not.toBeNull();

    await click('[data-account-row="sign-in"]');
    // The menu closes while the explainer dialog stays mounted at window level.
    expect(document.querySelector('[data-account-row="sign-in"]')).toBeNull();
    expect(startCloudOAuth).not.toHaveBeenCalled();

    const dialog = document.querySelector<HTMLElement>(".cloud-sign-in-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector(".cloud-sign-in-moment.is-active h2")?.textContent).toBe(
      testT("cloud.auth.explainer.cloud.title"),
    );

    // Dismissing via "Maybe later" closes without starting OAuth.
    await click(".cloud-sign-in-later");
    expect(document.querySelector(".cloud-sign-in-dialog")).toBeNull();
    expect(startCloudOAuth).not.toHaveBeenCalled();
  });

  it("dismisses on Escape or close button, surfaces OAuth errors, and closes automatically once signed in", async () => {
    await renderShell(null, "en");
    await click(".homepage-cloud-sign-in");
    expect(document.querySelector(".cloud-sign-in-dialog")).not.toBeNull();

    await click(".cloud-sign-in-close");
    expect(document.querySelector(".cloud-sign-in-dialog")).toBeNull();

    await click(".homepage-cloud-sign-in");
    expect(document.querySelector(".cloud-sign-in-dialog")).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector(".cloud-sign-in-dialog")).toBeNull();

    // Reopen, trigger an OAuth error, then retry and complete sign-in.
    await click(".homepage-cloud-sign-in");
    await click(".cloud-sign-in-primary");
    expect(startCloudOAuth).toHaveBeenCalledTimes(1);

    await act(async () => {
      for (const listener of errorListeners) {
        listener({ message: "Browser handoff failed" });
      }
    });
    expect(document.querySelector('.cloud-sign-in-dialog [role="alert"]')?.textContent).toContain(
      "Browser handoff failed",
    );

    // Clicking again reopens browser sign-in, and completing auth closes the dialog automatically.
    await click(".cloud-sign-in-primary");
    expect(startCloudOAuth).toHaveBeenCalledTimes(2);
    await act(async () => {
      for (const listener of authListeners) {
        listener({ status: "authenticated", session: SESSION });
      }
    });
    expect(document.querySelector(".cloud-sign-in-dialog")).toBeNull();
  });
});
