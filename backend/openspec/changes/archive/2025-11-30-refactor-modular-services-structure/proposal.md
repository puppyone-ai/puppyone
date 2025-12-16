# Change: 重构项目为模块化服务结构

## Why

当前项目使用 `app/` 作为根目录，所有功能模块（用户、上下文、MCP等）的代码按类型（models、repositories、service、schemas）集中存放。随着项目规模增长，这种结构会导致：
1. 模块之间的边界不清晰，难以维护和扩展
2. 新增服务时需要在多个目录中创建文件，开发体验不佳
3. 不利于团队协作，多人同时修改容易产生冲突

## What Changes

将项目从传统的分层架构（按类型分文件夹）重构为按服务模块组织的架构（每个服务模块内部完整包含router、schemas、models、service、repository等）。具体变更：

- 将 `app/` 目录重命名为 `src/`，采用更通用的Python项目命名规范
- 将现有功能拆分为独立的服务模块：`auth`（用户认证）、`user_context`（用户上下文）、`mcp`（MCP服务器管理）
- 每个服务模块内部包含完整的实现层次：`router.py`、`schemas.py`、`models.py`、`service.py`、`repository.py`、`dependencies.py`、`config.py`、`constants.py`、`exceptions.py`、`utils.py`
- 保留全局级别的配置和通用模块：`config.py`（全局配置）、`models.py`（全局模型）、`exceptions.py`（全局异常）、`database.py`（数据库连接）、`pagination.py`（分页工具）、`main.py`（应用入口）
- 迁移测试目录结构与新结构保持一致
- **BREAKING**: 所有导入路径将从 `app.*` 更改为 `src.*`
- **BREAKING**: 文件和模块的位置发生重大变化

## Impact

- **受影响的规范**: 
  - 新增: `project-structure` - 定义模块化服务架构的组织规范
  
- **受影响的代码**:
  - 所有 `app/` 下的Python文件
  - 所有导入语句（从 `app.*` 改为 `src.*`）
  - `pyproject.toml` 中的包配置
  - 测试文件中的导入
  - 启动脚本和文档中的路径引用
  
- **迁移策略**:
  - 通过脚本批量移动和重命名文件
  - 使用查找替换工具批量更新导入语句
  - 保持数据文件（`data/`目录）不变
  - 确保测试通过后再提交变更

- **风险**:
  - 大规模文件移动可能导致git历史追踪困难（建议使用 `git mv` 保留历史）
  - 可能存在遗漏的导入路径需要手动修复
  - 需要更新CI/CD配置和部署脚本

