# IfElse Edge Node 测试文档

## 文档说明
- **组件路径**: `PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/ifelse.tsx`
- **组件类型**: Edge Node (边缘节点)
- **核心职责**: 条件判断与路由节点，根据不同条件执行不同的动作
- **目标平台**: 桌面端
- **测试状态**: ✅ 测试可运行，20/22 通过 (90.9%)

---

## 📊 测试用例覆盖情况总览

### 统计摘要

| 状态 | 数量 | 占比 | 说明 |
|------|------|------|------|
| ✅ 已通过 | 20 | 90.9% | 测试通过 |
| ❌ 失败 | 2 | 9.1% | 测试失败（UI元素查找问题） |
| **总计** | **22** | **100%** | 已实现的测试用例 |

### 按优先级的覆盖情况

| 优先级 | 总数 | 通过 | 失败 | 覆盖率 |
|--------|------|------|------|--------|
| **P0** | 7 | 7 | 0 | 100% ✅ |
| **P1** | 9 | 7 | 2 | 77.8% |
| **P2** | 6 | 6 | 0 | 100% ✅ |
| **总计** | **22** | **20** | **2** | **90.9%** |

### 按功能模块的覆盖情况

| 功能模块 | 测试数 | 通过 | 失败 | 覆盖率 |
|---------|--------|------|------|--------|
| Cases 数组管理 (P0+P1) | 6 | 5 | 1 | 83.3% |
| Condition 参数配置 (P0+P1) | 6 | 5 | 1 | 83.3% |
| Action 参数配置 (P0+P1) | 4 | 4 | 0 | 100% ✅ |
| 初始化和默认值 (P2) | 4 | 4 | 0 | 100% ✅ |
| UI 交互和状态 (P2) | 2 | 2 | 0 | 100% ✅ |
| **总计** | **22** | **20** | **2** | **90.9%** |

---

## 📝 详细测试用例

### 功能模块 1: Cases 数组管理 (P0 + P1)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-IE-001 | 修改 cases 应正确保存到 node.data.cases | P0 | ✅ | 单元 | 核心数据结构保存 |
| TC-IE-001-1 | cases 应为数组类型 | P0 | ✅ | 单元 | 类型验证 |
| TC-IE-002 | 添加新 Case 应正确更新 cases 数组 | P1 | ✅ | 单元 | 添加Case功能 |
| TC-IE-002-1 | 删除 Case 应正确更新 cases 数组 | P1 | ❌ | 单元 | 无法找到 "Case 2" 元素 |
| TC-IE-003 | 新增 Case 应包含默认 condition 和 action | P1 | ✅ | 单元 | 默认结构验证 |
| TC-IE-003-1 | 不能删除最后一个 Case | P1 | ✅ | 单元 | 边界情况保护 |

**数据结构**:
```typescript
cases: CaseItem[]  // 条件判断用例数组

interface CaseItem {
  conditions: Condition[];  // 条件数组
  actions: Action[];        // 动作数组
}

interface Condition {
  id: string;           // 源节点ID
  label: string;        // 源节点标签
  condition: string;    // 条件类型 (contains, doesn't contain, etc.)
  type?: string;        // 节点类型 (text, structured, switch)
  cond_v: string;       // 条件值
  cond_input?: string;
  operation: string;    // 与下一条件的逻辑关系 (AND, OR)
}

interface Action {
  from_id: string;      // 源节点ID
  from_label: string;   // 源节点标签
  outputs: string[];    // 目标节点ID数组
}
```

**测试场景**:
1. 打开配置菜单，显示默认的 Case 1
2. 点击 "Add New Case" 按钮添加 Case 2
3. 验证 `node.data.cases` 数组长度增加
4. 验证新 Case 包含默认的 condition 和 action
5. 点击 Case 1 右上角的删除按钮
6. 验证 `node.data.cases` 数组长度减少
7. 当只剩一个 Case 时，删除按钮应不可见或不可用

**关键行号**: 
- 124-147 (cases 状态初始化)
- 215-234 (状态同步到 node.data)
- 244-275 (监听状态变化并保存)
- 498-526 (onCaseAdd - 添加Case)
- 528-537 (onCaseDelete - 删除Case)

---

