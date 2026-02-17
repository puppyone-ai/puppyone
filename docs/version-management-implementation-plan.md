# 版本管理系统 — 实施技术方案

> 基于现有代码模式的逐步实施计划，共 5 步。每步独立可验证。

---

## 步骤 1：Repository 层（新表的 CRUD）

### 1.1 新建文件

```
backend/src/content_node/
├── repository.py          ← 现有，不改
├── version_repository.py  ← 新建
└── ...
```

### 1.2 FileVersionRepository

**文件**: `backend/src/content_node/version_repository.py`

**类签名**（遵循现有 ContentNodeRepository 的模式）：

```python
class FileVersionRepository:
    TABLE_NAME = "file_versions"
    
    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client
```

**需要实现的方法：**

| 方法 | 参数 | 返回值 | 用途 |
|------|------|--------|------|
| `create` | node_id, version, content_json/text/s3_key, content_hash, size_bytes, operator_type, operator_id, session_id, operation, snapshot_id, summary | FileVersion | 创建新版本 |
| `get_by_node_and_version` | node_id, version | FileVersion \| None | 获取指定版本 |
| `list_by_node` | node_id, limit=50, offset=0 | list[FileVersion] | 查看文件的版本历史 |
| `get_latest_by_node` | node_id | FileVersion \| None | 获取最新版本 |
| `find_by_hash` | node_id, content_hash | FileVersion \| None | S3 去重查询 |
| `list_by_snapshot` | snapshot_id | list[FileVersion] | 查看某次操作的所有文件改动 |
| `count_by_node` | node_id | int | 某文件的版本总数 |

**Supabase 调用模式（与现有代码一致）：**

```python
# CREATE
def create(self, ...) -> FileVersion:
    data = {
        "node_id": node_id,
        "version": version,
        "content_json": content_json,
        "content_text": content_text,
        "s3_key": s3_key,
        "content_hash": content_hash,
        "size_bytes": size_bytes,
        "snapshot_id": snapshot_id,
        "operator_type": operator_type,
        "operator_id": operator_id,
        "session_id": session_id,
        "operation": operation,
        "merge_strategy": merge_strategy,
        "summary": summary,
    }
    # 去掉 None 值
    data = {k: v for k, v in data.items() if v is not None}
    response = self.client.table(self.TABLE_NAME).insert(data).execute()
    return self._row_to_model(response.data[0])

# READ
def get_by_node_and_version(self, node_id: str, version: int) -> Optional[FileVersion]:
    response = (
        self.client.table(self.TABLE_NAME)
        .select("*")
        .eq("node_id", node_id)
        .eq("version", version)
        .execute()
    )
    if response.data:
        return self._row_to_model(response.data[0])
    return None

# LIST（版本历史，按版本号倒序）
def list_by_node(self, node_id: str, limit: int = 50, offset: int = 0) -> list[FileVersion]:
    response = (
        self.client.table(self.TABLE_NAME)
        .select("*")
        .eq("node_id", node_id)
        .order("version", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [self._row_to_model(row) for row in response.data]

# FIND BY HASH（S3 去重）
def find_by_hash(self, node_id: str, content_hash: str) -> Optional[FileVersion]:
    response = (
        self.client.table(self.TABLE_NAME)
        .select("*")
        .eq("node_id", node_id)
        .eq("content_hash", content_hash)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    if response.data:
        return self._row_to_model(response.data[0])
    return None
```

### 1.3 FolderSnapshotRepository

**在同一文件** `version_repository.py` 中。

```python
class FolderSnapshotRepository:
    TABLE_NAME = "folder_snapshots"
    
    def __init__(self, supabase_client: SupabaseClient):
        self.client = supabase_client.client
```

**需要实现的方法：**

| 方法 | 参数 | 返回值 | 用途 |
|------|------|--------|------|
| `create` | folder_node_id, file_versions_map, changed_files, files_count, changed_count, operator_type, operator_id, session_id, operation, summary, base_snapshot_id | FolderSnapshot | 创建新快照 |
| `get_by_id` | snapshot_id | FolderSnapshot \| None | 获取指定快照 |
| `list_by_folder` | folder_node_id, limit=50, offset=0 | list[FolderSnapshot] | 查看文件夹的快照历史 |
| `get_latest_by_folder` | folder_node_id | FolderSnapshot \| None | 获取最新快照 |

