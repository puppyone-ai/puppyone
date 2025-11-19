# Template to Runtime Fitting Logic (面向小白)

> **目标读者**: 不熟悉系统架构的开发者  
> **问题**: types.ts 的 template 如何 fit 到 AppSettingsContext 上用于渲染？

---

## 🎯 核心问题

Template是**静态的配置文件**（存储在Git中），AppSettingsContext是**运行时的状态管理**（在浏览器中）。

**问题**：这两个东西怎么连接起来？

---

## 📦 数据流全景图

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: 静态世界 (Git Repo)                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📄 types.ts (类型定义)                                          │
│     ↓                                                           │
│  📦 template/agentic-rag/package.json (静态数据)                 │
│     {                                                           │
│       "metadata": { "id": "agentic-rag", ... },                │
│       "resources": [{                                           │
│         "type": "vector_collection",                           │
│         "target": {                                             │
│           "embedding_model": {                                  │
│             "model_id": "text-embedding-ada-002",  ← 静态配置   │
│             "provider": "OpenAI"                                │
│           }                                                     │
│         }                                                       │
│       }]                                                        │
│     }                                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                    用户点击"使用模板"
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: 实例化过程 (Server-side)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🔄 CloudTemplateLoader.instantiateTemplate()                   │
│     ↓                                                           │
│  1. 读取 template package.json                                  │
│  2. 获取用户可用的模型 (from AppSettings)  ← Fitting开始        │
│  3. 模型兼容性检查                                               │
│  4. 创建 workspace JSON                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                    Workspace创建完成
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: 运行时世界 (Browser)                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⚛️ AppSettingsContext (运行时状态)                             │
│     {                                                           │
│       availableModels: [                                        │
│         {                                                       │
│           id: "text-embedding-ada-002",  ← 用户实际拥有的模型   │
│           provider: "OpenAI",                                   │
│           type: "embedding",                                    │
│           active: true                                          │
│         },                                                      │
│         { id: "gpt-5", type: "llm", ... }                      │
│       ]                                                         │
│     }                                                           │
│     ↓                                                           │
│  🎨 UI组件渲染                                                   │
│     - 显示workspace                                             │
│     - 显示索引状态 (completed/pending)                           │
│     - 如果pending，显示"建立索引"按钮                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Fitting 的三个关键时刻

### 时刻1️⃣: 用户选择模板 (Frontend)

**位置**: `BlankWorkspace.tsx` 或 `CreateWorkspaceModal.tsx`

```typescript
// 用户点击"使用 Agentic RAG 模板"
function handleCreateFromTemplate(templateId: string) {
  const appSettings = useAppSettings(); // ← 获取运行时状态
  
  // 🔄 Fitting Point 1: 传递可用模型信息
  fetch('/api/workspace/instantiate', {
    method: 'POST',
    body: JSON.stringify({
      templateId: 'agentic-rag',
      workspaceName: '我的RAG工作流',
      availableModels: appSettings.availableModels, // ← 传递给后端
    })
  });
}
```

**说明**：
- 从 AppSettingsContext 获取用户当前可用的模型列表
- 这些模型是**动态的**（取决于用户是否安装了Ollama、是否有OpenAI key等）
- 通过API请求传递给后端

---

### 时刻2️⃣: 后端实例化 (Server-side)

**位置**: `/api/workspace/instantiate/route.ts` (Phase 2将创建)

```typescript
export async function POST(request: Request) {
  // 1. 获取请求参数
  const { templateId, workspaceName, availableModels } = await request.json();
  
  // 2. 加载静态模板
  const loader = new CloudTemplateLoader();
  const templatePackage = await loader.loadTemplate(templateId);
  // templatePackage 来自 types.ts 定义的结构
  
  // 🔄 Fitting Point 2: 匹配模板要求与用户模型
  const templateRequires = templatePackage.resources.resources[0].target.embedding_model;
  // {
  //   model_id: "text-embedding-ada-002",  ← Template说"我需要这个"
  //   provider: "OpenAI"
  // }
  
  const userHas = availableModels;
  // [
  //   { id: "text-embedding-ada-002", provider: "OpenAI", type: "embedding" }
  //   ← User说"我有这个"
  // ]
  
  // 3. 兼容性检查
  const compatibility = ModelCompatibilityService.checkCompatibility(
    templateRequires,  // ← 来自 types.ts
    userHas            // ← 来自 AppSettingsContext
  );
  
  // 4. 根据兼容性结果决定行为
  if (compatibility.action === 'auto_rebuild') {
    // ✅ 自动构建索引
    await VectorAutoRebuildService.attemptAutoRebuild({
      resourceDescriptor: resource,
      content: resourceContent,
      availableModels: userHas,  // ← 使用用户的模型
      userId,
      workspaceId,
    });
  } else {
    // ⚠️ 保持pending状态
    setIndexStatus('pending');
  }
  
  // 5. 创建workspace
  const workspaceContent = { /* 包含索引状态 */ };
  await workspaceStore.create(userId, workspaceId, workspaceContent);
  
  return { success: true, workspace_id: workspaceId };
}
```

