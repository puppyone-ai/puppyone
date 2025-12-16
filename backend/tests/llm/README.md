# LLM 模块集成测试

本目录包含 `src/llm` 模块的集成测试，用于验证 LLM 服务的核心功能。

## 测试说明

这些测试将调用**真实的 LLM 模型**（`openrouter/qwen/qwen3-8b`），因此需要：

1. 有效的 OpenRouter API 密钥
2. 网络连接
3. 可能产生 API 调用费用（取决于您的 OpenRouter 账户设置）

## 环境配置

在运行测试之前，需要设置 OpenRouter API 密钥：

```bash
export OPENROUTER_API_KEY="your-api-key-here"
```

或者在项目根目录的 `.env` 文件中添加：

```
OPENROUTER_API_KEY=your-api-key-here
```

## 运行测试

### 运行所有 LLM 集成测试

```bash
# 在项目根目录运行
pytest tests/llm/test_llm_integration.py -v
```

### 运行特定测试

```bash
# 运行单个测试
pytest tests/llm/test_llm_integration.py::test_simple_text_generation -v

# 运行某一类测试（使用 -k 参数）
pytest tests/llm/test_llm_integration.py -k "json" -v
```

### 查看详细输出

```bash
# 显示 print 输出
pytest tests/llm/test_llm_integration.py -v -s
```

### 生成测试报告

```bash
# 生成 HTML 报告（需要安装 pytest-html）
pytest tests/llm/test_llm_integration.py --html=report.html --self-contained-html
```

## 测试覆盖范围

测试文件 `test_llm_integration.py` 包含以下测试类别：

### 1. 基础功能测试
- ✓ 服务初始化
- ✓ 获取支持的模型列表
- ✓ 检查模型是否支持

### 2. 文本生成测试
- ✓ 简单文本生成
- ✓ 带系统提示的文本生成
- ✓ 低温度参数的确定性生成

### 3. JSON 模式测试
- ✓ JSON 对象生成
- ✓ JSON 数组生成
- ✓ JSON 格式验证

### 4. Request 对象测试
- ✓ 使用 TextModelRequest 对象调用

### 5. 错误处理测试
- ✓ 不支持的模型错误
- ✓ 空提示处理

### 6. 边界条件测试
- ✓ 长提示处理
- ✓ max_tokens 限制

### 7. 稳定性测试
- ✓ 多次连续调用
- ✓ 并发调用

### 8. 特殊字符和编码测试
- ✓ Unicode 字符处理
- ✓ 特殊字符处理

### 9. 性能测试
- ✓ 响应时间测试
- ✓ 确定性输出测试

## 测试模型

测试使用的模型：**`openrouter/qwen/qwen3-8b`**

这是一个轻量级的模型，适合用于集成测试：
- 响应速度快
- API 调用成本低
- 支持中英文
- 支持 JSON 模式

## 注意事项

1. **API 调用费用**：运行完整测试套件会发起多次 API 调用，可能产生费用。
2. **网络依赖**：测试需要稳定的网络连接。
3. **速率限制**：如果遇到速率限制错误，请等待一段时间后重试。
4. **测试时间**：完整测试套件可能需要几分钟时间。

## 跳过测试

如果没有设置 `OPENROUTER_API_KEY` 环境变量，所有测试将自动跳过并显示提示信息。

## 故障排查

### API Key 错误

如果遇到认证错误：
```
APIKeyError: API key for provider 'openrouter' is missing or invalid
```

请检查：
1. `OPENROUTER_API_KEY` 环境变量是否正确设置
2. API 密钥是否有效
3. API 密钥是否有足够的配额

### 超时错误

如果遇到超时错误，可能是由于：
1. 网络连接不稳定
2. OpenRouter 服务响应缓慢

可以在 `src/llm/config.py` 中调整 `llm_timeout` 参数。

### 速率限制错误

如果遇到速率限制：
```
RateLimitError: Rate limit exceeded
```

请等待一段时间后重试，或者在测试中添加延迟。

## 扩展测试

如果需要测试其他模型，可以：

1. 在 `src/llm/config.py` 中添加新模型到 `supported_text_models` 列表
2. 修改测试文件顶部的 `TEST_MODEL` 常量
3. 确保相应的 API 密钥已配置

## 相关文档

- [LLM Service 源码](../../src/llm/service.py)
- [LLM 配置](../../src/llm/config.py)
- [LLM Schemas](../../src/llm/schemas.py)
- [LLM 异常](../../src/llm/exceptions.py)

