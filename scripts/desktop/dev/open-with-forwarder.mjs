#!/usr/bin/env electron
// Electron entry behind the dev Open With app. It hands one file to the running
// dev instance and exits without opening a window of its own.
import path from "node:path";
import { app } from "electron";
import { getDesktopBuildChannelPolicy } from "../../../shared/desktop-build-identity.mjs";
import { forwardFile } from "./open-with.mjs";

app.dock?.hide();
app.exit(forwardFile({
  app,
  argv: process.argv,
  workingDirectory: process.cwd(),
  userDataPath: path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName),
}));
