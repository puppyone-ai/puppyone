/** @vitest-environment happy-dom */
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bench, describe } from "vitest";
import { AgentSessionActor } from "../../electron/main/agent/domain/agent-session-actor.mjs";
import { SessionUiStateStore } from "../../src/features/desktop-agent/application/SessionUiStateStore";
import { AgentComposer } from "../../src/features/desktop-agent/ui/AgentComposer";
import { AgentTranscript } from "../../src/features/desktop-agent/ui/AgentTranscript";
import { SafeMarkdown } from "../../src/features/desktop-agent/ui/SafeMarkdown";
import {
  AgentPickerPopover,
  type AgentPickerGroup,
} from "../../src/features/desktop-agent/ui/AgentPickerPopover";
import { agentPickerLimits } from "../../src/features/desktop-agent/ui/agent-picker-limits";
import { AgentCommandActivity } from "../../src/features/desktop-agent/ui/activity/AgentCommandActivity";
import { AgentFileChangeActivity } from "../../src/features/desktop-agent/ui/activity/AgentFileChangeActivity";
import { applyAgentEvent, applyAgentEvents, createAgentProjection } from "../../electron/main/agent/domain/transcript/transcript-reducer.mjs";
import type { AgentEvent } from "../../src/features/desktop-agent/agentTypes";
import type { AgentActivity } from "../../src/features/desktop-agent/domain/agent-projection-types";
import { agentToolEvidenceLimits } from "../../src/features/desktop-agent/domain/agent-tool-evidence";
import { withBenchmarkLocalization } from "./localizationHarness";

// Long enough to make this product-critical signal useful in CI while keeping
// the complete performance suite practical on release runners.
const OPTIONS = { iterations: 5, time: 750, warmupIterations: 2, warmupTime: 150 };
const HEAVY_UI_OPTIONS = { iterations: 3, time: 500, warmupIterations: 1, warmupTime: 100 };
const recordedEvents = createRecordedEvents(1_000);
const projection = applyAgentEvents(createAgentProjection(), recordedEvents);
const committedActor = new AgentSessionActor({events: createRecordedEvents(660)});
const appendToActor = () => committedActor.appendEvent({sessionId:"benchmark",runtimeId:"fixture",providerSessionId:"native",event:{type:"assistant.delta",turnId:"live",itemId:"live-answer",payload:{delta:"next "}}});
const largeMarkdown = createLargeMarkdown(128 * 1024);
const pickerGroups = createPickerGroups(500);
const composerModels = Array.from({ length: 500 }, (_, index) => ({
  id: `model-${index}`,
  model: `model-${index}`,
  displayName: `Model ${index}`,
  description: `Coding model ${index}`,
  isDefault: index === 0,
}));
const commandActivity = createCommandActivity();
const fileChangeActivity = createFileChangeActivity();

describe("Desktop Agent long-session projection", () => {
  bench("Main commit, display validation and structural patch near the window limit", appendToActor, OPTIONS);

  bench("4,000 normalized events -> 2,000 stable message rows", () => {
    applyAgentEvents(createAgentProjection(), recordedEvents);
  }, OPTIONS);

  bench("one steady-stream delta against a 2,000-row projection", () => {
    applyAgentEvent(projection, event(4_001, "assistant.delta", { delta: "next" }, "turn-999", "message-999"));
  }, OPTIONS);
});

describe("Desktop Agent virtual timeline", () => {
  bench("mount and dispose a 2,000-row transcript with bounded DOM", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const root = createRoot(parent);
    flushSync(() => root.render(withBenchmarkLocalization(
      createElement(AgentTranscript, { projection, loading: false }),
    )));
    if (parent.querySelectorAll(".desktop-agent-virtual-row").length > 120) throw new Error("Agent virtual-row budget regressed.");
    flushSync(() => root.unmount());
    parent.remove();
  }, OPTIONS);
});

describe("Desktop Agent composer isolation", () => {
  bench("1,000 draft cache writes preserve a 1,000-row measurement map", () => {
    const store = new SessionUiStateStore(2, 1_000);
    const measurements = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`row-${index}`, 40 + (index % 7)]));
    store.patch("session", { measurements });
    for (let index = 0; index < 1_000; index += 1) store.patch("session", { draft: `Prompt ${index}` });
    if (Object.keys(store.read("session").measurements).length !== 1_000) throw new Error("Draft writes discarded timeline measurements.");
  }, OPTIONS);

  bench("50 controlled draft commits beside a memoized 2,000-row transcript", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const root = createRoot(parent);
    const noop = () => {};
    const submit = async () => true;
    for (let index = 0; index < 50; index += 1) {
      flushSync(() => root.render(withBenchmarkLocalization(
        createElement("div", null,
          createElement(AgentTranscript, { projection, loading: false, onViewportChange: noop }),
          createElement(AgentComposer, {
            draft: `Prompt ${index}`,
            onDraftChange: noop,
            disabled: false,
            running: false,
            stopping: false,
            submitting: false,
            placeholder: "Ask anything",
            sessionControls: [{
              id: "model",
              value: composerModels[0].model,
              options: composerModels.map((model) => ({ value: model.model, label: model.displayName })),
            }],
            onSelectSessionControl: noop,
            onSubmit: submit,
            onStop: noop,
          }),
        ),
      )));
    }
    if (parent.querySelectorAll(".desktop-agent-virtual-row").length > 120) throw new Error("Agent virtual-row budget regressed during typing.");
    flushSync(() => root.unmount());
    parent.remove();
  }, HEAVY_UI_OPTIONS);
});

