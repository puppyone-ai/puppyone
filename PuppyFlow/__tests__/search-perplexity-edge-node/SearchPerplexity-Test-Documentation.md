# SearchPerplexity Edge Node 测试文档

## 文档说明
- **组件路径**: `PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/SearchPerplexity.tsx`
- **组件类型**: Edge Node (边缘节点)
- **核心职责**: Perplexity 搜索节点，使用 Perplexity API 进行在线搜索
- **目标平台**: 桌面端
- **测试状态**: ✅ 测试可运行，10/16 通过 (62.5%)

---

## 📊 测试用例覆盖情况总览

### 统计摘要

| 状态 | 数量 | 占比 | 说明 |
|------|------|------|------|
| ✅ 已通过 | 10 | 62.5% | 测试通过 |
| ❌ 失败 | 6 | 37.5% | 测试失败（主要是模型切换和初始化问题） |
| **总计** | **16** | **100%** | 已实现的测试用例 |

### 按优先级的覆盖情况

| 优先级 | 总数 | 通过 | 失败 | 覆盖率 |
|--------|------|------|------|--------|
| **P0** | 5 | 4 | 1 | 80.0% |
| **P1** | 3 | 0 | 3 | 0.0% |
| **P2** | 8 | 6 | 2 | 75.0% |
| **总计** | **16** | **10** | **6** | **62.5%** |

### 按功能模块的覆盖情况

| 功能模块 | 测试数 | 通过 | 失败 | 覆盖率 |
|---------|--------|------|------|--------|
| Model 参数配置 | 8 | 4 | 4 | 50.0% ⚠️ |
| 初始化和默认值 | 6 | 4 | 2 | 66.7% |
| UI 交互和状态 | 2 | 2 | 0 | 100% ✅ |
| **总计** | **16** | **10** | **6** | **62.5%** |

---

## 📝 详细测试用例

### 功能模块 1: Model 参数配置 (P0 + P1)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-SP-001 | 修改 model 应正确保存到 node.data.extra_configs.model | P0 | ❌ | 单元 | 模型切换未生效 |
| TC-SP-001-1 | model 应保存在 extra_configs 对象中 | P0 | ✅ (2/2) | 单元 | 数据结构验证通过 |
| TC-SP-001-2 | model 应为有效的 Perplexity 模型名称 | P0 | ✅ (2/2) | 单元 | 类型验证通过 |
| TC-SP-002 | 应能切换到 'sonar' 模型 | P1 | ❌ | 单元 | 模型切换失败 |
| TC-SP-002-1 | 应能切换到 'sonar-pro' 模型 | P1 | ❌ | 单元 | 模型切换失败 |
| TC-SP-002-2 | 应能切换到 'sonar-reasoning-pro' 模型 | P1 | ❌ | 单元 | 模型切换失败 |

**数据结构**:
```typescript
extra_configs: {
  model: 'sonar' | 'sonar-pro' | 'sonar-reasoning-pro' | undefined;
  threshold: number | undefined;
}
```

**测试场景**:
1. 打开配置菜单
2. 点击 "Model" 下拉框
3. 选择不同的模型选项
4. 验证 `node.data.extra_configs.model` 正确保存
5. 测试所有 3 种模型的切换

**关键行号**: 73-77 (初始化), 540-550 (Model 下拉框), 188-213 (保存逻辑)

**可用模型**:
- `sonar`: 基础模型
- `sonar-pro`: 专业模型（默认）
- `sonar-reasoning-pro`: 推理专业模型

---

### 功能模块 2: 初始化和默认值 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-SP-003 | 节点初始化时 model 默认值应为 'sonar-pro' | P2 | ✅ (2/2) | 单元 | 默认值验证通过 |
| TC-SP-003-1 | 节点初始化时应从 node.data.extra_configs.model 加载现有配置 | P2 | ❌ (0/2) | 单元 | 配置加载失败，总是显示默认值 |
| TC-SP-004 | 组件挂载后验证 | P2 | ✅ (2/2) | 单元 | 组件挂载和渲染正常 |
| TC-SP-005 | Model 下拉框应显示所有 3 个模型选项 | P2 | ✅ (2/2) | 单元 | 选项列表验证通过 |

