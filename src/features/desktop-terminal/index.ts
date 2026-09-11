export { isDesktopTerminalEnabled } from "./featureGate";
export function loadTerminalItemRenderer() {
  return import("./renderer/TerminalItemRenderer").then((module) => ({ default: module.TerminalItemRenderer }));
}
export {
  type DesktopTerminalSessionStatus,
  type DesktopTerminalSessionSummary,
} from "./model/terminalSessions";
