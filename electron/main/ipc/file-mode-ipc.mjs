/** Requests only a File Mode window can make; other windows are ignored. */
export function registerFileModeIpcHandlers({ ipcMain, getFileWindow, openFolder }) {
  ipcMain.on("file-mode:set-edited", (event, edited) => {
    const fileWindow = getFileWindow(event.sender);
    if (!fileWindow) return;
    fileWindow.state.fileEdited = edited === true;
    fileWindow.window.setDocumentEdited?.(edited === true);
  });

  ipcMain.handle("file-mode:open-folder", async (event) => {
    const fileWindow = getFileWindow(event.sender);
    if (!fileWindow) throw new Error("This window is not showing a file.");
    await openFolder(fileWindow.state.fileTarget);
    fileWindow.window.close();
  });
}
