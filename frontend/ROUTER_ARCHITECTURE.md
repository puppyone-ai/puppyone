# 前端路由架构重构方案 (v3.2)

基于 Next.js App Router (Nested Layouts) 的三栏式布局设计方案。

## 1. 核心目录结构 (Directory Structure)

```text
app/
├── (main)/                                 <-- 🔒 路由组：路径中不显示
│   │                                           作用：为内部页面共享【一级侧边栏】
│   ├── layout.tsx                          <-- 🟢【一级 Layout】渲染 ProjectsSidebar
│   │
│   ├── projects/
│   │   ├── page.tsx                        <-- 🔗 URL: /projects (引导页/空状态)
│   │   └── [projectId]/
│   │       ├── page.tsx                    <-- 🔗 URL: /projects/123 (项目概览)
│   │       └── [tableId]/
│   │           └── page.tsx                <-- 🔗 URL: /projects/123/456 (核心表格视图)
│   │
│   ├── settings/
│   │   ├── layout.tsx                      <-- 🟡【二级 Layout】渲染 "Settings Sidebar"
│   │   │                                       (仅包含 "Connect" 菜单项)
│   │   ├── page.tsx                        <-- 🔗 URL: /settings (重定向 -> connect)
│   │   └── connect/
│   │       └── page.tsx                    <-- 🔗 URL: /settings/connect (集成/连接页面)
│   │
│   └── tools-and-server/                   <-- 🔗 URL: /tools-and-server
│       ├── layout.tsx                      <-- 🔵【二级 Layout】渲染 "Library Sidebar"
│       │                                       (包含 Tools List 按钮 + Server 列表)
│       ├── page.tsx                        <-- 🔗 URL: /tools-and-server (重定向 -> tools-list)
│       │
│       ├── tools-list/                     <-- 🔗 URL: /tools-and-server/tools-list
│       │   └── page.tsx                        (显示 Tools 大表格)
│       │
│       └── servers/
│           └── [serverId]/                 <-- 🔗 URL: /tools-and-server/servers/xxx
│               └── page.tsx                    (显示 Server 详情)
│
├── login/                                  <-- 🔗 URL: /login (独立页面)
│   └── page.tsx
│
├── layout.tsx                              <-- 🌐【根 Layout】Providers, Fonts, Metadata
├── middleware.ts                           <-- 🛡️ 路由守卫 (Auth Redirects)
└── page.tsx                                <-- 🔗 URL: / (重定向 -> /projects)
```

## 2. 布局层级 (Layout Hierarchy)

利用嵌套布局实现无刷新切换右侧内容：

1.  **Level 1 (`app/(main)/layout.tsx`)**
    *   **组件**: `<ProjectsSidebar />`
    *   **职责**: 全局一级导航 (Projects, Settings, Tools & Server)。
    *   **行为**: 切换主模块时保持不变。

2.  **Level 2 (`app/(main)/settings/layout.tsx`)**
    *   **组件**: Settings Sidebar (手写或独立组件)
    *   **职责**: 设置模块内的二级导航 (Workspace > Connect)。
    *   **行为**: 仅在 `/settings/*` 路由下显示，切换具体设置项时保持不变。

3.  **Level 2 (`app/(main)/tools-and-server/layout.tsx`)**
    *   **组件**: Library Sidebar (手写或独立组件)
    *   **职责**: 工具模块内的二级导航 (Library > Tools List, Deployed Servers > ...)。
    *   **行为**: 仅在 `/tools-and-server/*` 路由下显示。

## 3. 关键交互说明

*   **New Server**: 不使用独立路由 (`/new`)，而是点击侧边栏 "+" 号后弹出 **Modal (对话框)**，保持上下文不丢失。
*   **Projects Tools**: 针对特定 Table 的工具配置，建议在 `/projects/...` 页面内使用 **Drawer (抽屉)** 或 Modal 处理，不创建深层路由。
*   **Redirects**:
    *   `/` -> `/projects`
    *   `/settings` -> `/settings/connect`
    *   `/tools-and-server` -> `/tools-and-server/tools-list`

## 4. 迁移检查清单

- [ ] 创建 `app/(main)/layout.tsx` 并移入 `ProjectsSidebar`。
- [ ] 创建 `app/(main)/tools-and-server` 目录结构。
- [ ] 创建 `app/(main)/settings` 目录结构。
- [ ] 将现有的 `app/projects` 移动到 `app/(main)/projects`。
- [ ] 更新 `middleware.ts` 确保路由保护规则覆盖新路径。
- [ ] 更新 `ProjectsSidebar` 中的链接为 Next.js `<Link>`。

