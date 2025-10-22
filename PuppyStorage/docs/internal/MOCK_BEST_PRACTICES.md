# Mock 最佳实践指南

## 问题背景

在实施 E2E 测试时，遇到了多次 pytest-httpx mock 相关的失败（占总失败的 20%）。本文档总结了 Mock 的最佳实践和经验教训。

## Mock 策略矩阵

### 测试金字塔 + Mock 策略

```
         /\
        /E2E\        ← 少量，真实环境，少 Mock
       /------\
      /Integr.\     ← 适量，部分 Mock 外部服务
     /----------\
    /   Unit     \  ← 大量，充分 Mock，快速
   /--------------\
```

| 测试层级 | Mock 外部服务 | Mock 内部组件 | 真实数据库 | 示例 |
|---------|--------------|--------------|-----------|------|
| **Unit** | ✅ 必须 | ✅ 必须 | ❌ Mock | `test_auth_provider_verify()` |
| **Integration** | ✅ 建议 | ❌ 真实 | ✅ 真实/TestDB | `test_upload_route_with_storage()` |
| **Contract** | ✅ 必须 | ❌ 真实 | ✅ Mock | `test_manifest_api_schema()` |
| **E2E** | ⚠️ 谨慎 | ❌ 真实 | ✅ 真实 | `test_upload_download_flow()` |

### E2E 测试的 Mock 原则

**应该 Mock 的：**
- ✅ 外部第三方服务（User System, Payment Gateway）
- ✅ 不稳定的外部依赖（偶尔宕机的服务）
- ✅ 收费的外部 API（避免测试产生费用）

**不应该 Mock 的：**
- ❌ 自己的服务内部组件（Storage, Routes）
- ❌ 数据库（应该用真实的测试数据库）
- ❌ 核心业务逻辑

## pytest-httpx 使用模式

### 模式对比

| 模式 | 复杂度 | 清晰度 | 维护性 | 推荐度 |
|------|--------|--------|--------|--------|
| 全局 autouse | ⭐ | ⭐ | ⭐ | ❌ |
| 条件激活（getfixturevalue） | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⚠️ |
| 参数化 Fixture | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ✅ |
| **分离测试函数** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ **推荐** |

### 推荐模式：分离测试函数

```python
# 辅助函数：共享测试逻辑
async def _execute_upload_test_flow(api_client, test_data, deployment_type):
    """共享的上传测试流程"""
    upload_resp = await api_client.post("/upload/chunk/direct", ...)
    assert upload_resp.status_code == 200
    # ... 其他步骤

# 本地模式测试：无需 mock
@pytest.mark.e2e
@pytest.mark.asyncio
async def test_upload_local_mode(api_client, test_data, monkeypatch):
    """本地模式：使用 LocalAuthProvider，无需 mock 外部服务"""
    monkeypatch.setenv("DEPLOYMENT_TYPE", "local")
    await _execute_upload_test_flow(api_client, test_data, "local")

# 远程模式测试：使用 mock
@pytest.mark.e2e
@pytest.mark.asyncio
@pytest.mark.usefixtures("mock_user_system")  # ✅ 明确声明依赖
async def test_upload_remote_mode(api_client, test_data, monkeypatch):
    """远程模式：使用 RemoteAuthProvider，mock User System"""
    monkeypatch.setenv("DEPLOYMENT_TYPE", "remote")
    await _execute_upload_test_flow(api_client, test_data, "remote")
```

**优点：**
- ✅ **清晰**：每个测试函数职责单一
- ✅ **易维护**：不需要复杂的条件判断
- ✅ **易调试**：失败时直接定位到具体场景
- ✅ **兼容性好**：完全符合 pytest 规范
- ✅ **IDE 友好**：静态分析可以正确理解

**避免的模式：**

```python
# ❌ 不推荐：动态 fixture 激活
@pytest.mark.parametrize("mode", ["local", "remote"])
async def test_upload(mode, request):
    if mode == "remote":
        request.getfixturevalue("mock_user_system")  # 动态，不清晰
    # ...

# ❌ 不推荐：pytest.param + usefixtures（不支持）
@pytest.mark.parametrize("mode", [
    "local",
    pytest.param("remote", marks=pytest.mark.usefixtures("mock_user_system"))  # 会报错
])
```

