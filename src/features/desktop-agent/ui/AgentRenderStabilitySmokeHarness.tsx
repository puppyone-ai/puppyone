import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EditorView } from "@codemirror/view";
import { createEmptyAgentDisplay } from "../../../../shared/agent-contract/display-state.mjs";
import type { AgentPart, AgentProjection } from "../domain/agent-projection-types";
import { BUILTIN_SUB_THEMES } from "../../themes/builtinSubThemes";
import { SubThemeStyleHost } from "../../themes/SubThemeStyleHost";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../markdown/markdownPresentation";
import { AgentChatTabPanel } from "./AgentChatTabPanel";
import type { AgentSessionController, AgentControllerState } from "../application/AgentSessionController";
import "./desktop-agent.css";

type Stage = "ready" | "preview" | "dispatching" | "accepted" | "completed";
type Fixture = { theme: "light" | "dark" | "windows-xp"; history: number; stage: Stage; width: number; generation: number; draft: string; activity?: boolean; message?: string };
const prompt = "检查消息提交之后的位置，以及较长的中文和 English 内容换行时是否稳定。";
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function frames(count = 3) { for (let i = 0; i < count; i++) await frame(); }
const noOp = () => {};
let smokePhase = "mount";

/** Real production components and cascade; no Harness connection or native execution. */
export function AgentRenderStabilitySmokeHarness() {
  const [fixture, setFixture] = useState<Fixture>({ theme: "light", history: 0, stage: "preview", width: 420, generation: 0, draft: "" });
  useEffect(() => {
    let active = true;
    const errors: string[] = [];
    const onError = (event: ErrorEvent) => errors.push(`${smokePhase}: ${event.message}`);
    const onRejection = (event: PromiseRejectionEvent) => errors.push(String(event.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const update = (value: Fixture) => { smokePhase = `${value.generation}/${value.width}/${value.stage}`; if (active) flushSync(() => setFixture(value)); };
    // Leave the mounting commit before invoking flushSync or measuring frames.
    void frame().then(() => runSmoke(update, () => active)).then(result => {
      if (active) publish({ ...result, errors, passed: errors.length === 0 });
    }).catch(error => {
      if (active) publish({ passed: false, errors, error: String(error?.stack || error) });
    });
    return () => {
      active = false;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  const subThemeId = fixture.theme === "windows-xp" ? "windows-xp.luna-blue" : "default.neutral";
  const colorMode = fixture.theme === "dark" ? "dark" : "light";
  return <>
    <SubThemeStyleHost subTheme={BUILTIN_SUB_THEMES.find(theme => theme.id === subThemeId)!}
      colorMode={colorMode} markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS} />
    <main className={`desktop-agent-render-smoke desktop-theme-preview-surface${colorMode === "dark" ? " dark" : ""}`} data-width={fixture.width}
      data-po-appearance-root="true" data-root-theme-id={fixture.theme === "windows-xp" ? "windows-xp" : "default"}
      data-sub-theme-id={subThemeId}>

      <RenderFixture key={fixture.generation} fixture={fixture} update={setFixture} />
  </main></>;
}

/** Controlled application-state fixture. The complete production panel derives
 * status, overlay, composer and transcript props; the fixture never invents
 * submissionStage or calls a native Harness. */
function RenderFixture({ fixture, update }: { fixture: Fixture; update: (fixture: Fixture) => void }) {
  const snapshot = useMemo((): AgentControllerState => {
    const runtime = { id: "codex", displayName: "Codex", iconKey: "codex" };
    const readiness = { provider: "codex", status: "ready" as const, code: "READY" as const,
      version: null, minimumVersion: null, message: "Ready" };
    const display = projection(fixture.history, fixture.stage, fixture.activity, fixture.message);
    const message = fixture.message ?? prompt;
    return {
      phase: fixture.stage === "accepted" ? "running" : "ready", initialized: true,
      inspection: { runtime, selectedRuntimeId: "codex", runtimes: [{ descriptor: runtime, readiness }],
        readiness, account: null, models: [], capabilities: null, warnings: [] },
      session: { id: "session:smoke", runtimeId: "codex", runtime, provider: "codex", providerSessionId: null,
        workspaceRoot: "/smoke", title: "Smoke", createdAt: "2026-01-01", updatedAt: "2026-01-01",
        terminalState: "idle", selectedModel: null, activeTurnId: display.runningTurnId, lastSequence: 0 },
      control: null, replicaStatus: "live", projection: display,
      selectedRuntimeId: "codex", selectedProviderId: null, selectedModel: null, selectedEffort: null, selectedMode: null,
      localConnections: [], localConnectionsPhase: "idle", localConnectionsScannedAt: null, localConnectionsError: null,
      draft: fixture.draft, draftMentions: [], references: [], error: null, stopping: false,
      submitting: fixture.stage === "preview" || fixture.stage === "dispatching",
      pendingPrompt: fixture.stage === "preview" ? message : null,
      pendingIntent: fixture.stage === "preview" ? { id: "submission:smoke", referenceEpoch: "smoke", prompt: message,
        model: null, effort: null, mode: null, references: [], promptMentions: [] } : null,
      sessionPreparation: "ready",
    };
  }, [fixture]);
  const latest = useRef({ snapshot, fixture, update });
  latest.current = { snapshot, fixture, update };
  const controller = useMemo(() => ({
    getSnapshot: () => latest.current.snapshot,
    subscribe: () => noOp,
    readViewport: () => ({ scrollTop: 0, pinned: true, measurements: {} }),
    rememberViewport: noOp,
    setDraftDocument: (draft: string) => {
      if (draft !== latest.current.fixture.draft) latest.current.update({ ...latest.current.fixture, draft });
    },
    submit: async (message: string) => {
      latest.current.update({ ...latest.current.fixture, message, draft: "", stage: "preview" });
      return true;
    },
  }) as unknown as AgentSessionController, []);
  return <AgentChatTabPanel controller={controller} workspaceId="smoke" presented commandTarget={false}
    onPresentationChange={noOp} preferredRuntimeId="codex" preferredRoute={{}} preferredModel={null} hiddenRuntimeIds={[]} />;
}

function projection(history: number, stage: Stage, activity = false, message = prompt): AgentProjection {
  const display = createEmptyAgentDisplay();
  display.parts = Array.from({ length: history }, (_, i): AgentPart => ({
    id: `assistant:${i}`, kind: "assistant", text: `已有回复 ${i + 1}：检查消息布局与行高。`,
    turnId: `turn:${i}`, itemId: null, streaming: false, terminalState: null, sequence: i + 1,
  }));
  if (stage !== "preview" && stage !== "ready") display.parts.push({ id: "user:smoke", submissionId: "submission:smoke",
    kind: "user", text: message, turnId: stage === "dispatching" ? null : "turn:next", itemId: null,
    streaming: false, terminalState: null, sequence: history + 1, deliveryStatus: stage === "completed" ? "accepted" : stage });
  if (activity) display.parts.push({ id: "tool:smoke", kind: "tool", turnId: "turn:next", itemId: null,
    sequence: history + 2, label: "Read", status: "completed", detail: {}, output: "Done" });
  if (stage === "completed") display.parts.push({ id: "turn-summary:next", kind: "turn-summary",
    turnId: "turn:next", itemId: null, sequence: history + 3, durationMs: 4_000, status: "completed" });
  display.rows = display.parts.map(part => ({ id: `row:${part.id}`, partId: part.id,
    kind: part.kind, turnId: part.turnId, sequence: part.sequence, estimatedHeight: 64 }));
  if (stage === "accepted") display.runningTurnId = "turn:next";
  return display;
}

async function runSmoke(update: (fixture: Fixture) => void, active: () => boolean) {
  let generation = 0;
  let maxDrift = 0;
  let samples = 0;
  let sendSamples = 0;
  let maxSendDrift = 0;
  let feedbackSamples = 0;
  let maxFeedbackDrift = 0;
  const cases: object[] = [];
  const html = document.documentElement;
  update({ theme: "light", history: 0, width: 560, generation: ++generation, stage: "ready", draft: prompt });
  await frames();
  const inputView = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
  inputView.focus();
  // Exercise the installed browser's public composition surface. This is an
  // event-protocol fixture, not an operating-system IME driver.
  const compositionTarget = (inputView.contentDOM as HTMLElement & { editContext?: EventTarget | null }).editContext
    ?? inputView.contentDOM;
  compositionTarget.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  assert(inputView.compositionStarted && !inputView.composing, "Early IME composition was not established");
  for (const shiftKey of [false, true]) {
    const confirm = new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, shiftKey, isComposing: true, bubbles: true, cancelable: true,
    });
    flushSync(() => inputView.contentDOM.dispatchEvent(confirm));
    await frames();
    assert(!user() && inputView.state.doc.toString() === prompt && !confirm.defaultPrevented,
      "IME confirmation submitted, changed the draft or cancelled native composition");
  }
  compositionTarget.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  flushSync(() => inputView.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true,
  })));
  await frames();
  assert(user()?.textContent === prompt && inputView.state.doc.length === 0,
    "Enter after composition did not submit the preserved draft");
  for (const theme of ["light", "dark", "windows-xp"] as const) {
    html.dataset.interfaceStyle = theme === "windows-xp" ? "windows-xp" : "default";
    html.classList.toggle("dark", theme === "dark");
    for (const width of [420, 560, 760]) {
      for (const history of [0, 1, 24]) {
        if (!active()) throw new Error("Smoke cancelled");
        const message = history === 1 ? `${prompt}\n多行输入第二行。\n多行输入第三行。` : prompt;
        const fixture: Fixture = { theme, history, width, generation: ++generation, stage: "preview", draft: "", message };
        update({ ...fixture, stage: "ready", draft: message });
        await frames();
        const send = document.querySelector<HTMLButtonElement>(".desktop-agent-composer-action")!;
        assert(send && !send.disabled, "Production Send action is unavailable");
        smokePhase = `${theme}/${width}/${history}/click-send`;
        flushSync(() => send.click());
        const node = user();
        const baseline = snapshot();
        const composer = document.querySelector(".desktop-agent-composer-shell")!.getBoundingClientRect();
        for (let i = 0; i < 5; i++) {
          await frame();
          const next = snapshot();
          const nextComposer = document.querySelector(".desktop-agent-composer-shell")!.getBoundingClientRect();
          const drift = Math.max(Math.abs(next.y - baseline.y), Math.abs(next.height - baseline.height),
            Math.abs(next.workingY - baseline.workingY), Math.abs(nextComposer.y - composer.y), Math.abs(nextComposer.height - composer.height));
          maxSendDrift = Math.max(maxSendDrift, drift);
          assert(drift <= 1, `${smokePhase}: sending/clearing the draft moved ${drift}px`);
          assert(user() === node, "First-send transition replaced the user DOM node");
          assert(EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!.state.doc.length === 0,
            "Submitted draft remained visible");
          sendSamples++;
        }
        const colors = messageColors(node);
        assert(colors.contrast >= 4.5, `${theme}: message contrast is too low: ${JSON.stringify(colors)}`);
        assert(theme === "dark" ? colors.textLuminance > colors.backgroundLuminance : colors.textLuminance < colors.backgroundLuminance,
          `${theme}: fixture did not apply the real theme palette`);
        for (const stage of ["dispatching", "accepted"] as const) {
          update({ ...fixture, stage });
          // Commit and each following frame: a settled screenshot alone misses flicker.
          for (let i = 0; i < 5; i++) {
            const next = snapshot();
            assert(user() === node, "Submission handoff replaced the user DOM node");
            assert(document.querySelectorAll(".desktop-agent-message.is-user").length === 1, "Duplicate user prompt");
            assert(user().textContent === message && !user().querySelector('[role="status"], [data-puppy-loader]'), "Routine delivery added a transient user-message label or loader");
            const drift = Math.max(Math.abs(next.y - baseline.y), Math.abs(next.height - baseline.height),
              Math.abs(next.workingY - baseline.workingY), Math.abs(next.scrollTop - baseline.scrollTop));
            maxDrift = Math.max(maxDrift, drift);
            assert(drift <= 1, `${theme}/${width}/${history}/${stage}: handoff moved ${drift}px`);
            samples++;
            await frame();
          }
        }
        for (const activity of [false, true]) {
          update({ ...fixture, stage: "accepted", activity });
          await frames();
          const feedback = feedbackSnapshot();
          const beforeCompletion = user().getBoundingClientRect();
          update({ ...fixture, stage: "completed", activity });
          for (let i = 0; i < 5; i++) {
            const next = feedbackSnapshot();
            const afterCompletion = user().getBoundingClientRect();
            const drift = Math.max(Math.abs(next.x - feedback.x), Math.abs(next.y - feedback.y),
              Math.abs(next.height - feedback.height), Math.abs(afterCompletion.y - beforeCompletion.y));
            maxFeedbackDrift = Math.max(maxFeedbackDrift, drift);
            assert(next.font === feedback.font && next.lineHeight === feedback.lineHeight && next.color === feedback.color,
              "Run completion changed feedback typography or color");
            assert(drift <= 1, `${theme}/${width}/${history}/${activity ? "working" : "thinking"}: completion moved ${drift}px`);
            assert(next.opacity === "1" && document.querySelectorAll(".desktop-agent-run-feedback").length === 1,
              "Run completion faded or duplicated the feedback line");
            feedbackSamples++;
            await frame();
          }
        }
        const editor = document.querySelector<HTMLElement>(".desktop-agent-prompt-editor .cm-content");
        assert(editor, "Production composer did not mount");
        const style = getComputedStyle(editor!);
        assert(parseFloat(style.fontSize) >= 12 && Math.abs(parseFloat(style.lineHeight) - (parseFloat(style.fontSize) + 7)) <= 0.5, "CodeMirror overrode composer typography");
        assert(document.documentElement.scrollWidth <= window.innerWidth + 1, "Document overflow");
        cases.push({ theme, width, history, messageHeight: baseline.height, fontSize: style.fontSize, lineHeight: style.lineHeight, contrast: colors.contrast });
      }
    }
  }
  html.dataset.interfaceStyle = "default";
  html.classList.add("dark");
  // Width + font changes while reading history must preserve the visible row.
  const fixture: Fixture = { theme: "dark", history: 100, width: 560, generation: ++generation, stage: "accepted", draft: "" };
  update(fixture);
  await frames();
  const scroller = document.querySelector<HTMLElement>(".desktop-agent-transcript")!;
  const beforeWheel = scroller.scrollTop;
  const scrollRect = scroller.getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    await nativeWheel(Math.round(scrollRect.x + scrollRect.width / 2), Math.round(scrollRect.y + 30), 10);
  }
  assert(scroller.scrollTop < beforeWheel - 1, "Native wheel input could not leave bottom following");
  const bottom = scroller.scrollTop;
  for (const delta of [1, 10, 79]) {
    const expected = scroller.scrollTop - delta;
    scroller.scrollTop = expected;
    const position = readingPosition(scroller);
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await frames();
    assertReadingPosition(position, `Small upward scroll (${delta}px)`);
    update({ ...fixture, activity: true });
    await frames();
    assertReadingPosition(position, "Incoming activity");
  }
  assert(scroller.scrollTop !== bottom && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 80,
    "Repeated small scrolls could not leave the bottom");
  document.querySelector<HTMLButtonElement>(".desktop-agent-jump-latest")!.click();
  await frames();
  const keyboardStart = scroller.scrollTop;
  scroller.focus({ preventScroll: true });
  await nativeScrollInput({ type: "key", keyCode: "PageUp" });
  assert(scroller.scrollTop < keyboardStart - 1 && document.querySelector(".desktop-agent-jump-latest"),
    "Keyboard scrolling did not release following");
  // Chromium animates PageUp. Its user-requested movement must finish before
  // asserting that an unrelated update preserves the resulting reading point.
  await scrollSettled(scroller);
  const keyboardPosition = readingPosition(scroller);
  update({ ...fixture, activity: true });
  await frames();
  assertReadingPosition(keyboardPosition, "Incoming activity after PageUp");
  scroller.scrollTop = scroller.scrollHeight * 0.45;
  scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  await frames();
  const top = scroller.getBoundingClientRect().top;
  const anchor = Array.from(document.querySelectorAll<HTMLElement>(".desktop-agent-virtual-row"))
    .find(row => row.getBoundingClientRect().bottom > top + 2)!;
  const anchorId = anchor.dataset.rowId!;
  const anchorY = anchor.getBoundingClientRect().top;
  update({ ...fixture, draft: "Reading history while editing a multiline draft.\n".repeat(12) });
  await frames();
  assertReadingPosition({ id: anchorId, y: anchorY }, "Composer growth while reading");
  update(fixture);
  await frames();
  assertReadingPosition({ id: anchorId, y: anchorY }, "Composer shrink while reading");
  update({ ...fixture, width: 420 });
  await frames();
  const afterWidth = document.querySelector<HTMLElement>(`[data-row-id="${anchorId}"]`)!;
  assert(afterWidth && Math.abs(afterWidth.getBoundingClientRect().top - anchorY) <= 1, "Width change lost reading position");
  const appearance = document.querySelector<HTMLElement>(".desktop-agent-render-smoke")!;
  smokePhase = "font-change";
  const beforeFont = getComputedStyle(afterWidth).fontFamily;
  appearance.style.setProperty("--po-font-sans", "monospace");
  await frames();
  assert(Math.abs(document.querySelector<HTMLElement>(`[data-row-id="${anchorId}"]`)!.getBoundingClientRect().top - anchorY) <= 1, "Font change lost reading position");
  assert(getComputedStyle(afterWidth).fontFamily !== beforeFont, "Font fixture did not change the effective font");
  smokePhase = "font-restore";
  appearance.style.removeProperty("--po-font-sans");
  await frames();
  assert(document.querySelector(`[data-row-id="${anchorId}"]`) === afterWidth, "Font reflow replaced the visible reading row");
  // Palette-only changes propagate to component computed styles without replacing rows.
  const beforeColor = getComputedStyle(afterWidth).color;
  const beforeTop = scroller.scrollTop;
  smokePhase = "palette-change";
  appearance.style.setProperty("--po-text", "rgb(237, 213, 187)");
  await frames();
  assert(document.querySelector(`[data-row-id="${anchorId}"]`) === afterWidth, "Palette change replaced a row");
  assert(scroller.scrollTop === beforeTop, "Palette change reset scrolling");
  const afterColor = getComputedStyle(afterWidth).color;
  assert(beforeColor !== afterColor && afterColor === "rgb(237, 213, 187)", "Chat ignored Appearance semantic text color");
  appearance.style.removeProperty("--po-text");
  // Growing the actual composer changes the viewport while preserving bottom pinning.
  update({ ...fixture, generation: ++generation });
  await frames();
  update({ ...fixture, generation, draft: "输入多行内容\n".repeat(12) });
  await frames();
  const pinned = document.querySelector<HTMLElement>(".desktop-agent-transcript")!;
  assert(Math.abs(pinned.scrollHeight - pinned.clientHeight - pinned.scrollTop) <= 1, "Composer growth lost bottom pinning");
  return { cases, samples, maxDrift, sendSamples, maxSendDrift, feedbackSamples, maxFeedbackDrift,
    nativeWheel: true, keyboardScrolling: true, smallScrolls: true, readingAnchor: anchorId,
    composerReadingAnchor: true, composerPinning: true, semanticColor: afterColor };
}

