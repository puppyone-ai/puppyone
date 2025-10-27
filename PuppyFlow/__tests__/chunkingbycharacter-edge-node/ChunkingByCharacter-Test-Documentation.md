# ChunkingByCharacter Edge Node 测试文档

## 文档说明
- **组件路径**: `PuppyFlow/app/components/workflow/edgesNode/edgeNodesNew/ChunkingByCharacter.tsx`
- **组件类型**: Edge Node (边缘节点)
- **核心职责**: 按字符分块文本，使用分隔符（delimiters）配置分割点
- **目标平台**: 桌面端
- **测试状态**: ✅ 测试完成，12/12 通过 (100%)

---

## 📊 测试用例覆盖情况总览

### 统计摘要

| 状态 | 数量 | 占比 | 说明 |
|------|------|------|------|
| ✅ 已通过 | 12 | 100% | 测试通过 |
| ❌ 失败 | 0 | 0% | 测试失败 |
| **总计** | **12** | **100%** | 已实现的测试用例 |

### 按优先级的覆盖情况

| 优先级 | 总数 | 通过 | 失败 | 覆盖率 |
|--------|------|------|------|--------|
| **P0** | 4 | 4 | 0 | 100% ✅ |
| **P1** | 4 | 4 | 0 | 100% ✅ |
| **P2** | 4 | 4 | 0 | 100% ✅ |
| **总计** | **12** | **12** | **0** | **100%** ✅ |

### 按功能模块的覆盖情况

| 功能模块 | 测试数 | 通过 | 失败 | 覆盖率 |
|---------|--------|------|------|--------|
| delimiters 数组管理 (P0) | 4 | 4 | 0 | 100% ✅ |
| 分隔符添加和显示 (P1) | 4 | 4 | 0 | 100% ✅ |
| 初始化和 UI 交互 (P2) | 4 | 4 | 0 | 100% ✅ |
| **总计** | **12** | **12** | **0** | **100%** ✅ |

---

## 📝 详细测试用例

### 功能模块 1: delimiters 数组管理 (P0)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-CBC-001 | 添加分隔符应正确保存到 node.data.delimiters | P0 | ✅ | 单元 | 核心数组操作 |
| TC-CBC-001-1 | delimiters 应为数组类型 | P0 | ✅ | 单元 | 类型验证 |
| TC-CBC-002 | 删除分隔符应正确更新 node.data.delimiters | P0 | ✅ | 单元 | 核心数组操作 |
| TC-CBC-003 | delimiters 数据结构验证 | P0 | ✅ | 单元 | 双重保存验证 |

**数据结构**:
```typescript
ChunkingConfigNodeData = {
  looped: boolean | undefined;
  subMenuType: string | null;
  sub_chunking_mode: 'size' | 'tokenizer' | undefined;
  content: string | null;  // JSON.stringify(delimiters)
  delimiters?: string[];   // 分隔符数组
  extra_configs: { ... };
}
```

**测试场景**:

#### TC-CBC-001: 添加分隔符保存验证
1. 渲染 ChunkingByCharacter 节点（默认 delimiters: `[',', ';', '\n']`）
2. 打开配置菜单
3. 点击 "+" 按钮显示自定义输入框
4. 输入 "|" 并按 Enter
5. 验证 `node.data.delimiters` 包含 "|"
6. 验证 `node.data.content` 是 delimiters 的 JSON 字符串

**预期结果**:
```typescript
node.data.delimiters === [',', ';', '\n', '|']
node.data.content === '[\",\",\";\",\"\\n\",\"|\"]'
```

#### TC-CBC-001-1: delimiters 类型验证
1. 创建节点，设置 `delimiters: [',', ';']`
2. 验证 `Array.isArray(node.data.delimiters)` 为 true
3. 验证每个元素都是 string 类型

#### TC-CBC-002: 删除分隔符保存验证
1. 渲染节点（默认 3 个分隔符）
2. 打开配置菜单
3. 悬停在第一个分隔符 "," 上，出现删除按钮
4. 点击删除按钮
5. 验证 `node.data.delimiters` 不再包含 ","
6. 验证长度变为 2

