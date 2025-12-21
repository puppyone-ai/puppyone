: # ETL 模块测试文档

本目录包含 ETL（Extract, Transform, Load）模块的所有测试。

## 测试文件概览

### 单元测试

1. **`test_rule_engine.py`** - 规则引擎测试
   - Prompt 构造测试
   - JSON Schema 验证测试
   - LLM 调用和重试机制
   - 错误处理

2. **`test_rule_repository.py`** - 规则存储测试
   - 创建、读取、更新、删除规则
   - 规则列表和分页
   - 文件系统操作
   - 边界情况处理

3. **`test_etl_api.py`** - ETL API 端点测试
   - 提交任务 API
   - 查询任务状态 API
   - 规则管理 API
   - 健康检查 API

### 集成测试

1. **`test_mineru_integration.py`** - MineRU 集成测试
   - 需要真实的 MineRU API Key
   - 测试 PDF 文档解析流程
   - 详细配置说明见文件内注释

2. **`test_etl_integration.py`** - ETL 完整流程集成测试
   - 端到端测试：上传文件 → 解析 → 转换 → 输出 JSON
   - 需要真实的 MineRU API、LLM API 和 S3 服务
   - 详细配置说明见下文

## 运行测试

### 运行所有单元测试

```bash
# 运行 ETL 模块的所有单元测试
pytest tests/etl/test_rule_engine.py tests/etl/test_rule_repository.py tests/etl/test_etl_api.py -v

# 或者使用通配符
pytest tests/etl/test_rule*.py tests/etl/test_etl_api.py -v
```

### 运行单个测试文件

```bash
# 规则引擎测试
pytest tests/etl/test_rule_engine.py -v

# 规则存储测试
pytest tests/etl/test_rule_repository.py -v

# ETL API 测试
pytest tests/etl/test_etl_api.py -v
```

### 运行特定测试

```bash
# 运行单个测试函数
pytest tests/etl/test_rule_engine.py::test_build_prompt -v

# 运行包含特定关键词的测试
pytest tests/etl/ -k "create_rule" -v
```

## 集成测试配置

集成测试需要真实的外部服务。以下是配置步骤：

### MineRU 集成测试

```bash
# 设置 MineRU API Key
export MINERU_API_KEY="your-mineru-api-key"

# 配置 S3（使用真实 S3，不能用 LocalStack）
export USE_REAL_S3=true
export S3_ENDPOINT_URL="https://xxx.supabase.co"  # Supabase 或留空使用 AWS
export S3_BUCKET_NAME="your-bucket"
export S3_REGION="us-east-1"
export S3_ACCESS_KEY_ID="your-access-key"
export S3_SECRET_ACCESS_KEY="your-secret-key"

# 运行测试
pytest tests/etl/test_mineru_integration.py -v -s
```

### ETL 完整流程集成测试

```bash
# MineRU 配置（同上）
export MINERU_API_KEY="your-mineru-api-key"

# S3 配置（同上）
export USE_REAL_S3=true
export S3_ENDPOINT_URL="..."
export S3_BUCKET_NAME="..."
export S3_ACCESS_KEY_ID="..."
export S3_SECRET_ACCESS_KEY="..."

# LLM 配置
export LLM_API_KEY="your-llm-api-key"
export LLM_BASE_URL="https://api.openai.com/v1"  # 或其他兼容端点
export LLM_MODEL="gpt-4o-mini"

# 运行测试
pytest tests/etl/test_etl_integration.py -v -s
```

### 为什么不能使用 LocalStack？

MineRU API 需要从公网访问 S3 URL 来下载文件。LocalStack 生成的 `localhost` URL 无法被外部 API 访问，因此集成测试必须使用真实的 S3 服务（AWS S3 或 Supabase Storage）。

## 测试覆盖的功能

### 规则引擎 (`test_rule_engine.py`)

- ✅ Prompt 构造
  - 基础 prompt 格式
  - 复杂 schema 的 prompt
  - 空内容处理
  - Unicode 字符处理
- ✅ JSON Schema 验证
  - 成功验证
  - 缺少必需字段
  - 类型错误
  - 嵌套结构验证
- ✅ 规则应用
  - 成功应用
  - 无效 JSON 重试
  - Schema 验证失败重试
  - 重试次数用尽
  - LLM 错误处理
- ✅ 边界情况
  - 空 Markdown
  - 大型 Markdown
  - Unicode 内容
  - 禁用重试

### 规则存储 (`test_rule_repository.py`)

- ✅ 仓库初始化
  - 默认目录
  - 自定义目录
  - 自动创建目录
- ✅ CRUD 操作
  - 创建规则（唯一 ID、最小字段、复杂 schema）
  - 读取规则（成功、不存在、Unicode）
  - 更新规则（完整更新、部分更新、不存在）
  - 删除规则（成功、不存在、多次删除）
- ✅ 列表和分页
  - 空列表
  - 多个规则
  - 分页功能
  - 偏移和限制
- ✅ 计数功能
- ✅ 文件系统
  - JSON 格式验证
  - 损坏文件处理
  - Unicode 编码
