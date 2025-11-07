# 单元测试总结文档

生成时间: 2025-11-07

## 📋 目录

- [测试概况](#测试概况)
- [Edge Nodes (边缘节点)](#edge-nodes-边缘节点)
  - [LLM](#1-llm-edge-node)
  - [Generate](#2-generate-edge-node)
  - [Retrieving](#3-retrieving-edge-node)
  - [IfElse](#4-ifelse-edge-node)
  - [SearchGoogle](#5-searchgoogle-edge-node)
  - [SearchPerplexity](#6-searchperplexity-edge-node)
  - [ChunkingByLength](#7-chunkingbylength-edge-node)
  - [ChunkingByCharacter](#8-chunkingbycharacter-edge-node)
  - [ChunkingAuto](#9-chunkingauto-edge-node)
  - [Convert2Structured](#10-convert2structured-edge-node)
  - [Convert2Text](#11-convert2text-edge-node)
  - [EditStructured](#12-editstructured-edge-node)
  - [EditText](#13-edittext-edge-node)
  - [Copy](#14-copy-edge-node)
  - [Load](#15-load-edge-node)
- [Block Nodes (块节点)](#block-nodes-块节点)
  - [JSON Block Node](#1-json-block-node)
  - [File Block Node](#2-file-block-node)

---

## 测试概况

- **测试文件总数**: 30 (新增 3 个 TextBlockNode 测试)
- **测试用例总数**: 411 (通过: 384, 失败: 12, 跳过: 15)
- **节点总数**: 18 个节点 (15 个 Edge Nodes + 3 个 Block Nodes)
- **已测试节点**: 18 个 (覆盖率: **100%** ✅)
- **状态**: TextBlockNode 测试已创建，部分用例待优化 🚧
- **覆盖范围**: 参数配置、数据保存、UI交互、执行流程、存储管理、连接管理

---

## Edge Nodes (边缘节点)

### 1. LLM Edge Node

#### 测试文件 1.1: `LLM.model.test.tsx` (10 tests)

**P0 致命 - 模型选择核心功能**
- **TC-LLM-001**: 选择模型 - 模型选择后应保存到 node.data.modelAndProvider
- **TC-LLM-002**: 默认模型初始化 - 新节点应自动选择第一个可用 LLM 模型
- **TC-LLM-003**: 模型持久化 - 已保存的模型应正确恢复

**P1 严重 - 模型配置管理**
- **TC-LLM-004**: 切换模型 - 切换后数据应更新，旧模型信息应被完全覆盖
- **TC-LLM-005**: Local vs Cloud 模型 - 应正确区分本地和云端模型
- **TC-LLM-007**: Provider 正确保存 - provider 字段应正确保存

#### 测试文件 1.2: `LLM.messages.test.tsx` (12 tests)

**P0 致命 - 消息管理核心**
- **TC-LLM-009**: 编辑消息内容 - 修改消息后应保存到 node.data.content
- **TC-LLM-010**: 默认消息初始化 - 新节点应包含默认 system 和 user 消息
- **TC-LLM-011**: 消息持久化 - 已保存的消息应正确恢复

**P1 严重 - 消息操作**
- **TC-LLM-012**: 添加多条消息 - 应支持多条消息保存
- **TC-LLM-013**: 删除消息 - 删除消息后数组应更新
- **TC-LLM-014**: 消息顺序 - 调整顺序后应正确保存
- **TC-LLM-017**: 使用输入变量 - 变量语法应保存到 content，不应被解析或转义
- **TC-LLM-019**: 多个变量 - 多个变量应保持原样

#### 测试文件 1.3: `LLM.output.test.tsx` (7 tests)

**P0 致命 - 输出类型配置**
- **TC-LLM-020**: 选择 text 输出 - structured_output 应为 false
- **TC-LLM-021**: 选择 structured text 输出 - structured_output 应为 true
- **TC-LLM-023**: 输出类型持久化 - 已保存的输出类型应正确恢复

**P1 严重 - 输出类型切换**
- **TC-LLM-022**: 默认输出类型 - 默认应为 text (structured_output=false)
- **TC-LLM-024**: 切换输出类型 - 从 text 切换到 structured text，再切换回来

#### 测试文件 1.4: `LLM.settings.test.tsx` (9 tests)

**P1 严重 - 高级设置**
- **TC-LLM-025**: 设置 Base URL - 输入后应保存到 node.data
- **TC-LLM-026**: 默认 Base URL - 默认应为空字符串
- **TC-LLM-027**: Base URL 持久化 - 已保存的 Base URL 应正确恢复
- **TC-LLM-028**: 清空 Base URL - 删除内容后应保存为空字符串
- **TC-LLM-030**: 设置 Max Tokens - 修改后应保存到 node.data
- **TC-LLM-031**: 默认 Max Tokens - 默认应为 undefined 或合理默认值
- **TC-LLM-032**: Max Tokens 持久化 - 已保存的值应正确恢复
- **TC-LLM-033**: Max Tokens 最小值边界 - 设置为 1 和 128000 应接受并保存

---

### 2. Generate Edge Node

#### 测试文件 2.1: `Generate.params.test.tsx` (26 tests)

**P0 致命 - 核心参数保存**
- **TC-GEN-001**: Query 参数修改后保存 - query_ids 应正确保存到 node.data
- **TC-GEN-002**: Document 参数修改后保存 - document_ids 应正确保存到 node.data
- **TC-GEN-003**: Prompt Template 参数修改后保存 - promptTemplate 应正确保存
- **TC-GEN-004**: Model 参数修改后保存 - model 应正确保存到 node.data.model

**P1 严重 - 参数管理**
- **TC-GEN-001-2**: Query 参数切换更新 - 应能切换不同的 query_ids
- **TC-GEN-002-2**: Document 参数切换更新 - 应能切换不同的 document_ids
- **TC-GEN-003-2**: Prompt Template 切换应更新预览内容
- **TC-GEN-003-3**: 模板名称应正确格式化显示
- **TC-GEN-004-2**: 模型选项应显示 Local/Cloud 标签
- **TC-GEN-005**: Structured Output 开关切换

**P2 中等 - 初始化和默认值**
- **TC-GEN-003-4**: Prompt Template 初始默认值
- **TC-GEN-004-3**: Model 初始化时自动选择第一个可用 LLM 模型
- **TC-GEN-005-1**: Structured Output 初始值应为 false
- **TC-GEN-006**: Base URL 参数保存
- **TC-GEN-006-1**: Base URL 初始值应为空字符串
- **TC-GEN-007**: 高级设置展开/收起
- **TC-GEN-008**: 初始化从 node.data 加载现有配置
- **TC-GEN-008-1**: 无配置时使用默认值

---

### 3. Retrieving Edge Node

#### 测试文件 3.1: `Retrieving.params.test.tsx` (28 tests)

**P0 致命 - 核心参数保存**
- **TC-RTV-001**: Query 参数修改后保存
- **TC-RTV-002**: DataSource 参数修改后保存
- **TC-RTV-003**: Top K 参数修改后保存
- **TC-RTV-004**: Threshold 参数修改后保存

**P1 严重 - 参数管理**
- **TC-RTV-005**: 添加多个 DataSource 项
- **TC-RTV-006**: 删除 DataSource 项
- **TC-RTV-007**: Top K 边界值保存
- **TC-RTV-008**: Threshold 边界值保存
- **TC-RTV-009**: DataSource 与 IndexItem 映射关系

**P2 中等 - 高级配置**
- **TC-RTV-010**: 高级设置 Model 参数保存 - 应支持三个 Perplexity 模型选项
- **TC-RTV-011**: 无效 Top K 值处理
- **TC-RTV-012**: 无效 Threshold 值处理
- **TC-RTV-013**: 空 DataSource 处理

**P3 轻微 - UI 交互**
- **TC-RTV-014**: 菜单打开/关闭状态
- **TC-RTV-015**: 高级设置展开/收起

---

### 4. IfElse Edge Node

#### 测试文件 4.1: `IfElse.params.test.tsx` (22 tests)

**P0 致命 - Cases 数组管理**
- **TC-IE-001**: cases 数组修改后保存
- **TC-IE-001-1**: cases 应为数组类型
- **TC-IE-004**: Condition 类型修改应正确保存
- **TC-IE-004-1**: Condition 值(cond_v)修改应正确保存
- **TC-IE-005**: Condition 的源节点修改应正确保存
- **TC-IE-008**: Action 的源节点修改应正确保存
- **TC-IE-008-1**: Action 的目标节点修改应正确保存

**P1 严重 - 动态配置**
- **TC-IE-002**: 添加新 Case 应正确更新
- **TC-IE-002-1**: 删除 Case 应正确更新
- **TC-IE-003**: 新增 Case 应包含默认 condition 和 action
- **TC-IE-003-1**: 不能删除最后一个 Case
- **TC-IE-006**: 添加新 Condition 应正确更新
- **TC-IE-006-1**: 删除 Condition 应正确更新
- **TC-IE-007**: AND/OR 操作切换应正确保存
- **TC-IE-009**: 添加新 Action 应正确更新
- **TC-IE-009-1**: 删除 Action 应正确更新

**P2 中等 - 初始化和 UI**
- **TC-IE-010**: cases 初始化验证
- **TC-IE-010-1**: 从 node.data.cases 加载现有配置
- **TC-IE-011**: 默认 case 结构验证
- **TC-IE-012**: 组件挂载验证
- **TC-IE-013**: 配置菜单展开/收起
- **TC-IE-013-1**: 配置菜单初始状态

---

### 5. SearchGoogle Edge Node

#### 测试文件 5.1: `SearchGoogle.params.test.tsx` (16 tests)

**P0 致命 - 核心参数**
- **TC-SG-001**: top_k 参数修改后保存
- **TC-SG-001-1**: top_k 应为数字类型

**P1 严重 - 参数配置**
- **TC-SG-002**: 应能将 top_k 修改为不同的数值
- **TC-SG-003**: top_k 最小值 (1) 正确保存
- **TC-SG-003-1**: top_k 最大值 (20) 正确保存
- **TC-SG-004**: 清空 top_k 应保存为 undefined

**P2 中等 - 初始化和默认值**
- **TC-SG-005**: Settings 展开/收起功能
- **TC-SG-006**: top_k 默认值应为 5
- **TC-SG-006-1**: 从 node.data.top_k 加载现有配置
- **TC-SG-007**: showSettings 初始状态应为 false

---

### 6. SearchPerplexity Edge Node

#### 测试文件 6.1: `SearchPerplexity.params.test.tsx` (16 tests)

**P0 致命 - 模型参数**
- **TC-SP-001**: model 参数修改后保存
- **TC-SP-001-1**: model 应保存在 extra_configs 对象中
- **TC-SP-001-2**: model 应为有效的 Perplexity 模型名称

**P1 严重 - 模型切换**
- **TC-SP-002**: 应能切换到 'sonar' 模型
- **TC-SP-002-1**: 应能切换到 'sonar-pro' 模型
- **TC-SP-002-2**: 应能切换到 'sonar-reasoning-pro' 模型

**P2 中等 - 初始化**
- **TC-SP-003**: model 默认值应为 'sonar-pro'
- **TC-SP-003-1**: 从 node.data.extra_configs.model 加载现有配置
- **TC-SP-004**: 组件挂载验证
- **TC-SP-005**: Model 下拉框应显示所有 3 个模型选项

---

### 7. ChunkingByLength Edge Node

#### 测试文件 7.1: `ChunkingByLength.test.tsx` (14 tests)

**P0 致命 - 核心参数配置**
- **TC-CBL-001**: 修改 subChunkMode 应正确保存到 node.data
- **TC-CBL-001-1**: subChunkMode 应为有效值
- **TC-CBL-002**: 修改 chunkSize 应正确保存到 node.data.extra_configs
- **TC-CBL-002-1**: chunkSize 应为数字类型
- **TC-CBL-003**: 修改 overlap 应正确保存到 node.data.extra_configs
- **TC-CBL-003-1**: overlap 应为数字类型
- **TC-CBL-004**: 修改 handleHalfWord 应正确保存到 node.data.extra_configs

**P1 严重 - 重要功能**
- **TC-CBL-005**: 点击 Show 应展开 Settings
- **TC-CBL-005-1**: 点击 Hide 应收起 Settings
- **TC-CBL-006**: chunkSize 和 overlap 边界值测试
- **TC-CBL-007**: 点击 Run 按钮应触发执行

**P2 中等 - UI 交互**
- **TC-CBL-008**: 参数默认值验证
- **TC-CBL-009**: 点击节点按钮应打开配置菜单
- **TC-CBL-010**: 组件挂载后验证

---

### 8. ChunkingByCharacter Edge Node

#### 测试文件 8.1: `ChunkingByCharacter.test.tsx` (12 tests)

**P0 致命 - 分隔符管理**
- **TC-CBC-001**: 添加分隔符应正确保存到 node.data.delimiters
- **TC-CBC-001-1**: delimiters 应为数组类型
- **TC-CBC-002**: 删除分隔符应正确更新 node.data.delimiters
- **TC-CBC-003**: delimiters 数据结构验证（双重保存）

**P1 严重 - 分隔符操作**
- **TC-CBC-004**: 从常用分隔符列表添加
- **TC-CBC-005**: 添加自定义分隔符（输入框）
- **TC-CBC-006**: 特殊字符显示验证
- **TC-CBC-007**: 点击 Run 按钮应触发执行

**P2 中等 - UI 交互**
- **TC-CBC-008**: 分隔符默认值验证
- **TC-CBC-009**: 点击节点按钮应打开配置菜单
- **TC-CBC-010**: 组件挂载后验证
- **TC-CBC-011**: 重复分隔符不应重复添加

---

### 9. ChunkingAuto Edge Node

#### 测试文件 9.1: `ChunkingAuto.test.tsx` (7 tests)

**P0 致命 - 数据结构完整性**
- **TC-CA-001**: node.data 应包含必要字段
- **TC-CA-001-1**: sub_chunking_mode 应为 'size' 或 'tokenizer'
- **TC-CA-001-2**: extra_configs 应包含正确的子字段

**P1 严重 - 基本功能**
- **TC-CA-002**: 点击 Run 按钮应触发执行

**P2 中等 - UI 交互**
- **TC-CA-003**: 点击节点按钮应打开配置菜单
- **TC-CA-003-1**: 配置菜单应显示正确内容
- **TC-CA-004**: 组件挂载后验证

---

### 10. Convert2Structured Edge Node

#### 测试文件 10.1: `Convert2Structured.test.tsx` (24 tests)

**P0 致命 - execMode 参数配置**
- **TC-C2S-001**: 修改 execMode 应正确保存到 node.data
- **TC-C2S-001-1**: execMode 应为有效的模式值
- **TC-C2S-002**: 切换到 'JSON' 模式应正确保存
- **TC-C2S-002-1**: 切换到 'wrap into dict' 模式应正确保存
- **TC-C2S-002-2**: 切换到 'wrap into list' 模式应正确保存
- **TC-C2S-003**: 修改 dict_key 应正确保存
- **TC-C2S-003-1**: dict_key 应为字符串类型
- **TC-C2S-004**: 修改 length_separator 应正确保存
- **TC-C2S-004-1**: length_separator 应为数字类型

**P1 严重 - 分隔符管理**
- **TC-C2S-005**: 修改 list_separator 应正确保存
- **TC-C2S-005-1**: list_separator 应为数组类型
- **TC-C2S-005-2**: list_separator 应正确解析 JSON 字符串
- **TC-C2S-006**: 添加新分隔符应正确更新
- **TC-C2S-006-1**: 删除分隔符应正确更新
- **TC-C2S-007**: 从常用分隔符列表添加
- **TC-C2S-007-1**: 不能添加重复的分隔符
- **TC-C2S-008**: 特殊字符分隔符正确显示

**P2 中等 - 初始化和默认值**
- **TC-C2S-009**: execMode 默认值应为 'JSON'
- **TC-C2S-009-1**: length_separator 默认值应为 10
- **TC-C2S-009-2**: delimiters 默认值应为 [',',';','.','\\n']
- **TC-C2S-010**: 应从 node.data 加载现有配置
- **TC-C2S-011**: 点击节点按钮应打开配置菜单
- **TC-C2S-011-1**: 不同模式下显示对应配置项
- **TC-C2S-012**: 组件挂载后验证

---

### 11. Convert2Text Edge Node

#### 测试文件 11.1: `Convert2Text.test.tsx` (8 tests)

**P0 致命 - 数据结构完整性**
- **TC-C2T-001**: ModifyConfigNodeData 数据结构验证
- **TC-C2T-001-1**: content 字段类型验证

**P1 严重 - 基本功能**
- **TC-C2T-002**: 点击 Run 按钮应调用 runSingleEdgeNode
- **TC-C2T-002-1**: Run 按钮在 loading 时应禁用
- **TC-C2T-003**: loading 状态应正确更新
- **TC-C2T-004**: InputOutputDisplay 配置验证

**P2 中等 - UI 交互**
- **TC-C2T-005**: 点击节点按钮应打开/关闭配置菜单
- **TC-C2T-006**: 组件挂载后应正确初始化

---

### 12. EditStructured Edge Node

#### 测试文件 12.1: `EditStructured.test.tsx` (16 tests)

**P0 - Mode 参数配置**
- **TC-ES-001**: Mode 初始化默认值为 "set"
- **TC-ES-002**: Mode 切换到 "get"
- **TC-ES-002-1**: Mode 切换到 "delete"
- **TC-ES-002-2**: Mode 切换到 "get_values"
- **TC-ES-002-3**: Mode 切换到 "get_keys"

**P1 - Path 树形结构管理**
- **TC-ES-003**: 添加子路径节点
- **TC-ES-003-1**: 删除子路径节点
- **TC-ES-003-2**: 路径类型切换 (key/num)
- **TC-ES-003-3**: 路径值输入
- **TC-ES-003-4**: 路径树扁平化 (flattenPathTree)
- **TC-ES-003-5**: getConfigData 数据同步

**P1 - Replace Value 配置**
- **TC-ES-004**: Replace Value 输入
- **TC-ES-004-1**: Replace Value 条件渲染

**P1 - Run 功能**
- **TC-ES-005**: 点击 Run 按钮调用 runSingleEdgeNode
- **TC-ES-005-1**: Run 按钮在 loading 时显示 Stop

---

### 13. EditText Edge Node

#### 测试文件 13.1: `EditText.test.tsx` (18 tests)

**P0 - Action 参数配置**
- **TC-ET-001**: Action 初始化默认值为 "set"
- **TC-ET-002**: 修改 Action 应正确保存
- **TC-ET-002-1**: Action 切换到其他选项

**P1 - Replace Value 配置**
- **TC-ET-003**: 修改 Replace Value 应正确保存
- **TC-ET-003-1**: 清空 Replace Value 应保存为空字符串
- **TC-ET-004**: Replace Value 初始化
- **TC-ET-004-1**: Replace Value 持久化

**P1 - Target 配置**
- **TC-ET-005**: 修改 Target 应正确保存
- **TC-ET-005-1**: Target 初始化
- **TC-ET-006**: Regex 开关切换
- **TC-ET-006-1**: Regex 默认值为 false

**P1 - Run 功能**
- **TC-ET-007**: 点击 Run 按钮调用 runSingleEdgeNode
- **TC-ET-007-1**: Run 按钮在 loading 时禁用
- **TC-ET-008**: 条件渲染验证

**P2 - UI 交互**
- **TC-ET-009**: 组件挂载验证
- **TC-ET-010**: 配置菜单展开/收起

---

### 14. Copy Edge Node

#### 测试文件 14.1: `Copy.test.tsx` (10 tests)

**P0 致命 - 数据结构完整性**
- **TC-CP-001**: node.data 应包含必要字段
- **TC-CP-001-1**: content_type 应为 'list'、'dict' 或 null
- **TC-CP-001-2**: extra_configs 应包含正确的子字段

**P1 严重 - 基本功能**
- **TC-CP-002**: 点击 Run 按钮应触发执行
- **TC-CP-002-1**: 执行时应显示加载状态

**P2 中等 - UI 交互**
- **TC-CP-003**: 点击节点按钮应打开配置菜单
- **TC-CP-003-1**: 再次点击应关闭配置菜单
- **TC-CP-003-2**: 配置菜单初始状态应为关闭
- **TC-CP-004**: Hover 节点应显示 Run 按钮
- **TC-CP-005**: 组件挂载后验证

---

### 15. Load Edge Node

#### 测试文件 15.1: `Load.test.tsx` (9 tests)

**P0 致命 - 数据结构完整性**
- **TC-LD-001**: LoadNodeFrontendConfig 数据结构验证
- **TC-LD-001-1**: resultNode 字段类型验证
- **TC-LD-001-2**: LoadOperationApiPayload 数据结构验证

**P1 严重 - 核心功能**
- **TC-LD-002**: 点击 Run 按钮调用 runSingleEdgeNode
- **TC-LD-002-1**: Run 按钮在 loading 时显示加载状态
- **TC-LD-002-2**: Run 按钮在 loading 时禁用
- **TC-LD-003**: InputOutputDisplay 配置验证

**P2 中等 - UI 交互**
- **TC-LD-004**: 点击节点按钮打开/关闭配置菜单
- **TC-LD-004-1**: 组件挂载后正确初始化

---

## Block Nodes (块节点)

✅ **更新**: TextBlockNode 测试已创建，覆盖率达 100%！

### 1. Text Block Node

#### 测试文件 1.1: `TextNode.content.test.tsx` (13 tests, 5 failed ⚠️)

**P0 致命 - 内容编辑与保存** (部分待修复)
- **TC-TEXT-001**: 用户输入文本内容 ✅
- **TC-TEXT-002**: 编辑现有文本内容 ✅
- **TC-TEXT-008**: Internal 存储编辑后自动保存 ❌ (超时)
- **TC-TEXT-011**: 保存失败处理 ❌ (超时)

**P1 严重 - 编辑功能**
- **TC-TEXT-003**: 清空所有文本内容 ✅
- **TC-TEXT-004**: 超长文本输入（>50KB） ✅
- **TC-TEXT-009**: 快速连续编辑的防抖（2s） ❌
- **TC-TEXT-012**: 节点 isLoading 时不触发保存 ✅
- **TC-TEXT-014**: 加载完成后显示内容 ✅

#### 测试文件 1.2: `TextNode.storage.test.tsx` (9 tests, 7 failed ⚠️)

**P0 致命 - 动态存储策略** (待修复)
- **TC-TEXT-015**: 内容超阈值切换到外部存储 ❌ (超时)
- **TC-TEXT-016**: 内容缩减切换回内部存储 ❌ (超时)
- **TC-TEXT-018**: 存储切换时的数据一致性 ❌ (超时)

**P1 严重 - dirty 标记管理** (待修复)
- **TC-TEXT-022**: External 存储的 dirty 标记 ❌
- **TC-TEXT-023**: Internal 存储不使用 dirty ❌

#### 测试文件 1.3: `TextNode.connection.test.tsx` (10 tests) ✅

**P0 致命 - 节点连接**
- **TC-TEXT-026**: 从 Source Handle 拖拽创建连接 ✅
- **TC-TEXT-029**: 接收其他节点的连接 ✅
- **TC-TEXT-046**: 作为源节点连接 ✅
- **TC-TEXT-049**: 无连接时清空角色标记 ✅

**P1 严重 - Handle 管理**
- **TC-TEXT-025**: 4个方向 Source Handle 可见 ✅
- **TC-TEXT-028**: 4个方向 Target Handle 存在 ✅
- **TC-TEXT-047**: 作为目标节点连接 ✅
- **TC-TEXT-048**: 同时作为输入输出节点 ✅

---

### 2. JSON Block Node

#### 测试文件 1.1: `JsonNodeNew.content.test.tsx` (16 tests, 5 skipped)

**P0 致命 - 内容编辑与保存**
- **TC-JSON-001**: 用户输入 JSON 内容
- **TC-JSON-002**: 编辑现有 JSON 内容
- **TC-JSON-008**: Internal 存储编辑后自动保存
- **TC-JSON-008-EXT**: External 存储编辑后自动保存
- **TC-JSON-011**: 保存失败处理

**P1 严重 - 编辑功能**
- **TC-JSON-003**: 清空所有 JSON 内容
- **TC-JSON-004**: 超长 JSON 输入（>10万字符）
- **TC-JSON-007**: 对象类型 content 的字符串化
- **TC-JSON-009**: 快速连续编辑的防抖
- **TC-JSON-010**: 保存中再次编辑
- **TC-JSON-012**: 节点 isLoading 时不触发保存
- **TC-JSON-014**: 加载完成后显示内容

#### 测试文件 1.2: `JsonNodeNew.view.test.tsx` (14 tests)

**P0 致命 - 视图切换**
- **TC-JSON-061**: 切换视图时内容不丢失

**P1 严重 - 视图管理**
- **TC-JSON-059**: 切换到 JSONForm 视图
- **TC-JSON-060**: 切换回 RichEditor 视图
- **TC-JSON-063**: RichEditor 正确接收 props
- **TC-JSON-064**: JSONForm 正确接收 props
- **TC-JSON-065**: 锁定状态下两种视图都只读
- **TC-JSON-087**: JSON 编辑器内滚动不传播
- **TC-JSON-090**: 锁定状态下不可编辑 JSON

#### 测试文件 1.3: `JsonNodeNew.storage.test.tsx` (11 tests)

**P0 致命 - 动态存储策略**
- **TC-JSON-015**: 内容超阈值切换到外部存储
- **TC-JSON-016**: 内容缩减切换回内部存储
- **TC-JSON-018**: 存储切换时的数据一致性

**P1 严重 - 存储类型识别**
- **TC-JSON-019**: 有效 JSON 识别为 structured
- **TC-JSON-020**: 无效 JSON 识别为 text
- **TC-JSON-022**: External 存储的 dirty 标记
- **TC-JSON-023**: Internal 存储不使用 dirty

#### 测试文件 1.4: `JsonNodeNew.indexing.test.tsx` (12 tests)

**P1 严重 - 索引管理**
- **TC-JSON-046**: 添加向量索引
- **TC-JSON-047**: 索引创建失败处理
- **TC-JSON-050**: 删除已完成的索引
- **TC-JSON-051**: 删除失败处理
- **TC-JSON-054**: 索引状态流转：processing → done
- **TC-JSON-055**: 索引状态流转：processing → error
- **TC-JSON-056**: 索引状态流转：done → deleting → 移除

#### 测试文件 1.5: `JsonNodeNew.connection.test.tsx` (11 tests, 2 skipped)

**P0 致命 - 节点连接**
- **TC-JSON-026**: 从 Source Handle 拖拽创建连接
- **TC-JSON-029**: 接收其他节点的连接

**P1 严重 - Handle 管理**
- **TC-JSON-025**: 4个方向 Source Handle 可见
- **TC-JSON-028**: 4个方向 Target Handle 存在

---

### 2. File Block Node

#### 测试文件 2.1: `FileNode.upload.test.tsx` (14 tests, 4 skipped)

**P0 致命 - 文件上传核心**
- **TC-FILE-001**: 点击上传单个文件
- **TC-FILE-002**: 拖拽上传单个文件
- **TC-FILE-009**: 上传中显示进度
- **TC-FILE-011**: 上传失败处理

**P1 严重 - 上传功能**
- **TC-FILE-003**: 上传多个文件
- **TC-FILE-004**: 上传支持的文件类型
- **TC-FILE-005**: 上传不支持的文件类型
- **TC-FILE-006**: 上传超大文件
- **TC-FILE-010**: 上传成功后状态恢复
- **TC-FILE-014**: 上传中再次上传
- **TC-FILE-015**: 快速连续上传多个文件

#### 测试文件 2.2: `FileNode.file-management.test.tsx` (11 tests)

**P0 致命 - 文件操作**
- **TC-FILE-022**: 点击文件下载

**P1 严重 - 文件管理**
- **TC-FILE-017**: 显示文件列表
- **TC-FILE-023**: 下载文件无 URL
- **TC-FILE-025**: 删除单个文件
- **TC-FILE-026**: 删除最后一个文件
- **TC-FILE-028**: 删除文件时阻止冒泡

#### 测试文件 2.3: `FileNode.storage.test.tsx` (11 tests, 1 skipped)

**P0 致命 - 外部存储**
- **TC-FILE-030**: 上传后生成 resourceKey
- **TC-FILE-031**: 保存 external_metadata
- **TC-FILE-035**: 删除文件后清理 external_metadata

**P1 严重 - 存储管理**
- **TC-FILE-032**: 更新文件时保持 resourceKey
- **TC-FILE-033**: versionId 跟随文件变更递增
- **TC-FILE-036**: 所有文件删除后清空 external_metadata
- **TC-FILE-037**: external_metadata 包含完整文件信息

#### 测试文件 2.4: `FileNode.connection.test.tsx` (15 tests, 3 skipped)

**P0 致命 - 节点连接**
- **TC-FILE-046**: 作为源节点连接
- **TC-FILE-049**: 无连接时清空角色标记

**P1 严重 - 连接管理**
- **TC-FILE-047**: 作为目标节点连接
- **TC-FILE-048**: 同时作为输入输出节点
- **TC-FILE-050**: 动态更新连接状态
- **TC-FILE-051**: 断开输入连接
- **TC-FILE-052**: 断开输出连接
- **TC-FILE-053**: Handle 的显示控制
- **TC-FILE-054**: Handle 的连接状态

---

## 📊 测试统计

### 按优先级统计

| 优先级 | 测试数量 | 占比 | 说明 |
|--------|---------|------|------|
| P0 | ~120 | 33% | 致命 - 核心功能必须通过 |
| P1 | ~180 | 49% | 严重 - 重要功能影响用户体验 |
| P2 | ~60 | 16% | 中等 - 非核心功能或边界情况 |
| P3 | ~4 | 1% | 轻微 - UI显示问题 |

### 按节点类型统计

| 节点类型 | 节点数量 | 测试文件数 | 测试用例数 | 状态 |
|---------|---------|-----------|-----------|------|
| Edge Nodes | 15 | 22 | ~290 | 全覆盖 ✅ |
| Block Nodes | 3 | 12 | ~121 | **全覆盖 ✅** (TextBlock 部分待优化 🚧) |
| **总计** | **18** | **30** | **411** | 覆盖率 100% ✅ |

### 测试质量统计

| 文件 | 通过 | 失败 | 跳过 | 通过率 |
|------|------|------|------|--------|
| TextNode.content | 8 | 5 | 0 | 61.5% 🚧 |
| TextNode.storage | 2 | 7 | 0 | 22.2% 🚧 |
| TextNode.connection | 10 | 0 | 0 | 100% ✅ |
| 其他测试文件 | 364 | 0 | 15 | 100% ✅ |
| **总计** | **384** | **12** | **15** | **97.0%** |

---

## 🎯 测试重点说明

### Edge Nodes 测试重点
1. **参数配置保存**: 所有参数修改后应正确保存到 `node.data`
2. **数据结构完整性**: 验证数据类型、必填字段、嵌套结构
3. **UI 交互**: 按钮点击、菜单展开/收起、Hover 状态
4. **执行流程**: Run 按钮触发、Loading 状态、错误处理
5. **初始化逻辑**: 默认值、从已有数据加载

### Block Nodes 测试重点
1. **内容编辑**: 用户输入、编辑、删除内容
2. **存储策略**: Internal/External 存储切换、阈值管理
3. **连接管理**: Source/Target Handle、连接创建/断开
4. **文件操作**: 上传、下载、删除、进度显示
5. **状态管理**: Loading、Error、Success 状态流转

---

## ✅ 测试覆盖率

- ✅ **参数配置**: 所有可配置参数均有测试覆盖
- ✅ **数据持久化**: 保存和加载功能完整测试
- ✅ **错误处理**: 失败场景和边界情况测试
- ✅ **UI 交互**: 用户操作流程完整覆盖
- ✅ **集成功能**: 节点间连接、数据流转测试

---

## 📝 备注

1. 所有测试使用 **Vitest** 测试框架
2. UI 测试使用 **@testing-library/react**
3. 测试使用 Mock 隔离外部依赖
4. 优先级定义:
   - **P0**: 核心功能，失败会导致功能完全不可用
   - **P1**: 重要功能，失败会严重影响用户体验
   - **P2**: 一般功能，失败会影响部分功能
   - **P3**: 次要功能，失败影响较小

---

## 🚧 TextBlockNode 测试问题和解决方案

### 当前状态

✅ **已创建**: 3 个测试文件，32 个测试用例  
🚧 **待优化**: 12 个失败用例（主要是异步测试和 Mock 配置问题）

### 失败测试分析

#### 1. 超时问题 (10 个测试)

**问题**: `waitFor` 等待异步操作超时（5秒）

**影响测试**:
- TC-TEXT-008: 编辑后 2 秒应触发保存
- TC-TEXT-011: 保存失败处理
- TC-TEXT-015/016/018: 存储策略切换

**原因**: 
- `useEffect` 中的异步逻辑在测试环境中未正确触发
- Mock 的 `getNode` 返回值未随状态更新

**解决方案**:
1. 改进 `mockGetNode` 的返回逻辑，使其能动态返回更新后的节点
2. 使用 `act` 包裹所有状态更新
3. 增加测试超时时间或使用更精确的等待条件

#### 2. Mock 调用未捕获 (2 个测试)

**问题**: `mockSetNodes.mock.calls[0]` 为 undefined

**影响测试**:
- TC-TEXT-022: External 存储的 dirty 标记
- TC-TEXT-023: Internal 存储不使用 dirty

**原因**: 
- `fireEvent.change` 触发的事件未正确传播到组件
- TextEditor 的 mock 可能需要调整

**解决方案**:
1. 使用 `userEvent` 代替 `fireEvent` 进行更真实的用户交互模拟
2. 检查 TextEditor mock 的 `onChange` 调用逻辑
3. 添加等待和验证 `mockSetNodes` 被调用的逻辑

### 后续优化建议

1. **增加 Label 管理测试** (P2 优先级)
   - TC-TEXT-030: 编辑节点 label
   - TC-TEXT-031: Label 持久化
   - TC-TEXT-032: Label 输入框聚焦和失焦

2. **完善错误场景测试**
   - 网络异常处理
   - 存储容量限制
   - 并发编辑冲突

3. **性能测试**
   - 超大文本（>1MB）渲染性能
   - 频繁保存的防抖效果
   - 内存泄漏检测

### 预估修复工作量

- **修复现有失败测试**: 2-3 小时
- **完善 Label 测试**: 1-2 小时
- **总计**: 半天工作量

---

**文档版本**: v2.0  
**最后更新**: 2025-11-07  
**维护者**: PuppyFlow 测试团队

