# Railway 多服务部署指南

本文档详细说明如何在 Railway 上部署项目的服务：API 服务、File Worker（文件 ETL）和 MCP Server（可选）。

## 服务概览

| 服务名称 | SERVICE_ROLE | 功能描述 | 启动命令 |
|---------|--------------|---------|---------|
| API Service | `api` (默认) | FastAPI 主服务，提供 REST API | `uvicorn src.main:app` |
| File Worker | `file_worker` | 文件 ETL 处理（OCR、PDF 解析、文档处理） | `arq src.upload.file.jobs.worker.WorkerSettings` |
| MCP Server | `mcp_server` | AI Agent MCP 协议服务 | `uvicorn mcp_service.server:app` |

> **注意**: 旧版 `saas_worker` / `import_worker` 已废弃移除，SaaS 同步已改为 API 服务内同步执行。

---

## 部署步骤 SOP

### 步骤 1: 创建 Railway 项目

1. 登录 [Railway](https://railway.app)
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择你的仓库

### 步骤 2: 添加 Redis 服务

1. 在项目中点击 **+ New** → **Database** → **Redis**
2. 等待 Redis 部署完成
3. 点击 Redis 服务，复制 **Internal URL**（格式：`redis://default:xxx@redis.railway.internal:6379`）

### 步骤 3: 创建 API 服务

1. 点击 **+ New** → **GitHub Repo** → 选择你的仓库
2. 设置 **Root Directory**: `backend`
3. 服务名称改为：`API Service`
4. 在 **Variables** 中设置环境变量（见下方"环境变量配置"）
5. 确保设置：`SERVICE_ROLE=api`（可省略，默认值）

### 步骤 4: 创建 File Worker 服务

1. 点击 **+ New** → **GitHub Repo** → 选择 **同一个仓库**
2. 设置 **Root Directory**: `backend`
3. 服务名称改为：`File Worker`
4. 在 **Variables** 中设置：
   ```
   SERVICE_ROLE=file_worker
   ```
5. 复制 API Service 的所有环境变量（或使用 Shared Variables）

### 步骤 5（可选）: 创建 MCP Server 服务

1. 点击 **+ New** → **GitHub Repo** → 选择 **同一个仓库**
2. 设置 **Root Directory**: `backend`
3. 服务名称改为：`MCP Server`
4. 在 **Variables** 中设置：
   ```
   SERVICE_ROLE=mcp_server
   ```
5. 复制 API Service 的所有环境变量（或使用 Shared Variables）

---

## 环境变量配置

### 通用环境变量（所有服务都需要）

```bash
# ========== Supabase 数据库 (必需) ==========
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key

# ========== S3 存储 (必需) ==========
S3_ENDPOINT_URL=https://s3.amazonaws.com          # AWS S3
# S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com  # Cloudflare R2
S3_BUCKET_NAME=your-bucket-name
S3_REGION=us-east-1                               # R2 使用 auto
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key

# ========== JWT 安全配置 (必需) ==========
JWT_SECRET=your-secure-random-secret-key
JWT_ALGORITHM=HS256

# ========== Redis (必需，从 Railway Redis 获取) ==========
ETL_REDIS_URL=redis://default:xxx@redis.railway.internal:6379

# ========== 应用配置 ==========
DEBUG=False
APP_NAME=ContextBase
VERSION=1.0.0
ALLOWED_HOSTS=https://your-frontend.com
PUBLIC_URL=https://your-api.railway.app

# ========== OAuth 配置（按需启用）==========

# --- GitHub ---
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=https://your-frontend.com/oauth/callback/github

# --- Notion ---
NOTION_CLIENT_ID=your-notion-client-id
NOTION_CLIENT_SECRET=your-notion-client-secret
NOTION_REDIRECT_URI=https://your-frontend.com/oauth/callback/notion

# --- Google (统一配置，Gmail/Drive/Calendar/Sheets/Docs 共用) ---
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_SHEETS_REDIRECT_URI=https://your-frontend.com/oauth/google-sheets/callback
GMAIL_REDIRECT_URI=https://your-frontend.com/oauth/gmail/callback
GOOGLE_DRIVE_REDIRECT_URI=https://your-frontend.com/oauth/google-drive/callback
GOOGLE_CALENDAR_REDIRECT_URI=https://your-frontend.com/oauth/google-calendar/callback
GOOGLE_DOCS_REDIRECT_URI=https://your-frontend.com/oauth/google-docs/callback

# --- Linear ---
LINEAR_CLIENT_ID=your-linear-client-id
LINEAR_CLIENT_SECRET=your-linear-client-secret
LINEAR_REDIRECT_URI=https://your-frontend.com/oauth/callback/linear

# --- Airtable ---
AIRTABLE_CLIENT_ID=your-airtable-client-id
AIRTABLE_CLIENT_SECRET=your-airtable-client-secret
AIRTABLE_REDIRECT_URI=https://your-frontend.com/oauth/callback/airtable
```

### File Worker 专用环境变量

```bash
# ========== OCR Provider ==========
# 可选值: "deepseek" (推荐) | "mineru" | "reducto"
OCR_PROVIDER=deepseek

# DeepSeek OCR (通过 DeepInfra，推荐)
DEEPINFRA_API_KEY=your-deepinfra-api-key

# MineRU (备选，注意 API Key 每 14 天过期)
# MINERU_API_KEY=your-mineru-api-key
# MINERU_API_BASE_URL=https://mineru.net/api/v4

# ========== ETL 配置 ==========
ETL_QUEUE_SIZE=30                                 # 可选
ETL_WORKER_COUNT=3                                # 可选
ETL_TASK_TIMEOUT=600                              # 可选，单位秒
ETL_ARQ_QUEUE_NAME=etl                            # 可选，有默认值
```

---

## Railway 项目架构图

```
Railway Project
│
├── 🗄️ Redis (Database)
│   └── Internal URL: redis://default:xxx@redis.railway.internal:6379
│
├── 🌐 API Service (backend)
│   ├── SERVICE_ROLE: api
│   ├── Exposes: Public URL (https://xxx.railway.app)
│   └── Handles: REST API, OAuth callbacks, SaaS sync (同步执行)
│
├── 📄 File Worker (backend)
│   ├── SERVICE_ROLE: file_worker
│   ├── No public URL (internal worker)
│   └── Handles: File OCR, PDF parsing, document processing
│
└── 🤖 MCP Server (backend, 可选)
    ├── SERVICE_ROLE: mcp_server
    ├── Exposes: Public URL
    └── Handles: MCP protocol for AI Agent
```

---

## 部署检查清单

### 基础设施
- [ ] Redis 服务已部署并运行
- [ ] 获取 Redis Internal URL

### API Service
- [ ] Root Directory 设置为 `backend`
- [ ] SERVICE_ROLE 设置为 `api`（或不设置）
- [ ] SUPABASE_URL 和 SUPABASE_KEY 已配置
- [ ] S3 存储配置完成
- [ ] JWT_SECRET 已生成并配置
- [ ] OAuth 配置完成（按需）
- [ ] 健康检查通过：`curl https://your-api.railway.app/health`

### File Worker
- [ ] Root Directory 设置为 `backend`
- [ ] SERVICE_ROLE 设置为 `file_worker`
- [ ] ETL_REDIS_URL 已配置（使用 Redis Internal URL）
- [ ] OCR Provider 已配置（推荐 DeepSeek + DEEPINFRA_API_KEY）
- [ ] 日志显示：`Starting worker for 2 functions: etl_ocr_job, etl_postprocess_job`

### MCP Server（可选）
- [ ] Root Directory 设置为 `backend`
- [ ] SERVICE_ROLE 设置为 `mcp_server`
- [ ] SUPABASE 和 JWT 配置完成

---

## 使用 Shared Variables 简化配置

Railway 支持项目级共享变量，避免重复配置：

1. 点击项目名称进入项目设置
2. 选择 **Variables** 标签
3. 添加所有通用变量（SUPABASE_*, S3_*, JWT_*, Redis URLs）
4. 勾选 **Share with all services**

每个服务只需额外配置 `SERVICE_ROLE` 和特有变量。

---

## 故障排查

### Worker 未启动

**症状**: 日志显示 `uvicorn` 而非 `arq`

**解决**: 检查 SERVICE_ROLE 环境变量是否正确设置

### Redis 连接失败

**症状**: `ConnectionRefusedError` 或 `Redis connection failed`

**解决**: 
- 确认使用 Railway 的 Internal URL（不是 Public URL）
- 格式：`redis://default:xxx@redis.railway.internal:6379`

### OAuth 回调失败

**症状**: OAuth 授权后跳转 404 或报错

**解决**: 
- 确认 `*_REDIRECT_URI` 指向正确的前端 URL
- 确认前端已部署并可访问该路由

### OCR 处理失败

**症状**: `MineRU API error: status=401`

**解决**: 
- MineRU API Key 每 14 天过期，建议切换到 DeepSeek OCR
- 设置 `OCR_PROVIDER=deepseek` + `DEEPINFRA_API_KEY`

### 任务超时

**症状**: 任务在处理中被取消

**解决**: 
- 增加 `ETL_TASK_TIMEOUT`
- 检查任务是否卡在外部 API 调用

---

## 成本估算

| 服务 | 推荐配置 | 预估月费 |
|-----|---------|---------|
| API Service | 1GB RAM | $8-12 |
| File Worker | 2GB RAM | $12-18 |
| MCP Server | 512MB RAM | $5-8 |
| Redis | 256MB | $3-5 |
| **总计** | - | **$28-43/月** |

可根据实际负载调整 Worker 数量（水平扩展多个相同 Worker 实例）。

---

## 相关文档

- [Railway 官方文档](https://docs.railway.app)
- [ARQ Worker 文档](https://arq-docs.helpmanual.io/)
