import { describe, expect, it } from "vitest";
import { ipcErrorMessage } from "../../../../packages/shared-ui/src/core/ipcErrorMessage";

describe("IPC error messages shown to users", () => {
  it("drops Electron's channel wrapper and the nested Error prefix", () => {
    expect(ipcErrorMessage("Error invoking remote method 'workspace:get-file-url': Error: Resource does not have a PDF header."))
      .toBe("Resource does not have a PDF header.");
    expect(ipcErrorMessage("Error invoking remote method 'database-preview:open': TypeError: Database is locked"))
      .toBe("Database is locked");
  });

  it("leaves ordinary messages untouched", () => {
    expect(ipcErrorMessage("The file was moved.")).toBe("The file was moved.");
    expect(ipcErrorMessage("Errors in row 3")).toBe("Errors in row 3");
  });
});