function readingPosition(scroller: HTMLElement) {
  const top = scroller.getBoundingClientRect().top;
  const row = Array.from(scroller.querySelectorAll<HTMLElement>(".desktop-agent-virtual-row"))
    .find(element => element.getBoundingClientRect().bottom > top)!;
  return { id: row.dataset.rowId, y: row.getBoundingClientRect().y };
}

async function scrollSettled(scroller: HTMLElement) {
  let previous = scroller.scrollTop;
  let stableFrames = 0;
  for (let i = 0; i < 120; i++) {
    await frame();
    const top = scroller.scrollTop;
    stableFrames = Math.abs(top - previous) < 0.5 ? stableFrames + 1 : 0;
    if (stableFrames >= 4) return;
    previous = top;
  }
  throw new Error("Native scroll did not settle");
}

function assertReadingPosition(position: ReturnType<typeof readingPosition>, phase: string) {
  const row = document.querySelector<HTMLElement>(`[data-row-id="${position.id}"]`);
  assert(row && Math.abs(row.getBoundingClientRect().y - position.y) <= 1,
    `${phase} moved reading anchor ${position.id}: ${position.y} -> ${row?.getBoundingClientRect().y}`);
}

type ScrollInput = { type: "wheel"; x: number; y: number; deltaY: number } | { type: "key"; keyCode: "PageUp" };
type SmokeInputWindow = Window & {
  __PUPPYONE_AGENT_RENDER_INPUT__?: ScrollInput & { id: number };
  __PUPPYONE_AGENT_RENDER_INPUT_ACK__?: number;
};
let inputSequence = 0;
async function nativeWheel(x: number, y: number, deltaY: number) {
  await nativeScrollInput({ type: "wheel", x, y, deltaY });
}
async function nativeScrollInput(input: ScrollInput) {
  const scope = window as SmokeInputWindow;
  const id = ++inputSequence;
  scope.__PUPPYONE_AGENT_RENDER_INPUT__ = { ...input, id };
  for (let i = 0; i < 180 && scope.__PUPPYONE_AGENT_RENDER_INPUT_ACK__ !== id; i++) await frame();
  assert(scope.__PUPPYONE_AGENT_RENDER_INPUT_ACK__ === id, "Isolated Electron input driver did not acknowledge input");
  await frames(10);
}

