## ADDED Requirements

### Requirement: ETL文件上传接口

系统 SHALL 提供专用的ETL文件上传接口,自动管理S3存储路径结构。

#### Scenario: 成功上传文件

- **WHEN** 用户发送 POST 请求到 `/api/v1/etl/upload`
- **AND** 请求包含 user_id (int)、project_id (int) 和文件数据
- **THEN** 文件应上传到 S3 路径 `/users/{user_id}/raw/{project_id}/{filename}`
- **AND** 响应返回 201 状态码
- **AND** 响应包含上传文件的完整信息: key、bucket、size、etag、content_type

#### Scenario: 路径自动生成

- **WHEN** 上传文件时提供 user_id=123、project_id=456、filename="document.pdf"
- **THEN** 系统应自动生成 S3 key 为 `/users/123/raw/456/document.pdf`
- **AND** 不需要前端手动拼接路径

#### Scenario: 文件大小超限

- **WHEN** 上传的文件大小超过S3配置的最大限制(S3_MAX_FILE_SIZE)
- **THEN** 应返回 413 错误(Payload Too Large)
- **AND** 错误信息应说明最大允许大小
- **AND** 建议使用分片上传或预签名URL

#### Scenario: S3服务不可用

- **WHEN** S3服务不可用或上传失败
- **THEN** 应返回 500 错误
- **AND** 错误信息应包含详细的失败原因
- **AND** 记录错误日志便于排查

#### Scenario: 文件名处理

- **WHEN** 上传的文件名包含特殊字符或空格
- **THEN** 应保留原始文件名
- **AND** 由S3Service处理文件名的URL编码
- **AND** 确保文件路径有效

#### Scenario: 覆盖已存在文件

- **WHEN** 上传到相同路径的文件已存在
- **THEN** 应覆盖原有文件(S3默认行为)
- **AND** 返回新文件的etag
- **AND** 响应保持成功状态