#### TC-CBC-003: 数据结构双重保存验证
1. 添加分隔符 "-"
2. 验证 `node.data.delimiters` 包含 "-"
3. 验证 `node.data.content` 是 delimiters 数组的 JSON 字符串
4. 验证 `JSON.parse(node.data.content)` 与 `node.data.delimiters` 相同

**关键行号**: 
- 87-107 (delimiters state 初始化)
- 160-167 (addDelimiter 函数)
- 170-172 (removeDelimiter 函数)
- 175-199 (useEffect 更新 node.data)
- 677-705 (分隔符显示和删除 UI)

**重要说明**:
- 分隔符同时保存在 `delimiters` 和 `content` 字段（向后兼容）
- 使用 `requestAnimationFrame` 延迟更新
- 支持重复添加已存在的分隔符（需要去重逻辑）

---

### 功能模块 2: 分隔符添加和显示 (P1)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-CBC-004 | 从常用分隔符列表添加 | P1 | ✅ | 单元 | 快捷操作 |
| TC-CBC-005 | 添加自定义分隔符（输入框） | P1 | ✅ | 单元 | 自定义输入 |
| TC-CBC-006 | 特殊字符显示验证 | P1 | ✅ | 单元 | UI 显示 |
| TC-CBC-007 | 点击 Run 按钮应触发执行 | P1 | ✅ | 单元 | 执行功能 |

**测试场景**:

#### TC-CBC-004: 常用分隔符列表添加
1. 渲染节点
2. 打开配置菜单
3. 在 "Common delimiters" 区域，找到 "Period (.)" 按钮
4. 点击该按钮
5. 验证 `node.data.delimiters` 包含 "."
6. 验证该按钮样式变化（已选中状态）

**常用分隔符列表**:
```typescript
[
  { label: 'Comma (,)', value: ',' },
  { label: 'Semicolon (;)', value: ';' },
  { label: 'Enter (\\n)', value: '\n' },
  { label: 'Tab (\\t)', value: '\t' },
  { label: 'Space', value: ' ' },
  { label: 'Period (.)', value: '.' },
  { label: 'Pipe (|)', value: '|' },
  { label: 'Dash (-)', value: '-' },
]
```

#### TC-CBC-005: 自定义分隔符输入
1. 渲染节点
2. 打开配置菜单
3. 点击 "+" 按钮
4. 验证输入框出现并自动聚焦
5. 输入 "#"
6. 按 Enter 键
7. 验证 "#" 被添加到 delimiters
8. 验证输入框消失
9. 按 Escape 键应关闭输入框（不添加）

#### TC-CBC-006: 特殊字符显示验证
1. 渲染节点（默认包含 '\n'）
2. 打开配置菜单
3. 验证 '\n' 显示为 Enter 图标 + "Enter" 文字
4. 添加 '\t'，验证显示为 "Tab"
5. 添加 ' '，验证显示为 "Space"
6. 添加 ","，验证显示为 ","（普通字符原样显示）

**特殊字符映射** (line 269-302):
```typescript
delimiterDisplay = (delimiter: string) => {
  switch (delimiter) {
    case '\n': return <Enter SVG> + "Enter";
    case '\t': return "Tab";
    case ' ': return "Space";
    default: return delimiter;
  }
}
```

#### TC-CBC-007: Run 按钮功能
1. 渲染节点
2. 打开配置菜单
3. 找到配置菜单中的 Run 按钮
4. 点击 Run 按钮
5. 验证 `runSingleEdgeNode` 被调用
6. 验证调用参数包含正确的 `parentId` 和 `targetNodeType: 'structured'`

**关键行号**:
- 72-84 (commonDelimiters 定义)
- 254-266 (handleCustomDelimiterInput)
- 269-302 (delimiterDisplay)
- 140-157 (handleDataSubmit)
- 747-759 (常用分隔符按钮)

---

### 功能模块 3: 初始化和 UI 交互 (P2)

| 编号 | 描述 | 优先级 | 是否已测试 | 测试类型 | 备注 |
|------|------|--------|-----------|---------|------|
| TC-CBC-008 | 分隔符默认值验证 | P2 | ✅ | 单元 | 默认值 |
| TC-CBC-009 | 点击节点按钮应打开配置菜单 | P2 | ✅ | 单元 | 菜单展开 |
| TC-CBC-010 | 组件挂载后验证 | P2 | ✅ | 单元 | 组件初始化 |
| TC-CBC-011 | 重复分隔符不应重复添加 | P2 | ✅ | 单元 | 去重逻辑 |

