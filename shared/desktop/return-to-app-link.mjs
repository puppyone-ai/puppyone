const RETURN_SCHEMES = Object.freeze({
  dev: "puppyone-development",
  internal: "puppyone-internal",
  stable: "puppyone",
});

export function getDesktopReturnScheme(channel) {
  const scheme = RETURN_SCHEMES[channel];
  if (!scheme) throw new Error(`Unsupported PuppyOne Desktop build channel: ${String(channel)}`);
  return scheme;
}

export function getDesktopReturnUrl(channel) {
  return `${getDesktopReturnScheme(channel)}://open`;
}

export function isDesktopReturnUrl(value, channel) {
  return value === getDesktopReturnUrl(channel);
}

export function isKnownDesktopReturnUrl(value) {
  return Object.values(RETURN_SCHEMES).some((scheme) => value === `${scheme}://open`);
}