**测试场景**:
1. 创建一个空的 SearchPerplexity 节点（extra_configs 为空）
2. 验证 model 使用默认值 'sonar-pro'
3. 创建一个带有现有配置的节点（extra_configs.model = 'sonar'）
4. 验证从 node.data 正确加载配置值 'sonar'
5. 验证组件挂载后内部状态正确
6. 验证下拉框包含所有 3 个模型选项

**关键行号**: 73-77 (model 初始化), 183-185 (挂载 effect), 317-320 (modelOptions)

---

### 功能模块 3: UI 交互和状态 (P2 + P3)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-SP-006 | 点击节点按钮应打开配置菜单 | P3 | ⏳ | 单元 | 菜单打开 |
| TC-SP-006-1 | 再次点击应关闭配置菜单 | P3 | ⏳ | 单元 | 菜单关闭 |
| TC-SP-007 | 鼠标悬停节点时应显示 Run 按钮 | P2 | ⏳ | 单元 | Hover 状态 |

**测试场景**:
1. 渲染 SearchPerplexity 节点
2. 点击节点主按钮，验证菜单显示
3. 验证菜单包含必需的 UI 元素（Perplexity 图标、标题、Run 按钮、InputOutputDisplay、Model 下拉框）
4. 验证 Model 字段有红点标记（必填字段）
5. 再次点击，验证菜单关闭
6. 模拟鼠标悬停，验证 Run 按钮从 opacity-0 变为 opacity-100

**关键行号**: 229-247 (onClickButton), 340-368 (Run 按钮), 370-448 (主按钮)

---

## 🎯 优先级定义和示例

### P0 - 致命 (Critical)
**定义**: 核心链路不可用或发生数据安全事件，影响大多数用户，需立即回滚或熔断并全员响应。

**SearchPerplexity 节点 P0 示例**:
- ❌ 修改 model 后无法保存，导致节点无法正确选择搜索模型
- ❌ model 数据结构错误（未保存在 extra_configs 中），导致后端 API 调用失败
- ❌ model 类型错误（保存了不支持的模型名称），导致 API 返回 400 错误
- ❌ 节点无法正确触发搜索执行，导致功能完全不可用
- ❌ 参数保存时机错误，导致用户配置丢失

**为什么是 P0**: SearchPerplexity 节点的核心功能是使用指定的 Perplexity 模型进行搜索。model 参数是唯一的必填配置参数（有红点标记）。如果这个参数无法正确保存、数据结构错误或类型无效，会导致搜索请求失败，使节点功能完全不可用。

---

### P1 - 严重 (High)
**定义**: 大量用户核心体验降级或区域性不可用，可临时绕过，需快速修复或灰度回退。

**SearchPerplexity 节点 P1 示例**:
- ⚠️ 无法切换到特定模型（如 sonar-reasoning-pro），限制了用户的模型选择
- ⚠️ 模型切换后未正确更新，用户需要删除重建节点
- ⚠️ 某个模型选项无法选择，影响需要该模型的用户
- ⚠️ 参数修改后需要刷新页面才能生效，严重影响用户体验
- ⚠️ 模型下拉框无法展开，用户无法修改配置

**为什么是 P1**: 这些问题影响用户选择和切换模型的能力。虽然可以通过删除重建节点或使用默认模型绕过，但严重降低了用户体验和功能灵活性。特别是当用户需要使用特定模型（如推理模型）时，无法切换会直接影响搜索质量。

---

### P2 - 中等 (Medium)
**定义**: 非核心功能或偶发问题，可通过重试或配置绕过，工作时段内修复。

**SearchPerplexity 节点 P2 示例**:
- ℹ️ 初始化时未加载现有的 model 配置，但重新配置后可以正常使用
- ℹ️ 默认值不是 'sonar-pro'，但用户可以手动设置正确的模型
- ℹ️ 模型下拉框选项顺序错误，但不影响选择功能
- ℹ️ Run 按钮 hover 状态不显示，但可以通过菜单中的 Run 按钮执行
- ℹ️ 组件内部状态管理异常，但不影响最终功能
- ℹ️ 参数保存时机有轻微延迟，但最终能正确保存