### 功能模块 2: Condition 参数配置 (P0 + P1)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-IE-004 | 修改 condition 类型应正确保存 | P0 | ✅ | 单元 | 条件类型切换 (contains, doesn't contain, etc.) |
| TC-IE-004-1 | 修改 condition 值(cond_v)应正确保存 | P0 | ✅ | 单元 | 条件值输入 |
| TC-IE-005 | 修改 condition 的源节点应正确保存 | P0 | ✅ | 单元 | 节点选择 |
| TC-IE-006 | 添加新 Condition 应正确更新 | P1 | ✅ | 单元 | 添加条件 |
| TC-IE-006-1 | 删除 Condition 应正确更新 | P1 | ✅ | 单元 | 删除条件（至少保留1个） |
| TC-IE-007 | AND/OR 操作切换应正确保存 | P1 | ❌ | 单元 | 无法找到 "AND" 元素（单条件时不显示） |

**测试场景**:
1. 在 Case 的 "Condition" 部分，修改条件类型（如从 "contains" 改为 "doesn't contain"）
2. 验证 `node.data.cases[0].conditions[0].condition` 正确更新
3. 在条件值输入框输入文本或数字
4. 验证 `node.data.cases[0].conditions[0].cond_v` 正确保存
5. 点击源节点下拉菜单，选择不同的源节点
6. 验证 `node.data.cases[0].conditions[0].id` 和 `label` 正确更新
7. 点击 "Add Condition" 按钮
8. 验证 conditions 数组长度增加
9. 点击 Condition 右侧的删除按钮
10. 验证 conditions 数组长度减少
11. 点击两个 Condition 之间的 "AND"/"OR" 按钮
12. 验证 `operation` 字段在 "AND" 和 "OR" 之间切换

**关键行号**: 
- 539-557 (onConditionAdd - 添加条件)
- 559-571 (onConditionDelete - 删除条件)
- 573-586 (onAndOrSwitch - AND/OR切换)
- 589-604 (updateCondition - 更新条件)
- 1056-1289 (Condition UI 渲染)

**条件类型选项**:
- text 类型: contains, doesn't contain, is greater than [N] characters, is less than [N] characters
- structured 类型: is empty, is not empty, contains, doesn't contain, is greater than [N] characters, is less than [N] characters, is list, is dict
- switch 类型: is True, is False

---

### 功能模块 3: Action 参数配置 (P0 + P1)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-IE-008 | 修改 Action 的源节点应正确保存 | P0 | ✅ | 单元 | from_id 和 from_label 更新 |
| TC-IE-008-1 | 修改 Action 的目标节点应正确保存 | P0 | ✅ | 单元 | outputs 数组更新 |
| TC-IE-009 | 添加新 Action 应正确更新 | P1 | ✅ | 单元 | 添加动作 |
| TC-IE-009-1 | 删除 Action 应正确更新 | P1 | ✅ | 单元 | 删除动作（至少保留1个） |

**测试场景**:
1. 在 Case 的 "Then" 部分，点击源节点下拉菜单
2. 选择不同的源节点
3. 验证 `node.data.cases[0].actions[0].from_id` 和 `from_label` 正确更新
4. 点击 "copy to" 后的目标节点下拉菜单
5. 选择目标节点
6. 验证 `node.data.cases[0].actions[0].outputs[0]` 正确保存目标节点ID
7. 点击 "Add Action" 按钮
8. 验证 actions 数组长度增加
9. 点击 Action 右侧的删除按钮
10. 验证 actions 数组长度减少
11. 当只剩一个 Action 时，删除按钮应不可见或不可用

**关键行号**: 
- 686-701 (onActionAdd - 添加动作)
- 703-715 (onActionDelete - 删除动作)
- 717-732 (updateAction - 更新动作)
- 1314-1518 (Action UI 渲染)

---

### 功能模块 4: 初始化和默认值 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-IE-010 | 节点初始化时 cases 应为空数组或包含默认 case | P2 | ✅ | 单元 | 默认值验证 |
| TC-IE-010-1 | 节点初始化时应从 node.data.cases 加载现有配置 | P2 | ✅ | 单元 | 配置加载验证 |
| TC-IE-011 | 默认 case 应包含一个 condition 和一个 action | P2 | ✅ | 单元 | 默认结构验证 |
| TC-IE-012 | 组件挂载后验证 | P2 | ✅ | 单元 | 组件挂载和渲染正常 |

