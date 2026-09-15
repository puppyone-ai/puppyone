import path from "node:path";

/** Windows batch entrypoints need cmd.exe; native binaries keep argv semantics. */
export function resolveProcessInvocation(file, args, { platform = process.platform, env = process.env } = {}) {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/iu.test(file)) return { file, args, options: {} };
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const shell = env.ComSpec || env.COMSPEC || path.win32.join(root, "System32", "cmd.exe");
  if (!path.win32.isAbsolute(shell)) throw new Error("A Windows batch launcher requires an absolute command processor.");
  const command = [file, ...args].map(quoteWindowsBatchArgument).join(" ");
  return { file: shell, args: ["/d", "/s", "/v:off", "/c", `"${command}"`],
    options: { windowsVerbatimArguments: true } };
}

export function quoteWindowsBatchArgument(value) {
  // cmd expands percent variables even inside quotes. Embedded quotes can end
  // a quoted word. Refuse unsupported inputs instead of executing altered argv.
  if (typeof value !== "string" || /["%\r\n\0]/u.test(value)) {
    throw new Error("This Windows batch entrypoint cannot preserve the requested argument. Use a native executable.");
  }
  return `"${value}"`;
}
