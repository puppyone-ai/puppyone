import { execSync } from 'child_process';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 活跃的沙盒会话
const activeSandboxes = new Map<
  string,
  {
    containerId: string;
    tempFilePath: string;
    createdAt: number;
    readonly: boolean; // 新增：记录是否为只读模式
  }
>();

// 清理过期的沙盒（超过 10 分钟）
function cleanupExpiredSandboxes() {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes

  for (const [sessionId, sandbox] of activeSandboxes) {
    if (now - sandbox.createdAt > maxAge) {
      try {
        execSync(`docker stop ${sandbox.containerId}`, { timeout: 5000 });
      } catch {}
      if (fs.existsSync(sandbox.tempFilePath)) {
        try {
          fs.unlinkSync(sandbox.tempFilePath);
        } catch {}
      }
      activeSandboxes.delete(sessionId);
      console.log(`[Sandbox] Cleaned up expired session: ${sessionId}`);
    }
  }
}

// 启动沙盒 - 支持只读模式
async function startSandbox(
  sessionId: string,
  data: unknown,
  readonly: boolean = false
): Promise<{ success: boolean; error?: string }> {
  cleanupExpiredSandboxes();

  // 如果已存在，先停止
  if (activeSandboxes.has(sessionId)) {
    await stopSandbox(sessionId);
  }

  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `sandbox-${sessionId}.json`);
  const jsonContent = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempFilePath, jsonContent, 'utf-8');

  // Docker 挂载选项：只读模式使用 :ro 标志
  const mountOption = readonly
    ? `"${tempFilePath}":/workspace/data.json:ro`
    : `"${tempFilePath}":/workspace/data.json`;

  let containerId: string;

  try {
    // 尝试使用自定义镜像
    containerId = execSync(
      `docker run -d --rm -v ${mountOption} json-sandbox`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
  } catch {
    // 降级到 alpine
    try {
      containerId = execSync(
        `docker run -d --rm -v ${mountOption} alpine:3.19 sh -c "apk add --no-cache jq bash >/dev/null 2>&1 && tail -f /dev/null"`,
        { encoding: 'utf-8', timeout: 60000 }
      ).trim();
      // 等待 apk 安装完成
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err: unknown) {
      const error = err as { message?: string };
      return {
        success: false,
        error: `Failed to start container: ${error.message}`,
      };
    }
  }

  activeSandboxes.set(sessionId, {
    containerId,
    tempFilePath,
    createdAt: Date.now(),
    readonly,
  });

  console.log(
    `[Sandbox] Started session ${sessionId}, container: ${containerId.substring(0, 12)}, readonly: ${readonly}`
  );
  return { success: true };
}

// 执行命令
function execCommand(
  sessionId: string,
  command: string
): { success: boolean; output?: string; error?: string } {
  const sandbox = activeSandboxes.get(sessionId);
  if (!sandbox) {
    return {
      success: false,
      error: 'Sandbox session not found. Call start first.',
    };
  }

  const escapedCommand = command.replace(/"/g, '\\"');

  try {
    const output = execSync(
      `docker exec ${sandbox.containerId} sh -c "${escapedCommand}"`,
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    return { success: true, output };
  } catch (e: unknown) {
    const error = e as { stdout?: string; stderr?: string; message?: string };
    // 命令执行失败但有输出
    if (error.stdout || error.stderr) {
      return {
        success: true,
        output: (error.stdout || '') + (error.stderr || ''),
      };
    }
    return { success: false, error: `Command failed: ${error.message}` };
  }
}

// 读取 JSON
function readJson(sessionId: string): {
  success: boolean;
  data?: unknown;
  error?: string;
} {
  const result = execCommand(sessionId, 'cat /workspace/data.json');
  if (!result.success) {
    return { success: false, error: result.error };
  }

  try {
    const data = JSON.parse(result.output || '');
    return { success: true, data };
  } catch {
    return { success: false, error: 'Failed to parse JSON' };
  }
}

// 停止沙盒
async function stopSandbox(sessionId: string): Promise<{ success: boolean }> {
  const sandbox = activeSandboxes.get(sessionId);
  if (!sandbox) {
    return { success: true }; // 已经不存在
  }

  try {
    execSync(`docker stop ${sandbox.containerId}`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch {}

  if (fs.existsSync(sandbox.tempFilePath)) {
    try {
      fs.unlinkSync(sandbox.tempFilePath);
    } catch {}
  }

  activeSandboxes.delete(sessionId);
  console.log(`[Sandbox] Stopped session ${sessionId}`);
  return { success: true };
}

// 获取沙盒状态
function getStatus(sessionId: string): {
  active: boolean;
  containerId?: string;
  readonly?: boolean;
} {
  const sandbox = activeSandboxes.get(sessionId);
  if (!sandbox) {
    return { active: false };
  }
  return {
    active: true,
    containerId: sandbox.containerId.substring(0, 12),
    readonly: sandbox.readonly,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, sessionId, command, data, readonly } = body;

    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    switch (action) {
      case 'start':
        if (data === undefined || data === null) {
          return Response.json(
            { error: 'data is required for start action' },
            { status: 400 }
          );
        }
        // 支持 readonly 参数
        const startResult = await startSandbox(
          sessionId,
          data,
          readonly === true
        );
        return Response.json(startResult);

      case 'exec':
        if (!command) {
          return Response.json(
            { error: 'command is required for exec action' },
            { status: 400 }
          );
        }
        const execResult = execCommand(sessionId, command);
        return Response.json(execResult);

      case 'read':
        const readResult = readJson(sessionId);
        return Response.json(readResult);

      case 'stop':
        const stopResult = await stopSandbox(sessionId);
        return Response.json(stopResult);

      case 'status':
        const status = getStatus(sessionId);
        return Response.json(status);

      default:
        return Response.json(
          { error: 'Invalid action. Use: start, exec, read, stop, status' },
          { status: 400 }
        );
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[Sandbox] Error:', err);
    return Response.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET 用于检查沙盒状态
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    // 返回所有活跃会话
    const sessions = Array.from(activeSandboxes.keys());
    return Response.json({ activeSessions: sessions, count: sessions.length });
  }

  const status = getStatus(sessionId);
  return Response.json(status);
}
