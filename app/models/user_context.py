from pydantic import BaseModel, Field

class UserContext(BaseModel):
    """
    Context表示知识库，与数据库产品中的Table相对应.
    """
    context_id: str = Field(..., description="主键，表示知识库的ID")
    user_id: str = Field(..., description="外键，对应用户表，表示知识库所属的用户ID")
    project_id: str = Field(..., description="外键，对应项目表，表示知识库所属的项目ID")
    context_name: str = Field(..., description="知识库名称，在MCP服务中可以提供给Agent")
    context_description: str = Field(..., description="知识库的描述，在MCP服务中可以提供给Agent")
    context_data: dict = Field(..., description="关键存储数据的字段，本质上存储一个JSON对象")
    metadata: dict = Field(..., description="其他可能的元数据")




"""
开发 TODO

1. context_data本身需要套一个管理的service，通过json_pointer来定位和管理。这个接口暴露给前端。
2. 在mcp层，是否需要给Agent暴露json_pointer的概念呢？答案是不需要。
    所以前端在新建一个mcp instance的时候，不仅仅要传入project_id, user_id, context_id, 还需要传入一个json_pointer.
    然后我们能repository里面维护这个json_pointer.
    这样一来，mcp的get、create、update等方案就会局限在这个json_pointer的域内。
    但是这对于Agent是不可知的。
    唯一要修改的是，我们的tool_description和tool_name。
"""