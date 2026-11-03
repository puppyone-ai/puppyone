/** Requests only a File Mode window can make; other windows are ignored. */
export function registerFileModeIpcHandlers({ ipcMain, getFileWindow }) {
  ipcMain.on("file-mode:set-edited", (event, edited) => {
    const fileWindow = getFileWindow(event.sender);
    if (!fileWindow) return;
    fileWindow.state.fileEdited = edited === true;
    fileWindow.window.setDocumentEdited?.(edited === true);
  });
}
