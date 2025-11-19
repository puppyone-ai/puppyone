# 工业级状态一致性解决方案

## 技术选型对比

| 方案 | 复杂度 | 可靠性 | 性能 | 适用场景 | 成本 |
|------|--------|--------|------|----------|------|
| Optimistic Locking | 低 | 中 | 高 | 中小型应用 | 低 |
| Event Sourcing | 高 | 高 | 中 | 需要审计的系统 | 高 |
| CRDT | 高 | 高 | 高 | 离线协作 | 中 |
| Distributed Lock | 中 | 中 | 低 | 强一致性需求 | 中 |
| Saga Pattern | 中 | 高 | 中 | 微服务架构 | 中 |
| Actor Model | 高 | 高 | 高 | 高并发系统 | 高 |

## 1. Event Sourcing + CQRS（金融级）

### 适用场景
- 银行、交易系统
- 需要完整审计日志
- 支持时间旅行和回滚
- 复杂的业务规则

### 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│  Write Side (Command)                                            │
│                                                                   │
│  User Action → Command → Aggregate                               │
│                             ↓                                     │
│                        Validate Business Rules                   │
│                             ↓                                     │
│                        Generate Event(s)                         │
│                             ↓                                     │
│                        Event Store (Append-only)                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓ Event Stream
┌─────────────────────────────────────────────────────────────────┐
│  Read Side (Query)                                               │
│                                                                   │
│  Event Handler → Update Read Model (Projection)                 │
│       ↓                                                           │
│  Materialized View (Optimized for Query)                        │
│       ↓                                                           │
│  API Response                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 技术栈