**测试场景**:

#### TC-CBC-008: 默认值验证
1. 创建新的 ChunkingByCharacter 节点（无初始配置）
2. 验证 `node.data.delimiters` 默认值为 `[',', ';', '\n']`
3. 验证 `node.data.content` 为该数组的 JSON 字符串

**默认值定义** (line 106):
```typescript
return [',', ';', '\n']; // 默认值
```

#### TC-CBC-009: 配置菜单展开
1. 渲染节点
2. 点击节点按钮
3. 验证配置菜单显示
4. 验证菜单包含:
   - 标题 "Chunk By Character"
   - InputOutputDisplay 组件
   - Delimiters 区域
   - 当前分隔符列表
   - 常用分隔符列表

#### TC-CBC-010: 组件挂载验证
1. 渲染组件
2. 验证组件已渲染
3. 验证节点按钮存在，文本为 "Chunk" 和 "Char"
4. 验证 SVG 图标存在

#### TC-CBC-011: 重复分隔符去重
1. 渲染节点（默认包含 ","）
2. 打开配置菜单
3. 尝试再次添加 ","
4. 验证 delimiters 数组中只有一个 ","
5. 验证数组长度没有增加

**去重逻辑** (line 162):
```typescript
if (value && !delimiters.includes(value)) {
  setDelimiters(prev => [...prev, value]);
}
```

**关键行号**:
- 87-107 (useState 初始化和默认值)
- 320-338 (onClickButton)
- 462-557 (主按钮和 Handles)
- 566-766 (配置菜单)

---

## 🎯 测试重点和策略

### 核心测试点

#### 1. **delimiters 数组管理** ⭐⭐⭐⭐⭐
这是该节点的**唯一可配置参数**，必须重点测试：
- ✅ 添加分隔符
- ✅ 删除分隔符
- ✅ 初始化默认值
- ✅ 数组去重逻辑
- ✅ 双重保存（delimiters + content）

#### 2. **多种添加方式** ⭐⭐⭐⭐
支持 3 种方式添加分隔符：
1. 从常用分隔符列表点击添加
2. 通过自定义输入框添加（Enter 确认，Escape 取消）
3. 代码直接设置（测试数据初始化）

#### 3. **特殊字符处理** ⭐⭐⭐
特殊字符需要特殊显示：
- `\n` → Enter 图标 + "Enter"
- `\t` → "Tab"
- ` ` (空格) → "Space"
- 其他字符原样显示

#### 4. **数据持久化** ⭐⭐⭐⭐⭐
使用 `requestAnimationFrame` + `setNodes` 方式更新：
```typescript
useEffect(() => {
  if (!isOnGeneratingNewNode && hasMountedRef.current) {
    requestAnimationFrame(() => {
      setNodes(prevNodes =>
        prevNodes.map(n => {
          if (n.id === id) {
            return {
              ...n,
              data: {
                ...n.data,
                delimiters: delimiters,
                content: JSON.stringify(delimiters),
              },
            };
          }
          return n;
        })
      );
    });
  }
}, [delimiters, ...]);
```

### 与其他节点的对比

| 特性 | ChunkingByCharacter | Convert2Structured | ChunkingByLength |
|------|---------------------|-------------------|------------------|
| 参数数量 | 1 个（delimiters） | 4+ 个 | 4 个 |
| 数据更新方式 | setNodes + RAF | setNodes + RAF | 直接修改 |
| 参数类型 | 数组 | 多种类型 | 多种类型 |
| UI 复杂度 | 中 | 高 | 中 |
| 特殊字符处理 | 是（3种） | 是（4种） | 否 |
| 去重逻辑 | 是 | 否 | N/A |
| 默认值 | `[',', ';', '\n']` | 无 | 有 |

**关键差异**:
1. **参数更简单**: 只有 1 个数组参数，相比 Convert2Structured 更简单
2. **数组操作**: 重点测试数组的增删改查
3. **去重逻辑**: 需要验证重复分隔符不会被添加
4. **特殊字符**: 与 Convert2Structured 类似，但映射略有不同

### 测试策略

