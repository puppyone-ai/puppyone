import { describe, expect, it, vi } from "vitest";
import {
  createWindowsRegisteredApplicationLocator,
  parseWindowsRegistryDefaultValue,
  registeredExecutablePath,
} from "../../../../electron/main/platform/windows/registered-applications.mjs";

describe("Windows registered application discovery", () => {
  it("parses localized registry output by type and expands Windows environment variables", () => {
    const output = [
      "",
      "HKEY_CURRENT_USER\\Software\\Classes\\Applications\\WorkBuddy.exe\\shell\\open\\command",
      "    （默认）    REG_EXPAND_SZ    \"%LOCALAPPDATA%\\WorkBuddy\\WorkBuddy.exe\" \"%1\"",
      "",
    ].join("\r\n");
    const value = parseWindowsRegistryDefaultValue(Buffer.from(`\uFEFF${output}`, "utf16le"));
    expect(value).toBe('"%LOCALAPPDATA%\\WorkBuddy\\WorkBuddy.exe" "%1"');
    expect(registeredExecutablePath(value, { LOCALAPPDATA: "C:\\Users\\测试\\AppData\\Local" }))
      .toBe("C:\\Users\\测试\\AppData\\Local\\WorkBuddy\\WorkBuddy.exe");
  });

  it("deduplicates user and machine registrations and rejects a mismatched executable name", async () => {
    const execFile = vi.fn((_file, args, _options, callback) => {
      const applicationName = args[1].includes("WorkBuddy AI.exe") ? "WorkBuddy AI.exe" : "WorkBuddy.exe";
      const executableName = args[1].includes("App Paths") && applicationName === "WorkBuddy AI.exe"
        ? "Unrelated.exe"
        : applicationName;
      const output = `HKEY fixture\r\n    (Default)    REG_SZ    \"D:\\AI Tools\\${executableName}\" \"%1\"\r\n`;
      callback(null, Buffer.from(output, "utf8"));
    });
    const locator = createWindowsRegisteredApplicationLocator({
      nodePlatform: "win32",
      environment: { SystemRoot: "C:\\Windows" },
      execFile,
    });

    await expect(locator.find(["WorkBuddy.exe", "WorkBuddy AI.exe"])).resolves.toEqual([
      {
        applicationName: "WorkBuddy.exe",
        executablePath: "D:\\AI Tools\\WorkBuddy.exe",
        source: "windows-application-registration",
      },
      {
        applicationName: "WorkBuddy AI.exe",
        executablePath: "D:\\AI Tools\\WorkBuddy AI.exe",
        source: "windows-application-registration",
      },
    ]);
    expect(execFile).toHaveBeenCalledTimes(8);
  });

  it("does no registry IO outside Windows", async () => {
    const execFile = vi.fn();
    const locator = createWindowsRegisteredApplicationLocator({ nodePlatform: "darwin", execFile });
    await expect(locator.find(["WorkBuddy.exe"])).resolves.toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });
});