**为什么是 P2**: 这些问题影响初始体验或可选的交互方式，不阻断核心工作流程。默认值不正确或初始化问题可以通过手动配置解决。用户仍能完成模型选择和搜索任务。

---

### P3 - 轻微 (Low)
**定义**: 不阻断主流程的界面或文案问题，纳入常规排期。

**SearchPerplexity 节点 P3 示例**:
- 💡 配置菜单打开/关闭动画异常或卡顿
- 💡 Perplexity 图标显示模糊或缺失
- 💡 Model 标签红点位置或大小不正确
- 💡 Run 按钮文本大小写不一致（Run vs run）
- 💡 InputOutputDisplay 组件边距或对齐问题
- 💡 Hover 状态颜色过渡不平滑
- 💡 Model 下拉框展开动画不流畅
- 💡 模型名称显示格式问题（sonar-pro vs Sonar Pro）

**为什么是 P3**: 这些是 UI/UX 相关的小问题，不影响实际功能，用户仍能完成所有操作。视觉问题可能略微降低美观度，但不影响可用性。

---

## 🔧 测试执行结果

### 最后执行时间
- **日期**: 2025-10-27
- **测试框架**: Vitest v3.2.4
- **测试环境**: jsdom
- **执行时长**: 801ms

### 执行命令
```bash
npx vitest __tests__/search-perplexity-edge-node/unit/SearchPerplexity.params.test.tsx --run
```

### 测试输出摘要
```
Test Files  1 passed (1)
     Tests  10 passed | 6 failed (16)
  Start at  14:56:51
  Duration  1.63s (transform 98ms, setup 46ms, collect 203ms, tests 801ms, environment 335ms, prepare 58ms)
```

---

## 🐛 已知问题和待修复

### 高优先级问题 (影响 P0/P1 测试)

#### 1. 模型切换后未正确更新到 node.data
- **影响用例**: TC-SP-001 (P0), TC-SP-002, TC-SP-002-1, TC-SP-002-2 (P1)
- **失败原因**: 
  - 组件使用 `requestAnimationFrame` 延迟更新 (line 188-213)
  - 测试中 setNodes 被调用，但更新的 model 值仍然是旧值
  - 可能是因为 requestAnimationFrame 在测试环境中执行时机不确定
- **建议修复**: 
  - **方案 1**: 在测试中 mock requestAnimationFrame 使其立即执行
  - **方案 2**: 增加测试等待时间，等待 requestAnimationFrame 回调完成
  - **方案 3**: 组件优化 - 对于关键参数（P0）立即保存，不使用 requestAnimationFrame

#### 2. 组件初始化未正确加载 node.data 中的配置
- **影响用例**: TC-SP-003-1 (P2)
- **失败原因**: 
  - 传入 data.extra_configs.model = 'sonar'，但组件总是显示默认值 'sonar-pro'
  - 组件的 useState 初始化使用了 getNode(id)，但测试中 getNode mock 返回的是默认节点
  - 组件内部状态 model 初始化后，没有响应 props.data 的变化
- **建议修复**: 
  - **方案 1**: 测试中正确设置 getNode 的返回值为传入的节点
  - **方案 2**: 组件添加 useEffect 监听 data.extra_configs.model 变化
  - **方案 3**: 使用 props.data 直接初始化 useState，而不是通过 getNode

### 技术分析

#### requestAnimationFrame 延迟更新问题

**代码位置**: Line 188-213

```typescript
useEffect(() => {
  if (!isOnGeneratingNewNode && hasMountedRef.current) {
    requestAnimationFrame(() => {
      const node = getNode(id);
      if (node) {
        setNodes(prevNodes =>
          prevNodes.map(n => {
            if (n.id === id) {
              return {
                ...n,
                data: {
                  ...n.data,
                  extra_configs: {
                    ...(n.data as SearchConfigNodeData).extra_configs,
                    model: model,
                  },
                },
              };
            }
            return n;
          })
        );
      }
    });
  }
}, [id, setNodes, model, isOnGeneratingNewNode]);
```