**说明**：
- **静态模板**（types.ts）说："我需要这个模型"
- **运行时状态**（AppSettings）说："用户有这些模型"
- **Fitting逻辑**：检查两者是否匹配，决定是否自动构建索引

---

### 时刻3️⃣: UI渲染 (Frontend)

**位置**: Workspace UI 组件

```typescript
// 用户打开刚创建的workspace
function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const appSettings = useAppSettings(); // ← 再次获取运行时状态
  const workspace = useWorkspace(workspaceId);
  
  // 检查vector索引状态
  const indexStatus = workspace.blocks.find(b => b.type === 'vector')
    ?.data.indexingList[0]?.status;
  
  // 🔄 Fitting Point 3: 根据状态渲染UI
  if (indexStatus === 'completed') {
    return <div>✅ 索引已就绪，可以使用</div>;
  } else if (indexStatus === 'pending') {
    // 显示"建立索引"按钮
    return (
      <button onClick={() => {
        // 使用 AppSettings 中的模型
        const embeddingModel = appSettings.availableModels.find(
          m => m.type === 'embedding'
        );
        buildIndex(workspaceId, embeddingModel);
      }}>
        建立索引
      </button>
    );
  }
  
  return <div>加载中...</div>;
}
```

**说明**：
- Workspace已创建，包含索引状态（completed/pending）
- UI根据状态决定显示什么
- 如果需要手动建立索引，再次从AppSettings获取可用模型

---

## 🎨 Fitting 逻辑详解（核心）

### 什么是 "Fitting"？

**Fitting = 适配 = 把静态模板的要求映射到用户实际拥有的资源上**

### Fitting 的三个层面

#### 层面1: 数据结构适配

```typescript
// Template (types.ts)
interface TemplateModel {
  model_id: string;     // ← 字段名
  provider: string;
}

// Runtime (AppSettingsContext)
interface RuntimeModel {
  id: string;           // ← 不同的字段名！
  provider?: string;    // ← 可选的！
}

// 🔄 Fitting: 字段映射
function mapTemplateToRuntime(template: TemplateModel, runtime: RuntimeModel) {
  return {
    match: template.model_id === runtime.id,  // ← model_id → id
    providerMatch: template.provider === (runtime.provider || 'Unknown')
  };
}
```

#### 层面2: 语义适配

```typescript
// Template说："我需要 OpenAI 的 embedding 模型"
const templateNeeds = {
  provider: "OpenAI",
  type: "embedding"  // ← 隐含的要求
};

// User有："GPT-5 (LLM) + Ada-002 (Embedding)"
const userHas = [
  { id: "gpt-5", provider: "OpenAI", type: "llm" },        // ← 不符合
  { id: "ada-002", provider: "OpenAI", type: "embedding" } // ← 符合！
];

// 🔄 Fitting: 语义过滤
const suitableModels = userHas.filter(m => 
  m.type === 'embedding' &&  // ← 必须是embedding类型
  m.provider === templateNeeds.provider
);
```

#### 层面3: 行为适配

```typescript
// Template说："如果模型不匹配，fallback_strategy = 'auto'"
const templateStrategy = {
  embedding_model: {
    model_id: "ada-002",
    fallback_strategy: "auto"
  }
};

// User实际情况："只有Ollama模型，没有OpenAI"
const userHas = [
  { id: "ollama/all-minilm", provider: "Ollama", type: "embedding" }
];

// 🔄 Fitting: 行为决策
if (templateStrategy.fallback_strategy === 'auto') {
  // 使用用户的模型（Ollama），而不是template要求的（OpenAI）
  useModel(userHas[0]); // ← 自动适配
} else {
  // 提示用户手动选择
  showManualSelection();
}
```

---

## 📋 Fitting 的完整检查表

### 检查点1: 字段映射

| Template字段 | Runtime字段 | Fitting规则 |
|-------------|------------|-----------|
| `embedding_model.model_id` | `Model.id` | 直接对应 |
| `embedding_model.provider` | `Model.provider` | 对应，但runtime可能为undefined |
| N/A | `Model.type` | 必须过滤出 `type === 'embedding'` |
| N/A | `Model.active` | 必须过滤出 `active !== false` |

### 检查点2: 兼容性级别

| 场景 | Template | User | Fitting结果 |
|------|----------|------|-----------|
| **完美匹配** | ada-002, OpenAI | ada-002, OpenAI | ✅ Auto rebuild |
| **同provider** | ada-002, OpenAI | 3-small, OpenAI | ⚠️ Rebuild with warning |
| **不同provider** | ada-002, OpenAI | all-minilm, Ollama | 🔄 Rebuild with user's model |
| **无embedding** | 需要embedding | 只有LLM | ❌ Skip, stay pending |

### 检查点3: 数据传递路径

```
Frontend (AppSettings)
  ↓ availableModels
API Request
  ↓ JSON body
Backend (instantiate route)
  ↓ parameter
CloudTemplateLoader
  ↓ compatibility check
ModelCompatibilityService
  ↓ fitting logic
VectorAutoRebuildService
  ↓ use selected model
Workspace created
  ↓ status: completed/pending
Frontend (UI)
  ↓ render based on status
User sees result
```