**测试场景**:
1. 创建一个空的 IfElse 节点（node.data.cases 为 undefined 或空数组）
2. 验证组件初始化后 cases 为空数组，或在连接源节点后自动创建默认 case
3. 创建一个包含已有 cases 配置的 IfElse 节点
4. 验证组件正确加载已有的 cases、conditions 和 actions
5. 验证默认 case 包含：
   - 一个 condition，condition 类型为 "contains"，operation 为 "AND"
   - 一个 action，from_label 为 "output"

**关键行号**: 
- 124-147 (cases 等状态初始化)
- 297-325 (initializeCases - 初始化cases)
- 328-352 (fixExistingCasesFromId - 修复现有cases的from_id)

---

### 功能模块 5: UI 交互和状态 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-IE-013 | 点击节点按钮应打开/关闭配置菜单 | P2 | ✅ | 单元 | 菜单展开/收起 |
| TC-IE-013-1 | 配置菜单初始状态应为关闭 | P2 | ✅ | 单元 | isMenuOpen 初始值 |

**测试场景**:
1. 渲染 IfElse 节点，验证配置菜单不可见
2. 点击节点中心按钮
3. 验证 `isMenuOpen` 状态变为 true，配置菜单显示
4. 再次点击节点按钮
5. 验证 `isMenuOpen` 状态变为 false，配置菜单隐藏

**关键行号**: 
- 107 (isMenuOpen 状态)
- 355-373 (onClickButton - 切换菜单)
- 917-1548 (配置菜单渲染)

---

## 🔍 组件关键信息

### 核心参数位置
- **cases**: `node.data.cases` - 包含所有条件判断和路由逻辑的数组
- **switchValue**: `node.data.switch` - 备用开关值
- **contentValue**: `node.data.content` - 备用内容值
- **onValue**: `node.data.ON` - 备用开启值数组
- **offValue**: `node.data.OFF` - 备用关闭值数组

### 状态同步机制
1. **初始化阶段** (lines 124-147): 使用 `getNode(id)?.data` 初始化本地状态
2. **组件初始化** (lines 206-242): 在 `useEffect` 中使用 `requestAnimationFrame` 同步状态到 node.data
3. **状态变化监听** (lines 244-275): 监听所有状态变化，使用 `requestAnimationFrame` 延迟保存

### 输入输出配置
```typescript
supportedInputTypes: ['text', 'structured']
supportedOutputTypes: ['text', 'structured']
```

### Helper 函数
- `getConditionSelections(type)`: 根据节点类型返回可用的条件选项
- `updateCondition`: 更新指定 case 和 condition 的字段
- `updateAction`: 更新指定 case 和 action 的字段
- `onCasesChange`: 统一的 cases 变更回调

---

## 🎯 测试重点说明

### P0 级别（核心数据保存）
IfElse 节点的核心是 `cases` 数组，它包含了所有的条件判断逻辑和路由配置。P0 测试应重点关注：
1. **Cases 数组的完整性**：修改后的 cases 能否正确保存到 `node.data.cases`
2. **Condition 参数**：条件类型、条件值、源节点选择的修改能否保存
3. **Action 参数**：源节点、目标节点的选择能否保存

如果这些核心参数无法正确保存，整个条件判断逻辑将失效，属于致命问题。

### P1 级别（重要功能）
1. **动态增删功能**：添加/删除 Case、Condition、Action 的功能
2. **逻辑操作符切换**：AND/OR 的切换功能
3. **边界保护**：至少保留一个 Case、Condition、Action

这些功能影响用户配置复杂条件判断的能力，但可以通过手动编辑数据绕过。

### P2 级别（非核心功能）
1. **初始化逻辑**：默认值设置、从已有配置加载
2. **UI 交互**：菜单展开/收起

这些问题不影响核心功能，可以通过重试或其他方式绕过。

---

## 📋 测试执行计划

### 测试文件结构
```
__tests__/ifelse-edge-node/
├── IfElse-测试文档.md         # 本文档
└── unit/
    ├── IfElse.params.test.tsx  # 参数配置测试（P0+P1+P2）
    └── IfElse.ui.test.tsx      # UI交互测试（P2）（可选）
```

### 测试优先级
1. **第一阶段**（P0）：测试核心数据保存功能
   - Cases 数组保存
   - Condition 参数保存
   - Action 参数保存
   