**Event Store**:
- [EventStoreDB](https://www.eventstore.com/) (专用)
- PostgreSQL (通用, 使用 JSONB)
- Apache Kafka (流式)
- AWS EventBridge / Azure Event Grid (云原生)

**CQRS Framework**:
- [Axon Framework](https://axoniq.io/) (Java)
- [Eventide](https://eventide-project.org/) (Ruby)
- [NEventStore](https://github.com/NEventStore/NEventStore) (C#)
- [EventFlow](https://github.com/eventflow/EventFlow) (C#)

### 实现示例 (TypeScript + PostgreSQL)

```typescript
// ========================================
// 1. Event Definitions
// ========================================
interface DomainEvent {
  event_id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_data: any;
  metadata: {
    user_id: string;
    correlation_id: string;
    causation_id: string;
    timestamp: string;
  };
  sequence: number;  // Per-aggregate sequence
}

// Block-specific events
type BlockEvent = 
  | FileUploadedEvent
  | EmbeddingStartedEvent
  | EmbeddingCompletedEvent
  | EmbeddingFailedEvent
  | ContentUpdatedEvent
  | IndexDeletedEvent;

interface FileUploadedEvent extends DomainEvent {
  event_type: 'FileUploaded';
  event_data: {
    file_name: string;
    storage_key: string;
    size: number;
    mime_type: string;
  };
}

interface EmbeddingStartedEvent extends DomainEvent {
  event_type: 'EmbeddingStarted';
  event_data: {
    index_name: string;
    collection_name: string;
    triggered_by: 'user' | 'instantiation';
  };
}

interface EmbeddingCompletedEvent extends DomainEvent {
  event_type: 'EmbeddingCompleted';
  event_data: {
    index_name: string;
    chunks_indexed: number;
    duration_ms: number;
  };
}

// ========================================
// 2. Event Store (PostgreSQL)
// ========================================
CREATE TABLE event_store (
  event_id UUID PRIMARY KEY,
  aggregate_id VARCHAR(50) NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  metadata JSONB NOT NULL,
  sequence BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE (aggregate_id, sequence),  -- Ensure sequence uniqueness per aggregate
  CHECK (sequence > 0)
);

-- Indexes for fast querying
CREATE INDEX idx_aggregate_id ON event_store(aggregate_id, sequence);
CREATE INDEX idx_event_type ON event_store(event_type);
CREATE INDEX idx_created_at ON event_store(created_at);

-- ========================================
// 3. Event Store Repository
// ========================================
class EventStoreRepository {
  async appendEvent(event: DomainEvent): Promise<void> {
    const result = await db.query(
      `INSERT INTO event_store 
       (event_id, aggregate_id, aggregate_type, event_type, event_data, metadata, sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        event.event_id,
        event.aggregate_id,
        event.aggregate_type,
        event.event_type,
        JSON.stringify(event.event_data),
        JSON.stringify(event.metadata),
        event.sequence
      ]
    );

    // Publish to event bus for async processing
    await this.eventBus.publish(event);
  }

  async getEvents(
    aggregateId: string,
    fromSequence: number = 0
  ): Promise<DomainEvent[]> {
    const result = await db.query(
      `SELECT * FROM event_store 
       WHERE aggregate_id = $1 AND sequence > $2
       ORDER BY sequence ASC`,
      [aggregateId, fromSequence]
    );

    return result.rows.map(row => ({
      ...row,
      event_data: row.event_data,
      metadata: row.metadata
    }));
  }

  async getEventsByType(
    eventType: string,
    since: Date
  ): Promise<DomainEvent[]> {
    const result = await db.query(
      `SELECT * FROM event_store 
       WHERE event_type = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [eventType, since]
    );

    return result.rows;
  }
}

// ========================================
// 4. Aggregate (Business Logic)
// ========================================
class VectorCollectionBlock {
  private aggregateId: string;
  private version: number = 0;
  private uncommittedEvents: DomainEvent[] = [];

  // State (rebuilt from events)
  private state: {
    id: string;
    content: string;
    indexingList: Array<{
      index_name: string;
      status: VectorIndexingStatus;
      collection_configs: any;
    }>;
  };

  constructor(aggregateId: string) {
    this.aggregateId = aggregateId;
    this.state = {
      id: aggregateId,
      content: '',
      indexingList: []
    };
  }

  // ========================================
  // Command Handlers (Write)
  // ========================================
  
  startEmbedding(
    indexName: string,
    collectionConfigs: any,
    triggeredBy: 'user' | 'instantiation',
    userId: string
  ): void {
    // Business rule validation
    const existingIndex = this.state.indexingList.find(
      item => item.index_name === indexName
    );
    
    if (existingIndex && existingIndex.status === 'processing') {
      throw new Error('Embedding already in progress for this index');
    }

    // Generate event
    const event: EmbeddingStartedEvent = {
      event_id: uuid(),
      aggregate_id: this.aggregateId,
      aggregate_type: 'VectorCollectionBlock',
      event_type: 'EmbeddingStarted',
      event_data: {
        index_name: indexName,
        collection_name: collectionConfigs.collection_name,
        triggered_by: triggeredBy
      },
      metadata: {
        user_id: userId,
        correlation_id: uuid(),
        causation_id: uuid(),
        timestamp: new Date().toISOString()
      },
      sequence: this.version + 1
    };

    // Apply to local state
    this.applyEvent(event);
    
    // Stage for persistence
    this.uncommittedEvents.push(event);
  }

  completeEmbedding(indexName: string, chunksIndexed: number, durationMs: number): void {
    // Business rule: can only complete if in progress
    const index = this.state.indexingList.find(item => item.index_name === indexName);
    if (!index || index.status !== 'processing') {
      throw new Error('No embedding in progress for this index');
    }

    const event: EmbeddingCompletedEvent = {
      event_id: uuid(),
      aggregate_id: this.aggregateId,
      aggregate_type: 'VectorCollectionBlock',
      event_type: 'EmbeddingCompleted',
      event_data: { index_name: indexName, chunks_indexed: chunksIndexed, duration_ms: durationMs },
      metadata: { /* ... */ },
      sequence: this.version + 1
    };

    this.applyEvent(event);
    this.uncommittedEvents.push(event);
  }

  // ========================================
  // Event Sourcing Core: Apply Events
  // ========================================
  
  private applyEvent(event: DomainEvent): void {
    switch (event.event_type) {
      case 'EmbeddingStarted':
        this.applyEmbeddingStarted(event as EmbeddingStartedEvent);
        break;
      case 'EmbeddingCompleted':
        this.applyEmbeddingCompleted(event as EmbeddingCompletedEvent);
        break;
      case 'ContentUpdated':
        this.applyContentUpdated(event as ContentUpdatedEvent);
        break;
      // ... other events
    }
    
    this.version = event.sequence;
  }

  private applyEmbeddingStarted(event: EmbeddingStartedEvent): void {
    const existingIndex = this.state.indexingList.findIndex(
      item => item.index_name === event.event_data.index_name
    );

    if (existingIndex >= 0) {
      this.state.indexingList[existingIndex].status = 'processing';
    } else {
      this.state.indexingList.push({
        index_name: event.event_data.index_name,
        status: 'processing',
        collection_configs: { /* from event */ }
      });
    }
  }

  private applyEmbeddingCompleted(event: EmbeddingCompletedEvent): void {
    const index = this.state.indexingList.find(
      item => item.index_name === event.event_data.index_name
    );
    if (index) {
      index.status = 'done';
    }
  }

  private applyContentUpdated(event: ContentUpdatedEvent): void {
    this.state.content = event.event_data.new_content;
  }

  // ========================================
  // Persistence
  // ========================================
  
  async save(eventStore: EventStoreRepository): Promise<void> {
    for (const event of this.uncommittedEvents) {
      await eventStore.appendEvent(event);
    }
    this.uncommittedEvents = [];
  }

  // ========================================
  // Hydration (Rebuild from events)
  // ========================================
  
  static async load(
    aggregateId: string,
    eventStore: EventStoreRepository
  ): Promise<VectorCollectionBlock> {
    const aggregate = new VectorCollectionBlock(aggregateId);
    const events = await eventStore.getEvents(aggregateId);

    for (const event of events) {
      aggregate.applyEvent(event);
    }

    return aggregate;
  }

  getState() {
    return { ...this.state };
  }
}

// ========================================
// 5. Read Model (Query Side)
// ========================================
CREATE TABLE block_read_model (
  id VARCHAR(50) PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  content TEXT,
  indexing_list JSONB,
  version BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

class BlockReadModelProjection {
  async handleEmbeddingStarted(event: EmbeddingStartedEvent): Promise<void> {
    await db.query(
      `UPDATE block_read_model
       SET 
         indexing_list = jsonb_set(
           indexing_list,
           '{-1}',  -- Append to array
           $1::jsonb
         ),
         version = $2,
         updated_at = NOW()
       WHERE id = $3`,
      [
        JSON.stringify({
          index_name: event.event_data.index_name,
          status: 'processing',
          started_at: event.metadata.timestamp
        }),
        event.sequence,
        event.aggregate_id
      ]
    );
  }

  async handleEmbeddingCompleted(event: EmbeddingCompletedEvent): Promise<void> {
    // Update status in read model
    // Complex JSONB update logic...
  }

  async rebuildFromEvents(aggregateId: string): Promise<void> {
    const events = await eventStore.getEvents(aggregateId);
    
    // Delete old read model
    await db.query('DELETE FROM block_read_model WHERE id = $1', [aggregateId]);

    // Replay all events
    for (const event of events) {
      switch (event.event_type) {
        case 'EmbeddingStarted':
          await this.handleEmbeddingStarted(event as EmbeddingStartedEvent);
          break;
        // ... other events
      }
    }
  }
}

// ========================================
// 6. Usage in Application
// ========================================

// Write path (CloudTemplateLoader)
async function processVectorCollection(blockId: string) {
  // Load aggregate from event store
  const block = await VectorCollectionBlock.load(blockId, eventStore);

  // Execute business logic (generates events)
  block.startEmbedding(
    'faq_index',
    collectionConfigs,
    'instantiation',
    userId
  );

  // Call external API
  const result = await callEmbeddingAPI(/* ... */);

  // Record completion
  block.completeEmbedding('faq_index', result.chunks, result.duration);

  // Persist (append events)
  await block.save(eventStore);
}

// Read path (API endpoint)
async function getBlock(blockId: string) {
  // Query optimized read model
  const result = await db.query(
    'SELECT * FROM block_read_model WHERE id = $1',
    [blockId]
  );
  
  return result.rows[0];
}
```

### 优势

1. **完美的并发控制**: 事件追加是原子操作，自然序列化
2. **完整审计**: 所有变更都有记录，可以回放
3. **时间旅行**: 可以重建任意时间点的状态
4. **性能优化**: Read Model 可以针对查询优化
5. **最终一致性**: Write 和 Read 解耦

### 劣势

1. **复杂度高**: 需要维护两套模型 (Command + Query)
2. **学习曲线陡**: 需要理解 CQRS、Event Sourcing 概念
3. **存储开销**: 事件需要永久保存
4. **最终一致性**: Read Model 可能有延迟

## 2. CRDT (Conflict-free Replicated Data Types)

### 适用场景
- 协同编辑 (Google Docs, Figma)
- 离线优先应用
- 分布式系统
- 多用户实时协作

### 技术栈

- **Yjs**: 最流行的 CRDT 库 (JavaScript/TypeScript)
- **Automerge**: 易用的 CRDT 库 (JavaScript)
- **Loro**: 高性能 CRDT (Rust + WASM)
- **GUN.js**: 去中心化 CRDT 数据库
- **OrbitDB**: 基于 IPFS 的分布式数据库

### 实现示例 (Yjs)

```typescript
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// ========================================
// 1. 创建共享文档
// ========================================
const doc = new Y.Doc();

// 定义共享数据结构
const blocks = doc.getMap('blocks');  // Map<blockId, Block>

// 定义 Block 结构
interface Block {
  id: string;
  type: string;
  content: Y.Text;  // ✅ CRDT Text type
  indexingList: Y.Array<any>;  // ✅ CRDT Array type
}

// ========================================
// 2. 创建 Block
// ========================================
function createBlock(blockId: string): void {
  const blockMap = new Y.Map();
  
  blockMap.set('id', blockId);
  blockMap.set('type', 'vector_collection');
  blockMap.set('content', new Y.Text());
  blockMap.set('indexingList', new Y.Array());

  blocks.set(blockId, blockMap);
}

// ========================================
// 3. 并发修改 (自动合并)
// ========================================

// Client A (Template Instantiation)
const blockA = blocks.get('WzK6iT') as Y.Map;
const indexingListA = blockA.get('indexingList') as Y.Array;

doc.transact(() => {
  indexingListA.push([{
    index_name: 'faq_index',
    status: 'processing',
    timestamp: Date.now()
  }]);
});

// Client B (Workflow Execution) - 同时进行
const blockB = blocks.get('WzK6iT') as Y.Map;
const contentB = blockB.get('content') as Y.Text;

doc.transact(() => {
  contentB.insert(0, 'Generated content from workflow');
});

// ✅ CRDT 自动合并，不会冲突！
// 结果：
// - content = "Generated content from workflow"
// - indexingList = [{ index_name: 'faq_index', status: 'processing', ... }]

// ========================================
// 4. 同步到多个客户端
// ========================================
const wsProvider = new WebsocketProvider(
  'ws://localhost:1234',
  'my-workspace',
  doc
);

// 所有连接到同一个 room 的客户端会自动同步

// ========================================
// 5. 离线支持
// ========================================
import { IndexeddbPersistence } from 'y-indexeddb';

// 自动保存到本地 IndexedDB
const persistence = new IndexeddbPersistence('my-workspace', doc);

// 离线时继续编辑，上线后自动同步
doc.on('update', (update: Uint8Array) => {
  console.log('Document updated, will sync when online');
});

// ========================================
// 6. 观察变化
// ========================================
blocks.observe((event) => {
  console.log('Blocks changed:', event.changes);
  
  event.changes.keys.forEach((change, key) => {
    if (change.action === 'add') {
      console.log(`Block ${key} added`);
    } else if (change.action === 'update') {
      console.log(`Block ${key} updated`);
    } else if (change.action === 'delete') {
      console.log(`Block ${key} deleted`);
    }
  });
});

// ========================================
// 7. 时间旅行 (Undo/Redo)
// ========================================
const undoManager = new Y.UndoManager([blocks]);

// Undo
undoManager.undo();

// Redo
undoManager.redo();

// ========================================
// 8. 与 React 集成
// ========================================
import { useMap, useArray, useText } from 'yjs-react';

function BlockComponent({ blockId }: { blockId: string }) {
  const block = blocks.get(blockId) as Y.Map;
  
  // 自动响应 CRDT 变化
  const content = useText(block.get('content') as Y.Text);
  const indexingList = useArray(block.get('indexingList') as Y.Array);

  return (
    <div>
      <p>{content}</p>
      <ul>
        {indexingList.map((item, i) => (
          <li key={i}>{item.index_name}: {item.status}</li>
        ))}
      </ul>
    </div>
  );
}
```

### CRDT 冲突解决策略

```typescript
// ========================================
// 场景：两个客户端同时修改 indexingList 中的 status
// ========================================

// Client A: 标记为 'done'
const itemA = indexingList.get(0);
itemA.status = 'done';

// Client B: 标记为 'error'
const itemB = indexingList.get(0);
itemB.status = 'error';

// ❓ 冲突：status 应该是什么？

// CRDT 内置解决策略 (Last-Writer-Wins):
// - 使用逻辑时钟 (Lamport timestamp) 或 Hybrid Logical Clock
// - 时间戳更大的 wins
// - 如果时间戳相同，使用 client_id 字典序

// 如果需要自定义策略，可以使用 Y.Map 的 observe 事件
block.observe((event) => {
  event.changes.keys.forEach((change, key) => {
    if (key === 'status') {
      // 自定义优先级逻辑
      const currentValue = block.get('status');
      
      // 规则: 'error' > 'done' > 'processing' > 'notStarted'
      const priority = {
        error: 4,
        done: 3,
        processing: 2,
        notStarted: 1
      };

      if (priority[currentValue] < priority[change.oldValue]) {
        // 覆盖为优先级更高的值
        block.set('status', change.oldValue);
      }
    }
  });
});
```

### 优势

1. **自动冲突解决**: 数学证明的无冲突合并
2. **离线优先**: 离线编辑，上线自动同步
3. **实时协作**: 多用户同时编辑
4. **性能好**: 不需要服务端仲裁

### 劣势

1. **学习曲线**: CRDT 概念较难理解
2. **数据膨胀**: 需要存储大量元数据
3. **有限的数据类型**: 不是所有数据结构都有 CRDT 版本
4. **垃圾回收**: 需要定期清理历史元数据

## 3. Distributed Lock + Transaction (强一致性)

### 适用场景
- 库存管理
- 支付系统
- 关键资源争抢

### 技术栈

- **Redis**: Redlock 算法
- **etcd**: 分布式锁
- **ZooKeeper**: 分布式协调
- **Consul**: 服务发现 + 锁

### 实现示例 (Redis Redlock)

```typescript
import Redlock from 'redlock';
import Redis from 'ioredis';

// ========================================
// 1. 创建 Redlock 实例
// ========================================
const redisClients = [
  new Redis({ host: 'redis1.example.com' }),
  new Redis({ host: 'redis2.example.com' }),
  new Redis({ host: 'redis3.example.com' }),
];

const redlock = new Redlock(redisClients, {
  retryCount: 10,
  retryDelay: 200,
  retryJitter: 200,
  automaticExtensionThreshold: 500,
});

// ========================================
// 2. 使用分布式锁保护并发修改
// ========================================
async function updateBlockWithLock(blockId: string, updateFn: (block: Block) => Block) {
  const lockKey = `block:lock:${blockId}`;
  const lockTTL = 5000;  // 5 seconds

  // 获取锁
  const lock = await redlock.acquire([lockKey], lockTTL);

  try {
    // 读取当前状态
    const currentBlock = await db.getBlock(blockId);

    // 执行修改
    const updatedBlock = updateFn(currentBlock);

    // 写回数据库
    await db.updateBlock(blockId, updatedBlock);

    return updatedBlock;
  } finally {
    // 释放锁
    await lock.release();
  }
}

// ========================================
// 3. 使用示例
// ========================================

// Template Instantiation
await updateBlockWithLock('WzK6iT', (block) => {
  block.indexingList.push({
    index_name: 'faq_index',
    status: 'processing'
  });
  return block;
});

// Workflow Execution (会等待锁释放)
await updateBlockWithLock('WzK6iT', (block) => {
  block.content = 'Generated content';
  return block;
});

// ✅ 串行执行，保证强一致性
```

### 优势

1. **强一致性**: 保证同一时刻只有一个进程修改
2. **简单直观**: 类似单机锁
3. **成熟**: 久经考验的方案

### 劣势

1. **性能瓶颈**: 串行化执行，降低并发
2. **死锁风险**: 需要小心处理锁超时
3. **单点故障**: 依赖 Redis/etcd 高可用

## 4. Saga Pattern (微服务架构)

### 适用场景
- 微服务间协调
- 长事务
- 需要补偿机制

### 实现示例

```typescript
// ========================================
// Saga Orchestrator
// ========================================
class TemplateInstantiationSaga {
  async execute(templateId: string, userId: string) {
    const sagaId = uuid();
    const context = {
      templateId,
      userId,
      blockIds: [],
      fileKeys: []
    };

    try {
      // Step 1: Create blocks
      context.blockIds = await this.createBlocks(context);

      // Step 2: Upload files
      context.fileKeys = await this.uploadFiles(context);

      // Step 3: Start embedding
      await this.startEmbedding(context);

      // Step 4: Update workspace
      await this.updateWorkspace(context);

      return { success: true, context };
    } catch (error) {
      // Compensation (rollback)
      await this.compensate(context, error);
      throw error;
    }
  }

  private async compensate(context: any, error: Error) {
    console.log('Saga failed, compensating...', error);

    // Rollback in reverse order
    if (context.fileKeys.length > 0) {
      await this.deleteFiles(context.fileKeys);
    }

    if (context.blockIds.length > 0) {
      await this.deleteBlocks(context.blockIds);
    }
  }
}
```

## 5. Actor Model (高并发)

### 技术栈

- **Akka** (Scala/Java)
- **Orleans** (.NET)
- **Proto.Actor** (Go)
- **Orbit** (Kotlin)

### 概念

```
Each Block = One Actor
- Actor 有自己的 mailbox (消息队列)
- Actor 串行处理消息 (天然避免并发冲突)
- Actor 之间通过消息通信
```

### 实现示例 (伪代码)

```typescript
class BlockActor extends Actor {
  private state: BlockState;

  async receive(message: Message) {
    switch (message.type) {
      case 'UpdateContent':
        this.state.content = message.content;
        break;
      case 'StartEmbedding':
        this.state.indexingList.push({ status: 'processing', ... });
        break;
      case 'CompleteEmbedding':
        this.state.indexingList[0].status = 'done';
        break;
    }

    // Persist state after each message
    await this.persist(this.state);
  }
}

// 使用
const blockActor = actorSystem.actorOf('WzK6iT', BlockActor);

// 发送消息 (异步，不会冲突)
blockActor.tell({ type: 'UpdateContent', content: '...' });
blockActor.tell({ type: 'StartEmbedding', indexName: '...' });
```

## 总结：技术选型建议

### 小型应用 (< 10k users)
✅ **Optimistic Locking + State Channel**
- 简单、成本低
- 足够应对大多数场景

### 中型应用 (10k - 100k users)
✅ **Optimistic Locking + Event Log**
- 添加事件日志用于审计
- 保持轻量级

### 大型应用 (> 100k users)
✅ **Event Sourcing + CQRS**
- 完整的审计能力
- 可扩展性好
- 投入成本高

### 协作应用 (Google Docs 类)
✅ **CRDT (Yjs/Automerge)**
- 实时协作
- 离线优先

### 金融/支付
✅ **Event Sourcing + Distributed Transaction**
- 强一致性
- 完整审计
- 监管合规

### 微服务架构
✅ **Saga Pattern + Event-Driven**
- 服务解耦
- 最终一致性

---

**对于 PuppyFlow 当前阶段**：建议保持 **Optimistic Locking + State Channel**，在 Phase 4 时考虑引入轻量级的 **Event Log** 用于调试和审计。


