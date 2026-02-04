# Railway 多服务部署指南

本文档详细说明如何在 Railway 上部署项目的三个服务：API 服务、ETL Worker（文件处理）和 Import Worker（SaaS 同步）。

## 📋 服务概览

| 服务名称 | SERVICE_ROLE | 功能描述 | 启动命令 |
|---------|--------------|---------|---------|
| API Service | `api` (默认) | FastAPI 主服务，提供 REST API | `uvicorn src.main:app` |
| ETL Worker | `etl_worker` | 文件处理（OCR、PDF解析、文档处理） | `arq src.etl.jobs.worker.WorkerSettings` |
| Import Worker | `import_worker` | SaaS 数据同步（GitHub、Notion、Google 等） | `arq src.import_.jobs.worker.WorkerSettings` |

> **注意**: `worker` 是 `etl_worker` 的旧别名，保留向后兼容。

---

## 🚀 部署步骤 SOP

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

### 步骤 4: 创建 ETL Worker 服务

1. 点击 **+ New** → **GitHub Repo** → 选择 **同一个仓库**
2. 设置 **Root Directory**: `backend`
3. 服务名称改为：`ETL Worker`
4. 在 **Variables** 中设置：
   ```
   SERVICE_ROLE=etl_worker
   ```
5. 复制 API Service 的所有环境变量（或使用 Shared Variables）

### 步骤 5: 创建 Import Worker 服务

1. 点击 **+ New** → **GitHub Repo** → 选择 **同一个仓库**
2. 设置 **Root Directory**: `backend`
3. 服务名称改为：`Import Worker`
4. 在 **Variables** 中设置：
   ```
   SERVICE_ROLE=import_worker
   ```
5. 复制 API Service 的所有环境变量（或使用 Shared Variables）

---

## 🔐 环境变量配置

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
IMPORT_REDIS_URL=redis://default:xxx@redis.railway.internal:6379
# 注意：两个 Worker 可以共用同一个 Redis，队列名不同不会冲突

# ========== 应用配置 ==========
DEBUG=False
APP_NAME=ContextBase
VERSION=1.0.0
ALLOWED_HOSTS=https://your-frontend.com
PUBLIC_URL=https://your-api.railway.app
```

### ETL Worker 专用环境变量

```bash
# ========== MineRU API (文件 OCR 处理) ==========
MINERU_API_KEY=your-mineru-api-key
MINERU_API_BASE_URL=https://mineru.net/api/v4     # 可选，有默认值
MINERU_POLL_INTERVAL=5                            # 可选
MINERU_MAX_WAIT_TIME=600                          # 可选

# ========== ETL 配置 ==========
ETL_QUEUE_SIZE=30                                 # 可选
ETL_WORKER_COUNT=3                                # 可选
ETL_TASK_TIMEOUT=600                              # 可选，单位秒
ETL_ARQ_QUEUE_NAME=etl                            # 可选，有默认值
```

### Import Worker 专用环境变量

```bash
# ========== Import 配置 ==========
IMPORT_ARQ_QUEUE_NAME=import:queue                # 可选，有默认值
IMPORT_JOB_TIMEOUT_SECONDS=1800                   # 可选，30分钟
IMPORT_MAX_JOBS=10                                # 可选

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
GOOGLE_SHEETS_CLIENT_ID=your-google-client-id
GOOGLE_SHEETS_CLIENT_SECRET=your-google-client-secret
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

---

## 📊 Railway 项目架构图

```
Railway Project
│
├── 🗄️ Redis (Database)
│   └── Internal URL: redis://default:xxx@redis.railway.internal:6379
│
├── 🌐 API Service (backend)
│   ├── SERVICE_ROLE: api
│   ├── Exposes: Public URL (https://xxx.railway.app)
│   └── Handles: REST API, OAuth callbacks
│
├── 📄 ETL Worker (backend)
│   ├── SERVICE_ROLE: etl_worker
│   ├── No public URL (internal worker)
│   └── Handles: File OCR, PDF parsing, document processing
│
└── 🔄 Import Worker (backend)
    ├── SERVICE_ROLE: import_worker
    ├── No public URL (internal worker)
    └── Handles: GitHub, Notion, Google, Linear, Airtable sync
```

---

## ✅ 部署检查清单

### 基础设施
- [ ] Redis 服务已部署并运行
- [ ] 获取 Redis Internal URL

### API Service
- [ ] Root Directory 设置为 `backend`
- [ ] SERVICE_ROLE 设置为 `api`（或不设置）
- [ ] SUPABASE_URL 和 SUPABASE_KEY 已配置
- [ ] S3 存储配置完成
- [ ] JWT_SECRET 已生成并配置
- [ ] 健康检查通过：`curl https://your-api.railway.app/health`

### ETL Worker
- [ ] Root Directory 设置为 `backend`
- [ ] SERVICE_ROLE 设置为 `etl_worker`
- [ ] ETL_REDIS_URL 已配置（使用 Redis Internal URL）
- [ ] MINERU_API_KEY 已配置（如需文件 OCR）
- [ ] 日志显示：`Unified ARQ worker startup complete (ETL + Sync)`

### Import Worker
- [ ] Root Directory 设置为 `backend`
- [ ] SERVICE_ROLE 设置为 `import_worker`
- [ ] IMPORT_REDIS_URL 已配置（使用 Redis Internal URL）
- [ ] 所需 OAuth 配置完成（GitHub/Notion/Google 等）
- [ ] 日志显示：`Import worker initialized with all OAuth services`

---

## 🔧 使用 Shared Variables 简化配置

Railway 支持项目级共享变量，避免重复配置：

1. 点击项目名称进入项目设置
2. 选择 **Variables** 标签
3. 添加所有通用变量（SUPABASE_*, S3_*, JWT_*, Redis URLs）
4. 勾选 **Share with all services**

每个服务只需额外配置 `SERVICE_ROLE` 和特有变量。

---

## 🐛 故障排查

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

### 任务超时

**症状**: 任务在处理中被取消

**解决**: 
- 增加 `ETL_TASK_TIMEOUT` 或 `IMPORT_JOB_TIMEOUT_SECONDS`
- 检查任务是否卡在外部 API 调用

---

## 💰 成本估算

| 服务 | 推荐配置 | 预估月费 |
|-----|---------|---------|
| API Service | 1GB RAM | $8-12 |
| ETL Worker | 2GB RAM | $12-18 |
| Import Worker | 1GB RAM | $8-12 |
| Redis | 256MB | $3-5 |
| **总计** | - | **$31-47/月** |

可根据实际负载调整 Worker 数量（水平扩展多个相同 Worker 实例）。

---

## 📚 相关文档

- [Railway 官方文档](https://docs.railway.app)
- [ARQ Worker 文档](https://arq-docs.helpmanual.io/)
- [MineRU API 文档](https://mineru.net/docs)

