const CHANNELS = [
  {
    id: "workbuddy-china",
    installationId: "workbuddy-china",
    displayName: "WorkBuddy (China)",
    channel: "china-app",
    route: "internal",
    authenticationMethodId: "internal",
    configDirectoryName: ".workbuddy",
    configDirectoryEnvironmentVariable: "WORKBUDDY_CHINA_CONFIG_DIR",
  },
  {
    id: "workbuddy-international",
    installationId: "workbuddy-international",
    displayName: "WorkBuddy (International)",
    channel: "international-app",
    route: "public",
    authenticationMethodId: "external",
    configDirectoryName: ".workbuddy-ai",
    configDirectoryEnvironmentVariable: "WORKBUDDY_INTERNATIONAL_CONFIG_DIR",
  },
];

export const WORKBUDDY_CHANNELS = Object.freeze(Object.fromEntries(
  CHANNELS.map((channel) => [channel.id, Object.freeze(channel)]),
));

export const WORKBUDDY_CHINA_CHANNEL = WORKBUDDY_CHANNELS["workbuddy-china"];
export const WORKBUDDY_INTERNATIONAL_CHANNEL = WORKBUDDY_CHANNELS["workbuddy-international"];

export function requireWorkBuddyChannel(value) {
  const runtimeId = typeof value === "string" ? value : value?.id;
  const channel = WORKBUDDY_CHANNELS[runtimeId];
  if (!channel) throw new TypeError(`Unknown WorkBuddy product channel: ${runtimeId || "missing"}`);
  return channel;
}
