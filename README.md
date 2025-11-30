# ContextBase Backend

## Quick start

### Prerequisites

1. **Install uv**

`uv` is a fast Python package manager and project management tool. Please select the installation method according to your operating system:

Please refer to the [uv official documentation](https://github.com/astral-sh/uv) for the installation process.

2. **Download dependencies**

Run the following command in the backend directory to install all dependencies:

```bash
uv sync
```

### Config S3 in local

Install localstack in [localstack](https://docs.localstack.cloud/aws/tutorials/)

Start localstack:
```bash
localstack start
```

Install aws-cli:
```bash
pip install awscli-local[ver1]
```

Create S3 bucket:
```bash
awslocal s3api create-bucket --bucket contextbase
```

List S3 bucket:
```bash
awslocal s3api list-buckets
```

### S3 Storage Module

ContextBase 提供了完整的 S3 存储管理模块,支持本地开发(LocalStack)和生产环境(AWS S3)无缝切换。

#### 存储路径结构

所有文件遵循标准化路径结构:

```
/{raw/processed}/{project_id}/{filename}
```

- `raw/`: 存储原始多模态数据(音频、视频、图片、文档等)
- `processed/`: 存储 ETL 转换后的 JSON 数据
- `project_id`: 项目 ID,提供项目级隔离
- `filename`: 原始文件名或 `table_id.json`

**示例:**
- `raw/proj123/document.pdf` - 原始文档
- `processed/proj123/table_users.json` - 处理后的 JSON 数据

#### 配置说明

**本地开发环境 (LocalStack):**

```bash
# .env 配置
S3_ENDPOINT_URL=http://localhost:4566
S3_BUCKET_NAME=contextbase
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=test
S3_SECRET_ACCESS_KEY=test

# 文件大小限制 (字节)
S3_MAX_FILE_SIZE=104857600  # 100MB
S3_MULTIPART_THRESHOLD=104857600  # 100MB
S3_MULTIPART_CHUNKSIZE=5242880  # 5MB
```

**生产环境 (AWS S3):**

```bash
# .env 配置
S3_ENDPOINT_URL=  # 留空使用 AWS 默认
S3_BUCKET_NAME=your-production-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-aws-access-key-id
S3_SECRET_ACCESS_KEY=your-aws-secret-access-key
```

#### API 端点

所有 S3 API 端点都在 `/api/v1/s3` 路径下:

**基础操作:**
- `POST /api/v1/s3/upload` - 单文件上传
- `POST /api/v1/s3/upload/batch` - 批量上传
- `GET /api/v1/s3/download/{key}` - 文件下载
- `HEAD /api/v1/s3/exists/{key}` - 检查文件存在
- `DELETE /api/v1/s3/{key}` - 删除文件
- `POST /api/v1/s3/delete/batch` - 批量删除
- `GET /api/v1/s3/list` - 列出文件
- `GET /api/v1/s3/metadata/{key}` - 获取文件元信息

**预签名 URL:**
- `POST /api/v1/s3/presigned-url/upload` - 生成上传预签名 URL
- `POST /api/v1/s3/presigned-url/download` - 生成下载预签名 URL

**分片上传 (大文件):**
- `POST /api/v1/s3/multipart/create` - 创建分片上传
- `PUT /api/v1/s3/multipart/upload-part` - 上传单个分片
- `POST /api/v1/s3/multipart/complete` - 完成分片上传
- `DELETE /api/v1/s3/multipart/abort` - 取消分片上传
- `GET /api/v1/s3/multipart/list` - 列出进行中的分片上传
- `GET /api/v1/s3/multipart/list-parts` - 列出已上传的分片

#### 分片上传使用方式

对于大文件(>100MB),系统支持分片上传以提高可靠性:

1. **创建分片上传会话:**
```bash
curl -X POST http://localhost:9090/api/v1/s3/multipart/create \
  -H "Content-Type: application/json" \
  -d '{"key": "raw/proj123/large-file.mp4", "content_type": "video/mp4"}'
```

2. **上传分片:**
```bash
curl -X PUT http://localhost:9090/api/v1/s3/multipart/upload-part \
  -F "key=raw/proj123/large-file.mp4" \
  -F "upload_id=<upload_id>" \
  -F "part_number=1" \
  -F "file=@part1.bin"
```

3. **完成上传:**
```bash
curl -X POST http://localhost:9090/api/v1/s3/multipart/complete \
  -F "key=raw/proj123/large-file.mp4" \
  -F "upload_id=<upload_id>" \
  -F 'parts_json=[{"part_number":1,"etag":"..."}]'
```

查看 `/docs` 获取完整的 API 文档和交互式测试界面。



### Usage

Run the following command in the backend directory to start the server:

```bash
uv run uvicorn src.main:app --host 0.0.0.0 --port 9090 --reload --log-level info
```

### MCP Config Example

Here is a example of the MCP config, you can use it in Cursor or other MCP clients.

Notice: You should first create a mcp server instance through `/api/v1/mcp/` entrypoint, and get the url and api_key.

```json
{
  "mcpServers": {
    "contextbase-mcp": {
      "command": "npx -y mcp-remote url/mcp?api_key=xxx",
      "env": {},
      "args": []
    }
  }
}
```
