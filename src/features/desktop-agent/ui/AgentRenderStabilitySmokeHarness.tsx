import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createEmptyAgentDisplay } from "../../../../shared/agent-contract/display-state.mjs";
import type { AgentPart, AgentProjection } from "../domain/agent-projection-types";
import { BUILTIN_SUB_THEMES } from "../../themes/builtinSubThemes";
import { SubThemeStyleHost } from "../../themes/SubThemeStyleHost";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../markdown/markdownPresentation";
import { AgentTranscript } from "./AgentTranscript";
import { AgentComposer } from "./AgentComposer";
import "./desktop-agent.css";

type Stage = "preview" | "dispatching" | "accepted";
type Fixture = { theme: "light" | "dark" | "windows-xp"; history: number; stage: Stage; width: number; generation: number; draft: string };
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
    <main className={`desktop-agent-render-smoke${colorMode === "dark" ? " dark" : ""}`} data-width={fixture.width}
      data-po-appearance-root="true" data-root-theme-id={fixture.theme === "windows-xp" ? "windows-xp" : "default"}
      data-sub-theme-id={subThemeId}>

    <section className="desktop-agent-boundary desktop-agent-render-smoke-panel">
      <AgentTranscript key={fixture.generation} projection={projection(fixture.history, fixture.stage)}
        pendingSubmissionId="submission:smoke" pendingPrompt={fixture.stage === "preview" ? prompt : null}
        submissionStage={fixture.stage === "accepted" ? null : "starting-turn"} working loading={false} />
      <AgentComposer draft={fixture.draft} onDraftChange={noOp} disabled={false}
        running={false} stopping={false} submitting={false} hideConfiguration
        onSubmit={async () => true} onStop={noOp} />
    </section>
  </main></>;
}

function projection(history: number, stage: Stage): AgentProjection {
  const display = createEmptyAgentDisplay();
  display.parts = Array.from({ length: history }, (_, i): AgentPart => ({
    id: `assistant:${i}`, kind: "assistant", text: `已有回复 ${i + 1}：检查消息布局与行高。`,
    turnId: `turn:${i}`, itemId: null, streaming: false, terminalState: null, sequence: i + 1,
  }));
  if (stage !== "preview") display.parts.push({ id: "user:smoke", submissionId: "submission:smoke",
    kind: "user", text: prompt, turnId: stage === "accepted" ? "turn:next" : null, itemId: null,
    streaming: false, terminalState: null, sequence: history + 1, deliveryStatus: stage });
  display.rows = display.parts.map(part => ({ id: `row:${part.id}`, partId: part.id,
    kind: part.kind, turnId: part.turnId, sequence: part.sequence, estimatedHeight: 64 }));
  if (stage === "accepted") display.runningTurnId = "turn:next";
  return display;
}

async function runSmoke(update: (fixture: Fixture) => void, active: () => boolean) {
  let generation = 0;
  let maxDrift = 0;
  let samples = 0;
  const cases: object[] = [];
  const html = document.documentElement;
  for (const theme of ["light", "dark", "windows-xp"] as const) {
    html.dataset.interfaceStyle = theme === "windows-xp" ? "windows-xp" : "default";
    html.classList.toggle("dark", theme === "dark");
    for (const width of [420, 560, 760]) {
      for (const history of [0, 1, 24]) {
        if (!active()) throw new Error("Smoke cancelled");
        const fixture: Fixture = { theme, history, width, generation: ++generation, stage: "preview", draft: "" };
        update(fixture);
        await frames();
        const node = user();
        const baseline = snapshot();
        const colors = messageColors(node);
        assert(colors.contrast >= 4.5, `${theme}: message contrast ${colors.contrast} is too low`);
        assert(theme === "dark" ? colors.textLuminance > colors.backgroundLuminance : colors.textLuminance < colors.backgroundLuminance,
          `${theme}: fixture did not apply the real theme palette`);
        for (const stage of ["dispatching", "accepted"] as const) {
          update({ ...fixture, stage });
          // Commit and each following frame: a settled screenshot alone misses flicker.
          for (let i = 0; i < 5; i++) {
            const next = snapshot();
            assert(user() === node, "Submission handoff replaced the user DOM node");
            assert(document.querySelectorAll(".desktop-agent-message.is-user").length === 1, "Duplicate user prompt");
            const drift = Math.max(Math.abs(next.y - baseline.y), Math.abs(next.height - baseline.height),
              Math.abs(next.workingY - baseline.workingY), Math.abs(next.scrollTop - baseline.scrollTop));
            maxDrift = Math.max(maxDrift, drift);
            assert(drift <= 1, `${theme}/${width}/${history}/${stage}: handoff moved ${drift}px`);
            samples++;
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
  scroller.scrollTop = scroller.scrollHeight * 0.45;
  scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  await frames();
  const top = scroller.getBoundingClientRect().top;
  const anchor = Array.from(document.querySelectorAll<HTMLElement>(".desktop-agent-virtual-row"))
    .find(row => row.getBoundingClientRect().bottom > top + 2)!;
  const anchorId = anchor.dataset.rowId!;
  const anchorY = anchor.getBoundingClientRect().top;
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
  return { cases, samples, maxDrift, readingAnchor: anchorId, composerPinning: true, semanticColor: afterColor };
}

function user() { return document.querySelector<HTMLElement>(".desktop-agent-message.is-user")!; }
function snapshot() {
  const rect = user().getBoundingClientRect();
  return { y: rect.y, height: rect.height,
    workingY: document.querySelector(".desktop-agent-working-indicator")!.getBoundingClientRect().y,
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
  return { textLuminance, backgroundLuminance,
    contrast: (Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05) };
}