#### P0 测试（4个）：核心数组操作
- **添加分隔符**: 验证新分隔符正确添加到数组
- **删除分隔符**: 验证分隔符从数组中移除
- **类型验证**: 确保 delimiters 是数组，元素是字符串
- **数据结构**: 验证双重保存（delimiters + content）

#### P1 测试（4个）：重要功能
- **常用分隔符**: 快捷添加功能
- **自定义输入**: 输入框交互（Enter, Escape）
- **特殊字符显示**: Enter, Tab, Space 的特殊显示
- **Run 功能**: 执行按钮

#### P2 测试（4个）：UI 和边界情况
- **默认值**: 初始化验证
- **菜单展开**: UI 交互
- **组件挂载**: 基本渲染
- **去重逻辑**: 防止重复添加

---

## 🔍 节点特性分析

### 1. 数据结构特点

**双重保存机制**:
```typescript
// 方式1: delimiters 字段（推荐）
node.data.delimiters = [',', ';', '\n'];

// 方式2: content 字段（向后兼容）
node.data.content = '[\",\",\";\",\"\\n\"]';
```

**初始化逻辑** (line 87-107):
```typescript
const [delimiters, setDelimiters] = useState<string[]>(() => {
  const nodeData = getNode(id)?.data;
  // 优先从 delimiters 字段读取
  if (nodeData?.delimiters && Array.isArray(nodeData.delimiters)) {
    return nodeData.delimiters;
  }
  // 其次从 content 字段解析
  if (nodeData?.content) {
    try {
      const parsed = typeof nodeData.content === 'string'
        ? JSON.parse(nodeData.content)
        : nodeData.content;
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }
  // 最后使用默认值
  return [',', ';', '\n'];
});
```

### 2. UI 交互特点

**分隔符显示区域**:
- 每个分隔符是一个橙色边框的小卡片
- 悬停时显示删除按钮（X）
- 特殊字符有特殊图标/文字

**添加分隔符流程**:
1. 点击 "+" 按钮 → 显示输入框
2. 输入框自动聚焦
3. 输入内容后按 Enter → 添加并关闭输入框
4. 按 Escape → 取消并关闭输入框
5. 失焦 → 关闭输入框（不添加）

**常用分隔符按钮**:
- 8 个常用分隔符快捷按钮
- 已添加的分隔符显示为选中状态（不同样式）
- 点击已选中的按钮不会重复添加

### 3. 性能优化

使用多个优化手段：
- `useMemo`: commonDelimiters, handleStyle, runButtonStyle
- `useCallback`: 所有事件处理函数
- `memo`: 组件本身使用 React.memo 包装
- 函数式 setState: 避免重复计算

### 4. 数据更新时序

```
用户操作 → setDelimiters(本地状态)
  ↓
useEffect 监听 delimiters 变化
  ↓
检查: !isOnGeneratingNewNode && hasMountedRef.current
  ↓
requestAnimationFrame 延迟执行
  ↓
setNodes 更新 node.data
  ↓
同时更新 delimiters 和 content 字段
```

**关键时序控制**:
- `hasMountedRef`: 避免首次渲染时触发更新
- `isOnGeneratingNewNode`: 避免节点创建时干扰
- `requestAnimationFrame`: 延迟到下一帧执行

---

## ✅ 测试结果详情

### 测试执行总结
- **测试时间**: 2025-10-27
- **测试文件**: `__tests__/chunkingbycharacter-edge-node/unit/ChunkingByCharacter.test.tsx`
- **执行命令**: `npx vitest __tests__/chunkingbycharacter-edge-node/unit/ChunkingByCharacter.test.tsx --run`
- **总耗时**: ~0.81s
- **总测试数**: 12
- **通过**: 12 (100%) ✅
- **失败**: 0 (0%)

### 🎉 完美通过！所有测试用例全部通过

#### ✅ P0 测试全部通过 (4/4, 100%)

**delimiters 数组管理 (4/4)**
- TC-CBC-001: 添加分隔符保存验证 ✅
- TC-CBC-001-1: delimiters 数组类型验证 ✅
- TC-CBC-002: 删除分隔符更新验证 ✅
- TC-CBC-003: 双重保存数据结构验证 ✅

**所有数组操作正常！双重保存机制工作完美！**

#### ✅ P1 测试全部通过 (4/4, 100%)

