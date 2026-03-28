/**
 * puppyone chat [agent-id]
 *
 * Start an interactive chat with an AI agent (SSE streaming).
 * Supports both interactive REPL and single-message mode (-m).
 */

import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject } from "../helpers.js";

export function registerChat(program) {
  program
    .command("chat")
    .description("Chat with an AI agent (SSE streaming)")
    .argument("[id]", "agent ID (defaults to project default agent)")
    .option("-m, --message <msg>", "single message (non-interactive)")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      let agentId = id;
      if (!agentId) {
        const defaultAgent = await client.get("/agent-config/default", { project_id: projectId });
        agentId = defaultAgent?.id;
      }

      if (!agentId) {
        out.error("NO_AGENT", "No agent found.",
          "Create one with `puppyone access add agent <name>`.");
        return;
      }

      if (opts.message) {
        await _singleMessage(client, out, agentId, opts.message);
        return;
      }

      await _interactiveChat(client, out, agentId);
    }));
}

async function _singleMessage(client, out, agentId, message) {
  out.step("Thinking...");
  const res = await client.raw("POST", "/agents", {
    agent_id: agentId,
    messages: [{ role: "user", content: message }],
  });

  if (!res.ok) {
    out.done("");
    out.error("CHAT_FAILED", `Chat failed: ${res.status}`);
    return;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    out.done("");
    await _consumeSSE(res);
    console.log("");
  } else {
    const json = await res.json();
    out.done("");
    const content = json.data?.content ?? json.data?.message ?? json.message ?? JSON.stringify(json);
    out.raw(content);
  }

  out.success({ agent_id: agentId });
}

async function _interactiveChat(client, out, agentId) {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout: stdoutStream } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdoutStream });

  out.info(`Chat with agent ${agentId}. Type /quit to exit.\n`);
  const messages = [];

  try {
    while (true) {
      const userInput = await rl.question("You: ");
      if (!userInput.trim()) continue;
      if (userInput.trim() === "/quit" || userInput.trim() === "/exit") break;

      messages.push({ role: "user", content: userInput });

      const res = await client.raw("POST", "/agents", {
        agent_id: agentId,
        messages,
      });

      if (!res.ok) {
        out.warn(`Request failed: ${res.status}`);
        continue;
      }

      process.stdout.write("Agent: ");

      const contentType = res.headers.get("content-type") ?? "";
      let fullResponse = "";

      if (contentType.includes("text/event-stream")) {
        fullResponse = await _consumeSSE(res);
      } else {
        const json = await res.json();
        fullResponse = json.data?.content ?? json.data?.message ?? JSON.stringify(json);
        process.stdout.write(fullResponse);
      }

      console.log("\n");
      messages.push({ role: "assistant", content: fullResponse });
    }
  } finally {
    rl.close();
  }

  out.info("Chat ended.");
}

async function _consumeSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;
  let fullText = "";

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") { streamDone = true; break; }
      try {
        const evt = JSON.parse(payload);
        const text = evt.content ?? evt.text ?? "";
        process.stdout.write(text);
        fullText += text;
      } catch { /* skip malformed events */ }
    }
  }

  return fullText;
}
