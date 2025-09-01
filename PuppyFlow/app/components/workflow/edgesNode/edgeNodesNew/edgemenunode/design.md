# Edge Menu 菜单与交互设计

## 范围
- 仅描述用户可见的菜单与交互，不涉技术实现。
- 明确不同 Block 类型对应的主菜单分组与二级子菜单。

## Block → Menu 映射总览

| Block 类型 | 主菜单分组与可见项 |
| --- | --- |
| text 文本 | 处理：LLM（大模型）、Modify（修改）<br/>RAG：Chunk（切分）、Retrieve（检索）<br/>生成：Generate（生成）<br/>深度研究：Deep Research（深度研究）<br/>搜索：Search（搜索）<br/>其他：If/Else（条件分支） |
| structured 结构化 | 处理：LLM（大模型）、Modify（修改）<br/>RAG：Chunk（切分）、Retrieve（检索）<br/>生成：Generate（生成）<br/>深度研究：Deep Research（深度研究）<br/>搜索：Search（搜索）<br/>其他：If/Else（条件分支） |
| file 文件 | 加载：Load（导入/装载） |
| webLink 网页链接 | 暂不可用（显示占位与说明） |

## 子菜单详情（按分组）

### 处理
- LLM：直接添加下一步。
- Modify（根据 Block 类型自适配）：
  - text：Copy；Convert（转为结构化）；Edit（编辑文本）。
  - structured：Copy；Convert to Text（转为文本）；Edit（编辑结构）。

### RAG
- Chunk：Auto（自动）；By length（按长度）；By character（按字符）。
- Others（规划/暂未开放，置灰）：for HTML；for Markdown。
- Retrieve：By Vector（向量检索）。

### 生成
- Generate：直接添加下一步。

### 深度研究
- Deep Research：直接添加下一步。

### 搜索
- Search：Perplexity；Google。

### 其他
- If/Else：直接添加条件分支。

## 可见性与适配规则
- text、structured：显示“处理 / RAG / 生成 / 深度研究 / 搜索 / 其他”全部分组及其子菜单（按上表）。
- file：仅显示“加载（Load）”分组与条目。
- webLink：显示“暂不可用”占位文案与说明。
- 置灰项悬浮提示不可用原因；未开放项保持分组结构稳定。

## 交互要点
- 从任一连接点开始连线时，菜单贴近连接点外侧弹出；子菜单在右侧滑出。
- 悬浮120ms展开子菜单；移出250ms延迟收起，避免抖动。
- 点击条目：自动在合适位置添加下一步并连线；2秒内轻提示“已添加：{项名}”（含撤销）。
- Esc 或点击空白：关闭菜单不产生改动。

### 键盘操作
- 上下移动。
- 右展开。
- 左收起。
- Enter 确认。
- Esc 关闭。
- 焦点环清晰可见。

## 菜单结构图示（ASCII）

### 主菜单（text / structured 适用）

```
连接点 ●
      └─► 弹出主菜单
┌────────────────────────────────────────────────────┐
│ Process                                            │
│  • LLM                                             │  ← 直接添加下一步
│  • Modify ▸                                        │  ← 子菜单（随 Block 类型自适配）
├────────────────────────────────────────────────────┤
│ RAG                                                │
│  • Chunk ▸                                         │  ← 子菜单（切分方式）
│  • Retrieve ▸                                      │  ← 子菜单（检索方式）
├────────────────────────────────────────────────────┤
│ Generate                                           │
│  • Generate                                        │  ← 直接添加下一步
├────────────────────────────────────────────────────┤
│ Deep Research                                      │
│  • Deep Research                                   │  ← 直接添加下一步
├────────────────────────────────────────────────────┤
│ Search                                             │
│  • Search ▸                                        │  ← 子菜单（搜索提供商）
├────────────────────────────────────────────────────┤
│ Other                                              │
│  • If / Else                                       │
└────────────────────────────────────────────────────┘
```

### Modify submenu (when Block type is text)

```
┌──────── Main Menu (excerpt) ────┐      ┌──────── Modify (text) ─────┐
│ Process                          │      │  • Copy                     │
│  • LLM                           │      │  • Convert → structured     │
│  • Modify ▸ ─────────────────────┼────► │  • Edit (text)              │
└──────────────────────────────────┘      └────────────────────────────┘
```

### Modify submenu (when Block type is structured)

```
┌──────── Main Menu (excerpt) ────┐      ┌──── Modify (structured) ───┐
│ Process                          │      │  • Copy                     │
│  • LLM                           │      │  • Convert to Text          │
│  • Modify ▸ ─────────────────────┼────► │  • Edit (structure)         │
└──────────────────────────────────┘      └────────────────────────────┘
```

### RAG / Chunk submenu

```
┌──────── Main Menu (excerpt) ────┐      ┌────────── Chunk ───────────┐
│ RAG                              │      │  • Auto                     │
│  • Chunk ▸ ──────────────────────┼────► │  • By length                │
│  • Retrieve ▸                    │      │  • By character             │
└──────────────────────────────────┘      │  • for HTML   (disabled)     │
                                         │  • for Markdown (disabled)    │
                                         └──────────────────────────────┘
```

### RAG / Retrieve submenu

```
┌──────── Main Menu (excerpt) ────┐      ┌──────── Retrieve ──────────┐
│ RAG                              │      │  • By Vector                │
│  • Chunk ▸                       │      │                              │
│  • Retrieve ▸ ───────────────────┼────► │                              │
└──────────────────────────────────┘      └──────────────────────────────┘
```

### Search submenu

```
┌────────────────────────────┐
│ Search                     │
│  • Perplexity              │
│  • Google                  │
└────────────────────────────┘
```

### File Block menu

```
┌───────────────────────────────────┐
│ Load                              │
│  • Load (import / mount)          │
└───────────────────────────────────┘
```

### WebLink Block placeholder

```
┌──────────────────────────────────────────────────────┐
│ Web Link (not available yet)                         │
│  • Placeholder: upcoming crawling / parsing / search │
│  • Display only in this version, not clickable       │
└──────────────────────────────────────────────────────┘
```
