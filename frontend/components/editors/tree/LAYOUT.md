# TreeLineVirtualEditor 布局计算文档

## 概述

本文档描述了 JSON 树编辑器中每一行的水平布局计算方式。布局系统需要处理：
- 多层级缩进
- 连接线绘制 (├─ 和 └─)
- Key 名称显示
- 分隔线
- Value 区域
- 悬浮菜单按钮

---

## 常量定义

```typescript
// 元素尺寸
const ROW_HEIGHT = 28           // 每行最小高度 (px)
const ROOT_ICON_WIDTH = 18      // 根节点展开图标宽度
const BRANCH_WIDTH = 16         // ├─ 分支线水平部分宽度
const KEY_WIDTH = 64            // Key 名称固定宽度
const SEP_WIDTH = 8             // Key 后的 ── 分隔线宽度
const VALUE_GAP = 12            // Value 区域到下一层的视觉间距
const MENU_WIDTH = 22           // 悬浮菜单按钮宽度
const MENU_GAP = 4              // 菜单按钮与 Value 的间距
const LINE_END_GAP = 2          // 水平分支线末端与 Key 的间距
const LINE_COLOR = '#3a3f47'    // 连接线颜色
const CORNER_RADIUS = 6         // 圆角半径 (Reddit 风格)
const CONTAINER_GAP = 4         // 容器边界间距（顶部 & 底部统一）

// 布局基准（从根节点图标推导，保证所有值为正数）
const BASE_INDENT = ROOT_ICON_WIDTH / 2  // = 9px

// 计算常量
const LEVEL_WIDTH = BRANCH_WIDTH + KEY_WIDTH + SEP_WIDTH + VALUE_GAP  // = 100px
```

### 核心设计原则

**所有位置值都是正数，没有负偏移。**

`BASE_INDENT` 从根节点图标宽度推导而来：
- 根节点图标宽度 = 18px
- 根节点图标中心 = 18 / 2 = 9px
- **BASE_INDENT = 9px = 根节点图标中心 = depth=0 竖线位置**

这样根节点 `contentLeft = 0`，不需要任何负偏移。

### LEVEL_WIDTH 的计算

```
LEVEL_WIDTH = BRANCH_WIDTH + KEY_WIDTH + SEP_WIDTH + VALUE_GAP
            = 16 + 64 + 8 + 12
            = 100 px
```

---

## 坐标系统

### 容器偏移

```typescript
scrollContainer: {
  paddingLeft: 24,   // 容器左边距，为根节点图标预留空间
  paddingTop: 16,
  paddingRight: 8,
}
```

所有行元素相对于视口左边缘有 **24px** 的偏移。

### 基准点

```
BASE_INDENT = ROOT_ICON_WIDTH / 2 = 9    // 根节点图标中心 = 子节点竖线对齐位置
```

**设计思路**：
- 根节点图标从 x=0 开始，宽度 18px，**中心在 x=9**
- depth=0 子节点的竖线在 x=9
- 两者完美对齐，无需负偏移

---

## 布局示意图

### 案例数据

以下示例基于一个邮件系统的 JSON 结构：

```json
{
  "mails": {
    "account": "guantum@puppyone.com",
    "history": [
      { "id": "msg_001", ... },
      { "id": "msg_002", ... },
      { "id": "msg_003", "to": "sales@featbit.co", "subject": "Inquiry..." }
    ],
    "last_used": "Dec.12.2025"
  }
}
```

### 层级结构

