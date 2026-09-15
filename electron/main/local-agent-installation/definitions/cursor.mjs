export const cursorInstallationDefinition = Object.freeze({
  id: "cursor",
  displayName: "Cursor Agent",
  executableNames: Object.freeze(["cursor-agent", "agent", "cursor agent"]),
  identityPolicy: Object.freeze({
    requiredForInvocations: Object.freeze(["agent"]),
    pathFragments: Object.freeze(["cursor-agent", "/cursor/"]),
    fileMarkers: Object.freeze(["cursor-agent", "cursor_invoked_as"]),
  }),
});
