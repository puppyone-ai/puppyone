/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectShell } from "../../../../src/components/ProjectShell";
import { DesktopHelpLauncher } from "../../../../src/features/app-shell/DesktopHelpLauncher";
import { DesktopSidebarFooterNavigation } from "../../../../src/features/app-shell/navigation";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let originalDesktopBridge: Window["puppyoneDesktop"];

beforeEach(() => {
  originalDesktopBridge = window.puppyoneDesktop;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.puppyoneDesktop = originalDesktopBridge;
  vi.restoreAllMocks();
});

function renderLauncher(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => renderWithTestLocalization(root, node));
  return container;
}

describe("DesktopHelpLauncher", () => {
  it("stays a quiet icon-only question-mark button", () => {
    const container = renderLauncher(<DesktopHelpLauncher />);
    const launcher = container.querySelector(
      'button.desktop-help-launcher[aria-label="Feedback"]',
    ) as HTMLButtonElement | null;

    expect(launcher).not.toBeNull();
    expect(launcher?.type).toBe("button");
    expect(launcher?.getAttribute("data-tooltip")).toBe("Feedback");
    expect(launcher?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(launcher?.getAttribute("aria-expanded")).toBe("false");
    const iconSlot = launcher?.querySelector(".desktop-help-launcher-icon-slot");
    expect(iconSlot).not.toBeNull();
    const helpIcon = launcher?.querySelector(".desktop-feedback-help-icon");
    expect(iconSlot?.contains(helpIcon ?? null)).toBe(true);
    expect(helpIcon?.querySelector("[data-feedback-ring='true']")?.getAttribute("cx")).toBe("12");
    expect(helpIcon?.querySelector("[data-feedback-question-dot='true']")?.getAttribute("cx")).toBe("12");
    expect(helpIcon?.querySelector("[data-feedback-question-stem='true']")?.getAttribute("d")).toContain("12 13.75");
    expect(launcher?.querySelector(".desktop-help-launcher-label")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("collects required feedback and a required contact email before sending", async () => {
    const submitFeedback = vi.fn().mockResolvedValue({ ok: true });
    window.puppyoneDesktop = {
      submitFeedback,
    } as unknown as Window["puppyoneDesktop"];

    const container = renderLauncher(<DesktopHelpLauncher />);
    const launcher = container.querySelector<HTMLButtonElement>(".desktop-help-launcher");
    act(() => launcher?.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    const emailInput = dialog?.querySelector<HTMLInputElement>('.desktop-feedback-contact-input');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.closest("#desktop-overlay-root")).not.toBeNull();
    expect(launcher?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(textarea);
    expect(textarea?.placeholder).toBe("Tell us what happened, what you need, or what we could improve…");
    expect(dialog?.querySelectorAll('input[name="feedback-category"]')).toHaveLength(0);
    expect(dialog?.querySelector(".desktop-feedback-message-field .desktop-feedback-field-label")?.textContent)
      .toContain("What's your feedback?");
    expect(dialog?.querySelector(".desktop-feedback-message-field .desktop-feedback-field-label")?.getAttribute("for"))
      .toBe(textarea?.id);
    expect(textarea?.getAttribute("aria-label")).toBe("What's your feedback?");
    expect(textarea?.required).toBe(true);
    expect(dialog?.querySelector(".desktop-feedback-contact-field .desktop-feedback-field-label")?.textContent)
      .toContain("How should we contact you?");
    expect(dialog?.querySelector(".desktop-feedback-contact-field .desktop-feedback-field-label")?.getAttribute("for"))
      .toBe(emailInput?.id);
    expect(dialog?.querySelectorAll(".desktop-feedback-required-marker")).toHaveLength(2);
    expect(Array.from(dialog?.querySelectorAll(".desktop-feedback-required-marker") ?? [])
      .every((marker) => marker.textContent === "*")).toBe(true);
    expect(emailInput?.type).toBe("email");
    expect(emailInput?.required).toBe(true);
    expect(emailInput?.placeholder).toBe("you@example.com");
    const fields = dialog?.querySelector(".desktop-feedback-fields");
    expect(fields?.children).toHaveLength(2);
    expect(fields?.children[0]?.classList.contains("desktop-feedback-message-field")).toBe(true);
    expect(fields?.children[1]?.classList.contains("desktop-feedback-contact-field")).toBe(true);
    expect(dialog?.querySelector(".desktop-feedback-header")?.textContent).toContain("Feedback");
    expect(dialog?.querySelector<HTMLButtonElement>(".desktop-feedback-close")?.getAttribute("aria-label")).toBe("Close");
    expect(
      dialog?.querySelector<HTMLButtonElement>(".desktop-feedback-attach")
        ?.getAttribute("aria-label"),
    ).toBe("Attach screenshot");
    expect(dialog?.querySelector(".desktop-feedback-composer")?.nextElementSibling?.classList)
      .toContain("desktop-feedback-attachment-row");
    const submitButton = dialog?.querySelector<HTMLButtonElement>(".desktop-feedback-submit");
    expect(submitButton?.getAttribute("aria-label")).toBe("Send");
    expect(submitButton?.textContent).toBe("Send");
    expect(submitButton?.classList.contains("desktop-dialog-button")).toBe(true);
    expect(dialog?.querySelector(".desktop-feedback-composer .desktop-feedback-submit")).toBeNull();
    expect(dialog?.querySelector(".desktop-feedback-footer > .desktop-feedback-submit")).toBe(submitButton);
    expect(submitButton?.disabled).toBe(true);

    act(() => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "  Please make search faster.  ",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submitButton?.disabled).toBe(true);

    act(() => {
      if (!emailInput) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        emailInput,
        "not-an-email",
      );
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(emailInput?.getAttribute("aria-invalid")).toBe("true");
    expect(submitButton?.disabled).toBe(false);

    act(() => {
      if (!emailInput) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        emailInput,
        "person@example.com",
      );
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(emailInput?.getAttribute("aria-invalid")).toBe("false");
    expect(submitButton?.disabled).toBe(false);

    const form = document.querySelector<HTMLFormElement>(".desktop-feedback-form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(submitFeedback).toHaveBeenCalledWith({
      message: "Please make search faster.",
      email: "person@example.com",
      locale: "en",
    });
    expect(submitButton?.textContent).toContain("Sent");
    expect(submitButton?.querySelector('[role="status"]')).not.toBeNull();
    expect(document.querySelector(".desktop-feedback-status")?.textContent).toBe("");
  });

  it("can only be dismissed with its close button", () => {
    const container = renderLauncher(<DesktopHelpLauncher />);
    const launcher = container.querySelector<HTMLButtonElement>(".desktop-help-launcher");
    act(() => launcher?.click());

    const backdrop = document.querySelector<HTMLElement>(".desktop-feedback-dialog-backdrop");
    expect(backdrop).not.toBeNull();

    act(() => {
      backdrop?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      launcher?.click();
    });
    expect(document.querySelector(".desktop-feedback-dialog")).not.toBeNull();
    expect(launcher?.getAttribute("aria-expanded")).toBe("true");

    act(() => document.querySelector<HTMLButtonElement>(".desktop-feedback-close")?.click());
    expect(document.querySelector(".desktop-feedback-dialog")).toBeNull();
    expect(launcher?.getAttribute("aria-expanded")).toBe("false");
  });

  it("attaches a screenshot alongside the required written feedback", async () => {
    const submitFeedback = vi.fn().mockResolvedValue({ ok: true });
    window.puppyoneDesktop = {
      submitFeedback,
    } as unknown as Window["puppyoneDesktop"];
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:feedback-preview");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const container = renderLauncher(<DesktopHelpLauncher />);
    act(() => container.querySelector<HTMLButtonElement>(".desktop-help-launcher")?.click());

    const input = document.querySelector<HTMLInputElement>(".desktop-feedback-file-input");
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    const emailInput = document.querySelector<HTMLInputElement>(".desktop-feedback-contact-input");
    const screenshotBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const screenshotFile = new File([screenshotBytes], "screen.png", {
      type: "image/png",
    });

    await act(async () => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
          textarea,
          "The export button is not responding.",
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (emailInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          emailInput,
          "support@example.com",
        );
        emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [screenshotFile],
      });
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(
      document.querySelector<HTMLImageElement>(".desktop-feedback-screenshot img")?.src,
    ).toBe("blob:feedback-preview");

    await act(async () => {
      document
        .querySelector<HTMLFormElement>(".desktop-feedback-form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(submitFeedback).toHaveBeenCalledOnce();
    expect(submitFeedback).toHaveBeenCalledWith({
      message: "The export button is not responding.",
      email: "support@example.com",
      locale: "en",
      screenshot: {
        bytes: expect.any(ArrayBuffer),
        mimeType: "image/png",
      },
    });

    act(() => document.querySelector<HTMLButtonElement>(".desktop-feedback-close")?.click());
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:feedback-preview");
  });

  it("belongs to the Sidebar utility edge instead of the Chat and Terminal panel", () => {
    const utility = <DesktopHelpLauncher />;
    const container = renderLauncher(
      <ProjectShell
        rightSidebar={<div data-testid="auxiliary-panel">Chat or Terminal</div>}
        rightSidebarOpen
      >
        <DesktopSidebarFooterNavigation
          activeView="data"
          gitEnabled={false}
          gitIncomingCount={0}
          gitOperationLoading={null}
          gitStatus={null}
          workspaceChangeCount={0}
          utilitySlot={utility}
          onNavigate={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </ProjectShell>,
    );

    const mainSurface = container.querySelector("main.desktop-surface");
    const auxiliaryPanel = container.querySelector(".desktop-right-sidebar");
    const utilityEdge = container.querySelector(".desktop-sidebar-footer-actions-left");
    const launcher = container.querySelector(".desktop-help-launcher");
    expect(utilityEdge?.contains(launcher)).toBe(true);
    expect(mainSurface?.contains(launcher)).toBe(true);
    expect(auxiliaryPanel?.contains(launcher)).toBe(false);
  });

});