```
depth=-1  $root ─────────────────────────────────────────────────────────────────
             │
depth=0      └── mails ──────────────────────────────────────────────────────────
                   │
depth=1            ├── account ─── "guantum@puppyone.com"
                   │
depth=1            ├── history ─── [5]
                   │      │
depth=2            │      ├── 0 ─── {6}
                   │      │
depth=2            │      ├── 1 ─── {6}
                   │      │
depth=2            │      ├── 2 ─── {7}
                   │      │    │
depth=3            │      │    ├── id ─────── "msg_003"
                   │      │    ├── to ─────── "sales@featbit.co"
                   │      │    ├── date ───── "Dec.10.2025"
                   │      │    ├── from ───── "guantum@puppyone.com"
                   │      │    ├── status ─── "sent"
                   │      │    ├── snippet ── "Hello, our team is growing..."
                   │      │    └── subject ── "Inquiry about Enterprise Plan pricing"
                   │      │
depth=2            │      ├── 3 ─── {6}
                   │      │
depth=2            │      └── 4 ─── {6}
                   │
depth=1            └── last_used ─── "Dec.12.2025"
```

### 水平布局详解

#### 单行布局结构

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                     │
│  ← Container paddingLeft: 24px →                                                    │
│  │                                                                                  │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  │                            ROW (position: relative)                       │   │
│  │  │                                                                           │   │
│  │  │   ┌─────┐   ┌──────────────────────────────────────────────────────────┐ │   │
│  │  │   │MENU │   │                    内容区域 (marginLeft: contentLeft)      │ │   │
│  │  │   │ 22px│   │                                                          │ │   │
│  │  │   │abs  │   │  ┌────────────────┬────────┬─────────────────────────┐  │ │   │
│  │  │   │pos  │   │  │      KEY       │  SEP   │         VALUE           │  │ │   │
│  │  │   └─────┘   │  │     64px       │  8px   │         flex            │  │ │   │
│  │  │             │  └────────────────┴────────┴─────────────────────────┘  │ │   │
│  │  │             └──────────────────────────────────────────────────────────┘ │   │
│  │  │                                                                           │   │
│  │  │   ← SVG 连接线 (position: absolute, left: 0) →                            │   │
│  │  │                                                                           │   │
│  │  └───────────────────────────────────────────────────────────────────────────┘   │
│  │                                                                                  │
└──┴──────────────────────────────────────────────────────────────────────────────────┘
```

#### 各深度的像素位置

以 `depth=2` 的节点 `id ─── "msg_003"` 为例：

```
相对于行元素左边缘 (x=0)
│
│   8px                108px               208px               308px
│   │                  │                   │                   │
│   │  depth=0 竖线    │  depth=1 竖线     │  depth=2 竖线     │  depth=3 竖线
│   │                  │                   │                   │
├───┴──────────────────┴───────────────────┴───────────────────┴──────────────────
│
│   对于 depth=3 的节点:
│
│   branchX = 8 + 3 × 100 = 308
│
│                                                              308
│                                                              │
│   ════════════════════════════════════════════════════════════╦═══════════════╗
│                                                               ║               ║
│   │          │          │          │         ├────────────────╬───── id ──────║── "msg_003"
│   │          │          │          │         │                ║               ║
│   │          │          │          │         │    ← 16px →    ║   ← 64px →    ║
│   │          │          │          │         │   BRANCH       ║    KEY        ║
│   │          │          │          │         │                ╚═══════════════╝
│   │          │          │          │         │                │
│   │          │          │          │         contentLeft      │
│   │          │          │          │         = 308 + 16       │
│   │          │          │          │         = 324            │
│   │          │          │          │                          │
│   0          8         108        208       308              324
│              │          │          │         │                │
│              │          │          │         │                └── KEY 起始
│              │          │          │         │
│              │          │          │         └── 竖线 X = 8 + 3×100
│              │          │          │
│              │          │          └── 竖线 X = 8 + 2×100
│              │          │
│              │          └── 竖线 X = 8 + 1×100
│              │
│              └── 竖线 X = 8 + 0×100
```

### 完整水平尺寸表

```
depth=3 节点 "id ─── msg_003" 的完整布局:

    0        8                              308   324        388  396
    │        │                               │     │          │    │
    │←─ 8 ──→│←───────── 300px ─────────────→│←16→│←── 64 ──→│←8→│
    │        │                               │     │          │    │
    ▼        ▼                               ▼     ▼          ▼    ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│        │  │          │          │          │     │          │    │             │
