## 1. 依赖更新
- [x] 1.1 在 `pyproject.toml` 中将 `aioboto3` 替换为 `boto3`
- [x] 1.2 运行 `uv sync` 更新依赖
- [x] 1.3 验证依赖安装成功

## 2. S3Service 重构
- [x] 2.1 重写 `S3Service.__init__()` 使用 boto3 客户端
- [x] 2.2 实现异步包装器辅助函数 `_run_sync()`
- [x] 2.3 重写文件上传方法 `upload_file()` 和 `upload_files_batch()`
- [x] 2.4 重写文件下载方法 `download_file_stream()`
- [x] 2.5 重写文件存在性检查 `file_exists()`
- [x] 2.6 重写文件删除方法 `delete_file()` 和 `delete_files_batch()`
- [x] 2.7 重写文件列表方法 `list_files()`
- [x] 2.8 重写文件元信息方法 `get_file_metadata()`
- [x] 2.9 重写预签名 URL 生成方法 `generate_presigned_upload_url()` 和 `generate_presigned_download_url()`
- [x] 2.10 重写分片上传相关方法（create/upload/complete/abort/list）

## 3. 路由调整
- [x] 3.1 检查 `router.py` 中依赖注入是否需要调整
- [x] 3.2 确保所有异步路由正常调用新的服务方法
- [x] 3.3 验证流式响应（StreamingResponse）正常工作

## 4. 单元测试
- [x] 4.1 创建测试目录 `tests/s3/`
- [x] 4.2 编写测试配置和 fixtures（mock S3 客户端）
- [x] 4.3 编写文件上传测试（单文件、批量）
- [x] 4.4 编写文件下载测试（流式下载）
- [x] 4.5 编写文件删除测试（单文件、批量）
- [x] 4.6 编写文件列表测试（前缀过滤、分页）
- [x] 4.7 编写文件元信息测试
- [x] 4.8 编写预签名 URL 测试
- [x] 4.9 编写分片上传测试
- [x] 4.10 编写错误处理测试（文件不存在、权限错误等）

## 5. 测试运行与验证
- [x] 5.1 运行所有单元测试 `pytest tests/s3/`
- [x] 5.2 确保所有测试通过
- [x] 5.3 检查测试覆盖率
- [x] 5.4 修复发现的问题
- [x] 5.5 运行代码格式化 `ruff format src tests`
- [x] 5.6 运行代码检查 `ruff check --fix src tests`

## 6. 集成验证（可选）
- [ ] 6.1 启动 LocalStack（如果可用）
- [ ] 6.2 手动测试几个关键 API 端点
- [ ] 6.3 验证实际 S3 操作正常工作

