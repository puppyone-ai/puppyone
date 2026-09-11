/**
 * SerializeAddon covers cells and common modes, not the parser's continuation
 * state. This narrow compatibility adapter is pinned to xterm 6 and tested by
 * continuing identical VT streams on original and restored terminals.
 */
function internals(terminal) {
  const core = terminal?._core;
  if (!core?._bufferService?.buffers || !core?._charsetService || !core?._inputHandler?._stringDecoder) {
    throw new Error("The installed xterm version cannot restore terminal checkpoints.");
  }
  return core;
}
const captureAttributes = (value) => ({ fg: value.fg, bg: value.bg,
  extended: { ext: value.extended.ext, underlineColor: value.extended.underlineColor } });
const restoreAttributes = (target, value) => {
  target.fg = value.fg;
  target.bg = value.bg;
  target.extended = target.extended.clone();
  target.extended.ext = value.extended.ext;
  target.extended.underlineColor = value.extended.underlineColor;
  // OSC 8 IDs are local to a buffer's link registry, never reusable by number.
  target.extended.urlId = 0;
};

export function canCheckpointXterm(terminal) {
  const input = internals(terminal)._inputHandler;
  return input._parser.currentState === 0 && input._stringDecoder._interim === 0;
}

export function captureXtermCheckpoint(terminal) {
  const core = internals(terminal);
  const buffers = {};
  for (const name of ["normal", "alt"]) {
    const buffer = core._bufferService.buffers[name];
    buffers[name] = { x: buffer.x, y: buffer.y, scrollTop: buffer.scrollTop, scrollBottom: buffer.scrollBottom,
      tabs: { ...buffer.tabs }, savedX: buffer.savedX, savedY: buffer.savedY - buffer.ybase,
      savedCharset: buffer.savedCharset, savedAttributes: captureAttributes(buffer.savedCurAttrData) };
  }
  return structuredClone({ version: 1, buffers, modes: core.coreService.modes,
    privateModes: { ...core.coreService.decPrivateModes, synchronizedOutput: false },
    cursorHidden: core.coreService.isCursorHidden,
    charset: core._charsetService.charset, charsets: core._charsetService._charsets, glevel: core._charsetService.glevel,
    mouseEncoding: core.coreMouseService.activeEncoding, attributes: captureAttributes(core._inputHandler._curAttrData) });
}

export function restoreXtermCheckpoint(terminal, state) {
  if (state?.version !== 1) throw new Error("Unsupported terminal checkpoint state.");
  const core = internals(terminal);
  for (const name of ["normal", "alt"]) {
    const buffer = core._bufferService.buffers[name];
    const source = state.buffers[name];
    Object.assign(buffer, { x: source.x, y: source.y, scrollTop: source.scrollTop, scrollBottom: source.scrollBottom,
      tabs: { ...source.tabs }, savedX: source.savedX, savedY: Math.max(0, source.savedY + buffer.ybase), savedCharset: source.savedCharset });
    restoreAttributes(buffer.savedCurAttrData, source.savedAttributes);
  }
  Object.assign(core.coreService.modes, state.modes);
  Object.assign(core.coreService.decPrivateModes, state.privateModes);
  core.coreService.isCursorHidden = state.cursorHidden;
  core._charsetService._charsets = state.charsets;
  core._charsetService.glevel = state.glevel;
  core._charsetService.charset = state.charset;
  core.coreMouseService.activeEncoding = state.mouseEncoding;
  restoreAttributes(core._inputHandler._curAttrData, state.attributes);
}