│        │  │          │          │          ├─────┤    id    │────│  "msg_003"  │
│        │  │          │          │          │     │          │    │             │
│        │  │          │          │          │     │          │    │             │
│  pad   │  │   空白   │   空白   │   空白   │BRCH │   KEY    │SEP │   VALUE     │
│  24px  │  │ (祖先竖线区域)       │          │16px │   64px   │8px │   flex      │
│        │  │          │          │          │     │          │    │             │
└────────────────────────────────────────────────────────────────────────────────┘
         │                                   │
         └───────────────────────────────────┘
                   depth × LEVEL_WIDTH
                   = 3 × 100 = 300px
```

### 连接线绘制示例

以 `history` 数组展开后的第 3 项 (depth=2, 非最后) 为例：

**注意**：现在使用 Reddit 风格的圆角连接线（`CORNER_RADIUS = 6px`），
分支线的拐角处不再是直角，而是平滑的弧度。

```
       8        108       208
       │         │         │
       │  d=0    │  d=1    │  d=2
       │         │         │
       │         │         │
       │         │         ├────── 3 ────── {6}
       │         │         │       ↑
       │         │         │       圆角弧度（二次贝塞尔曲线）
       │         │         │
       │         │         │  ← 这条竖线会继续向下延伸
       │         │         │    因为 3 不是 history 的最后一个元素
       │         │         │
       │         │         ╰────── 4 ────── {6}  ← 最后一个，用圆角 ╰
       │         │         
       │         │               ↑ 最后一个子元素增加底部间距 (10px)
       │         │
       │         │  ← d=1 的竖线继续向下，因为 last_used 还在后面
       │         │
       │         ╰──────── last_used ────── "Dec.12.2025"
       │
       ╰  ← d=0 的竖线到这里结束，因为 mails 是根下唯一的子节点
```

**连接线渲染规则**：

```typescript
// parentLines 数组：记录每个祖先层级是否需要画延续竖线
// parentLines[i] = true  →  depth=i 的祖先不是最后一个子节点，需要画竖线
// parentLines[i] = false →  depth=i 的祖先是最后一个子节点，不画竖线

// 示例：对于 history[2].id (depth=3)
// parentLines = [false, false, true]
//                  │      │      │
//                  │      │      └── depth=2: history[2] 不是最后一个 → 画竖线
//                  │      └── depth=1: history 不是 mails 的最后一个 → 但 parentLines 记录的是更上层
//                  └── depth=0: mails 是 root 的唯一子节点 → 不画竖线
```

### 菜单按钮定位

```
菜单按钮 (MENU) 使用绝对定位，位于 VALUE 区域左侧：

对于 depth=3 的节点:
    menuButtonAnchor = contentLeft + KEY_WIDTH + SEP_WIDTH
                     = 324 + 64 + 8
                     = 396

    menuButton.left = menuButtonAnchor - MENU_WIDTH - 4
                    = 396 - 22 - 4
                    = 370

                                            370  392 396
                                             │    │   │
    ─────────────────────────────────────────┼────┼───┼──────────────────────
                                             │    │   │
    ...          │          ├─────┤   id   ──│────│───│── "msg_003"
                 │          │     │          │MENU│   │
                 │          │     │          │22px│   │
                 │          │     │          │    │   │
                 │          │ BRANCH  KEY    │    │SEP│    VALUE
                 │          │  16px   64px   │    │8px│
    ─────────────┴──────────┴─────┴─────────┴────┴───┴──────────────────────
                308        324              388     396