function feedbackSnapshot() {
  const label = document.querySelector<HTMLElement>(".desktop-agent-run-feedback-label")!;
  const rect = label.getBoundingClientRect();
  const style = getComputedStyle(label);
  const row = label.closest(".desktop-agent-virtual-row");
  return { x: rect.x, y: rect.y, height: rect.height, font: style.fontSize, lineHeight: style.lineHeight,
    color: style.color, opacity: getComputedStyle(row?.firstElementChild ?? label.parentElement!).opacity };
}

function user() { return document.querySelector<HTMLElement>(".desktop-agent-message.is-user")!; }
function snapshot() {
  assert(user(), `${smokePhase}: user message disappeared`);
  const rect = user().getBoundingClientRect();
  const feedback = document.querySelector(".desktop-agent-working-indicator");
  assert(feedback, `${smokePhase}: in-flight submission lost its feedback line`);
  return { y: rect.y, height: rect.height,
    workingY: feedback.getBoundingClientRect().y,
    scrollTop: document.querySelector(".desktop-agent-transcript")!.scrollTop };
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function publish(result: object) {
  (window as Window & { __PUPPYONE_AGENT_RENDER_STABILITY_SMOKE_RESULT__?: object }).__PUPPYONE_AGENT_RENDER_STABILITY_SMOKE_RESULT__ = result;
}

function messageColors(element: HTMLElement) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const style = getComputedStyle(element);
  const luminance = () => {
    const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  context.fillStyle = style.getPropertyValue("--agent-canvas").trim(); context.fillRect(0, 0, 1, 1);
  context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
  const backgroundLuminance = luminance();
  context.fillStyle = style.color; context.fillRect(0, 0, 1, 1);
  const textLuminance = luminance();
  return { textLuminance, backgroundLuminance, text: style.color, background: style.backgroundColor, canvas: style.getPropertyValue("--agent-canvas"),
    contrast: (Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05) };
}
