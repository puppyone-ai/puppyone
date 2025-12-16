# 设计文档: 模块化服务结构重构

## Context

当前项目使用传统的分层架构（按类型组织代码），随着功能增加，维护成本上升。需要重构为更符合领域驱动设计思想的模块化服务架构。

**当前结构**:
```
app/
├── api/v1/endpoints/  # 路由端点
├── models/           # 所有数据模型
├── schemas/          # 所有Pydantic模型
├── service/          # 所有业务逻辑
├── repositories/     # 所有数据访问
├── core/            # 核心配置
└── utils/           # 工具函数
```

**目标结构**:
```
src/
├── auth/            # 认证服务模块
│   ├── router.py
│   ├── schemas.py
│   ├── models.py
│   ├── service.py
│   ├── repository.py
│   ├── dependencies.py
│   └── ...
├── user_context/    # 用户上下文服务模块
├── mcp/            # MCP服务器管理模块
├── config.py       # 全局配置
├── models.py       # 全局模型
├── exceptions.py   # 全局异常
├── database.py     # 数据库连接
├── pagination.py   # 全局工具
└── main.py         # 应用入口
```

## Goals / Non-Goals

**Goals**:
- 提高代码组织的清晰度和可维护性
- 使服务模块边界明确，降低耦合
- 改善开发体验，新增服务时只需在一个目录下工作
- 为未来可能的微服务拆分做准备

**Non-Goals**:
- 不改变业务逻辑实现
- 不改变API接口签名和行为
- 不改变数据库结构
- 不在本次重构中引入新功能
- 不改变外部依赖和配置

## Decisions

### 1. 目录命名: `src/` vs `app/`

**决策**: 使用 `src/` 作为根目录

**理由**:
- `src/` 是Python项目的通用惯例（遵循PEP建议）
- 更明确地表示这是源代码目录
- 与 `tests/`、`docs/` 等顶级目录形成对称结构
- 避免与FastAPI等框架的示例代码混淆

**替代方案**:
- 保持 `app/`：优点是变更小，缺点是不够通用
- 使用 `backend/`：优点是明确后端代码，缺点是项目已经是backend目录

### 2. 服务模块划分

**决策**: 将现有功能划分为三个核心服务模块：
- `auth`: 用户认证和授权（从 `user` 重命名，更准确地反映其职责）
- `user_context`: 用户上下文管理
- `mcp`: MCP服务器实例管理

**理由**:
- 基于当前代码的业务领域自然划分
- 每个模块职责单一明确
- 模块之间依赖关系清晰（auth基础服务，其他服务依赖auth）

### 3. 全局模块的选择

**决策**: 保留以下全局模块：
- `config.py`: 应用级配置（从 `core/config.py` 提升）
- `models.py`: 跨服务共享的数据模型
- `exceptions.py`: 全局异常基类（从 `core/exceptions.py` 提升）
- `database.py`: 数据库连接和会话管理
- `pagination.py`: 通用分页工具
- `main.py`: FastAPI应用入口

**理由**:
- 这些模块被多个服务共享，放在全局避免循环依赖
- 保持扁平化的全局命名空间，便于导入
- 配置和入口文件放在顶层是标准做法

### 4. 服务模块内部结构

**决策**: 每个服务模块采用标准化的文件结构：
- `router.py`: FastAPI路由定义（必需）
- `schemas.py`: Pydantic请求/响应模型（必需）
- `models.py`: 数据库模型（如果需要持久化）
- `service.py`: 业务逻辑层（必需）
- `repository.py`: 数据访问层（如果需要持久化）
- `dependencies.py`: FastAPI依赖注入
- `config.py`: 模块级配置
- `constants.py`: 模块级常量
- `exceptions.py`: 模块特定异常
- `utils.py`: 模块级工具函数

**理由**:
- 标准化结构降低认知负担
- 从文件名即可了解其职责
- 遵循FastAPI和常见Python项目的最佳实践
- 支持渐进式开发（只创建需要的文件）

### 5. 导入路径策略

**决策**: 
- 所有导入从 `src.` 开始（如 `from src.auth.schemas import UserCreate`）
- 服务内部可以使用相对导入（如 `from .schemas import UserCreate`）
- 全局模块导入使用绝对路径（如 `from src.config import settings`）

**理由**:
- 绝对导入路径清晰，避免歧义
- 相对导入减少模块内部耦合
- 符合Python导入的最佳实践

### 6. 迁移策略

**决策**: 采用脚本化的迁移流程
1. 使用 `git mv` 保留文件历史
2. 分步骤执行：先创建目录结构，再移动文件，最后更新导入
3. 每个服务模块单独迁移，保持独立的git commit
4. 迁移后运行完整测试套件验证

