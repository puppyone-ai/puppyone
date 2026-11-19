/**
 * One program, two roles: the windowed App, or Puppyone Host (no windows),
 * which shares this computer's registered folders and keeps doing so after
 * the App quits.
 */
import { HOST_SERVICE_ARGUMENT } from "./host-service/paths.mjs";

if (process.argv.includes(HOST_SERVICE_ARGUMENT)) await import("./host-service/electron-main.mjs");
else await import("./main.mjs");
