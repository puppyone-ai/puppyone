"""
Profile Service

处理用户 Profile 和 Onboarding 的业务逻辑
"""

from datetime import datetime, timezone
from typing import Optional, Tuple

from src.profile.models import Profile, ProfileUpdate
from src.profile.repository import ProfileRepositorySupabase
from src.project.service import ProjectService
from src.content_node.service import ContentNodeService
from src.utils.logger import log_info, log_error


# Demo Project 配置
DEMO_PROJECT_NAME = "Get Started"
DEMO_PROJECT_DESCRIPTION = (
    "Your first project to explore PuppyOne. "
    "Feel free to experiment - this is your playground!"
)


class ProfileService:
    """Profile 业务服务"""

    def __init__(
        self,
        profile_repository: ProfileRepositorySupabase,
        project_service: Optional[ProjectService] = None,
        content_node_service: Optional[ContentNodeService] = None,
    ):
        self._profile_repo = profile_repository
        self._project_service = project_service
        self._content_node_service = content_node_service

    def get_profile(self, user_id: str) -> Optional[Profile]:
        """获取用户 Profile"""
        return self._profile_repo.get_by_user_id(user_id)

    def update_profile(self, user_id: str, data: ProfileUpdate) -> Optional[Profile]:
        """更新用户 Profile"""
        return self._profile_repo.update(user_id, data)

    def check_onboarding_status(
        self, user_id: str, email: Optional[str] = None
    ) -> Tuple[bool, Optional[int], str]:
        """
        检查用户 Onboarding 状态

        Args:
            user_id: 用户ID
            email: 用户邮箱（用于自动创建 Profile）

        Returns:
            Tuple[has_onboarded, demo_project_id, redirect_to]
        """
        # 如果提供了 email，使用 get_or_create 确保 Profile 存在
        if email:
            profile = self._profile_repo.get_or_create(user_id, email)
        else:
            profile = self._profile_repo.get_by_user_id(user_id)

        if profile is None:
            # Profile 仍然不存在（创建失败或未提供 email）
            log_error(f"Profile not found for user {user_id}, and unable to create")
            return False, None, "/home"

        if profile.has_onboarded:
            # 已完成 Onboarding，跳转到 Dashboard
            return True, profile.demo_project_id, "/home"
        else:
            # 未完成 Onboarding，需要创建 Demo Project
            return False, None, "/home"

    async def complete_onboarding(
        self, user_id: str, email: Optional[str] = None, demo_project_id: Optional[int] = None
    ) -> Tuple[bool, str, Optional[int]]:
        """
        完成 Onboarding 流程

        如果没有提供 demo_project_id，会自动创建 Demo Project

        Args:
            user_id: 用户ID
            email: 用户邮箱（用于自动创建 Profile）
            demo_project_id: 可选的 Demo Project ID

        Returns:
            Tuple[success, redirect_to, demo_project_id]
        """
        # 如果提供了 email，使用 get_or_create 确保 Profile 存在
        if email:
            profile = self._profile_repo.get_or_create(user_id, email)
        else:
            profile = self._profile_repo.get_by_user_id(user_id)

        if profile is None:
            log_error(f"Profile not found for user {user_id}, and unable to create")
            return False, "/home", None

        if profile.has_onboarded:
            # 已经完成过 Onboarding
            log_info(f"User {user_id} already onboarded")
            return True, "/home", profile.demo_project_id

        # 如果没有提供 demo_project_id，创建 Demo Project
        actual_demo_project_id = demo_project_id
        if actual_demo_project_id is None and self._project_service:
            try:
                demo_project = await self._create_demo_project(user_id)
                if demo_project:
                    actual_demo_project_id = int(demo_project.id)
                    log_info(
                        f"Created demo project {actual_demo_project_id} for user {user_id}"
                    )
            except Exception as e:
                log_error(f"Failed to create demo project for user {user_id}: {e}")
                # 即使创建 Demo Project 失败，也继续完成 Onboarding

        # 标记 Onboarding 完成
        updated_profile = self._profile_repo.mark_onboarded(
            user_id, actual_demo_project_id
        )

        if updated_profile:
            # 返回重定向路径
            if actual_demo_project_id:
                redirect_to = f"/projects/{actual_demo_project_id}/data?welcome=true"
            else:
                redirect_to = "/home"

            return True, redirect_to, actual_demo_project_id
        else:
            return False, "/home", None

    async def _create_demo_project(self, user_id: str):
        """
        为用户创建 Demo Project
        """
        if not self._project_service:
            log_error("Project service not available")
            return None

        from src.organization.repository import OrganizationRepository
        org_repo = OrganizationRepository()
        orgs = org_repo.list_by_user(user_id)
        if not orgs:
            log_error(f"No organization found for user {user_id}, cannot create demo project")
            return None
        org_id = orgs[0].id

        existing_projects = self._project_service.get_by_org_id(org_id)
        for p in existing_projects:
            if p.name == DEMO_PROJECT_NAME:
                log_info(f"Demo project already exists for user {user_id}: {p.id}")
                return p

        project = self._project_service.create(
            name=DEMO_PROJECT_NAME,
            description=DEMO_PROJECT_DESCRIPTION,
            org_id=org_id,
            created_by=user_id,
        )

        if not project:
            log_error(f"Failed to create demo project for user {user_id}")
            return None

        log_info(f"Created demo project: {project.id} for user {user_id}")

        # 2. 创建预置文件夹和内容（如果 content_node_service 可用）
        if self._content_node_service:
            try:
                await self._create_demo_content(project.id, user_id)
            except Exception as e:
                log_error(f"Failed to create demo content: {e}")
                # 即使创建内容失败，项目已创建成功

        return project

    async def _create_demo_content(self, project_id: str, user_id: str):
        """
        在 Demo Project 中创建预置内容（扁平化结构）

        目录结构：
        📄 01_Welcome.md
        📄 02_Connect_Your_Data.md
        📄 03_Multi_Agent_Collaboration.md
        📄 04_Agent_Access_&_Tools.md
        📄 [Gmail] Project_Kickoff.md
        📄 [G-Doc] Tech_Spec.md
        📊 Q1_Budget_Data.json
        📁 Tool_Configs
           📄 Report_Generator_Config.md
        """
        import asyncio

        if not self._content_node_service:
            return

        # --- 1. Guide Docs ---
        welcome_content = """# Welcome to PuppyOne! 🐕

**Your AI Context Operating System.**

Don't just paste text. **Manage context** like a pro.

### The Workflow:
1.  **Connect**: Bring your data (Gmail, Docs, Code) here.
2.  **Collaborate**: Control which agent sees what.
3.  **Distribute**: Turn context into Tools for your agents.

👇 **Follow the guide below (02-04) to master PuppyOne.**
"""

        connect_content = """# Connect Your Data 🔗

PuppyOne connects to your real work apps.

### See it in action:
Look at the files below in the sidebar:
- **Gmail - Connect Your Inbox**: Click to connect your Gmail (marked "Not Connected")
- **Google Sheets - Connect**: Click to connect your Sheets (marked "Not Connected")
- `Q1_Budget_Data.json`: Sample JSON data for reference

### Why Placeholders?
The yellow "Not Connected" badge shows you **what types of data you can import**.
Click any placeholder to start the OAuth connection flow.

👉 **Try it yourself**: Click on a placeholder node, or use the **+** button to import other sources.
"""

        collab_content = """# Multi-Agent Collaboration 🤝

Not all agents are equal. You need **Granular Access Control**.

### The Scenario:
- **Root Agent** (You): Sees everything.
- **Claude Bot** (Guest): Should NOT see sensitive data.

### Try this:
1. Select **Claude Bot** in the right panel.
2. Notice how `Q1_Budget_Data.json` becomes **Invisible** or **Read-Only** (depending on your setting).
3. You control exactly what context each agent "consumes".
"""

        distribute_content = """# Agent Access & Tools 🚀

Turn your context into **Active Tools**.

### How it works:
Instead of dumping all text into the chat, you create a **Tool**.

### Example:
Check the `Tool_Configs` folder below.
We created a **"Report Generator"** tool that:
1. Reads the `[Gmail]` thread.
2. Reads the `[G-Doc]` spec.
3. Generates a weekly summary automatically.

👉 **Your agents can call this tool directly via MCP!**
"""

        # --- 2. Sample Data (JSON) ---
        json_content = {
            "project": "Alpha",
            "budget": {
                "total": 50000,
                "currency": "USD",
                "breakdown": {
                    "infrastructure": 15000,
                    "marketing": 20000,
                    "personnel": 15000
                }
            },
            "team_size": 5,
            "is_confidential": True
        }

        tool_config_content = """# Tool: Weekly Report Generator

**Type**: Prompt Template
**Model**: Claude 3.5 Sonnet

## Context Sources
- Gmail Inbox (connect your account)
- Google Docs (connect your account)

## System Prompt
You are a helpful project manager assistant.
Read the email threads and technical specs provided in the context.
Generate a weekly status report summarizing:
1. Key milestones from the email
2. Technical architecture decisions from the spec
3. Any risks identified

Output format: Markdown
"""

        try:
            # Step 1: 创建 Tool_Configs 文件夹
            tool_folder = self._content_node_service.create_folder(
                created_by=user_id,
                project_id=project_id,
                name="Tool_Configs",
                parent_id=None,
            )

            # Step 2: 创建 Guide Docs (markdown 文件)
            markdown_tasks = [
                self._content_node_service.create_markdown_node(
                    created_by=user_id, project_id=project_id, name="01_Welcome.md", content=welcome_content, parent_id=None
                ),
                self._content_node_service.create_markdown_node(
                    created_by=user_id, project_id=project_id, name="02_Connect_Your_Data.md", content=connect_content, parent_id=None
                ),
                self._content_node_service.create_markdown_node(
                    created_by=user_id, project_id=project_id, name="03_Multi_Agent_Collaboration.md", content=collab_content, parent_id=None
                ),
                self._content_node_service.create_markdown_node(
                    created_by=user_id, project_id=project_id, name="04_Agent_Access_&_Tools.md", content=distribute_content, parent_id=None
                ),
            ]

            # Tool Config inside folder
            if tool_folder:
                markdown_tasks.append(
                    self._content_node_service.create_markdown_node(
                        created_by=user_id,
                        project_id=project_id,
                        name="Report_Generator_Config.md",
                        content=tool_config_content,
                        parent_id=tool_folder.id,
                    )
                )

            # 并行执行 markdown 创建任务
            await asyncio.gather(*markdown_tasks)

            # Step 3: 创建占位符节点 (Placeholder Nodes)
            # 这些节点会显示为"未连接"状态，用户点击后可以去配置 OAuth
            self._content_node_service.create_placeholder_node(
                created_by=user_id,
                project_id=project_id,
                name="Gmail - Connect Your Inbox",
                placeholder_type="gmail",
                parent_id=None,
            )

            self._content_node_service.create_placeholder_node(
                created_by=user_id,
                project_id=project_id,
                name="Google Sheets - Connect",
                placeholder_type="sheets",
                parent_id=None,
            )

            # Step 4: 创建 JSON 示例数据
            self._content_node_service.create_json_node(
                created_by=user_id,
                project_id=project_id,
                name="Q1_Budget_Data.json",
                content=json_content,
                parent_id=None,
            )

            log_info(f"Demo content created for project {project_id}")

        except Exception as e:
            log_error(f"Error creating demo content: {e}")

    def reset_onboarding(self, user_id: str) -> Tuple[bool, str]:
        """
        重置用户 Onboarding 状态（用于测试）

        Returns:
            Tuple[success, message]
        """
        profile = self._profile_repo.reset_onboarding(user_id)

        if profile:
            return True, f"Onboarding reset for user {user_id}"
        else:
            return False, f"Failed to reset onboarding for user {user_id}"
