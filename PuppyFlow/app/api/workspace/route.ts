import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';

// 保存工作区数据
export async function POST(request: Request) {
    try {
        const { flowId, json, timestamp } = await request.json();
        
        // 确保保存目录存在
        const saveDir = path.join(process.cwd(), 'workspace_data');
        await fsPromises.mkdir(saveDir, { recursive: true });
        
        // 为每个工作区创建一个子目录
        const workspaceDir = path.join(saveDir, flowId);
        await fsPromises.mkdir(workspaceDir, { recursive: true });
        
        // 创建历史记录文件
        const historyFile = path.join(workspaceDir, `${timestamp}.json`);
        await fsPromises.writeFile(historyFile, JSON.stringify(json, null, 2));
        
        // 更新最新状态文件
        const latestFile = path.join(workspaceDir, 'latest.json');
        await fsPromises.writeFile(latestFile, JSON.stringify(json, null, 2));
        
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error saving workspace:", error);
        return NextResponse.json({ success: false, error: 'Failed to save workspace' }, { status: 500 });
    }
}

// 获取工作区最新数据
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const flowId = searchParams.get('flowId');
        
        if (!flowId) {
            return NextResponse.json({ error: 'Flow ID is required' }, { status: 400 });
        }

        const latestFile = path.join(process.cwd(), 'workspace_data', flowId, 'latest.json');
        
        if (!fs.existsSync(latestFile)) {
            return NextResponse.json({ data: null });
        }

        const data = await fsPromises.readFile(latestFile, 'utf-8');
        return NextResponse.json({ data: JSON.parse(data) });
    } catch (error) {
        console.error("Error reading workspace:", error);
        return NextResponse.json({ error: 'Failed to read workspace' }, { status: 500 });
    }
}