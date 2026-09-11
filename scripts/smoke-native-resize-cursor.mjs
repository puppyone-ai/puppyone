#!/usr/bin/env electron
// Exercise the real WebContents event and CSS APIs without starting any Agent.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, WebContentsView } from "electron";
import { createNativeSurfacePointerPassthroughCoordinator } from "../electron/main/native-surfaces/pointer-passthrough-coordinator.mjs";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-resize-cursor-"));
app.setPath("userData", path.join(temp, "user-data"));
const errors = [];
const observations = [];
const trace = [];
const coordinator = createNativeSurfacePointerPassthroughCoordinator({ onForwardError: error => errors.push(String(error)) });
let window;
const guard = setTimeout(() => { console.error("Native resize cursor smoke timed out."); app.exit(1); }, 20_000);
app.on("window-all-closed", () => {});

app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });

async function run() {
  try {
    window = new BrowserWindow({ width: 700, height: 500, show: false, webPreferences: { sandbox: true } });
    window.setIgnoreMouseEvents(true);
    await window.loadURL("data:text/html,<body>Resize cursor regression</body>");
    const child = new WebContentsView({ webPreferences: { sandbox: true } });
    window.contentView.addChildView(child);
    child.setBounds({ x: 300, y: 40, width: 350, height: 400 });
    await child.webContents.loadURL("data:text/html,<body><input style='cursor:text' value='Content cursor'></body>");
    const insert = child.webContents.insertCSS.bind(child.webContents);
    const remove = child.webContents.removeInsertedCSS.bind(child.webContents);
    child.webContents.insertCSS = async (...args) => { const key = await insert(...args); trace.push({ insert: key, args }); return key; };
    child.webContents.removeInsertedCSS = async key => { await remove(key); trace.push({ remove: key }); };
    child.webContents.on("before-mouse-event", (_event, mouse) => trace.push({ child: mouse.type, x: mouse.x, y: mouse.y }));
    window.webContents.on("before-mouse-event", (_event, mouse) => trace.push({ owner: mouse.type, x: mouse.x, y: mouse.y }));
    coordinator.register({ ownerWebContentsId: window.webContents.id, ownerWebContents: window.webContents,
      ownerWindow: window, surfaceView: child });
    window.show();
    const cursor = () => child.webContents.executeJavaScript("getComputedStyle(document.querySelector('input')).cursor");
    assert.equal(await cursor(), "text");
    const bodyCursor = () => child.webContents.executeJavaScript("getComputedStyle(document.body).cursor");
    const originalBodyCursor = await bodyCursor();
    const sendChild = (type, x, y) => child.webContents.sendInputEvent({ type, x, y,
      ...(type === "mouseMove" ? {} : { button: "left", clickCount: 1 }) });

    for (const direction of ["col-resize", "row-resize"]) {
      coordinator.setOwnerRoutingRegions(window.webContents.id, [{ id: 1, cursor: direction, x: 300, y: 40, width: 8, height: 400 }]);
      sendChild("mouseMove", 2, 60);
      await until(async () => await cursor() === direction, "hover cursor");
      sendChild("mouseDown", 2, 60);
      await until(() => coordinator.isOwnerActive(window.webContents.id), "native press forwarding");
      // The Shell gets the release after capture/geometry changes, even if its
      // resize handler never acquired a lease for the forwarded initial press.
      window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: 290, y: 100, clickCount: 1 });
      await until(() => !coordinator.isOwnerActive(window.webContents.id), "owner release");
      sendChild("mouseMove", 100, 60);
      await until(async () => await cursor() === "text", "restore native content cursor").catch(async error => { trace.push({ finalCursor: await cursor(), active: coordinator.isOwnerActive(window.webContents.id) }); throw error; });
      assert.equal(await bodyCursor(), originalBodyCursor);
      observations.push({ direction, releaseTarget: "owner", contentCursor: await cursor(), bodyCursor: await bodyCursor() });

      sendChild("mouseDown", 2, 60);
      await until(() => coordinator.isOwnerActive(window.webContents.id), "second press");
      sendChild("mouseUp", 100, 60);
      await until(() => !coordinator.isOwnerActive(window.webContents.id), "child release");
      await until(async () => await cursor() === "text", "restore after child release");
      assert.equal(await bodyCursor(), originalBodyCursor);
      observations.push({ direction, releaseTarget: "child", contentCursor: await cursor(), bodyCursor: await bodyCursor() });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, observations }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.stack, observations, errors, trace }));
    process.exitCode = 1;
  } finally {
    clearTimeout(guard);
    coordinator.dispose();
    if (window && !window.isDestroyed()) {
      for (const view of window.contentView.children) view.webContents?.close();
      window.destroy();
    }
    app.exit(process.exitCode || 0);
  }
}

async function until(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
