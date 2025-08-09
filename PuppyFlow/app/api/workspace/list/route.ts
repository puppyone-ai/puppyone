import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';

export async function GET() {
  try {
    const saveDir = path.join(process.cwd(), 'workspace_data');

    // 如果目录不存在，创建目录并返回空列表
    if (!fs.existsSync(saveDir)) {
      await fsPromises.mkdir(saveDir, { recursive: true });
      return NextResponse.json({ workspaces: [] });
    }

    // 读取目录内容
    const directories = await fsPromises.readdir(saveDir, {
      withFileTypes: true,
    });
    const workspaces = [];

    for (const dir of directories) {
      if (dir.isDirectory()) {
        // 尝试读取工作区的最新状态来获取名称
        const latestFile = path.join(saveDir, dir.name, 'latest.json');
        let workspaceName = 'Untitled Workspace';

        if (fs.existsSync(latestFile)) {
          try {
            const data = await fsPromises.readFile(latestFile, 'utf-8');
            const json = JSON.parse(data);
            // 如果有自定义的工作区名称字段，可以从这里读取
            workspaceName = json.workspaceName || workspaceName;
          } catch (error) {
            console.error(`Error reading workspace ${dir.name}:`, error);
          }
        }

        workspaces.push({
          workspace_id: dir.name,
          workspace_name: workspaceName,
        });
      }
    }

    return NextResponse.json({ workspaces });
  } catch (error) {
    console.error('Error listing workspaces:', error);
    return NextResponse.json(
      { error: 'Failed to list workspaces' },
      { status: 500 }
    );
  }
}
