import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Bash 权限配置类型
interface BashAccessPoint {
  path: string; // JSON 路径，如 "" (根), "/articles", "/0/content"
  mode: 'readonly' | 'full';
}

// 沙盒 API 调用封装
class SandboxClient {
  private baseUrl: string;
  private sessionId: string;

  constructor(sessionId: string) {
    this.baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    this.sessionId = sessionId;
  }

  private async call(
    action: string,
    extra: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/api/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sessionId: this.sessionId, ...extra }),
    });
    return response.json();
  }

  // 启动沙盒，支持只读模式
  async start(
    data: unknown,
    readonly: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    return this.call('start', { data, readonly }) as Promise<{
      success: boolean;
      error?: string;
    }>;
  }

  async exec(
    command: string
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    return this.call('exec', { command }) as Promise<{
      success: boolean;
      output?: string;
      error?: string;
    }>;
  }

  async read(): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return this.call('read') as Promise<{
      success: boolean;
      data?: unknown;
      error?: string;
    }>;
  }

  async stop(): Promise<void> {
    await this.call('stop');
  }
}

// 工具定义 - 使用 Claude 官方 bash tool 类型
// 参考: https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool
const BASH_TOOL = { type: 'bash_20250124' as const, name: 'bash' as const };

const FILE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the specified path',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'The file path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'glob_search',
    description: 'Search for files matching a glob pattern',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match files' },
        cwd: {
          type: 'string',
          description: 'Working directory for the search',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description: 'Search for a pattern in files',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: {
          type: 'string',
          description: 'File or directory path to search in',
        },
      },
      required: ['pattern'],
    },
  },
];

// 根据 JSON 路径从数据中提取节点
// 路径格式: "" (根), "/articles", "/0/content", "/users/0/name"
function extractDataByPath(data: unknown, jsonPath: string): unknown {
  if (!jsonPath || jsonPath === '' || jsonPath === '/') {
    return data;
  }

  const segments = jsonPath.split('/').filter(Boolean);
  let current: unknown = data;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

// 将修改后的节点数据合并回原数据
function mergeDataByPath(
  originalData: unknown,
  jsonPath: string,
  newNodeData: unknown
): unknown {
  if (!jsonPath || jsonPath === '' || jsonPath === '/') {
    return newNodeData;
  }

  // 深拷贝原数据
  const result = JSON.parse(JSON.stringify(originalData));
  const segments = jsonPath.split('/').filter(Boolean);

  let current: unknown = result;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (Array.isArray(current)) {
      current = current[parseInt(segment, 10)];
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[segment];
    }
  }

  // 设置最后一个节点的值
  const lastSegment = segments[segments.length - 1];
  if (Array.isArray(current)) {
    (current as unknown[])[parseInt(lastSegment, 10)] = newNodeData;
  } else if (typeof current === 'object' && current !== null) {
    (current as Record<string, unknown>)[lastSegment] = newNodeData;
  }

  return result;
}

