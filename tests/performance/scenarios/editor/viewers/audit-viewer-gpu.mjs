import { app, BrowserWindow } from "electron";

await app.whenReady();
const results = [];
for (const webgl of [false, true]) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webgl,
    },
  });
  await win.loadURL("data:text/html,<title>gpu-audit</title>");
  results.push(await win.webContents.executeJavaScript(`({
    configuredWebgl: ${webgl},
    hasWebGL: Boolean(document.createElement("canvas").getContext("webgl")),
    hasWebGL2: Boolean(document.createElement("canvas").getContext("webgl2")),
    hasWebGPU: Boolean(navigator.gpu),
  })`, true));
  win.destroy();
}
console.log(JSON.stringify(results));
app.quit();
