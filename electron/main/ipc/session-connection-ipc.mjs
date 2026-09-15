import { randomUUID } from "node:crypto";

export function sendSessionRuntimeFailure(sender, kind, record, event) {
  const failed = ["host-failed", "stream-failed", "control-failed"].includes(event.type)
    || (event.type === "host-exited" && !event.expected);
  if (!failed || !sender || sender.isDestroyed()) return;
  sender.send("session:failure", {
    kind,
    id: kind === "agent" ? record.sessionId : record.id,
    instanceId: record.instanceId,
    message: event.message ?? "The session process exited.",
  });
}

/** Connect trusted window UI to an existing execution process. No view or layout is created here. */
export function registerSessionConnectionIpcHandlers({ ipcMain, MessageChannelMain, projectSessions, agentService, terminalService }) {
  const connect = (event, request, service) => projectSessions.run(event.sender.id, request?.projectContext, async (operation) => {
    const frame = event.senderFrame;
    const frameUrl = frame.url;
    if (typeof request.instanceId !== "string" || !request.instanceId) throw new Error("A session instance is required.");
    const project = projectSessions.require(event.sender.id, request.projectContext);
    service.assertSessionInstance(event.sender, request, project.rootPath);
    const { port1, port2 } = new MessageChannelMain();
    const binding = { connection: randomUUID(), root: project.rootPath };
    try {
      const result = await service.attachDisplay(event.sender, request, port1, binding);
      operation.assertCurrent();
      if (event.sender.isDestroyed()) throw new Error("The session window closed during connection.");
      if (frame.isDestroyed() || frame !== event.sender.mainFrame || frame.url !== frameUrl) {
        throw new Error("The session page changed during connection.");
      }
      const connection = { connection: binding.connection, hostGeneration: result.hostGeneration };
      frame.postMessage("session:port", connection, [port2]);
      return connection;
    } catch (error) {
      port1.close();
      port2.close();
      throw error;
    }
  });
  ipcMain.handle("agent:session-connect", (event, request) => connect(event, request, agentService));
  ipcMain.handle("terminal:connect", (event, request) => connect(event, request, terminalService));
}