```

---

## 核心计算公式

### 公式速查表

| 计算项 | 公式 | 说明 |
|--------|------|------|
| 竖线 X | `9 + depth × 100` | 每层竖线的水平位置 |
| 根节点内容起始 | `0` | 图标从 0 开始，中心在 9 |
| 非根节点内容起始 | `9 + depth × 100 + 16` | KEY 区域的起始位置 |
| KEY 结束 | `contentLeft + 64` | KEY 区域的结束位置 |
| VALUE 起始 | `contentLeft + 64 + 8` | VALUE 区域的起始位置 |
| 菜单按钮 | `VALUE起始 - 22 - 4` | 菜单按钮的绝对定位 left |

### 1. 竖线 X 坐标

```typescript
// 给定深度的竖线 X 坐标（相对于行元素左边缘）
const getVerticalLineX = (depth: number) => BASE_INDENT + depth * LEVEL_WIDTH
// BASE_INDENT = 9 (= ROOT_ICON_WIDTH / 2)
```

**计算示例**：

| depth | 计算 | 结果 |
|-------|------|------|
| 0 | 9 + 0 × 100 | **9px** |
| 1 | 9 + 1 × 100 | **109px** |
| 2 | 9 + 2 × 100 | **209px** |
| 3 | 9 + 3 × 100 | **309px** |

### 2. 内容区起始位置 (contentLeft)

```typescript
// 根节点：图标从 0 开始，中心对齐到 BASE_INDENT (9)
const getRootContentLeft = () => 0

// 非根节点：竖线位置 + 分支宽度
const getContentLeft = (depth: number) => getVerticalLineX(depth) + BRANCH_WIDTH
```

**计算示例**：

| 节点 | 计算 | 结果 |
|------|------|------|
| 根节点 | getRootContentLeft() | **0px** ✓ 正值 |
| depth=0 | 9 + 0×100 + 16 | **25px** |
| depth=1 | 9 + 1×100 + 16 | **125px** |
| depth=2 | 9 + 2×100 + 16 | **225px** |
| depth=3 | 9 + 3×100 + 16 | **325px** |

### 3. 菜单按钮位置

菜单按钮使用 `position: absolute`，定位在 Value 区域左侧：

```typescript
// 锚点位置 = Value 区域起始位置
const menuAnchor = isRootNode 
  ? contentLeft                            // 根节点：图标左侧
  : (contentLeft + KEY_WIDTH + SEP_WIDTH)  // 子节点：Value 左侧

// CSS left = 锚点 - 按钮宽度 - 间距
styles.menuHandle.left = menuAnchor - MENU_WIDTH - MENU_GAP
```

**计算示例** (以 `history[2].id` 为例，depth=3)：

```
contentLeft    = 325
menuAnchor     = 325 + 64 + 8 = 397
menuButton.left = 397 - 22 - 4 = 371

视觉效果：
         371   393  397
          │     │    │
    ──────┼─────┼────┼────────────────
          │MENU │    │
          │ btn │    │   "msg_003"
          │ 22px│ 4px│
    ──────┴─────┴────┴────────────────
```

---

## 连接线绘制 (LevelConnector)

### 连接线的组成

每个非根节点的行都会渲染一个 SVG，包含两种线：

1. **祖先竖线**：贯穿整行高度的垂直线，表示祖先节点还有后续兄弟
2. **当前分支**：├─ 或 └─ 形状，连接到当前节点

```
祖先竖线示例：

    │          │          │          │
    │  d=0     │  d=1     │  d=2     ├────── subject ────── "Inquiry..."
    │          │          │          │
    │          │          │          │   ← 如果 subject 不是最后一个，
    │          │          │          │     d=3 的竖线会延伸到下一行
    │          │          │
    │          │          └────────────── 4 ────── {6}    ← 最后一个用 └
    │          │
    │          └──────────────────────── last_used ────── "Dec.12.2025"
    │
    └  ← d=0 结束
```

### SVG 定位

```typescript
<svg style={{
  position: 'absolute',
  left: 0,
  top: 0,
  width: branchX + BRANCH_WIDTH,  // 覆盖到水平线末端
  height: '100%',                 // 适应多行内容（如长字符串换行）
  pointerEvents: 'none',          // 不阻挡鼠标事件
}} />
```

### 祖先竖线渲染

```typescript
// parentLines 数组：parentLines[i] = true 表示 depth=i 的祖先还有后续兄弟
parentLines.forEach((showLine, i) => {
  if (showLine) {
    const x = 8 + i * LEVEL_WIDTH
    // 画一条从 (x, 0) 到 (x, 100%) 的垂直线
  }
})
```

**示例**：渲染 `history[2].subject` (depth=3, 是最后一个子节点)

```
parentLines = [false, false, true]
               │      │      │
               │      │      └─ depth=2: history[2] 不是最后 → 画 x=208 的竖线
               │      └─ depth=1: history 后面还有 last_used → 但这个信息不在这里
               └─ depth=0: mails 是唯一子节点 → 不画

