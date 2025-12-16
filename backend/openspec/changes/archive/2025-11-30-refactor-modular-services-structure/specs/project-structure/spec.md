# Spec Delta: 项目结构规范

## ADDED Requirements

### Requirement: 模块化服务目录结构

项目 SHALL 采用模块化的服务目录结构，将代码按业务领域组织为独立的服务模块，而非按技术层次组织。

#### Scenario: 根目录为 src

- **WHEN** 开发者查看项目根目录
- **THEN** 应看到 `src/` 目录作为源代码根目录
- **AND** `src/` 目录应包含所有服务模块和全局配置

#### Scenario: 服务模块独立完整

- **WHEN** 开发者导航到任一服务模块目录（如 `src/auth/`）
- **THEN** 该目录应包含完整的服务实现层次
- **AND** 包括：`router.py`（路由）、`schemas.py`（数据模型）、`models.py`（数据库模型）、`service.py`（业务逻辑）、`repository.py`（数据访问）
- **AND** 可选文件：`dependencies.py`、`config.py`、`constants.py`、`exceptions.py`、`utils.py`

#### Scenario: 全局模块位于顶层

- **WHEN** 开发者需要访问全局配置或工具
- **THEN** 应在 `src/` 顶层找到 `config.py`、`exceptions.py`、`database.py`、`main.py` 等全局文件
- **AND** 这些文件不属于任何特定服务模块

### Requirement: 标准服务模块结构

每个服务模块 SHALL 遵循标准化的内部文件结构，以确保一致性和可预测性。

#### Scenario: 必需文件存在

- **WHEN** 创建新的服务模块
- **THEN** 必须包含 `router.py`（定义API路由）
- **AND** 必须包含 `schemas.py`（定义请求/响应模型）
- **AND** 必须包含 `service.py`（定义业务逻辑）
- **AND** 必须包含 `__init__.py`（标识Python包）

#### Scenario: 可选文件按需创建

- **WHEN** 服务需要数据持久化
- **THEN** 应创建 `models.py`（数据库模型）和 `repository.py`（数据访问层）
- **WHEN** 服务需要模块级配置
- **THEN** 应创建 `config.py`
- **WHEN** 服务有特定异常类型
- **THEN** 应创建 `exceptions.py`

#### Scenario: 文件命名规范

- **WHEN** 开发者查看服务模块的文件名
- **THEN** 所有文件应使用单数形式（如 `router.py` 而非 `routers.py`）
- **AND** 应使用小写字母和下划线命名（snake_case）
- **AND** 文件名应准确反映其内容和职责

### Requirement: 导入路径规范

所有代码 SHALL 使用统一的导入路径规范，以提高可读性和可维护性。

#### Scenario: 使用 src 作为根导入路径

- **WHEN** 在任何Python文件中导入项目代码
- **THEN** 绝对导入必须以 `src.` 开头
- **AND** 例如：`from src.auth.schemas import UserCreate`
- **AND** 而非 `from app.auth.schemas import UserCreate`

#### Scenario: 服务内部使用相对导入

- **WHEN** 在服务模块内部文件之间导入
- **THEN** 应优先使用相对导入
- **AND** 例如：在 `src/auth/router.py` 中使用 `from .schemas import UserCreate`
- **AND** 而非 `from src.auth.schemas import UserCreate`

#### Scenario: 跨服务导入使用绝对路径

- **WHEN** 从一个服务模块导入另一个服务模块的代码
- **THEN** 必须使用绝对导入路径
- **AND** 例如：`from src.auth.models import User`
- **AND** 不应使用相对导入跨越服务边界

#### Scenario: 全局模块导入

- **WHEN** 导入全局配置或工具
- **THEN** 应使用 `from src.config import settings` 等绝对路径
- **AND** 所有服务模块都应使用相同的导入方式

### Requirement: 服务模块划分原则

服务模块 SHALL 按业务领域划分，保持单一职责和清晰边界。

#### Scenario: 核心服务模块

- **WHEN** 查看项目的服务模块列表
- **THEN** 应包含以下核心模块：
  - `auth`: 用户认证和授权
  - `user_context`: 用户上下文管理
  - `mcp`: MCP服务器实例管理
- **AND** 每个模块有明确的业务边界

#### Scenario: 避免过度耦合

- **WHEN** 一个服务模块需要另一个服务的功能
- **THEN** 应通过服务接口（service层）进行交互
- **AND** 不应直接访问其他服务的repository或数据库模型
- **AND** 使用依赖注入传递服务实例

#### Scenario: 模块扩展性

- **WHEN** 需要添加新的业务功能
- **THEN** 应评估是否需要创建新的服务模块
- **AND** 新模块应遵循相同的目录结构规范
- **AND** 例如：未来添加 `aws/` 模块用于AWS服务集成

### Requirement: 测试目录镜像源代码结构

测试目录 SHALL 镜像 `src/` 的结构，便于查找和组织测试代码。

#### Scenario: 测试目录结构对应

- **WHEN** 开发者查看 `tests/` 目录
- **THEN** 应看到与 `src/` 相同的服务模块子目录
- **AND** 例如：`tests/auth/`、`tests/user_context/`、`tests/mcp/`
- **AND** 每个测试模块对应源代码模块

#### Scenario: 测试文件命名

- **WHEN** 为服务模块编写测试
- **THEN** 测试文件应命名为 `test_<module>.py`
- **AND** 例如：`tests/auth/test_service.py` 测试 `src/auth/service.py`
- **AND** 测试文件位置与源文件对应

### Requirement: 向后兼容的迁移

从旧结构迁移到新结构 SHALL 保持API接口和数据格式不变，确保不破坏现有功能。

#### Scenario: API端点路径不变

- **WHEN** 完成项目结构重构
- **THEN** 所有API端点的URL路径应保持不变
- **AND** 例如：`/api/v1/users/` 仍然可访问
- **AND** 客户端代码无需修改

#### Scenario: 数据文件位置不变

- **WHEN** 系统启动后访问数据
- **THEN** 数据文件路径应保持在 `data/` 目录
- **AND** `data/userdata.json`、`data/user_contexts.json` 等文件位置不变
- **AND** 无需数据迁移

#### Scenario: 环境变量和配置兼容

- **WHEN** 使用现有的环境变量或配置文件
- **THEN** 配置项名称和格式应保持不变
- **AND** 现有的部署环境无需修改配置

### Requirement: Git历史保留

文件迁移 SHALL 使用 `git mv` 命令，以保留文件的git历史记录。

#### Scenario: 使用 git mv 移动文件

- **WHEN** 将文件从旧位置移动到新位置
- **THEN** 必须使用 `git mv <old_path> <new_path>` 命令
- **AND** 而非手动复制粘贴或使用操作系统的移动命令
- **AND** Git应能够识别文件重命名并保留历史

#### Scenario: 可追踪的代码历史

- **WHEN** 使用 `git log --follow <file_path>` 查看文件历史
- **THEN** 应能看到文件在重构前的所有提交记录
- **AND** `git blame` 应能正确显示代码作者
- **AND** 历史记录不应因文件移动而中断

#### Scenario: 创建 blame 忽略文件

- **WHEN** 完成重构后
- **THEN** 应创建 `.git-blame-ignore-revs` 文件
- **AND** 在其中记录重构的commit哈希
- **AND** 配置git使用该文件忽略大规模重构commit

