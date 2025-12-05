"""
Supabase 客户端使用示例

演示如何使用封装好的 Supabase 客户端进行增删改查操作。
"""

from src.supabase.repository import SupabaseRepository
from src.supabase.exceptions import (
    SupabaseException,
    SupabaseDuplicateKeyError,
)
from src.supabase.schemas import (
    UserCreate,
    UserUpdate,
    ProjectCreate,
    ProjectUpdate,
    TableCreate,
    TableUpdate,
)


def example_usage():
    """使用示例"""
    # 创建仓库实例（会自动使用单例客户端）
    repo = SupabaseRepository()

    # ==================== User 操作示例 ====================
    print("=== User 操作示例 ===")

    # 创建用户
    user = repo.create_user(UserCreate(name="张三"))
    print(f"创建用户: {user}")

    # 获取用户
    user = repo.get_user(user.id)
    print(f"获取用户: {user}")

    # 更新用户
    user = repo.update_user(user.id, UserUpdate(name="李四"))
    print(f"更新用户: {user}")

    # 获取用户列表
    users = repo.get_users(limit=10)
    print(f"用户列表: {users}")

    # ==================== Project 操作示例 ====================
    print("\n=== Project 操作示例 ===")

    # 创建项目
    try:
        project = repo.create_project(
            ProjectCreate(name="我的项目", description="项目描述", user_id=user.id)
        )
        print(f"创建项目: {project}")
    except SupabaseDuplicateKeyError as e:
        print(f"创建项目失败（记录已存在）: {e.message}")
        # 如果项目已存在，尝试获取现有项目
        projects = repo.get_projects(user_id=user.id, name="我的项目")
        if projects:
            project = projects[0]
            print(f"使用现有项目: {project}")
        else:
            raise
    except SupabaseException as e:
        print(f"创建项目失败: {e.message}")
        raise

    # 获取项目
    project = repo.get_project(project.id)
    print(f"获取项目: {project}")

    # 更新项目
    project = repo.update_project(
        project.id, ProjectUpdate(description="更新后的描述")
    )
    print(f"更新项目: {project}")

    # 获取用户的所有项目
    projects = repo.get_projects(user_id=user.id)
    print(f"用户的项目列表: {projects}")

    # ==================== Table 操作示例 ====================
    print("\n=== Table 操作示例 ===")

    # 创建表
    try:
        table = repo.create_table(
            TableCreate(name="数据表1", project_id=project.id, description="表描述")
        )
        print(f"创建表: {table}")
    except SupabaseDuplicateKeyError as e:
        print(f"创建表失败（记录已存在）: {e.message}")
        # 如果表已存在，尝试获取现有表
        tables = repo.get_tables(project_id=project.id, name="数据表1")
        if tables:
            table = tables[0]
            print(f"使用现有表: {table}")
        else:
            raise
    except SupabaseException as e:
        print(f"创建表失败: {e.message}")
        raise

    # 获取表
    table = repo.get_table(table.id)
    print(f"获取表: {table}")

    # 更新表
    table = repo.update_table(table.id, TableUpdate(name="更新后的表名"))
    print(f"更新表: {table}")

    # 获取项目的所有表
    tables = repo.get_tables(project_id=project.id)
    print(f"项目的表列表: {tables}")

    # ==================== 删除操作示例 ====================
    print("\n=== 删除操作示例 ===")

    # 删除表
    success = repo.delete_table(table.id)
    print(f"删除表: {success}")

    # 删除项目
    success = repo.delete_project(project.id)
    print(f"删除项目: {success}")

    # 删除用户
    success = repo.delete_user(user.id)
    print(f"删除用户: {success}")


if __name__ == "__main__":
    example_usage()