// 执行文件工具
function executeFileTool(
  name: string,
  input: Record<string, string>,
  cwd: string
): string {
  try {
    switch (name) {
      case 'read_file': {
        const filePath = path.resolve(cwd, input.path);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${input.path}`;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return content.length > 50000
          ? content.substring(0, 50000) + '\n... (truncated)'
          : content;
      }
      case 'glob_search': {
        const searchCwd = input.cwd ? path.resolve(cwd, input.cwd) : cwd;
        const files = glob.sync(input.pattern, { cwd: searchCwd, nodir: true });
        return files.length > 0
          ? files.slice(0, 100).join('\n') +
              (files.length > 100 ? `\n... and ${files.length - 100} more` : '')
          : 'No files found';
      }
      case 'grep_search': {
        const searchPath = path.resolve(cwd, input.path || '.');
        try {
          const result = execSync(
            `grep -r -n "${input.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -100`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          return result || 'No matches found';
        } catch {
          return 'No matches found';
        }
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: unknown) {
    const error = err as { message?: string };
    return `Error: ${error.message}`;
  }
}

// 生成系统提示 - 根据权限模式
function generateSystemPrompt(isReadonly: boolean, nodePath: string): string {
  const pathDesc = nodePath ? `节点路径: ${nodePath}` : '根节点';

  if (isReadonly) {
    return `你是一个 JSON 数据查看助手。

当前 JSON 数据文件位于: /workspace/data.json
${pathDesc}

⚠️ 重要：你只有【只读权限】，不能修改数据！

【查看数据】
- 查看原始内容: cat /workspace/data.json
- 格式化查看: cat /workspace/data.json | jq '.'
- 查看特定字段: cat /workspace/data.json | jq '.fieldName'
- 查看数组长度: cat /workspace/data.json | jq 'length'
- 查看所有键: cat /workspace/data.json | jq 'keys'

【禁止操作】
- 不能使用任何写入命令（如 >, >>, mv, rm 等）
- 不能修改 /workspace/data.json 文件
- 如果用户要求修改数据，请告知没有修改权限

请用中文回复用户。`;
  }

  return `你是一个 JSON 数据编辑助手。

当前 JSON 数据文件位于: /workspace/data.json
${pathDesc}

你可以使用 bash 工具来查看和修改数据：

【查看数据】
- 查看原始内容: cat /workspace/data.json
- 格式化查看: cat /workspace/data.json | jq '.'
- 查看特定字段: cat /workspace/data.json | jq '.fieldName'

【修改数据】
- 修改字段值: jq '.fieldName = "newValue"' /workspace/data.json > /tmp/temp.json && mv /tmp/temp.json /workspace/data.json
- 添加新字段: jq '. + {"newField": "value"}' /workspace/data.json > /tmp/temp.json && mv /tmp/temp.json /workspace/data.json
- 删除字段: jq 'del(.fieldName)' /workspace/data.json > /tmp/temp.json && mv /tmp/temp.json /workspace/data.json

修改完成后，请用 cat /workspace/data.json | jq '.' 展示最终结果。
请用中文回复用户。`;
}

export async function POST(request: NextRequest) {
  const {
    prompt,
    chatHistory,
    tableData,
    workingDirectory,
    bashAccessPoints,
  } = await request.json();

  if (!prompt) {
    return Response.json({ error: 'Missing prompt' }, { status: 400 });
  }

  const cwd = workingDirectory || process.cwd();
  const encoder = new TextEncoder();

  // 解析 bash 权限配置
  const accessPoints: BashAccessPoint[] = bashAccessPoints || [];

  // 确定是否有 bash 权限，以及权限模式
  // 如果有多个节点配置了 bash，取第一个（后续可以支持多节点）
  const bashAccess = accessPoints.length > 0 ? accessPoints[0] : null;
  const hasBashAccess = !!bashAccess;
  const isReadonly = bashAccess?.mode === 'readonly';
  const nodePath = bashAccess?.path || '';

  // 提取对应节点的数据
  let nodeData: unknown = null;
  if (hasBashAccess && tableData) {
    nodeData = extractDataByPath(tableData, nodePath);
    if (nodeData === undefined) {
      return Response.json(
        { error: `Invalid path: ${nodePath}` },
        { status: 400 }
      );
    }
  }

  // 决定是否使用沙盒
  const useSandbox = hasBashAccess && nodeData !== null;
  const sandboxSessionId = useSandbox ? `agent-${Date.now()}` : null;
  const sandbox = sandboxSessionId ? new SandboxClient(sandboxSessionId) : null;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`)
        );
      };

      try {
        // 启动沙盒（如果需要）
        if (sandbox && nodeData !== null) {
          sendEvent('status', {
            message: `Starting sandbox (${isReadonly ? 'read-only' : 'full access'})...`,
          });
          // 传递只读模式给 sandbox
          const startResult = await sandbox.start(nodeData, isReadonly);
          if (!startResult.success) {
            sendEvent('error', {
              message: `Failed to start sandbox: ${startResult.error}`,
            });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
          sendEvent('status', { message: 'Sandbox ready' });
        }

        // 系统提示 - 根据权限模式生成
        const systemPrompt = useSandbox
          ? generateSystemPrompt(isReadonly, nodePath)
          : `You are Puppy 🐶, a helpful AI assistant.
You can read files, search for files, and search content in files.
Always respond in the same language the user uses.
Be concise and helpful.`;

        // 选择工具
        const tools = useSandbox ? [BASH_TOOL] : FILE_TOOLS;

        // 消息历史
        type MessageContent =
          | { type: 'text'; text: string }
          | {
              type: 'tool_use';
              id: string;
              name: string;
              input: Record<string, unknown>;
            }
          | {
              type: 'tool_result';
              tool_use_id: string;
              content: string;
              is_error?: boolean;
            };

        type Message = {
          role: 'user' | 'assistant';
          content: string | MessageContent[];
        };

        // 构建消息列表：历史消息 + 当前消息
        const messages: Message[] = [];

        // 添加历史消息（多轮对话支持）
        if (chatHistory && Array.isArray(chatHistory)) {
          for (const msg of chatHistory) {
            if (
              (msg.role === 'user' || msg.role === 'assistant') &&
              msg.content
            ) {
              messages.push({ role: msg.role, content: msg.content });
            }
          }
        }

        // 添加当前用户消息
        messages.push({ role: 'user', content: prompt });
        let iterations = 0;
        const maxIterations = 15;
        let toolIndex = 0;

        // 对话循环
        while (iterations < maxIterations) {
          iterations++;

          const response = await anthropic.messages.create({
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            system: systemPrompt,
            tools: tools as Anthropic.Tool[],
            messages: messages as Anthropic.MessageParam[],
          });

          // 处理响应
          const toolUses: Array<{
            id: string;
            name: string;
            input: Record<string, unknown>;
          }> = [];

          for (const block of response.content) {
            if (block.type === 'text') {
              sendEvent('text', { content: block.text });
            } else if (block.type === 'tool_use') {
              toolUses.push({
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
          }

          // 没有工具调用，结束
          if (toolUses.length === 0) break;

          // 执行工具
          const toolResults: MessageContent[] = [];

          for (const toolUse of toolUses) {
            const currentToolIndex = toolIndex++;
            const toolInput = useSandbox
              ? (toolUse.input as { command?: string }).command || ''
              : JSON.stringify(toolUse.input);

            sendEvent('tool_start', {
              toolId: currentToolIndex,
              toolName: toolUse.name,
              toolInput,
            });

            let output: string;
            let success = true;

            try {
              if (toolUse.name === 'bash' && sandbox) {
                // Bash 工具 - 调用沙盒 API
                const execResult = await sandbox.exec(
                  (toolUse.input as { command: string }).command
                );
                if (execResult.success) {
                  output = execResult.output || '(no output)';
                } else {
                  output = `Error: ${execResult.error}`;
                  success = false;
                }
              } else {
                // 文件工具 - 本地执行
                output = executeFileTool(
                  toolUse.name,
                  toolUse.input as Record<string, string>,
                  cwd
                );
              }
            } catch (err: unknown) {
              const error = err as { message?: string };
              output = `Error: ${error.message}`;
              success = false;
            }

            sendEvent('tool_end', {
              toolId: currentToolIndex,
              toolName: toolUse.name,
              output:
                output.substring(0, 500) + (output.length > 500 ? '...' : ''),
              success,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: output,
              is_error: !success,
            });
          }

          // 添加到消息历史
          messages.push({
            role: 'assistant',
            content: response.content as MessageContent[],
          });
          messages.push({ role: 'user', content: toolResults });

          if (response.stop_reason === 'end_turn') break;
        }

        // 读取最终数据并返回
        if (sandbox) {
          try {
            const readResult = await sandbox.read();
            if (readResult.success && readResult.data !== undefined) {
              // 如果是只读模式，返回原始数据（不应该有修改）
              // 如果是完整模式，将修改后的节点数据合并回原始数据
              let updatedData: unknown;
              if (isReadonly) {
                // 只读模式：返回原始 tableData，不做任何修改
                updatedData = tableData;
              } else {
                // 完整模式：将修改后的节点数据合并回原始数据
                updatedData = mergeDataByPath(
                  tableData,
                  nodePath,
                  readResult.data
                );
              }

              sendEvent('result', {
                success: true,
                updatedData,
                // 额外信息：告知是哪个节点被修改了
                modifiedPath: isReadonly ? null : nodePath,
              });
            } else {
              sendEvent('result', { success: false, error: readResult.error });
            }
          } catch {
            sendEvent('result', { success: false });
          }
        } else {
          sendEvent('result', { success: true });
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error: unknown) {
        const err = error as { message?: string };
        sendEvent('error', { message: err.message });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } finally {
        // 停止沙盒
        if (sandbox) {
          try {
            await sandbox.stop();
          } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
