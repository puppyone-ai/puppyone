# Change: 新增 S3 存储模块

## Why

为 ContextBase 添加统一的 S3 对象存储管理能力,以支持后续 ETL 功能的数据存储需求。需要提供完整的文件管理接口,包括上传、下载、删除、列表等操作,方便存储用户的源数据和转换后的 JSON 数据。

## What Changes

- 在 `src/` 目录下新增 `s3/` 服务模块
- 实现完整的 S3 文件操作 API,包括:
  - 单文件和批量文件上传
  - **大文件分片上传(multipart upload)**
  - 文件下载(支持流式下载)
  - 文件存在性检查
  - 单文件和批量文件删除
  - 目录/前缀文件列表
  - 文件元信息获取
  - 预签名 URL 生成(上传和下载)
- 使用 **aioboto3** 异步 SDK,与 FastAPI 异步特性匹配
- 支持 LocalStack 本地开发环境和 AWS S3 生产环境
- 遵循项目的模块化服务目录结构规范
- 提供统一的错误处理和响应格式
- **支持可配置的文件大小限制和分片阈值**
- **标准化存储路径**: `/{raw/processed}/{project_id}/{filename}`

**注意**: 此模块当前独立设计,暂不与其他服务模块产生依赖关系

## Impact

- 受影响的 specs: 新增 `s3-storage` 能力规范
- 受影响的代码: 
  - 新增 `src/s3/` 目录及其所有文件
  - 更新 `src/config.py` 添加 S3 相关配置(endpoint、bucket、凭证、文件大小限制等)
  - 更新 `src/main.py` 注册 S3 路由
  - 更新 `pyproject.toml` / `uv.lock` 添加 **aioboto3** 依赖(如未包含)

