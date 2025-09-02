# 技术文档：修复创建节点后UI卡死的问题

## 1. 问题现象

在开发流程画布功能时，我们遇到了一个间歇性的UI卡死问题。具体表现为：

-   当用户从侧边栏拖拽某些“边节点”（如 `Convert2Structured`, `EditText`）到画布上时，操作偶尔会导致整个画布“卡住”。
-   这个问题在快速连续创建多个节点时尤其容易复现。
-   一旦卡住，用户无法再从侧边栏创建新节点，也无法与画布上任何已有的节点或边进行交互。整个UI处于无响应的锁定状态。

---

## 2. 根源分析：异步操作引发的竞态条件 (Race Condition)

经过深入排查，我们定位到问题的根源在于一个典型的**竞态条件**。它是由组件状态的同步更新和异步操作之间不可预测的时序冲突所导致的。

### 错误的逻辑：`useEffect` + `requestAnimationFrame`

在有问题的组件中，节点的“自动激活”逻辑（即调用 `clearAll()` 和 `activateEdge(id)`）被放置在一个 `useEffect` 钩子中，并使用 `requestAnimationFrame` (rAF) 来延迟执行。

**代码意图**：
开发者的初衷是好的，希望通过 `rAF` 确保节点在DOM中完全渲染完毕后才被激活，从而避免潜在的渲染问题。

**实际执行流程（问题所在）：**

让我们分解当用户快速创建第二个节点时，冲突是如何发生的：

1.  **创建第一个节点**：
    *   用户开始拖动节点，全局状态 `isOnGeneratingNewNode` 变为 `true`，UI暂时锁定以防误操作。
    *   用户将节点放置到画布上，`isOnGeneratingNewNode` 状态变为 `false`。
    *   节点的 `useEffect` 被触发。
    *   **关键点**：`useEffect` 内部的 `requestAnimationFrame` **并没有立即执行**激活操作，而是将 `clearAll()` 和 `activateEdge(id)` **“安排”**到未来的某个时间点（即下一次浏览器重绘前）执行。这就创造了一个微小但致命的时间窗口。

2.  **创建第二个节点（在 `rAF` 回调执行前）**：
    *   用户操作很快，在第一个节点的 `rAF` 回调函数触发之前，又立即开始拖动第二个节点。
    *   此时，全局状态 `isOnGeneratingNewNode` **再次变为 `true`**，UI 再次被锁定。

3.  **冲突爆发**：
    *   现在，浏览器的下一个绘制时机到来，第一个节点“安排”的 `rAF` 回调函数开始执行。
    *   它首先调用 `clearAll()`，该函数会重置整个画布的状态。
    *   **致命问题**：`clearAll()` 在一个完全错误的时间点被执行了。此时的应用程序正处于“正在创建第二个节点”的状态中（因为 `isOnGeneratingNewNode` 是 `true`）。`clearAll()` 强行重置了所有状态，直接破坏了这个正在进行中的流程。
    *   紧接着，它尝试激活第一个节点，但为时已晚，应用程序的状态已经因为这次意外的 `clearAll()` 调用而变得混乱和不一致。

**最终结果**：
应用程序的状态被卡住了。`isOnGeneratingNewNode` 可能仍然是 `true`，但能触发它变回 `false` 的正常流程已经被打断。因此，UI 保持在“锁定”状态，用户无法进行任何操作。这就是为什么问题时好时坏——它完全取决于用户的操作速度是否快过了 `requestAnimationFrame` 的回调时机。

---

## 3. 解决方案：同步执行与逻辑分离

最终的修复方案借鉴了其他工作正常的组件（如 `LLM.tsx`）中更健壮的模式。核心思想是**消除异步带来的不确定性**。

```typescript
// Hook 1: 标记组件已挂载
useEffect(() => {
  hasMountedRef.current = true;
}, []); // 这个 effect 只在组件首次渲染后运行一次

// Hook 2: 处理激活逻辑
useEffect(() => {
  // 确保组件已挂载，且当前不是正在创建新节点的状态
  if (hasMountedRef.current && !isOnGeneratingNewNode) {
    clearAll();
    activateEdge(id);
  }

  // 组件卸载或 isOnGeneratingNewNode 变化时执行清理
  return () => {
    if (activatedEdge === id) {
      clearEdgeActivation();
    }
  };
}, [isOnGeneratingNewNode]); // 只依赖于 isOnGeneratingNewNode
```

**这个修改的优势在于两点：**

1.  **移除了不确定性（同步执行）**：
    *   最关键的改动是**完全移除了 `requestAnimationFrame`**。
    *   现在，当您放下节点，`isOnGeneratingNewNode` 变为 `false` 时，第二个 `useEffect` 会被触发，`clearAll()` 和 `activateEdge(id)` 会**立即、同步地**在同一个React渲染周期内执行。
    *   这关闭了竞态条件的时间窗口。用户的任何后续操作都必须等待这个激活过程完全结束后才能开始。

2.  **清晰的逻辑分离（双 `useEffect` 模式）**：
    *   第一个 `useEffect`（带有空依赖数组 `[]`）专门用于处理“组件首次挂载”这一事件，只做一件事：设置 `hasMountedRef.current = true`。
    *   第二个 `useEffect` 专门用于响应 `isOnGeneratingNewNode` 这个状态的变化。`hasMountedRef.current` 这个检查确保了激活逻辑不会在组件的初始渲染帧上意外触发。

### 总结对比

| 对比项 | 错误的原逻辑 | 健壮的修复逻辑 |
| :--- | :--- | :--- |
| **执行时机** | **异步** (通过 `rAF`) | **同步** (在React渲染周期内) |
| **可靠性** | **不可靠**，依赖用户操作速度，导致竞态条件。 | **可靠**，状态更新和副作用紧密绑定，是原子性的操作。 |
| **逻辑结构** | 将挂载逻辑和状态响应逻辑混合。 | 使用两个独立的 `useEffect`，清晰地分离了不同职责。 |

<br>

通过确保状态更新和其副作用的**同步执行**，我们保证了应用程序状态的**一致性**，从而彻底修复了UI卡住的问题。