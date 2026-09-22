import { createMarkdownLayoutCoordinator } from "../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/layoutCoordinator";
import { getEditorLayoutSnapshot } from "../../../../packages/shared-ui/src/editor/runtime/editorLayout";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
function requireCondition(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const fixture = () => window.markdownLayoutFixture!;

/** Real production panes; only the probe owns test counters and orchestration. */
export const mdiLayoutProbe = {
  async resize(count: number) {
    await fixture().setPaneCount(count);
    const views = [...fixture().views];
    await fixture().probe.prepare();
    const readCount = fixture().readCount;
    for (const view of views) {
      const style = getComputedStyle(view.contentDOM);
      for (const property of ["--desktop-editor-first-track", "--desktop-editor-second-track"]) {
        requireCondition(style.getPropertyValue(property).trim() === "1fr", "Split ratios leaked into document styles");
      }
    }
    const before = getEditorLayoutSnapshot(document);
    fixture().probe.start();
    for (let step = 0; step < 32; step++) {
      await frame();
      for (const split of document.querySelectorAll<HTMLElement>(".desktop-editor-split")) {
        const ratio = 0.5 + Math.sin(step / 31 * Math.PI * 2) * 0.08;
        split.style.setProperty("--desktop-editor-first-track", `${ratio}fr`);
        split.style.setProperty("--desktop-editor-second-track", `${1 - ratio}fr`);
      }
    }
    const result = await fixture().probe.stop();
    const after = getEditorLayoutSnapshot(document);
    requireCondition(fixture().readCount === readCount, "Layout reloaded file contents");
    requireCondition(after.participants === count, `Leaked participants: ${after.participants} for ${count} panes`);
    requireCondition(after.failures === before.failures, "A pane failed during nested resize");
    requireCondition(views.every((view, index) => view === fixture().views[index] && view.dom.isConnected), "Resize recreated a view");
    const batches = after.batches - before.batches;
    requireCondition(batches > 0 && batches <= after.recentBatchMs.length, "Incomplete performance samples");
    const durations = after.recentBatchMs.slice(-batches).sort((a, b) => a - b);
    return { ...result, panes: count, batches, engineCommits: after.commits - before.commits, maxPasses: after.maxPasses,
      p95BatchMs: durations[Math.ceil(durations.length * 0.95) - 1], maxBatchMs: durations.at(-1) };
  },
  async appearance() {
    const layouts = fixture().views.map(createMarkdownLayoutCoordinator);
    await document.fonts.ready;
    await wait(150);
    const before = layouts.map(layout => layout.snapshot().commits);
    const previous = fixture().views.map(view => getComputedStyle(view.contentDOM).color);
    fixture().views.forEach(view => {
      view.dom.style.setProperty("--po-text", "rgb(91, 64, 160)");
      view.dom.style.setProperty("--po-md-content-color", "rgb(91, 64, 160)");
      view.dom.style.setProperty("--po-selection-background", "#746cb0");
    });
    layouts.forEach(layout => layout.invalidate("appearance"));
    await wait(150);
    requireCondition(layouts.every((layout, index) => layout.snapshot().commits === before[index]), "A color-only change triggered engine measurement");
    requireCondition(fixture().views.every((view, index) => getComputedStyle(view.contentDOM).color !== previous[index]), "Appearance fixture did not change the actual text color");
    return { panes: layouts.length, engineCommits: 0 };
  },
  async hiddenResume() {
    await fixture().probe.prepare();
    const view = fixture().views[0], layout = createMarkdownLayoutCoordinator(view);
    const pane = fixture().panes[0];
    pane.style.display = "none";
    await wait(100);
    requireCondition(layout.snapshot().suspended, "Hidden pane did not suspend");
    const before = layout.snapshot().commits;
    layout.invalidate("typography"); layout.invalidate("content");
    await wait(100);
    requireCondition(layout.snapshot().commits === before, "Hidden pane still measured");
    pane.style.display = "";
    await wait(200);
    requireCondition(!layout.snapshot().suspended && layout.snapshot().commits > before, "Restored pane did not resume");
    fixture().probe.start();
    await fixture().probe.resize(20);
    return fixture().probe.stop();
  },
  async staleDocument() {
    let callbacks = 0;
    for (const view of fixture().views) {
      const layout = createMarkdownLayoutCoordinator(view);
      layout.schedule({}, () => { callbacks++; return 1; }, () => { callbacks++; });
      view.dispatch({ changes: { from: 0, insert: "A new source revision.\n\n" } });
    }
    await wait(150);
    requireCondition(callbacks === 0, `Old document revision ran ${callbacks} callbacks`);
    return { callbacks, panes: fixture().views.length };
  },
  async dispose() {
    const layouts = fixture().views.map(createMarkdownLayoutCoordinator);
    let callbacks = 0;
    for (const layout of layouts) {
      layout.schedule({}, () => { callbacks++; return 1; }, () => { callbacks++; });
      layout.invalidate("content");
    }
    fixture().unmount();
    layouts.forEach(layout => { layout.request(); layout.schedule({}, () => { callbacks++; }, () => { callbacks++; }); });
    await wait(150);
    requireCondition(callbacks === 0, `Disposed view ran ${callbacks} late callbacks`);
    requireCondition(layouts.every(layout => layout.snapshot().disposed), "Unmount left a coordinator alive");
    const snapshot = getEditorLayoutSnapshot(document);
    requireCondition(snapshot.participants === 0 && snapshot.observedElements === 0 && snapshot.pending === 0, "Unmount leaked layout registrations");
    return { callbacks, ...snapshot };
  },
};
