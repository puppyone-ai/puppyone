/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { suggestProjectName } from "../../../../src/components/AgentProjectStartDialog";
import {
  consumePendingAgentStart,
  INITIAL_WINDOW_PROJECT,
  setPendingAgentStart,
  windowProjectStore,
} from "../../../../src/features/app-shell/window-project/windowProjectStore";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult } from "../../../../src/types/electron";
import { notesProject, renderHome, setUpOnboardingHome } from "../../../support/react/onboardingHome";
import { stripBidiIsolation } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setUpOnboardingHome();

afterEach(() => {
  windowProjectStore.setState(INITIAL_WINDOW_PROJECT);
});

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AgentProjectStartDialog and pendingAgentStart", () => {
  it("suggests clean folder names from the first clause of the prompt", () => {
    expect(suggestProjectName("Compare Q1 pricing: Stripe vs Adyen\nInclude CSV", "Untitled 1234"))
      .toBe("Compare Q1 pricing");
    expect(suggestProjectName("   ", "Untitled 1234")).toBe("Untitled 1234");
  });

  it("opens from a local Agent button, builds a blank numbered project request, and records pendingAgentStart on open", async () => {
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: {
        discoverLocalAgentInstallations: vi.fn(async () => ({
          schemaVersion: 1 as const,
          generation: 1,
          scanId: "scan-1",
          availableAgentIds: ["claude"],
          requestedAt: "2026-04-01T00:00:00.000Z",
          completedAt: "2026-04-01T00:00:01.000Z",
          source: "scan" as const,
          results: [{
            agentId: "claude",
            displayName: "Claude Code",
            status: "found" as const,
            source: "fixture",
          }],
        })),
        onLocalAgentInstallationProgress: vi.fn(() => () => undefined),
        onLocalAgentInstallationsChanged: vi.fn(() => () => undefined),
        getAgentActivityEnrollment: vi.fn(async () => ({ schemaVersion: 1 as const, providers: [] })),
      },
    });

    const onDefaultProjectLocation = vi.fn(async () => ({
      grantId: "grant-default-location",
      path: "/Users/example/Documents/PuppyOne",
    }));
    const onChooseProjectLocation = vi.fn(async () => ({
      grantId: "grant-chosen-location",
      path: "/Users/example/Documents/PuppyOne",
    }));
    const onCreateProject = vi.fn(async (request: WorkspaceCreateProjectRequest): Promise<WorkspaceCreateProjectResult> => ({
      initialization: {
        path: `/Users/example/Documents/PuppyOne/${request.name}`,
        name: request.name,
        createdAt: "2026-04-01T00:00:00.000Z",
      } as unknown as WorkspaceCreateProjectResult["initialization"],
      opening: {
        status: "opened",
        result: {
          path: `/Users/example/Documents/PuppyOne/${request.name}`,
          workspace: {
            id: "ws-created",
            name: request.name,
            path: `/Users/example/Documents/PuppyOne/${request.name}`,
            folders: [],
          },
        } as unknown as WorkspaceCreateProjectResult["opening"] extends { status: "opened"; result: infer R } ? R : never,
      },
    }));

    const container = renderHome({
      projectItems: [notesProject],
      onDefaultProjectLocation,
      onChooseProjectLocation,
      onCreateProject,
      onAgentProjectStarted: setPendingAgentStart,
    });

    await vi.waitFor(() => {
      expect(container.querySelector("[data-agent-runtime='claude']")).not.toBeNull();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-agent-runtime='claude']")?.click();
    });

    const dialog = document.body.querySelector<HTMLFormElement>(".onboarding-entry-dialog.is-agent-start");
    expect(dialog).not.toBeNull();
    expect(stripBidiIsolation(dialog?.querySelector("h2")?.textContent ?? "")).toBe("Have Claude Code start a project");
    expect(stripBidiIsolation(dialog?.querySelector(".onboarding-agent-start-note")?.textContent ?? ""))
      .toContain("puppyone only makes the folder and hands your words to Claude Code.");

    await vi.waitFor(() => {
      expect(dialog?.querySelector(".onboarding-entry-location-path")?.textContent).toBe("/Users/example/Documents/PuppyOne");
    });

    const promptInput = dialog!.querySelector<HTMLTextAreaElement>(".onboarding-agent-start-input")!;
    const nameInput = dialog!.querySelector<HTMLInputElement>(".onboarding-entry-create-input")!;
    const submitButton = dialog!.querySelector<HTMLButtonElement>(".onboarding-agent-start-submit")!;
    expect(submitButton.disabled).toBe(true);

    await act(async () => {
      setValue(promptInput, "Draft pricing comparison page, plus CSV table");
    });
    expect(nameInput.value).toBe("Draft pricing comparison page");
    expect(submitButton.disabled).toBe(false);

    // Manual edit overrides automatic suggestion while preserving prompt text.
    await act(async () => {
      setValue(nameInput, "pricing-study");
    });
    expect(nameInput.value).toBe("pricing-study");

    await act(async () => {
      submitButton.click();
    });

    await vi.waitFor(() => {
      expect(onCreateProject).toHaveBeenCalledOnce();
    });

    expect(onCreateProject).toHaveBeenCalledWith(expect.objectContaining({
      name: "pricing-study",
      locationGrantId: "grant-default-location",
      numberIfTaken: true,
      openInNewWindow: false,
      source: { kind: "blank" },
    }));

    expect(document.body.querySelector(".onboarding-entry-dialog.is-agent-start")).toBeNull();
    expect(windowProjectStore.getState().pendingAgentStart).toEqual({
      rootPath: "/Users/example/Documents/PuppyOne/pricing-study",
      runtimeId: "claude",
      prompt: "Draft pricing comparison page, plus CSV table",
    });

    // Consuming matches only the created project's rootPath and clears it atomically.
    expect(consumePendingAgentStart("/Users/example/Documents/PuppyOne/other")).toBeNull();
    expect(consumePendingAgentStart("/Users/example/Documents/PuppyOne/pricing-study")).toEqual({
      rootPath: "/Users/example/Documents/PuppyOne/pricing-study",
      runtimeId: "claude",
      prompt: "Draft pricing comparison page, plus CSV table",
    });
    expect(consumePendingAgentStart("/Users/example/Documents/PuppyOne/pricing-study")).toBeNull();
  });
});
