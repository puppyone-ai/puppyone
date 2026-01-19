"""
Connect 模块的 Pydantic 数据模型
"""

from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field, HttpUrl


class CrawlOptions(BaseModel):
    """Firecrawl 爬取选项"""

    limit: Optional[int] = Field(None, description="Maximum number of pages to crawl (1-10000)")
    max_depth: Optional[int] = Field(None, description="Maximum crawl depth", alias="maxDepth")
    include_paths: Optional[List[str]] = Field(None, description="URL patterns to include", alias="includePaths")
    exclude_paths: Optional[List[str]] = Field(None, description="URL patterns to exclude", alias="excludePaths")
    crawl_entire_domain: Optional[bool] = Field(None, description="Allow crawling entire domain", alias="crawlEntireDomain")
    sitemap: Optional[Literal['only', 'include', 'skip']] = Field(None, description="Sitemap usage strategy")
    allow_subdomains: Optional[bool] = Field(None, description="Allow crawling subdomains", alias="allowSubdomains")
    allow_external_links: Optional[bool] = Field(None, description="Follow external links", alias="allowExternalLinks")
    delay: Optional[int] = Field(None, description="Delay between requests in milliseconds")

    class Config:
        populate_by_name = True


class ParseUrlRequest(BaseModel):
    """解析URL请求"""

    url: HttpUrl = Field(..., description="要解析的URL")
    crawl_options: Optional[CrawlOptions] = Field(None, description="Firecrawl爬取选项（用于多页面爬取）")


class DataField(BaseModel):
    """数据字段信息"""

    name: str = Field(..., description="字段名称")
    type: str = Field(..., description="字段类型")
    sample_value: Any = Field(None, description="示例值")


class ParseUrlResponse(BaseModel):
    """解析URL响应"""

    url: str = Field(..., description="原始URL")
    source_type: str = Field(..., description="数据源类型，如github、notion、generic等")
    title: str = Field(None, description="数据标题")
    fields: List[DataField] = Field(default_factory=list, description="字段列表")
    sample_data: List[Dict[str, Any]] = Field(
        default_factory=list, description="示例数据（最多5条）"
    )
    total_items: int = Field(0, description="预估的总数据条数")
    data_structure: str = Field("list", description="数据结构类型：list或dict")


class ImportDataRequest(BaseModel):
    """导入数据请求"""

    url: HttpUrl = Field(..., description="数据源URL")
    project_id: str = Field(..., description="目标项目ID (UUID)")
    table_id: Optional[str] = Field(
        None, description="目标表格ID (UUID)，如果为空则创建新表格"
    )
    table_name: Optional[str] = Field(
        None, description="新表格名称（仅当table_id为空时有效）"
    )
    table_description: Optional[str] = Field(
        None, description="新表格描述（仅当table_id为空时有效）"
    )
    target_path: Optional[str] = Field(
        None, description="目标JSON路径，如 /users/0/profile (legacy)"
    )
    import_mode: str = Field(
        "add_to_existing",
        description="导入模式: add_to_existing, replace_all, keep_separate",
    )
    merge_strategy: str = Field(
        "smart",
        description="合并策略 (legacy): replace, merge_object, append_array, smart",
    )


class ImportDataResponse(BaseModel):
    """导入数据响应"""

    success: bool = Field(..., description="是否导入成功")
    project_id: str = Field(..., description="项目ID (UUID)")
    table_id: str = Field(..., description="表格ID (UUID)")
    table_name: str = Field(..., description="表格名称")
    items_imported: int = Field(0, description="成功导入的数据条数")
    message: str = Field("", description="结果消息")
