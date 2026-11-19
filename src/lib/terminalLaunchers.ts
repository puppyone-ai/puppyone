type DesktopTerminalLauncherDefinitionShape = {
  id: string;
  descriptionMessage: string;
  nameMessage: string;
};

export const DESKTOP_TERMINAL_LAUNCHERS = Object.freeze([
  Object.freeze({
    id: "codex",
    descriptionMessage: "terminal.launcher.codex.description",
    nameMessage: "terminal.launcher.codex.name",
  }),
  Object.freeze({
    id: "claude",
    descriptionMessage: "terminal.launcher.claude.description",
    nameMessage: "terminal.launcher.claude.name",
  }),
  Object.freeze({
    id: "cursor",
    descriptionMessage: "terminal.launcher.cursor.description",
    nameMessage: "terminal.launcher.cursor.name",
  }),
  Object.freeze({
    id: "opencode",
    descriptionMessage: "terminal.launcher.opencode.description",
    nameMessage: "terminal.launcher.opencode.name",
  }),
  Object.freeze({
    id: "pi",
    descriptionMessage: "terminal.launcher.pi.description",
    nameMessage: "terminal.launcher.pi.name",
  }),
  Object.freeze({
    id: "hermes",
    descriptionMessage: "terminal.launcher.hermes.description",
    nameMessage: "terminal.launcher.hermes.name",
  }),
  Object.freeze({
    id: "shell",
    descriptionMessage: "terminal.launcher.shell.description",
    nameMessage: "terminal.launcher.shell.name",
  }),
] as const satisfies readonly DesktopTerminalLauncherDefinitionShape[]);

export type DesktopTerminalLauncherDefinition =
  (typeof DESKTOP_TERMINAL_LAUNCHERS)[number];
export type DesktopTerminalLauncherId = DesktopTerminalLauncherDefinition["id"];

const launcherById = new Map(
  DESKTOP_TERMINAL_LAUNCHERS.map((launcher) => [launcher.id, launcher]),
);

export function getDesktopTerminalLauncher(
  launcherId: DesktopTerminalLauncherId,
): DesktopTerminalLauncherDefinition {
  const launcher = launcherById.get(launcherId);
  if (!launcher) throw new Error(`Unknown terminal launcher: ${launcherId}`);
  return launcher;
}
