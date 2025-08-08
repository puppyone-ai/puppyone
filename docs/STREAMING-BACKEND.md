# PuppyEngine v2 API 前端对接文档

## 目录

- [1. 概述](#1-概述)
- [2. 核心流程：异步任务与事件流](#2-核心流程异步任务与事件流)
- [3. API 端点详解](#3-api-端点详解)
- [4. SSE 事件 Schema 详解](#4-sse-事件-schema-详解)
- [5. PuppyStorage 生产者-消费者流程](#5-puppystorage-生产者-消费者流程)
- [6. 前端是否需要完整的Storage Server I/O逻辑？](#6-前端是否需要完整的storage-server-io逻辑)
- [7. PuppyStorage 文件上传/下载 API 业务逻辑](#7-puppystorage-文件上传下载-api-业务逻辑)
- [8. 实现指南](#8-实现指南)
- [9. 错误处理](#9-错误处理)
- [10. UI/UX 建议](#10-uiux-建议)

## 1. 概述

本文档旨在帮助前端工程师理解并对接 PuppyEngine 最新的 v2 事件驱动 API。新的 API 提供了更丰富的实时事件流，能够极大地提升用户体验，特别是对于处理大型数据和长耗时任务的场景。

**重要说明**：

- v1 版本的 API (`/send_data`, `/get_data/{task_id}`) 仍然可用并保持向后兼容
- **所有新功能都应基于 v2 API 进行开发**
- v2 API 采用 Server-Sent Events (SSE) 技术，提供实时、低延迟的事件推送

## 2. 核心流程：异步任务与事件流

v2 API 的核心模型是"**提交并忘记，然后订阅事件**" (Fire and Forget, then Subscribe to Events)。

### 2.1 基本流程

1. **提交任务**: 客户端通过 `POST /task` 提交一个工作流。服务器会立即验证请求，然后快速返回一个 `task_id`，HTTP 状态码为 `202 Accepted`。**此过程不等待工作流执行完成**。

2. **订阅事件**: 客户端使用上一步获取的 `task_id`，通过 `GET /task/{task_id}/stream` 建立一个 Server-Sent Events (SSE) 长连接，来实时接收工作流的执行事件。

### 2.2 架构优势

- **非阻塞**: 提交任务后立即返回，不会阻塞用户界面
- **实时性**: 通过 SSE 实时推送执行状态和结果
- **可扩展**: 支持大型数据和长耗时任务
- **用户体验**: 用户可以立即看到任务开始，并实时观察进度

## 3. API 端点详解

### 3.1 启动工作流

**Endpoint**: `POST /task`  
**Method**: `POST`  
**Content-Type**: `application/json`  
**Body**: 包含 `blocks` 和 `edges` 的完整 `workflow.json` 定义

**请求示例**:

````json
{
  "blocks": {
    "input": {
      "label": "Input Text",
      "type": "text",
      "data": {
        "content": "Tell me a story about a robot"
      }
    },
    "output": {
      "label": "Generated Story",
      "type": "text",
      "data": {}
    }
  },
  "edges": {
    "generate": {
      "type": "llm",
      "inputs": {
        "input1": "input"
      },
      "outputs": {
        "output1": "output"
      },
      "config": {
        "model": {
          "gpt-3.5-turbo": {
            "inference_method": "openai"
          }
        },
        "content": "{{input}}"
      }
    }
  }
}
````

**成功响应 (202 Accepted)**:

````json
{
  "task_id": "unique-task-identifier-uuid",
  "created_at": "2023-10-27T10:00:00Z",
  "blocks_count": 5,
  "edges_count": 4,
  "estimated_usage": 5
}
````

### 3.2 订阅任务事件流

**Endpoint**: `GET /task/{task_id}/stream`  
**Method**: `GET`  
**响应类型**: `text/event-stream` (Server-Sent Events)

**连接示例**:

````javascript
const eventSource = new EventSource(`/task/${taskId}/stream`);

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received event:', data);
  
  // 处理不同类型的事件
  switch(data.event_type) {
    case 'TASK_STARTED':
      handleTaskStarted(data);
      break;
    case 'BLOCK_UPDATED':
      handleBlockUpdated(data);
      break;
    case 'STREAM_STARTED':
      handleStreamStarted(data);
      break;
    // ... 其他事件处理
  }
};
````

### 3.3 获取任务状态

**Endpoint**: `GET /task/{task_id}/status`  
**Method**: `GET`

**响应示例**:

````json
{
  "task_id": "unique-task-identifier-uuid",
  "status": "RUNNING",
  "created_at": "2023-10-27T10:00:00Z",
  "started_at": "2023-10-27T10:00:01Z",
  "total_blocks": 5,
  "processed_blocks": 2,
  "progress": {
    "blocks": {
      "total": 5,
      "processed": 2,
      "pending": 3
    },
    "edges": {
      "total": 4,
      "completed": 1,
      "pending": 3
    }
  }
}
````

## 4. SSE 事件 Schema 详解

所有事件都遵循统一的结构：

````json
{
  "event_type": "EVENT_NAME",    // 事件类型 (string)
  "task_id": "the-task-id",      // 关联的任务ID (string)
  "timestamp": "iso-8601-timestamp", // 事件发生时间 (string)
  "data": { ... }                // 与事件相关的具体数据 (object)
}
````

### 4.1 关键事件类型

| 事件类型 | `data` 内容 | 前端处理建议 |
|---------|------------|-------------|
| `TASK_STARTED` | `{ "total_blocks": 5, "total_edges": 4 }` | 初始化UI，显示"任务已开始" |
| `EDGE_STARTED` | `{ "edge_id": "generate_story", "edge_type": "llm" }` | （可选）在UI上高亮显示正在执行的节点 |
| `BLOCK_UPDATED` | `{ "block_id": "story", "content": "A robot..." }` | **（核心）** 用 `content` 的内容更新UI中对应 `block_id` 的组件 |
| `STREAM_STARTED` | `{ "block_id": "large_data", "resource_key": "user/block/version" }` | **（关键）** 收到此事件，说明一个大文件**开始**被写入外部存储。前端应使用 `resource_key` **开始轮询** PuppyStorage 的 manifest 文件 |
| `STREAM_ENDED` | `{ "block_id": "large_data", "resource_key": "user/block/version" }` | **（关键）** 收到此事件，说明大文件**已全部写入**。前端可以进行最后一次 manifest 拉取，并**停止轮询** |
| `EDGE_COMPLETED` | `{ "edge_id": "generate_story", "output_blocks": ["story"] }` | （可选）标记UI节点为"完成"状态 |
| `PROGRESS_UPDATE` | `{ "progress": { "blocks": {...}, "edges": {...} } }` | 更新进度条或状态指示器 |
| `TASK_COMPLETED` | `{ "duration": 15.7, "total_blocks_processed": 4 }` | 任务成功结束。关闭SSE连接，显示最终结果 |
| `TASK_FAILED` | `{ "error_message": "...", "error_type": "..." }` | 任务失败。向用户显示错误信息，关闭SSE连接 |

## 5. PuppyStorage 生产者-消费者流程

这是前端处理大型外部存储资源（如长文档、大JSON、图片等）的核心交互模式。

### 5.1 目标

在后端仍在生成和上传大文件的同时，前端能够**并行地、流式地**获取并展示已上传的部分。

### 5.2 流程图

````mermaid
sequenceDiagram
    participant FE as 前端
    participant PuppyEngine as 引擎
    participant PuppyStorage as 存储

    FE->>PuppyEngine: GET /task/{id}/stream
    PuppyEngine-->>FE: SSE Connection Established

    Note over PuppyEngine: 开始处理一个大文件...
    PuppyEngine-->>FE: event: STREAM_STARTED (data: {resource_key})

    FE->>PuppyStorage: (轮询开始) GET /download/url (key: {resource_key}/manifest.json)
    PuppyStorage-->>FE: download_url
    FE->>PuppyStorage: GET download_url
    PuppyStorage-->>FE: manifest.json (包含 chunk_1)
    FE->>PuppyStorage: (下载数据) GET /download/url (key: {resource_key}/chunk_1)
    Note over FE: 下载并处理 chunk_1

    Note over PuppyEngine: 后端上传了新的数据块...

    FE->>PuppyStorage: (再次轮询) GET .../manifest.json
    PuppyStorage-->>FE: manifest.json (包含 chunk_1, chunk_2)
    FE->>PuppyStorage: (下载数据) GET /download/url (key: {resource_key}/chunk_2)
    Note over FE: 下载并处理 chunk_2

    Note over PuppyEngine: 所有数据块上传完毕
    PuppyEngine-->>FE: event: STREAM_ENDED

    FE->>PuppyStorage: (最后一次轮询) GET .../manifest.json
    PuppyStorage-->>FE: manifest.json (状态: "completed")
    Note over FE: 停止轮询
````

### 5.3 前端实现关键点

#### 5.3.1 监听 STREAM_STARTED

这是开始轮询的信号。`resource_key` 是轮询和下载所有相关资源的根路径。

````javascript
function handleStreamStarted(data) {
  const { resource_key, block_id } = data;
  
  // 开始轮询 manifest
  startManifestPolling(resource_key, block_id);
  
  // 显示加载状态
  showBlockLoadingState(block_id, 'Streaming data...');
}
````

#### 5.3.2 轮询 manifest.json

- **轮询目标**: `{resource_key}/manifest.json`
- **manifest.json 作用**: 实时更新的"文件目录"，包含所有已上传数据块（chunks）的列表
- **轮询策略**:
  - 初始轮询间隔：1秒
  - 如果连续多次未获取到新数据块，采用指数退避策略（1s, 2s, 4s...）
  - 避免不必要的请求

#### 5.3.3 监听 STREAM_ENDED

这是停止轮询的信号。

````javascript
function handleStreamEnded(data) {
  const { resource_key, block_id } = data;
  
  // 停止轮询
  stopManifestPolling(resource_key);
  
  // 最后一次拉取 manifest 确保获取所有数据
  fetchFinalManifest(resource_key, block_id);
  
  // 更新 UI 状态
  showBlockCompletedState(block_id);
}
````

## 6. 前端是否需要完整的Storage Server I/O逻辑？

**回答：不需要，也不建议。**

### 6.1 需要的操作

- **下载 (Download)**: 前端**需要**完整的下载逻辑，包括获取 `manifest` 和各个 `chunks`

### 6.2 不需要的操作

- **上传 (Upload)**: 前端**不应该**直接处理上传。所有的数据生成和上传都应该由 PuppyEngine 的工作流（即 `Edge`）来完成

### 6.3 理由

- **安全**: 直接上传到存储需要更复杂的认证和授权逻辑，容易产生安全漏洞
- **一致性**: 保持所有数据都通过工作流引擎处理，可以确保数据的一致性和可追溯性
- **解耦**: 让前端专注于展示和用户交互，后端专注于数据处理和持久化

## 7. PuppyStorage 文件上传/下载 API 业务逻辑

### 7.1 核心理念

前端将文件上传与一个业务数据块 (block_id) 关联，而不是一个具体的文件路径。服务器会自动处理文件的版本管理和安全存储。

### 7.2 上传流程 (Upload)

**目标**: 将一个文件（例如 report.pdf）关联到 block_id: "analytics_run_123"。

#### 7.2.1 对于小文件 (< 5MB)，使用直接上传:

**前端操作**: 发起一个 POST 请求到 `/upload/chunk/direct`。

**参数**:
- `block_id`: "analytics_run_123"
- `file_name`: "report.pdf"
- `Authorization Header`: Bearer <token>
- `Request Body`: 文件的二进制内容。

**服务器行为**: 自动生成唯一的 version_id 和安全的存储 key，保存文件，并返回这些信息。

#### 7.2.2 对于大文件 (> 5MB)，使用分块上传:

**Step 1: 初始化 (/upload/init)**

**前端操作**: POST 请求，提供 block_id 和 file_name。

**服务器响应**: 返回一个 upload_id 和一个完整的 key。前端需要保存这两个值。

**Step 2: 上传分块 (循环)**

前端将大文件切分成多个小块（例如每块5MB）。

对每一块，调用 `/upload/get_upload_url` (传入key, upload_id, part_number) 获取一个有时效性的上传URL。

前端使用 PUT 方法将文件块的二进制数据上传到获取到的URL。

**Step 3: 完成 (/upload/complete)**

所有分块上传完毕后，调用 `/upload/complete` (传入key, upload_id, 和所有分块的 ETag 列表)，通知服务器合并文件。

### 7.3 下载流程 (Download)

**目标**: 下载之前上传的、与某个 block 关联的文件。

#### 7.3.1 获取下载链接 (/download/url):

**前端操作**: 发起一个 GET 请求到 `/download/url`。

**参数**:
- `key`: 文件在上传成功后返回的完整 key。
- `Authorization Header`: Bearer <token>。

**服务器响应**: 返回一个有时效性的 download_url。

#### 7.3.2 执行下载:

前端直接让用户浏览器访问这个 download_url 即可触发下载。这个URL是预先授权过的，无需再次提供Token。

### 7.4 前端集成关键变化

- **不再拼接 key**: 前端不再需要知道 user_id 或 version_id 来构建存储路径。
- **关心 block_id**: 所有上传都围绕业务 block_id 进行。
- **保存返回的 key**: 上传成功后，务必保存服务器返回的完整 key，因为这是未来下载该文件的唯一凭证。

## 8. 实现指南

### 8.1 基本集成步骤

1. **设置认证**

````javascript
const headers = {
  'Authorization': `Bearer ${userToken}`,
  'Content-Type': 'application/json'
};
````

2. **提交工作流**

````javascript
async function submitWorkflow(workflowData) {
  const response = await fetch('/task', {
    method: 'POST',
    headers,
    body: JSON.stringify(workflowData)
  });
  
  if (response.status === 202) {
    const result = await response.json();
    return result.task_id;
  } else {
    throw new Error('Failed to submit workflow');
  }
}
````

3. **建立 SSE 连接**

````javascript
function connectToTaskStream(taskId) {
  const eventSource = new EventSource(`/task/${taskId}/stream`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });
  
  eventSource.onmessage = handleSSEMessage;
  eventSource.onerror = handleSSEError;
  
  return eventSource;
}
````

### 8.2 完整示例

````javascript
class PuppyEngineClient {
  constructor(baseUrl, userToken) {
    this.baseUrl = baseUrl;
    this.userToken = userToken;
    this.headers = {
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': 'application/json'
    };
    this.manifestPollers = new Map();
  }

  async submitWorkflow(workflowData) {
    const response = await fetch(`${this.baseUrl}/task`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(workflowData)
    });

    if (response.status === 202) {
      const result = await response.json();
      return result.task_id;
    } else {
      const error = await response.text();
      throw new Error(`Failed to submit workflow: ${error}`);
    }
  }

  connectToTaskStream(taskId, eventHandlers) {
    const eventSource = new EventSource(`${this.baseUrl}/task/${taskId}/stream`, {
      headers: { 'Authorization': `Bearer ${this.userToken}` }
    });

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleEvent(data, eventHandlers);
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      if (eventHandlers.onError) {
        eventHandlers.onError(error);
      }
    };

    return eventSource;
  }

  handleEvent(data, handlers) {
    switch(data.event_type) {
      case 'TASK_STARTED':
        if (handlers.onTaskStarted) handlers.onTaskStarted(data);
        break;
      case 'BLOCK_UPDATED':
        if (handlers.onBlockUpdated) handlers.onBlockUpdated(data);
        break;
      case 'STREAM_STARTED':
        if (handlers.onStreamStarted) {
          handlers.onStreamStarted(data);
          this.startManifestPolling(data.resource_key, data.block_id, handlers);
        }
        break;
      case 'STREAM_ENDED':
        if (handlers.onStreamEnded) {
          handlers.onStreamEnded(data);
          this.stopManifestPolling(data.resource_key);
        }
        break;
      case 'TASK_COMPLETED':
        if (handlers.onTaskCompleted) handlers.onTaskCompleted(data);
        break;
      case 'TASK_FAILED':
        if (handlers.onTaskFailed) handlers.onTaskFailed(data);
        break;
    }
  }
}
````

## 9. 错误处理

### 9.1 SSE 连接错误处理

SSE 连接可能会因网络问题中断。前端应实现自动重连机制：

````javascript
class SSEManager {
  constructor(taskId, baseUrl, userToken) {
    this.taskId = taskId;
    this.baseUrl = baseUrl;
    this.userToken = userToken;
    this.maxRetries = 5;
    this.retryCount = 0;
    this.retryDelay = 1000;
    this.eventSource = null;
    this.isConnected = false;
  }

  connect(eventHandlers) {
    this.eventSource = new EventSource(`${this.baseUrl}/task/${this.taskId}/stream`, {
      headers: { 'Authorization': `Bearer ${this.userToken}` }
    });

    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.retryCount = 0;
      console.log('SSE connection established');
    };

    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleEvent(data, eventHandlers);
    };

    this.eventSource.onerror = async (error) => {
      console.error('SSE connection error:', error);
      this.isConnected = false;
      
      if (this.retryCount < this.maxRetries) {
        await this.retryConnection(eventHandlers);
      } else {
        console.error('Max retries reached, giving up');
        if (eventHandlers.onMaxRetriesReached) {
          eventHandlers.onMaxRetriesReached();
        }
      }
    };
  }

  async retryConnection(eventHandlers) {
    this.retryCount++;
    const delay = this.retryDelay * Math.pow(2, this.retryCount - 1);
    
    console.log(`Retrying connection in ${delay}ms (attempt ${this.retryCount})`);
    
    setTimeout(async () => {
      // 检查任务状态
      const status = await this.checkTaskStatus();
      
      if (status.status === 'COMPLETED' || status.status === 'FAILED') {
        console.log('Task already completed, no need to reconnect');
        return;
      }
      
      // 重新连接
      this.connect(eventHandlers);
    }, delay);
  }

  async checkTaskStatus() {
    const response = await fetch(`${this.baseUrl}/task/${this.taskId}/status`, {
      headers: { 'Authorization': `Bearer ${this.userToken}` }
    });
    
    if (response.ok) {
      return await response.json();
    } else {
      throw new Error('Failed to check task status');
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
    }
  }
}
````

### 9.2 常见错误及处理

| 错误类型 | 可能原因 | 处理建议 |
|---------|---------|---------|
| `401 Unauthorized` | 认证失败 | 检查 token 是否有效，重新登录 |
| `404 Not Found` | 任务不存在 | 检查 task_id 是否正确 |
| `429 Too Many Requests` | 超出使用限制 | 显示用户友好的错误信息，建议稍后重试 |
| 网络连接错误 | 网络问题 | 实现自动重连机制 |
| SSE 连接中断 | 服务器重启或网络问题 | 检查任务状态，如果仍在运行则重连 |

## 10. UI/UX 建议

### 10.1 进度指示

利用 `EDGE_STARTED` 和 `PROGRESS_UPDATE` 事件，可以给用户一个非常精细的进度条或状态指示器：

````javascript
function updateProgress(data) {
  const progress = data.progress;
  const blockProgress = (progress.blocks.processed / progress.blocks.total) * 100;
  const edgeProgress = (progress.edges.completed / progress.edges.total) * 100;
  
  // 更新进度条
  updateProgressBar(blockProgress);
  
  // 更新状态文本
  updateStatusText(`Processing ${progress.blocks.processed}/${progress.blocks.total} blocks`);
}
````

### 10.2 实时内容更新

对于 `STREAM_STARTED` 的内容，可以立即向用户展示一个"正在加载大型文档..."的提示，并开始流式地渲染已下载的数据：

````javascript
function handleStreamStarted(data) {
  const blockId = data.block_id;
  
  // 显示流式加载状态
  showStreamingIndicator(blockId);
  
  // 创建容器用于流式内容
  createStreamingContainer(blockId);
  
  // 开始轮询并实时更新内容
  startManifestPolling(data.resource_key, blockId, {
    onChunkReceived: (chunkData) => {
      appendToStreamingContainer(blockId, chunkData);
    }
  });
}
````

### 10.3 用户体验优化

1. **即时反馈**: 任务提交后立即显示"任务已提交，正在处理..."
2. **实时更新**: 使用 SSE 实时更新任务状态和结果
3. **流式渲染**: 对于大文件，边下载边渲染，提升用户体验
4. **错误恢复**: 网络错误时自动重连，任务失败时提供重试选项
5. **状态持久化**: 页面刷新后能够恢复任务状态

---

## 总结

PuppyEngine v2 API 通过 Server-Sent Events 提供了强大的实时事件流能力，结合 PuppyStorage 的流式下载机制，能够为前端提供极佳的用户体验。前端工程师只需要关注：

1. **任务提交**: 使用 `POST /task` 提交工作流
2. **事件监听**: 使用 SSE 监听实时事件
3. **流式下载**: 对于大文件，轮询 manifest 并下载 chunks
4. **文件上传**: 使用 PuppyStorage API 进行文件上传，支持小文件直接上传和大文件分块上传
5. **错误处理**: 实现健壮的错误处理和重连机制

这种架构将复杂的数据处理逻辑封装在后端，前端专注于用户交互和内容展示，实现了良好的关注点分离。