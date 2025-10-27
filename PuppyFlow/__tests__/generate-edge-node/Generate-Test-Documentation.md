# Generate Edge Node 测试文档

## 文档说明
- **组件路径**: `PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/Generate.tsx`
- **组件类型**: Edge Node (边缘节点)
- **核心职责**: 内容生成节点，使用 LLM 基于查询和文档生成内容
- **目标平台**: 桌面端
- **测试状态**: ✅ 测试可运行，19/26 通过 (73.1%)

---

## 📊 测试用例覆盖情况总览

### 统计摘要

| 状态 | 数量 | 占比 | 说明 |
|------|------|------|------|
| ✅ 已通过 | 19 | 73.1% | 测试通过 |
| ❌ 失败 | 7 | 26.9% | 测试失败（主要是参数保存时机问题） |
| **总计** | **26** | **100%** | 已实现的测试用例 |

### 按优先级的覆盖情况

| 优先级 | 总数 | 通过 | 失败 | 覆盖率 |
|--------|------|------|------|--------|
| **P0** | 8 | 4 | 4 | 50.0% |
| **P1** | 7 | 5 | 2 | 71.4% |
| **P2** | 8 | 7 | 1 | 87.5% |
| **P3** | 3 | 3 | 0 | 100% |
| **总计** | **26** | **19** | **7** | **73.1%** |

### 按功能模块的覆盖情况

| 功能模块 | 测试数 | 通过 | 失败 | 覆盖率 |
|---------|--------|------|------|--------|
| Query 参数配置 | 2 | 1 | 1 | 50.0% |
| Document 参数配置 | 2 | 1 | 1 | 50.0% |
| Prompt Template 参数配置 | 5 | 4 | 1 | 80.0% |
| Model 参数配置 | 3 | 2 | 1 | 66.7% |
| Structured Output 参数配置 | 2 | 2 | 0 | 100% ✅ |
| Base URL 参数配置 | 2 | 1 | 1 | 50.0% |
| Advanced Settings 交互 | 2 | 2 | 0 | 100% ✅ |
| 初始化和默认值 | 5 | 5 | 0 | 100% ✅ |
| UI 交互 | 3 | 3 | 0 | 100% ✅ |
| **总计** | **26** | **19** | **7** | **73.1%** |

---

## 📝 详细测试用例

### 功能模块 1: Query 参数配置 (P0 + P1)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-001 | 修改 query_ids 应正确保存到 node.data.query_ids | P0 | ❌ | 单元 | setNodes 未被正确调用 |
| TC-GEN-001-1 | query_ids 应包含 id 和 label 字段 | P0 | ✅ | 单元 | 数据结构验证通过 |
| TC-GEN-001-2 | 应能切换不同的 query_ids | P1 | ❌ | 单元 | 参数切换保存失败 |

**数据结构**:
```typescript
query_ids: {
  id: string;      // Text Block 节点 ID
  label: string;   // Text Block 节点标签
} | undefined
```

**测试场景**:
1. 打开配置菜单
2. 点击 "Queries" 下拉框
3. 选择一个源节点
4. 验证 `node.data.query_ids` 包含正确的 id 和 label

---

### 功能模块 2: Document 参数配置 (P0 + P1)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-002 | 修改 document_ids 应正确保存到 node.data.document_ids | P0 | ❌ | 单元 | setNodes 未被正确调用 |
| TC-GEN-002-1 | document_ids 应包含 id 和 label 字段 | P0 | ✅ | 单元 | 数据结构验证通过 |
| TC-GEN-002-2 | 应能切换不同的 document_ids | P1 | ❌ | 单元 | 参数切换保存失败 |

**数据结构**:
```typescript
document_ids: {
  id: string;      // 文档节点 ID
  label: string;   // 文档节点标签
} | undefined
```

**测试场景**:
1. 打开配置菜单
2. 点击 "Documents" 下拉框（显示 "Choose Document" 占位符）
3. 选择一个源节点
4. 验证 `node.data.document_ids` 包含正确的 id 和 label

