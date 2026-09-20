export class ActivationError extends Error {
  constructor(code) { super(`Activation failed: ${code}`); this.code = code; }
}