describe("Desktop Agent bounded heavy content", () => {
  bench("mount and dispose 128 KiB of safe Markdown", () => {
    withMounted(createElement(SafeMarkdown, { text: largeMarkdown }), (parent) => {
      if (!parent.querySelector(".desktop-agent-markdown")) throw new Error("Markdown surface did not mount.");
    });
  }, HEAVY_UI_OPTIONS);

  bench("expand a bounded 64 KiB command output and 240-line diff", () => {
    withMounted(createElement("div", null,
      createElement(AgentCommandActivity, { activity: commandActivity }),
      createElement(AgentFileChangeActivity, { activity: fileChangeActivity }),
    ), (parent) => {
      const rows = parent.querySelectorAll<HTMLButtonElement>(".desktop-agent-tool-row");
      flushSync(() => rows.forEach((row) => row.click()));
      const commandOutput = parent.querySelector(".desktop-agent-command-output");
      if (!commandOutput) throw new Error("Command output did not expand.");
      if ((commandOutput.textContent?.length ?? 0) > agentToolEvidenceLimits.maxChars + 256) {
        throw new Error("Command output DOM budget regressed.");
      }
      if (parent.querySelectorAll(".desktop-agent-diff-line").length !== 240) throw new Error("Diff rendering bound regressed.");
    });
  }, HEAVY_UI_OPTIONS);

  bench("open a 500-model searchable picker with bounded mounted options", () => {
    withMounted(createElement(AgentPickerPopover, {
      ariaLabel: "Agent model",
      placeholder: "Choose model",
      groups: pickerGroups,
      onSelect: () => {},
    }), (parent) => {
      const trigger = parent.querySelector<HTMLButtonElement>('[aria-label="Agent model"]');
      if (!trigger) throw new Error("Model picker trigger did not mount.");
      flushSync(() => trigger.click());
      const optionCount = parent.querySelectorAll('[role="option"]').length;
      if (optionCount > agentPickerLimits.maxRenderedOptions) throw new Error("Model picker DOM budget regressed.");
    });
  }, HEAVY_UI_OPTIONS);
});

function withMounted(node: ReactNode, inspect: (parent: HTMLElement) => void) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const root = createRoot(parent);
  try {
    flushSync(() => root.render(withBenchmarkLocalization(node)));
    inspect(parent);
  } finally {
    flushSync(() => root.unmount());
    parent.remove();
  }
}

function createLargeMarkdown(size: number) {
  const paragraph = "## Architecture boundary\n\n- **Safe** rendering with `bounded` content and [documentation](https://example.com).\n\n";
  return paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size);
}

function createPickerGroups(count: number): AgentPickerGroup[] {
  return [{
    id: "models",
    label: "Connected models",
    options: Array.from({ length: count }, (_, index) => ({
      id: `provider/model-${index}`,
      label: `Model ${index}`,
      description: `Connected provider model ${index}`,
      keywords: `model ${index}`,
      selectable: true,
      kind: "model" as const,
    })),
  }];
}

function createCommandActivity(): AgentActivity {
  return {
    id: "command-benchmark",
    turnId: "turn-benchmark",
    itemId: "command",
    kind: "command",
    label: "Run benchmark",
    status: "completed",
    detail: { tool: "bash", command: "npm test", metadata: { exitCode: 0, duration: 900 } },
    output: "command output line\n".repeat(4_000).slice(0, 64 * 1024),
    sequence: 1,
  };
}

function createFileChangeActivity(): AgentActivity {
  const diff = Array.from({ length: 240 }, (_, index) => `${index % 2 ? "+" : "-"}line ${index}`).join("\n");
  return {
    id: "file-change-benchmark",
    turnId: "turn-benchmark",
    itemId: "edit",
    kind: "file-change",
    label: "Edit benchmark.ts",
    status: "completed",
    detail: {
      tool: "edit",
      path: "src/benchmark.ts",
      changes: [{ path: "src/benchmark.ts", additions: 120, deletions: 120 }],
      diff,
    },
    output: "",
    sequence: 2,
  };
}

function createRecordedEvents(turns: number): AgentEvent[] {
  const events: AgentEvent[] = [];
  let sequence = 0;
  for (let index = 0; index < turns; index += 1) {
    const turnId = `turn-${index}`;
    const itemId = `message-${index}`;
    events.push(event(++sequence, "turn.started", { prompt: `Task ${index}` }, turnId));
    events.push(event(++sequence, "assistant.delta", { delta: "Working on the requested change. " }, turnId, itemId));
    events.push(event(++sequence, "assistant.completed", { text: `Completed task ${index}.` }, turnId, itemId));
    events.push(event(++sequence, "turn.completed", { status: "completed" }, turnId));
  }
  return events;
}

function event(sequence: number, type: AgentEvent["type"], payload: Record<string, unknown>, turnId: string, itemId: string | null = null): AgentEvent {
  return { schemaVersion: 1, sequence, sessionId: "benchmark", runtimeId: "fixture", provider: "fixture", providerSessionId: "native", turnId, itemId, emittedAt: new Date(sequence).toISOString(), type, payload };
}