**问题**: 
- 每次 model 改变时，会在下一个 animation frame 才更新 node.data
- 测试中可能在 requestAnimationFrame 执行前就检查了结果
- 即使用 waitFor，如果 requestAnimationFrame 没有被调度，也不会执行

#### 组件初始化问题

**代码位置**: Line 73-77

```typescript
const [model, setModel] = useState<PerplexityModelNames>(
  () =>
    (getNode(id)?.data as SearchConfigNodeData)?.extra_configs?.model ??
    'sonar-pro'
);
```

**问题**:
- 初始化时从 getNode 获取数据，而不是直接从 props.data
- 如果 getNode 返回的数据与 props.data 不一致，会导致显示错误
- useState 的初始化函数只在首次渲染时执行一次

---

## 🎯 改进建议

### 短期改进 (1-2天)

1. **修复测试环境的 requestAnimationFrame**
   ```typescript
   // 在测试文件中添加
   beforeEach(() => {
     vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: any) => {
       cb();
       return 0;
     });
   });
   ```

2. **修复 getNode mock**
   ```typescript
   // 确保 getNode 返回正确的节点数据
   const mockNode = createMockNode({
     extra_configs: { model: 'sonar', threshold: undefined }
   });
   mockGetNode.mockReturnValue(mockNode);
   
   // 并且 useReactFlow 中的 getNode 也要返回相同的节点
   mocks.useReactFlow.mockReturnValue({
     getNode: (id: string) => id === mockNode.id ? mockNode : null,
     // ...
   });
   ```

3. **组件代码优化**
   - 考虑直接从 props.data 初始化状态
   - 或添加 useEffect 同步 props.data 变化

### 中期改进 (1周)

1. **参数保存策略优化**
   - P0/P1 关键参数：立即保存（移除 requestAnimationFrame）
   - P2/P3 参数：可以使用防抖延迟保存

2. **添加 data-testid**
   ```tsx
   <PuppyDropdown
     data-testid="search-perplexity-model-dropdown"
     options={modelOptions}
     selectedValue={model}
     ...
   />
   ```

3. **改进状态管理**
   - 使用 useEffect 同步 props.data 到本地状态
   - 确保组件可以响应外部数据变化

---

## 📚 数据结构完整定义

### SearchConfigNodeData

```typescript
type SearchConfigNodeData = {
  // 【内部使用】节点标签
  nodeLabels?: { label: string; id: string }[];
  
  // 【内部使用】子菜单类型
  subMenuType: string | null;
  
  // 【保留字段】Top K（未在 UI 中暴露）
  top_k: number | undefined;
  
  // 【内部使用】内容
  content: string | null;
  
  // 【内部使用】是否循环
  looped: boolean | undefined;
  
  // 【内部使用】查询输入 ID（通过 InputOutputDisplay 管理）
  query_id: { id: string; label: string } | undefined;
  
  // 【内部使用】向量数据库（保留字段）
  vector_db: { id: string; label: string } | undefined;
  
  // 【P0 核心配置】额外配置项
  extra_configs: {
    // 【P0 必填】Perplexity 模型
    model: 
      | 'sonar'                    // 基础模型
      | 'sonar-pro'                // 专业模型（默认）
      | 'sonar-reasoning-pro'      // 推理专业模型
      | undefined;
    
    // 【保留字段】阈值（未在 UI 中暴露）
    threshold: number | undefined;
  };
};
```

### 输入输出配置

```typescript
// 输入类型
supportedInputTypes: ['text']           // 接受 Text Block 输入

// 输出类型
supportedOutputTypes: ['structured']    // 输出 Structured Block

// 节点类别
inputNodeCategory: 'blocknode'          // 输入来自 Block Node
outputNodeCategory: 'blocknode'         // 输出到 Block Node
```

### Perplexity 模型类型

```typescript
type PerplexityModelNames = 
  | 'sonar'                    // 基础搜索模型
  | 'sonar-pro'                // 专业搜索模型（默认）
  | 'sonar-reasoning-pro';     // 推理专业搜索模型
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

// 10. React Portal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: any) => node,
  };
});
```