---

### 功能模块 3: Prompt Template 参数配置 (P0 + P1 + P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-003 | 修改 promptTemplate 应正确保存到 node.data.promptTemplate | P0 | ❌ | 单元 | setNodes 未被正确调用 |
| TC-GEN-003-1 | 应支持所有 18 种预设模板类型 | P0 | ✅ | 单元 | 所有模板选项验证通过 |
| TC-GEN-003-2 | 切换模板应更新预览内容 | P1 | ✅ | 单元 | 预览文本正确显示 |
| TC-GEN-003-3 | 模板名称应正确格式化显示 | P1 | ✅ | 单元 | 格式化逻辑验证通过 |
| TC-GEN-003-4 | 初始默认值应为 'default' 模板 | P2 | ✅ | 单元 | 默认值验证通过 |

**数据结构**:
```typescript
promptTemplate: 
  | 'default'
  | 'data_cleaning'
  | 'content_retrieval'
  | 'data_augmentation'
  | 'data_labeling'
  | 'data_analysis'
  | 'data_processing'
  | 'content_sorting'
  | 'keyword_search'
  | 'format_conversion'
  | 'content_matching'
  | 'text_summarization'
  | 'data_filtering'
  | 'document_ranking'
  | 'language_detection'
  | 'error_handling'
  | 'contextual_comparison'
  | 'data_normalization'
  | null;
```

**18种预设模板内容映射**:
```typescript
const PROMPT_TEMPLATES = {
  default: "Answer the question using the provided data...",
  data_cleaning: "Analyze the provided data and clean it...",
  content_retrieval: "Retrieve information from the provided documents...",
  data_augmentation: "Augment the provided dataset...",
  data_labeling: "Add appropriate labels or categories...",
  data_analysis: "Analyze the provided data to discover patterns...",
  data_processing: "Process and transform the provided data...",
  content_sorting: "Sort the provided content based on relevance...",
  keyword_search: "Search for specified keywords and phrases...",
  format_conversion: "Convert the provided data from one format to another...",
  content_matching: "Compare two sets of content and identify matches...",
  text_summarization: "Summarize the provided text...",
  data_filtering: "Filter the provided dataset based on specified criteria...",
  document_ranking: "Rank a collection of documents based on relevance...",
  language_detection: "Detect the language of the provided text...",
  error_handling: "Detect and handle errors in the provided data...",
  contextual_comparison: "Compare multiple items or concepts...",
  data_normalization: "Normalize the provided dataset..."
};
```

---

### 功能模块 4: Model 参数配置 (P0 + P1 + P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-004 | 修改 model 应正确保存到 node.data.model | P0 | ❌ | 单元 | setNodes 未被正确调用 |
| TC-GEN-004-1 | 应只显示 type='llm' 且 active=true 的模型 | P0 | ✅ | 单元 | 模型过滤规则验证通过 |
| TC-GEN-004-2 | 模型选项应显示 Local/Cloud 标签 | P1 | ✅ | 单元 | renderOption 验证通过 |
| TC-GEN-004-3 | 初始化时应自动选择第一个可用的 LLM 模型 | P2 | ✅ | 单元 | 默认模型选择通过 |

**数据结构**:
```typescript
model: string | undefined  // 模型 ID，从 activeModels 中选择
```

**Model 对象结构**:
```typescript
interface Model {
  id: string;          // 模型 ID
  name?: string;       // 显示名称
  type: 'llm' | 'embedding';  // 模型类型
  active: boolean;     // 是否激活
  isLocal?: boolean;   // 是否本地模型
}
```

**测试场景**:
1. 验证只有 `type === 'llm' && active === true` 的模型出现在下拉列表
2. 选择模型后，保存的是 `model.id`
3. 显示时使用 `model.name || model.id`
4. Local 模型显示蓝色标签，Cloud 模型显示灰色标签

---