### 1.4 Pydantic 模型

**新建文件**: `backend/src/content_node/version_schemas.py`

```python
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class FileVersion(BaseModel):
    """文件版本模型"""
    id: int
    node_id: str
    version: int
    content_json: Optional[Any] = None
    content_text: Optional[str] = None
    s3_key: Optional[str] = None
    content_hash: str
    size_bytes: int = 0
    snapshot_id: Optional[int] = None
    operator_type: str
    operator_id: Optional[str] = None
    session_id: Optional[str] = None
    operation: str
    merge_strategy: Optional[str] = None
    summary: Optional[str] = None
    created_at: datetime


class FolderSnapshot(BaseModel):
    """文件夹快照模型"""
    id: int
    folder_node_id: str
    file_versions_map: dict[str, int]  # {node_id: version}
    changed_files: Optional[list[str]] = None
    files_count: int = 0
    changed_count: int = 0
    operator_type: str
    operator_id: Optional[str] = None
    session_id: Optional[str] = None
    operation: str
    summary: Optional[str] = None
    base_snapshot_id: Optional[int] = None
    created_at: datetime


# ---- API 请求/响应 ----

class FileVersionInfo(BaseModel):
    """版本列表项（不含完整内容，节省带宽）"""
    id: int
    version: int
    content_hash: str
    size_bytes: int
    operator_type: str
    operator_id: Optional[str] = None
    operation: str
    summary: Optional[str] = None
    created_at: datetime


class FileVersionDetail(FileVersionInfo):
    """版本详情（含完整内容）"""
    content_json: Optional[Any] = None
    content_text: Optional[str] = None
    s3_key: Optional[str] = None


class VersionHistoryResponse(BaseModel):
    """版本历史响应"""
    node_id: str
    current_version: int
    versions: list[FileVersionInfo]
    total: int


class FolderSnapshotInfo(BaseModel):
    """快照列表项"""
    id: int
    file_versions_map: dict[str, int]
    changed_files: Optional[list[str]] = None
    files_count: int
    changed_count: int
    operator_type: str
    operator_id: Optional[str] = None
    operation: str
    summary: Optional[str] = None
    created_at: datetime


class RollbackRequest(BaseModel):
    """回滚请求"""
    pass  # 路径参数已包含 version/snapshot_id

class FolderRollbackRequest(BaseModel):
    """文件夹回滚请求"""
    pass
```

### 1.5 依赖注入

**修改文件**: `backend/src/content_node/dependencies.py`（或在 router 中直接定义）

```python
def get_version_repository() -> FileVersionRepository:
    return FileVersionRepository(SupabaseClient())

def get_snapshot_repository() -> FolderSnapshotRepository:
    return FolderSnapshotRepository(SupabaseClient())

def get_version_service(
    node_repo: ContentNodeRepository = Depends(get_content_node_repository),
    version_repo: FileVersionRepository = Depends(get_version_repository),
    snapshot_repo: FolderSnapshotRepository = Depends(get_snapshot_repository),
    s3_service: S3Service = Depends(get_s3_service),
) -> VersionService:
    return VersionService(node_repo, version_repo, snapshot_repo, s3_service)
```

---

## 步骤 2：Version Service（核心业务逻辑）

### 2.1 新建文件

```
backend/src/content_node/
├── version_service.py  ← 新建
└── ...
```

### 2.2 类签名

```python
class VersionService:
    def __init__(
        self,
        node_repo: ContentNodeRepository,
        version_repo: FileVersionRepository,
        snapshot_repo: FolderSnapshotRepository,
        s3_service: S3Service,
    ):
        self.node_repo = node_repo
        self.version_repo = version_repo
        self.snapshot_repo = snapshot_repo
        self.s3 = s3_service
```

### 2.3 核心方法

#### `create_version()` — 创建新版本（所有写操作的入口）

