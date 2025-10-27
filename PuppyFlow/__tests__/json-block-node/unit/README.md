# JSON Block Node 单元测试

## 📋 测试文件概览

| 文件 | 测试内容 | P0用例 | P1用例 | 总用例数 |
|------|---------|--------|--------|---------|
| `JsonNodeNew.content.test.tsx` | 内容编辑与保存 | 5 | 7 | 12 |
| `JsonNodeNew.storage.test.tsx` | 动态存储策略 | 3 | 4 | 7 |
| `JsonNodeNew.connection.test.tsx` | 节点连接 | 2 | 2 | 4 |
| `JsonNodeNew.view.test.tsx` | 视图切换 | 1 | 7 | 8 |
| `JsonNodeNew.indexing.test.tsx` | 索引管理 | 0 | 7 | 7 |
| **合计** | - | **11** | **27** | **38** |

## 🚀 运行测试

### 运行所有测试
```bash
npm run test -- __tests__/json-block-node/unit/
```

### 运行单个测试文件
```bash
# 内容编辑与保存
npm run test -- JsonNodeNew.content.test.tsx

# 动态存储策略
npm run test -- JsonNodeNew.storage.test.tsx

# 节点连接
npm run test -- JsonNodeNew.connection.test.tsx

# 视图切换
npm run test -- JsonNodeNew.view.test.tsx

# 索引管理
npm run test -- JsonNodeNew.indexing.test.tsx
```

### 运行特定测试用例
```bash
# 运行包含 "TC-JSON-001" 的测试
npm run test -- JsonNodeNew.content.test.tsx -t "TC-JSON-001"

# 运行 P0 优先级的测试
npm run test -- JsonNodeNew.content.test.tsx -t "P0"
```

### 查看测试覆盖率
```bash
npm run test -- __tests__/json-block-node/unit/ --coverage
```

## ⚠️ 跳过的测试（.skip）

以下测试被标记为 `.skip`，需要在集成测试或 E2E 测试中完成：

### `JsonNodeNew.content.test.tsx`
- `TC-JSON-008`: Internal 存储2秒防抖保存 - 需要真实防抖逻辑
- `TC-JSON-008-EXT`: External 存储2秒防抖保存 - 需要真实存储逻辑
- `TC-JSON-009`: 快速连续编辑防抖 - 需要复杂的时序控制
- `TC-JSON-010`: 保存中再次编辑 - 需要真实的并发场景
- `TC-JSON-011`: 保存失败处理 - 需要真实的错误处理流程

**原因**: 这些测试需要真实的 `useEffect` 和防抖逻辑，在单元测试中难以完全模拟

### `JsonNodeNew.connection.test.tsx`
- 完整的连接创建流程 - 需要 React Flow 真实环境

**原因**: 拖拽连接需要完整的 React Flow 渲染和事件系统

## 🔍 测试覆盖的功能模块

### 1️⃣ 内容编辑与保存 (`content.test.tsx`)
- ✅ 用户输入 JSON 内容
- ✅ 编辑现有 JSON 内容
- ✅ 清空所有 JSON 内容
- ✅ 超长 JSON 输入（>10万字符）
- ✅ 对象/数组类型 content 的字符串化
- ✅ null 值处理
- ✅ isLoading 时不触发保存
- ✅ 加载完成后显示内容
- ⏭️ 自动保存防抖机制（集成测试）

### 2️⃣ 动态存储策略 (`storage.test.tsx`)
- ✅ 内容超阈值切换到外部存储
- ✅ 内容缩减切换回内部存储
- ✅ 存储切换时的数据一致性
- ✅ 特殊字符和 Unicode 处理
- ✅ 有效 JSON 识别为 structured
- ✅ 无效 JSON 识别为 text
- ✅ External 存储的 dirty 标记
- ✅ Internal 存储不使用 dirty

### 3️⃣ 节点连接 (`connection.test.tsx`)
- ✅ 4个方向 Source Handle 可见
- ✅ Source Handle ID 命名规范
- ✅ isConnectable 控制连接能力
- ✅ 4个方向 Target Handle 存在
- ✅ 连接中鼠标悬停边框变色
- ⏭️ 完整的拖拽连接流程（E2E）

### 4️⃣ 视图切换 (`view.test.tsx`)
- ✅ 切换到 JSONForm 视图
- ✅ 切换回 RichEditor 视图
- ✅ 切换视图时内容不丢失
- ✅ 多次切换内容保持一致
- ✅ 切换前编辑的内容保留
- ✅ RichEditor 正确接收 props
- ✅ JSONForm 正确接收 props
- ✅ 锁定状态下两种视图都只读
- ✅ 编辑器内滚动不传播

### 5️⃣ 索引管理 (`indexing.test.tsx`)
- ✅ 添加向量索引
- ✅ 添加索引时显示 processing 状态
- ✅ 索引创建失败处理
- ✅ 删除已完成的索引
- ✅ 删除时显示 deleting 状态
- ✅ 删除失败处理
- ✅ 索引状态流转：processing → done
- ✅ 索引状态流转：processing → error
- ✅ 索引状态流转：done → deleting → 移除

## 🔧 Mock 配置说明

所有测试文件都 Mock 了以下依赖：

### React Flow
- `useReactFlow`: 节点操作（getNode, setNodes, getNodes）
- `Handle`: 连接点组件
- `NodeResizeControl`: 节点大小调整

