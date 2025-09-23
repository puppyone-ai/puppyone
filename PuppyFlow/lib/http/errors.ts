export class HttpError extends Error {
  status: number;
  details?: any;

  constructor(status: number, message: string, details?: any) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export async function buildHttpErrorFromResponse(
  res: Response,
  op: string,
  url?: string
): Promise<HttpError> {
  let text = '';
  let parsed: any = undefined;
  try {
    text = await res.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      // not json
    }
  } catch {
    // ignore
  }

  const message =
    (parsed && (parsed.error || parsed.message)) ||
    (text && text.substring(0, 400)) ||
    `${op} failed`;

  return new HttpError(res.status, message, {
    url,
    body: parsed ?? text ?? null,
  });
}

export async function ensureOk(
  res: Response,
  ctx: { op: string; url?: string }
): Promise<void> {
  if (!res.ok) {
    throw await buildHttpErrorFromResponse(res, ctx.op, ctx.url);
  }
}

export function normalizeError(
  err: any,
  defaultMessage?: string
): { status: number; message: string; details?: any } {
  if (err && typeof err.status === 'number') {
    return {
      status: err.status,
      message: err.message || defaultMessage || 'error',
      details: err.details,
    };
  }
  const message = (err && err.message) || defaultMessage || 'error';
  const m = String(message).match(/\b(\d{3})\b/);
  const n = m ? parseInt(m[1], 10) : NaN;
  const status = Number.isInteger(n) && n >= 400 && n < 600 ? n : 500;
  return { status, message };
}
