# Retrieving Edge Node 测试文档

## 文档说明
- **组件路径**: `PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/Retrieving.tsx`
- **组件类型**: Edge Node (边缘节点)
- **核心职责**: 向量检索节点，用于从已索引的结构化数据中检索相关内容
- **目标平台**: 桌面端
- **测试状态**: ✅ 测试可运行，19/28 通过 (67.9%)

---

## 📊 测试用例覆盖情况总览

### 统计摘要

| 状态 | 数量 | 占比 | 说明 |
|------|------|------|------|
| ✅ 已通过 | 19 | 67.9% | 测试通过 |
| ❌ 失败 | 9 | 32.1% | 测试失败(主要是 UI 交互和输入框定位问题) |
| **总计** | **28** | **100%** | 所有测试用例 |

### 按优先级的覆盖情况

| 优先级 | 总数 | 通过 | 失败 | 覆盖率 |
|--------|------|------|------|--------|
| **P0** | 6 | 4 | 2 | 66.7% |
| **P1** | 7 | 5 | 2 | 71.4% |
| **P2** | 7 | 4 | 3 | 57.1% |
| **P3** | 4 | 2 | 2 | 50.0% |
| **总计** | **28** | **19** | **9** | **67.9%** |

### 按功能模块的覆盖情况

| 功能模块 | 测试数 | 通过 | 失败 | 覆盖率 |
|---------|--------|------|------|--------|
| Query 参数配置 | 2 | 2 | 0 | 100% ✅ |
| DataSource 参数配置 | 9 | 9 | 0 | 100% ✅ |
| Top K 参数配置 | 6 | 2 | 4 | 33.3% ⚠️ |
| Threshold 参数配置 | 5 | 4 | 1 | 80.0% |
| Model 参数配置 | 2 | 1 | 1 | 50.0% |
| UI 交互 | 4 | 1 | 3 | 25.0% ⚠️ |
| **总计** | **28** | **19** | **9** | **67.9%** |

---

## 📝 详细测试用例

### 功能模块 1: Query 参数配置 (P0)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-RTV-001 | 修改 query_id 应正确保存到 node.data.query_id | P0 | ✅ | 单元 | 选择 Text Block 后保存 |
| TC-RTV-001-1 | query_id 应包含 id 和 label 字段 | P0 | ✅ | 单元 | 数据结构完整性验证 |

**数据结构**:
```typescript
query_id: {
  id: string;      // Text Block 节点 ID
  label: string;   // Text Block 节点标签
} | undefined
```

---

### 功能模块 2: DataSource 参数配置 (P0 + P1 + P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-RTV-002 | 添加 dataSource 应正确保存到 node.data.dataSource | P0 | ✅ | 单元 | 添加数据源保存 |
| TC-RTV-002-1 | dataSource 项应包含 id, label, index_item 字段 | P0 | ✅ | 单元 | 数据结构验证 |
| TC-RTV-005 | 应能添加多个不同的 dataSource 项 | P1 | ✅ | 单元 | 多数据源支持 |
| TC-RTV-005-1 | 不应添加重复的 dataSource 项 | P1 | ✅ | 单元 | ID 去重验证 |
| TC-RTV-006 | 删除 dataSource 项后应更新 node.data.dataSource | P1 | ✅ | 单元 | 删除功能 |
| TC-RTV-009 | dataSource 中的 index_item 应正确映射到源节点的 indexingList | P1 | ✅ | 单元 | 映射关系验证 |
| TC-RTV-009-1 | 只应包含 type=vector 且 status=done 的索引项 | P1 | ✅ | 单元 | 过滤规则验证 |
| TC-RTV-013 | 初始化时 dataSource 应为空数组 | P2 | ✅ | 单元 | 初始状态验证 |
| TC-RTV-013-1 | 删除所有 dataSource 项后应为空数组 | P2 | ✅ | 单元 | 清空场景验证 |

**数据结构**:
```typescript
dataSource: Array<{
  id: string;                          // Structured Block 节点 ID
  label: string;                       // Structured Block 节点标签
  index_item?: {                       // 索引项信息
    index_name: string;                // 索引名称
    collection_configs?: {             // 集合配置
      collection_name: string;         // 集合名称
    };
  };
}>
```

---