实际上 parentLines 是从父节点传递下来的，记录的是"路径上每一层是否需要画延续线"
```

### 当前节点分支线

```typescript
const branchX = 8 + depth * LEVEL_WIDTH
const hh = ROW_HEIGHT / 2  // = 14px

// 竖线部分
<line x1={branchX} y1={0} 
      x2={branchX} y2={isLast ? hh : '100%'} />
      
// 水平线部分（-2 是为了和 KEY 区域留出间距）
<line x1={branchX} y1={hh} 
      x2={branchX + BRANCH_WIDTH - 2} y2={hh} />
```

**两种形态**（使用 Reddit 风格圆角）：

```
isLast = false (├─)          isLast = true (╰─)
                              
     │                             │
     │                             │
     ├───────                      ╰───────
     │    ↑                              ↑
     │  圆角弧度                       圆角弧度
     │ ← 继续向下                    ← 结束 + 底部间距
```

**圆角实现**：使用 SVG 二次贝塞尔曲线 (Quadratic Bezier)：

```typescript
// 圆角 + 水平线路径
const cornerPath = `
  M ${branchX} ${halfHeight - CORNER_RADIUS}       // 起点：竖线底部
  Q ${branchX} ${halfHeight}                        // 控制点：原始拐角位置
    ${branchX + CORNER_RADIUS} ${halfHeight}        // 终点：水平线起点
  L ${branchX + BRANCH_WIDTH - LINE_END_GAP} ${halfHeight}  // 水平线
`
```

---

## 根节点特殊处理

根节点 (key = '$root', depth = -1) 不显示 Key 和分隔线，只显示展开/收起图标和 Value。

### 为什么 contentLeft = -1？

目的是让根节点的展开图标中心与 depth=0 子节点的竖线对齐：

```
                        展开图标 (18px 宽)
                        │←── 18px ──→│
                        │            │
                        │   中心点   │
      -1px              │     ↓      │
       │                ▼     9      ▼
───────┼────────────────┬─────┬──────┬─────────────────────────────
       │                │     │      │
       │←─ marginLeft ─→│  ◇  │  1   │    ← 根节点行
       │     = -1       │     │      │
       │                └─────┴──────┘
       │                      │
       │                      8 ← 图标中心对齐到这里
       │
       8 ← depth=0 子节点的竖线位置
       │
       │
       ├──────────────────────── mails ────── {3}
       │
       │  ← 子节点的竖线刚好在 x=8

计算：marginLeft = 目标位置 - 图标中心 = 8 - 9 = -1
```

### 根节点渲染规则

```typescript
if (isRootNode) {
  contentLeft = -1
  // 1. 不渲染 LevelConnector（根节点没有父级，不需要连接线）
  // 2. 不渲染 Key + 分隔线（根节点没有 Key）
  // 3. 直接渲染展开图标 + Value
}
```

---

## 视觉对齐验证

### 各深度关键位置对照表

单位：px，相对于行元素左边缘

| depth | 竖线 X | contentLeft | Key 起始 | Key 结束 | SEP 结束 | Value 起始 | Menu 按钮 |
|-------|--------|-------------|----------|----------|----------|------------|-----------|
| -1 (root) | - | -1 | - | - | - | 17 | -27 |
| 0 | 8 | 24 | 24 | 88 | 96 | 96 | 70 |
| 1 | 108 | 124 | 124 | 188 | 196 | 196 | 170 |
| 2 | 208 | 224 | 224 | 288 | 296 | 296 | 270 |
| 3 | 308 | 324 | 324 | 388 | 396 | 396 | 370 |
| 4 | 408 | 424 | 424 | 488 | 496 | 496 | 470 |

### 验证公式

```
对于任意 depth (>= 0):

