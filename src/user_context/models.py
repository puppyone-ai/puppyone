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