### 功能模块 3: Top K 参数配置 (P0 + P1 + P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-RTV-003 | 修改 top_k 应正确保存到 node.data.top_k | P0 | ❌ | 单元 | 输入框定位问题 |
| TC-RTV-003-1 | top_k 应为数字类型 | P0 | ✅ | 单元 | 类型验证通过 |
| TC-RTV-007 | 应正确保存 top_k 最小值 (1) | P1 | ❌ | 单元 | 输入框定位问题 |
| TC-RTV-007-1 | 应正确保存 top_k 最大值 (100) | P1 | ❌ | 单元 | 输入框定位问题 |
| TC-RTV-011 | 清空 top_k 输入框应保存为 undefined | P2 | ❌ | 单元 | 输入框定位问题 |
| TC-RTV-011-1 | 输入非数字字符应保存为 undefined | P2 | ❌ | 单元 | 输入框定位问题 |

**失败原因**: 测试中的输入框定位逻辑需要优化，无法找到正确的 Top K 输入框。

**数据结构**:
```typescript
top_k: number | undefined  // 有效范围: 1-100, 默认值: 5
```

---

### 功能模块 4: Threshold 参数配置 (P0 + P1 + P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-RTV-004 | 修改 threshold 应正确保存到 node.data.extra_configs.threshold | P0 | ❌ | 单元 | 输入框定位问题 |
| TC-RTV-004-1 | threshold 应在 extra_configs 对象中 | P0 | ✅ | 单元 | 数据结构验证 |
| TC-RTV-008 | 应正确保存 threshold 最小值 (0) | P1 | ✅ | 单元 | 边界值测试通过 |
| TC-RTV-008-1 | 应正确保存 threshold 最大值 (1) | P1 | ✅ | 单元 | 边界值测试通过 |
| TC-RTV-012 | 清空 threshold 输入框应保存为 undefined | P2 | ✅ | 单元 | 无效值处理 |

**数据结构**:
```typescript
extra_configs: {
  threshold: number | undefined;  // 有效范围: 0-1, 默认值: 0.7
}
```

---

### 功能模块 5: Model 参数配置 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-RTV-010 | 打开高级设置后应显示 Model 选项 | P2 | ❌ | 单元 | 高级设置展开问题 |
| TC-RTV-010-1 | Model 参数应支持三个 Perplexity 模型选项 | P2 | ✅ | 单元 | 模型列表验证 |

**数据结构**:
```typescript
extra_configs: {
  model: 
    | 'llama-3.1-sonar-small-128k-online'
    | 'llama-3.1-sonar-large-128k-online'
    | 'llama-3.1-sonar-huge-128k-online'
    | undefined;
}
```

---

### 功能模块 6: UI 交互 (P3)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-RTV-014 | 点击节点按钮应打开配置菜单 | P3 | ✅ | 单元 | 菜单打开验证 |
| TC-RTV-014-1 | 配置菜单应包含所有必需字段 | P3 | ✅ | 单元 | 字段完整性验证 |
| TC-RTV-015 | 点击高级设置切换按钮应展开 Model 选项 | P3 | ❌ | 单元 | 高级设置交互问题 |
| TC-RTV-015-1 | 再次点击应收起高级设置 | P3 | ❌ | 单元 | 切换状态问题 |

---

## 🔧 测试执行结果

### 最后执行时间
- **日期**: 2025-10-24
- **测试框架**: Vitest v3.2.4
- **测试环境**: jsdom
- **执行时长**: 10.02s

### 执行命令
```bash
npm test -- __tests__/retrieving-edge-node/unit/Retrieving.params.test.tsx --run
```

### 测试输出摘要
```
Test Files  1 passed (1)
     Tests  9 failed | 19 passed (28)
  Start at  14:47:06
  Duration  10.02s
```

---

## 🐛 已知问题和待修复

### 高优先级问题 (影响P0测试)

#### 1. Top K 输入框定位问题
- **影响用例**: TC-RTV-003 (P0)
- **失败原因**: 测试无法正确定位 Top K 输入框
- **建议修复**: 
  - 为 Top K 输入框添加唯一的 `data-testid` 属性
  - 或优化输入框查找逻辑