- ✅ 边界情况
  - 长名称
  - 特殊字符
  - 并发操作

### ETL API (`test_etl_api.py`)

- ✅ 提交任务
  - 成功提交
  - 规则不存在
  - 缺少字段
  - 类型错误
- ✅ 查询任务状态
  - 成功查询
  - 已完成任务
  - 失败任务
  - 任务不存在
- ✅ 列出任务
  - 空列表
  - 多个任务
  - 过滤器
  - 分页
  - 无效参数
- ✅ 规则管理
  - 创建规则（成功、缺少字段、无效 schema）
  - 查询规则（成功、不存在）
  - 列出规则（空列表、多个规则、分页）
  - 删除规则（成功、不存在）
- ✅ 健康检查
- ✅ 完整工作流程

### MineRU 集成 (`test_mineru_integration.py`)

- ✅ 客户端初始化
- ✅ 完整解析流程
  - 上传 PDF → S3
  - 生成预签名 URL
  - MineRU 解析
  - 下载结果
- ✅ 分步骤测试
  - 创建任务
  - 轮询状态
  - 下载和提取
- ✅ 错误处理
  - 无效 URL
  - 不存在的任务
  - 超时
- ✅ 配置限制验证

### ETL 完整流程 (`test_etl_integration.py`)

- ✅ 端到端流程
  1. 创建 ETL 规则
  2. 上传 PDF 到 S3
  3. 提交 ETL 任务
  4. 等待 MineRU 解析
  5. 等待 LLM 转换
  6. 验证 JSON 输出
  7. 验证 S3 存储
- ✅ 自定义规则测试
- ✅ 状态追踪测试
- ✅ 错误处理
  - 规则不存在
  - 文件不存在

## 测试数据

测试使用的数据位于 `tests/etl/artifact/` 目录：

- `test_pdf.pdf` - 用于 MineRU 和 ETL 集成测试的示例 PDF

## 性能说明

### 单元测试
- **运行时间**：< 5 秒
- **依赖**：无外部依赖，使用 Mock

### 集成测试
- **MineRU 集成**：30-120 秒（取决于 PDF 大小和 API 速度）
- **ETL 完整流程**：60-300 秒（包含 MineRU + LLM 调用）
- **依赖**：需要真实的 MineRU API、LLM API 和 S3 服务

## 持续集成

在 CI 环境中：

1. **默认运行单元测试**
   ```yaml
   pytest tests/etl/test_rule*.py tests/etl/test_etl_api.py
   ```

2. **可选运行集成测试**（如果配置了 API Keys）
   ```yaml
   if [ -n "$MINERU_API_KEY" ]; then
     pytest tests/etl/test_etl_integration.py
   fi
   ```

## 故障排查

### 常见问题

1. **"MINERU_API_KEY not configured"**
   - 设置环境变量：`export MINERU_API_KEY="your-key"`

2. **"跳过测试: MineRU API 无法访问 LocalStack URL"**
   - 使用真实 S3：`export USE_REAL_S3=true`
   - 配置真实 S3 凭证

3. **"404 错误"（S3）**
   - 检查 bucket 名称是否正确
   - 验证 S3 凭证是否有效
   - 确认 bucket 存在且可访问

4. **"任务超时"**
   - 检查网络连接
   - 验证 API Keys 是否有效
   - 增加超时时间（在测试代码中修改）

5. **"LLM error"**
   - 检查 LLM_API_KEY 是否设置
   - 验证 LLM_BASE_URL 是否正确
   - 检查 API 配额是否充足

## 调试技巧

### 启用详细输出

```bash
# 显示打印语句和详细信息
pytest tests/etl/test_etl_integration.py -v -s

# 显示更详细的失败信息
pytest tests/etl/ -v --tb=long

# 在第一个失败时停止
pytest tests/etl/ -x
```

### 运行单个测试进行调试

```bash
# 只运行一个测试函数
pytest tests/etl/test_etl_integration.py::test_etl_complete_flow -v -s
```

### 使用 Python 调试器

```bash
# 在失败时进入调试器
pytest tests/etl/test_rule_engine.py --pdb

# 在测试开始时进入调试器
pytest tests/etl/test_rule_engine.py --trace
```

## 贡献指南

添加新测试时：

1. **单元测试**：添加到对应的 `test_*.py` 文件
2. **集成测试**：添加到 `test_*_integration.py` 文件
3. **使用 Fixtures**：复用已有的 fixtures
4. **文档**：为复杂测试添加 docstring
5. **运行检查**：确保新测试通过且没有 linter 错误

```bash
# 运行新测试
pytest tests/etl/test_your_new_test.py -v

# 检查 linter
ruff check tests/etl/
```

## 相关文档

- [MineRU API 文档](../../../docs/mineru-api.md)
- [ETL 架构文档](../../../openspec/changes/add-etl-pipeline-module/design.md)
- [LLM 服务测试](../llm/README.md)
- [S3 服务测试](../s3/)

## 联系方式

如有问题或建议，请参考主 README 或提交 issue。