---

## 🔧 Fitting 实现示例

### 示例代码：完整的Fitting流程

```typescript
// ============================================
// Step 1: Frontend - 收集运行时状态
// ============================================
// File: BlankWorkspace.tsx
import { useAppSettings } from '@/app/components/states/AppSettingsContext';

function CreateWorkspaceButton() {
  const appSettings = useAppSettings();
  
  async function createFromTemplate() {
    // 📤 发送：Template ID + Runtime状态
    const response = await fetch('/api/workspace/instantiate', {
      method: 'POST',
      body: JSON.stringify({
        templateId: 'agentic-rag',
        workspaceName: '新工作流',
        availableModels: appSettings.availableModels, // ← Runtime状态
      })
    });
  }
}

// ============================================
// Step 2: Backend - Fitting逻辑
// ============================================
// File: /api/workspace/instantiate/route.ts
export async function POST(request: Request) {
  const { templateId, workspaceName, availableModels } = await request.json();
  
  // 📥 加载静态Template
  const loader = new CloudTemplateLoader();
  const pkg = await loader.loadTemplate(templateId);
  // pkg 的类型来自 types.ts
  
  // 🔄 Fitting: 匹配静态要求与动态资源
  for (const resource of pkg.resources.resources) {
    if (resource.type === 'vector_collection') {
      const templateModel = resource.target.embedding_model;
      // 来自 types.ts: { model_id: "ada-002", provider: "OpenAI" }
      
      const compatibility = ModelCompatibilityService.checkCompatibility(
        templateModel,     // ← Static (types.ts)
        availableModels    // ← Dynamic (AppSettings)
      );
      
      // 🎯 根据Fitting结果决定行为
      if (compatibility.compatible) {
        // ✅ Fit成功，使用匹配的模型
        await autoRebuild(compatibility.suggestedModel);
      } else {
        // ❌ Fit失败，保持pending
        setStatus('pending');
      }
    }
  }
}

// ============================================
// Step 3: Fitting Service - 核心逻辑
// ============================================
// File: model-compatibility.ts
export class ModelCompatibilityService {
  static checkCompatibility(
    templateModel: TemplateEmbeddingModel,  // ← From types.ts
    runtimeModels: Model[]                   // ← From AppSettings
  ): CompatibilityResult {
    
    // 🔍 Step 1: 过滤出embedding模型
    const embeddingModels = runtimeModels.filter(m => 
      m.type === 'embedding' && m.active !== false
    );
    
    if (embeddingModels.length === 0) {
      return { compatible: false, action: 'skip' };
    }
    
    // 🔍 Step 2: 精确匹配
    const exactMatch = embeddingModels.find(m =>
      m.id === templateModel?.model_id  // ← 字段映射：model_id → id
    );
    
    if (exactMatch) {
      return {
        compatible: true,
        confidence: 'high',
        suggestedModel: exactMatch,
        action: 'auto_rebuild'
      };
    }
    
    // 🔍 Step 3: Provider匹配
    const providerMatch = embeddingModels.find(m =>
      m.provider === templateModel?.provider
    );
    
    if (providerMatch) {
      return {
        compatible: true,
        confidence: 'medium',
        suggestedModel: providerMatch,
        action: 'warn_and_rebuild'
      };
    }
    
    // 🔍 Step 4: Fallback策略
    if (templateModel?.fallback_strategy === 'auto') {
      return {
        compatible: true,
        confidence: 'low',
        suggestedModel: embeddingModels[0], // 使用第一个可用模型
        action: 'auto_rebuild'
      };
    }
    
    return { compatible: false, action: 'manual_select' };
  }
}
```

---

## 🎓 小白总结

### 用最简单的话说

1. **Template (types.ts)** = 菜谱（说需要什么食材）
2. **AppSettings** = 冰箱（说你有什么食材）
3. **Fitting** = 检查冰箱里有没有菜谱要的食材

如果有 → 自动做菜（auto rebuild）  
如果没有但有替代品 → 用替代品做（fallback）  
如果完全没有 → 提示你去买（manual）

### 关键点记忆

- **静态 vs 动态**: Template是静态的（Git文件），AppSettings是动态的（用户实际情况）
- **单向流动**: Template → Fitting → Workspace，不会反向修改Template
- **三个时刻**: 
  1. 选择模板时（收集AppSettings）
  2. 实例化时（Fitting逻辑）
  3. 渲染时（显示结果）

### 为什么需要Fitting？

因为：
- ❌ 不能假设所有用户都有相同的模型
- ❌ 不能把Template写死为某个特定模型
- ✅ 需要智能适配：用户有什么，就用什么

---

## 📚 相关文档

- [Template Contract Architecture](../architecture/template-resource-contract.md)
- [Phase 1.9 Auto-Rebuild Design](./phase1.9-auto-rebuild.md)
- [Model Compatibility Service Design](./phase1.9-auto-rebuild.md#task-2-model-compatibility-service)

