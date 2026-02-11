# PuppyStorage 存储管理器

## 📖 概述

PuppyStorage 存储管理器提供了统一的存储抽象层，支持本地文件存储和远程 S3 存储之间的自动切换。设计遵循 **约定优于配置** 原则，通过简单的环境变量即可实现存储策略的切换。

## 🚀 快速开始

### 基本使用

```python
from storage import get_storage, get_storage_info

# 获取存储适配器（自动根据配置选择）
storage = get_storage()

# 使用存储功能
storage.save_file("test.txt", b"Hello World", "text/plain")
data, content_type = storage.get_file("test.txt")

# 查看当前存储配置
info = get_storage_info()
print(f"当前使用: {info['type']} 存储")
```

### 动态切换存储

```python
from storage import switch_storage

# 切换到本地存储
switch_storage("local")

# 切换到远程存储  
switch_storage("remote")
```

## ⚙️ 配置方式

### 使用 DEPLOYMENT_TYPE

通过设置 `DEPLOYMENT_TYPE` 环境变量来控制存储类型：

```bash
# 本地开发环境
export DEPLOYMENT_TYPE=local

# 远程环境（生产/测试/预发布等）
export DEPLOYMENT_TYPE=remote
```

### 部署类型映射

| 部署类型 | 存储类型 | 说明 |
|---------|---------|------|
| `local` | 本地存储 | 开发环境，使用本地文件系统 |
| `remote` | 远程存储 | 远程环境，使用 S3 存储 |

## 📋 配置优先级

配置按以下优先级生效：

1. **DEPLOYMENT_TYPE** (环境变量)
2. **DEPLOYMENT_TYPE** (配置文件)
3. **默认配置**: `remote` (生产环境安全默认)

## 🏗️ 架构设计

### 核心组件

```
StorageManager (单例)
├── LocalStorageAdapter     # 本地文件存储
├── S3StorageAdapter       # S3 远程存储
└── StorageAdapter (抽象)   # 存储接口
```

### 设计特性

- **单例模式**: 全局唯一的存储管理器实例
- **自动回退**: S3 初始化失败时自动回退到本地存储
- **动态切换**: 支持运行时切换存储类型
- **配置灵活**: 多层配置检测，支持环境变量和配置文件

## 📚 API 参考

### 主要函数

#### `get_storage() -> StorageAdapter`
获取当前的存储适配器实例。

```python
storage = get_storage()
```

#### `switch_storage(storage_type: str)`
动态切换存储类型。

```python
switch_storage("local")   # 切换到本地存储
switch_storage("remote")  # 切换到远程存储
```

#### `get_storage_info() -> dict`
获取当前存储配置信息。

```python
info = get_storage_info()
# 返回: {"type": "local", "status": "已就绪", "path": "/path/to/storage", ...}
```

### StorageAdapter 接口

所有存储适配器都实现以下接口：

```python
# 文件操作
save_file(key: str, file_data: bytes, content_type: str) -> bool
get_file(key: str) -> tuple[bytes, str]
delete_file(key: str) -> bool
check_file_exists(key: str) -> bool

# URL生成
generate_upload_url(key: str, content_type: str, expires_in: int = 300) -> str
generate_download_url(key: str, expires_in: int = 86400) -> str
```

## 🔧 环境配置

### 本地存储配置

本地存储需要配置存储路径：

```bash
# 可选：自定义存储路径（默认使用配置文件中的路径）
export LOCAL_STORAGE_PATH=/path/to/storage
# Deprecated: LOCAL_SERVER_URL (use STORAGE_SERVER_URL instead)
```

### S3 存储配置

S3 存储需要配置 Cloudflare R2 凭证：

```bash
export CLOUDFLARE_R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
export CLOUDFLARE_R2_ACCESS_KEY_ID=your-access-key
export CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-secret-key
export CLOUDFLARE_R2_BUCKET=your-bucket-name
```

## 🎯 最佳实践

### 1. 环境隔离

```bash
# 开发环境 (.env.local)
DEPLOYMENT_TYPE=local

# 远程环境 (.env.remote) 
DEPLOYMENT_TYPE=remote
```

### 2. 容器化部署

```dockerfile
# Dockerfile
ENV DEPLOYMENT_TYPE=remote
```

### 3. 配置验证

启动时检查存储配置：

```python
from storage import get_storage_info

info = get_storage_info()
print(f"存储配置: {info}")

if info['status'] != '已就绪':
    raise RuntimeError("存储配置错误")
```

## 🧪 测试

运行示例和测试：

```bash
# 运行使用示例
python storage/example_usage.py

# 测试本地存储
DEPLOYMENT_TYPE=local python storage/example_usage.py

# 测试远程存储
DEPLOYMENT_TYPE=remote python storage/example_usage.py
```

## 🔍 故障排除

### 常见问题

1. **S3 初始化失败**
   - 检查 Cloudflare R2 凭证配置
   - 查看日志中的详细错误信息
   - 系统会自动回退到本地存储

2. **本地存储路径错误**
   - 检查 `LOCAL_STORAGE_PATH` 配置
   - 确保目录有读写权限

3. **配置不生效**
   - 检查环境变量设置
   - 确认配置优先级
   - 重启应用以加载新配置

### 调试模式

启用详细日志记录：

```python
import logging
logging.getLogger('storage').setLevel(logging.DEBUG)
```

## 🤝 与 PuppyAgent-API 的一致性

两个项目现在都使用相同的配置方式：

- 统一使用 `DEPLOYMENT_TYPE` 作为主要配置
- 相同的部署类型映射逻辑
- 一致的环境变量命名约定

这确保了配置的统一性和开发体验的一致性。 