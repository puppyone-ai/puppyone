# Change: 添加ETL文件上传接口

## Why

目前用户需要手动拼接S3的上传路径(`/users/{user_id}/raw/{project_id}/{filename}`)并直接与S3交互上传文件。这种方式存在以下问题:
1. 前端需要了解S3路径结构的具体规则
2. 前端需要处理S3认证和上传逻辑
3. 路径拼接逻辑分散,维护困难

提供一个ETL专用的文件上传接口,用户只需提供user_id、project_id和文件,后端自动处理路径生成和上传,简化前端集成。

## What Changes

- 在ETL模块添加新的文件上传API端点 `POST /api/v1/etl/upload`
- 接口接收user_id、project_id和文件,自动上传到标准化路径 `/users/{user_id}/raw/{project_id}/{filename}`
- 返回上传成功的文件信息(包括完整的S3 key、大小、etag等)
- 复用现有的S3Service进行实际上传操作

## Impact

- 受影响的规范: `etl-core`
- 受影响的代码:
  - `src/etl/router.py`: 添加新的上传端点
  - `src/etl/schemas.py`: 添加上传请求和响应的Pydantic模型
  - 无需修改S3模块(复用现有S3Service)