**分隔符添加和显示 (4/4)**
- TC-CBC-004: 常用分隔符列表添加 ✅
- TC-CBC-005: 自定义输入框添加 ✅
- TC-CBC-006: 特殊字符显示（Enter, Tab, Space）✅
- TC-CBC-007: Run 按钮触发执行 ✅

**3种添加方式都正常！特殊字符显示完美！**

#### ✅ P2 测试全部通过 (4/4, 100%)

**初始化和 UI 交互 (4/4)**
- TC-CBC-008: 默认值验证 ✅
- TC-CBC-009: 配置菜单展开 ✅
- TC-CBC-010: 组件挂载验证 ✅
- TC-CBC-011: 重复分隔符去重 ✅

**所有默认值正确！UI 交互流畅！去重逻辑完善！**

### 🌟 测试亮点

1. **连续第四个 100% 通过的节点** 🏆
   - 继 EditText、ChunkingAuto 和 ChunkingByLength 之后的又一次完美表现
   - 连续四个100%，测试质量持续保持高水准
   - 验证了数组参数管理的测试能力

2. **数组操作测试完整** 🎯
   - 添加、删除、去重三大核心操作全覆盖
   - 验证双重保存机制（delimiters + content）
   - 类型验证确保数组完整性

3. **多种添加方式全验证** ✨
   - 常用分隔符列表点击添加
   - 自定义输入框添加（Enter确认、Escape取消）
   - 自动聚焦、自动关闭等细节都验证

4. **特殊字符处理完善** 📝
   - `\n` → Enter 图标 + 文字 ✅
   - `\t` → "Tab" ✅
   - ` ` → "Space" ✅
   - 普通字符原样显示 ✅

5. **去重逻辑验证** 🔒
   - 重复分隔符不会被添加
   - 数组长度保持正确
   - 用户体验一致

### 📈 与其他节点对比

| 节点 | 测试数 | 通过率 | 首次通过 | 参数类型 | 数据更新方式 | 复杂度 |
|------|-------|--------|----------|---------|-------------|--------|
| **ChunkingByCharacter** | **12** | **100%** ✅ | **是** ✅ | 数组 | setNodes+RAF | 中 |
| **ChunkingByLength** | **14** | **100%** ✅ | **是** ✅ | 4个 | 直接修改 | 中 |
| **ChunkingAuto** | **7** | **100%** ✅ | **是** ✅ | 0个 | N/A | 极低 |
| **EditText** | **18** | **100%** ✅ | **是** ✅ | 3个 | setNodes+RAF | 中 |
| Convert2Structured | 24 | 87.5% | 否 | 数组+多个 | setNodes+RAF | 高 |
| SearchGoogle | 16 | 81.25% | 否 | 1个 | setNodes+RAF | 低 |
| SearchPerplexity | 14 | 71.4% | 否 | 1个 | setNodes+RAF | 低 |
| IfElse | 22 | 81.8% | 否 | 多个 | setNodes+RAF | 高 |
| Copy | 10 | 70% | 否 | 0个 | N/A | 极低 |

**ChunkingByCharacter 是第四个首次运行即 100% 通过的节点！** 🎉

**连续四个 100% 通过：**
1. EditText (18个测试, 3参数, setNodes方式)
2. ChunkingAuto (7个测试, 0参数)
3. ChunkingByLength (14个测试, 4参数, 直接修改方式)
4. **ChunkingByCharacter (12个测试, 1数组参数, setNodes方式)** ⭐

**成功原因**:
1. ✅ 测试经验丰富（第10个节点）
2. ✅ 数组操作测试策略成熟
3. ✅ 特殊字符处理验证完善
4. ✅ 多种添加方式全覆盖
5. ✅ 去重逻辑测试细致
6. ✅ 双重保存机制验证

### 💡 测试策略创新

**数组参数管理的测试方法**:

1. **增删改查全覆盖** 📊
   ```typescript
   // 添加
   fireEvent.click(addButton);
   fireEvent.change(input, { target: { value: '|' } });
   fireEvent.keyDown(input, { key: 'Enter' });
   
   // 删除
   fireEvent.click(deleteButton);
   
   // 查询（验证）
   expect(node.data.delimiters).toContain('|');
   expect(node.data.delimiters).not.toContain(',');
   ```