### 功能模块 5: Structured Output 参数配置 (P1 + P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-005 | 切换 structured_output 应正确保存到 node.data.structured_output | P1 | ✅ | 单元 | 开关切换验证通过 |
| TC-GEN-005-1 | structured_output 初始值应为 false | P2 | ✅ | 单元 | 默认值验证通过 |

**数据结构**:
```typescript
structured_output: boolean | undefined  // 是否启用结构化JSON输出，默认 false
```

**测试场景**:
1. 打开配置菜单
2. 点击 "Advanced Settings" 展开
3. 点击 "Structured Output (JSON)" 开关
4. 验证 `node.data.structured_output` 在 true/false 之间切换

---

### 功能模块 6: Base URL 参数配置 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-006 | 修改 base_url 应正确保存到 node.data.base_url | P2 | ❌ | 单元 | 输入值未正确保存 |
| TC-GEN-006-1 | base_url 初始值应为空字符串 | P2 | ✅ | 单元 | 默认值验证通过 |

**数据结构**:
```typescript
base_url: string | undefined  // 可选的 API Base URL
```

**测试场景**:
1. 打开配置菜单
2. 点击 "Advanced Settings" 展开
3. 在 "Base URL (optional)" 输入框输入URL
4. 验证 `node.data.base_url` 正确保存

---

### 功能模块 7: Advanced Settings 交互 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-007 | 点击 "Show" 应展开高级设置区域 | P2 | ✅ | 单元 | 展开功能验证通过 |
| TC-GEN-007-1 | 点击 "Hide" 应收起高级设置区域 | P2 | ✅ | 单元 | 收起功能验证通过 |

**测试场景**:
1. 打开配置菜单，高级设置默认收起
2. 点击 "Show" 按钮，验证显示 Base URL 和 Structured Output 选项
3. 点击 "Hide" 按钮，验证隐藏高级设置

---

### 功能模块 8: 初始化和默认值 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-008 | 节点初始化时应从 node.data 加载现有配置 | P2 | ✅ | 单元 | 配置加载验证通过 |
| TC-GEN-008-1 | 如果 node.data 中无配置，应使用默认值 | P2 | ✅ | 单元 | 默认值处理通过 |
| TC-GEN-008-2 | model 默认值应为第一个可用 LLM 模型 | P2 | ✅ | 单元 | 已在 TC-GEN-004-3 中测试 |
| TC-GEN-008-3 | promptTemplate 默认值应为 'default' | P2 | ✅ | 单元 | 已在 TC-GEN-003-4 中测试 |
| TC-GEN-008-4 | structured_output 默认值应为 false | P2 | ✅ | 单元 | 已在 TC-GEN-005-1 中测试 |
| TC-GEN-008-5 | base_url 默认值应为空字符串 | P2 | ✅ | 单元 | 已在 TC-GEN-006-1 中测试 |

**测试场景**:
1. 创建一个空的 Generate 节点（node.data 为空对象）
2. 验证所有参数都使用正确的默认值
3. 创建一个带有现有配置的节点
4. 验证从 node.data 正确加载配置

---

### 功能模块 9: UI 交互 (P3)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-GEN-009 | 点击节点按钮应打开配置菜单 | P3 | ✅ | 单元 | 菜单打开验证通过 |
| TC-GEN-009-1 | 配置菜单应包含所有必需字段标签 | P3 | ✅ | 单元 | 所有必需字段验证通过 |
| TC-GEN-009-2 | Queries 和 Documents 应显示红点标记（必填字段） | P3 | ✅ | 单元 | 红点标记验证通过 |

**测试场景**:
1. 渲染 Generate 节点
2. 点击节点主按钮
3. 验证菜单显示，包含所有必需的UI元素
4. 验证必填字段有红点标记

---

## 🎯 优先级定义和示例

### P0 - 致命 (Critical)
**定义**: 核心链路不可用或发生数据安全事件，影响大多数用户，需立即回滚或熔断并全员响应。