## Mock Fixture 编写规范

### 正确的 httpx_mock Fixture

```python
@pytest.fixture
def mock_user_system(httpx_mock):
    """
    Mock User System for remote auth tests.
    
    Mocked endpoints:
    - POST /auth/verify: Token verification
    
    Usage:
    - Automatically activated via @pytest.mark.usefixtures("mock_user_system")
    - Only for remote mode tests
    """
    # 添加 mock 响应
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:8000/auth/verify",
        json={
            "user_id": "test_user_e2e",
            "email": "test@example.com",
            "is_active": True
        },
        status_code=200
    )
    
    yield httpx_mock
    
    # ✅ 关键：禁用"所有 mock 必须被请求"的断言
    # 原因：local 模式测试不会调用 User System
    httpx_mock.reset(assert_all_responses_were_requested=False)
```

### 常见陷阱

**陷阱 1：默认断言所有 mock 必须被请求**
```python
# ❌ 问题：local 模式不调用 User System → 断言失败
@pytest.fixture
def mock_user_system(httpx_mock):
    httpx_mock.add_response(...)
    yield httpx_mock
    # 默认行为：assert all mocked responses were requested

# ✅ 解决：显式禁用断言
    httpx_mock.reset(assert_all_responses_were_requested=False)
```

**陷阱 2：pytest.param 不支持 usefixtures**
```python
# ❌ 错误：pytest.param cannot add pytest.mark.usefixtures
pytest.param("remote", marks=pytest.mark.usefixtures("mock_user_system"))

# ✅ 解决：使用独立的测试函数
@pytest.mark.usefixtures("mock_user_system")
async def test_remote_mode(...):
    ...
```

**陷阱 3：设置属性不生效**
```python
# ❌ 不生效：直接设置属性
httpx_mock.reset_assert_all_responses_were_requested = False

# ✅ 正确：调用 reset() 方法并传参
httpx_mock.reset(assert_all_responses_were_requested=False)
```

## 实际案例：15 次 E2E 失败分析

### 失败分类

- **依赖兼容性**：33% (5/15) - Pydantic V2, pytest-asyncio, pytest-httpx
- **Mock 使用不当**：20% (3/15) - 本文重点
- **API Schema 不匹配**：13% (2/15)
- **初始 Bug**：13% (2/15)
- **其他**：20% (3/15)

### Mock 相关的 3 次失败

1. **Teardown 断言失败**（2 次）
   - 原因：`assert_all_responses_were_requested` 默认开启
   - 解决：`httpx_mock.reset(assert_all_responses_were_requested=False)`

2. **Collection 错误**（1 次）
   - 原因：`pytest.param` 不支持 `usefixtures`
   - 解决：分离测试函数

## 行动清单

### 立即执行（本 PR）
- [x] 分离 local/remote 测试函数
- [x] 使用 `@pytest.mark.usefixtures` 明确声明依赖
- [x] 添加 `httpx_mock.reset(assert_all_responses_were_requested=False)`
- [ ] 验证测试通过

### 短期优化（1-2 周）
- [ ] 为其他参数化测试应用相同模式
- [ ] 添加 Mock 使用的代码审查清单
- [ ] 更新测试文档

### 长期改进（1 个月）
- [ ] 建立 Contract Testing 流程
- [ ] 使用 WireMock/respx 进行更复杂的 mock 场景
- [ ] 团队培训：Mock 策略与最佳实践

## 参考资料

- [pytest fixtures 文档](https://docs.pytest.org/en/stable/how-to/fixtures.html)
- [pytest-httpx 文档](https://colin-b.github.io/pytest_httpx/)
- [Testing Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Contract Testing](https://martinfowler.com/bliki/ContractTest.html)

## 更新日志

- 2025-10-22: 初始版本，总结 E2E Mock 失败经验

