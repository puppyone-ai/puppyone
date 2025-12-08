# 实施任务清单

## 1. 数据模型定义

- [x] 1.1 在 `src/etl/schemas.py` 中创建 `ETLFileUploadResponse` 模型
- [x] 1.2 验证Pydantic模型的字段定义和类型注解

## 2. API端点实现

- [x] 2.1 在 `src/etl/router.py` 添加 `POST /api/v1/etl/upload` 端点
- [x] 2.2 实现路径拼接逻辑: `/users/{user_id}/raw/{project_id}/{filename}`
- [x] 2.3 集成S3Service进行文件上传
- [x] 2.4 添加错误处理(文件大小超限、S3错误等)

## 3. 测试

- [x] 3.1 编写成功上传场景的测试用例
- [x] 3.2 编写文件大小超限的测试用例
- [x] 3.3 编写S3服务不可用的错误处理测试

## 4. 文档

- [x] 4.1 确保FastAPI自动生成的OpenAPI文档包含新端点
- [x] 4.2 验证/docs端点可正确显示接口信息