### 上下文和 Hooks
- `useNodesPerFlowContext`: 节点状态管理
- `useGetSourceTarget`: 获取连接关系
- `useWorkspaceManagement`: 用户管理
- `useWorkspaces`: 工作区信息
- `useIndexingUtils`: 索引操作（仅 indexing.test.tsx）

### 组件
- `RichJSONForm`: 富文本 JSON 编辑器
- `JSONForm`: 纯文本 JSON 编辑器
- `SkeletonLoadingIcon`: 骨架屏
- `NodeSettingsButton`: 设置按钮
- `NodeIndexingButton`: 索引按钮
- `NodeLoopButton`: 循环按钮
- `NodeViewToggleButton`: 视图切换按钮
- `WhiteBallHandle`: 自定义连接点

### 工具函数
- `handleDynamicStorageSwitch`: 动态存储切换
- `getStorageInfo`: 获取存储信息
- `CONTENT_LENGTH_THRESHOLD`: 阈值常量（测试中设为 50000）

## ⚙️ 人工验证清单

### 在运行测试前需要验证：

#### 1. 导入路径
- [ ] 确认所有 `@/components/...` 路径是否正确
- [ ] 验证 Mock 组件的路径是否与真实代码一致
- [ ] 检查 `JsonNodeNew.tsx` 的实际位置

#### 2. 类型定义
- [ ] 验证 `JsonNodeData` 类型的实际定义
- [ ] 检查 `VectorIndexingItem` 类型的字段
- [ ] 确认 `VectorIndexingStatus` 的可能值

#### 3. Mock 行为
- [ ] 验证 Mock 的编辑器组件是否符合真实组件的 API
- [ ] 检查 `handleDynamicStorageSwitch` 的实际参数
- [ ] 确认 `CONTENT_LENGTH_THRESHOLD` 的真实值（当前测试用 50000）

#### 4. 状态管理
- [ ] 验证 `savingStatus` 的可能值和流转
- [ ] 检查 `dirty` 标记的使用场景
- [ ] 确认 `storage_class` 的可能值（internal/external）

### 运行测试后需要验证：

#### 1. 跳过的测试
- [ ] 在集成测试中补充防抖保存测试
- [ ] 在 E2E 中完成连接创建测试
- [ ] 验证滚动事件的 stopPropagation 实际效果

#### 2. 时序问题
- [ ] 检查 `useFakeTimers` 是否影响异步操作
- [ ] 验证 `requestAnimationFrame` 的模拟
- [ ] 测试真实环境的2秒防抖是否准确

#### 3. 真实交互
- [ ] 在真实 React Flow 中测试连接功能
- [ ] 验证拖拽时的 preventParentDrag 效果
- [ ] 测试编辑器的实际渲染和交互

## 📊 测试用例映射

### P0 用例（11个）
| 测试ID | 描述 | 文件 | 状态 |
|--------|------|------|------|
| TC-JSON-001 | 用户输入 JSON 内容 | content.test.tsx | ✅ |
| TC-JSON-002 | 编辑现有 JSON 内容 | content.test.tsx | ✅ |
| TC-JSON-008 | Internal 存储自动保存 | content.test.tsx | ⏭️ Skip |
| TC-JSON-008-EXT | External 存储自动保存 | content.test.tsx | ⏭️ Skip |
| TC-JSON-011 | 保存失败处理 | content.test.tsx | ⏭️ Skip |
| TC-JSON-015 | 超阈值切换外部存储 | storage.test.tsx | ✅ |
| TC-JSON-016 | 缩减切换内部存储 | storage.test.tsx | ✅ |
| TC-JSON-018 | 存储切换数据一致性 | storage.test.tsx | ✅ |
| TC-JSON-026 | 从 Source Handle 创建连接 | connection.test.tsx | ✅ |
| TC-JSON-029 | 接收其他节点连接 | connection.test.tsx | ✅ |
| TC-JSON-061 | 视图切换内容不丢失 | view.test.tsx | ✅ |

### P1 用例（27个）
详见各测试文件的 describe 块

## 🐛 已知限制

### 1. React Flow 集成
- 单元测试中无法完全模拟 React Flow 的内部行为
- 连接创建、拖拽等功能需要在 E2E 测试中验证

### 2. 时序控制
- `useFakeTimers` 可能无法完全模拟复杂的异步场景
- 防抖保存、并发编辑等需要在真实环境中测试

### 3. 外部依赖
- 向量数据库交互需要 Mock 或使用测试数据库
- 外部存储服务需要 Mock 或使用测试环境

### 4. 组件内部逻辑
- 某些 `useEffect` 的触发条件难以在测试中复现
- 复杂的状态机流转需要集成测试验证

## 📝 下一步行动

### 短期（本周）
- [ ] 运行所有单元测试，修复失败的用例
- [ ] 检查并修复 Mock 配置问题
- [ ] 验证导入路径和类型定义
- [ ] 补充缺失的 Mock 实现

### 中期（下周）
- [ ] 编写集成测试，覆盖跳过的单元测试
- [ ] 使用真实依赖测试防抖保存
- [ ] 验证存储切换的完整流程
- [ ] 测试索引管理的真实交互

### 长期（后续迭代）
- [ ] 编写 Playwright E2E 测试
- [ ] 测试完整的用户操作流程
- [ ] 性能测试（大 JSON、并发操作）
- [ ] 压力测试（多节点、多索引）

## 🔗 相关文档

- [测试文档](../docs/JsonNodeNew-测试文档.md)
- [TextBlockNode 测试参考](../../text-block-node/unit/)
- [Vitest 文档](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)

---

**最后更新**: 2025-10-23  
**维护者**: 测试团队

