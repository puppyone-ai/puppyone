import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import os from 'os';

interface FileSystemError extends Error {
    code?: string;
    path?: string;
}

// 格式化时间戳为文件名
function formatTimestampForFilename(timestamp: string): string {
    const isWindows = os.platform() === 'win32';
    
    if (isWindows) {
        // Windows系统：将ISO时间戳转换为YYYY-MM-DD_HH-mm-ss格式
        const date = new Date(timestamp);
        return date.toISOString()
            .replace(/[:.]/g, '-')  // 替换冒号和点
            .replace('T', '_')      // 替换T为下划线
            .replace(/\+.*$/, '');  // 移除时区信息
    }
    
    // Mac/Linux系统：保持原始ISO格式
    return timestamp;
}

// 保存工作区数据
export async function POST(request: Request) {
    console.log('=== POST /api/workspace 开始处理请求 ===');
    try {
        const requestBody = await request.json();
        console.log('请求体数据:', {
            flowId: requestBody.flowId,
            timestamp: requestBody.timestamp,
            jsonLength: requestBody.json ? JSON.stringify(requestBody.json).length : 0
        });
        
        const { flowId, json, timestamp } = requestBody;
        
        // 验证必要字段
        if (!flowId || !json || !timestamp) {
            console.error('缺少必要字段:', { flowId, hasJson: !!json, timestamp });
            return NextResponse.json({ 
                success: false, 
                error: 'Missing required fields' 
            }, { status: 400 });
        }
        
        // 确保保存目录存在
        const saveDir = path.join(process.cwd(), 'workspace_data');
        console.log('保存目录路径:', saveDir);
        await fsPromises.mkdir(saveDir, { recursive: true });
        console.log('保存目录创建成功');
        
        // 为每个工作区创建一个子目录
        const workspaceDir = path.join(saveDir, flowId);
        console.log('工作区目录路径:', workspaceDir);
        await fsPromises.mkdir(workspaceDir, { recursive: true });
        console.log('工作区目录创建成功');
        
        // 格式化时间戳为文件名
        const formattedTimestamp = formatTimestampForFilename(timestamp);
        console.log('格式化后的时间戳:', formattedTimestamp);
        
        // 创建历史记录文件
        const historyFile = path.join(workspaceDir, `${formattedTimestamp}.json`);
        console.log('历史记录文件路径:', historyFile);
        await fsPromises.writeFile(historyFile, JSON.stringify(json, null, 2));
        console.log('历史记录文件写入成功');
        
        // 更新最新状态文件
        const latestFile = path.join(workspaceDir, 'latest.json');
        console.log('最新状态文件路径:', latestFile);
        await fsPromises.writeFile(latestFile, JSON.stringify(json, null, 2));
        console.log('最新状态文件写入成功');
        
        console.log('=== POST /api/workspace 请求处理成功 ===');
        return NextResponse.json({ success: true });
    } catch (error) {
        const fsError = error as FileSystemError;
        console.error("=== POST /api/workspace 发生错误 ===");
        console.error("错误类型:", fsError.constructor.name);
        console.error("错误信息:", fsError.message);
        console.error("错误堆栈:", fsError.stack);
        if (fsError.code) {
            console.error("错误代码:", fsError.code);
        }
        if (fsError.path) {
            console.error("错误路径:", fsError.path);
        }
        return NextResponse.json({ 
            success: false, 
            error: `Failed to save workspace: ${fsError.message}` 
        }, { status: 500 });
    }
}

// 获取工作区最新数据
export async function GET(request: Request) {
    console.log('=== GET /api/workspace 开始处理请求 ===');
    try {
        const { searchParams } = new URL(request.url);
        const flowId = searchParams.get('flowId');
        const timestamp = searchParams.get('timestamp'); // 新增：支持获取特定时间戳的文件
        
        console.log('请求参数:', { flowId, timestamp });
        
        if (!flowId) {
            console.error('缺少必要参数: flowId');
            return NextResponse.json({ error: 'Flow ID is required' }, { status: 400 });
        }

        const workspaceDir = path.join(process.cwd(), 'workspace_data', flowId);
        
        // 如果提供了时间戳，则获取特定时间戳的文件
        if (timestamp) {
            const formattedTimestamp = formatTimestampForFilename(timestamp);
            const historyFile = path.join(workspaceDir, `${formattedTimestamp}.json`);
            console.log('历史文件路径:', historyFile);
            
            if (!fs.existsSync(historyFile)) {
                console.log('历史文件不存在');
                return NextResponse.json({ data: null });
            }

            const data = await fsPromises.readFile(historyFile, 'utf-8');
            console.log('历史文件读取成功，数据长度:', data.length);
            return NextResponse.json({ data: JSON.parse(data) });
        }

        // 否则获取最新状态文件
        const latestFile = path.join(workspaceDir, 'latest.json');
        console.log('最新文件路径:', latestFile);
        
        if (!fs.existsSync(latestFile)) {
            console.log('最新文件不存在，返回空数据');
            return NextResponse.json({ data: null });
        }

        const data = await fsPromises.readFile(latestFile, 'utf-8');
        console.log('最新文件读取成功，数据长度:', data.length);
        return NextResponse.json({ data: JSON.parse(data) });
    } catch (error) {
        const fsError = error as FileSystemError;
        console.error("=== GET /api/workspace 发生错误 ===");
        console.error("错误类型:", fsError.constructor.name);
        console.error("错误信息:", fsError.message);
        console.error("错误堆栈:", fsError.stack);
        if (fsError.code) {
            console.error("错误代码:", fsError.code);
        }
        if (fsError.path) {
            console.error("错误路径:", fsError.path);
        }
        return NextResponse.json({ 
            error: `Failed to read workspace: ${fsError.message}` 
        }, { status: 500 });
    }
}