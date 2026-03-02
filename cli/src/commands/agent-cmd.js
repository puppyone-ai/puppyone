import { createClient } from "../api.js";
import { createOutput } from "../output.js";
import { withErrors, requireProject, formatDate } from "../helpers.js";

export function registerAgent(program) {
  const agent = program
    .command("agent")
    .description("Agent management — create, configure, and chat with AI agents");

  // ── ls ────────────────────────────────────────────────────
  agent
    .command("ls")
    .description("List agents in the active project")
    .action(withErrors(async (opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const data = await client.get("/agent-config", { project_id: projectId });
      const agents = Array.isArray(data) ? data : data?.items ?? [];

      out.table(
        agents.map((a) => ({
          id: (a.id ?? "").slice(0, 8),
          name: a.name ?? "-",
          type: a.type ?? "-",
          model: a.model ?? "-",
          updated: formatDate(a.updated_at),
        })),
        [
          { key: "id", label: "ID" },
          { key: "name", label: "NAME" },
          { key: "type", label: "TYPE" },
          { key: "model", label: "MODEL" },
          { key: "updated", label: "UPDATED" },
        ]
      );
      out.success({ agents });
    }));

  // ── create ────────────────────────────────────────────────
  agent
    .command("create")
    .description("Create a new agent")
    .argument("<name>", "agent name")
    .option("--type <type>", "agent type: chat, schedule", "chat")
    .option("--model <model>", "LLM model name")
    .option("--system-prompt <prompt>", "system prompt")
    .action(withErrors(async (name, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const projectId = requireProject(cmd);

      const body = {
        name,
        project_id: projectId,
        type: opts.type,
      };
      if (opts.model) body.model = opts.model;
      if (opts.systemPrompt) body.system_prompt = opts.systemPrompt;

      const created = await client.post("/agent-config", body);
      out.info(`Agent created: ${created.name ?? name} (${created.id})`);
      out.success({ agent: created });
    }));

  // ── info ──────────────────────────────────────────────────
  agent
    .command("info")
    .description("Show agent details")
    .argument("<id>", "agent ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      const info = await client.get(`/agent-config/${id}`);

      out.kv([
        ["Name:", info.name],
        ["ID:", info.id],
        ["Type:", info.type ?? "-"],
        ["Model:", info.model ?? "-"],
        ["System Prompt:", (info.system_prompt ?? "(none)").slice(0, 100)],
        ["Created:", formatDate(info.created_at)],
        ["Updated:", formatDate(info.updated_at)],
      ]);

      if (info.tools?.length) {
        out.info("\n  Bound tools:");
        for (const t of info.tools) {
          out.info(`    - ${t.name ?? t.tool_id ?? t.id}`);
        }
      }

      out.success({ agent: info });
    }));

  // ── update ────────────────────────────────────────────────
  agent
    .command("update")
    .description("Update agent configuration")
    .argument("<id>", "agent ID")
    .option("--name <name>", "new name")
    .option("--model <model>", "LLM model")
    .option("--system-prompt <prompt>", "system prompt")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);

      const body = {};
      if (opts.name) body.name = opts.name;
      if (opts.model) body.model = opts.model;
      if (opts.systemPrompt) body.system_prompt = opts.systemPrompt;

      const updated = await client.put(`/agent-config/${id}`, body);
      out.info(`Agent updated: ${id}`);
      out.success({ agent: updated });
    }));

  // ── rm ────────────────────────────────────────────────────
  agent
    .command("rm")
    .description("Delete an agent")
    .argument("<id>", "agent ID")
    .action(withErrors(async (id, opts, cmd) => {
      const out = createOutput(cmd);
      const client = createClient(cmd);
      await client.del(`/agent-config/${id}`);
      out.info(`Agent deleted: ${id}`);
      out.success({ deleted: id });
    }));

  // ── chat ──────────────────────────────────────────────────
  agent
    .command("chat")
    .description("Start an interactive chat with an agent (SSE streaming)")
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
        out.error("NO_AGENT", "No agent found.", "Create one with `puppyone agent create <name>`.");
        return;
      }

      if (opts.message) {
        out.step("Thinking...");
        const res = await client.raw("POST", "/agents", {
          agent_id: agentId,
          messages: [{ role: "user", content: opts.message }],
        });

        if (!res.ok) {
          out.done("");
          out.error("CHAT_FAILED", `Chat failed: ${res.status}`);
          return;
        }

        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream")) {
          out.done("");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let streamDone = false;

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
                if (evt.type === "content" || evt.content) {
                  process.stdout.write(evt.content ?? evt.text ?? "");
                }
              } catch { /* skip malformed events */ }
            }
          }
          console.log("");
        } else {
          const json = await res.json();
          out.done("");
          const content = json.data?.content ?? json.data?.message ?? json.message ?? JSON.stringify(json);
          out.raw(content);
        }

        out.success({ agent_id: agentId });
        return;
      }

      // Interactive mode
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
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let streamDone = false;

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
                  fullResponse += text;
                } catch { /* skip */ }
              }
            }
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
    }));
}