### 测试数据准备

```typescript
// 示例节点数据 - 使用默认值
const mockNodeDataDefault: SearchConfigNodeData = {
  nodeLabels: [],
  subMenuType: null,
  top_k: undefined,
  content: null,
  looped: false,
  query_id: undefined,
  vector_db: undefined,
  extra_configs: {
    model: 'sonar-pro',  // 默认模型
    threshold: undefined,
  },
};

// 示例节点数据 - 自定义配置（sonar）
const mockNodeDataSonar: SearchConfigNodeData = {
  nodeLabels: [],
  subMenuType: null,
  top_k: undefined,
  content: null,
  looped: false,
  query_id: { id: 'text-1', label: 'Text Block 1' },
  vector_db: undefined,
  extra_configs: {
    model: 'sonar',
    threshold: 0.8,
  },
};

// 示例节点数据 - 自定义配置（reasoning-pro）
const mockNodeDataReasoningPro: SearchConfigNodeData = {
  nodeLabels: [],
  subMenuType: null,
  top_k: undefined,
  content: null,
  looped: false,
  query_id: { id: 'text-1', label: 'Text Block 1' },
  vector_db: undefined,
  extra_configs: {
    model: 'sonar-reasoning-pro',
    threshold: 0.8,
  },
};

// 模型选项列表
const modelOptions = ['sonar', 'sonar-pro', 'sonar-reasoning-pro'];
```

---

## 🎯 测试策略

### 单元测试重点

1. **参数保存机制**
   - 验证 model 修改后通过 setNodes 正确保存到 node.data.extra_configs.model
   - 使用 `waitFor` 等待异步更新完成
   - 检查 setNodes 调用的参数结构，确保 extra_configs 对象正确

2. **状态同步**
   - 验证 useState 和 node.data 之间的双向同步
   - 测试初始化时从 node.data.extra_configs.model 加载配置
   - 测试参数修改时更新 node.data.extra_configs

3. **模型选项验证**
   - 验证所有 3 个模型选项都可用
   - 验证模型类型严格性（只接受 3 个预定义的值）
   - 验证模型切换流畅性

4. **UI 交互**
   - 菜单打开/关闭
   - Model 下拉框交互
   - Hover 状态和 Run 按钮显示
   - 点击事件触发

5. **组件集成**
   - InputOutputDisplay 正确配置
   - PuppyDropdown 正确配置
   - Handle 组件正确放置
   - Portal 菜单正确渲染

### 测试注意事项

1. **异步更新处理**
   - 使用 `waitFor` 等待 setNodes 调用
   - 使用 `act` 包裹状态更新
   - 注意 requestAnimationFrame 的延迟（line 190）

2. **DOM 查询策略**
   - 使用 "Model" label 定位下拉框
   - 使用 data-testid 或 role 定位元素
   - 考虑添加 data-testid 属性方便测试

3. **Portal 测试**
   - Mock createPortal 直接渲染子元素
   - 验证 portal 内容正确渲染到 body

4. **PuppyDropdown 测试**
   - Mock PuppyDropdown 组件
   - 模拟 onSelect 回调
   - 验证 selectedValue 和 options 正确传递

---

## 💡 已知挑战和解决方案

### 挑战 1: requestAnimationFrame 延迟
**问题**: 状态同步使用 requestAnimationFrame 延迟执行（line 188-213）
**解决方案**: 
- 在测试中使用 `waitFor` 并增加足够的超时时间
- 或者 mock requestAnimationFrame 立即执行

### 挑战 2: createPortal 菜单定位
**问题**: 配置菜单使用 fixed 定位和 portal，测试环境可能不支持
**解决方案**: 
- Mock createPortal 直接返回子元素
- 不测试菜单的绝对定位，只验证内容渲染

### 挑战 3: PuppyDropdown 组件
**问题**: PuppyDropdown 是自定义组件，需要正确 mock
**解决方案**: 
- 创建简化的 MockPuppyDropdown
- 模拟 options、selectedValue、onSelect 行为
- 使用 select 元素简化测试