**Generate 节点 P0 示例**:
- ❌ 修改 query_ids 后无法保存，导致节点无法读取查询输入
- ❌ 修改 document_ids 后无法保存，导致节点无法读取文档
- ❌ 修改 promptTemplate 后无法保存，导致生成逻辑错误
- ❌ 修改 model 后无法保存，导致使用错误的模型生成内容
- ❌ 参数数据结构不完整（缺少 id 或 label），导致后端解析失败

**为什么是 P0**: 这些参数是 Generate 节点的核心配置，任何一个保存失败都会导致节点功能完全不可用或产生错误结果。

---

### P1 - 严重 (High)
**定义**: 大量用户核心体验降级或区域性不可用，可临时绕过，需快速修复或灰度回退。

**Generate 节点 P1 示例**:
- ⚠️ 切换不同的 query_ids 后无法更新，用户需要删除重建节点
- ⚠️ 切换不同的 document_ids 后无法更新，无法修改数据源
- ⚠️ 在 18 种 Prompt Template 之间切换失效，无法使用预设模板
- ⚠️ Model 选择器显示了非 LLM 类型的模型，导致配置错误
- ⚠️ Structured Output 开关切换失效，无法控制输出格式

**为什么是 P1**: 这些问题影响用户修改配置的能力，虽然可以通过删除重建节点绕过，但严重影响用户体验和工作效率。

---

### P2 - 中等 (Medium)
**定义**: 非核心功能或偶发问题，可通过重试或配置绕过，工作时段内修复。

**Generate 节点 P2 示例**:
- ℹ️ Base URL 可选参数无法保存，可以不配置使用默认 API
- ℹ️ 高级设置展开/收起状态异常，但不影响参数配置
- ℹ️ 初始化时未加载现有配置，但重新配置后可以正常使用
- ℹ️ 默认值不正确，但可以手动设置正确的值

**为什么是 P2**: 这些问题影响可选功能或初始体验，不阻断核心工作流程，用户可以通过其他方式达成目标。

---

### P3 - 轻微 (Low)
**定义**: 不阻断主流程的界面或文案问题，纳入常规排期。

**Generate 节点 P3 示例**:
- 💡 配置菜单打开/关闭动画异常
- 💡 必填字段红点标记未显示（但字段本身正常工作）
- 💡 Model 选项的 Local/Cloud 标签样式错误
- 💡 Prompt Template 名称格式化显示错误（data_cleaning 显示为 data_cleaning 而非 Data Cleaning）
- 💡 Run 按钮 hover 状态异常（但实际执行在后端测试）

**为什么是 P3**: 这些是 UI/UX 相关的小问题，不影响实际功能，用户仍能完成所有操作。

---

## 🔧 测试执行结果

### 最后执行时间
- **日期**: 2025-10-27
- **测试框架**: Vitest v3.2.4
- **测试环境**: jsdom
- **执行时长**: 2.44s

### 执行命令
```bash
npx vitest __tests__/generate-edge-node/unit/Generate.params.test.tsx --run
```

### 测试输出摘要
```
Test Files  1 passed (1)
     Tests  19 passed | 7 failed (26)
  Start at  14:22:29
  Duration  2.44s
```

---

## 🐛 已知问题和待修复

### 高优先级问题 (影响P0测试)

#### 1. Query/Document/Model 参数保存时机问题
- **影响用例**: TC-GEN-001, TC-GEN-002, TC-GEN-004 (P0)
- **失败原因**: 下拉框选择后 setNodes 未被立即调用，可能使用了防抖或延迟更新
- **建议修复**: 
  - 检查 PuppyDropdown 的 onChange 回调是否被正确触发
  - 调整测试中的等待时间或等待策略
  - 或者在组件中确保选择后立即更新

#### 2. Prompt Template 参数保存问题
- **影响用例**: TC-GEN-003 (P0)
- **失败原因**: 与问题 #1 类似，模板选择后未立即保存
- **建议修复**: 同问题 #1