```
输入：node_id, new_content (json/text/file), operator_type, operator_id, session_id, operation
输出：FileVersion

流程：
  1. 获取当前节点 → node = node_repo.get_by_id(node_id)
  2. 计算新内容的 content_hash (SHA-256)
  3. 如果 hash 与 node.content_hash 相同 → 内容没变，返回 None（不创建版本）
  4. 调用 PG 函数 next_version(node_id) 获取新版本号
  5. 根据文件类型决定存储方式：
     - JSON: content_json = new_content
     - Markdown: content_text = new_content
     - 大文件: 
       a. 检查 hash 去重 → version_repo.find_by_hash(node_id, hash)
       b. 如果找到相同 hash → 复用 s3_key
       c. 否则上传 S3 → s3_key = f"versions/{node_id}/v{version}/{name}"
  6. INSERT INTO file_versions
  7. UPDATE content_nodes SET preview_json/preview_md/s3_key, current_version, content_hash
  8. 返回 FileVersion
```

#### `create_version_with_optimistic_lock()` — 带乐观锁的版本创建

```
输入：同上 + expected_version
输出：FileVersion

流程：
  1. 获取当前节点
  2. if node.current_version != expected_version → 抛出 ConflictException
  3. 调用 create_version()
```

#### `rollback_file()` — 单文件回滚

```
输入：node_id, target_version, operator_id
输出：FileVersion（新创建的版本）

流程：
  1. old = version_repo.get_by_node_and_version(node_id, target_version)
  2. 如果 old 不存在 → 抛出 NotFoundException
  3. 调用 create_version()，内容 = old 的内容，operation = 'rollback'
  4. 返回新版本
```

#### `rollback_folder()` — 文件夹回滚

```
输入：folder_node_id, target_snapshot_id, operator_id
输出：FolderSnapshot（新创建的快照）

流程：
  1. target = snapshot_repo.get_by_id(target_snapshot_id)
  2. 获取当前各文件版本号
  3. 对比，找出需要回滚的文件
  4. 逐个调用 rollback_file()
  5. 创建新的 folder_snapshot
  6. 返回新快照
```

#### `create_folder_snapshot()` — 创建文件夹快照

```
输入：folder_node_id, changed_node_ids, operator_type, operator_id, session_id, operation, summary
输出：FolderSnapshot

流程：
  1. 获取文件夹下所有子节点 → node_repo.list_descendants()
  2. 构建 file_versions_map = {child.id: child.current_version for child in children}
  3. INSERT INTO folder_snapshots
  4. 将 snapshot_id 关联到对应的 file_versions
  5. 返回 FolderSnapshot
```

#### `get_version_history()` — 查看文件版本历史

```
输入：node_id, limit=50, offset=0
输出：VersionHistoryResponse

流程：
  1. node = node_repo.get_by_id(node_id)
  2. versions = version_repo.list_by_node(node_id, limit, offset)
  3. total = version_repo.count_by_node(node_id)
  4. 返回 VersionHistoryResponse(node_id, node.current_version, versions, total)
```

#### `get_version_content()` — 获取某个版本的完整内容

```
输入：node_id, version
输出：FileVersionDetail

流程：
  1. version = version_repo.get_by_node_and_version(node_id, version)
  2. 如果有 s3_key → 生成 presigned URL（不直接下载）
  3. 返回 FileVersionDetail
```

#### `compute_hash()` — 计算内容哈希（静态方法）

```
输入：content (json/text/bytes)
输出：str (SHA-256 hex)

逻辑：
  - JSON: json.dumps(content, sort_keys=True, ensure_ascii=False).encode() → sha256
  - Text: content.encode('utf-8') → sha256
  - Bytes: 直接 sha256
```

---

## 步骤 3：改造 content_node/service.py

### 3.1 改动范围

**修改文件**: `backend/src/content_node/service.py`

**改动原则**: 所有现有的写操作（create/update/delete）在执行后，增加版本记录的创建。**不改变现有方法签名和返回值**，对调用方透明。

### 3.2 修改 `__init__`

```python
# 现在
def __init__(self, repo: ContentNodeRepository, s3_service: S3Service):
    self.repo = repo
    self.s3 = s3_service

# 改为
def __init__(self, repo: ContentNodeRepository, s3_service: S3Service, 
             version_service: Optional[VersionService] = None):
    self.repo = repo
    self.s3 = s3_service
    self.version_service = version_service  # 可选，向后兼容
```

### 3.3 修改 `update_node()`

