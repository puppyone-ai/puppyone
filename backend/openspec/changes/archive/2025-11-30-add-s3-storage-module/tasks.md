# 实施任务

## 1. 基础设施准备

- [x] 1.1 在 `src/config.py` 中添加 S3 配置项
  - [x] 1.1.1 S3 连接配置(bucket名称、endpoint、region、凭证等)
  - [x] 1.1.2 文件大小限制配置(S3_MAX_FILE_SIZE、S3_MULTIPART_THRESHOLD、S3_MULTIPART_CHUNKSIZE)
- [x] 1.2 确认 **aioboto3** 和 **botocore** 依赖已包含在项目中
- [x] 1.3 创建 `src/s3/` 目录结构

## 2. 核心模块实现

- [x] 2.1 实现 `src/s3/schemas.py` - 定义所有请求/响应 Pydantic 模型
  - [x] 2.1.1 基础上传/下载 schemas
  - [x] 2.1.2 分片上传相关 schemas
  - [x] 2.1.3 批量操作 schemas
- [x] 2.2 实现 `src/s3/exceptions.py` - 定义模块特定异常类型
- [x] 2.3 实现 `src/s3/service.py` - 实现核心 S3 操作业务逻辑
  - [x] 2.3.1 初始化 **aioboto3** S3 客户端(异步)
  - [x] 2.3.2 实现单文件上传逻辑(含文件大小检查)
  - [x] 2.3.3 实现批量文件上传逻辑
  - [x] 2.3.4 实现文件下载逻辑(流式,异步)
  - [x] 2.3.5 实现文件存在性检查
  - [x] 2.3.6 实现单文件删除
  - [x] 2.3.7 实现批量文件删除
  - [x] 2.3.8 实现文件列表(支持前缀和分页)
  - [x] 2.3.9 实现文件元信息获取
  - [x] 2.3.10 实现预签名 URL 生成(上传)
  - [x] 2.3.11 实现预签名 URL 生成(下载)
  - [x] 2.3.12 **实现分片上传创建**
  - [x] 2.3.13 **实现分片上传(单个分片)**
  - [x] 2.3.14 **实现分片上传完成**
  - [x] 2.3.15 **实现分片上传取消**
  - [x] 2.3.16 **实现列出进行中的分片上传**
  - [x] 2.3.17 **实现列出已上传的分片**

## 3. API 路由实现

- [x] 3.1 实现 `src/s3/router.py` - 定义所有 API 端点(异步路由)
  - [x] 3.1.1 POST `/api/v1/s3/upload` - 单文件上传
  - [x] 3.1.2 POST `/api/v1/s3/upload/batch` - 批量文件上传
  - [x] 3.1.3 GET `/api/v1/s3/download/{key:path}` - 文件下载
  - [x] 3.1.4 HEAD `/api/v1/s3/exists/{key:path}` - 检查文件存在
  - [x] 3.1.5 DELETE `/api/v1/s3/{key:path}` - 删除文件
  - [x] 3.1.6 POST `/api/v1/s3/delete/batch` - 批量删除文件
  - [x] 3.1.7 GET `/api/v1/s3/list` - 列出文件
  - [x] 3.1.8 GET `/api/v1/s3/metadata/{key:path}` - 获取文件元信息
  - [x] 3.1.9 POST `/api/v1/s3/presigned-url/upload` - 生成上传预签名 URL
  - [x] 3.1.10 POST `/api/v1/s3/presigned-url/download` - 生成下载预签名 URL
  - [x] 3.1.11 **POST `/api/v1/s3/multipart/create` - 创建分片上传**
  - [x] 3.1.12 **PUT `/api/v1/s3/multipart/upload-part` - 上传单个分片**
  - [x] 3.1.13 **POST `/api/v1/s3/multipart/complete` - 完成分片上传**
  - [x] 3.1.14 **DELETE `/api/v1/s3/multipart/abort` - 取消分片上传**
  - [x] 3.1.15 **GET `/api/v1/s3/multipart/list` - 列出进行中的分片上传**
  - [x] 3.1.16 **GET `/api/v1/s3/multipart/list-parts` - 列出已上传的分片**

## 4. 集成与配置

- [x] 4.1 在 `src/main.py` 中注册 S3 路由
- [x] 4.2 在 `src/s3/__init__.py` 中导出必要的接口
- [x] 4.3 更新 `.env.example`(如果存在)添加 S3 配置示例

## 5. 文档与测试

- [x] 5.1 编写单元测试(针对 service 层)
  - [x] 5.1.1 测试基础上传/下载功能
  - [x] 5.1.2 **测试分片上传功能**
  - [x] 5.1.3 测试异常处理
- [x] 5.2 编写集成测试(针对 API 端点)
  - [x] 5.2.1 测试所有 API 端点
  - [x] 5.2.2 **测试分片上传完整流程**
  - [x] 5.2.3 测试文件大小限制
- [x] 5.3 使用 LocalStack 进行本地测试验证
- [x] 5.4 更新 `README.md` 添加 S3 模块使用说明
  - [x] 5.4.1 说明 LocalStack 配置
  - [x] 5.4.2 说明生产环境配置
  - [x] 5.4.3 **说明分片上传使用方式**
  - [x] 5.4.4 说明标准化存储路径结构
- [x] 5.5 验证所有 API 端点的 OpenAPI 文档自动生成

## 6. 代码质量检查

- [x] 6.1 运行 `ruff check --fix src/s3`
- [x] 6.2 运行 `ruff format src/s3`
- [x] 6.3 确保所有类型注解正确
- [x] 6.4 确保异常处理完整