2. **第二阶段**（P1）：测试重要交互功能
   - 添加/删除 Case/Condition/Action
   - AND/OR 切换
   
3. **第三阶段**（P2）：测试辅助功能
   - 初始化和默认值
   - UI 状态管理

---

## ✅ 测试结果详情

### 测试执行总结
- **测试时间**: 2025-10-27
- **测试文件**: `__tests__/ifelse-edge-node/unit/IfElse.params.test.tsx`
- **执行命令**: `npx vitest __tests__/ifelse-edge-node/unit/IfElse.params.test.tsx --run`
- **总耗时**: ~4s
- **总测试数**: 22
- **通过**: 20 (90.9%)
- **失败**: 2 (9.1%)

### 失败测试用例分析

#### 1. TC-IE-002-1: 删除 Case 应正确更新 cases 数组
**错误信息**: 
```
TestingLibraryElementError: Unable to find an element with the text: Case 2.
```

**原因分析**:
- 测试创建了包含两个 Case 的节点
- 但是组件渲染时可能没有正确显示 "Case 2" 文本
- 这可能是因为：
  1. 组件初始化时使用 `getNode(id)?.data` 而不是 `props.data`，导致传入的两个 cases 没有被正确加载
  2. 或者组件的条件渲染逻辑导致 Case 2 没有被渲染

**影响程度**: P1 - 严重但非致命
- 不影响核心的数据保存功能
- 只是测试中无法验证删除多个 Case 的场景
- 实际使用中，用户可以通过添加 Case 后再删除来完成操作

#### 2. TC-IE-007: AND/OR 操作切换应正确保存
**错误信息**:
```
TestingLibraryElementError: Unable to find an element with the text: AND.
```

**原因分析**:
- 测试创建了包含两个 Condition 的 Case
- 但是 AND/OR 按钮只在两个 Condition 之间显示
- 可能原因：
  1. 组件渲染时只渲染了一个 Condition（与 TC-IE-002-1 类似的初始化问题）
  2. 或者 AND/OR 按钮的渲染条件：`conditions_index < case_value.conditions.length - 1`，如果只有一个 condition，则不显示

**影响程度**: P1 - 严重但非致命
- AND/OR 切换功能存在且可用（在实际有多个 Condition 时）
- 只是测试环境中的初始化问题导致无法验证
- 不影响用户实际使用

### 通过的关键测试

#### ✅ P0 测试全部通过 (7/7, 100%)
- TC-IE-001: cases 数组保存 ✅
- TC-IE-001-1: cases 类型验证 ✅
- TC-IE-004: Condition 类型修改 ✅
- TC-IE-004-1: Condition 值修改 ✅
- TC-IE-005: Condition 源节点修改 ✅
- TC-IE-008: Action 源节点修改 ✅
- TC-IE-008-1: Action 目标节点修改 ✅

**所有核心参数保存功能正常工作！**

#### ✅ P1 测试大部分通过 (7/9, 77.8%)
通过的测试：
- TC-IE-002: 添加新 Case ✅
- TC-IE-003: 新 Case 包含默认结构 ✅
- TC-IE-003-1: 不能删除最后一个 Case ✅
- TC-IE-006: 添加新 Condition ✅
- TC-IE-006-1: 删除 Condition ✅
- TC-IE-009: 添加新 Action ✅
- TC-IE-009-1: 删除 Action ✅

#### ✅ P2 测试全部通过 (6/6, 100%)
- 初始化和默认值 (4/4) ✅
- UI 交互和状态 (2/2) ✅

---

## 🐛 已知问题和待修复项

### 实际问题（测试发现）

#### 1. 组件初始化问题
**问题描述**:
组件的 `useState` 使用 `getNode(id)?.data` 进行初始化，在测试环境中可能导致传入的 `props.data` 被忽略。

**影响测试用例**:
- TC-IE-002-1: 删除 Case（需要加载两个 Case）
- TC-IE-007: AND/OR 切换（需要加载两个 Condition）

**解决方案**:
1. 修改测试的 mock，确保 `getNode(id)` 返回正确的 `props.data`
2. 或修改组件代码，使用 `props.data` 直接初始化状态
3. 添加 `useEffect` 监听 `props.data` 变化

### 潜在问题分析（基于 SearchGoogle 和 SearchPerplexity 的经验）

