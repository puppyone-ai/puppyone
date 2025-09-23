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
      // non-json
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
  if (err && typeof err === 'object') {
    const status = (err as any).status || 500;
    const message = (err as any).message || defaultMessage || 'Internal Error';
    const details = (err as any).details;
    return { status, message, details };
  }
  return { status: 500, message: defaultMessage || String(err) };
}