```python
# 现在（简化）
def update_node(self, node_id, project_id, name=None, preview_json=None, preview_md=None):
    self.get_by_id(node_id, project_id)  # 验证
    updated = self.repo.update(node_id=node_id, ...)
    return updated

# 改为
def update_node(self, node_id, project_id, name=None, preview_json=None, preview_md=None,
                operator_type="user", operator_id=None, session_id=None):
    self.get_by_id(node_id, project_id)  # 验证
    updated = self.repo.update(node_id=node_id, ...)
    
    # 新增：创建版本记录
    if self.version_service and (preview_json is not None or preview_md is not None):
        content = preview_json if preview_json is not None else preview_md
        self.version_service.create_version(
            node_id=node_id,
            new_content=content,
            operator_type=operator_type,
            operator_id=operator_id,
            session_id=session_id,
            operation="update",
        )
    
    return updated
```

### 3.4 修改 `create_folder()` / `create_json_node()` / `create_markdown_node()`

在创建节点后，追加：

```python
if self.version_service:
    self.version_service.create_version(
        node_id=new_node.id,
        new_content=content,
        operator_type="user",
        operator_id=created_by,
        operation="create",
    )
```

### 3.5 修改 `delete_node()`

在删除前，记录删除版本：

```python
if self.version_service:
    self.version_service.create_version(
        node_id=node_id,
        new_content=None,
        operator_type="user",
        operator_id=operator_id,
        operation="delete",
    )
```

### 3.6 影响评估

| 方法 | 改动 | 对调用方影响 |
|------|------|------------|
| `__init__` | 加 version_service 参数（Optional） | 无，向后兼容 |
| `update_node` | 加 operator_type/id/session_id 参数 + 版本创建 | 无，新参数有默认值 |
| `create_folder` | 追加版本创建 | 无 |
| `create_json_node` | 追加版本创建 | 无 |
| `create_markdown_node` | 追加版本创建 | 无 |
| `delete_node` | 追加删除版本记录 | 无 |
| `move_node` | 不改（移动不改内容） | 无 |

**所有改动对现有调用方完全透明** — 不改方法签名，不改返回值，新参数都有默认值。

---

## 步骤 4：改造 agent/service.py（Agent 沙盒写回）

### 4.1 改动范围

**修改文件**: `backend/src/agent/service.py`

**改动位置**: `stream_events()` 方法中的写回部分（约 lines 975-1057）和 `execute_task_sync()` 中的写回部分（约 lines 351-410）。

### 4.2 改动内容

两处写回逻辑的改动完全相同，核心是：

```python
# 现在
node_service.update_node(
    node_id=node_id,
    project_id=node.project_id,
    preview_json=updated_data,
)

# 改为
node_service.update_node(
    node_id=node_id,
    project_id=node.project_id,
    preview_json=updated_data,
    operator_type="agent",           # ← 新增
    operator_id=agent_id,            # ← 新增
    session_id=session_id,           # ← 新增
)
```

### 4.3 批量写回时创建 folder_snapshot

```python
# 在写回循环结束后，新增：
if self.version_service and updated_nodes and root_node_type == "folder":
    changed_node_ids = [n["nodeId"] for n in updated_nodes]
    self.version_service.create_folder_snapshot(
        folder_node_id=root_node_id,
        changed_node_ids=changed_node_ids,
        operator_type="agent",
        operator_id=agent_id,
        session_id=session_id,
        operation="agent_merge",
        summary=f"Agent modified {len(changed_node_ids)} files",
    )
```

### 4.4 影响评估

| 改动 | 风险 |
|------|------|
| update_node 加 3 个参数 | 零风险，参数有默认值 |
| 写回后创建 snapshot | 零风险，只是追加操作，不影响主流程 |
| 异常处理 | snapshot 创建失败不应阻塞主流程，需要 try/except 包裹 |

---

## 步骤 5：新增版本历史 + 回滚 API

### 5.1 新建文件

```
backend/src/content_node/
├── version_router.py  ← 新建
└── ...
```

### 5.2 路由定义

```python
router = APIRouter(
    prefix="/nodes",
    tags=["content-node-versions"],
)
```

### 5.3 API 端点清单

#### 5.3.1 文件版本历史

```
GET /api/v1/nodes/{node_id}/versions?project_id=xxx&limit=50&offset=0

响应：
{
  "code": 0,
  "data": {
    "node_id": "abc123",
    "current_version": 3,
    "versions": [
      {
        "id": 100,
        "version": 3,
        "content_hash": "sha256:...",
        "size_bytes": 1024,
        "operator_type": "agent",
        "operator_id": "agent-abc",
        "operation": "update",
        "summary": "Modified count field",
        "created_at": "2026-02-15T12:00:00Z"
      },
      ...
    ],
    "total": 3
  }
}
```

