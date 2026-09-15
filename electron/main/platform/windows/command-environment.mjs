import path from "node:path";

/** A new child of Desktop inherits its old PATH; read persistent PATH afresh. */
export async function readWindowsCommandEnvironment({ env, homedir, signal, runProbe, timeoutMs }) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error("Windows system root unavailable.");
  const file = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)",
    "$m=[Environment]::GetEnvironmentVariables('Machine')",
    "$u=[Environment]::GetEnvironmentVariables('User')",
    "foreach($k in $m.Keys){[Environment]::SetEnvironmentVariable($k,[string]$m[$k],'Process')}",
    "foreach($k in $u.Keys){if($k -ine 'Path'){[Environment]::SetEnvironmentVariable($k,[string]$u[$k],'Process')}}",
    "$p=@($m['Path'],$u['Path']) | Where-Object { $null -ne $_ -and $_ -ne '' }",
    "$v=@{PATH=[Environment]::ExpandEnvironmentVariables(($p -join ';'));PATHEXT=[Environment]::GetEnvironmentVariable('PATHEXT')}",
    "[Console]::Write(($v | ConvertTo-Json -Compress))",
  ].join("; ");
  const result = await runProbe(file, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env, cwd: homedir, signal, timeoutMs, maxOutputBytes: 256 * 1024, label: "Windows command environment",
  });
  if (result.code !== 0) throw new Error("Windows environment failed.");
  const values = JSON.parse(result.stdout.replace(/^\uFEFF/u, ""));
  if (typeof values.PATH !== "string" || values.PATH.includes("\0")) throw new Error("Windows PATH unavailable.");
  return { ...env, PATH: values.PATH,
    ...(typeof values.PATHEXT === "string" ? { PATHEXT: values.PATHEXT } : {}) };
}
