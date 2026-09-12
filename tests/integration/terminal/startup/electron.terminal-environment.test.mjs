import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTerminalEnvironment,
  createTerminalService,
} from "../../../../electron/main/terminal-service.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("Desktop Terminal environment boundary", () => {
  it("removes npm launcher metadata and stale Conda activation state from a fresh login shell", () => {
    const source = {
      HOME: "/Users/test",
      PATH: [
        "/workspace/node_modules/.bin",
        "/Users/test/.hermes/node/bin",
        "/opt/anaconda3/envs/project/bin",
        "/opt/anaconda3/bin",
        "/usr/bin",
      ].join(":"),
      SHELL: "/bin/zsh",
      http_proxy: "http://127.0.0.1:7897",
      npm_config_prefix: "/Users/test/.hermes/node",
      npm_execpath: "/Users/test/.hermes/node/lib/node_modules/npm/bin/npm-cli.js",
      npm_node_execpath: "/Users/test/.hermes/node/bin/node",
      npm_lifecycle_event: "dev",
      npm_lifecycle_script: "node scripts/dev-electron.mjs",
      npm_package_name: "@puppyone/desktop",
      npm_config_registry: "https://registry.npmjs.org/",
      NPM_TOKEN: "user-configured-token",
      INIT_CWD: "/workspace",
      PREFIX: "/Users/test/.hermes/node",
      CONDA_PREFIX: "/opt/anaconda3/envs/project",
      CONDA_PREFIX_1: "/opt/anaconda3",
      CONDA_SHLVL: "2",
      CONDA_DEFAULT_ENV: "project",
      CONDA_PROMPT_MODIFIER: "(project) ",
      CONDA_STACKED_2: "true",
      __CONDA_SHLVL_1_SDKROOT: "/old-sdk",
      CONDA_PATH_BACKUP: "/legacy/path",
      CONDA_PS1_BACKUP: "old prompt",
      CONDA_EXE: "/opt/anaconda3/bin/conda",
      CONDA_ROOT: "/opt/anaconda3",
      NO_COLOR: "1",
      COLORFGBG: "0;15",
      TERM: "inherited-term",
      TERM_PROGRAM: "inherited-program",
    };
    const original = { ...source };

    const environment = buildTerminalEnvironment(source, {
      appVersion: "0.2.0-test",
      freshLoginShell: true,
      platform: "darwin",
    });

    expect(source).toEqual(original);
    for (const key of [
      "npm_config_prefix",
      "npm_execpath",
      "npm_node_execpath",
      "npm_lifecycle_event",
      "npm_lifecycle_script",
      "npm_package_name",
      "INIT_CWD",
      "PREFIX",
      "CONDA_PREFIX",
      "CONDA_PREFIX_1",
      "CONDA_SHLVL",
      "CONDA_DEFAULT_ENV",
      "CONDA_PROMPT_MODIFIER",
      "CONDA_STACKED_2",
      "__CONDA_SHLVL_1_SDKROOT",
      "CONDA_PATH_BACKUP",
      "CONDA_PS1_BACKUP",
      "NO_COLOR",
      "COLORFGBG",
    ]) {
      expect(environment[key], key).toBeUndefined();
    }
    expect(environment.PATH).toBe([
      "/workspace/node_modules/.bin",
      "/Users/test/.hermes/node/bin",
      "/usr/bin",
    ].join(":"));
    expect(environment).toMatchObject({
      HOME: "/Users/test",
      SHELL: "/bin/zsh",
      http_proxy: "http://127.0.0.1:7897",
      npm_config_registry: "https://registry.npmjs.org/",
      NPM_TOKEN: "user-configured-token",
      CONDA_EXE: "/opt/anaconda3/bin/conda",
      CONDA_ROOT: "/opt/anaconda3",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      CLICOLOR: "1",
      TERM_PROGRAM: "PuppyOne",
      TERM_PROGRAM_VERSION: "0.2.0-test",
      PUPPYONE_TERMINAL: "1",
    });
  });

  it("declares the renderer brightness for programs that cannot query OSC", () => {
    const darkEnvironment = buildTerminalEnvironment({ COLORFGBG: "0;15" }, {
      appVersion: "test",
      defaultColors: {
        foreground: [209, 206, 198],
        background: [22, 20, 19],
      },
    });
    const lightEnvironment = buildTerminalEnvironment({}, {
      appVersion: "test",
      defaultColors: {
        foreground: [41, 39, 35],
        background: [251, 250, 247],
      },
    });

    expect(darkEnvironment.COLORFGBG).toBe("15;0");
    expect(lightEnvironment.COLORFGBG).toBe("0;15");
  });

  it.each([
    "npm_config_prefix",
    "NPM_CONFIG_PREFIX",
    "NpM_CoNfIg_PrEfIx",
  ])("removes the %s spelling that nvm treats as npm_config_prefix", (key) => {
    const environment = buildTerminalEnvironment({
      HOME: "/Users/test",
      [key]: "/unexpected-prefix",
    }, { appVersion: "test", platform: "darwin" });

    expect(environment[key]).toBeUndefined();
    expect(environment.HOME).toBe("/Users/test");
  });

  it("preserves Conda state for a non-login shell while still removing npm process metadata", () => {
    const environment = buildTerminalEnvironment({
      PATH: "/opt/anaconda3/envs/project/bin:/usr/bin",
      CONDA_PREFIX: "/opt/anaconda3/envs/project",
      CONDA_SHLVL: "1",
      npm_execpath: "/tools/npm-cli.js",
      npm_config_prefix: "/tools/node",
    }, {
      appVersion: "test",
      freshLoginShell: false,
      platform: "darwin",
    });

    expect(environment).toMatchObject({
      PATH: "/opt/anaconda3/envs/project/bin:/usr/bin",
      CONDA_PREFIX: "/opt/anaconda3/envs/project",
      CONDA_SHLVL: "1",
    });
    expect(environment.npm_execpath).toBeUndefined();
    expect(environment.npm_config_prefix).toBeUndefined();
  });

  it("passes only the normalized environment to the PTY instead of rereading ambient process.env", async () => {
    const workspaceRoot = await makeTemporaryDirectory();
    const ptyService = { spawn: vi.fn(() => createFakeTerminal()) };
    const service = createTerminalService({
      appVersion: "test",
      environment: {
        HOME: "/Users/test",
        PATH: "/usr/bin:/opt/anaconda3/bin",
        SHELL: "/bin/zsh",
        npm_config_prefix: "/Users/test/.hermes/node",
        npm_execpath: "/Users/test/.hermes/node/lib/node_modules/npm/bin/npm-cli.js",
        CONDA_PREFIX: "/opt/anaconda3",
        CONDA_SHLVL: "1",
      },
      initializeWorkspaceEditReview: vi.fn(async () => undefined),
      platform: "darwin",
      ptyService,
    });

    await service.create(createSender(), {
      id: "terminal_env_boundary",
      cwd: workspaceRoot,
      cols: 90,
      rows: 30,
      defaultColors: {
        foreground: [209, 206, 198],
        background: [22, 20, 19],
      },
    }, workspaceRoot);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);

    expect(ptyService.spawn).toHaveBeenCalledOnce();
    const [file, args, options] = ptyService.spawn.mock.calls[0];
    expect(file).toBe("/bin/zsh");
    expect(args).toEqual(["-l"]);
    expect(options).toMatchObject({
      cwd: canonicalWorkspaceRoot,
      cols: 90,
      rows: 30,
      env: {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        TERM_PROGRAM: "PuppyOne",
        PUPPYONE_TERMINAL: "1",
        COLORFGBG: "15;0",
      },
    });
    expect(options.env.npm_config_prefix).toBeUndefined();
    expect(options.env.npm_execpath).toBeUndefined();
    expect(options.env.CONDA_PREFIX).toBeUndefined();
    expect(options.env.CONDA_SHLVL).toBeUndefined();
  });
});

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-terminal-env-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createFakeTerminal() {
  return {
    pid: 123,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

function createSender() {
  return {
    id: 41,
    isDestroyed: () => false,
    send: vi.fn(),
  };
}