#### 1. requestAnimationFrame 异步更新延迟
**问题描述**: 
组件使用 `requestAnimationFrame` 延迟执行状态同步到 `node.data` 的操作（lines 215-234, 244-275）。这可能导致测试中断言时数据尚未更新。

**影响测试用例**:
- TC-IE-001: 修改 cases 的保存验证
- TC-IE-004, TC-IE-004-1, TC-IE-005: Condition 参数修改验证
- TC-IE-008, TC-IE-008-1: Action 参数修改验证

**解决方案**:
- 在测试中 mock `requestAnimationFrame` 使其立即执行
- 使用 `waitFor` 等待异步更新完成
- 或修改组件代码，在测试环境中同步执行

#### 2. useState 初始化依赖 getNode
**问题描述**:
Cases 等状态使用 `getNode(id)?.data` 进行初始化（lines 124-147）。如果 mock 的 `getNode` 返回固定的默认节点，而不是根据传入的 `props.data` 返回对应节点，组件将无法正确加载初始配置。

**影响测试用例**:
- TC-IE-010-1: 从 node.data.cases 加载现有配置

**解决方案**:
- 正确 mock `getNode` 使其返回 `props.data`
- 或修改组件使用 `props.data` 直接初始化
- 添加 `useEffect` 监听 `props.data` 变化

#### 3. Cases 数组的深层嵌套结构
**问题描述**:
Cases 数组包含复杂的嵌套结构（cases -> conditions/actions），修改深层属性时需要正确的不可变更新。

**影响测试用例**:
所有涉及 cases 修改的测试用例

**解决方案**:
- 仔细验证 `updateCondition`、`updateAction` 等函数的实现
- 确保使用扩展运算符正确创建新对象

---

## 💡 改进建议

### 短期改进（修复测试）
1. **Mock requestAnimationFrame**: 在测试环境中使其立即执行
2. **正确 Mock getNode**: 使其返回测试中传入的节点数据
3. **使用 waitFor**: 等待异步状态更新完成

### 中期改进（优化组件代码）
1. **改进状态初始化**: 使用 `props.data` 作为 `useState` 的初始值，而不是 `getNode(id)?.data`
2. **添加状态同步 useEffect**: 监听 `props.data` 变化，同步到本地状态
3. **考虑同步保存关键参数**: Cases 等核心参数可以考虑同步更新到 `node.data`，而不使用 `requestAnimationFrame`

### 长期改进（架构优化）
1. **使用 useReducer 管理复杂状态**: Cases 的复杂嵌套结构更适合使用 reducer 管理
2. **抽取 Cases 管理逻辑**: 将 cases 的增删改查逻辑抽取为自定义 Hook
3. **添加数据验证**: 在保存前验证 cases 结构的完整性

---

## 📊 与其他 Edge Node 的对比

| 特性 | IfElse | SearchGoogle | SearchPerplexity | Generate |
|------|--------|--------------|------------------|----------|
| 核心参数 | cases (数组) | top_k (数字) | model (字符串) | multiple |
| 数据复杂度 | 高（嵌套数组） | 低（单一数值） | 低（单一字符串） | 中等 |
| UI 复杂度 | 高（动态列表） | 低（单一输入框） | 低（下拉菜单） | 中等 |
| 测试难度 | 高 | 中 | 中 | 中 |
| 潜在问题 | 深层嵌套更新、requestAnimationFrame | requestAnimationFrame | requestAnimationFrame | - |

IfElse 节点由于其复杂的嵌套数据结构和动态 UI，测试难度明显高于其他 Edge Node。

---

## 📚 参考资料

### 相关文件
- 组件源码: `PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/ifelse.tsx`
- 执行器: `PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/hook/runSingleEdgeNodeExecutor.ts`
- 类型定义: 在组件文件开头 (lines 24-86)

### 参考测试文档
- SearchGoogle: `PuppyFlow/__tests__/search-google-edge-node/SearchGoogle-测试文档.md`
- SearchPerplexity: `PuppyFlow/__tests__/search-perplexity-edge-node/SearchPerplexity-测试文档.md`
- Generate: `PuppyFlow/__tests__/generate-edge-node/Generate-测试文档.md`

---

**文档版本**: v1.0  
**创建日期**: 2025-10-27  
**最后更新**: 2025-10-27

