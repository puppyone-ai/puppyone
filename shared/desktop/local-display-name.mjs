/** A local package label does not change its release, data or credential identity. */
export function resolveLocalDisplayName({ channel, displayName, fallback }) {
  if (displayName == null) return fallback;
  if (channel !== "dev") throw new Error("A local display name is only supported for dev builds.");
  if (typeof displayName !== "string" || displayName !== displayName.trim()
    || displayName.length === 0 || displayName.length > 64
    || displayName.startsWith(".") || /[<>:"/\\|?*\u0000-\u001f]/u.test(displayName)) {
    throw new Error("Invalid local display name.");
  }
  return displayName;
}