2. **多种添加方式** ⚡
   - 常用列表点击
   - 自定义输入Enter确认
   - Escape取消输入
   - 失焦自动关闭

3. **特殊字符测试** ✨
   ```typescript
   // 使用 getAllByText 处理多个匹配
   const tabElements = screen.getAllByText((content, element) => {
     return element?.textContent === 'Tab' || content === 'Tab';
   });
   expect(tabElements.length).toBeGreaterThan(0);
   ```

4. **双重保存验证** 🔐
   ```typescript
   // 验证两个字段同步
   expect(node.data.delimiters).toContain('-');
   const parsedContent = JSON.parse(node.data.content);
   expect(parsedContent).toEqual(node.data.delimiters);
   ```

### 🔧 技术亮点

**1. 数组操作完整性**
- 添加：3种方式全支持
- 删除：悬停显示删除按钮
- 去重：自动防止重复
- 持久化：RAF + setNodes

**2. 特殊字符处理**
- 视觉化显示（图标+文字）
- 用户友好的表示
- 跨平台兼容

**3. 双重保存机制**
- `delimiters`: 数组格式（推荐）
- `content`: JSON字符串（向后兼容）
- 自动同步更新

**4. UI 细节完善**
- 输入框自动聚焦
- Enter确认，Escape取消
- 悬停显示删除按钮
- 已选中分隔符样式区分

---

## 🐛 已知问题和待修复项

### 实际测试结果

**✅ 无已知问题！所有测试全部通过！**

由于所有测试都通过了，以下是之前预判的潜在问题分析（供参考）：

### 潜在问题分析

#### 1. 与 Convert2Structured 的分隔符管理对比

**问题描述**: 
ChunkingByCharacter 和 Convert2Structured 都有分隔符管理功能，但实现方式不同：

**ChunkingByCharacter**:
```typescript
// 去重逻辑在 addDelimiter 中
if (value && !delimiters.includes(value)) {
  setDelimiters(prev => [...prev, value]);
}
```

**Convert2Structured**:
```typescript
// 可能允许重复添加（需要验证）
setDelimiters(prev => [...prev, value]);
```

**影响**: 
- 用户体验一致性
- 数据完整性

**测试验证**:
- TC-CBC-011: 验证去重逻辑
- TC-C2S-006: 对比 Convert2Structured 的行为

#### 2. requestAnimationFrame 异步更新

**问题描述**: 
与其他使用 RAF 的节点相同，参数更新有延迟。

**影响**: 
- 测试需要使用 `waitFor` 处理异步
- 可能出现 "expected A to be B" 错误

**测试策略**:
```typescript
// 修改 delimiters
fireEvent.click(addButton);
fireEvent.change(input, { target: { value: '|' } });
fireEvent.keyDown(input, { key: 'Enter' });

// 使用 waitFor 等待异步更新
await waitFor(() => {
  const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
  const updatedNode = lastCall[0]([mockNode])[0];
  expect(updatedNode.data.delimiters).toContain('|');
}, { timeout: 3000 });
```

#### 3. 特殊字符的跨平台兼容性

**问题描述**: 
`\n`, `\t` 等特殊字符在不同操作系统可能有不同表示。

**潜在风险**:
- Windows: `\r\n`
- Unix/Mac: `\n`
- 测试环境 vs 生产环境差异

**建议**:
- 统一使用 `\n`
- 后端处理平台差异
- 测试覆盖不同输入格式

#### 4. 空分隔符处理

**问题描述**: 
代码中的去重检查 `if (value && !delimiters.includes(value))`

**潜在问题**:
- `value = ''` 时，不会添加（正确）
- 但是否应该给用户提示？
- 空字符串是否是有效的分隔符？

**建议**:
- 明确定义空字符串的行为
- 添加用户友好的提示

---

## 📋 测试文件结构规划

### 目录结构
```
__tests__/
  └── chunkingbycharacter-edge-node/
      ├── ChunkingByCharacter-测试文档.md (本文件)
      └── unit/
          └── ChunkingByCharacter.test.tsx (单元测试)
```

### 测试文件大纲

