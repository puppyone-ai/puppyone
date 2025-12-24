# ETL Mount Key 优化方案

## 问题描述

当前架构下，前端创建的占位符 key 和后端写入的数据 key 不匹配：

- **前端占位符 key**：原始文件名，如 `Invoice-1EEF21AD-0013.pdf`
- **后端数据 key**：`{basename}-{hash[:8]}`，如 `Invoice-1EEF21AD-0013-a1b2c3d4`

导致任务完成后，占位符变成 `null`，数据写入到另一个 key。

## 当前方案

**创建 null 占位符 + pending task 列表**：
- ETL 文件在 JSON 中创建 `null` 占位符，保持文件结构
- 配合 `sessionStorage` 中的 pending task 列表
- JSON 编辑器检测到 `null` 值 + 匹配的 pending task 时，显示 loading 状态
- 任务完成后，后端数据会写入到另一个 key（`{basename}-{hash}`）

**已知问题**：
- 占位符的 key（文件名）和后端写入的 key（文件名-hash）不同
- 任务完成后，占位符仍为 `null`，数据在另一个 key 中
- 需要后端改动才能完美解决

---

## 推荐优化方案（需要后端改动）

### 后端改动

在 `upload_and_submit` 响应中返回 `mount_key`：

```python
# backend/src/etl/router.py

class UploadAndSubmitItem(BaseModel):
    filename: str
    task_id: int
    status: ETLTaskStatus
    s3_key: Optional[str] = None
    mount_key: Optional[str] = None  # 新增字段
    error: Optional[str] = None

# 在 upload_and_submit 函数中
suffix = hashlib.sha1(s3_key.encode("utf-8")).hexdigest()
mount_key = f"{original_basename}-{suffix[:8]}"

items.append(
    UploadAndSubmitItem(
        filename=original_filename,
        task_id=task.task_id,
        status=ETLTaskStatus.PENDING,
        s3_key=s3_key,
        mount_key=mount_key,  # 返回给前端
    )
)
```

### 前端改动

使用 `mount_key` 作为 JSON 占位符的 key：

```typescript
// frontend/components/TableManageDialog.tsx

// 1. 解析文件结构时，先不创建占位符
// 2. 调用 uploadAndSubmit 获取 mount_key
// 3. 用 mount_key 创建占位符
```

## 优点

- 前后端 key 完全一致
- 任务完成后数据自动覆盖占位符
- 用户体验更好

## 讨论要点

1. 是否接受在 `UploadAndSubmitItem` 中添加 `mount_key` 字段？
2. 这个字段是否需要在其他 API 中也返回（如 `GET /tasks/{id}`）？

---

*创建时间：2024-12-24*
*状态：待讨论*

