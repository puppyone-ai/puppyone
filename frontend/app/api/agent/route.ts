import { query } from '@anthropic-ai/claude-agent-sdk';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes timeout for agent tasks

export async function POST(request: NextRequest) {
  try {
    const { prompt, allowedTools, workingDirectory } = await request.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 创建 ReadableStream 用于流式响应
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 调用 Agent SDK
          for await (const message of query({
            prompt,
            options: {
              // 允许的工具，默认只允许只读操作
              allowedTools: allowedTools || ['Read', 'Glob', 'Grep'],
              // 工作目录
              cwd: workingDirectory || process.cwd(),
              // 系统提示
              systemPrompt: `You are Puppy 🐶, a helpful AI assistant integrated into a data management platform. 
You help users understand their codebase and data.
Always respond in the same language the user uses.
Be concise and helpful.`,
            },
          })) {
            // 🔍 调试：打印每一步的响应格式
            console.log('\n========== Agent SDK Message ==========');
            console.log('Type:', (message as Record<string, unknown>).type);
            console.log('Full message:', JSON.stringify(message, null, 2));
            console.log('========================================\n');

            // 根据消息类型处理
            const data = JSON.stringify(message);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('Agent SDK error:', error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: String(error) })}\n\n`
            )
          );
          controller.close();
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
  } catch (error) {
    console.error('Agent API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