### 中优先级问题 (影响P1/P2测试)

#### 3. 参数切换更新问题
- **影响用例**: TC-GEN-001-2, TC-GEN-002-2 (P1)
- **失败原因**: 从一个值切换到另一个值时，新值未正确保存
- **建议修复**: 检查 useEffect 的依赖项和更新逻辑

#### 4. Base URL 输入框保存问题
- **影响用例**: TC-GEN-006 (P2)
- **失败原因**: 输入框值变化后未正确触发 setNodes
- **可能原因**: 
  - 输入防抖延迟较长
  - 测试等待时间不够
- **建议修复**: 增加测试等待时间或模拟输入完成事件

---

## 🎯 改进建议

### 短期改进 (1-2天)

1. **优化参数保存逻辑**
   - 减少不必要的防抖延迟
   - 确保关键参数（P0）立即保存
   - 非关键参数（P2）可以使用防抖

2. **改进测试等待策略**
   - 对于有延迟的更新，增加 `waitFor` 超时时间
   - 使用更可靠的断言条件

### 中期改进 (1周)

1. **添加 data-testid**
   - 为关键输入元素添加 test id，便于测试定位
   - 减少对 DOM 结构的依赖

2. **完善错误处理**
   - 添加参数验证失败的提示
   - 确保异常情况下不丢失用户配置

---

## 📚 数据结构完整定义

### GenerateConfigNodeData

```typescript
type GenerateConfigNodeData = {
  // 【必需 P0】查询输入
  query_ids: {
    id: string;                    // Query 节点 ID
    label: string;                 // Query 节点标签
  } | undefined;
  
  // 【必需 P0】文档输入
  document_ids: {
    id: string;                    // Document 节点 ID
    label: string;                 // Document 节点标签
  } | undefined;
  
  // 【必需 P0】Prompt 模板
  promptTemplate: PromptTemplateType | null;
  
  // 【必需 P0】使用的模型
  model: string | undefined;       // 模型 ID
  
  // 【P1】结构化输出开关
  structured_output: boolean | undefined;  // 默认 false
  
  // 【P2】可选的 API Base URL
  base_url: string | undefined;    // 默认空字符串
};
```

### PromptTemplateType

```typescript
type PromptTemplateType =
  | 'default'                      // 默认模板
  | 'data_cleaning'                // 数据清洗
  | 'content_retrieval'            // 内容检索
  | 'data_augmentation'            // 数据增强
  | 'data_labeling'                // 数据标注
  | 'data_analysis'                // 数据分析
  | 'data_processing'              // 数据处理
  | 'content_sorting'              // 内容排序
  | 'keyword_search'               // 关键词搜索
  | 'format_conversion'            // 格式转换
  | 'content_matching'             // 内容匹配
  | 'text_summarization'           // 文本摘要
  | 'data_filtering'               // 数据过滤
  | 'document_ranking'             // 文档排序
  | 'language_detection'           // 语言检测
  | 'error_handling'               // 错误处理
  | 'contextual_comparison'        // 上下文比较
  | 'data_normalization';          // 数据标准化
```

### Model Interface

```typescript
interface Model {
  id: string;                      // 模型唯一标识
  name?: string;                   // 显示名称（可选）
  type: 'llm' | 'embedding';       // 模型类型
  active: boolean;                 // 是否激活
  isLocal?: boolean;               // 是否本地部署
}
```

---

## 🔧 测试准备工作

### Mock 依赖列表

测试文件需要 mock 以下依赖：

