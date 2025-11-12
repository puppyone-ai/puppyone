# Optimistic Locking + State Channel 实例说明

## 目录
- [问题场景](#问题场景)
- [Optimistic Locking 解决方案](#optimistic-locking-解决方案)
- [State Channel 解决方案](#state-channel-解决方案)
- [组合方案](#组合方案)
- [完整代码实现](#完整代码实现)
- [工业级技术选型](#工业级技术选型)

---

## 问题场景

### Scenario: Template Instantiation 与 Workflow Execution 并发修改同一个 Vector Collection Block

```
Initial State:
Block WzK6iT (Vector Collection):
{
  "id": "WzK6iT",
  "type": "vector_collection",
  "data": {
    "label": "FAQ Knowledge Base",
    "indexingList": [
      {
        "index_name": "",
        "status": "notStarted",
        "collection_configs": {
          "set_name": "",
          "model": "",
          "user_id": ""
        }
      }
    ]
  }
}
```

### Timeline (无并发控制的情况)

```
T0: 用户点击 "Instantiate RAG Template"
    → Process A (Template Instantiation) 开始

T1: Process A 读取 Block WzK6iT
    → Read: { version: 1, indexingList: [{ status: "notStarted" }] }
    → 开始 auto-embedding...

T2: 用户手动点击 "Embed" 按钮
    → Process B (Manual Workflow) 开始

T3: Process B 读取 Block WzK6iT
    → Read: { version: 1, indexingList: [{ status: "notStarted" }] }
    → 开始 manual embedding...

T4: Process B 完成
    → Write: { version: 1, indexingList: [{ 
        status: "done",
        index_name: "manual_index_abc",
        collection_configs: { set_name: "manual_set", ... }
      }] }
    ✅ 写入成功

T5: Process A 完成
    → Write: { version: 1, indexingList: [{ 
        status: "done",
        index_name: "auto_index_xyz",
        collection_configs: { set_name: "auto_set", ... }
      }] }
    ✅ 写入成功 (覆盖了 Process B 的结果！)

T6: 结果
    ❌ manual_index_abc 丢失
    ❌ 用户困惑：我刚才手动创建的索引去哪了？
```

---

## Optimistic Locking 解决方案

### 核心思想

**Compare-and-Swap (CAS)**：只有当数据库中的版本号与预期一致时，才允许更新。

### 数据结构

```typescript
interface BlockWithVersion {
  id: string;
  version: number;  // 关键字段：每次更新递增
  type: string;
  data: any;
  updated_at: string;
  updated_by?: {
    source: 'instantiation' | 'workflow' | 'user';
    process_id: string;
  };
}
```

### API 设计

```typescript
// 更新 API 必须提供 expected_version
PUT /api/blocks/{block_id}
Headers:
  Content-Type: application/json
Body:
{
  "expected_version": 1,  // 客户端读取时的版本号
  "data": {
    "label": "FAQ Knowledge Base",
    "indexingList": [...]
  },
  "updated_by": {
    "source": "instantiation",
    "process_id": "inst_abc123"
  }
}

Response (Success):
200 OK
{
  "id": "WzK6iT",
  "version": 2,  // 新版本号
  "data": { ... },
  "updated_at": "2025-11-01T10:30:00Z"
}

Response (Conflict):
409 Conflict
{
  "error": "VERSION_MISMATCH",
  "message": "Block has been modified by another process",
  "current_version": 3,
  "expected_version": 1,
  "current_data": { ... },  // 当前最新数据
  "last_updated_by": {
    "source": "workflow",
    "process_id": "wf_xyz789"
  }
}
```

### Timeline (有 Optimistic Locking)

```
T0: 用户点击 "Instantiate RAG Template"
    → Process A 开始

T1: Process A 读取 Block WzK6iT
    → Read: { version: 1, indexingList: [{ status: "notStarted" }] }
    → 开始 auto-embedding...

T2: 用户手动点击 "Embed" 按钮
    → Process B 开始

T3: Process B 读取 Block WzK6iT
    → Read: { version: 1, indexingList: [{ status: "notStarted" }] }
    → 开始 manual embedding...

T4: Process B 完成
    → Write: PUT /api/blocks/WzK6iT { expected_version: 1, ... }
    ✅ 写入成功 (version 1 → 2)

T5: Process A 完成
    → Write: PUT /api/blocks/WzK6iT { expected_version: 1, ... }
    ❌ 409 Conflict! (current_version is 2, not 1)

T6: Process A 收到 409 错误
    → 重新读取最新状态
    → Read: { version: 2, indexingList: [{ 
        status: "done",
        index_name: "manual_index_abc",
        collection_configs: { set_name: "manual_set", ... }
      }] }

T7: Process A 决定如何处理冲突
    → 选项 1: 放弃（用户手动操作优先级更高）
    → 选项 2: 追加（创建第二个 indexed set）
    → 选项 3: 合并（智能合并两个结果）

T8: 选择选项 2 - 追加
    → Write: PUT /api/blocks/WzK6iT {
        expected_version: 2,  // 使用最新版本号
        data: {
          indexingList: [
            { index_name: "manual_index_abc", status: "done", ... },  // 保留
            { index_name: "auto_index_xyz", status: "done", ... }     // 追加
          ]
        }
      }
    ✅ 写入成功 (version 2 → 3)

T9: 结果
    ✅ 两个索引都保留
    ✅ 用户看到手动和自动的索引共存
```

### 后端实现 (Node.js + PostgreSQL)

```typescript
// /api/blocks/[blockId]/route.ts
import { prisma } from '@/lib/prisma';

export async function PUT(
  req: Request,
  { params }: { params: { blockId: string } }
) {
  const { expected_version, data, updated_by } = await req.json();

  try {
    // 使用数据库事务 + WHERE 条件实现 CAS
    const result = await prisma.$executeRaw`
      UPDATE blocks
      SET 
        version = version + 1,
        data = ${JSON.stringify(data)}::jsonb,
        updated_at = NOW(),
        updated_by = ${JSON.stringify(updated_by)}::jsonb
      WHERE 
        id = ${params.blockId}
        AND version = ${expected_version}  -- 关键：CAS 条件
      RETURNING *
    `;

    if (result.count === 0) {
      // 没有行被更新 → 版本冲突
      const current = await prisma.block.findUnique({
        where: { id: params.blockId }
      });

      return Response.json(
        {
          error: 'VERSION_MISMATCH',
          message: 'Block has been modified by another process',
          current_version: current?.version,
          expected_version,
          current_data: current?.data,
          last_updated_by: current?.updated_by
        },
        { status: 409 }
      );
    }

    // 读取更新后的数据
    const updated = await prisma.block.findUnique({
      where: { id: params.blockId }
    });

    return Response.json(updated, { status: 200 });

  } catch (error) {
    console.error('Block update failed:', error);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: String(error) },
      { status: 500 }
    );
  }
}
```

### 前端冲突处理策略

```typescript
// CloudTemplateLoader.ts
async updateBlockWithRetry(
  blockId: string,
  updateFn: (currentData: any) => any,
  source: 'instantiation' | 'workflow' | 'user',
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 1. 读取当前状态
      const current = await this.getBlock(blockId);
      
      // 2. 应用更新函数
      const newData = updateFn(current.data);
      
      // 3. 尝试写入（带版本检查）
      await this.updateBlock(blockId, {
        expected_version: current.version,
        data: newData,
        updated_by: {
          source,
          process_id: this.processId
        }
      });
      
      // 成功 → 退出
      console.log(`✅ Block ${blockId} updated successfully (version ${current.version} → ${current.version + 1})`);
      return;
      
    } catch (error) {
      if (error.status === 409) {
        // 冲突 → 应用冲突解决策略
        console.warn(`⚠️ Version conflict on attempt ${attempt + 1}, resolving...`);
        
        const resolution = await this.resolveConflict(
          blockId,
          error.current_data,
          error.last_updated_by,
          updateFn
        );
        
        if (resolution === 'abort') {
          console.log(`❌ Aborting update for block ${blockId} (conflict resolution: abort)`);
          return;
        }
        
        // 重试（会读取最新状态）
        continue;
        
      } else {
        // 其他错误 → 抛出
        throw error;
      }
    }
  }
  
  throw new Error(`Failed to update block ${blockId} after ${maxRetries} retries`);
}

async resolveConflict(
  blockId: string,
  currentData: any,
  lastUpdatedBy: { source: string; process_id: string },
  myUpdateFn: (data: any) => any
): Promise<'retry' | 'abort' | 'merge'> {
  // 策略 1: 优先级规则
  const priorityMap = {
    user: 100,
    workflow: 80,
    instantiation: 60
  };
  
  const myPriority = priorityMap[this.source];
  const theirPriority = priorityMap[lastUpdatedBy.source];
  
  if (theirPriority > myPriority) {
    // 对方优先级更高 → 放弃
    console.log(`📌 ${lastUpdatedBy.source} has higher priority than ${this.source}, aborting`);
    return 'abort';
  }
  
  // 策略 2: 智能合并（针对 indexingList）
  if (blockId.startsWith('vector_collection')) {
    // 检查是否可以追加（而不是覆盖）
    const myNewData = myUpdateFn(currentData);
    const canAppend = this.canAppendIndexingList(currentData, myNewData);
    
    if (canAppend) {
      console.log(`🔗 Appending to indexingList instead of overwriting`);
      return 'retry';  // 重试会使用最新的 currentData，updateFn 会追加
    }
  }
  
  // 默认：重试
  return 'retry';
}

canAppendIndexingList(currentData: any, myNewData: any): boolean {
  const currentList = currentData.indexingList || [];
  const myList = myNewData.indexingList || [];
  
  // 检查是否有重复的 index_name
  const myIndexNames = myList.map((i: any) => i.index_name);
  const currentIndexNames = currentList.map((i: any) => i.index_name);
  
  const overlap = myIndexNames.filter((n: string) => 
    currentIndexNames.includes(n)
  );
  
  return overlap.length === 0;  // 没有重复 → 可以追加
}
```

---

## State Channel 解决方案

### 核心思想

**Priority-based Update Merging**：当多个来源的状态更新冲突时，根据预定义的优先级和时间戳决定采用哪个。

### 场景：前端接收多个来源的状态更新

```
Frontend State:
Block WzK6iT:
{
  "id": "WzK6iT",
  "data": {
    "indexingList": [
      {
        "index_name": "old_index",
        "status": "done"
      }
    ]
  },
  "_meta": {
    "last_updated_by": "workflow",
    "last_updated_at": "2025-11-01T10:00:00Z",
    "priority": 80
  }
}
```

### Timeline (无 State Channel)

```
T0: 前端当前状态：status = "done" (来自 workflow)

T1: SSE 推送：status = "processing" (来自 instantiation polling)
    → 前端更新：status = "processing" ⚠️
    → 用户看到：done → processing (倒退！)

T2: 另一个 SSE：status = "done" (来自 workflow completion)
    → 前端更新：status = "done" ⚠️
    → 用户看到：processing → done (闪烁！)

T3: 后台同步：status = "error" (来自 instantiation error)
    → 前端更新：status = "error" ⚠️
    → 用户看到：done → error (混乱！)

结果：用户看到状态在 done/processing/error 之间跳来跳去
```

### Timeline (有 State Channel)

```
T0: 前端当前状态：
    status = "done"
    _meta = { source: "workflow", priority: 80, timestamp: "10:00:00" }

T1: 收到更新：status = "processing"
    source: "instantiation", priority: 60, timestamp: "10:01:00"
    
    → State Channel 评估：
      - priority 60 < 80 ❌ (优先级更低)
      - 忽略此更新
    
    → 前端保持：status = "done" ✅

T2: 收到更新：status = "done"
    source: "workflow", priority: 80, timestamp: "10:02:00"
    
    → State Channel 评估：
      - priority 80 == 80 ✅
      - timestamp 10:02:00 > 10:00:00 ✅ (更新)
      - 接受此更新
    
    → 前端更新：status = "done" (实际内容没变)

T3: 收到更新：status = "error"
    source: "instantiation", priority: 60, timestamp: "10:03:00"
    
    → State Channel 评估：
      - priority 60 < 80 ❌
      - 忽略此更新
    
    → 前端保持：status = "done" ✅

结果：用户看到稳定的 status = "done"，没有闪烁
```

### 实现：State Update Metadata

```typescript
// 每个状态更新都带上元数据
interface StateUpdate {
  block_id: string;
  field_path: string;  // JSONPath，如 "indexingList.0.status"
  new_value: any;
  source: 'user' | 'workflow' | 'instantiation' | 'polling';
  priority: number;
  timestamp: string;
  process_id?: string;
}

// 优先级定义
const STATE_UPDATE_PRIORITY = {
  user: 100,          // 用户手动操作
  workflow: 80,       // Workflow 执行（通过 SSE）
  instantiation: 60,  // Template 实例化
  polling: 40,        // 后台轮询同步
};

// 前端存储每个字段的元数据
interface BlockMetadata {
  [fieldPath: string]: {
    source: string;
    priority: number;
    timestamp: string;
    process_id?: string;
  };
}

const blockMetadata = new Map<string, BlockMetadata>();
```

### 实现：State Channel Merger

```typescript
// app/components/workflow/utils/stateChannelMerger.ts
export class StateChannelMerger {
  private metadata = new Map<string, BlockMetadata>();

  /**
   * 决定是否接受一个状态更新
   */
  shouldAcceptUpdate(
    blockId: string,
    fieldPath: string,
    update: StateUpdate
  ): boolean {
    const currentMeta = this.metadata.get(blockId)?.[fieldPath];

    // 如果没有历史元数据，接受
    if (!currentMeta) {
      return true;
    }

    // 规则 1: 优先级更高 → 接受
    if (update.priority > currentMeta.priority) {
      console.log(`✅ Accepting update (higher priority: ${update.priority} > ${currentMeta.priority})`);
      return true;
    }

    // 规则 2: 优先级相同，但时间更新 → 接受
    if (update.priority === currentMeta.priority) {
      const currentTime = new Date(currentMeta.timestamp).getTime();
      const updateTime = new Date(update.timestamp).getTime();

      if (updateTime > currentTime) {
        console.log(`✅ Accepting update (same priority, newer timestamp)`);
        return true;
      }

      // 时间相同，检查 process_id（避免重复处理）
      if (updateTime === currentTime && update.process_id !== currentMeta.process_id) {
        console.warn(`⚠️ Same priority and timestamp, different process_id`);
        return true;  // 保守接受
      }
    }

    // 规则 3: 优先级更低 → 拒绝
    console.log(`❌ Rejecting update (lower priority: ${update.priority} < ${currentMeta.priority})`);
    return false;
  }

  /**
   * 应用状态更新（如果接受）
   */
  applyUpdate(
    blockId: string,
    fieldPath: string,
    update: StateUpdate,
    currentState: any
  ): any {
    if (!this.shouldAcceptUpdate(blockId, fieldPath, update)) {
      return currentState;  // 不接受，返回原状态
    }

    // 更新元数据
    if (!this.metadata.has(blockId)) {
      this.metadata.set(blockId, {});
    }
    this.metadata.get(blockId)![fieldPath] = {
      source: update.source,
      priority: update.priority,
      timestamp: update.timestamp,
      process_id: update.process_id
    };

    // 更新状态（深度设置）
    return this.deepSet(currentState, fieldPath, update.new_value);
  }

  /**
   * 深度设置 JSON 路径值
   */
  private deepSet(obj: any, path: string, value: any): any {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current = { ...obj };
    let ptr = current;

    for (const key of keys) {
      if (Array.isArray(ptr[key])) {
        ptr[key] = [...ptr[key]];
      } else {
        ptr[key] = { ...ptr[key] };
      }
      ptr = ptr[key];
    }

    ptr[lastKey] = value;
    return current;
  }

  /**
   * 清除某个 block 的元数据
   */
  clearMetadata(blockId: string) {
    this.metadata.delete(blockId);
  }
}

export const stateChannelMerger = new StateChannelMerger();
```

### 集成到前端

```typescript
// app/components/workflow/blockNode/utils/blockUpdateApplier.ts
import { stateChannelMerger } from '@/app/components/workflow/utils/stateChannelMerger';

export function applyBlockUpdate(
  ctx: BlockApplierContext,
  update: BlockUpdateInternal | BlockUpdateExternal,
  source: 'workflow' | 'instantiation' | 'polling' = 'workflow'
) {
  const priority = STATE_UPDATE_PRIORITY[source];
  const timestamp = new Date().toISOString();

  // 对于每个字段，通过 State Channel 决定是否接受
  const stateUpdate: StateUpdate = {
    block_id: update.block_id,
    field_path: 'data.indexingList.0.status',  // 示例：针对 status 字段
    new_value: update.data?.indexingList?.[0]?.status,
    source,
    priority,
    timestamp
  };

  ctx.setNodes(prevNodes =>
    prevNodes.map(node => {
      if (node.id === update.block_id) {
        // 使用 State Channel 合并状态
        const newData = stateChannelMerger.applyUpdate(
          node.id,
          stateUpdate.field_path,
          stateUpdate,
          node.data
        );

        return {
          ...node,
          data: newData
        };
      }
      return node;
    })
  );
}
```

### 处理 SSE 事件

```typescript
// runSingleEdgeNodeExecutor.ts
async function handleSSEEvent(event: any) {
  switch (event.event_type) {
    case 'BLOCK_UPDATED':
      applyBlockUpdate(
        context,
        event.payload,
        'workflow'  // SSE 来自 workflow 执行，优先级 80
      );
      break;
  }
}
```

### 处理 Polling 结果

```typescript
// manifestPoller.ts
async fetchManifestAndChunks() {
  const manifest = await this.getManifest();
  
  // 应用轮询结果时标记为低优先级
  applyBlockUpdate(
    this.context,
    {
      block_id: this.blockId,
      data: { content: reconstructedContent }
    },
    'polling'  // Polling 结果，优先级 40
  );
}
```

---

## 组合方案

### Optimistic Locking + State Channel 协同工作

```
┌────────────────────────────────────────────────────────────┐
│  Backend (数据库层)                                         │
│                                                             │
│  Optimistic Locking 确保写入一致性                          │
│    - 版本号控制                                             │
│    - CAS 操作                                               │
│    - 冲突检测和重试                                         │
└────────────────────────────────────────────────────────────┘
                         ↕ HTTP API
┌────────────────────────────────────────────────────────────┐
│  Frontend (React 状态层)                                    │
│                                                             │
│  State Channel 确保读取一致性                               │
│    - 优先级过滤                                             │
│    - 时间戳排序                                             │
│    - 冲突解决                                               │
└────────────────────────────────────────────────────────────┘
```

### 完整流程示例

```
Scenario: 用户手动 embedding 期间，auto-embedding 也在进行

T0: Template instantiation 完成文件上传
    → 触发 auto-embedding (Process A, priority: 60)

T1: Process A 读取 Block WzK6iT
    GET /api/blocks/WzK6iT
    → Response: { version: 1, data: { indexingList: [{ status: "notStarted" }] } }

T2: 用户点击手动 "Embed"
    → 触发 manual workflow (Process B, priority: 80)

T3: Process B 读取 Block WzK6iT
    GET /api/blocks/WzK6iT
    → Response: { version: 1, data: { indexingList: [{ status: "notStarted" }] } }

T4: Process B 完成 embedding
    → 写入结果
    PUT /api/blocks/WzK6iT
    Body: { 
      expected_version: 1,
      data: { indexingList: [{ 
        index_name: "manual_faq_index",
        status: "done",
        collection_configs: { set_name: "manual_set" }
      }] },
      updated_by: { source: "workflow", process_id: "wf_123" }
    }
    ✅ Success: { version: 2, ... }

T5: Frontend 收到 SSE (from Process B)
    → State Channel 评估：
      - source: "workflow", priority: 80
      - 当前状态：{ source: "instantiation", priority: 60 } (从初始加载)
      - 80 > 60 ✅ → 接受更新
    → UI 更新：status = "done", index_name = "manual_faq_index"

T6: Process A 完成 auto-embedding
    → 尝试写入结果
    PUT /api/blocks/WzK6iT
    Body: { 
      expected_version: 1,  // ❌ 过时了！
      data: { indexingList: [{ 
        index_name: "auto_faq_index",
        status: "done",
        collection_configs: { set_name: "auto_set" }
      }] },
      updated_by: { source: "instantiation", process_id: "inst_456" }
    }
    ❌ 409 Conflict: current_version is 2

T7: Process A 处理冲突
    → 重新读取最新状态
    GET /api/blocks/WzK6iT
    → Response: { 
        version: 2, 
        data: { indexingList: [{ 
          index_name: "manual_faq_index",
          status: "done"
        }] },
        updated_by: { source: "workflow" }
      }

T8: Process A 应用冲突解决策略
    → 检测到 updated_by.source = "workflow" (priority: 80)
    → 自己的 priority: 60
    → 80 > 60 → 决定追加，而不是覆盖
    
    → 生成新数据：
    {
      indexingList: [
        { index_name: "manual_faq_index", status: "done", ... },  // 保留
        { index_name: "auto_faq_index", status: "done", ... }     // 追加
      ]
    }

T9: Process A 重试写入
    PUT /api/blocks/WzK6iT
    Body: { 
      expected_version: 2,  // ✅ 最新版本
      data: { indexingList: [...] },  // 包含两个索引
      updated_by: { source: "instantiation", process_id: "inst_456" }
    }
    ✅ Success: { version: 3, ... }

T10: Frontend 收到更新 (from polling or SSE)
    → State Channel 评估：
      - source: "instantiation", priority: 60
      - 当前状态：{ source: "workflow", priority: 80 }
      - 但是 field_path 是 "indexingList" (整个数组)，不是单个字段
      - 检测到这是"追加"操作，不是"覆盖"
      - 接受更新
    → UI 更新：显示两个索引
      1. manual_faq_index ✅
      2. auto_faq_index ✅

T11: 结果
    ✅ 两个索引都保留
    ✅ 用户手动操作没有被覆盖
    ✅ Auto-embedding 结果也成功追加
    ✅ UI 稳定，没有闪烁
```

---

## 完整代码实现

### 1. 数据库 Schema (Prisma)

```prisma
// schema.prisma
model Block {
  id         String   @id
  version    Int      @default(1)
  type       String
  data       Json
  updated_at DateTime @default(now()) @updatedAt
  updated_by Json?    // { source, process_id }
  workspace_id String
  workspace  Workspace @relation(fields: [workspace_id], references: [id])

  @@index([workspace_id])
  @@index([id, version])  // 用于 CAS 查询
}
```

### 2. Backend API (完整实现)

```typescript
// app/api/blocks/[blockId]/route.ts
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

interface UpdateBlockRequest {
  expected_version?: number;
  data: any;
  updated_by?: {
    source: 'user' | 'workflow' | 'instantiation' | 'polling';
    process_id: string;
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { blockId: string } }
) {
  const block = await prisma.block.findUnique({
    where: { id: params.blockId }
  });

  if (!block) {
    return NextResponse.json(
      { error: 'Block not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(block);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { blockId: string } }
) {
  const body: UpdateBlockRequest = await req.json();
  const { expected_version, data, updated_by } = body;

  // 如果没有提供 expected_version，跳过版本检查（强制更新）
  if (expected_version === undefined) {
    const updated = await prisma.block.update({
      where: { id: params.blockId },
      data: {
        version: { increment: 1 },
        data: data as any,
        updated_at: new Date(),
        updated_by: updated_by as any
      }
    });

    return NextResponse.json(updated);
  }

  // Optimistic Locking: 使用事务 + CAS
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. 读取当前版本
      const current = await tx.block.findUnique({
        where: { id: params.blockId }
      });

      if (!current) {
        throw new Error('BLOCK_NOT_FOUND');
      }

      // 2. 检查版本是否匹配
      if (current.version !== expected_version) {
        throw new Error('VERSION_MISMATCH');
      }

      // 3. 更新（版本号递增）
      const updated = await tx.block.update({
        where: { 
          id: params.blockId,
          version: expected_version  // 额外的安全检查
        },
        data: {
          version: expected_version + 1,
          data: data as any,
          updated_at: new Date(),
          updated_by: updated_by as any
        }
      });

      return updated;
    });

    return NextResponse.json(result);

  } catch (error: any) {
    if (error.message === 'VERSION_MISMATCH' || error.message === 'BLOCK_NOT_FOUND') {
      // 重新读取最新状态
      const current = await prisma.block.findUnique({
        where: { id: params.blockId }
      });

      return NextResponse.json(
        {
          error: 'VERSION_MISMATCH',
          message: 'Block has been modified by another process',
          current_version: current?.version,
          expected_version,
          current_data: current?.data,
          last_updated_by: current?.updated_by
        },
        { status: 409 }
      );
    }

    console.error('Block update failed:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: String(error) },
      { status: 500 }
    );
  }
}
```

### 3. Frontend State Channel (完整实现)

```typescript
// app/components/workflow/utils/stateChannelMerger.ts
export interface StateUpdate {
  block_id: string;
  field_path: string;
  new_value: any;
  source: 'user' | 'workflow' | 'instantiation' | 'polling';
  priority: number;
  timestamp: string;
  process_id?: string;
}

export interface FieldMetadata {
  source: string;
  priority: number;
  timestamp: string;
  process_id?: string;
}

export type BlockMetadata = Record<string, FieldMetadata>;

export const STATE_UPDATE_PRIORITY = {
  user: 100,
  workflow: 80,
  instantiation: 60,
  polling: 40,
} as const;

export class StateChannelMerger {
  private metadata = new Map<string, BlockMetadata>();

  shouldAcceptUpdate(
    blockId: string,
    fieldPath: string,
    update: StateUpdate
  ): boolean {
    const blockMeta = this.metadata.get(blockId);
    if (!blockMeta) {
      // 没有历史元数据，接受
      return true;
    }

    const currentMeta = blockMeta[fieldPath];
    if (!currentMeta) {
      // 该字段没有历史元数据，接受
      return true;
    }

    // 规则 1: 优先级更高 → 接受
    if (update.priority > currentMeta.priority) {
      console.log(
        `[StateChannel] ✅ Accepting update for ${blockId}.${fieldPath} (higher priority: ${update.priority} > ${currentMeta.priority})`
      );
      return true;
    }

    // 规则 2: 优先级相同，检查时间戳
    if (update.priority === currentMeta.priority) {
      const currentTime = new Date(currentMeta.timestamp).getTime();
      const updateTime = new Date(update.timestamp).getTime();

      if (updateTime > currentTime) {
        console.log(
          `[StateChannel] ✅ Accepting update for ${blockId}.${fieldPath} (same priority, newer timestamp)`
        );
        return true;
      }

      if (updateTime === currentTime) {
        // 时间相同，检查 process_id
        if (update.process_id && update.process_id !== currentMeta.process_id) {
          console.warn(
            `[StateChannel] ⚠️ Same timestamp, different process_id for ${blockId}.${fieldPath}`
          );
          return true;  // 保守接受
        }

        // 完全相同，拒绝（避免重复处理）
        console.log(
          `[StateChannel] ⏭️ Skipping duplicate update for ${blockId}.${fieldPath}`
        );
        return false;
      }

      // updateTime < currentTime
      console.log(
        `[StateChannel] ❌ Rejecting stale update for ${blockId}.${fieldPath} (older timestamp)`
      );
      return false;
    }

    // 规则 3: 优先级更低 → 拒绝
    console.log(
      `[StateChannel] ❌ Rejecting update for ${blockId}.${fieldPath} (lower priority: ${update.priority} < ${currentMeta.priority})`
    );
    return false;
  }

  applyUpdate(
    blockId: string,
    update: StateUpdate,
    currentState: any
  ): any {
    if (!this.shouldAcceptUpdate(blockId, update.field_path, update)) {
      return currentState;  // 不接受，返回原状态
    }

    // 更新元数据
    if (!this.metadata.has(blockId)) {
      this.metadata.set(blockId, {});
    }
    const blockMeta = this.metadata.get(blockId)!;
    blockMeta[update.field_path] = {
      source: update.source,
      priority: update.priority,
      timestamp: update.timestamp,
      process_id: update.process_id
    };

    // 更新状态（深度设置）
    return this.deepSet(currentState, update.field_path, update.new_value);
  }

  applyMultipleUpdates(
    blockId: string,
    updates: StateUpdate[],
    currentState: any
  ): any {
    let state = currentState;
    for (const update of updates) {
      state = this.applyUpdate(blockId, update, state);
    }
    return state;
  }

  private deepSet(obj: any, path: string, value: any): any {
    const keys = path.split('.');
    if (keys.length === 0) return value;

    const result = Array.isArray(obj) ? [...obj] : { ...obj };
    let current: any = result;
    const lastKey = keys[keys.length - 1];

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const isArrayIndex = /^\d+$/.test(keys[i + 1]);

      if (Array.isArray(current[key])) {
        current[key] = [...current[key]];
      } else if (isArrayIndex) {
        current[key] = current[key] ? [...current[key]] : [];
      } else {
        current[key] = current[key] ? { ...current[key] } : {};
      }

      current = current[key];
    }

    current[lastKey] = value;
    return result;
  }

  clearMetadata(blockId: string) {
    this.metadata.delete(blockId);
  }

  getMetadata(blockId: string): BlockMetadata | undefined {
    return this.metadata.get(blockId);
  }
}

// 全局单例
export const stateChannelMerger = new StateChannelMerger();
```

### 4. CloudTemplateLoader (集成 Optimistic Locking)

```typescript
// PuppyFlow/lib/templates/cloud.ts
export class CloudTemplateLoader extends BaseTemplateLoader {
  private processId: string;

  constructor(
    templateId: string,
    config: TemplateLoaderConfig = DEFAULT_LOADER_CONFIG,
    userAuthHeader?: string
  ) {
    super(templateId, config);
    this.userAuthHeader = userAuthHeader;
    this.processId = `inst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 使用 Optimistic Locking 更新 block
   */
  private async updateBlockWithRetry(
    blockId: string,
    updateFn: (currentData: any) => any,
    maxRetries: number = 3
  ): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 1. 读取当前状态
        const currentBlock = await this.getBlock(blockId);

        // 2. 应用更新函数
        const newData = updateFn(currentBlock.data);

        // 3. 尝试写入（带版本检查）
        await fetch(`http://localhost:3000/api/blocks/${blockId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(this.userAuthHeader ? { Authorization: this.userAuthHeader } : {})
          },
          body: JSON.stringify({
            expected_version: currentBlock.version,
            data: newData,
            updated_by: {
              source: 'instantiation',
              process_id: this.processId
            }
          })
        });

        console.log(
          `[CloudTemplateLoader] ✅ Block ${blockId} updated (attempt ${attempt + 1})`
        );
        return;

      } catch (error: any) {
        if (error.status === 409) {
          // 冲突 → 应用冲突解决策略
          console.warn(
            `[CloudTemplateLoader] ⚠️ Version conflict on block ${blockId} (attempt ${attempt + 1})`
          );

          const resolution = await this.resolveConflict(
            blockId,
            error.current_data,
            error.last_updated_by,
            updateFn
          );

          if (resolution === 'abort') {
            console.log(
              `[CloudTemplateLoader] ❌ Aborting update for block ${blockId}`
            );
            return;
          }

          // 重试
          continue;

        } else {
          // 其他错误
          throw error;
        }
      }
    }

    throw new Error(
      `[CloudTemplateLoader] Failed to update block ${blockId} after ${maxRetries} retries`
    );
  }

  /**
   * 冲突解决策略
   */
  private async resolveConflict(
    blockId: string,
    currentData: any,
    lastUpdatedBy: { source: string; process_id: string },
    myUpdateFn: (data: any) => any
  ): Promise<'retry' | 'abort'> {
    const priorityMap = {
      user: 100,
      workflow: 80,
      instantiation: 60,
      polling: 40
    };

    const myPriority = priorityMap['instantiation'];
    const theirPriority = priorityMap[lastUpdatedBy.source as keyof typeof priorityMap];

    // 对方优先级更高 → 检查是否可以追加
    if (theirPriority > myPriority) {
      console.log(
        `[CloudTemplateLoader] 📌 ${lastUpdatedBy.source} (priority ${theirPriority}) vs instantiation (priority ${myPriority})`
      );

      // 针对 vector_collection 的智能合并
      if (currentData.indexingList) {
        const myNewData = myUpdateFn(currentData);
        const canAppend = this.canAppendToIndexingList(
          currentData.indexingList,
          myNewData.indexingList
        );

        if (canAppend) {
          console.log(
            `[CloudTemplateLoader] 🔗 Can append to indexingList, retrying...`
          );
          return 'retry';  // updateFn 会在最新 currentData 上追加
        }
      }

      // 无法合并 → 放弃
      console.log(
        `[CloudTemplateLoader] ❌ Cannot merge, aborting...`
      );
      return 'abort';
    }

    // 优先级相同或更低 → 重试
    return 'retry';
  }

  /**
   * 检查是否可以追加到 indexingList
   */
  private canAppendToIndexingList(
    currentList: any[],
    myList: any[]
  ): boolean {
    const currentNames = currentList.map(i => i.index_name).filter(Boolean);
    const myNames = myList.map(i => i.index_name).filter(Boolean);

    const overlap = myNames.filter(name => currentNames.includes(name));
    return overlap.length === 0;  // 没有重复 → 可以追加
  }

  /**
   * 在 processVectorCollection 中使用
   */
  protected async processVectorCollection(/* ... */) {
    // ... auto-embedding logic ...

    // 更新 block 时使用 updateBlockWithRetry
    await this.updateBlockWithRetry(block.id, (currentData) => {
      // 读取最新的 indexingList
      const latestIndexingList = currentData.indexingList || [];

      // 追加新的 indexingItem（如果 auto-embedding 成功）
      const newIndexingItem = {
        index_name: indexName,
        status: 'done',
        collection_configs: collectionConfigs
      };

      return {
        ...currentData,
        indexingList: [...latestIndexingList, newIndexingItem]
      };
    });
  }

  private async getBlock(blockId: string): Promise<any> {
    const res = await fetch(`http://localhost:3000/api/blocks/${blockId}`, {
      headers: {
        ...(this.userAuthHeader ? { Authorization: this.userAuthHeader } : {})
      }
    });
    if (!res.ok) throw new Error(`Failed to get block ${blockId}`);
    return res.json();
  }
}
```

---

## 工业级技术选型

### 1. **Google Spanner / CockroachDB** (分布式强一致性数据库)

**特点**：
- 全球分布式，强一致性 (Linearizable)
- 内置 Optimistic Locking (通过 `@version` 列)
- 支持分布式事务 (ACID)

**适用场景**：
- 多地域部署
- 金融级数据一致性要求
- 大规模并发写入

**示例**：
```sql
-- CockroachDB / Spanner
CREATE TABLE blocks (
  id UUID PRIMARY KEY,
  version INT NOT NULL DEFAULT 1,
  data JSONB,
  updated_at TIMESTAMP DEFAULT NOW(),
  CHECK (version > 0)
);

-- Optimistic Locking 更新
BEGIN;
  SELECT version FROM blocks WHERE id = $1 FOR UPDATE;  -- 悲观锁（可选）
  UPDATE blocks 
  SET version = version + 1, data = $2, updated_at = NOW()
  WHERE id = $1 AND version = $3;  -- CAS
COMMIT;
```

---

### 2. **Redis + Lua Script** (原子性操作)

**特点**：
- 单线程执行 Lua 脚本，天然原子性
- 极高性能（内存操作）
- 支持 `WATCH` + `MULTI` 实现 Optimistic Locking

**适用场景**：
- 高并发场景（> 10k QPS）
- 需要快速冲突检测
- 配合数据库作为缓存层

**示例**：
```lua
-- Redis Lua Script for CAS
local key = KEYS[1]
local expected_version = tonumber(ARGV[1])
local new_data = ARGV[2]

local current = redis.call('HGETALL', key)
local current_version = tonumber(current['version'])

if current_version ~= expected_version then
  return {err = 'VERSION_MISMATCH', current_version = current_version}
end

redis.call('HSET', key, 'version', expected_version + 1)
redis.call('HSET', key, 'data', new_data)
redis.call('HSET', key, 'updated_at', redis.call('TIME')[1])

return 'OK'
```

```typescript
// Node.js 使用
const result = await redis.eval(
  luaScript,
  1,  // KEYS count
  blockId,  // KEYS[1]
  expectedVersion,  // ARGV[1]
  JSON.stringify(newData)  // ARGV[2]
);
```

---

### 3. **Apache Kafka + KSQL** (Event Sourcing)

**特点**：
- 不可变事件日志
- 时间旅行（重放到任意时间点）
- 天然支持并发（分区 + 偏移量）
- 强审计能力

**适用场景**：
- 需要完整审计日志
- 复杂的状态重建逻辑
- 微服务架构

**示例**：
```typescript
// 事件定义
interface BlockEvent {
  event_id: string;
  block_id: string;
  event_type: 'FILE_UPLOADED' | 'EMBEDDING_STARTED' | 'EMBEDDING_COMPLETED';
  payload: any;
  source: 'user' | 'workflow' | 'instantiation';
  timestamp: number;
  sequence: number;  // Kafka offset
}

// 发布事件
await kafka.send({
  topic: 'block-events',
  messages: [{
    key: blockId,  // 分区键
    value: JSON.stringify(event)
  }]
});

// 消费事件并重建状态
const consumer = kafka.consumer({ groupId: 'block-state-builder' });
await consumer.subscribe({ topic: 'block-events', fromBeginning: true });

await consumer.run({
  eachMessage: async ({ message }) => {
    const event: BlockEvent = JSON.parse(message.value.toString());
    const currentState = await getBlockState(event.block_id);
    const newState = applyEvent(currentState, event);
    await saveBlockState(event.block_id, newState);
  }
});

// KSQL 实时查询
CREATE TABLE block_states AS
  SELECT 
    block_id,
    LATEST_BY_OFFSET(data) AS data,
    LATEST_BY_OFFSET(version) AS version
  FROM block_events
  GROUP BY block_id;
```

---

### 4. **Yjs / Automerge** (CRDT - Conflict-free Replicated Data Types)

**特点**：
- 自动冲突解决（数学保证最终一致性）
- 支持离线编辑
- 适合实时协作场景（如 Google Docs）

**适用场景**：
- 多用户实时协作
- 离线优先应用
- 复杂的文本/JSON 编辑

**示例**：
```typescript
// Yjs
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// 创建共享文档
const doc = new Y.Doc();
const blockMap = doc.getMap('blocks');

// 连接到 WebSocket 服务器（自动同步）
const provider = new WebsocketProvider(
  'ws://localhost:1234',
  'workspace-123',
  doc
);

// Client A: 修改 block
const blockA = blockMap.get('WzK6iT');
blockA.set('status', 'processing');

// Client B: 同时修改同一个 block
const blockB = blockMap.get('WzK6iT');
blockB.set('index_name', 'my_index');

// CRDT 自动合并，两个修改都生效！
console.log(blockMap.get('WzK6iT'));
// { status: 'processing', index_name: 'my_index' }
```

---

### 5. **Distributed Locks (Redlock / Etcd / Zookeeper)**

**特点**：
- 悲观锁（先获取锁，再修改）
- 避免冲突，而不是检测冲突
- 适合低并发、高一致性要求

**适用场景**：
- 关键业务操作（如转账）
- 低并发（< 100 QPS）
- 需要强一致性

**示例**：
```typescript
// Redlock (Redis 分布式锁)
import Redlock from 'redlock';

const redlock = new Redlock([redis1, redis2, redis3], {
  retryCount: 10,
  retryDelay: 200,
  retryJitter: 200
});

async function updateBlockWithLock(blockId: string, newData: any) {
  const lock = await redlock.acquire([`lock:block:${blockId}`], 5000);  // 5s TTL

  try {
    // 在锁保护下修改
    const current = await getBlock(blockId);
    await updateBlock(blockId, { ...current.data, ...newData });
  } finally {
    await lock.release();
  }
}
```

---

### 6. **PostgreSQL Advisory Locks**

**特点**：
- 内置于 PostgreSQL
- 轻量级，不需要额外基础设施
- 支持会话级和事务级锁

**适用场景**：
- 单体应用
- 已使用 PostgreSQL
- 需要简单的分布式锁

**示例**：
```sql
-- 获取 advisory lock
SELECT pg_advisory_lock(12345);  -- 12345 是 lock ID（可以是 block_id 的 hash）

-- 执行更新
UPDATE blocks SET data = $1 WHERE id = $2;

-- 释放锁
SELECT pg_advisory_unlock(12345);
```

```typescript
// Node.js with pg
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [blockIdHash]);  // 事务级锁
  
  const result = await client.query('UPDATE blocks SET data = $1 WHERE id = $2', [newData, blockId]);
  
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

---

### 7. **Apache Pulsar** (Event Streaming + State Management)

**特点**：
- 类似 Kafka，但支持多租户
- 内置 schema registry
- 支持 Key_Shared 订阅（负载均衡 + 顺序保证）

**适用场景**：
- 多租户 SaaS 应用
- 需要强类型事件 schema
- 微服务架构

---

### 8. **FoundationDB** (分布式键值存储 + 事务)

**特点**：
- ACID 事务（跨多个 key）
- 强一致性
- Apple 使用（iCloud 后端）

**适用场景**：
- 自建数据库层
- 需要灵活的数据模型
- 极高可靠性要求

---

## 技术选型决策树

```
┌─────────────────────────────────────────────────────────────────┐
│  需求分析                                                        │
└─────────────────────────────────────────────────────────────────┘
                          ↓
    ┌─────────────────────────────────────────────┐
    │ Q1: 是否需要实时多用户协作？                │
    └─────────────────────────────────────────────┘
                  ↓ Yes                  ↓ No
        ┌─────────────────┐              │
        │  使用 CRDT       │              │
        │  (Yjs/Automerge) │              │
        └─────────────────┘              │
                                         ↓
                    ┌─────────────────────────────────────┐
                    │ Q2: 并发写入量级？                  │
                    └─────────────────────────────────────┘
                          ↓ < 100 QPS           ↓ > 10k QPS
                    ┌─────────────┐      ┌──────────────────┐
                    │ 分布式锁    │      │ Redis + Lua      │
                    │ (Redlock)   │      │ (原子操作)       │
                    └─────────────┘      └──────────────────┘
                                         ↓
                    ┌─────────────────────────────────────┐
                    │ Q3: 是否需要审计日志/时间旅行？     │
                    └─────────────────────────────────────┘
                          ↓ Yes                  ↓ No
                    ┌─────────────┐      ┌──────────────────┐
                    │ Event        │      │ Optimistic       │
                    │ Sourcing     │      │ Locking          │
                    │ (Kafka)      │      │ (Version + CAS)  │
                    └─────────────┘      └──────────────────┘
                                         ↓
                    ┌─────────────────────────────────────┐
                    │ Q4: 是否多地域部署？                │
                    └─────────────────────────────────────┘
                          ↓ Yes                  ↓ No
                    ┌─────────────┐      ┌──────────────────┐
                    │ Spanner /    │      │ PostgreSQL +     │
                    │ CockroachDB  │      │ Advisory Locks   │
                    └─────────────┘      └──────────────────┘
```

---

## 推荐方案总结

### 对于 PuppyFlow (MVP → Production)

| 阶段 | 技术栈 | 理由 |
|------|--------|------|
| **Phase 3.x (MVP)** | 同步 Instantiation | 简单，避免并发问题 |
| **Phase 4.x (Early Production)** | PostgreSQL + Optimistic Locking<br>+ Frontend State Channel | 平衡复杂度和可靠性<br>增量实现 |
| **Phase 5.x (Scale)** | Redis (Cache) + PostgreSQL<br>+ Event Log (optional) | 支持高并发<br>审计能力 |
| **Phase 6.x (Global)** | CockroachDB / Spanner<br>+ CRDT (for collaboration) | 多地域<br>实时协作 |

### 立即可行的最佳实践

1. ✅ **保持同步 Instantiation**（短期）
2. ✅ **添加状态更新日志和元数据**
3. ✅ **前端实现 State Channel 优先级过滤**
4. 🔄 **下一步：实现 Optimistic Locking**（Phase 4.1）
5. 🔮 **长期：根据规模选择分布式方案**

---

## 参考资料

- [Optimistic vs Pessimistic Locking](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html) - Martin Fowler
- [CRDT: Conflict-free Replicated Data Types](https://crdt.tech/)
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Google Spanner Paper](https://research.google/pubs/pub39966/)
- [Redlock Algorithm](https://redis.io/docs/reference/patterns/distributed-locks/)