**理由**:
- 保留git历史便于追踪代码变更
- 分步骤执行降低风险，便于回滚
- 独立commit便于代码审查

## Risks / Trade-offs

### Risk 1: Git历史断裂
- **风险**: 文件移动可能导致git blame难以追踪代码历史
- **缓解**: 使用 `git mv` 命令移动文件，git能够识别文件重命名
- **缓解**: 在迁移完成后创建 `.git-blame-ignore-revs` 文件记录重构commit

### Risk 2: 导入路径遗漏
- **风险**: 可能存在未被发现的导入路径需要更新
- **缓解**: 使用自动化工具（如sed、ruff）批量替换
- **缓解**: 运行完整的测试套件和类型检查
- **缓解**: 在开发环境手动测试所有关键功能

### Risk 3: 部署配置更新
- **风险**: CI/CD脚本和部署配置需要更新路径
- **缓解**: 在部署前检查所有配置文件
- **缓解**: 更新文档说明新的启动方式

### Risk 4: 开发环境冲突
- **风险**: 正在开发中的分支可能因路径变更产生大量冲突
- **缓解**: 提前通知团队，建议在重构前合并或暂存工作
- **缓解**: 提供迁移脚本帮助其他分支快速适配

### Trade-off: 短期成本 vs 长期收益
- **短期成本**: 需要投入时间进行迁移和测试，可能影响开发进度
- **长期收益**: 代码组织更清晰，维护成本降低，新功能开发更快
- **决策**: 接受短期成本，优先考虑长期可维护性

## Migration Plan

### Phase 1: 准备阶段
1. 创建新的目录结构（空目录）
2. 更新 `.gitignore` 包含 `src/__pycache__/`
3. 创建迁移脚本（自动化文件移动和导入替换）
4. 通知团队即将进行重构

### Phase 2: 迁移阶段
1. **迁移 auth 模块**:
   - 移动 `models/user.py` -> `src/auth/models.py`
   - 移动 `schemas/user.py` -> `src/auth/schemas.py`
   - 移动 `service/user_service.py` -> `src/auth/service.py`
   - 移动 `repositories/user_repo.py` -> `src/auth/repository.py`
   - 移动 `api/v1/endpoints/user.py` -> `src/auth/router.py`
   - 创建 `src/auth/dependencies.py`（从 `core/dependencies.py` 提取）
   
2. **迁移 user_context 模块**:
   - 类似auth模块的迁移步骤
   
3. **迁移 mcp 模块**:
   - 移动整个 `mcp_server/` 目录到 `src/mcp/`
   - 调整内部导入路径
   
4. **迁移全局模块**:
   - 移动 `core/config.py` -> `src/config.py`
   - 移动 `core/exceptions.py` -> `src/exceptions.py`
   - 移动 `core/exception_handler.py` -> `src/exception_handler.py`
   - 移动 `utils/` -> `src/utils/` (临时，后续分散到各模块)
   - 移动 `main.py` -> `src/main.py`

5. **更新导入路径**:
   - 批量替换 `from app.` -> `from src.`
   - 更新服务内部导入使用相对路径
   - 验证所有导入正确

### Phase 3: 验证阶段
1. 运行 `ruff check` 检查代码质量
2. 运行完整测试套件
3. 手动测试关键API端点
4. 更新所有文档中的路径引用
5. 更新 `pyproject.toml` 中的包配置
6. 更新启动命令文档

### Phase 4: 清理阶段
1. 删除旧的 `app/` 目录
2. 更新 README 中的项目结构说明
3. 更新 openspec/project.md 中的架构说明
4. 创建 `.git-blame-ignore-revs` 文件

### Rollback Plan

如果迁移后发现严重问题：
1. 使用 `git revert` 回滚所有迁移commit
2. 或者使用 `git reset --hard <commit>` 回到迁移前的状态
3. 分析失败原因，修复问题后重新尝试

## Open Questions

1. **是否需要将 `utils/` 中的工具函数分散到各个服务模块？**
   - 当前建议：先整体移动到 `src/utils/`，后续根据实际使用情况逐步迁移到各模块
   
2. **是否需要为 `aws` 或其他外部服务创建独立模块？**
   - 当前建议：可以先定义一个`s3`模块。
   
3. **测试目录是否需要同步调整结构？**
   - 当前建议：是，测试目录结构应与src保持一致，便于查找对应的测试文件
   
4. **是否需要在模块之间定义明确的依赖关系和通信接口？**
   - 当前建议：先完成基本重构，后续可以引入依赖注入容器或事件总线

5. **如何处理跨模块共享的repository基类（如 `repositories/base.py`）？**
   - 当前建议：移动到 `src/repositories/` 作为共享基础设施

