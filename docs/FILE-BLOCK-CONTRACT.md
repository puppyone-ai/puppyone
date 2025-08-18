# 给前端的交付说明（File Block v0.2 契约）

## 基本概念

- **resource_key**: `user_id/block_id/version_id`（稳定定位一个版本的资源集合）
- **manifest.json**: 文件目录与状态，增量更新；状态：`generating | completed | failed`
- **文件类型推断**: 解析时使用三段式推断：`explicit file_type > mime_type > 扩展名`

## 上传流程（前端最小实现）

**目标**: 用已有接口完成"多文件异步上传 + manifest 增量更新"，生成可被 Flow Server 识别的 resource_key

**接口**（均在 PuppyStorage）：
- `POST /upload/chunk/direct` 直接上传单个文件
- `PUT /upload/manifest` 增量更新 manifest（支持乐观锁 expected_etag）

### 推荐步骤（并发友好）

#### 首个文件：
1. 调用 `POST /upload/chunk/direct?block_id={block_id}&file_name={file_name}&content_type={mime}`
2. 响应包含：`key, version_id, etag, size, uploaded_at`
3. 生成并保存本次批次的 `resource_key = user_id/block_id/version_id`

#### 后续文件（同一批次）：
- 继续调用 `POST /upload/chunk/direct`，并在 query 中携带相同 `version_id`（这样被归入同一版本）

#### 每次文件上传成功后：
立即 `PUT /upload/manifest`，请求体：
- `user_id, block_id, version_id`
- `expected_etag`（第一笔为 null，之后传服务端返回的最新 etag）
- `new_chunk`（如下字段）
- 可选 `status`（全部上传完后置 `completed`）

#### 全部文件完成后：
再次 `PUT /upload/manifest`，仅更新 `status: "completed"`

### manifest.new_chunk 字段建议

- **name**: 文件在该版本下的相对名（通常用原文件名）
- **file_name**: 原始文件名（展示用）
- **mime_type**: 浏览器获得的 MIME
- **size**: 文件大小（字节）
- **etag**: 对应上传响应的 etag
- **file_type**（可选）: 若前端已知明确类型，可填（否则存储为空，后端在解析时按三段式推断）

## 为何前端上传file，更新block不是类似@storage_client.py 从/init开始一个新的lifecycle？

### 简要回答

不从 `/init` 开始，是因为当前"文件块 = 多文件集合"的最小实现更适合用"每个文件一次性直传 + manifest 增量更新"的模式，而不是"单文件多段上传会话"的 `/init` 流程。

实际上，后端的 `StorageClient.stream_upload_version` 也已采用"直传 manifest.json 以获取 version_id，然后逐文件直传 + manifest 增量更新"的路径；注释里提到的 `/init` 是早期设计（适合大文件分块），与现实现行最小实现不完全一致。

### 为什么前端不走 /init 生命周期

#### 多文件场景匹配度
- `/init → get_upload_url → complete` 这套是"一个大对象的多段上传"语义；文件块是"多个独立对象（文件）组成的版本集合"，走直传更自然。
- 若用 `/init`，前端需对每个文件都 `/init` 一次，并维护 `upload_id/part_number/complete`，复杂度与往返次数显著增加。

#### 最小改动与速度优先
- 直传每个文件只需 1 次 POST；随后 1 次 PUT 增量写 manifest（带 expected_etag 乐观锁）。端到端耗时和心智负担更低。

#### 本地存储/开发模式更友好
- 直传在本地（端口 8002）可直接使用 HTTP POST，避免预签名 URL、CORS、会话一致性等繁琐问题。

#### 合同一致性
- 无论直传还是 `/init`，核心产物都是相同的 `resource_key = user_id/block_id/version_id`。前端只需把这个 key 配进 workflow 的 file block 即可。

#### 后续可扩展
- 对于超大文件，随时可以切换到 `/init` 多段上传。两条路径都生成相同的 version_id 和 manifest；对 Flow Server 是透明的。

### 何时考虑用 /init

- 文件超大（>5–50MB 阈值，视存储后端配置而定），需要分段并行上传、断点续传、带宽优化时；
- 需要直传到对象存储（S3/GCS）并走预签名 URL 时；
- 对上传可靠性/重试的诉求远高于实现复杂度时。

### 前端现在该怎么做（最小实现）

1. 用 `POST /upload/chunk/direct` 逐文件上传，拿到服务端生成的 version_id；
2. 每次文件成功后用 `PUT /upload/manifest` 增量更新（带 expected_etag）；
3. 全部上传完成后再 `PUT /upload/manifest` 把 status 置为 completed；
4. 把 `resource_key = user_id/block_id/version_id` 写到 workflow 的 file block `data.external_metadata.resource_key`，Flow Server 会在运行时预取并解析。