#### 5.3.2 获取某个版本的内容

```
GET /api/v1/nodes/{node_id}/versions/{version}?project_id=xxx

响应：
{
  "code": 0,
  "data": {
    "id": 100,
    "version": 3,
    "content_json": {"count": 5, "name": "hello"},  // 或 content_text / s3_presigned_url
    "content_hash": "sha256:...",
    "size_bytes": 1024,
    "operator_type": "agent",
    "operation": "update",
    "created_at": "2026-02-15T12:00:00Z"
  }
}
```

#### 5.3.3 单文件回滚

```
POST /api/v1/nodes/{node_id}/rollback/{version}?project_id=xxx

响应：
{
  "code": 0,
  "data": {
    "new_version": 4,
    "rolled_back_to": 2,
    "node_id": "abc123"
  },
  "message": "已回滚到 v2"
}
```

#### 5.3.4 对比两个版本

```
GET /api/v1/nodes/{node_id}/diff/{v1}/{v2}?project_id=xxx

响应（JSON 文件的 diff）：
{
  "code": 0,
  "data": {
    "v1": 1,
    "v2": 3,
    "changes": [
      {"path": "/count", "old": 1, "new": 5},
      {"path": "/name", "old": "old", "new": "hello"}
    ]
  }
}
```

#### 5.3.5 文件夹快照历史

```
GET /api/v1/nodes/{folder_id}/snapshots?project_id=xxx&limit=50&offset=0

响应：
{
  "code": 0,
  "data": {
    "folder_node_id": "folder-abc",
    "snapshots": [
      {
        "id": 10,
        "file_versions_map": {"node_1": 3, "node_2": 1},
        "changed_files": ["node_1"],
        "files_count": 2,
        "changed_count": 1,
        "operator_type": "agent",
        "operation": "agent_merge",
        "summary": "Agent A modified 1 file",
        "created_at": "2026-02-15T12:00:00Z"
      },
      ...
    ],
    "total": 3
  }
}
```

#### 5.3.6 文件夹回滚

```
POST /api/v1/nodes/{folder_id}/rollback-snapshot/{snapshot_id}?project_id=xxx

响应：
{
  "code": 0,
  "data": {
    "new_snapshot_id": 11,
    "rolled_back_to_snapshot": 5,
    "files_restored": 3,
    "folder_node_id": "folder-abc"
  },
  "message": "已回滚到快照 #5，恢复了 3 个文件"
}
```

### 5.4 路由注册

**修改文件**: `backend/src/main.py`

```python
from src.content_node.version_router import router as version_router

app.include_router(version_router, prefix="/api/v1")
```

---

## 文件清单总览

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新建 | `content_node/version_schemas.py` | Pydantic 模型 |
| 新建 | `content_node/version_repository.py` | FileVersionRepository + FolderSnapshotRepository |
| 新建 | `content_node/version_service.py` | VersionService 核心逻辑 |
| 新建 | `content_node/version_router.py` | 版本管理 API 端点 |
| 修改 | `content_node/service.py` | 写操作接入版本管理（加 ~30 行） |
| 修改 | `content_node/dependencies.py` | 新增依赖注入工厂 |
| 修改 | `agent/service.py` | 写回加 operator 参数 + snapshot 创建（加 ~20 行） |
| 修改 | `main.py` | 注册新路由（加 2 行） |

**新建 4 个文件，修改 4 个文件。现有代码的改动量约 50 行，且全部向后兼容。**

---

## 实施顺序和验证方式

| 步骤 | 完成后的验证方式 |
|------|----------------|
| 1. Repository 层 | 写单元测试，直接调用 CRUD 方法验证数据库读写 |
| 2. Version Service | 调用 create_version()，检查 file_versions 表有新记录 |
| 3. 改造 content_node | 在前端改一个 JSON 文件，检查 file_versions 表自动多了一条记录 |
| 4. 改造 agent | 让 Agent 执行一次操作，检查 file_versions 和 folder_snapshots 都有记录 |
| 5. 新增 API | 调用 GET /nodes/{id}/versions 看到版本历史，POST rollback 验证回滚 |

---

*每一步都独立可验证，失败不影响现有功能（version_service 是 Optional 的）。*