#### 2. Threshold 输入框修改问题
- **影响用例**: TC-RTV-004 (P0)
- **失败原因**: 虽然能找到输入框，但修改值后 setNodes 未被调用
- **建议修复**: 检查组件的防抖逻辑，可能需要在测试中等待更长时间

### 中优先级问题 (影响P1/P2测试)

#### 3. Top K 边界值测试失败
- **影响用例**: TC-RTV-007 (P1), TC-RTV-011 (P2)
- **失败原因**: 与问题 #1 相同
- **建议修复**: 同问题 #1

#### 4. 高级设置展开问题
- **影响用例**: TC-RTV-010 (P2), TC-RTV-015 (P3)
- **失败原因**: 点击高级设置切换按钮后，Model 选项未显示
- **可能原因**: 
  - 按钮未正确触发状态变化
  - 需要等待动画完成
- **建议修复**: 增加等待时间或检查状态切换逻辑

---

## 🎯 改进建议

### 短期改进 (1-2天)

1. **为关键输入框添加 data-testid**
   ```tsx
   // Top K 输入框
   <input
     data-testid="retrieving-top-k-input"
     type="number"
     ...
   />
   
   // Threshold 输入框
   <input
     data-testid="retrieving-threshold-input"
     type="number"
     ...
   />
   ```

2. **增加测试等待时间**
   - 对于有防抖的输入，增加 `waitFor` 超时时间
   - 对于动画，添加适当的延迟

### 中期改进 (1周)

1. **优化测试查找策略**
   - 使用更可靠的选择器
   - 减少对 DOM 结构的依赖

2. **补充集成测试**
   - 针对失败的 UI 交互用例
   - 测试完整的用户操作流程

---

## 📚 数据结构完整定义

### RetrievingConfigNodeData

```typescript
type RetrievingConfigNodeData = {
  // 【必需 P0】数据源列表
  dataSource: {
    id: string;                    // 源节点 ID
    label: string;                 // 源节点标签
    index_item?: {                 // 索引项信息
      index_name: string;          // 索引名称
      collection_configs?: {       // 集合配置
        collection_name: string;   // 集合名称
      };
    };
  }[];
  
  // 【内部使用】子菜单类型
  subMenuType: string | null;
  
  // 【必需 P0】Top K 参数
  top_k: number | undefined;
  
  // 【内部使用】内容
  content: string | null;
  
  // 【必需 P0】查询输入
  query_id: {
    id: string;                    // Query 节点 ID
    label: string;                 // Query 节点标签
  } | undefined;
  
  // 【内部使用】向量索引结构化数据
  structuredWithVectorIndexing: string[];
  
  // 【P0+P2】额外配置
  extra_configs: {
    model:                         // 【P2】Perplexity 模型(可选)
      | 'llama-3.1-sonar-small-128k-online'
      | 'llama-3.1-sonar-large-128k-online'
      | 'llama-3.1-sonar-huge-128k-online'
      | undefined;
    threshold: number | undefined; // 【P0】相似度阈值
  };
};
```

---

## 📖 参考资料

### 相关文件
- 组件源码: `app/components/workflow/edgesNode/edgeNodesNew/Retrieving.tsx`
- 测试文件: `__tests__/retrieving-edge-node/unit/Retrieving.params.test.tsx`
- 测试文档: `__tests__/retrieving-edge-node/Retrieving-测试文档.md` (本文档)

### 其他测试文档参考
- [JSON Block Node 测试文档](../json-block-node/docs/JsonNodeNew-测试文档.md)
- [LLM Edge Node 测试](../llm-edge-node/)

### 技术文档
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Vitest 测试框架](https://vitest.dev/)
- [React Flow 文档](https://reactflow.dev/)

---

## 📝 版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.1 | 2025-10-24 | ✅ 测试可运行，19/28 通过<br>🐛 标记 9 个失败用例<br>📊 添加详细覆盖率统计<br>💡 提供改进建议 |
| v1.0 | 2025-10-24 | 初始版本，24个测试用例规划<br>包含 P0-P3 四个优先级<br>覆盖 Query、DataSource、Top K、Threshold、Model、UI 六大模块 |

---

*当前版本: v1.1*  
*最后更新: 2025-10-24*  
*维护者: 测试团队*  
*状态: ✅ 测试可运行，67.9% 通过率*
