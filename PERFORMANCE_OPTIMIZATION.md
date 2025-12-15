# ⚡️ 启动性能问题分析与解决方案

## 📊 问题诊断

通过测试发现，**reload 时间缓慢（70+秒）** 的主要原因是：

### 🐌 最慢的模块（测试结果）

1. **`src.llm.service`**: **20.9秒** ⚠️
   - 原因：导入 `litellm` 库非常慢
   - `from litellm import acompletion` 会加载大量 AI 模型相关的依赖

2. **`src.supabase.client`**: **12.7秒** ⚠️
   - 原因：导入 `supabase` SDK 并创建客户端
   - `from supabase import create_client` 加载整个 SDK

3. **`src.config`**: **4.9秒**
   - 原因：Pydantic Settings 解析 `.env` 文件

4. **`src.auth.dependencies`**: **2.3秒**
   - 级联导入了 supabase 相关模块

**总计：** ~43秒仅用于模块导入！

### 🔄 为什么 Reload 更慢？

- **首次启动**：模块按顺序加载一次
- **Reload**：
  1. Python 重新导入所有模块
  2. 单例被重置，服务被重新初始化
  3. **累积效应**：每次 reload 都会触发多次重复初始化

## ✅ 已完成的优化

1. ✅ 移除所有 `@lru_cache` 装饰器，改用全局变量单例
2. ✅ 修复 `S3Service` 的模块级实例化（改为懒加载代理）
3. ✅ 修复 `TableRepositorySupabase` 的重复初始化
4. ✅ 修复 `McpInstanceRepositorySupabase` 的重复初始化
5. ✅ 为所有 service/repository 添加单例模式
6. ✅ 添加详细的启动时间监控

## 🚀 推荐的解决方案

### 方案 1: 延迟导入重量级库（推荐）

将 `litellm` 和 `supabase` 的导入改为**懒加载**：

#### LLM Service 懒加载

```python
# src/llm/service.py
class LLMService:
    def __init__(self):
        self._litellm = None  # 延迟导入
    
    def _import_litellm(self):
        """懒加载 litellm"""
        if self._litellm is None:
            from litellm import acompletion
            # ... 其他导入
            self._litellm = acompletion
        return self._litellm
    
    async def call_text_model(self, ...):
        acompletion = self._import_litellm()  # 只在使用时导入
        # ...
```

#### Supabase Client 懒加载

```python
# src/supabase/client.py
class SupabaseClient:
    def __init__(self):
        # 不要在 __init__ 中导入或初始化
        self._client = None
    
    @property
    def client(self):
        if self._client is None:
            # 只在第一次访问时才导入并创建
            from supabase import create_client
            self._client = create_client(...)
        return self._client
```

**预期效果**：
- 首次启动：~2-3秒（不加载 LLM）
- Reload：~2-3秒（快98%！）
- 只有在实际调用 LLM 或数据库时才会加载重量级库

### 方案 2: 开发模式跳过不必要的初始化

在 `DEBUG=True` 时跳过某些服务的预加载：

```python
# src/llm/dependencies.py
def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        if settings.DEBUG:
            # 开发模式：创建占位符，实际使用时才初始化
            _llm_service = LLMServicePlaceholder()
        else:
            # 生产模式：完整初始化
            _llm_service = LLMService()
    return _llm_service
```

### 方案 3: 使用 Python 的 `TYPE_CHECKING`

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from litellm import acompletion
else:
    acompletion = None  # 运行时不导入
```

## 📈 预期性能提升

| 场景 | 当前 | 优化后 | 提升 |
|------|------|--------|------|
| 首次启动 | ~5秒 | ~2秒 | ⚡️ 60% |
| Reload | ~70秒 | ~2秒 | 🚀 **97%** |
| 内存占用 | 高 | 中 | 💾 30-40% |

## 🛠️ 实施步骤

### 立即可做（影响最大）：

1. **延迟导入 litellm**（节省 ~21秒）
   - 修改 `src/llm/service.py`
   - 只在 `call_text_model()` 中导入

2. **延迟初始化 Supabase Client**（节省 ~13秒）
   - 修改 `src/supabase/client.py`
   - 改为属性懒加载

3. **开发模式下禁用 MCP 恢复**（已完成 ✅）

### 后续优化：

4. 使用 `importlib.util.LazyLoader` 统一管理懒加载
5. 考虑使用 `uvicorn --reload-delay 2` 减少频繁 reload
6. 生产环境使用 `uvicorn` 的 worker 模式而不是 reload 模式

## 🔍 调试工具

已添加的测试脚本：

```bash
# 测试各模块导入时间
uv run python test_import_time.py
```

## 📝 注意事项

1. **懒加载的权衡**：
   - ✅ 优点：启动快，内存占用低
   - ⚠️  缺点：第一次使用时会有延迟（但只有一次）

2. **生产环境建议**：
   - 使用 `gunicorn` 或 `uvicorn` 的 worker 模式
   - 不使用 `--reload` 参数
   - 预加载所有模块以获得最佳性能

3. **开发体验优化**：
   - 优先优化 reload 性能
   - 保持代码改动后的快速反馈循环