竖线 X        = 8 + depth × 100                    ✓
contentLeft   = 竖线 X + 16 = 8 + depth × 100 + 16  ✓
Key 结束      = contentLeft + 64                    ✓
SEP 结束      = contentLeft + 64 + 8 = Value 起始  ✓
Value 起始    = contentLeft + 72                    ✓
Menu 按钮     = Value 起始 - 22 - 4                 ✓

层级差验证：
depth=n 的 Value 起始 - depth=(n-1) 的 Value 起始 = 100px  ✓
```

### 视觉对齐示意

```
depth=0  mails ───────────────── [3]
                                  │
         │←─────── 100px ────────→│
                                  │
depth=1  │  account ─────────── "guantum@puppyone.com"
         │                        │
         │  │←───── 100px ───────→│
         │                        │
depth=2  │  │  0 ──────────────── {6}
         │  │                     │
         │  │  │←──── 100px ─────→│
         │  │                     │
depth=3  │  │  │  id ──────────── "msg_001"

每层的 Value 起始位置刚好比上层多 100px，
这保证了视觉上的"阶梯式对齐"效果。
```

---

## 代码中的 Magic Numbers

当前代码中存在一些未命名的数字常量：

| Magic Number | 出现位置 | 含义 |
|--------------|---------|------|
| `8` | 多处 | 树的基础左边距 (BASE_INDENT) |
| `12` | LEVEL_WIDTH 计算 | Value 区域与下一层的视觉间距 |
| `-1` | 根节点 contentLeft | 让图标中心对齐到 x=8 |
| `-2` | 水平分支线末端 | 与 Key 区域的间距 |
| `4` | 菜单按钮定位 | 按钮与 Value 的间距 |
| `6` | CORNER_RADIUS | Reddit 风格圆角半径 |
| `4` | CONTAINER_GAP | 容器边界间距（顶部 & 底部） |

### 可选的改进方案

```typescript
// 命名常量
const BASE_INDENT = 8           // 树的起始位置
const VALUE_GAP = 12            // Value 到下一层的间距
const ROOT_OFFSET = -1          // 根节点图标对齐偏移
const LINE_END_GAP = 2          // 水平线末端间距
const MENU_GAP = 4              // 菜单按钮间距
const CORNER_RADIUS = 6         // Reddit 风格圆角半径
const CONTAINER_GAP = 8         // 容器边界间距（顶部 & 底部）

// 辅助函数
const getVerticalLineX = (depth: number) => BASE_INDENT + depth * LEVEL_WIDTH
const getContentLeft = (depth: number) => getVerticalLineX(depth) + BRANCH_WIDTH
const getValueStart = (depth: number) => getContentLeft(depth) + KEY_WIDTH + SEP_WIDTH
```

---

## 总结

### 核心设计思想

1. **固定层级宽度**：每层缩进 100px (LEVEL_WIDTH)，保证视觉一致性
2. **竖线对齐**：`竖线 X = 8 + depth × 100`
3. **内容对齐**：`内容起始 = 竖线 X + 16`
4. **阶梯式布局**：每层 Value 起始位置比上层多 100px

### 关键特性

| 特性 | 实现方式 |
|------|---------|
| 连接线连续性 | SVG 绘制，parentLines 记录祖先状态 |
| 支持多行内容 | SVG height: 100%，行 minHeight 而非固定高度 |
| 虚拟滚动兼容 | 每行独立计算，不依赖 DOM 结构 |
| 根节点对齐 | contentLeft = -1 让图标中心对齐 |
| Reddit 风格圆角 | 二次贝塞尔曲线 (Q命令)，半径 6px |
| 容器边界间距 | 容器节点顶部 8px + 最后子节点底部 8px |

---

## 视觉优化：Reddit 风格连接线

### 圆角连接线

传统的树形图使用直角连接线（├─ 和 └─），但这看起来比较生硬。
我们采用 Reddit 评论区的设计风格，使用圆角连接线让界面更有人情味。

**对比效果**：

```
传统直角                Reddit 风格圆角
                        
   │                       │
   │                       │
   ├── item1               ├── item1
   │                       │
   └── item2               ╰── item2
   ↑                       ↑
 生硬                    柔和