### 挑战 4: 模型数据结构
**问题**: model 保存在嵌套的 extra_configs 对象中
**解决方案**: 
- 仔细验证 setNodes 更新时的对象结构
- 确保 extra_configs 对象正确合并
- 测试时检查完整的数据路径

### 挑战 5: 节点激活状态管理
**问题**: 组件依赖 NodesPerFlowContext 的复杂状态
**解决方案**: 
- Mock 完整的 context 对象
- 提供所有必需的方法（activateEdge, clearAll 等）
- 验证这些方法在适当时机被调用

---

## 📖 参考资料

### 相关文件
- 组件源码: `app/components/workflow/edgesNode/edgeNodesNew/SearchPerplexity.tsx`
- 测试文件: `__tests__/search-perplexity-edge-node/unit/SearchPerplexity.params.test.tsx` (待创建)
- 测试文档: `__tests__/search-perplexity-edge-node/SearchPerplexity-测试文档.md` (本文档)

### 其他测试文档参考
- [SearchGoogle Edge Node 测试文档](../search-google-edge-node/SearchGoogle-测试文档.md)
- [Generate Edge Node 测试文档](../generate-edge-node/Generate-测试文档.md)
- [Retrieving Edge Node 测试文档](../retrieving-edge-node/Retrieving-测试文档.md)
- [JSON Block Node 测试文档](../json-block-node/docs/JsonNodeNew-测试文档.md)
- [File Block Node 测试文档](../file-block-node/docs/FileNode-测试文档.md)

### 技术文档
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Vitest 测试框架](https://vitest.dev/)
- [React Flow 文档](https://reactflow.dev/)
- [Perplexity API](https://docs.perplexity.ai/)

---

## 🔄 后续改进建议

### 短期改进 (实现测试后)

1. **添加 data-testid 属性**
   ```tsx
   <PuppyDropdown
     data-testid="search-perplexity-model-dropdown"
     options={modelOptions}
     selectedValue={model}
     ...
   />
   ```

2. **参数验证增强**
   - 添加模型选项的客户端验证
   - 显示无效模型的错误提示
   - 防止选择未定义的模型

3. **用户体验优化**
   - 添加 model 参数的说明文本（各模型的区别）
   - 显示推荐模型标记
   - 添加模型性能对比提示

### 中期改进 (1-2周)

1. **暴露更多配置选项**
   - 考虑添加 threshold 参数到 UI
   - 添加搜索语言选项
   - 添加结果数量控制

2. **集成测试**
   - 测试与 InputOutputDisplay 的交互
   - 测试完整的执行流程（mock runSingleEdgeNode）
   - 测试与其他节点的连接

3. **性能优化**
   - 减少不必要的 useCallback/useMemo
   - 优化 portal 菜单的定位逻辑
   - 减少 requestAnimationFrame 的使用

### 对比 SearchGoogle

| 特性 | SearchGoogle | SearchPerplexity |
|------|-------------|-----------------|
| 核心参数 | top_k (number) | model (string) |
| 参数位置 | node.data.top_k | node.data.extra_configs.model |
| 默认值 | 5 | 'sonar-pro' |
| UI 展示 | Settings 需展开 | 直接显示 |
| 是否必填 | 否 | 是（有红点） |
| 参数类型 | 数字 | 枚举字符串 |
| 选项数量 | - | 3个模型 |

---

## 📝 版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.1 | 2025-10-27 | ✅ 测试可运行，10/16 通过 (62.5%)<br>🐛 标记 6 个失败用例<br>📊 添加详细覆盖率统计<br>💡 提供详细的技术分析和改进建议<br>🔧 识别 requestAnimationFrame 和初始化问题 |
| v1.0 | 2025-10-27 | 📝 初始版本，13个测试用例规划<br>📊 包含 P0-P3 四个优先级<br>🎯 覆盖 Model、初始化、UI 三大模块<br>📚 完整的数据结构定义和 Mock 准备清单<br>💡 识别已知挑战和解决方案<br>📖 与 SearchGoogle 的对比分析 |

---

*当前版本: v1.1*  
*最后更新: 2025-10-27*  
*维护者: 测试团队*  
*状态: ✅ 测试可运行，62.5% 通过率*

