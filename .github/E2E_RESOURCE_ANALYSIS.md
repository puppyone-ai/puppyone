# E2E Docker Compose 资源评估

## GitHub Actions Standard Runner 规格

- **CPU**: 2 cores
- **Memory**: 7 GB RAM  
- **Disk**: 14 GB SSD
- **Time limit**: 6 hours/job

## 当前单服务实例配置资源估算

### 基础设施服务

| 服务 | 内存估算 | 磁盘估算 | CPU负载 | 备注 |
|------|---------|---------|---------|------|
| postgres (pgvector) | 300-500 MB | 200 MB | 低 | E2E数据量小 |
| minio | 100-200 MB | 50 MB | 低 | 仅E2E测试数据 |
| minio-setup | 20 MB | - | 极低 | 短暂运行后退出 |
| wiremock | 100-150 MB | 50 MB | 极低 | 静态stub响应 |
| **小计** | **520-870 MB** | **300 MB** | **低** | |

### 应用服务

| 服务 | 内存估算 | 磁盘估算 | CPU负载 | 备注 |
|------|---------|---------|---------|------|
| storage (local) | 300-500 MB | 200 MB | 低-中 | FastAPI + FS + Chroma |
| **小计** | **300-500 MB** | **200 MB** | **低-中** | |

### 当前总计

- **Memory**: 820-1370 MB (~1.4 GB)
- **Disk**: 500 MB (容器) + 3-4 GB (镜像缓存) = **~4.5 GB**
- **CPU**: 低-中负载，2核足够

**结论**: ✅ 当前单实例配置远未达到限制

---

## 双服务实例配置资源估算

### 增加 storage-remote 服务后

| 服务 | 内存估算 | 磁盘估算 | CPU负载 | 备注 |
|------|---------|---------|---------|------|
| postgres (pgvector) | 300-500 MB | 200 MB | 低 | 同上 |
| minio | 100-200 MB | 50 MB | 低 | 同上 |
| wiremock | 100-150 MB | 50 MB | 极低 | 同上 |
| storage-local | 300-500 MB | 200 MB | 低 | FS + Chroma + local auth |
| **storage-remote** | **300-500 MB** | **200 MB** | **低** | **S3 + PGV + remote auth** |
| **总计** | **1.1-1.85 GB** | **700 MB** | **低-中** | |

### 磁盘详细分解

| 组件 | 大小 | 说明 |
|------|------|------|
| Base images | ~2 GB | Python 3.11, postgres, minio等 |
| requirements-e2e.txt (带chromadb) | ~500 MB | 增加chromadb约100MB |
| PuppyStorage code | ~50 MB | 源代码 |
| Docker layers cache | ~1-2 GB | 构建缓存 |
| Runtime data | ~1 GB | 容器运行时 + 日志 |
| **预估总计** | **4.5-5.5 GB** | |

---

## 风险评估与优化方案

### ✅ 内存：安全

- 预估峰值: **~2 GB**
- 可用: **7 GB**
- **余量: 5 GB (71%)** ✅

### ✅ CPU：安全

- E2E测试为IO密集型，非CPU密集型
- 2核心对于6个轻量服务完全足够
- **余量: 充足** ✅

### ⚠️ 磁盘：需要注意

- 预估使用: **5.5 GB**
- 可用: **14 GB**
- **余量: 8.5 GB (61%)** ⚠️

### 磁盘优化方案

#### 方案A: 减少镜像层（已实施）

- ✅ 使用 requirements-e2e.txt (已完成)
- ✅ 多阶段构建减少最终镜像大小

#### 方案B: 共享镜像（推荐增加）

两个storage服务使用同一个镜像，只需构建一次：

```yaml
services:
  storage-local:
    image: puppy-storage-e2e:latest
    build: ...  # 只构建一次
    environment:
      - DEPLOYMENT_TYPE=local
  
  storage-remote:
    image: puppy-storage-e2e:latest  # 复用同一镜像
    environment:
      - DEPLOYMENT_TYPE=remote
```

**节省磁盘**: ~500 MB

#### 方案C: 清理构建缓存

在workflow中添加：

```yaml
- name: Free disk space
  run: |
    docker system prune -af --volumes
    df -h
```

---

## 最终评估

### 双服务实例资源需求

| 资源类型 | 需求 | 可用 | 余量 | 状态 |
|---------|------|------|------|------|
| Memory | ~2 GB | 7 GB | 5 GB (71%) | ✅ 安全 |
| CPU | 低-中 | 2 cores | 充足 | ✅ 安全 |
| Disk | ~5 GB | 14 GB | 9 GB (64%) | ✅ 安全 |

### 结论

✅ **双服务实例配置完全可行，不会超限**

**理由**：

1. 内存峰值仅占可用量的28%
2. CPU为轻量IO型workload，2核心充足
3. 磁盘使用约36%，有充足余量
4. 所有服务均为轻量级，无大数据量操作

**建议优化**（可选）：

- 使用共享镜像避免重复构建
- E2E结束后清理临时文件
- 设置容器memory limits防止意外泄漏

---

## 参考

- [GitHub Actions Runner Specs](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners)
- [Docker Resource Limits](https://docs.docker.com/config/containers/resource_constraints/)