```

### 容器边界间距

为了帮助用户区分不同容器（Object/Array）的层级边界，
我们采用**双向间距**策略：

**核心规则**：

```typescript
// 1. 顶部间距：容器节点始终有
const extraTopPadding = node.isExpandable ? CONTAINER_GAP : 0

// 2. 底部间距：容器节点始终有，OR 最后一个子节点
const shouldAddBottomGap = node.isExpandable || node.isLast
```

**设计原理**：
- **容器节点**：始终有上下 4px 间距，不论展开/收起状态
- **非容器的最后一个子节点**：有底部 4px，标记父容器结束
- 逻辑简洁统一，视觉节奏和谐

**对齐机制**：

当容器有 `paddingTop` 时，分支线和 Handle 都要跟着偏移：

```typescript
// 分支线的 Y 位置 = paddingTop + 内容区中心
const branchY = topOffset + ROW_HEIGHT / 2

// Handle 也要下移
styles.menuHandle = { top: topOffset, ... }
```

**效果示例**：

```
mails ────────────────── {3}        ← 容器：+4px 顶部 & 底部 ✓
  │
  ├── account ─────── "user@example.com"
  │
  │   ↑ 4px 顶部
  ├── history ─────── [3]           ← 容器：+4px 顶部 & 底部 ✓
  │     │             ↓ 4px 底部
  │     │   ↑ 4px 顶部
  │     ├── 0 ─────── {6}           ← 容器：+4px 顶部 & 底部 ✓
  │     │     │       ↓ 4px 底部
  │     │     ├── id ─── "msg_001"
  │     │     │
  │     │     ╰── from ─── "..."    ← isLast：+4px 底部 ✓
  │     │
  │     │   ↑ 4px 顶部
  │     ╰── 2 ─────── {6}           ← 容器 + isLast：+4px 顶部 & 底部 ✓
  │           │       ↓ 4px 底部
  │           ├── id ─── "msg_003"
  │           │
  │           ╰── from ─── "..."    ← isLast：+4px 底部 ✓
  │
  ╰── last_used ───── "Dec.12.2025" ← isLast：+4px 底部 ✓
```

这种设计的优点：
1. **简洁**：规则只有两条，容易理解
2. **统一**：容器节点始终有固定的视觉边界
3. **和谐**：不论展开/收起，间距保持一致

### 扩展性

如需调整布局，只需修改以下常量：

```typescript
const BRANCH_WIDTH = 16   // 调整分支线宽度
const KEY_WIDTH = 64      // 调整 Key 区域宽度
const SEP_WIDTH = 8       // 调整分隔线宽度
// LEVEL_WIDTH 会自动重新计算
```

---

## 附录：完整布局流程

```
1. 数据层
   JSON 对象 → flattenJson() → FlatNode[] (扁平化节点列表)
   每个 FlatNode 包含: path, key, value, depth, isLast, parentLines

2. 虚拟滚动
   useVirtualizer() 根据滚动位置决定渲染哪些行

3. 行渲染 (VirtualRow)
   对于每个可见的 FlatNode:
   ├── 计算 contentLeft = 8 + depth × 100 + 16
   ├── 渲染 LevelConnector (SVG 连接线)
   ├── 渲染 MenuButton (absolute 定位)
   └── 渲染 内容区域
       ├── Key (64px)
       ├── SEP (8px 分隔线)
       └── Value (flex)

4. 连接线渲染 (LevelConnector)
   ├── 遍历 parentLines，画祖先竖线
   └── 画当前节点的 ├─ 或 └─
```

