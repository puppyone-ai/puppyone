/** Native conversation identity shared by discovery, restore and live envelopes. */
export function nativeSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._/-]{1,512}$/.test(value) ? value : null;
}