**备注**：`clients/storage_client.py` 里的注释第 133 行提到从 `/init` 开始，但当前代码实际是"直传 manifest.json → 返回 version_id → 逐文件直传 + manifest 增量更新"。这与我们给前端的路径一致；后续可以把注释更新为"直传"以避免误解。

## 请求示例

### 直接上传

````http
POST /upload/chunk/direct?block_id=fileBlock123&file_name=data.csv&content_type=text/csv
Authorization: Bearer <token>

<binary body>
````

### 增量更新 manifest

````json
{
  "user_id": "u_123",
  "block_id": "fileBlock123",
  "version_id": "20250101-120001-abcdef12",
  "expected_etag": "W/\"etag-prev\"",
  "new_chunk": {
    "name": "data.csv",
    "file_name": "data.csv",
    "mime_type": "text/csv",
    "size": 12345,
    "etag": "etag-file-1"
  },
  "status": "generating"
}
````

## Flow Server 对接（前端需要提供的数据）

在创建/更新 workflow 时，将 `resource_key` 放入对应 file block 的 `external_metadata`

### 最小 block 配置：

````json
{
  "blocks": {
    "fileBlock1": {
      "label": "My Files",
      "type": "file",
      "storage_class": "external",
      "data": {
        "external_metadata": {
          "resource_key": "user_id/block_id/version_id",
          "content_type": "files"
        }
      }
    }
  },
  "edges": {
    "loadFiles": {
      "type": "load",
      "data": {
        "block_type": "file",
        "inputs": { "fileBlock1": "My Files" },
        "outputs": { "outputBlock": "Parsed Result" },
        "extra_configs": {
          "default_parse_config": {}  // 可选，留空即可
        }
      }
    }
  }
}
````

## manifest.json 结构（服务端维护，供参考）

````json
{
  "version": "1.0",
  "block_id": "fileBlock123",
  "version_id": "20250101-120001-abcdef12",
  "created_at": "2025-01-01T12:00:01Z",
  "updated_at": "2025-01-01T12:03:02Z",
  "status": "completed",
  "chunks": [
    {
      "name": "data.csv",
      "file_name": "data.csv",
      "mime_type": "text/csv",
      "size": 12345,
      "etag": "etag-file-1",
      "file_type": "csv"  // 可选
    }
  ]
}
````

## 解析能力与类型列表（后端告知前端）

- **支持类型**：`json | txt | markdown | pdf | doc | csv | xlsx | image | audio | video | application`
- **三段式推断**：`file_type`（优先）> `mime_type` > 扩展名
- 如前端对某些文件"明确知道类型"，可在 `manifest.new_chunk.file_type` 提前标注，提升稳定性

## 并发与状态

- 多文件并发上传可行；manifest 需要使用 `expected_etag` 做乐观锁
- 前端应在"全部上传成功后"补一次 `status: completed` 的 manifest 更新
- 异常时可写 `status: failed`，并保留已成功的 chunks

## 给前端的交付物

**文档位置建议**：`PuppyStorage/docs/file-block-contract.md`

内容即本说明（可直接粘贴），并附上 Postman/Thunder Client 集合（包含两个接口的示例）

### 前端仅需：
1. 用 `POST /upload/chunk/direct` 上传并取回 `version_id`
2. 用 `PUT /upload/manifest` 增量写入目录并在最后置 `completed`
3. 将 `resource_key` 写入 workflow 的 file block 配置中

## 小贴士

- 同一批次请维持同一个 `version_id`
- `name` 与 `file_name` 建议一致（无目录），避免路径歧义
- `content_type` 用浏览器上报的 MIME

## 验收口径

上传多个文件后，使用上述 `resource_key` 触发 Flow，可成功预取、解析、产出结果（后端已实现）

## 联系方式

- 若遇到 manifest 冲突（409），按 etag 重试一遍即可
- 若需要断点续传/大文件分块上传，可切换 `init/get_upload_url/complete` 多段流程（同路由文件已提供）

## 简短示例 cURL

````bash
# 上传一个文件
curl -X POST "http://localhost:8002/upload/chunk/direct?block_id=fileBlock123&file_name=data.csv&content_type=text/csv" \
     -H "Authorization: Bearer <token>" \
     --data-binary @./data.csv

# 增量更新 manifest（etag 首次可不传或传 null）
curl -X PUT "http://localhost:8002/upload/manifest" \
     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{
       "user_id": "u_123",
       "block_id": "fileBlock123",
       "version_id": "<version_id_from_upload>",
       "expected_etag": null,
       "new_chunk": {
         "name": "data.csv",
         "file_name": "data.csv",
         "mime_type": "text/csv",
         "size": 12345,
         "etag": "<etag_from_upload>"
       },
       "status": "generating"
     }'
````

## 前端完成后端到端自测：

多文件上传 -> resource_key 写入 workflow -> 触发 Flow 执行

以"最快完成"为目标：上传即写 manifest（异步）、全部完成后置 completed，无需等待解析