```typescript
describe('ChunkingByCharacter Edge Node - 完整测试', () => {
  // Setup
  let mockSetNodes, mockGetNode, testNode;
  
  beforeEach(() => {
    // 初始化 mocks
  });
  
  // P0: delimiters 数组管理 (4个测试)
  describe('P0: delimiters 数组管理', () => {
    it('TC-CBC-001: 添加分隔符应正确保存');
    it('TC-CBC-001-1: delimiters 应为数组类型');
    it('TC-CBC-002: 删除分隔符应正确更新');
    it('TC-CBC-003: 数据结构双重保存验证');
  });
  
  // P1: 分隔符添加和显示 (4个测试)
  describe('P1: 分隔符添加和显示', () => {
    it('TC-CBC-004: 从常用分隔符列表添加');
    it('TC-CBC-005: 添加自定义分隔符');
    it('TC-CBC-006: 特殊字符显示验证');
    it('TC-CBC-007: Run 按钮触发执行');
  });
  
  // P2: 初始化和 UI 交互 (4个测试)
  describe('P2: 初始化和 UI 交互', () => {
    it('TC-CBC-008: 分隔符默认值验证');
    it('TC-CBC-009: 配置菜单展开');
    it('TC-CBC-010: 组件挂载验证');
    it('TC-CBC-011: 重复分隔符去重');
  });
});
```

---

## 💡 测试技巧和注意事项

### 1. 异步处理
```typescript
// ❌ 错误：立即检查
fireEvent.click(addButton);
expect(node.data.delimiters).toContain('|'); // 可能失败

// ✅ 正确：使用 waitFor
await waitFor(() => {
  expect(node.data.delimiters).toContain('|');
}, { timeout: 3000 });
```

### 2. 特殊字符输入
```typescript
// 输入换行符
fireEvent.change(input, { target: { value: '\n' } });
fireEvent.keyDown(input, { key: 'Enter' });

// 验证显示
expect(screen.getByText('Enter')).toBeInTheDocument();
// SVG 图标也应该存在
const svg = screen.getByText('Enter').parentElement?.querySelector('svg');
expect(svg).toBeInTheDocument();
```

### 3. 删除按钮交互
```typescript
// 悬停触发删除按钮显示
const delimiterCard = screen.getByText(',').closest('div');
fireEvent.mouseEnter(delimiterCard);

// 找到删除按钮（X）
const deleteButton = within(delimiterCard).getByRole('button');
fireEvent.click(deleteButton);

await waitFor(() => {
  expect(node.data.delimiters).not.toContain(',');
});
```

### 4. 常用分隔符按钮
```typescript
// 找到并点击 "Period (.)" 按钮
const periodButton = screen.getByText(/Period \(\.\)/i);
fireEvent.click(periodButton);

await waitFor(() => {
  expect(node.data.delimiters).toContain('.');
});

// 验证按钮样式变化（已选中）
expect(periodButton).toHaveClass('bg-[#252525]');
```

---

## 📊 优先级分级详解

### P0 级别（致命）- 4个测试
**为什么 P0**:
- **添加/删除分隔符**: 这是节点的唯一功能，如果失败，节点完全不可用
- **数据类型验证**: 类型错误会导致后端处理失败
- **双重保存**: 数据丢失会影响节点配置的持久化

**影响范围**: 所有使用该节点的用户
**修复优先级**: 立即回滚或熔断

### P1 级别（严重）- 4个测试
**为什么 P1**:
- **常用分隔符**: 重要的快捷功能，失败会降低用户体验
- **自定义输入**: 高级用户的重要功能
- **特殊字符显示**: UI 显示错误会造成混淆
- **Run 功能**: 执行失败会阻断核心流程

**影响范围**: 大量用户的核心体验降级
**修复优先级**: 快速修复

### P2 级别（中等）- 4个测试
**为什么 P2**:
- **默认值**: 影响首次使用体验，但不阻断功能
- **菜单展开**: UI 交互问题，可重试
- **组件挂载**: 基本渲染，极少失败
- **去重逻辑**: 边界情况，影响小

**影响范围**: 偶发或非核心功能
**修复优先级**: 工作时段内修复

---

**文档版本**: v1.1  
**创建日期**: 2025-10-27  
**最后更新**: 2025-10-27  
**测试执行日期**: 2025-10-27  
**测试通过率**: 100% (12/12) ✅  
**节点类型**: 有参数配置（1个数组参数，分隔符管理）  
**数据更新方式**: setNodes + requestAnimationFrame（传统方式）