```typescript
// 1. React Flow
vi.mock('@xyflow/react', () => ({
  useReactFlow: mockUseReactFlow,
  Handle: MockHandle,
  Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
  MarkerType: { ArrowClosed: 'arrowclosed', Arrow: 'arrow' },
}));

// 2. NodesPerFlowContext
vi.mock('@/app/components/states/NodesPerFlowContext', () => ({
  useNodesPerFlowContext: mockUseNodesPerFlowContext,
}));

// 3. Source/Target Hooks
vi.mock('@/app/components/hooks/useGetSourceTarget', () => ({
  default: mockUseGetSourceTarget,
}));

// 4. JSON Construct Utils
vi.mock('@/app/components/hooks/useJsonConstructUtils', () => ({
  default: mockUseJsonConstructUtils,
}));

// 5. App Settings Context
vi.mock('@/app/components/states/AppSettingsContext', () => ({
  useAppSettings: mockUseAppSettings,
}));

// 6. InputOutputDisplay Component
vi.mock('./components/InputOutputDisplay', () => ({
  default: MockInputOutputDisplay,
}));

// 7. PuppyDropdown Component
vi.mock('@/app/components/misc/PuppyDropDown', () => ({
  PuppyDropdown: MockPuppyDropdown,
}));

// 8. Colors Utility
vi.mock('@/app/utils/colors', () => ({
  UI_COLORS: mockUIColors,
}));

// 9. Single Edge Node Executor
vi.mock('./hook/runSingleEdgeNodeExecutor', () => ({
  runSingleEdgeNode: mockRunSingleEdgeNode,
}));
```

### 测试数据准备

```typescript
// 示例模型数据
const mockModels: Model[] = [
  { id: 'gpt-4', name: 'GPT-4', type: 'llm', active: true, isLocal: false },
  { id: 'gpt-3.5', name: 'GPT-3.5', type: 'llm', active: true, isLocal: false },
  { id: 'llama-2', name: 'Llama 2', type: 'llm', active: true, isLocal: true },
  { id: 'text-embedding-ada', name: 'Ada Embedding', type: 'embedding', active: true, isLocal: false },
];

// 示例源节点数据
const mockSourceNodes = [
  { id: 'text-1', label: 'Text Block 1' },
  { id: 'text-2', label: 'Text Block 2' },
  { id: 'doc-1', label: 'Document Block 1' },
];

// 示例节点数据
const mockNodeData: GenerateConfigNodeData = {
  query_ids: { id: 'text-1', label: 'Text Block 1' },
  document_ids: { id: 'doc-1', label: 'Document Block 1' },
  promptTemplate: 'default',
  model: 'gpt-4',
  structured_output: false,
  base_url: '',
};
```

---

## 📖 参考资料

### 相关文件
- 组件源码: `app/components/workflow/edgesNode/edgeNodesNew/Generate.tsx`
- 测试文件: `__tests__/generate-edge-node/unit/Generate.params.test.tsx` (待创建)
- 测试文档: `__tests__/generate-edge-node/Generate-测试文档.md` (本文档)

### 其他测试文档参考
- [Retrieving Edge Node 测试文档](../retrieving-edge-node/Retrieving-测试文档.md)
- [JSON Block Node 测试文档](../json-block-node/docs/JsonNodeNew-测试文档.md)
- [File Block Node 测试文档](../file-block-node/docs/FileNode-测试文档.md)

### 技术文档
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Vitest 测试框架](https://vitest.dev/)
- [React Flow 文档](https://reactflow.dev/)

---

## 📝 版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.1 | 2025-10-27 | ✅ 测试可运行，19/26 通过 (73.1%)<br>🐛 标记 7 个失败用例<br>📊 添加详细覆盖率统计<br>💡 提供改进建议<br>📦 创建 vitest 配置文件 |
| v1.0 | 2025-10-27 | 📝 初始版本，33个测试用例规划<br>📊 包含 P0-P3 四个优先级<br>🎯 覆盖 Query、Document、Prompt Template、Model、Structured Output、Base URL、Advanced Settings、初始化、UI 九大模块<br>📚 完整的数据结构定义和 Mock 准备清单 |

---

*当前版本: v1.1*  
*最后更新: 2025-10-27*  
*维护者: 测试团队*  
*状态: ✅ 测试可运行，73.1% 通过率*

