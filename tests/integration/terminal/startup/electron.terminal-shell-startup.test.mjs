import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pty from "node-pty";
import { describe, expect, it } from "vitest";
import { createTerminalShellHost } from "../../../../electron/main/terminal-shell-host.mjs";

describe.each(["/bin/zsh", "/bin/bash"])("Terminal startup with a real %s PTY", (shell) => {
  it.skipIf(process.platform === "win32" || !existsSync(shell))("runs the Agent with the resolved environment before loading prompt configuration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-resolved-shell-"));
    let terminal;
    let exited = false;
    try {
      await writeFile(path.join(directory, shell === "/bin/zsh" ? ".zshrc" : ".bash_profile"),
        "export CLI_SELECTION=changed-by-startup\nprintf 'PROMPT_CONFIG_LOADED\\n'\nPS1='READY> '\n");
      const script = path.join(directory, "fixture.cjs");
      await writeFile(script, "console.log('AGENT_ENV:' + process.env.CLI_SELECTION);\n");
      const environment = { HOME: directory, ZDOTDIR: directory, SHELL: shell, PATH: "/usr/bin:/bin", CLI_SELECTION: "resolved" };
      const host = createTerminalShellHost({ platform: process.platform, environment,
        agentLaunch: { executablePath: process.execPath, args: [script], environment } });
      terminal = pty.spawn(host.file, host.args, { cwd: directory, cols: 160, rows: 24,
        env: { ...host.commandEnvironment, ...host.environment }, name: "xterm-256color" });
      let output = "";
      terminal.onData((data) => { output += data; });
      terminal.onExit(() => { exited = true; });
      await until(() => output.includes("READY>"), () => output);
      expect(output).toContain("AGENT_ENV:resolved");
      expect(output.indexOf("AGENT_ENV:resolved")).toBeLessThan(output.indexOf("PROMPT_CONFIG_LOADED"));
      terminal.write("exit\r");
      await until(() => exited, () => output);
    } finally {
      if (terminal && !exited) terminal.kill();
      if (terminal) await until(() => exited, () => "PTY cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
  it.skipIf(process.platform === "win32" || !existsSync(shell)).each([0, 1])("preserves launch arguments across startup input and returns to a shell after Agent exit %s", async (exitCode) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-shell-startup-"));
    let terminal;
    let exited = false;
    try {
      await writeFile(path.join(directory, shell === "/bin/zsh" ? ".zshrc" : ".bash_profile"), [
        "if [[ -z $PUPPYONE_TEST_INITIALIZED ]]; then",
        "  export PUPPYONE_TEST_INITIALIZED=1",
        "  printf 'STARTUP_WAITING\\n'",
        `  read -r ${shell === "/bin/zsh" ? "-k" : "-n"} 1 answer`,
        "  printf 'STARTUP_ANSWER:%s\\n' \"$answer\"",
        "fi",
        "PS1='SHELL_READY> '",
        "RPROMPT=''",
        "",
      ].join("\n"));
      const agentScript = path.join(directory, "agent's script.cjs");
      await writeFile(agentScript, [
        "console.log('AGENT_ARGS:' + JSON.stringify(process.argv.slice(2)));",
        `process.exit(${exitCode});`,
        "",
      ].join("\n"));
      const args = ["work space", "a'b", "$(printf INJECTED)", "semi;colon"];
      const host = createTerminalShellHost({
        environment: { SHELL: shell },
        platform: process.platform,
        agentLaunch: { executablePath: process.execPath, args: [agentScript, ...args], displayName: "Test Agent" },
      });
      terminal = pty.spawn(host.file, host.args, {
        cwd: directory,
        cols: 200,
        rows: 24,
        name: "xterm-256color",
        env: { HOME: directory, ZDOTDIR: directory, PATH: "/usr/bin:/bin", ...host.environment },
      });
      let output = "";
      terminal.onData((data) => { output += data; });
      terminal.onExit(() => { exited = true; });
      if (host.agentBootstrapInput) terminal.write(host.agentBootstrapInput);

      await until(() => output.includes("STARTUP_WAITING"), () => output);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(output).not.toContain("STARTUP_ANSWER:");
      expect(output).not.toContain("AGENT_ARGS:");
      terminal.write("n");
      await until(() => output.includes("SHELL_READY>"), () => output);
      expect(output).toContain("STARTUP_ANSWER:n");
      expect(output).toContain(`AGENT_ARGS:${JSON.stringify(args)}`);
      expect(output).not.toContain("quote>");
      expect(exited).toBe(false);

      terminal.write("printf 'SHELL_%s\\n' USABLE\r");
      await until(() => output.includes("SHELL_USABLE"), () => output);
      terminal.write("exit\r");
      await until(() => exited, () => output);
    } finally {
      if (terminal && !exited) terminal.kill();
      if (terminal) await until(() => exited, () => "PTY cleanup");
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

async function until(check, output) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for PTY output: ${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
