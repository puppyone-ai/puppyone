import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';

interface FileSystemError extends Error {
  code?: string;
  path?: string;
}

// 删除工作区
export async function DELETE(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  console.log('=== DELETE /api/workspace/[workspaceId] 开始处理请求 ===');
  try {
    const { workspaceId } = params;
    console.log('要删除的工作区ID:', workspaceId);

    if (!workspaceId) {
      console.error('缺少工作区ID');
      return NextResponse.json(
        {
          success: false,
          error: 'Workspace ID is required',
        },
        { status: 400 }
      );
    }

    // 构建工作区目录路径
    const workspaceDir = path.join(
      process.cwd(),
      'workspace_data',
      workspaceId
    );
    console.log('工作区目录路径:', workspaceDir);

    // 检查工作区目录是否存在
    if (!fs.existsSync(workspaceDir)) {
      console.log('工作区目录不存在，可能是未保存的workspace');
      return NextResponse.json(
        {
          success: true,
          message: 'Workspace not found in file system (may be unsaved)',
        },
        { status: 200 }
      );
    }

    // 递归删除整个工作区目录
    await fsPromises.rm(workspaceDir, { recursive: true, force: true });
    console.log('工作区目录删除成功');

    console.log('=== DELETE /api/workspace/[workspaceId] 请求处理成功 ===');
    return NextResponse.json({
      success: true,
      message: 'Workspace deleted successfully',
    });
  } catch (error) {
    const fsError = error as FileSystemError;
    console.error('=== DELETE /api/workspace/[workspaceId] 发生错误 ===');
    console.error('错误类型:', fsError.constructor.name);
    console.error('错误信息:', fsError.message);
    console.error('错误堆栈:', fsError.stack);
    if (fsError.code) {
      console.error('错误代码:', fsError.code);
    }
    if (fsError.path) {
      console.error('错误路径:', fsError.path);
    }
    return NextResponse.json(
      {
        success: false,
        error: `Failed to delete workspace: ${fsError.message}`,
      },
      { status: 500 }
    );
  }
}
